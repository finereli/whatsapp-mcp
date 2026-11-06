/**
 * Search without decrypting every message.
 *
 * Message text is encrypted, so the database can't search it, and the first version decrypted the whole
 * history on every search. Now each chat's timeline is cut into blocks of about BLOCK messages, and each block
 * has a Bloom filter: a 2 KB bit array with a few bits set for every word in it. The bit positions come from a
 * keyed hash (Vault.wordBits), so the filter can only be tested by someone holding this user's key.
 *
 * A search hashes its words the same way and looks at each block's bits. A bit that is off means the word is
 * not in that block, certainly, so the block is skipped unread. All bits on means it probably is, so the block
 * is decrypted and checked properly. A rare word reads a percent or two of the history instead of all of it.
 *
 * What the filter shows without the key: roughly how many distinct words a block has. Not which ones, and not
 * how often. Bits are only ever added: an edit adds its new words, a deletion leaves the old ones. Stale bits
 * can only cause an extra block to be read, never a missed match.
 *
 * Matching is by whole word (see parseQuery), so the filter holds words, plus each word's first 1-4 letters
 * for `word*` prefix searches. A block covers its chat from its `start` up to the next block's start, so
 * history arriving out of order still has exactly one block to go in.
 */
import type { Vault } from './vault.js';

export const BLOCK = 128;      // a chat's newest block takes this many messages before a new one starts
const SPLIT = BLOCK * 2;       // an older block that grows past this (history filling in) is rebuilt smaller
export const BITS = 16_384;    // 2 KB per block
export const K = 4;            // bits per word
const PREFIX = 4;              // longest prefix stored for word* searches

export const fold = (s: string) => s.normalize('NFKD').replace(/\p{M}/gu, '').toLowerCase();
export const words = (s: string) => fold(s).match(/[\p{L}\p{N}]+/gu) ?? [];

/** What goes in a block's filter for one message: each word, and its first 1-4 letters. */
export function entriesOf(text: string): Set<string> {
  const out = new Set<string>();
  for (const w of words(text)) {
    out.add('w:' + w);
    for (let l = 1; l <= Math.min(PREFIX, w.length); l++) out.add('p:' + w.slice(0, l));
  }
  return out;
}

/** What a block must hold for a query to match anything in it: every word of every term. */
export function needsOf(terms: { tokens: string[]; prefix: boolean }[]): string[] {
  const out: string[] = [];
  for (const t of terms) t.tokens.forEach((tok, j) => out.push(j === t.tokens.length - 1 && t.prefix ? 'p:' + tok.slice(0, PREFIX) : 'w:' + tok));
  return out;
}

type Block = { blk: number; chat: string; start: number; last: number; n: number };

/** A block a search should read: its chat and time range, and which queries might match in it. */
export interface Candidate { chat: string; from: number; to: number; last: number; queries: number[] }

const toBlob = (b: Uint8Array) => b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) as ArrayBuffer;
const FIRST = Number.MIN_SAFE_INTEGER, END = Number.MAX_SAFE_INTEGER;

export class SearchIndex {
  private isReady: boolean | null = null;
  private lists = new Map<string, Block[]>();          // a chat's blocks, by start, while a batch is open
  private dirty = new Map<Block, Uint8Array>();         // filters changed in this batch, written by flush()

  /** `text` decrypts a stored message to its searchable text. */
  constructor(private sql: SqlStorage, private vault: Vault, private text: (data: ArrayBuffer) => string) {}

  /** Built yet? A store from before the index has none until its first search builds it. */
  ready(): boolean {
    this.isReady ??= this.sql.exec<{ v: string }>(`SELECT v FROM meta WHERE k = 'search_index'`).toArray()[0]?.v === '1';
    return this.isReady;
  }

  reset() { this.isReady = null; this.lists.clear(); this.dirty.clear(); }

  private bits(entry: string) { return this.vault.wordBits(entry, K, BITS); }

  private blocksOf(chat: string): Block[] {
    let list = this.lists.get(chat);
    if (!list) {
      list = this.sql.exec<Block>(`SELECT blk, chat, start, last, n FROM search_blocks WHERE chat = ? ORDER BY start`, chat).toArray();
      this.lists.set(chat, list);
    }
    return list;
  }

  private filterOf(b: Block): Uint8Array {
    let f = this.dirty.get(b);
    if (!f) {
      const row = b.blk ? this.sql.exec<{ bloom: ArrayBuffer }>(`SELECT bloom FROM search_blocks WHERE blk = ?`, b.blk).toArray()[0] : undefined;
      f = row ? new Uint8Array(row.bloom.slice(0)) : new Uint8Array(BITS / 8);
      this.dirty.set(b, f);
    }
    return f;
  }

  private mark(f: Uint8Array, text: string) {
    for (const e of entriesOf(text)) for (const bit of this.bits(e)) f[bit >> 3] |= 1 << (bit & 7);
  }

  /** Note a stored message's words. Inside a batch; call flush() at its end. */
  add(chat: string, ts: number, text: string) {
    if (!this.ready()) return; // the first search builds everything
    const list = this.blocksOf(chat);
    let i = list.length - 1;
    while (i >= 0 && list[i].start > ts) i--;
    let b: Block;
    if (i < 0) {
      if (list.length) { b = list[0]; b.start = ts; } // older than anything: stretch the first block back
      else { b = { blk: 0, chat, start: ts, last: ts, n: 0 }; list.push(b); }
    } else {
      b = list[i];
      // the newest block is full and this is newer than all of it: start the next block
      if (i === list.length - 1 && b.n >= BLOCK && ts > b.last) { b = { blk: 0, chat, start: ts, last: ts, n: 0 }; list.push(b); }
    }
    this.mark(this.filterOf(b), text);
    b.n++;
    b.last = Math.max(b.last, ts);
  }

  /** Write what add() changed, and split any block that history has overfilled. */
  flush() {
    const split: Block[] = [];
    for (const [b, f] of this.dirty) {
      if (b.blk) this.sql.exec(`UPDATE search_blocks SET start = ?, last = ?, n = ?, bloom = ? WHERE blk = ?`, b.start, b.last, b.n, toBlob(f), b.blk);
      else this.sql.exec(`INSERT INTO search_blocks (chat, start, last, n, bloom) VALUES (?, ?, ?, ?, ?)`, b.chat, b.start, b.last, b.n, toBlob(f));
      if (b.n > SPLIT) split.push(b);
    }
    this.dirty.clear();
    for (const b of split) {
      const list = this.blocksOf(b.chat);
      const next = list[list.indexOf(b) + 1]?.start ?? END;
      this.rebuild(b.chat, b.start, next);
    }
    this.lists.clear();
  }

  /** Recut one chat's range [from, to) into fresh blocks, from the messages themselves. */
  private rebuild(chat: string, from: number, to: number) {
    this.sql.exec(`DELETE FROM search_blocks WHERE chat = ? AND start >= ? AND start < ?`, chat, from, to);
    const rows = this.sql.exec<{ ts: number; data: ArrayBuffer }>(`SELECT ts, data FROM messages WHERE chat = ? AND ts >= ? AND ts < ? ORDER BY ts`, chat, from, to).toArray();
    this.cut(chat, rows, from === FIRST ? null : from);
  }

  /** Turn one chat's messages, oldest first, into blocks of about BLOCK, never splitting a timestamp. */
  private cut(chat: string, rows: Iterable<{ ts: number; data: ArrayBuffer }>, firstStart: number | null) {
    let f: Uint8Array | null = null, start = 0, last = 0, n = 0;
    const put = () => { if (f) this.sql.exec(`INSERT INTO search_blocks (chat, start, last, n, bloom) VALUES (?, ?, ?, ?, ?)`, chat, start, last, n, toBlob(f)); };
    for (const r of rows) {
      if (!f || (n >= BLOCK && r.ts > last)) {
        put();
        // the first block keeps the range's start, so the range stays covered from where it began
        start = !f && firstStart !== null ? firstStart : r.ts;
        f = new Uint8Array(BITS / 8);
        n = 0;
      }
      this.mark(f, this.text(r.data));
      n++;
      last = r.ts;
    }
    put();
  }

  /** Recut a whole chat, e.g. after another chat's messages were merged into it. */
  rebuildChat(chat: string) {
    if (!this.ready()) return;
    this.lists.delete(chat);
    this.rebuild(chat, FIRST, END);
  }

  /** Forget a chat's blocks, e.g. when it is merged away. */
  dropChat(chat: string) {
    this.lists.delete(chat);
    this.sql.exec(`DELETE FROM search_blocks WHERE chat = ?`, chat);
  }

  /** Build the whole index from what is stored: one full read, once. */
  build() {
    this.sql.exec(`DELETE FROM search_blocks`);
    const chats = this.sql.exec<{ chat: string }>(`SELECT chat FROM chat_stats`).toArray();
    for (const { chat } of chats) {
      this.cut(chat, this.sql.exec<{ ts: number; data: ArrayBuffer }>(`SELECT ts, data FROM messages WHERE chat = ? ORDER BY ts`, chat).toArray(), null);
    }
    this.sql.exec(`INSERT OR REPLACE INTO meta (k, v) VALUES ('search_index', '1')`);
    this.reset();
  }

  /**
   * The blocks worth reading for these queries (each a list of needed entries), newest first. Reads one row
   * per block, which is a hundredth of reading the messages.
   */
  candidates(o: { chat?: string; since?: number; until?: number; needs: string[][] }): Candidate[] {
    const wanted = o.needs.map((n) => n.map((e) => this.bits(e)));
    const rows = o.chat
      ? this.sql.exec<Block & { bloom: ArrayBuffer }>(`SELECT blk, chat, start, last, n, bloom FROM search_blocks WHERE chat = ? ORDER BY start`, o.chat).toArray()
      : this.sql.exec<Block & { bloom: ArrayBuffer }>(`SELECT blk, chat, start, last, n, bloom FROM search_blocks ORDER BY chat, start`).toArray();
    const out: Candidate[] = [];
    for (let i = 0; i < rows.length; i++) {
      const r = rows[i];
      const to = rows[i + 1]?.chat === r.chat ? rows[i + 1].start : END;
      if ((o.since && r.last < o.since) || (o.until && r.start > o.until)) continue;
      const f = new Uint8Array(r.bloom);
      const queries: number[] = [];
      wanted.forEach((need, q) => { if (need.every((bits) => bits.every((bit) => f[bit >> 3] & (1 << (bit & 7))))) queries.push(q); });
      if (queries.length) out.push({ chat: r.chat, from: i > 0 && rows[i - 1].chat === r.chat ? r.start : FIRST, to, last: r.last, queries });
    }
    return out.sort((a, b) => b.last - a.last);
  }
}
