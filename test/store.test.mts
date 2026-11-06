// Runs the real Store against node:sqlite (a stand-in for the Durable Object's SqlStorage).
import { DatabaseSync } from 'node:sqlite';
import { initSchema, isLegacy, matches, migrateLegacy, parseQuery, Store } from '../src/store.ts';
import { sqliteAuthState } from '../src/auth-state.ts';
import { limitsOf, verdict } from '../src/limits.ts';
import { createAccount, KEY_STRETCH, newToken, openAccount, rewrap, tokenId, unwrapForToken, Vault, wrapForToken } from '../src/vault.ts';

// ---------- a SqlStorage lookalike ----------

function makeSql() {
  const db = new DatabaseSync(':memory:');
  const fromDb = (rows: any[]) => rows.map((r) => Object.fromEntries(Object.entries(r).map(([k, v]) => [k, v instanceof Uint8Array ? v.buffer.slice(v.byteOffset, v.byteOffset + v.byteLength) : v])));
  const toDb = (args: any[]) => args.map((a) => (a instanceof ArrayBuffer ? new Uint8Array(a) : a));
  const cursor = (rows: any[], written = 0) => ({ toArray: () => rows, one: () => rows[0], rowsWritten: written, [Symbol.iterator]: () => rows[Symbol.iterator]() });
  const sql: any = {
    exec(q: string, ...args: any[]) {
      if (args.length === 0 && q.trim().split(';').filter((x) => x.trim()).length > 1) { db.exec(q); return cursor([]); }
      const stmt = db.prepare(q);
      if (/^\s*(select|with|pragma)/i.test(q)) return cursor(fromDb(stmt.all(...toDb(args)) as any[]));
      return cursor([], Number(stmt.run(...toDb(args)).changes));
    },
  };
  return { db, sql: sql as SqlStorage };
}

let failed = 0;
const check = (name: string, ok: boolean, detail?: unknown) => { console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}${ok ? '' : ' -> ' + JSON.stringify(detail)}`); if (!ok) failed++; };
const throws = (f: () => unknown) => { try { f(); return false; } catch { return true; } };

// ---------- the vault ----------

const FAST = 1000; // iterations: the real count is for production, tests just need the logic
const acct = await createAccount('correct horse battery', FAST);
check('right password opens the account', (await openAccount('correct horse battery', acct.record))?.equals(acct.dek) === true);
check('wrong password does not', (await openAccount('wrong horse battery', acct.record)) === null);
check('the record holds neither the key nor the password', !JSON.stringify(acct.record).includes(acct.dek.toString('base64')) && !JSON.stringify(acct.record).includes('horse'));
const moved = await rewrap('correct horse battery', 'a brand new password', acct.record);
check('changing the password keeps the same key', (await openAccount('a brand new password', moved!))?.equals(acct.dek) === true);
check('and the old password stops working', (await openAccount('correct horse battery', moved!)) === null);
check('changing needs the old password', (await rewrap('nope nope nope', 'x', acct.record)) === null);

// a key from the login service: already random, so it isn't stretched, and the same key opens the same account
const loginKey = Buffer.from(crypto.getRandomValues(new Uint8Array(32))).toString('base64url');
const keyed = await createAccount(loginKey, KEY_STRETCH);
check('a login-service key opens its account', (await openAccount(loginKey, keyed.record))?.equals(keyed.dek) === true);
check('another key does not', (await openAccount(loginKey.slice(1) + 'A', keyed.record)) === null);
check('the key is not in the record', !JSON.stringify(keyed.record).includes(loginKey));

const vault = new Vault(acct.dek);
const other = new Vault((await createAccount('someone else entirely', FAST)).dek);
const sealed = vault.seal({ hello: 'world' }, 'x');
check('seal then open round-trips', vault.open<any>(sealed, 'x').hello === 'world');
check('ciphertext differs every time', Buffer.compare(Buffer.from(sealed), Buffer.from(vault.seal({ hello: 'world' }, 'x'))) !== 0);
check('another key cannot open it', throws(() => other.open(sealed, 'x')));
check('a blob cannot be passed off as another kind', throws(() => vault.open(sealed, 'y')));
const tampered = new Uint8Array(sealed.slice(0)); tampered[tampered.length - 20] ^= 1;
check('tampering is detected', throws(() => vault.open(tampered, 'x')));
check('pseudonyms are stable', vault.pid('jid', 'a@s.whatsapp.net') === vault.pid('jid', 'a@s.whatsapp.net'));
check('pseudonyms differ by value, kind and key', vault.pid('jid', 'a') !== vault.pid('jid', 'b') && vault.pid('jid', 'a') !== vault.pid('auth', 'a') && vault.pid('jid', 'a') !== other.pid('jid', 'a'));
const tk = newToken();
const wrapped = wrapForToken(tk.token, acct.dek);
check('a token unwraps the key it carries', unwrapForToken(tk.token, wrapped)?.equals(acct.dek) === true);
check('a different token does not', unwrapForToken(newToken().token, wrapped) === null);
check('the stored id is not the token', tokenId(tk.token) !== tk.token && tk.id === tokenId(tk.token));

// ---------- the store ----------

const { db, sql } = makeSql();
initSchema(sql);
const store = new Store(sql, (fn) => fn(), vault);

const GILAD = '972524219320@s.whatsapp.net', STRANGER1 = '972500000001@s.whatsapp.net', STRANGER2 = '972500000002@s.whatsapp.net';
const M = (id: string, chat: string, ts: number, body: string, fromMe = false, extra: any = {}) =>
  ({ key: { id, remoteJid: chat, fromMe, ...extra.key }, messageTimestamp: ts, message: { conversation: body }, pushName: extra.pushName }) as any;

const added = store.ingestMessages([
  M('a1', GILAD, 100, 'hi'), M('a2', GILAD, 200, 'shalom, got a minute?'),
  M('b1', STRANGER1, 150, 'wrong number, sorry'),
  M('c1', STRANGER2, 160, 'hello', true), M('c2', STRANGER2, 170, 'hey there'),
]);
check('ingest counts new messages', added === 5, added);
check('a repeat delivery adds nothing', store.ingestMessages([M('a1', GILAD, 100, 'hi')]) === 0);

// WhatsApp's masked placeholder must not count as a name
store.upsertContacts([{ id: GILAD, name: '+972∙∙∙∙∙∙∙20' }]);
store.upsertChatNames([{ id: STRANGER1, name: '+972∙∙∙∙∙∙∙01' }]);
store.setCustomNames([{ jid: GILAD, name: 'Gilad Shoham' }]);

check('Gilad shows his saved name, not the placeholder', (store.listChats('Gilad', 5) as any[]).length === 1, store.listChats(undefined, 10));
check('searching by his name resolves the chat', (store.resolveChat('gilad') as any[])[0]?.jid === GILAD);
check('chats come back most recent first', (store.listChats(undefined, 10) as any[])[0].jid === GILAD);

const un = store.unnamedChats(10) as any[];
check('unnamed chats lists the strangers, not Gilad', un.length === 2 && !un.some((r) => r.jid === GILAD), un.map((r) => r.jid));
check('busiest unnamed chat comes first', un[0]?.jid === STRANGER2, un.map((r) => r.messages));
check('last thing THEY said, not me', un[0]?.last_theirs === 'hey there', un[0]);
check('unnamed count', store.unnamedCount() === 2);

const r1 = store.setCustomNames([{ jid: STRANGER2, name: 'Dana Levi' }, { jid: '972599999999@s.whatsapp.net', name: 'Nobody Yet' }]);
check('save reports saved and which have chats', r1.saved === 2 && r1.withChat === 1, r1);
check('named chat leaves the unnamed list', store.unnamedCount() === 1);
check('new name shows in chat list', (store.listChats('Dana', 5) as any[]).length === 1);
const msgs = store.getMessages({ chat: STRANGER2, limit: 5 }) as any[];
check('sender name used in messages', msgs.some((m) => m.sender === 'Dana Levi') && msgs.some((m) => m.sender === 'Me'), msgs.map((m) => m.sender));
check('messages read oldest first', msgs[0].body === 'hello' && msgs[1].body === 'hey there', msgs.map((m) => m.body));
const r2 = store.setCustomNames([{ jid: STRANGER2, name: '' }]);
check('empty name removes it', r2.removed === 1 && store.unnamedCount() === 2, r2);

store.ingestMessages([M('g1', '1203@g.us', 300, 'lunch at noon', false, { key: { participant: GILAD } })]);
const gm = store.getMessages({ chat: '1203@g.us', limit: 5 }) as any[];
check('group message sender resolves to custom name', gm[0]?.sender === 'Gilad Shoham', gm);
store.ingestMessages([M('g2', '1203@g.us', 310, 'who is this', false, { key: { participant: '972511111111@s.whatsapp.net' }, pushName: 'Pushy' })]);
check('a sender with only a push name shows it', (store.getMessages({ chat: '1203@g.us', limit: 5 }) as any[]).some((m) => m.sender === 'Pushy'));
store.ingestMessages([M('g3', '1203@g.us', 320, 'and this', false, { key: { participant: '972522222222@s.whatsapp.net' } })]);
check('a sender with nothing shows their number', (store.getMessages({ chat: '1203@g.us', limit: 5 }) as any[]).some((m) => m.sender === '+972522222222'));

// push names fill a nameless chat
store.ingestMessages([M('p1', '972533333333@s.whatsapp.net', 400, 'hi it is me', false, { pushName: 'Tali' })]);
check('a push name names a chat', (store.listChats('Tali', 5) as any[]).length === 1 && store.unnamedCount() === 2);

// edits and deletes
const edit = (id: string, chat: string, text: string) => ({ key: { id: 'e' + id, remoteJid: chat, fromMe: false }, messageTimestamp: 500, message: { protocolMessage: { key: { id }, editedMessage: { conversation: text } } } }) as any;
store.ingestMessages([edit('a2', GILAD, 'shalom, got two minutes?')]);
check('an edit replaces the text', (store.getMessages({ chat: GILAD, limit: 5 }) as any[]).some((m) => m.body === 'shalom, got two minutes?'));
store.ingestMessages([{ key: { id: 'd1', remoteJid: GILAD, fromMe: false }, messageTimestamp: 510, message: { protocolMessage: { key: { id: 'a1' }, type: 0 } } } as any]);
check('a delete leaves a marker', (store.getMessages({ chat: GILAD, limit: 5 }) as any[]).some((m) => m.body === '[deleted]' && m.type === 'deleted'));

// lid -> phone number folding
const LID = '99887766@lid', LIDPN = '972544444444@s.whatsapp.net';
store.ingestMessages([M('l1', LID, 600, 'sent from a lid')]);
check('a lid chat is its own chat at first', (store.listChats(undefined, 50) as any[]).some((c) => c.jid === LID));
store.addAlias(LID, LIDPN);
const folded = store.listChats(undefined, 50) as any[];
check('learning the number folds the lid chat into it', !folded.some((c) => c.jid === LID) && folded.some((c) => c.jid === LIDPN), folded.map((c) => c.jid));
check('and its messages follow', (store.getMessages({ chat: LIDPN, limit: 5 }) as any[])[0]?.body === 'sent from a lid');
store.ingestMessages([M('l2', LID, 610, 'later, still on the lid')]);
check('later lid messages land on the number', (store.getMessages({ chat: LIDPN, limit: 5 }) as any[]).length === 2);

// ---------- reactions ----------
{
  const { sql: rsql } = makeSql();
  initSchema(rsql);
  const rs = new Store(rsql, (fn) => fn(), vault);
  const DANA = '972555555555@s.whatsapp.net', GROUP = '9999@g.us';
  const R = (id: string, chat: string, ts: number, target: string, text: string, fromMe = false, extra: any = {}) =>
    ({ key: { id, remoteJid: chat, fromMe, ...extra.key }, messageTimestamp: ts, message: { reactionMessage: { key: { id: target }, text, senderTimestampMs: ts * 1000 } }, pushName: extra.pushName }) as any;
  const body = (chat: string) => (rs.getMessages({ chat, limit: 20 }) as any[]).map((m) => `${m.sender}: ${m.body}`);

  rs.ingestMessages([M('q1', DANA, 100, 'are we still on for 8?', false, { pushName: 'Dana' })]);
  check('my reaction counts as a new message', rs.ingestMessages([R('x1', DANA, 200, 'q1', '🙏', true)]) === 1);
  check('a reaction shows as my reply, quoting the message', body(DANA).at(-1) === 'Me: [reacted 🙏 to "are we still on for 8?"]', body(DANA));
  rs.ingestMessages([R('x2', DANA, 210, 'q1', '❤️', true)]);
  check('changing it replaces the old one', body(DANA).length === 2 && body(DANA).at(-1)!.includes('❤️'), body(DANA));
  rs.ingestMessages([R('x0', DANA, 150, 'q1', '👍', true)]);
  check('an older update arriving late is ignored', body(DANA).at(-1)!.includes('❤️'), body(DANA));
  rs.ingestMessages([R('x3', DANA, 220, 'q1', '', true)]);
  check('taking it back removes it', body(DANA).length === 1, body(DANA));
  rs.ingestMessages([R('x4', DANA, 230, 'q1', '😂', false, { pushName: 'Dana' })]);
  check('their reaction is theirs', body(DANA).at(-1) === 'Dana: [reacted 😂 to "are we still on for 8?"]', body(DANA));

  // a reaction and its message in the same batch, in the wrong order
  rs.ingestMessages([R('y1', GROUP, 310, 'g9', '👍', false, { key: { participant: DANA }, pushName: 'Dana' }), M('g9', GROUP, 300, 'pizza tonight', false, { key: { participant: GILAD } })]);
  check('a group reaction quotes a message from the same batch', body(GROUP).at(-1) === 'Dana: [reacted 👍 to "pizza tonight"]', body(GROUP));
  // history sync puts reactions on the message itself
  rs.ingestMessages([{ ...M('g8', GROUP, 320, 'who is in'), key: { id: 'g8', remoteJid: GROUP, fromMe: false, participant: GILAD }, reactions: [{ key: { fromMe: true }, text: '✋', senderTimestampMs: 330000 }] } as any]);
  check('reactions carried on a history message are kept', body(GROUP).at(-1) === 'Me: [reacted ✋ to "who is in"]', body(GROUP));
  check('reactions are searchable', (rs.search({ queries: ['pizza'], limit: 10 }).hits[0]).length === 2);
}

// ---------- search ----------

const ts0 = 1000;
store.ingestMessages([
  M('s1', GILAD, ts0 + 1, 'The flights are booked for Thursday'),
  M('s2', GILAD, ts0 + 2, 'Lease signed, deposit paid'),
  M('s3', STRANGER1, ts0 + 3, 'Café on Thursday? the flight lands late'),
  M('s4', STRANGER2, ts0 + 4, 'שלום, מה שלומך? נתראה ביום חמישי'),
  M('s5', GILAD, ts0 + 5, 'release notes attached'),
]);
const one = store.search({ queries: ['flights'], limit: 10 }).hits[0];
check('word search finds it', one.length === 1 && one[0].id === 's1', one.map((h) => h.id));
check('hits carry chat, sender and time', one[0].chat === GILAD && one[0].chat_name === 'Gilad Shoham' && one[0].sender === 'Gilad Shoham' && one[0].ts === ts0 + 1, one[0]);
check('words match whole, so lease is not release', store.search({ queries: ['lease'], limit: 10 }).hits[0].map((h) => h.id).join() === 's2');
check('case and accents are ignored', store.search({ queries: ['CAFE'], limit: 10 }).hits[0].length === 1);
check('several words must all appear', store.search({ queries: ['thursday flight'], limit: 10 }).hits[0].map((h) => h.id).join() === 's3');
check('a quoted phrase must appear in order', store.search({ queries: ['"booked for thursday"'], limit: 10 }).hits[0].length === 1 && store.search({ queries: ['"thursday booked"'], limit: 10 }).hits[0].length === 0);
check('a trailing star matches word starts', store.search({ queries: ['flight*'], limit: 10 }).hits[0].length === 2);
check('Hebrew works', store.search({ queries: ['שלומך'], limit: 10 }).hits[0].map((h) => h.id).join() === 's4');
check('results are newest first', store.search({ queries: ['thursday'], limit: 10 }).hits[0].map((h) => h.id).join() === 's3,s1');
check('a chat can be searched alone', store.search({ queries: ['thursday'], chat: GILAD, limit: 10 }).hits[0].map((h) => h.id).join() === 's1');
check('dates narrow the scan', store.search({ queries: ['thursday'], since: ts0 + 2, limit: 10 }).hits[0].map((h) => h.id).join() === 's3');

const batch = store.search({ queries: ['flights', 'lease', 'nothing here', 'שלום'], limit: 10 });
check('a batch answers every query in order', batch.hits.map((h) => h.map((x) => x.id).join()).join('|') === 's1|s2||s4', batch.hits.map((h) => h.length));
const total = store.counts().messages;
check('a batch decrypts each message once, not once per query', batch.scanned <= total, { scanned: batch.scanned, total });
const early = store.search({ queries: ['thursday'], limit: 1 });
check('it stops as soon as every query is full', early.scanned < total && early.hits[0].length === 1, early.scanned);
check('a query of only punctuation matches nothing', store.search({ queries: ['!!!'], limit: 5 }).hits[0].length === 0);
check('query parsing', JSON.stringify(parseQuery('a "b c" d*')) === JSON.stringify([{ tokens: ['a'], prefix: false }, { tokens: ['b', 'c'], prefix: false }, { tokens: ['d'], prefix: true }]));

// ---------- nothing readable at rest ----------

const allBytes = () => {
  let out = '';
  for (const { name } of db.prepare(`SELECT name FROM sqlite_master WHERE type='table'`).all() as any[]) {
    for (const row of db.prepare(`SELECT * FROM ${name}`).all() as any[]) {
      // blobs as text (latin1 and utf8 catch stored plaintext). Not as hex: a stored "9725" would be 39373235 in
      // hex, so hex finds nothing real, and random ciphertext or filter bits spell short needles by chance.
      for (const v of Object.values(row)) out += (v instanceof Uint8Array ? Buffer.from(v).toString('latin1') + Buffer.from(v).toString('utf8') : String(v)) + '\n';
    }
  }
  return out;
};
const raw = allBytes();
check('(control) the dump covers real content: plaintext columns are in it', raw.includes('text') && raw.length > 5000, raw.length);
const leaks = ['shalom', 'two minutes', 'Gilad', 'Shoham', 'Dana', 'Tali', 'Pushy', 'lunch', '972524219320', '972500000001', '9725', 'lid', 'flights', 'שלום', 'Thursday'];
const leaked = leaks.filter((s) => raw.includes(s));
check('no message, name or number is readable in the database', leaked.length === 0, leaked);
check('the data key is not in the database either', !raw.includes(acct.dek.toString('base64')) && !raw.includes(acct.dek.toString('hex')));

// a different key sees only noise
const stranger = new Store(sql, (fn) => fn(), other);
check('another key cannot read the chats', throws(() => stranger.listChats(undefined, 10)));
check('another key cannot search', throws(() => stranger.search({ queries: ['flights'], limit: 5 })));

// ---------- auth state ----------

const authDb = makeSql();
initSchema(authDb.sql);
const flags: boolean[] = [];
const auth = sqliteAuthState(authDb.sql, vault, (p) => flags.push(p));
await auth.state.keys.set({ session: { '972501234567.0': { secret: 'abc' } as any }, 'pre-key': { '7': { private: Buffer.from('p'), public: Buffer.from('q') } as any } });
await auth.saveCreds();
check('keys round-trip', ((await auth.state.keys.get('session', ['972501234567.0']))['972501234567.0'] as any)?.secret === 'abc');
const authRaw = (authDb.db.prepare(`SELECT k, data FROM auth`).all() as any[]).map((r) => r.k + Buffer.from(r.data).toString('latin1')).join();
check('session keys do not give away who they are for', !authRaw.includes('972501234567') && !authRaw.includes('session') && !authRaw.includes('abc'));
const auth2 = sqliteAuthState(authDb.sql, vault);
check('creds survive a reload', Object.keys(auth2.state.creds).length > 3 && (auth2.state.creds as any).noiseKey != null);
check('reporting unpaired when there is no link', flags[0] === false);
auth.clear();
check('clear wipes the keys', (authDb.db.prepare(`SELECT COUNT(*) n FROM auth`).get() as any).n === 0);

// ---------- upgrading a plaintext database ----------

const old = makeSql();
old.db.exec(`
  CREATE TABLE meta (k TEXT PRIMARY KEY, v TEXT);
  INSERT INTO meta VALUES ('google_refresh','secret-token'),('last_pull','123');
  CREATE TABLE messages (id TEXT NOT NULL, chat TEXT NOT NULL, ts INTEGER NOT NULL, from_me INTEGER NOT NULL, sender TEXT, push_name TEXT, type TEXT NOT NULL, body TEXT NOT NULL, PRIMARY KEY (chat, id));
  CREATE INDEX messages_chat_ts ON messages (chat, ts);
  CREATE INDEX messages_ts ON messages (ts);
  CREATE TABLE chats (jid TEXT PRIMARY KEY, name TEXT, is_group INTEGER NOT NULL DEFAULT 0);
  CREATE TABLE contacts (jid TEXT PRIMARY KEY, name TEXT, notify TEXT);
  CREATE TABLE google_contacts (jid TEXT PRIMARY KEY, name TEXT NOT NULL);
  CREATE TABLE alias (lid TEXT PRIMARY KEY, pn TEXT NOT NULL);
  CREATE TABLE auth (k TEXT PRIMARY KEY, v TEXT NOT NULL);
  INSERT INTO chats VALUES ('${GILAD}', NULL, 0), ('${STRANGER2}', NULL, 0), ('1203@g.us', 'Lunch crew', 1);
  INSERT INTO messages VALUES ('a1','${GILAD}',100,0,'${GILAD}',NULL,'text','hi there'),
    ('a2','${GILAD}',200,1,'me',NULL,'text','plaintext secret about the lease'),
    ('c1','${STRANGER2}',160,0,'${STRANGER2}','Dana P','text','hey'),
    ('g1','1203@g.us',300,0,'${GILAD}',NULL,'text','lunch at noon');
  INSERT INTO contacts VALUES ('${GILAD}', '+972∙∙∙∙∙∙∙20', 'Gil');
  INSERT INTO google_contacts VALUES ('${GILAD}', 'Gilad Shoham');
  INSERT INTO alias VALUES ('55@lid', '${STRANGER2}');
  INSERT INTO auth VALUES ('creds', '{"me":{"id":"972500000000:1@s.whatsapp.net"}}'), ('session-972501234567.0', '{"x":1}');
`);
initSchema(old.sql);
const dumpOf = (d: DatabaseSync) => { let o = ''; for (const { name } of d.prepare(`SELECT name FROM sqlite_master WHERE type='table'`).all() as any[]) for (const row of d.prepare(`SELECT * FROM ${name}`).all() as any[]) for (const v of Object.values(row)) o += (v instanceof Uint8Array ? Buffer.from(v).toString('latin1') : String(v)) + '\n'; return o; };
check('(control) the leak detector does find plaintext in an unmigrated database', ['plaintext secret', 'Gilad', 'session-'].every((x) => dumpOf(old.db).includes(x)));
check('an old plaintext database is detected and left alone', isLegacy(old.sql) && !!(old.db.prepare(`SELECT 1 FROM sqlite_master WHERE name='messages' AND sql LIKE '%body%'`).get()));
check('the stored Google credential is deleted', !old.db.prepare(`SELECT 1 FROM meta WHERE k='google_refresh'`).get());
migrateLegacy(old.sql, vault, (fn) => fn());
check('after migrating it is no longer legacy', !isLegacy(old.sql));
check('no legacy tables are left', !old.db.prepare(`SELECT 1 FROM sqlite_master WHERE name LIKE 'legacy_%' OR name='google_contacts' OR name LIKE '%fts%'`).get());
const up = new Store(old.sql, (fn) => fn(), vault);
check('messages survive', (up.getMessages({ chat: GILAD, limit: 5 }) as any[]).map((m) => m.body).join('|') === 'hi there|plaintext secret about the lease');
check('old Google names are custom names now', (up.listChats('Gilad', 5) as any[]).length === 1);
check('push names survive', (up.listChats('Dana', 5) as any[]).length === 1);
check('group names and senders survive', (up.listChats('Lunch', 5) as any[]).length === 1 && (up.getMessages({ chat: '1203@g.us', limit: 5 }) as any[])[0].sender === 'Gilad Shoham');
check('search works on migrated data', up.search({ queries: ['lease'], limit: 5 }).hits[0].length === 1);
check('aliases survive', (up as any).aliases().get('55@lid') === STRANGER2);
check('auth moved across, sealed', (old.db.prepare(`SELECT COUNT(*) n FROM auth`).get() as any).n === 2 && sqliteAuthState(old.sql, vault).isPaired());
check('other meta kept', (old.db.prepare(`SELECT v FROM meta WHERE k='last_pull'`).get() as any)?.v === '123');
const oldRaw = dumpOf(old.db);
check('nothing readable is left after migrating', !['plaintext secret', 'Gilad', 'Dana', '9725242', 'session-', 'noon'].some((s) => oldRaw.includes(s)), ['plaintext secret', 'Gilad', 'Dana', '9725242', 'session-', 'noon'].filter((s) => oldRaw.includes(s)));

// ---------- size limits ----------

const MB = 1024 * 1024;
const many = { OWNER_PASSWORD: undefined, SIGNUP_LIMIT: '100', OPEN_SIGNUP: 'true' } as any;
check('many-user mode has default caps', limitsOf(many).messages === 250_000 && limitsOf(many).bytes === 300 * MB, limitsOf(many));
check('single-user mode has none', limitsOf({ OWNER_PASSWORD: 'x'.repeat(12) } as any).messages === 0 && limitsOf({ OWNER_PASSWORD: 'x'.repeat(12) } as any).bytes === 0);
check('settings override the defaults', limitsOf({ ...many, MAX_MESSAGES: '1000', MAX_DB_MB: '5' }).messages === 1000 && limitsOf({ ...many, MAX_MESSAGES: '1000', MAX_DB_MB: '5' }).bytes === 5 * MB);
check('0 turns a cap off', limitsOf({ ...many, MAX_MESSAGES: '0', MAX_DB_MB: '0' }).messages === 0);
check('nonsense falls back to the default', limitsOf({ ...many, MAX_MESSAGES: 'lots' }).messages === 250_000);
const lim = { messages: 1000, bytes: 10 * MB };
check('under the caps is fine', verdict({ messages: 1000, bytes: 10 * MB }, lim, true) === null);
check('too many messages while linking is turned away', verdict({ messages: 1001, bytes: 1 }, lim, true) === 'reject');
check('too much data while linking is turned away', verdict({ messages: 1, bytes: 10 * MB + 1 }, lim, true) === 'reject');
check('an account that outgrows its cap later just pauses', verdict({ messages: 5000, bytes: 1 }, lim, false) === 'pause');
check('no caps never rejects', verdict({ messages: 9e9, bytes: 9e12 }, { messages: 0, bytes: 0 }, true) === null);

// ---------- phone parsing ----------

const { toJid } = await import('../src/phone.ts');
const cases: [string, string | undefined, string | null][] = [
  ['+972 52-421-9320', undefined, '972524219320@s.whatsapp.net'], ['052-421-9320', '972', '972524219320@s.whatsapp.net'],
  ['052-421-9320', undefined, null], ['00972524219320', undefined, '972524219320@s.whatsapp.net'],
  ['524219320', '972', '972524219320@s.whatsapp.net'], ['972524219320@s.whatsapp.net', undefined, '972524219320@s.whatsapp.net'],
  ['abc', '972', null], ['+1 (818) 917-7834', '972', '18189177834@s.whatsapp.net'],
];
for (const [i, cc, want] of cases) check(`toJid(${JSON.stringify(i)}, ${cc})`, toJid(i, cc) === want, toJid(i, cc));

// ---------- running totals and lid senders ----------
{
  // the totals must always equal a fresh count, whatever path wrote the messages
  const { db: tdb, sql: tsql } = makeSql();
  initSchema(tsql);
  const ts_ = new Store(tsql, (fn) => fn(), vault);
  const truth = () => JSON.stringify(tdb.prepare(`SELECT chat, COUNT(*) n, MAX(ts) last FROM messages GROUP BY chat ORDER BY chat`).all());
  const kept = () => JSON.stringify(tdb.prepare(`SELECT chat, n, last FROM chat_stats ORDER BY chat`).all());
  const same = (name: string) => check(`totals match a recount: ${name}`, truth() === kept(), { truth: truth(), kept: kept() });
  const A = '972500000011@s.whatsapp.net', G = '5555@g.us', L = '11223344@lid', LPN = '972500000012@s.whatsapp.net';
  const R = (id: string, chat: string, ts: number, target: string, text: string, fromMe = false, key: any = {}) =>
    ({ key: { id, remoteJid: chat, fromMe, ...key }, messageTimestamp: ts, message: { reactionMessage: { key: { id: target }, text, senderTimestampMs: ts * 1000 } } }) as any;

  ts_.ingestMessages([M('t1', A, 100, 'one'), M('t2', A, 300, 'two'), M('t3', A, 200, 'three, arriving late')]);
  same('inserts, out of order');
  ts_.ingestMessages([M('t1', A, 100, 'one')]);
  same('a repeat delivery');
  ts_.ingestMessages([R('r1', A, 400, 't1', '👍', true)]);
  same('a reaction adds a line');
  ts_.ingestMessages([R('r2', A, 410, 't1', '❤️', true)]);
  same('a new emoji replaces it');
  ts_.ingestMessages([R('r3', A, 420, 't1', '', true)]);
  same('taking it back removes the newest line');
  check('and the latest time falls back', (tdb.prepare(`SELECT last FROM chat_stats`).get() as any)?.last === 300);
  ts_.ingestMessages([M('g1', G, 500, 'hi all', false, { key: { participant: L } }), M('d1', L, 510, 'direct from a lid')]);
  same('a group message from a lid, and a lid chat');
  check('the lid sender is noted', (tdb.prepare(`SELECT COUNT(*) n FROM lid_senders`).get() as any).n >= 1);
  ts_.addAlias(L, LPN);
  same('the lid chat folds into the number');
  check('the lid is no longer pending', (tdb.prepare(`SELECT COUNT(*) n FROM lid_senders`).get() as any).n === 0);
  check('the group message now names the number', (ts_.getMessages({ chat: G, limit: 5 }) as any[])[0]?.sender !== 'unknown');
  const c = ts_.counts();
  check('counts come from the totals', c.messages === 5 && c.chats === 3, c);

  // a mapping for a lid that never sent anything does no message work
  const before = tdb.prepare(`SELECT COUNT(*) n FROM messages`).get();
  ts_.addAlias('55555@lid', '972500000013@s.whatsapp.net');
  same('a mapping for an unseen lid');
  check('and changes no messages', JSON.stringify(tdb.prepare(`SELECT COUNT(*) n FROM messages`).get()) === JSON.stringify(before));

  // a store from before the totals existed gets them filled once
  tdb.exec(`DROP TRIGGER chat_stats_ai; DROP TRIGGER chat_stats_ad; DROP TRIGGER chat_stats_au; DROP TABLE chat_stats; DROP TABLE lid_senders;`);
  tdb.exec(`INSERT INTO messages (id, chat, ts, from_me, sender, type, data) SELECT 'copy-' || id, chat, ts + 1000, from_me, sender, type, data FROM messages`);
  initSchema(tsql);
  same('an older store is filled on upgrade');
  ts_.reset();
  check('and counts work after it', ts_.counts().messages === 10, ts_.counts());
}

// ---------- search index ----------
{
  const { db: sdb, sql: ssql } = makeSql();
  initSchema(ssql);
  const st = new Store(ssql, (fn) => fn(), vault);
  let seed = 7;
  const rnd = () => ((seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648);
  const pick = <T,>(a: T[]) => a[Math.floor(rnd() * a.length)];
  const vocab = Array.from({ length: 400 }, (_, i) => `w${i.toString(36)}x`).concat(['lunch', 'lunchbox', 'dinner', 'שלום', 'café', 'meeting']);
  const chats = ['972500000101@s.whatsapp.net', '972500000102@s.whatsapp.net', '972500000103@s.whatsapp.net', '7777@g.us'];
  const all: any[] = [];
  for (let i = 0; i < 3000; i++) {
    const body = Array.from({ length: 1 + Math.floor(rnd() * 8) }, () => pick(vocab)).join(' ') + (i % 997 === 0 ? ' zebra-unicorn' : '');
    all.push(M(`s${i}`, pick(chats), 1_000 + Math.floor(rnd() * 100_000), body, false, { key: { participant: '972500000199@s.whatsapp.net' } }));
  }
  for (let i = all.length - 1; i > 0; i--) { const j = Math.floor(rnd() * (i + 1)); [all[i], all[j]] = [all[j], all[i]]; }

  // brute force: decrypt everything, newest first, the way search used to work
  const brute = (q: string, o: { chat?: string; since?: number; until?: number; limit: number }) => {
    const terms = parseQuery(q);
    const rows = sdb.prepare(`SELECT id, chat, ts, data FROM messages ORDER BY ts DESC, id`).all() as any[];
    return rows.filter((r) => (!o.chat || r.chat === vault.pid('jid', o.chat)) && (!o.since || r.ts >= o.since) && (!o.until || r.ts <= o.until)
      && matches(vault.open(r.data.buffer.slice(r.data.byteOffset, r.data.byteOffset + r.data.byteLength), 'm').b, terms)).map((r) => r.ts);
  };
  const queries = ['lunch', 'lunch*', 'lunc*', 'l*', '"w1x w2x"', 'w1x w2x', 'zebra unicorn', 'zebra-unicorn', 'שלום', 'cafe', 'nothinglikethis', 'meeting dinner'];
  const agree = (label: string) => {
    let bad = 0;
    for (const q of queries) for (const o of [{ limit: 25 }, { limit: 500 }, { chat: chats[1], limit: 10 }, { since: 30_000, until: 60_000, limit: 15 }]) {
      const got = st.search({ queries: [q], ...o }).hits[0].map((h) => h.ts);
      const want = brute(q, o).slice(0, o.limit);
      if (JSON.stringify(got) !== JSON.stringify(want)) { bad++; if (bad < 3) console.log('  mismatch', label, q, o, got.slice(0, 5), want.slice(0, 5)); }
    }
    check(`indexed search equals a full scan: ${label}`, bad === 0, bad);
  };

  st.ingestMessages(all.slice(0, 1200));
  agree('built on first search');
  for (let i = 1200; i < all.length; i += 150) st.ingestMessages(all.slice(i, i + 150)); // out of order, after the index exists
  agree('kept up by later batches, out of order');
  const blocks = sdb.prepare(`SELECT COUNT(*) n, MAX(n) big FROM search_blocks`).get() as any;
  check('blocks stay bounded as history fills in', blocks.big <= 2 * 128 + 150, blocks);

  const total = (sdb.prepare(`SELECT COUNT(*) n FROM messages`).get() as any).n;
  const rare = st.search({ queries: ['zebra'], limit: 30 });
  // the cost of a search is about one block per match, plus the odd false positive, not the whole history
  check('a rare word reads about one block per match', rare.scanned <= (rare.hits[0].length + 1) * 2 * 128, { scanned: rare.scanned, hits: rare.hits[0].length, total });
  const none = st.search({ queries: ['nothinglikethis'], limit: 30 });
  check('a word that is nowhere reads almost nothing', none.scanned <= 2 * 128, { scanned: none.scanned, total });
  check('and finds every match', rare.hits[0].length === brute('zebra', { limit: 30 }).length);
  check('several queries at once agree too', JSON.stringify(st.search({ queries: ['lunch', 'dinner'], limit: 20 }).hits.map((h) => h.map((x) => x.ts)))
    === JSON.stringify([brute('lunch', { limit: 20 }).slice(0, 20), brute('dinner', { limit: 20 }).slice(0, 20)]));

  // an edit adds its new words
  st.ingestMessages([{ key: { id: 'es1', remoteJid: chats[0], fromMe: false }, messageTimestamp: 200_000, message: { protocolMessage: { key: { id: (all.find((m) => m.key.remoteJid === chats[0]) as any).key.id }, editedMessage: { conversation: 'now about giraffes' } } } } as any]);
  check('an edited message is found by its new words', st.search({ queries: ['giraffes'], limit: 5 }).hits[0].length === 1);

  // a lid chat merged into a number keeps its messages searchable
  const SL = '4455667788@lid', SPN = '972500000177@s.whatsapp.net';
  st.ingestMessages([M('sl1', SL, 300_000, 'kangaroo from a lid')]);
  st.ingestMessages([M('sp1', SPN, 300_001, 'kangaroo from the number')]);
  st.addAlias(SL, SPN);
  check('merged chats stay searchable', st.search({ queries: ['kangaroo'], limit: 5 }).hits[0].length === 2);
  agree('after edits and a merge');
}

console.log(failed ? `\n${failed} FAILED` : '\nall passed');
process.exit(failed ? 1 : 0);
