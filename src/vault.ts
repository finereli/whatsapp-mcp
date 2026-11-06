/**
 * Everything that touches keys. The rest of the code asks a Vault to seal and open things and never sees a key.
 *
 * The model, in short:
 *   - Each account has a random data key (DEK). The DEK encrypts the user's data. It is never stored in the clear.
 *   - A secret becomes a key-encryption key (KEK) through PBKDF2. The KEK wraps the DEK; only the wrapped copy is
 *     stored, in the account record. The secret is either a password (single-user copies: nothing else holds
 *     it, so the stored data is noise to everyone, the operator included) or a key from the login service (many
 *     users: the service's operator can derive it, but a leaked database or a look inside Cloudflare cannot).
 *   - A login yields the DEK for the length of a session. It rides inside the OAuth grant and the browser
 *     session, each encrypted under the token that holds it, and reaches the Durable Object with each request.
 *
 * What this does not protect against: an operator who deploys modified code can capture passwords as they are
 * typed, and the server handles plaintext while it answers a request. It is encryption at rest, not end-to-end.
 */
import { createCipheriv, createDecipheriv, createHash, createHmac, randomBytes, timingSafeEqual } from 'node:crypto';

const FORMAT = 1;
const NONCE = 12;
const TAG = 16;
export const KDF_ITERATIONS = 600_000;
/** A key handed over by the login service already has 256 bits of entropy, so there is nothing to stretch. */
export const KEY_STRETCH = 1;

const hmac = (key: Uint8Array, label: string) => createHmac('sha256', key).update(label).digest();
const toBuf = (x: ArrayBuffer | Uint8Array) => (x instanceof Uint8Array ? Buffer.from(x.buffer, x.byteOffset, x.byteLength) : Buffer.from(x));
/** What SqlStorage wants for a BLOB: a bare ArrayBuffer, not a view into a larger one. */
const toBlob = (b: Buffer): ArrayBuffer => b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) as ArrayBuffer;

function sealBytes(key: Buffer, plain: Buffer, aad: string): Buffer {
  const nonce = randomBytes(NONCE);
  const c = createCipheriv('aes-256-gcm', key, nonce);
  c.setAAD(Buffer.from(aad));
  const body = Buffer.concat([c.update(plain), c.final()]);
  return Buffer.concat([Buffer.from([FORMAT]), nonce, body, c.getAuthTag()]);
}

function openBytes(key: Buffer, blob: Buffer, aad: string): Buffer {
  if (blob.length < 1 + NONCE + TAG || blob[0] !== FORMAT) throw new Error('unrecognised ciphertext');
  const d = createDecipheriv('aes-256-gcm', key, blob.subarray(1, 1 + NONCE));
  d.setAAD(Buffer.from(aad));
  d.setAuthTag(blob.subarray(blob.length - TAG));
  return Buffer.concat([d.update(blob.subarray(1 + NONCE, blob.length - TAG)), d.final()]);
}

// ---------- accounts ----------

/** What the server stores about a login. Useless without the password. */
export interface AccountRecord {
  v: 1;
  iter: number;
  salt: string;      // base64
  verifier: string;  // base64 SHA-256 of the auth key, so a login can be checked without unwrapping
  wrapped: string;   // base64, the DEK sealed under the KEK
  created: number;
}

async function stretch(password: string, salt: Buffer, iterations: number) {
  const base = await crypto.subtle.importKey('raw', new TextEncoder().encode(password.normalize('NFKC')), 'PBKDF2', false, ['deriveBits']);
  const master = Buffer.from(await crypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt, iterations }, base, 256));
  // Two independent keys from one stretch: one wraps the DEK, one proves the password.
  return { kek: hmac(master, 'kek'), auth: hmac(master, 'auth') };
}

const verifierOf = (auth: Buffer) => createHash('sha256').update(auth).digest('base64');

export async function createAccount(password: string, iterations = KDF_ITERATIONS): Promise<{ record: AccountRecord; dek: Buffer }> {
  const salt = randomBytes(16);
  const dek = randomBytes(32);
  const { kek, auth } = await stretch(password, salt, iterations);
  const record: AccountRecord = {
    v: 1, iter: iterations, salt: salt.toString('base64'), verifier: verifierOf(auth),
    wrapped: sealBytes(kek, dek, 'dek').toString('base64'), created: Date.now(),
  };
  return { record, dek };
}

/** The DEK if the password is right, otherwise null. */
export async function openAccount(password: string, record: AccountRecord): Promise<Buffer | null> {
  const { kek, auth } = await stretch(password, Buffer.from(record.salt, 'base64'), record.iter);
  const a = Buffer.from(verifierOf(auth)), b = Buffer.from(record.verifier);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;
  try { return openBytes(kek, Buffer.from(record.wrapped, 'base64'), 'dek'); } catch { return null; }
}

/** Change the password: same DEK, new wrapping. Null if the old password is wrong. */
export async function rewrap(oldPassword: string, newPassword: string, record: AccountRecord): Promise<AccountRecord | null> {
  const dek = await openAccount(oldPassword, record);
  if (!dek) return null;
  const salt = randomBytes(16);
  const { kek, auth } = await stretch(newPassword, salt, KDF_ITERATIONS);
  return { ...record, iter: KDF_ITERATIONS, salt: salt.toString('base64'), verifier: verifierOf(auth), wrapped: sealBytes(kek, dek, 'dek').toString('base64') };
}

// ---------- the vault ----------

export class Vault {
  private enc: Buffer;
  private ids: Buffer;
  private memo = new Map<string, string>();
  private bitsMemo = new Map<string, Uint32Array>();
  private readonly words: Buffer;
  readonly fingerprint: string;

  constructor(dek: Uint8Array) {
    const k = Buffer.from(dek);
    if (k.length !== 32) throw new Error('bad key');
    this.enc = hmac(k, 'enc');
    this.ids = hmac(k, 'ids');
    this.words = hmac(k, 'search-words');
    this.fingerprint = hmac(k, 'fingerprint').toString('base64').slice(0, 12);
  }

  static fromBase64(s: string) { return new Vault(Buffer.from(s, 'base64')); }

  /** Encrypt a value. `aad` names what the ciphertext is for, so a blob can't be passed off as another kind. */
  seal(value: unknown, aad: string): ArrayBuffer {
    return toBlob(sealBytes(this.enc, Buffer.from(JSON.stringify(value)), aad));
  }
  open<T = any>(blob: ArrayBuffer | Uint8Array, aad: string): T {
    return JSON.parse(openBytes(this.enc, toBuf(blob), aad).toString('utf8'));
  }

  /**
   * Where a search word goes in a block's Bloom filter: `k` bit positions out of `bits`, from a keyed hash, so
   * without this user's key the filter can't be tested for any word. Memoized, since vocabularies repeat.
   */
  wordBits(word: string, k: number, bits: number): Uint32Array {
    let v = this.bitsMemo.get(word);
    if (v === undefined) {
      const h = hmac(this.words, word);
      v = new Uint32Array(k);
      for (let i = 0; i < k; i++) v[i] = h.readUInt32LE(i * 4) % bits;
      if (this.bitsMemo.size > 100_000) this.bitsMemo.clear();
      this.bitsMemo.set(word, v);
    }
    return v;
  }

  /**
   * A stable, opaque stand-in for an identifier (a phone number, a chat). Equal inputs give equal outputs, so
   * SQL can still join and group on it, but the stored value says nothing about who it is.
   */
  pid(kind: string, value: string): string {
    const k = `${kind}\0${value}`;
    let v = this.memo.get(k);
    if (v === undefined) {
      v = hmac(this.ids, k).subarray(0, 16).toString('hex');
      if (this.memo.size > 50_000) this.memo.clear();
      this.memo.set(k, v);
    }
    return v;
  }
}

// ---------- tokens that carry a DEK ----------

const b64url = (b: Buffer) => b.toString('base64url');

/** A random bearer token, and the id to file it under (so the token itself is never stored). */
export function newToken(): { token: string; id: string } {
  const token = b64url(randomBytes(32));
  return { token, id: tokenId(token) };
}
export const tokenId = (token: string) => createHash('sha256').update(token).digest('hex');

/** Wrap a DEK so that only the holder of `token` can unwrap it. */
export function wrapForToken(token: string, dek: Buffer): string {
  return sealBytes(hmac(Buffer.from(token), 'token-key'), dek, 'session').toString('base64');
}
export function unwrapForToken(token: string, wrapped: string): Buffer | null {
  try { return openBytes(hmac(Buffer.from(token), 'token-key'), Buffer.from(wrapped, 'base64'), 'session'); } catch { return null; }
}
