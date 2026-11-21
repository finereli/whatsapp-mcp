/**
 * Counts how many accounts exist, so signups can be capped. One object for the whole service, because a
 * counter that two signups can read at once is not a cap. Deleting an account gives its seat back.
 * It also keeps the waitlist: emails of people who wanted in while every seat was taken, and how many accounts
 * were made and deleted each day (counts only, nothing about who).
 */
import { DurableObject } from 'cloudflare:workers';

export class Registry extends DurableObject {
  constructor(ctx: DurableObjectState, env: unknown) {
    super(ctx, env as never);
    ctx.storage.sql.exec(`CREATE TABLE IF NOT EXISTS seats (k TEXT PRIMARY KEY, n INTEGER NOT NULL)`);
    ctx.storage.sql.exec(`CREATE TABLE IF NOT EXISTS days (day TEXT PRIMARY KEY, joined INTEGER NOT NULL DEFAULT 0, left INTEGER NOT NULL DEFAULT 0)`);
    ctx.storage.sql.exec(`CREATE TABLE IF NOT EXISTS waitlist (email TEXT PRIMARY KEY, at INTEGER NOT NULL, source TEXT NOT NULL)`);
  }

  count(): number {
    return this.ctx.storage.sql.exec<{ n: number }>(`SELECT n FROM seats WHERE k = 'taken'`).toArray()[0]?.n ?? 0;
  }

  /**
   * Every account ever made, deleted ones included. Counting started 2026-11-21; it began at the seats taken then
   * plus the deletions recorded in `days` (from 2026-11-10), so it misses the few deletions before that.
   */
  signups(): number {
    const sql = this.ctx.storage.sql;
    const row = sql.exec<{ n: number }>(`SELECT n FROM seats WHERE k = 'signups'`).toArray()[0];
    if (row) return row.n;
    const left = sql.exec<{ n: number }>(`SELECT COALESCE(SUM(left), 0) AS n FROM days`).toArray()[0].n;
    const n = this.count() + left;
    sql.exec(`INSERT INTO seats (k, n) VALUES ('signups', ?)`, n);
    return n;
  }

  /** Take a seat. `limit` 0 means no cap, but the seat is still counted. */
  claim(limit: number): { ok: boolean; count: number; signups: number } {
    const n = this.count();
    if (limit > 0 && n >= limit) return { ok: false, count: n, signups: this.signups() };
    const signups = this.signups() + 1;
    this.ctx.storage.sql.exec(`INSERT OR REPLACE INTO seats (k, n) VALUES ('taken', ?)`, n + 1);
    this.ctx.storage.sql.exec(`INSERT OR REPLACE INTO seats (k, n) VALUES ('signups', ?)`, signups);
    this.tally('joined', 1);
    return { ok: true, count: n + 1, signups };
  }

  /** Give a seat back. `undo` is a claim that didn't end in an account, so it shouldn't count as a signup or a leave. */
  release(undo = false): number {
    const n = Math.max(0, this.count() - 1);
    this.ctx.storage.sql.exec(`INSERT OR REPLACE INTO seats (k, n) VALUES ('taken', ?)`, n);
    if (undo) {
      this.tally('joined', -1);
      this.ctx.storage.sql.exec(`INSERT OR REPLACE INTO seats (k, n) VALUES ('signups', ?)`, Math.max(0, this.signups() - 1));
    } else this.tally('left', 1);
    return n;
  }

  private tally(col: 'joined' | 'left', by: number) {
    const day = new Date().toISOString().slice(0, 10);
    this.ctx.storage.sql.exec(`INSERT INTO days (day, ${col}) VALUES (?, ?) ON CONFLICT(day) DO UPDATE SET ${col} = ${col} + excluded.${col}`, day, by);
  }

  /** Accounts made and deleted per UTC day, newest first. Counting started 2026-11-10; earlier days aren't there. */
  days(limit = 90): { day: string; joined: number; left: number }[] {
    return this.ctx.storage.sql.exec<{ day: string; joined: number; left: number }>(`SELECT day, joined, left FROM days ORDER BY day DESC LIMIT ?`, limit).toArray();
  }

  /** Add someone to the waitlist. `added` is false if they were already on it. `waiting` is the list's length. */
  join(email: string, source: string): { added: boolean; waiting: number } {
    const sql = this.ctx.storage.sql;
    const c = sql.exec(`INSERT OR IGNORE INTO waitlist (email, at, source) VALUES (?, ?, ?)`, email, Date.now(), source);
    c.toArray(); // a cursor counts rows as it is read
    const added = c.rowsWritten > 0;
    return { added, waiting: this.waiting() };
  }

  waiting(): number {
    return this.ctx.storage.sql.exec<{ n: number }>(`SELECT COUNT(*) AS n FROM waitlist`).toArray()[0]?.n ?? 0;
  }

  /** Oldest first, so whoever asked first gets the next seat. */
  waitlist(): { email: string; at: string; source: string }[] {
    return this.ctx.storage.sql.exec<{ email: string; at: number; source: string }>(`SELECT email, at, source FROM waitlist ORDER BY at`)
      .toArray().map((r) => ({ email: r.email, at: new Date(r.at).toISOString(), source: r.source }));
  }

  /** Take someone off the list, e.g. once they've been let in. */
  unlist(email: string): boolean {
    const c = this.ctx.storage.sql.exec(`DELETE FROM waitlist WHERE email = ?`, email);
    c.toArray();
    return c.rowsWritten > 0;
  }
}
