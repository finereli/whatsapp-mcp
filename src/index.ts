/**
 * whatsapp-mcp - a read-only MCP server over your own WhatsApp history.
 *
 * OAuth (workers-oauth-provider) fronts /mcp. Approving a client means signing in (see auth.ts); if WhatsApp
 * isn't linked yet, the same flow continues into the pairing screen, so a first connection links the phone and
 * a later one just signs in. Each person's messages live in their own Durable Object, sealed with a key that
 * only their password can produce.
 */
import './polyfills.js';
import { OAuthProvider } from '@cloudflare/workers-oauth-provider';
import type { OAuthHelpers } from '@cloudflare/workers-oauth-provider';
import { WhatsAppStore } from './whatsapp-do.js';
import { handleMcp } from './mcp.js';
import { consentPage, fullPage, loginPage, messagePage, pairPage, waitlistDonePage, waitlistErrorPage } from './pages.js';
import { limitsOf } from './limits.js';
import { notify } from './notify.js';
import { xHandle } from './ui.js';
import { APPLE_TOUCH_ICON, FAVICON_32, FAVICON_SVG, SOCIAL_CARD } from './brand.js';
import { llmsTxt } from './landing.js';
import { landingPage } from './landing.js';
import { privacyPage } from './privacy.js';
import { tosPage } from './tos.js';
import {
  accountStub, signupLimitOf, COOKIE_SECONDS, isSingleUser, mintSession, NOT_SET_UP, seatRegistry, serverMode, PAGE_SECONDS, peekPending, readSession, sessionCookie, SESSION_COOKIE,
  loginServiceUrl, redeemLoginCode, signIn, signInWithLogin, startSignIn, takePending, unlockedStub,
  type AuthEnv, type Identity,
} from './auth.js';

export { WhatsAppStore };
export { Registry } from './registry.js';

export interface Env extends AuthEnv {
  OAUTH_PROVIDER: OAuthHelpers;
  /** Optional secret for machine access to /debug. 32+ random characters. */
  PIN?: string;
  /** Shown on the privacy page as who runs this server. Optional. */
  OPERATOR_NAME?: string;
  /** Country code (digits, no +) for phone numbers given without one, e.g. "972". */
  DEFAULT_COUNTRY_CODE?: string;
}

/** What an agent's token carries: who, and the key that opens their data. Encrypted by the OAuth library under the token. */
export interface McpProps { userId: string; dek: string }

const LOGIN_COOKIE = 'wa_login';
const html = (body: string, status = 200) => new Response(body, { status, headers: { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' } });
const json = (data: unknown, status = 200) => Response.json(data, { status, headers: { 'cache-control': 'no-store' } });
const b64 = (o: unknown) => btoa(JSON.stringify(o));
const unb64 = (s: string) => JSON.parse(atob(s));
const cookieValue = (r: Request, name: string) => r.headers.get('cookie')?.split(/;\s*/).find((c) => c.startsWith(`${name}=`))?.slice(name.length + 1);
const bearer = (r: Request) => r.headers.get('authorization')?.match(/^Bearer\s+(.+)$/i)?.[1];
const plain = (title: string, msg: string, status: number) => html(messagePage(title, msg), status);
const zone = (r: Request) => ((r as any).cf?.timezone as string | undefined) ?? 'UTC';
const EMAIL = /^[^\s@<>"]{1,64}@[^\s@<>"]+\.[^\s@<>"]{2,}$/;
const WAITLIST_SOURCES = new Set(['landing', 'sign-in', 'retry']);

/**
 * Is every seat taken? The front page asks on each visit, so the answer is kept for 30 seconds per isolate.
 * Signups and deletions in this isolate refresh it straight away.
 */
let seatCache: { at: number; taken: number } | null = null;
async function seatsFull(env: Env, limit: number): Promise<boolean> {
  if (!limit || serverMode(env) !== 'multi') return false;
  if (!seatCache || Date.now() - seatCache.at > 30_000) seatCache = { at: Date.now(), taken: await seatRegistry(env).count() };
  return seatCache.taken >= limit;
}
const noteSeats = (taken: number) => { seatCache = { at: Date.now(), taken }; };

function pinOk(request: Request, env: Env) {
  const sent = request.headers.get('x-pin');
  if (!sent || !env.PIN || env.PIN.length < 32 || sent.length !== env.PIN.length) return false;
  let diff = 0;
  for (let i = 0; i < sent.length; i++) diff |= sent.charCodeAt(i) ^ env.PIN.charCodeAt(i);
  return diff === 0;
}

async function completeOauth(env: Env, oauth: unknown, who: Identity) {
  const props: McpProps = { userId: who.userId, dek: who.dek.toString('base64') };
  const { redirectTo } = await env.OAUTH_PROVIDER.completeAuthorization({
    request: oauth as any, userId: who.userId, scope: ['whatsapp'], metadata: {}, props,
  });
  return redirectTo;
}

/** Signed in. Remember this browser, then finish the MCP grant if WhatsApp is linked, else go on to pairing. */
async function proceed(env: Env, pendingId: string, who: Identity): Promise<Response> {
  const pending = await takePending(env, pendingId);
  if (!pending) return plain('Sign-in expired', 'Start again from the app that asked.', 400);
  const cookie = await mintSession(env, who, COOKIE_SECONDS);
  const remember = (res: Response) => {
    const out = new Response(res.body, res);
    out.headers.append('set-cookie', sessionCookie(cookie, COOKIE_SECONDS));
    return out;
  };
  if (pending.oauth && (await (await unlockedStub(env, who)).isPaired())) {
    return remember(new Response(null, { status: 302, headers: { location: await completeOauth(env, pending.oauth, who) } }));
  }
  const pageToken = await mintSession(env, who, PAGE_SECONDS);
  return remember(html(pairPage(pageToken, pending.oauth ? b64(pending.oauth) : null)));
}

/** Tell the operator when signups get close to the cap, and when they hit it. */
async function milestone(env: Env, taken: number, limit: number) {
  if (!limit) return;
  if (taken === limit) await notify(env, 'whatsapp-mcp is full', `All ${limit} seats are taken. New people now see the waitlist instead of a signup, until someone leaves or you raise SIGNUP_LIMIT.`);
  else if (limit >= 5 && taken === Math.ceil(limit * 0.8)) await notify(env, 'whatsapp-mcp is filling up', `${taken} of ${limit} seats are taken.`);
}

const ownerHandler = {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    const path = url.pathname;
    const p = url.searchParams.get('p') ?? '';
    const single = isSingleUser(env);
    const hosted = serverMode(env) === 'multi';
    const contact = xHandle(env.CONTACT_X);
    const signupLimit = signupLimitOf(env);

    // Someone signed in lands on their dashboard. Everyone else gets the front page.
    if (path === '/') {
      const who = await readSession(env, cookieValue(request, SESSION_COOKIE));
      return html(who ? pairPage(await mintSession(env, who, PAGE_SECONDS), null) : landingPage(url.origin, hosted, { signupLimit, maxMessages: limitsOf(env).messages, contact, full: await seatsFull(env, signupLimit) }));
    }
    // The logo, and the plain-text page an assistant reads when someone pastes "set this up for me".
    const asset = (body: BodyInit, type: string) => new Response(body, { headers: { 'content-type': type, 'cache-control': 'public, max-age=86400' } });
    if (path === '/favicon.svg') return asset(FAVICON_SVG, 'image/svg+xml');
    if (path === '/favicon-32.png' || path === '/favicon.ico') return asset(FAVICON_32, 'image/png');
    if (path === '/apple-touch-icon.png') return asset(APPLE_TOUCH_ICON, 'image/png');
    if (path === '/og.png') return asset(SOCIAL_CARD, 'image/png');
    if (path === '/llms.txt') return new Response(llmsTxt(url.origin, hosted, await seatsFull(env, signupLimit)), { headers: { 'content-type': 'text/plain; charset=utf-8', 'cache-control': 'public, max-age=300' } });
    if (path === '/privacy') return html(privacyPage(env.OPERATOR_NAME, hosted, contact));
    if (path === '/tos') return html(tosPage(env.OPERATOR_NAME, hosted, contact));
    if (path === '/signout') return new Response(null, { status: 302, headers: { location: '/', 'set-cookie': sessionCookie('', 0) } });

    // An MCP client wants in: show who is asking, then send the person to sign in.
    if (path === '/authorize') {
      const oauth = await env.OAUTH_PROVIDER.parseAuthRequest(request);
      const client = await env.OAUTH_PROVIDER.lookupClient(oauth.clientId);
      return html(consentPage(client?.clientName ?? 'An app', await startSignIn(env, url.origin, { oauth }), await seatsFull(env, signupLimit), signupLimit));
    }
    if (path === '/setup') {
      return (await readSession(env, cookieValue(request, SESSION_COOKIE)))
        ? Response.redirect(`${url.origin}/`, 302)
        : Response.redirect(await startSignIn(env, url.origin, {}), 302);
    }

    if (path === '/login') {
      if (serverMode(env) === 'unset') return plain('Not set up', NOT_SET_UP, 503);
      if (!(await peekPending(env, p))) return plain('Sign-in expired', 'Start again from the setup page.', 400);
      if (!single) {
        // Many people: Google, through the login service. The cookie ties the way back to this browser, so a
        // link someone else started can't sign this one into their account.
        const res = new Response(null, { status: 302, headers: { location: loginServiceUrl(env, url.origin, p) } });
        res.headers.append('set-cookie', `${LOGIN_COOKIE}=${p}; Path=/auth; Max-Age=600; HttpOnly; Secure; SameSite=Lax`);
        return res;
      }
      const page = (error?: string) => loginPage(url.pathname + url.search, { error });
      if (request.method !== 'POST') return html(page());
      const r = await signIn(env, { password: String(((await request.formData()).get('password')) ?? '') }, zone(request));
      return r.ok ? proceed(env, p, r.who) : html(page(r.error), r.status);
    }

    // The login service sends the browser back here with a one-time code.
    if (path === '/auth/callback') {
      if (serverMode(env) !== 'multi') return plain('Not available', 'This server does not sign in with Google.', 404);
      if (cookieValue(request, LOGIN_COOKIE) !== p || !(await peekPending(env, p))) return plain('Sign-in expired', 'Start again from the app that asked.', 400);
      const code = url.searchParams.get('finereli_code');
      if (!code) return plain('Sign-in cancelled', 'Start again from the app that asked.', 400);
      const person = await redeemLoginCode(env, code);
      if (!person) return plain('Sign-in failed', 'The login service did not accept that sign-in. Start again from the app that asked.', 400);
      const r = await signInWithLogin(env, person, zone(request));
      if (!r.ok) {
        if (!r.full) return plain('Sign-in failed', r.error, r.status);
        noteSeats(signupLimit);
        return html(fullPage(signupLimit, contact, person.email), 503);
      }
      if (r.seats) { noteSeats(r.seats.taken); await milestone(env, r.seats.taken, r.seats.limit); }
      return proceed(env, p, r.who);
    }

    if (path.startsWith('/pair/')) {
      const who = await readSession(env, bearer(request));
      if (!who) return json({ error: 'unauthorized' }, 401);
      const wa = await unlockedStub(env, who);
      if (path === '/pair/status') return json(await wa.pairStatus());
      if (path === '/pair/start' && request.method === 'POST') {
        if (!(await wa.isPaired())) await wa.startPairing();
        return json({ ok: true });
      }
      if (path === '/pair/relink' && request.method === 'POST') {
        await wa.logout();
        return json({ ok: true });
      }
      if (path === '/pair/delete' && request.method === 'POST') {
        await wa.destroy();
        if (!single) {
          noteSeats(await seatRegistry(env).release()); // the seat goes back to the pool
        }
        // agents that were connected can't reach a store that no longer exists
        for (let cursor: string | undefined; ; ) {
          const page = await env.OAUTH_PROVIDER.listUserGrants(who.userId, { cursor });
          for (const g of page.items) await env.OAUTH_PROVIDER.revokeGrant(g.id, who.userId);
          if (!page.cursor) break;
          cursor = page.cursor;
        }
        return json({ ok: true }, 200);
      }
      if (path === '/pair/code' && request.method === 'POST') {
        const { phone } = (await request.json()) as { phone: string };
        try { return json({ code: await wa.requestPairingCode(phone) }); }
        catch (e: any) { return json({ error: e?.message ?? 'failed' }, 500); }
      }
      if (path === '/pair/finish' && request.method === 'POST') {
        const { req } = (await request.json()) as { req: string };
        return json({ redirectTo: await completeOauth(env, unb64(req), who) });
      }
    }

    // Someone who couldn't get a seat leaves an email. Only the operator sees the list (/debug?u=waitlist).
    if (path === '/waitlist' && request.method === 'POST' && hosted) {
      const form = await request.formData();
      if (String(form.get('website') ?? '')) return html(waitlistDonePage(true, contact)); // the field people can't see: a bot
      const email = String(form.get('email') ?? '').trim().toLowerCase();
      if (email.length > 254 || !EMAIL.test(email)) return html(waitlistErrorPage(contact), 400);
      const source = String(form.get('source') ?? '');
      const r = await seatRegistry(env).join(email, WAITLIST_SOURCES.has(source) ? source : 'landing');
      return html(waitlistDonePage(r.added, contact));
    }

    // What a deployment's operator can see without anyone's key: whether a session is running, and its log.
    if (path === '/debug') {
      if (!pinOk(request, env)) return new Response('unauthorized', { status: 401 });
      const registry = seatRegistry(env);
      if (url.searchParams.get('u') === 'seats') return json({ taken: await registry.count(), limit: signupLimit, waiting: await registry.waiting() });
      if (url.searchParams.get('u') === 'waitlist') {
        const email = url.searchParams.get('remove');
        if (email && request.method === 'POST') return json({ removed: await registry.unlist(email.toLowerCase()) });
        return json(await registry.waitlist());
      }
      return json(await accountStub(env, url.searchParams.get('u') ?? 'owner').debug());
    }

    return new Response('Not found', { status: 404 });
  },
};

const oauth = new OAuthProvider({
  apiRoute: '/mcp',
  apiHandler: { fetch: (request: Request, env: Env, ctx: ExecutionContext & { props: McpProps }) => handleMcp(request, env, ctx.props) } as any,
  defaultHandler: ownerHandler as any,
  authorizeEndpoint: '/authorize',
  tokenEndpoint: '/token',
  clientRegistrationEndpoint: '/register',
  scopesSupported: ['whatsapp'],
  refreshTokenTTL: 10 * 365 * 24 * 60 * 60,
});

export default {
  fetch: (request: Request, env: Env, ctx: ExecutionContext) => oauth.fetch(request, env, ctx),
  /**
   * Once a day, write the seat and waitlist counts to the log, where the operator (or their agent, through
   * Cloudflare's API) can read them without the PIN. Counts only.
   */
  async scheduled(_event: ScheduledController, env: Env) {
    if (serverMode(env) !== 'multi') return;
    const registry = seatRegistry(env);
    console.log(JSON.stringify({ stats: { taken: await registry.count(), limit: signupLimitOf(env), waiting: await registry.waiting() } }));
  },
};
