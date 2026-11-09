# whatsapp-mcp

<a href="https://news.ycombinator.com/item?id=50145715"><img src="https://hackergit.org/badge/finereli/whatsapp-mcp.svg" alt="Hacker News" height="20"></a>

Connect ChatGPT, Claude or Grok to your WhatsApp. It is a read-only MCP server over your own message history, stored encrypted, and open source.

You link your phone once, the way you'd link WhatsApp Web, and from then on any MCP client can search and read your chats. It can't send anything.

Built by [@finereli](https://x.com/finereli). Questions and bug reports go in an issue here, or to me on X.

There are two ways to use it:

- **Use it at [whatsapp.finereli.com](https://whatsapp.finereli.com).** This is the quick way. Sign in with Google, scan the QR code with your phone, and add `https://whatsapp.finereli.com/mcp` to your agent. It's a free beta with a limited number of seats and a size limit per account. Your messages are encrypted at rest, but I run the login service, so in principle I could derive your key. "What it guarantees" below says exactly what that means. If you'd rather not trust me, run your own copy.
- **Run your own copy** in your Cloudflare account. This is what the setup guide below covers. Free apart from Cloudflare's few dollars a month, and the key comes from a password only you know. Anyone can also run it as a service for other people: see "Running it for other people".

The easiest way to set up the hosted version is to let your agent do it. Paste this into Claude, ChatGPT or Grok:

> Set up WhatsApp for me via https://whatsapp.finereli.com. Read https://whatsapp.finereli.com/llms.txt and walk me through it.

Ask your agent things like:

- "What did Dana say about the flights?"
- "Find every message where someone mentioned the lease, across all my chats."
- "Summarize what I missed in the family group this week."

## How it works

Your phone stays the source of truth. The server is a linked device that your agent talks to.

It doesn't stay connected to WhatsApp. When your agent asks for something, it connects, collects whatever WhatsApp queued for it since last time, writes that to its own database, and hangs up. Your phone keeps working normally and keeps getting notifications.

Your messages live in a SQLite database inside a Durable Object in Cloudflare, one per person, sealed with a key that comes from that person's sign-in.

## What it guarantees, and what it doesn't

**It only reads.** There are no tools that send, edit or delete anything in WhatsApp.

**Your messages are encrypted at rest. Whether the operator can read them depends on how it is run.**
- **Your own copy** (`OWNER_PASSWORD`): the key comes from your password. There is no master key and no recovery key. Not Cloudflare, and not someone who copies the database, can read your stored messages without it.
- **A hosted service** (`OPEN_SIGNUP`): people sign in with Google through a login service (login.finereli.com) that hands the server a key for them, the same key every time. A leaked database, a stolen backup or a peek inside the hosting account shows noise. The login service's operator can derive that key, so the encryption is not a lock against them. They say so, the code is open source, and running your own copy removes the question.
- Each account has a random data key. It encrypts everything you own: message text, chat and contact names, the names your agent saves, and WhatsApp's session keys.
- The data key is stored only in a form locked by that password or login key (PBKDF2-SHA256, 600,000 rounds for a password, then AES-256-GCM). Someone who copies the database can't read your stored messages without it.
- Phone numbers and chat ids are replaced by keyed hashes in the database, so it can still sort and group without knowing who anyone is. Timestamps, message types and which side sent each message are left readable, and so is roughly how long each message is. Someone with the database could see how many chats you have, how active they are and when, but not who they were with or what they said.
- Search uses a filter per block of about 128 messages, built from keyed hashes of the words in it (see "Searching encrypted messages" below). Without your key it can't be tested for any word. What it shows is roughly how many different words a block holds.
- Signing in produces the data key for a while. It travels inside the OAuth token your agent holds and your browser session, each encrypted under that token. The server stores nothing that can open your data on its own.

**It is not end-to-end encryption, and you should know exactly where that stops.**
- While you or your agent are making a request, the server has your key in memory and works with your messages in plain text.
- Whoever runs the server could deploy modified code that captures passwords as people type them, or reads the key as it arrives. The code is open source so that this can be checked, and you can run your own copy to remove the question.
- Whatever your agent reads goes to the company that runs the agent.
- The server is itself a WhatsApp device that has to read your messages to answer your agent, so it has to see them in plain text. A design that kept them hidden from the server couldn't search them for you.

**If you lose your password (own copy), you lose the stored copy.** Nobody can reset it. Your messages are still in WhatsApp, so you link again and import whatever history WhatsApp sends. Signing in with Google has no password to lose.

**You can delete everything.** "Delete my data" on the dashboard unlinks WhatsApp and erases your messages, names, keys and account, and disconnects every agent.

**WhatsApp discourages this.** It uses the same protocol as WhatsApp Web through an open source library (Baileys), and WhatsApp's terms discourage that. WhatsApp could restrict or close an account that does it. The risk for a read-only linked device is low, but it isn't zero. Use it on your own account, and don't use it to send messages.

**The people in your chats didn't agree to this.** Their messages to you are in the copy too. It's your call whether you're comfortable with that.

## Run your own copy

You need a Cloudflare account on the Workers Paid plan (see the note below), Node 20 or later, and your phone.

```sh
git clone https://github.com/finereli/whatsapp-mcp
cd whatsapp-mcp
npm install

# 1. A place for the sign-in tokens. Paste the id it prints into wrangler.jsonc.
npx wrangler kv namespace create OAUTH_KV

# 2. A password for your account. 12+ characters. This is what locks your messages.
npx wrangler secret put OWNER_PASSWORD

# 3. Deploy.
npm run deploy
```

Wrangler prints your URL, something like `https://whatsapp-mcp.your-name.workers.dev`. Open it. The front page has the two remaining steps:

1. **Link WhatsApp.** Sign in with the password, then scan the QR code with WhatsApp (Settings, Linked Devices, Link a Device). If you're on the phone itself and can't scan a screen, use the phone number option instead. The first link imports your history. The page shows progress, and you can close it.
2. **Connect your agent.** Point your MCP client at `https://your-url/mcp` and sign in with the password when it asks. In Claude Code:

   ```sh
   claude mcp add --transport http whatsapp https://your-url/mcp
   ```

   Then type `/mcp`. ChatGPT calls an MCP server a connector; Grok and anything else that speaks MCP works the same way.

   The front page also has Claude, ChatGPT and Grok buttons. Each copies a message ("Set up WhatsApp for me via your-url. Read your-url/llms.txt and walk me through it.") and opens the assistant, so you paste it there. `/llms.txt` is a plain-text page written for the assistant: where the MCP endpoint is, the steps the person has to do themselves, and what to tell them honestly.

The first sign-in with `OWNER_PASSWORD` creates your account. After that your account's own password is what counts, so changing the secret later does nothing. If you want your own domain, see the comments at the bottom of `wrangler.jsonc`.

### The Workers Paid note

Importing a large history decodes a lot of data in one go, and the default CPU limit on Workers is too small for it. `wrangler.jsonc` raises it, and raising it needs the paid plan, which is $5 a month. I haven't tried the free plan. If you're on it, remove the `limits` block and expect the first import to be fragile.

### Upgrading from an earlier version

The first version stored messages in plain text. The first sign-in after you deploy this one encrypts everything already stored, in one step that either completes or changes nothing. Sign in with `OWNER_PASSWORD`; that password becomes the one that locks your data. The Google login option is gone, because a key can't be made from a login service. The daily background pull is gone too, for the reason in the next section.

## Things to know

**Syncing happens when your agent asks.** There is no scheduled pull, because the data key only exists while someone is signed in, and a background job would have nothing to decrypt with. Every read tool first tops up from WhatsApp if the stored copy is more than ten minutes old, so you notice nothing day to day. WhatsApp queues messages for a linked device for a limited time. An account nobody uses for weeks may have lost the messages WhatsApp was holding for it, and would need a full resync: link the phone again and import what WhatsApp sends. That's the price of never keeping a key on the server.

**Search reads a block per match, not the whole history.** The messages are encrypted, so the database can't search them, but each block of about 128 messages carries a small keyed filter that says which words it can't contain. A search skips every block its words rule out, and decrypts only the rest. The first search on an account from before this builds the filters, which costs about what one search used to: a full decrypt, once. Several queries still share one pass, so `search_messages` takes a list: agents should put every search they need in one call.

**Search is exact words.** Words match whole (case and accents ignored), several words must all appear, "quoted words" must appear together in order, and a trailing `*` matches word starts (`flight*`). It isn't fuzzy, and it doesn't stem.

**You get what WhatsApp sends.** The first link imports whatever history WhatsApp decides to hand a new device. It may not be everything. It only does this once per link. To import again, relink (your stored messages are kept, and a re-import fills in anything missing).

**Some chats show up as phone numbers.** WhatsApp doesn't give a linked device every contact name, and most of these are one-off messages from people you never saved. For the ones that matter, your agent can fix it: it lists the unnamed chats, looks the numbers up in your contacts with whatever contacts tool it already has (a Google Contacts or Gmail connector, for example), and saves the names. The server never connects to a contacts service itself. See "Naming chats" below.

**Media isn't downloaded.** Photos, voice notes and documents appear as labels like `[image]` or `[voice note 12s]`, with the caption if there was one. Nothing is transcribed.

**Reactions show up as replies.** A 🙏 on a message appears in the chat at the time it was sent, as `[reacted 🙏 to "the message"]`, from whoever sent it. Changing a reaction replaces it, and taking it back removes it. Reactions from before this was added were never stored, so they only appear for older messages if you relink and re-import.

**Relinking.** If your phone says the device was removed, or you want to start over, ask your agent to run `relink`, or open `/setup` and choose "Unlink and scan again". You scan a new QR code. Stored messages are kept.

## Running it for other people

The same code runs as a service for many people. Leave `OWNER_PASSWORD` unset and set `OPEN_SIGNUP=true`. With neither set, nobody can sign in, so a deployment that forgot to choose can't become a free service for strangers. People sign in with Google through a login service (login.finereli.com by default; point `LOGIN_URL` at your own). The service says who they are and gives the server a data key for them, derived from a secret only the service holds, so there is no password to type or lose. The server keeps an anonymous id made from their Google account id, never their email. Each person gets their own Durable Object, their own key, and no way to see anyone else's data. The honest limit: whoever runs the login service can derive every key, so say so to your users, and know that this protects against leaks, not against you.

The login service has to list your origin in its `ALLOWED_ORIGINS`, and it must return a key from `/exchange` when asked (`{code, key: true}`). Writing your own is small: the key is `HKDF-SHA256(secret, salt = your origin, info = the person's Google id)`, returned only to a server (never a browser), and the secret must never change.

```sh
# in wrangler.jsonc vars: "OPEN_SIGNUP": "true", "SIGNUP_LIMIT": "100", and "LOGIN_URL" if not finereli's
```

Set `OPERATOR_NAME` so the privacy policy and terms say who runs it. Those pages describe what this code does, and their wording is not legal advice: have someone qualified read them before you offer this to the public.

### Caps, and getting told when you hit them

A service for strangers needs limits, so there are three, all optional variables:

- `SIGNUP_LIMIT`: the most accounts. When it's reached, signup shows a "full for now" page with your contact. Deleting an account gives its seat back.
- `MAX_MESSAGES` and `MAX_DB_MB`: the most one account can hold. They default to 250,000 messages and 300 MB in many-user mode, and `0` turns one off. A history that's too big when first linked is turned away: the phone is unlinked, everything received is deleted, and the person is told why and where to reach you. An account that grows past the cap later keeps what it has and stops adding new messages.
- `CONTACT_X`: your X handle, shown on those pages, in the terms and privacy policy, and in what an agent says when an account is full or turned away.

To hear when seats run out, turn on [Email Routing](https://developers.cloudflare.com/email-routing/) for your domain, verify your address there, and add a `send_email` binding named `ALERT_EMAIL` with that address as `destination_address`, plus the vars `ALERT_TO` (the same address) and `ALERT_FROM` (any address on your domain). You get an email at 80 percent of `SIGNUP_LIMIT` and another when it's full. Messages contain counts and nothing about anyone.

When every seat is taken, the front page says so and offers a waitlist instead of a signup. The list is at `/debug?u=waitlist` (needs the PIN); `POST /debug?u=waitlist&remove=<email>` takes someone off it. With a daily cron trigger, the seat and waitlist counts are written to the log once a day.

What it costs, from Cloudflare's published prices (estimates, not measured on a real fleet):

| Item | Price | Per person, per month |
| --- | --- | --- |
| Workers Paid plan | $5 flat per account, shared by everyone | close to nothing once there are a few people |
| Stored data | $0.20 per GB, 5 GB included | a heavy history is 100 to 300 MB: 2 to 6 cents |
| Compute and Durable Object time | included allowances are large | under a cent |
| First import | a few minutes of CPU, once | under a cent |

With the default caps, 100 people is about $10 a month at the absolute worst (everyone at the storage cap, which won't happen), and more likely $5 to $7. Cloudflare isn't the cost that matters. Support time is, and so is the risk below.

The risk to weigh: every linked device connects from Cloudflare's datacenter addresses, and WhatsApp may flag that more readily than a phone's. If it restricts accounts, the people who signed up are the ones who lose. Say so plainly to anyone you invite. The terms of service and privacy policy already do.

## What your agent can do

| Tool | What it does |
| --- | --- |
| `list_chats` | Chats, most recent first. Filter by name or number. |
| `get_messages` | Read one chat. Page back or forward by date. |
| `search_messages` | Search across everything, or within one chat. Takes a list of queries and answers them in one pass. |
| `unnamed_chats` | Chats known only by phone number, busiest first, with the last thing the other person said. |
| `set_contact_names` | Save names for phone numbers, in any format. Names stick to the number, so they also show up in groups. |
| `sync_now` | Pull new messages right now. |
| `link_status` | Is it linked, when did it last pull, how much is stored. |
| `relink` | Unlink and start over. A human has to scan the new QR code. |

## Naming chats

WhatsApp only gives this server the names it knows. The rest show up as phone numbers. Rather than have the server log in to a contacts service (which means a cloud project, consent screens and, for Google, an app review), it hands the job to your agent, which usually already has a way to reach your contacts.

Say "find names for my unnamed chats". The agent calls `unnamed_chats`, matches the numbers against your contacts, and saves what it finds with `set_contact_names`. It won't find everyone: most unnamed chats are a single message from a stranger.

Agents get nudged toward this on their own. The server's instructions mention it, and so does every "no chat found" and "no matches" result, because that's the moment an agent is stuck on a name. `link_status` also says how many chats are unnamed.

---

# For agents, and people adapting this

Everything below is for whoever is changing the code, including an AI agent working on a fork. The top of this file is for the person who owns the deployment.

## Shape of the thing

```
MCP client ──OAuth──> Worker (src/index.ts)
                        ├─ /mcp ───────────> mcp.ts: tools, one fresh McpServer per request
                        └─ /, /setup, /authorize, /login, /auth/callback, /pair/*   (landing, sign-in, pairing UI)
                                   │ RPC: unlock(dek), then the call
                                   v
              WhatsAppStore (Durable Object, one instance per person)
                ├─ SQLite: sealed auth keys, messages, chats, contacts
                └─ Baileys socket, opened only during a session (pairing or pull)
                                   │ WebSocket
                                   v
                              WhatsApp servers
```

One Durable Object per person holds everything. Its SQLite is both the Baileys auth store and the message store. The object is named `owner` in single-user mode and by a hash of the Google account id otherwise, so finding someone's object needs no directory. The Worker is stateless apart from a KV namespace: the OAuth provider's tokens, short-lived "pending sign-in" records, and browser sessions.

## How the key travels

`vault.ts` is the only code that touches keys. Read it first.

1. **Signup or first sign-in.** `createAccount` makes a random 32-byte data key (DEK), stretches the password (or, for a login-service key, which is already random, not at all: `KEY_STRETCH`) with PBKDF2 into a key-encryption key and an auth key, wraps the DEK under the first and stores a hash of the second as a verifier. The account record (salt, rounds, verifier, wrapped DEK) goes in the person's Durable Object. It's useless without the password.
2. **Sign-in.** `openAccount` checks the verifier and unwraps the DEK. Wrong passwords are throttled in the object (`noteLogin`): five in a row, then longer and longer waits. A missing account spends the same time as a wrong password. With the login service there is no password: `signInWithLogin` redeems the one-time code at the service, which returns the person's id and key, and opens or creates the account.
3. **Carrying it.** The DEK goes into the OAuth grant's `props`, which `workers-oauth-provider` encrypts under a key wrapped by each access and refresh token. The browser gets a session: a random token filed in KV with the DEK sealed under a key derived from the token, so KV alone can't open it. The dashboard uses a second 30 minute token minted from the cookie.
4. **Using it.** Every Worker to Durable Object call starts with `unlockedStub()`, which calls `unlock(dek)`. The object builds a `Vault`, checks it against a sealed canary in `meta` so a wrong key is refused, and keeps the key in memory only. It's gone when the object is evicted. Nothing writes it to disk or to logs.
5. **Sealing.** `Vault.seal` is AES-256-GCM with a random nonce and an `aad` label naming what the blob is, so one kind can't be passed off as another. `Vault.pid` is an HMAC that turns a jid into an opaque, stable id.

Don't log a key, put one in a URL, or store one anywhere that outlives a session. Don't add a table that holds anything personal in a readable column.

## Files

| File | Job |
| --- | --- |
| `src/index.ts` | Routes. OAuth provider wiring, sign-in, pairing endpoints, deleting an account, `/debug`. |
| `src/vault.ts` | Keys: password to account record, sealing and opening, pseudonymous ids, tokens that carry a key. |
| `src/auth.ts` | Accounts and sessions. Single-user mode or many-user mode, password sign-in and the login service, the KV-backed sessions that carry the key. |
| `src/limits.ts` | The mode (one person, many, not set up) and the per-account size caps: what is over, and whether to turn an account away or stop adding to it. |
| `src/registry.ts` | The seat counter behind `SIGNUP_LIMIT`, and the waitlist. |
| `src/notify.ts` | Emails the operator through the `ALERT_EMAIL` binding. |
| `src/brand.ts` | The logo as the Worker serves it: the SVG, the PNG icons and the social card, embedded so a deployment needs no static hosting. |
| `src/phone.ts` | Phone numbers in any format to WhatsApp jids. |
| `src/whatsapp-do.ts` | The Durable Object. Holds the account record, unlocks with a key, runs Baileys sessions, exposes RPC methods for the Worker. |
| `src/store.ts` | Schema, ingesting Baileys events into SQLite, every query, search, and the migration from the plaintext version. |
| `src/search-index.ts` | The keyed Bloom filters that let search skip blocks it can't match. |
| `src/auth-state.ts` | Baileys auth state backed by the DO's SQLite and sealed (replaces `useMultiFileAuthState`). |
| `src/mcp.ts` | The MCP tools, and the hint that points agents at the naming tools. |
| `src/pages.ts`, `src/landing.ts`, `src/privacy.ts`, `src/tos.ts`, `src/ui.ts` | All HTML. `ui.ts` has the shared design tokens. |
| `src/ws-shim.ts`, `src/lru-shim.ts`, `src/polyfills.ts` | Make Baileys run on workerd. See below. |
| `scripts/vendor-bridge.mjs` | Extracts the wasm from Baileys' Rust bridge. Runs on `npm install`. |
| `scripts/pull-config.mjs` | Rebuilds `wrangler.local.jsonc` from the live Worker. |
| `local-export/` | A separate one-off script that dumps your history to JSON files with no server. Not part of the deployment. |

## How sessions work

All WhatsApp traffic happens inside `runSession()` in `whatsapp-do.ts`. There are two kinds:

- **Pairing** (`startPairing`). No credentials yet. Baileys emits QR strings, kept in memory and rendered to SVG by `pairStatus()`. After a scan WhatsApp closes the socket with code 515 (restart required), and the session reconnects with the new credentials. History arrives as `messaging-history.set` chunks with a `progress` percentage. The session ends when WhatsApp reports 100 percent and the stream has been quiet for a few seconds.
- **Pull** (`pull`). Reconnects with stored credentials. WhatsApp delivers whatever it queued while we were away, then signals `receivedPendingNotifications`. The session ends after a few quiet seconds.

Callers share one session: a second `pull()` while one is running gets the same promise.

A pairing session outlives the HTTP request that started it. `startPairing` sets a Durable Object alarm, and `alarm()` awaits the session promise. An in-flight alarm handler is what keeps the object alive. The pairing page only watches; closing it doesn't stop the import.

Idle detection counts only data events (`messaging-history.set`, `messages.upsert`), not connection chatter. Counting everything keeps a session open forever, because presence and contact updates never stop.

## Data model

All in the Durable Object's SQLite (`store.ts`). "Sealed" means a `Vault.seal` blob; "pid" means a `Vault.pid` id.

- `messages(chat, id, ts, from_me, sender, type, data)`, primary key `(chat, id)`. `chat` and `sender` are pids. `data` is sealed `{ b: body, p: push name, s: sender jid }`. Media is a label in the body. Edits rewrite it; deletes set it to `[deleted]`.
- `chats(cid, data)`, `contacts(cid, data)`, `custom_names(cid, data)`. `cid` is the pid of the jid, and the sealed record holds the jid and the names. Display names resolve in memory (`nameOf` in `store.ts`), from a decrypted snapshot of these small tables that is dropped whenever they change: WhatsApp's chat name, then WhatsApp's contact name, then a saved name, then WhatsApp's notify name, then the latest push name seen in the chat, then the number. `custom_names` is what `set_contact_names` writes.
- `alias(cid, data)`. WhatsApp is moving to anonymous `@lid` identifiers. This maps them to phone-number JIDs, and `addAlias` folds existing rows into the phone-number form so one person is one chat.
- `auth(k, data)`. Baileys credentials and signal keys, with the key name hashed too, since `session-<number>.0` names a contact.
- `meta(k, v)`, in the clear: `last_pull`, `paired`, `tz`, login throttling, a sealed canary, `schema`, `search_index`. `account(k, v)` holds the account record.
- `chat_stats(chat, n, last)`: each chat's message count and newest timestamp, kept by triggers on `messages`, so counting never scans. Any new write to `messages` gets this for free; don't use `INSERT OR REPLACE` on it, because a replace removes the old row without running delete triggers.
- `lid_senders(sender)`: senders stored under an unmapped `@lid`. `addAlias` only rewrites messages for lids in here.
- `search_blocks(blk, chat, start, last, n, bloom)`: the search filters. See below.

Keep new work in `store.ts` in the same shape: a query that needs a name or a number is answered in JavaScript from the snapshot, not in SQL.

## Searching encrypted messages

The database can't look inside message text, because it's sealed. The first version answered every search by decrypting the whole history, newest first. That works, and it costs a full read of every message per search.

Now each chat's timeline is cut into blocks of about 128 messages (`search-index.ts`). Each block has a Bloom filter: 16,384 bits, with 4 bits set for every word that appears in the block, and for each word's first one to four letters, so `lunch*` works. Which 4 bits is decided by an HMAC of the word under a key derived from the user's data key. So:

- A search hashes its words the same way and checks each block's bits. One bit off means the word is certainly not in that block, and the block is never read. All bits on means it probably is, so the block's messages are decrypted and matched properly. The filter only decides what to read; the match itself is the same whole-word match as always, so results are exactly what a full scan would give. The tests check that against a brute-force scan.
- Blocks are read newest first and the search stops once every query has its `limit` matches newer than anything left. A rare word costs about one block per match. A word that appears nowhere costs one row per block and nothing else.
- Without the key, a filter is a bit array with some fraction of bits set. That reveals roughly how many distinct words a block has, which says little beyond the message lengths that are already visible. It doesn't reveal which words, how often each appears, or whether two blocks share a word. Someone with the key can already decrypt the messages.
- Bits are only ever added. An edit adds the new words and a delete leaves the old ones, so a filter can grow stale but never wrong: stale bits cost an extra block read, never a missed match.
- A block covers its chat from its `start` up to the next block's `start`. Live messages land in the newest block until it holds 128, then a new one starts. History that arrives out of order goes into whichever block covers its time, and a block that grows past 256 is recut from its messages. When a lid chat is merged into a phone number, the number's blocks are rebuilt.
- Filter updates are collected for the whole ingest batch and written once per block touched, not once per message.

## What costs money

On Durable Objects, SQLite is billed by rows read and rows written, and a row written costs about a thousand times a row read. Index rows count as rows. So:

- Don't add an index to `messages` casually. It is one more row written for every message, forever. `lid_senders` exists because an index on `sender` would have cost more than the scan it saved.
- Don't count or group over `messages` on a hot path. Status polls, `list_chats` and the size check used to, and at a hundred users that was most of the bill. Use `chat_stats`.
- Batch writes to the small tables. One write per chat or block per ingest batch is fine; one per message adds up.
- Reads are cheap until they're full scans of big histories on every request. Then they're the bill.

Ingest is idempotent. Re-importing history inserts what's missing and fills in a missing sender or push name, and never duplicates. That is what makes relinking safe.

Opening a database from the plaintext version, `unlock()` runs `migrateLegacy` once: it renames the old tables, creates the new ones, copies everything across sealed, and drops the old tables, all in one transaction.

## What to know before changing things

These all cost real time to find. Read them before touching the Baileys parts.

1. **Baileys needs three shims to run on workerd.**
   - `ws`: the package needs Node sockets. `ws-shim.ts` wraps the Workers WebSocket, opened with `fetch()` and an `Upgrade` header because that's the only way to set the `Origin` header WhatsApp checks.
   - `whatsapp-rust-bridge`: it ships its wasm as base64 and compiles it at runtime, which workerd forbids. `vendor-bridge.mjs` writes the wasm to a file and patches the loader to import it as a `CompiledWasm` module. The `vendor/` folder is generated, not committed.
   - Timers: Node timers have `.unref()` and workerd's don't. `polyfills.ts` adds it. It must be the first import in both the Worker and the Durable Object module.
2. **`lru-cache` autopurge breaks the first import.** Baileys creates caches with `ttlAutopurge: true`, which starts one `setTimeout` per entry. workerd allows 10,000 pending timers per object, and the first history sync blows through that with `QuotaExceededError`. `lru-shim.ts` turns autopurge off. Expired entries are still dropped lazily on access.
3. **QR pairing never sets `creds.registered`.** That flag belongs to the mobile registration flow. "Is this linked" is `creds.me?.id`.
4. **History comes once per link.** If a first import fails halfway, that history is gone until you relink. Don't ship a change to ingest code without testing it against a real first link.
5. **Group senders arrive in two places.** Live messages have `key.participant`. History messages put it on `msg.participant`. Read both.
6. **Pin Baileys exactly.** It's a prerelease and its API moves between release candidates.
7. **Deploys don't evict a busy Durable Object.** An object with an active session keeps running old code until the session ends. Renaming the class with a migration didn't evict it either. If you've shipped a fix and the object still misbehaves, stop sending it requests and wait three to five minutes. Every probe, including `/debug`, resets its idle timer, so polling a stale object keeps it stale. Baileys also leaks interval timers when a socket closes; `finish()` in `whatsapp-do.ts` clears them so the object can go idle at all.
8. **Logging out takes two steps.** `logout()` first connects and calls Baileys' `logout()`, so the device disappears from the phone's list, then clears local credentials. If the first step fails it says so in the debug events, and the user has to remove the device by hand.
9. **WhatsApp stores a placeholder where a name should be.** Chats it has no contact for are named after the number, sometimes masked (`+972∙∙∙∙∙∙∙20`), in the chat name and the contact name. `numberLike` in `store.ts` treats those as no name, and ingest refuses to store them. Before that fix a placeholder outranked a real saved name.
10. **Don't call `markOnlineOnConnect`.** It's set to false on purpose. Marking the linked device online makes the phone stop showing notifications.

## Configuration

| Name | Kind | Purpose |
| --- | --- | --- |
| `OWNER_PASSWORD` | secret | Single-user mode: set it and the server is for one person. 12+ characters. The first sign-in creates the account. Leave it unset for many-user mode. |
| `OPEN_SIGNUP` | var, optional | `"true"` turns on many-user mode: Google sign-in through the login service. |
| `LOGIN_URL` | var, optional | The login service. Defaults to `https://login.finereli.com`. |
| `SIGNUP_LIMIT` | var, optional | Most accounts in many-user mode. Unset or `0`: no cap. |
| `MAX_MESSAGES`, `MAX_DB_MB` | var, optional | Most messages and storage in one account. Defaults in many-user mode: 250000 and 300. `0` means no cap. |
| `ALERT_EMAIL`, `ALERT_TO`, `ALERT_FROM` | send_email binding and vars, optional | Where to email the operator when seats run low and run out. |
| `CONTACT_X` | var, optional | Your X handle, shown where people are told to get in touch. |
| `OPERATOR_NAME` | var, optional | Shown on the privacy page and terms as who runs this server. |
| `TIMEZONE` | var, optional | IANA zone for timestamps in single-user mode. Otherwise each account uses the zone of the browser it signed up from. |
| `DEFAULT_COUNTRY_CODE` | var, optional | Country code (digits, no plus), used when your agent saves a number written without one, e.g. `972`. |
| `PIN` | secret, optional | 32+ random characters. Enables the `/debug` routes via an `x-pin` header. Leave it unset to leave them off. |
| `OAUTH_KV` | binding | Token store for the OAuth provider and pending sign-ins. |
| `WA` | binding | The per-person Durable Object. |
| `REGISTRY` | binding | One Durable Object that counts accounts, so `SIGNUP_LIMIT` is a real cap. |

Keep a deployment's own values (domain, KV id) in `wrangler.local.jsonc`, which is gitignored, and deploy with `npm run deploy:local`. `wrangler.jsonc` is the template other people start from.

Lost that file, or deploying from a new machine? `CLOUDFLARE_API_TOKEN=... node scripts/pull-config.mjs` rebuilds it from the live Worker: vars, KV and Durable Object bindings, email, custom domains, crons and limits, with `wrangler.jsonc` filling in what Cloudflare doesn't report. Secrets stay on Cloudflare and are only listed by name. If the live Worker has applied more Durable Object migrations than `wrangler.jsonc` lists (because it was once deployed from a config with its own steps), the script pads the list with empty placeholder steps up to the live tag; without them, wrangler refuses to deploy. Check the result with `npx wrangler deploy -c wrangler.local.jsonc --dry-run`.

## Adapting it

- **Add a tool.** Register it in `mcp.ts` and put the SQL in `store.ts`. Read tools should call `fresh()` first. Keep tools read-only unless you mean otherwise. If a failure leaves an agent stuck, say in the tool result what to try next, the way `NAME_HINT` does for missing names.
- **Change who can sign in.** `signIn` and `signInWithLogin` in `auth.ts` are the only places that turn a login into an identity. Anything you add has to produce the data key, so it has to start from a secret: a password only the person knows, or a key a service derives for them (which the service's operator can derive too).
- **Offer an opt-in background sync.** Today nothing can decrypt when nobody is signed in, so there is no scheduled pull. A "keep syncing" setting could store the data key wrapped by a server secret. That is a weaker mode and should be labeled as one. Don't make it the default.
- **Add a way to change the password.** `rewrap` in `vault.ts` does the cryptography, and `replaceAccount` in the Durable Object stores the result. Nothing calls them yet.
- **Other ways to fill in names.** Anything that can produce `{ jid, name }` rows can call `store.setCustomNames`. A CSV upload, a CardDAV pull or a scheduled job would all work. The agent route exists so the server needs no credentials for any of them.
- **Sending messages.** Not built, on purpose. Think hard before adding it.

## Debugging

With `PIN` set, `/debug` returns JSON and needs the header `x-pin: <PIN>`. Add `?u=<user id>` for a many-user deployment (the id is the hash the object is named by; single-user mode needs nothing). It shows session phase, whether a phone is linked, whether the object currently has a key, the message count, and the last events from the session (connection changes, history chunk sizes, errors). It shows no message content, because the operator has no key, and that is on purpose. There are no routes to read chats, run SQL or pull: they would need a key.

Local development: `npm run dev` with a `.dev.vars` containing `OWNER_PASSWORD=...` (12+ characters). It runs a local Durable Object with its own empty storage, so you can exercise the sign-in flow and see a real QR code, but linking a phone from local dev makes a second linked device.

To test the pairing UI states without a phone, serve the page with a mocked `/pair/status`. Everything the page needs is that one JSON shape: `paired`, `running`, `progress`, `qrSvg`, `messages`, `chats`.

## Checking a change

1. `npm run typecheck`, then `npm test`. The test runs the real store, vault and auth state against Node's built-in SQLite (Node 22.13 or later): the cryptography, names, search (checked against a brute-force scan of a few thousand messages arriving out of order), the running counts, the migration from the plaintext version, and a check that no message, name or number can be found in a dump of the database. It also checks that the check itself can fail, by running it on an unmigrated database.
2. Anything that touches SQL types needs a run inside the real runtime too, because Node's SQLite isn't the Durable Object's (BLOB binding, cursors, DDL inside a transaction). A throwaway Durable Object that imports `store.ts` and runs under `wrangler dev` is enough.
3. Deploy, sign in, link a phone, and call `link_status`, then `list_chats`, then `get_messages` on a Hebrew or emoji-heavy chat, then `search_messages` with two or three queries at once. Then `unnamed_chats`, and `set_contact_names` on one number, and confirm the chat shows the name.
4. If you touched ingest, relink and confirm the stored message count doesn't grow (re-import is idempotent) and that group messages show real sender names.
5. If you touched anything that stores data, dump the SQLite and look for a name or a number in it.

## Known gaps

- Chats with no name in WhatsApp and none saved show as phone numbers. Nothing refreshes names by itself: they only get saved when an agent (or you) does it.
- If WhatsApp has logged the device out, nothing tells you. `link_status` shows it the next time your agent asks.
- Nothing changes a password yet (see "Adapting it").
- Signup is capped by `SIGNUP_LIMIT` and nothing else. Google proves the email, so there is no verification of our own.
- The login service holds a master secret. Lose it and every hosted account is unreadable; leak it together with the database and every account is readable.
- Wrong-password lockouts apply to the password mode only, per account, so someone who knows the owner's setup could lock the owner out of signing in for up to an hour. Agents that are already connected keep working.
- Search is fast for rare words and slower for common ones, which match in most blocks anyway. A one-letter prefix search (`a*`) reads nearly everything.
- Edits and deletes are applied when they arrive as protocol messages. That path hasn't been tested against real ones.
- It's only been exercised against one real account.

## License

MIT
