/** Baileys auth state backed by the Durable Object's SQLite, replacing useMultiFileAuthState. Sealed with the user's Vault. */
import { initAuthCreds, BufferJSON, proto } from '@whiskeysockets/baileys';
import type { AuthenticationCreds, AuthenticationState, SignalDataTypeMap } from '@whiskeysockets/baileys';
import type { Vault } from './vault.js';
import { keyType, type WriteTally } from './write-tally.js';

const AAD = 'a';

/**
 * Session keys are named after the people they talk to (`session-<number>.0`), so the names are pseudonyms
 * too, not just the values. `onPaired` hears when the link appears or goes away, so a caller can remember it
 * without a key.
 */
export function sqliteAuthState(sql: SqlStorage, vault: Vault, onPaired: (paired: boolean) => void = () => {}, tally?: WriteTally) {
  const row = (k: string) => vault.pid('auth', k);

  const read = (k: string) => {
    const r = sql.exec<{ data: ArrayBuffer }>(`SELECT data FROM auth WHERE k = ?`, row(k)).toArray()[0];
    return r ? JSON.parse(vault.open<string>(r.data, AAD), BufferJSON.reviver) : null;
  };
  const write = (k: string, value: unknown) => {
    const json = JSON.stringify(value, BufferJSON.replacer);
    if (tally) {
      // measuring: how many of these rewrites store what was already there
      const r = sql.exec<{ data: ArrayBuffer }>(`SELECT data FROM auth WHERE k = ?`, row(k)).toArray()[0];
      tally.add(r && vault.open<string>(r.data, AAD) === json ? `same:${keyType(k)}` : `new:${keyType(k)}`, 1);
      tally.once(`uniq:${keyType(k)}`, k); // fewer distinct keys than writes: batching them would save the difference
    }
    const c = sql.exec(`INSERT OR REPLACE INTO auth (k, data) VALUES (?, ?)`, row(k), vault.seal(json, AAD));
    tally?.add(`key:${keyType(k)}`, c.rowsWritten);
  };
  const remove = (k: string) => {
    const c = sql.exec(`DELETE FROM auth WHERE k = ?`, row(k));
    tally?.add(`key:${keyType(k)}`, c.rowsWritten);
  };

  const creds: AuthenticationCreds = read('creds') ?? initAuthCreds();

  const state: AuthenticationState = {
    creds,
    keys: {
      get: async <T extends keyof SignalDataTypeMap>(type: T, ids: string[]) => {
        const out: { [id: string]: SignalDataTypeMap[T] } = {};
        for (const id of ids) {
          let value = read(`${type}-${id}`);
          if (type === 'app-state-sync-key' && value) value = proto.Message.AppStateSyncKeyData.fromObject(value);
          if (value) out[id] = value;
        }
        return out;
      },
      set: async (data) => {
        for (const [type, entries] of Object.entries(data)) {
          for (const [id, value] of Object.entries(entries ?? {})) {
            if (value) write(`${type}-${id}`, value);
            else remove(`${type}-${id}`);
          }
        }
      },
    },
  };

  // QR pairing never sets `registered` (that's the mobile flow); `me` is the signal
  const isPaired = () => Boolean(creds.me?.id);
  onPaired(isPaired());

  return {
    state,
    saveCreds: async () => { write('creds', creds); onPaired(isPaired()); },
    clear: () => {
      sql.exec(`DELETE FROM auth`);
      // Baileys holds this object; reset it in place so a fresh pairing starts clean
      for (const k of Object.keys(creds)) delete (creds as any)[k];
      Object.assign(creds, initAuthCreds());
      onPaired(false);
    },
    isPaired,
  };
}
