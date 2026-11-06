/**
 * Counts how many accounts exist, so signups can be capped. One object for the whole service, because a
 * counter that two signups can read at once is not a cap. Deleting an account gives its seat back.
 * It also keeps the waitlist: emails of people who wanted in while every seat was taken.
 */
import { DurableObject } from 'cloudflare:workers';

export class Registry extends DurableObject {
  constructor(ctx: DurableObjectState, env: unknown) {
    super(ctx, env as never);
    ctx.storage.sql.exec(`CREATE TABLE IF NOT EXISTS seats (k TEXT PRIMARY KEY, n INTEGER NOT NULL)`);
    ctx.storage.sql.exec(`CREATE TABLE IF NOT EXISTS waitlist (email TEXT PRIMARY KEY, at INTEGER NOT NULL, source TEXT NOT NULL)`);
  }

  count(): number {
    return this.ctx.storage.sql.exec<{ n: number }>(`SELECT n FROM seats WHERE k = 'taken'`).toArray()[0]?.n ?? 0;
  }

  /** Take a seat. `limit` 0 means no cap, but the seat is still counted. */
  claim(limit: number): { ok: boolean; count: number } {
    const n = this.count();
    if (limit > 0 && n >= limit) return { ok: false, count: n };
    this.ctx.storage.sql.exec(`INSERT OR REPLACE INTO seats (k, n) VALUES ('taken', ?)`, n + 1);
    return { ok: true, count: n + 1 };
  }

  release(): number {
    const n = Math.max(0, this.count() - 1);
    this.ctx.storage.sql.exec(`INSERT OR REPLACE INTO seats (k, n) VALUES ('taken', ?)`, n);
    return n;
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
