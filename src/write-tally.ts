/**
 * Counts SQLite rows written during a pull, by table, and by key type for WhatsApp's session keys.
 * Writes are what this server pays for, so a pull logs one line with the tally (labels and counts, no data).
 */
export class WriteTally {
  private by: Record<string, number> = {};
  private seen = new Set<string>();

  add(label: string, n: number) {
    if (n > 0) this.by[label] = (this.by[label] ?? 0) + n;
  }

  /** Count `label` once per distinct `key` until the next take(): how many different keys a pull touched. */
  once(label: string, key: string) {
    if (this.seen.has(`${label}\0${key}`)) return;
    this.seen.add(`${label}\0${key}`);
    this.add(label, 1);
  }

  /** The counts so far, largest first, and start again. */
  take(): Record<string, number> {
    const out = Object.fromEntries(Object.entries(this.by).sort((a, b) => b[1] - a[1]));
    this.by = {};
    this.seen.clear();
    return out;
  }
}

const TABLE = /^\s*(?:INSERT(?:\s+OR\s+\w+)?\s+INTO|REPLACE\s+INTO|UPDATE(?:\s+OR\s+\w+)?|DELETE\s+FROM)\s+(\w+)/i;

/** A SqlStorage that tallies rows written by every statement under the table it writes to (triggers included). */
export function countingSql(sql: SqlStorage, tally: WriteTally): SqlStorage {
  return new Proxy(sql, {
    get(target, prop, receiver) {
      if (prop !== 'exec') {
        const v = Reflect.get(target, prop, target);
        return typeof v === 'function' ? v.bind(target) : v;
      }
      return (query: string, ...bindings: any[]) => {
        const cursor = target.exec(query, ...bindings);
        const m = TABLE.exec(query);
        if (m) tally.add(m[1].toLowerCase(), cursor.rowsWritten);
        return cursor;
      };
    },
  });
}

/** `session-123.0` → `session`, `app-state-sync-version-regular` → `app-state-sync-version`, `creds` → `creds`. */
export const keyType = (k: string) => {
  const types = ['app-state-sync-version', 'app-state-sync-key', 'sender-key-memory', 'sender-key', 'pre-key', 'session', 'device-list', 'lid-mapping', 'tctoken', 'creds'];
  return types.find((t) => k === t || k.startsWith(`${t}-`)) ?? 'other';
};
