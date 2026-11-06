/**
 * Who someone is, and how their data key travels with them. Two modes, picked by config:
 *
 *   - Single user (set the OWNER_PASSWORD secret): one account named "owner", for people running their own copy.
 *     The first sign-in with OWNER_PASSWORD creates the account; after that the account's own password is what
 *     counts (it starts out the same). The password is what unlocks the data (see vault.ts).
 *   - Many users (leave OWNER_PASSWORD unset and set OPEN_SIGNUP=true): people sign in with Google through a
 *     login service (finereli-login by default). The service says who they are and hands this server a data key
 *     for them, the same on every login, so there is no password to type or lose. The catch is that the service's
 *     operator can derive that key: the data is encrypted at rest, not hidden from whoever runs the service.
 *   - Neither: nobody can sign in. A fresh deployment that forgot to pick a mode must not turn into a free
 *     service for strangers.
 *
 * Either way a sign-in produces the data key, and the key is carried from there inside tokens: the OAuth grant
 * for agents, and a session for the browser. Both keep it encrypted under the token itself, so this server
 * stores nothing that can open a user's data on its own.
 */
import { createHash } from 'node:crypto';
import { createAccount, KEY_STRETCH, newToken, openAccount, tokenId, unwrapForToken, wrapForToken } from './vault.js';
import type { AccountRecord } from './vault.js';
import type { WhatsAppStore } from './whatsapp-do.js';
import type { Registry } from './registry.js';
import { serverMode } from './limits.js';

export interface AuthEnv {
  OAUTH_KV: KVNamespace;
  WA: DurableObjectNamespace<WhatsAppStore>;
  REGISTRY: DurableObjectNamespace<Registry>;
  OWNER_PASSWORD?: string;
  /** "true" to run for many people, signing in through the login service. Many-user mode has to be asked for. */
  OPEN_SIGNUP?: string;
  /** The login service that says who someone is and hands over their data key. Defaults to finereli's. */
  LOGIN_URL?: string;
  /** Most accounts the service will have (many-user mode). 0 or unset: no cap. */
  SIGNUP_LIMIT?: string;
  /** A URL that takes a plain-text POST and pushes it to the operator's phone, such as an ntfy.sh topic. */
  NOTIFY_URL?: string;
  /** The operator's X handle, shown where people are told to get in touch. */
  CONTACT_X?: string;
  /** Per-account caps for many-user mode (see limits.ts). 0 means no cap. */
  MAX_MESSAGES?: string;
  MAX_DB_MB?: string;
  /** IANA zone for the single user's timestamps. Defaults to the zone of the browser that first signed in. */
  TIMEZONE?: string;
}

export interface Identity { userId: string; dek: Buffer }

const enc = new TextEncoder();
const hex = (b: ArrayBuffer) => [...new Uint8Array(b)].map((x) => x.toString(16).padStart(2, '0')).join('');
const randomId = () => hex(crypto.getRandomValues(new Uint8Array(16)).buffer);

/** Constant-time string comparison (hash both sides first so lengths don't leak). */
export async function sameSecret(a: string, b: string) {
  const [x, y] = await Promise.all([crypto.subtle.digest('SHA-256', enc.encode(a)), crypto.subtle.digest('SHA-256', enc.encode(b))]);
  return (crypto.subtle as any).timingSafeEqual(x, y) as boolean;
}

export const isSingleUser = (env: AuthEnv) => Boolean(env.OWNER_PASSWORD);
export { serverMode };
export type { Mode } from './limits.js';
export const NOT_SET_UP = 'This server has no sign-in configured. Its owner needs to set OWNER_PASSWORD (for one person), or OPEN_SIGNUP=true (for many).';
export const MIN_PASSWORD = 12;

/** One Durable Object per person. In many-user mode it is found by a hash of their Google id, so no email is kept. */
export const userIdFor = (env: AuthEnv, sub?: string) =>
  isSingleUser(env) ? 'owner' : createHash('sha256').update(`whatsapp-mcp:google:${sub ?? ''}`).digest('hex').slice(0, 32);

export const seatRegistry = (env: AuthEnv) => env.REGISTRY.get(env.REGISTRY.idFromName('seats'));

export const accountStub = (env: AuthEnv, userId: string) => env.WA.get(env.WA.idFromName(userId));

/** The same stub, unlocked with the person's data key. */
export async function unlockedStub(env: AuthEnv, who: Identity | { userId: string; dek: string }) {
  const stub = accountStub(env, who.userId);
  await stub.unlock(typeof who.dek === 'string' ? who.dek : who.dek.toString('base64'));
  return stub;
}

// ---------- sign-in steps that wait on a page ----------

/** Park what we need after sign-in, and return the URL that starts it. */
export async function startSignIn(env: AuthEnv, origin: string, pending: { oauth?: unknown }): Promise<string> {
  const id = randomId();
  await env.OAUTH_KV.put(`pending:${id}`, JSON.stringify(pending), { expirationTtl: 3600 });
  return `${origin}/login?p=${id}`;
}

export async function peekPending(env: AuthEnv, id: string): Promise<{ oauth?: any } | null> {
  const raw = await env.OAUTH_KV.get(`pending:${id}`);
  return raw ? JSON.parse(raw) : null;
}
export async function takePending(env: AuthEnv, id: string) {
  const p = await peekPending(env, id);
  if (p) await env.OAUTH_KV.delete(`pending:${id}`);
  return p;
}

// ---------- the single user's password ----------

export type Attempt = { ok: true; who: Identity; seats?: { taken: number; limit: number } } | { ok: false; error: string; status: number; full?: boolean };
const fail = (error: string, status = 401): Attempt => ({ ok: false, error, status });

let decoy: AccountRecord | null = null;

/** Check the single user's password, creating the account on its first sign-in. */
export async function signIn(env: AuthEnv, form: { password: string }, timezone: string): Promise<Attempt> {
  const { password } = form;
  if (!isSingleUser(env)) return fail(serverMode(env) === 'unset' ? NOT_SET_UP : 'This server signs in with Google.', serverMode(env) === 'unset' ? 503 : 403);
  const userId = userIdFor(env);
  const stub = accountStub(env, userId);

  const { record, retryAfter } = await stub.account();
  if (retryAfter > 0) return fail(`Too many wrong passwords. Try again in ${Math.ceil(retryAfter / 1000)} seconds.`, 429);

  if (!record) {
    if (env.OWNER_PASSWORD!.length >= MIN_PASSWORD && (await sameSecret(password, env.OWNER_PASSWORD!))) {
      const made = await createAccount(password);
      if (await stub.createAccount(made.record, env.TIMEZONE ?? timezone)) return { ok: true, who: { userId, dek: made.dek } };
      return signIn(env, form, timezone); // lost a race with another first sign-in; it exists now
    }
    // Spend the same time as a real check, so a missing account isn't distinguishable from a wrong password.
    decoy ??= (await createAccount('decoy')).record;
    await openAccount(password, decoy);
    await stub.noteLogin(false);
    return fail('Wrong password.');
  }

  const dek = await openAccount(password, record);
  await stub.noteLogin(Boolean(dek));
  return dek ? { ok: true, who: { userId, dek } } : fail('Wrong password.');
}

// ---------- signing in with the login service ----------

export const loginService = (env: AuthEnv) => (env.LOGIN_URL ?? 'https://login.finereli.com').replace(/\/+$/, '');

/** Where to send the browser: the login service, which returns to /auth/callback?p=<id> with a one-time code. */
export const loginServiceUrl = (env: AuthEnv, origin: string, p: string) =>
  `${loginService(env)}/start?return=${encodeURIComponent(`${origin}/auth/callback?p=${p}`)}`;

/** Trade the one-time code for who the person is and their data key. Null if the code is no good. */
export async function redeemLoginCode(env: AuthEnv, code: string): Promise<{ sub: string; key: string; email?: string } | null> {
  const res = await fetch(`${loginService(env)}/exchange`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ code, key: true }) });
  if (!res.ok) return null;
  const body = (await res.json()) as { key?: string; user?: { sub?: string; email?: string } };
  // the email is never stored with the account; it only fills in the waitlist form if the service is full
  return body.key && body.user?.sub ? { sub: body.user.sub, key: body.key, email: body.user.email } : null;
}

/** A person the login service vouched for: open their account, or make one if they are new and there is room. */
export async function signInWithLogin(env: AuthEnv, who: { sub: string; key: string }, timezone: string): Promise<Attempt> {
  if (serverMode(env) !== 'multi') return fail(isSingleUser(env) ? 'This server is for one person.' : NOT_SET_UP, 403);
  const userId = userIdFor(env, who.sub);
  const stub = accountStub(env, userId);
  const { record } = await stub.account();
  if (record) {
    const dek = await openAccount(who.key, record);
    return dek ? { ok: true, who: { userId, dek } } : fail('The login service gave a different key than this account was made with, so it can\'t be opened.', 403);
  }
  const limit = Number(env.SIGNUP_LIMIT) > 0 ? Number(env.SIGNUP_LIMIT) : 0;
  const registry = seatRegistry(env);
  const seat = await registry.claim(limit);
  if (!seat.ok) return { ok: false, error: `This service is full: it takes ${limit} people for now.`, status: 503, full: true };
  const made = await createAccount(who.key, KEY_STRETCH);
  if (!(await stub.createAccount(made.record, timezone))) {
    await registry.release(); // lost a race with another first sign-in; it exists now
    return signInWithLogin(env, who, timezone);
  }
  return { ok: true, who: { userId, dek: made.dek }, seats: { taken: seat.count, limit } };
}

// ---------- sessions: a token that carries the key ----------

const SESSION_KEY = 'sess:';

/** File the identity under a fresh token. The token is the only thing that can open the stored copy of the key. */
export async function mintSession(env: AuthEnv, who: Identity, ttlSeconds: number): Promise<string> {
  const { token, id } = newToken();
  await env.OAUTH_KV.put(SESSION_KEY + id, JSON.stringify({ u: who.userId, k: wrapForToken(token, who.dek) }), { expirationTtl: Math.max(60, ttlSeconds) });
  return token;
}

export async function readSession(env: AuthEnv, token: string | undefined): Promise<Identity | null> {
  if (!token) return null;
  const raw = await env.OAUTH_KV.get(SESSION_KEY + tokenId(token));
  if (!raw) return null;
  const { u, k } = JSON.parse(raw) as { u: string; k: string };
  const dek = unwrapForToken(token, k);
  return dek ? { userId: u, dek } : null;
}

// ---------- the browser ----------

export const SESSION_COOKIE = 'wa_session';
export const COOKIE_SECONDS = 14 * 86_400;
export const PAGE_SECONDS = 30 * 60;

export const sessionCookie = (value: string, maxAge: number) =>
  `${SESSION_COOKIE}=${value}; Path=/; Max-Age=${maxAge}; HttpOnly; Secure; SameSite=Lax`;
