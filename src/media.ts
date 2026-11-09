/**
 * Media download: fetch a message's encrypted file from WhatsApp's CDN and decrypt it with the key kept in the
 * sealed message. Nothing is downloaded until an agent asks, and nothing downloaded is stored.
 *
 * The format is WhatsApp's: HKDF-SHA256 expands the 32-byte media key (zero salt, info by media type) into an IV,
 * an AES-256-CBC key and an HMAC-SHA256 key. The file is the ciphertext followed by the first 10 bytes of
 * HMAC(iv || ciphertext). WebCrypto does all of it, so it runs the same on Workers and under local workerd.
 */
import type { MediaKind, MediaRef } from './store.js';

const INFO: Record<MediaKind, string> = {
  image: 'WhatsApp Image Keys',
  sticker: 'WhatsApp Image Keys',
  video: 'WhatsApp Video Keys',
  audio: 'WhatsApp Audio Keys',
  document: 'WhatsApp Document Keys',
};
const CDN = 'https://mmg.whatsapp.net';
const MAC_LEN = 10;

export type Download = { ok: true; bytes: Uint8Array } | { ok: false; expired: boolean; error: string };

const mb = (n: number) => `${(n / 1024 / 1024).toFixed(1)} MB`;

async function keysOf(mediaKey: Uint8Array, kind: MediaKind) {
  const base = await crypto.subtle.importKey('raw', mediaKey, 'HKDF', false, ['deriveBits']);
  const info = new TextEncoder().encode(INFO[kind]);
  const bits = new Uint8Array(await crypto.subtle.deriveBits({ name: 'HKDF', hash: 'SHA-256', salt: new Uint8Array(32), info }, base, 112 * 8));
  return { iv: bits.slice(0, 16), cipherKey: bits.slice(16, 48), macKey: bits.slice(48, 80) };
}

/** Check and decrypt a downloaded file. Exported for the tests. */
export async function decryptMedia(file: Uint8Array, mediaKey: Uint8Array, kind: MediaKind): Promise<Uint8Array | null> {
  if (file.length <= MAC_LEN) return null;
  const { iv, cipherKey, macKey } = await keysOf(mediaKey, kind);
  const body = file.subarray(0, file.length - MAC_LEN);
  const signed = new Uint8Array(iv.length + body.length);
  signed.set(iv);
  signed.set(body, iv.length);
  const hmac = await crypto.subtle.importKey('raw', macKey, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const mac = new Uint8Array(await crypto.subtle.sign('HMAC', hmac, signed)).subarray(0, MAC_LEN);
  const want = file.subarray(file.length - MAC_LEN);
  if (!mac.every((x, i) => x === want[i])) return null;
  try {
    const aes = await crypto.subtle.importKey('raw', cipherKey, 'AES-CBC', false, ['decrypt']);
    return new Uint8Array(await crypto.subtle.decrypt({ name: 'AES-CBC', iv }, aes, body));
  } catch {
    return null;
  }
}

/** Fetch and decrypt. `expired` means WhatsApp no longer has the file, and asking the phone to upload it again may help. */
export async function downloadMedia(ref: MediaRef, maxBytes: number): Promise<Download> {
  if (ref.len && ref.len > maxBytes) return { ok: false, expired: false, error: `the file is ${mb(ref.len)}, over the ${mb(maxBytes)} limit` };
  const url = ref.path ? `${CDN}${ref.path}` : ref.url;
  if (!url) return { ok: false, expired: true, error: 'no download location is stored' };
  const res = await fetch(url, { headers: { Origin: 'https://web.whatsapp.com' } });
  if (res.status === 404 || res.status === 410) return { ok: false, expired: true, error: `WhatsApp's copy has expired (${res.status})` };
  if (!res.ok) return { ok: false, expired: false, error: `the download failed (${res.status})` };
  const declared = Number(res.headers.get('content-length') ?? 0);
  if (declared > maxBytes + 32) return { ok: false, expired: false, error: `the file is ${mb(declared)}, over the ${mb(maxBytes)} limit` };
  const bytes = await decryptMedia(new Uint8Array(await res.arrayBuffer()), Buffer.from(ref.key, 'base64'), ref.k);
  return bytes ? { ok: true, bytes } : { ok: false, expired: false, error: 'the file failed its integrity check' };
}
