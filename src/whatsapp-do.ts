/**
 * WhatsAppStore - the paired WhatsApp session and message store, one per user.
 *
 * Everything the user owns is sealed with their data key, which this object only ever holds in memory:
 * the Worker passes it to unlock() at the start of each request and it is gone when the object is evicted.
 * Only a few things need no key: the account record (a wrapped key, useless without the password), login
 * throttling, and flags like "is a phone linked".
 *
 * Pull model: nothing stays connected. pull() opens a Baileys socket, lets
 * WhatsApp deliver whatever it queued for this linked device since we last
 * connected, writes it to SQLite, and hangs up. Pairing is the same session
 * with the QR exposed and a longer leash, so the first full history sync lands.
 */
import { liveIntervals } from './polyfills.js';
import { DurableObject } from 'cloudflare:workers';
import { makeWASocket, DisconnectReason } from '@whiskeysockets/baileys';
import type { WASocket } from '@whiskeysockets/baileys';
import qrcode from 'qrcode-generator';
import { sqliteAuthState } from './auth-state.js';
import { Store, hasSchema, initSchema, isLeftover, isLegacy, migrateLegacy } from './store.js';
import { Vault } from './vault.js';
import { limitsOf, verdict } from './limits.js';
import { contactText, xHandle } from './ui.js';
import type { AccountRecord } from './vault.js';
import type { Env } from './index.js';

type Phase = 'idle' | 'connecting' | 'qr' | 'syncing';
export interface SessionResult { reason: string; added: number; ms: number }

const PAIR_MAX_MS = 10 * 60_000;
const PAIR_ABANDON_MS = 3 * 60_000;
const PULL_MAX_MS = 60_000;

const show = (x: unknown): string =>
  x instanceof Error ? `${x.name}: ${x.message}` : typeof x === 'string' ? x : JSON.stringify(x, (_k, v) => (v instanceof Error ? `${v.name}: ${v.message}` : v));

const silent = (sink?: (level: string, args: unknown[]) => void) => {
  const l: any = {
    level: 'warn',
    child: () => l,
    trace() {}, debug() {}, info() {},
    warn: (...a: unknown[]) => sink?.('warn', a),
    error: (...a: unknown[]) => sink?.('error', a),
  };
  return l;
};

const LOCK_AFTER = 5;
const MAX_LOCK_MS = 60 * 60_000;
const b64 = (b: ArrayBuffer) => Buffer.from(b).toString('base64');

interface Unlocked { dek: string; vault: Vault; auth: ReturnType<typeof sqliteAuthState>; store: Store }

export class WhatsAppStore extends DurableObject<Env> {
  private unlocked: Unlocked | null = null;
  private get auth() { return this.keyed().auth; }
  private get store() { return this.keyed().store; }
  private keyed(): Unlocked {
    if (!this.unlocked) throw new Error('locked');
    return this.unlocked;
  }
  private session: Promise<SessionResult> | null = null;
  private phase: Phase = 'idle';
  private qr: string | null = null;
  private pairingCode: string | null = null;
  private lastPoll = 0;
  private sessionAdded = 0;
  private historyProgress: number | null = null;
  private events: string[] = [];

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    // Signing in asks every new person's object whether they have an account. Creating tables to answer that
    // would leave storage behind for everyone, including people turned away because the service is full.
    // So tables are made when an account is, and an empty leftover from before that is erased.
    const sql = ctx.storage.sql;
    if (isLeftover(sql)) ctx.blockConcurrencyWhile(() => ctx.storage.deleteAll());
    else if (hasSchema(sql)) initSchema(sql);
  }

  // ---------- accounts and keys (no key needed) ----------

  /** The stored account, and how long a login must wait if there have been too many wrong passwords. */
  account(): { record: AccountRecord | null; retryAfter: number } {
    const sql = this.ctx.storage.sql;
    if (!hasSchema(sql)) return { record: null, retryAfter: 0 };
    const row = sql.exec<{ v: string }>(`SELECT v FROM account WHERE k = 'record'`).toArray()[0];
    const until = Number(this.meta('locked_until') ?? 0);
    return { record: row ? JSON.parse(row.v) : null, retryAfter: Math.max(0, until - Date.now()) };
  }

  /** Create the account. False if there already is one, so two signups for the same login can't both win. */
  createAccount(record: AccountRecord, timezone: string): boolean {
    const sql = this.ctx.storage.sql;
    initSchema(sql);
    if (sql.exec(`SELECT 1 FROM account WHERE k = 'record'`).toArray().length) return false;
    sql.exec(`INSERT INTO account (k, v) VALUES ('record', ?)`, JSON.stringify(record));
    this.setMeta('tz', timezone);
    return true;
  }

  /** Slow down password guessing: five wrong passwords in a row, then longer and longer waits. */
  noteLogin(ok: boolean) {
    if (ok) { this.setMeta('fails', '0'); this.setMeta('locked_until', '0'); return; }
    const fails = Number(this.meta('fails') ?? 0) + 1;
    this.setMeta('fails', String(fails));
    if (fails >= LOCK_AFTER) this.setMeta('locked_until', String(Date.now() + Math.min(MAX_LOCK_MS, 30_000 * 2 ** (fails - LOCK_AFTER))));
  }

  /** Swap in a new password wrapping for the same key. */
  replaceAccount(record: AccountRecord) {
    this.ctx.storage.sql.exec(`UPDATE account SET v = ? WHERE k = 'record'`, JSON.stringify(record));
  }

  timezone(): string { return this.meta('tz') ?? 'UTC'; }
  /** Is a phone linked? Remembered in the clear because it is asked before there is a key. */
  isPaired(): boolean { return this.meta('paired') === '1'; }

  private meta(k: string): string | null {
    return this.ctx.storage.sql.exec<{ v: string }>(`SELECT v FROM meta WHERE k = ?`, k).toArray()[0]?.v ?? null;
  }
  private setMeta(k: string, v: string) {
    this.ctx.storage.sql.exec(`INSERT OR REPLACE INTO meta (k, v) VALUES (?, ?)`, k, v);
  }

  /**
   * Hand this object the user's data key (base64) for the rest of this request and the session it may start.
   * The first call after an upgrade from the plaintext release encrypts what was stored. A wrong key is refused.
   */
  unlock(dek: string) {
    if (this.unlocked?.dek === dek) return;
    const sql = this.ctx.storage.sql;
    if (!hasSchema(sql)) throw new Error('no account');
    const tx = <T>(fn: () => T) => this.ctx.storage.transactionSync(fn);
    const vault = Vault.fromBase64(dek);
    if (isLegacy(sql)) migrateLegacy(sql, vault, tx);
    const canary = this.meta('canary');
    if (canary) {
      try { vault.open(Buffer.from(canary, 'base64'), 'canary'); } catch { throw new Error('wrong key'); }
    } else {
      this.setMeta('canary', b64(vault.seal('ok', 'canary')));
    }
    const auth = sqliteAuthState(sql, vault, (paired) => this.setMeta('paired', paired ? '1' : '0'));
    this.unlocked = { dek, vault, auth, store: new Store(sql, tx, vault) };
  }

  private note(msg: string) {
    this.events.push(`${new Date().toISOString().slice(11, 19)} ${msg}`);
    if (this.events.length > 80) this.events.shift();
  }

  // ---------- RPC for the Worker ----------

  /** Everything the pairing page needs, and a heartbeat that keeps the pairing session alive. */
  pairStatus() {
    this.lastPoll = Date.now();
    let qrSvg: string | null = null;
    if (this.qr) {
      const q = qrcode(0, 'M');
      q.addData(this.qr);
      q.make();
      qrSvg = q.createSvgTag({ cellSize: 6, margin: 2, scalable: true });
    }
    return {
      paired: this.auth.isPaired(),
      phase: this.phase,
      running: Boolean(this.session),
      progress: this.historyProgress,
      unnamed: this.session ? 0 : this.store.unnamedCount(), // counting names is wasted work while history is still arriving
      qrSvg,
      pairingCode: this.pairingCode,
      ...this.standing(),
      ...this.store.counts(),
    };
  }

  /** Begin (or continue) a pairing session. Runs in the alarm so it outlives this request. */
  async startPairing() {
    this.lastPoll = Date.now();
    this.ctx.storage.sql.exec(`DELETE FROM meta WHERE k IN ('rejected', 'full')`);
    if (!this.session) {
      this.session = this.runSession({ pairing: true, maxMs: PAIR_MAX_MS, idleMs: 8_000 })
        .finally(() => { this.session = null; });
      await this.ctx.storage.setAlarm(Date.now() + 50);
    }
  }

  async requestPairingCode(phone: string) {
    await this.startPairing();
    const digits = phone.replace(/\D/g, '');
    for (let i = 0; i < 40 && !this.sock; i++) await new Promise((r) => setTimeout(r, 250));
    if (!this.sock) throw new Error('socket did not start');
    await new Promise((r) => setTimeout(r, 1500)); // the code request needs the noise handshake done
    this.pairingCode = await this.sock.requestPairingCode(digits);
    return this.pairingCode;
  }

  async alarm() {
    await this.session?.catch(() => {}); // holding the alarm open keeps the DO alive while the session runs
  }

  /** Unlink this device on WhatsApp's side (so it vanishes from the phone's list), then forget the session. Messages stay. */
  async logout() {
    if (this.auth.isPaired()) {
      try {
        await this.unlinkOnServer();
      } catch (e: any) {
        this.note(`server-side unlink failed: ${e?.message}; remove the device in WhatsApp > Linked Devices`);
      }
    }
    this.auth.clear();
    this.ctx.storage.sql.exec(`DELETE FROM meta WHERE k = 'last_pull'`);
  }

  private async unlinkOnServer() {
    const sock = makeWASocket({ auth: this.auth.state, logger: silent(), markOnlineOnConnect: false, getMessage: async () => undefined });
    try {
      await new Promise<void>((resolve, reject) => {
        const t = setTimeout(() => reject(new Error('timed out connecting')), 20_000);
        sock.ev.on('connection.update', (u) => {
          if (u.connection === 'open') { clearTimeout(t); resolve(); }
          if (u.connection === 'close') { clearTimeout(t); reject(new Error('closed before open')); }
        });
      });
      await sock.logout();
    } finally {
      try { sock.end(undefined); } catch {}
    }
  }

  /** Unlink from WhatsApp and erase everything this person has here: messages, names, keys, the account itself. */
  async destroy() {
    try { await this.logout(); } catch {}
    await this.ctx.storage.deleteAlarm();
    await this.ctx.storage.deleteAll();
    this.unlocked = null; // a later sign-up on this login makes fresh tables in createAccount
  }

  linkInfo() {
    return { paired: this.auth.isPaired(), lastPull: this.lastPull(), unnamed: this.store.unnamedCount(), ...this.standing(), ...this.store.counts() };
  }

  lastPull(): number {
    return Number(this.store.getMeta('last_pull') ?? 0);
  }

  /** Where this account stands against the size limits, for the pages and the agent to explain. */
  private standing() {
    const lim = limitsOf(this.env);
    const rejected = this.meta('rejected');
    return {
      rejected: rejected ? (JSON.parse(rejected) as { messages: number; at: number }) : null,
      full: this.meta('full') === '1',
      limits: { messages: lim.messages, mb: Math.round(lim.bytes / 1024 / 1024) },
      contact: xHandle(this.env.CONTACT_X) ?? null,
    };
  }

  private size() {
    return { messages: this.store.counts().messages, bytes: this.ctx.storage.sql.databaseSize ?? 0 };
  }

  /** A history that is too big for this service: unlink the phone and delete what arrived. Runs after the session has ended. */
  private async reject(total: number) {
    this.setMeta('rejected', JSON.stringify({ messages: total, at: Date.now() }));
    await this.logout();
    for (const t of ['messages', 'chats', 'contacts', 'custom_names', 'alias']) this.ctx.storage.sql.exec(`DELETE FROM ${t}`);
    this.keyed().store.reset();
  }

  /** Pull anything new from WhatsApp. Safe to call concurrently; callers share one session. */
  async pull(): Promise<SessionResult> {
    if (!this.auth.isPaired()) throw new Error('not paired');
    if (this.meta('full') === '1') {
      // an account that was full may have room now, if the operator raised the limit or messages were removed
      if (verdict(this.size(), limitsOf(this.env), false)) {
        throw new Error(`This account has reached the size limit for this service, so new messages aren't being added.${contactText(this.env.CONTACT_X)}`);
      }
      this.ctx.storage.sql.exec(`DELETE FROM meta WHERE k = 'full'`);
    }
    if (!this.session) {
      this.session = this.runSession({ pairing: false, maxMs: PULL_MAX_MS, idleMs: 4_000 })
        .finally(() => { this.session = null; });
    }
    return this.session;
  }

  /** Pull if the store is older than maxAgeMs. Returns null if it was fresh enough. */
  async pullIfStale(maxAgeMs: number): Promise<SessionResult | null> {
    if (Date.now() - this.lastPull() < maxAgeMs) return null;
    return this.pull();
  }

  /** What is safe to show without a key: the state of the session and its log. Never message content. */
  debug() {
    const one = (q: string) => this.ctx.storage.sql.exec<{ n: number }>(q).toArray()[0].n;
    return {
      phase: this.phase, paired: this.isPaired(), unlocked: Boolean(this.unlocked), lastPull: Number(this.meta('last_pull') ?? 0),
      messages: one(`SELECT COUNT(*) n FROM messages`), events: this.events,
    };
  }

  // ---------- queries (all read-only) ----------

  listChats(query: string | undefined, limit: number) { return this.store.listChats(query, limit); }
  resolveChat(ref: string) { return this.store.resolveChat(ref); }
  getMessages(o: Parameters<Store['getMessages']>[0]) { return this.store.getMessages(o); }
  search(o: Parameters<Store['search']>[0]) { return this.store.search(o); }
  counts() { return this.store.counts(); }
  unnamedChats(limit: number) { return this.store.unnamedChats(limit); }
  setNames(rows: { jid: string; name: string }[]) { return this.store.setCustomNames(rows); }

  // ---------- the session ----------

  private sock: WASocket | null = null;

  private runSession(opts: { pairing: boolean; maxMs: number; idleMs: number }): Promise<SessionResult> {
    const started = Date.now();
    const intervalsBefore = new Set(liveIntervals);
    this.sessionAdded = 0;
    this.historyProgress = null;
    this.phase = 'connecting';
    this.qr = null;
    this.pairingCode = null;

    return new Promise<SessionResult>((resolve) => {
      let done = false;
      let lastActivity = Date.now();
      let backlogDelivered = false;
      let restarts = 0;
      const touch = () => { lastActivity = Date.now(); };
      const baseCount = this.store.counts().messages;
      const limits = limitsOf(this.env);

      /** After each batch of messages: is the account too big? */
      const guard = async () => {
        if (done) return;
        const total = baseCount + this.sessionAdded;
        const v = verdict({ messages: total, bytes: this.ctx.storage.sql.databaseSize ?? 0 }, limits, opts.pairing);
        if (!v) return;
        this.note(`over the size limit (${total} messages): ${v}`);
        await finish(v === 'reject' ? 'rejected' : 'full');
        if (v === 'reject') await this.reject(total);
        else this.setMeta('full', '1');
      };

      const finish = async (reason: string) => {
        if (done) return;
        done = true;
        clearInterval(timer);
        try { this.sock?.end(undefined); } catch {}
        this.sock = null;
        // stop the timers Baileys leaked, so the object can go idle and pick up new code
        for (const id of [...liveIntervals]) if (!intervalsBefore.has(id)) clearInterval(id);
        this.phase = 'idle';
        this.qr = null;
        this.pairingCode = null;
        if (this.auth.isPaired() && reason !== 'logged_out') this.store.setMeta('last_pull', String(Date.now()));
        this.note(`session end: ${reason}, +${this.sessionAdded} messages`);
        resolve({ reason, added: this.sessionAdded, ms: Date.now() - started });
      };

      const connect = () => {
        try { open(); } catch (e: any) { this.note(`connect error: ${e?.stack ?? e}`.slice(0, 600)); void finish('error'); }
      };
      const open = () => {
        const sock = makeWASocket({
          auth: this.auth.state,
          logger: silent((lvl, a) => this.note(`${lvl}: ${a.map(show).join(' ').slice(0, 300)}`)),
          syncFullHistory: true,
          markOnlineOnConnect: false, // stay invisible so the phone keeps notifying
          generateHighQualityLinkPreview: false,
          getMessage: async () => undefined,
        });
        this.sock = sock;

        sock.ev.process(async (ev) => {
          if (ev['messaging-history.set'] || ev['messages.upsert']) touch();
          try {
            if (ev['creds.update']) await this.auth.saveCreds();

            if (ev['connection.update']) {
              const u = ev['connection.update'];
              if (u.qr) { this.qr = u.qr; this.phase = 'qr'; this.note('qr'); }
              if (u.receivedPendingNotifications) { backlogDelivered = true; this.note('backlog delivered'); }
              if (u.connection === 'open') {
                this.qr = null;
                this.phase = 'syncing';
                this.note('open');
                // group names only come from an explicit fetch
                sock.groupFetchAllParticipating()
                  .then((g) => this.store.upsertChatNames(Object.values(g)))
                  .catch((e) => this.note(`groups: ${e?.message}`));
              }
              if (u.connection === 'close') {
                const code = (u.lastDisconnect?.error as any)?.output?.statusCode;
                this.note(`close ${code}`);
                if (code === DisconnectReason.loggedOut) {
                  this.auth.clear();
                  await finish('logged_out');
                } else if (code === DisconnectReason.connectionReplaced) {
                  await finish('replaced');
                } else if (!done && restarts++ < 8) {
                  // 515 restartRequired follows every successful pairing; reconnect with the new creds
                  this.sock = null;
                  connect();
                } else {
                  await finish(`closed_${code}`);
                }
              }
            }

            if (ev['messaging-history.set']) {
              const h = ev['messaging-history.set'];
              for (const m of h.lidPnMappings ?? []) this.store.addAlias(m.lid, m.pn);
              this.store.upsertContacts(h.contacts ?? []);
              this.store.upsertChatNames(h.chats ?? []);
              this.sessionAdded += this.store.ingestMessages(h.messages ?? []);
              if (typeof h.progress === 'number') this.historyProgress = h.progress;
              this.note(`history chunk: ${h.messages?.length ?? 0} msgs, progress ${h.progress ?? '-'}`);
            }
            if (ev['messages.upsert']) this.sessionAdded += this.store.ingestMessages(ev['messages.upsert'].messages);
            if (ev['messaging-history.set'] || ev['messages.upsert']) await guard();
            if (ev['lid-mapping.update']) this.store.addAlias(ev['lid-mapping.update'].lid, ev['lid-mapping.update'].pn);
            if (ev['contacts.upsert']) this.store.upsertContacts(ev['contacts.upsert']);
            if (ev['contacts.update']) this.store.upsertContacts(ev['contacts.update'] as any);
            if (ev['chats.upsert']) this.store.upsertChatNames(ev['chats.upsert']);
            if (ev['chats.update']) this.store.upsertChatNames(ev['chats.update'] as any);
            if (ev['groups.upsert']) this.store.upsertChatNames(ev['groups.upsert']);
            if (ev['groups.update']) this.store.upsertChatNames(ev['groups.update'] as any);
          } catch (e: any) {
            this.note(`handler error: ${e?.message}`);
          }
        });
      };

      const timer = setInterval(() => {
        const now = Date.now();
        if (now - started > opts.maxMs) return void finish('max_time');
        const paired = this.auth.isPaired();
        if (opts.pairing && !paired && now - this.lastPoll > PAIR_ABANDON_MS) return void finish('abandoned');
        if (!paired) return; // waiting on a scan
        // a first link waits for WhatsApp's own "100%"; a plain pull just waits for quiet
        const historyDone = !opts.pairing || this.historyProgress === 100;
        if (backlogDelivered && historyDone && now - lastActivity > opts.idleMs) void finish('idle');
      }, 1000);

      connect();
    });
  }
}
