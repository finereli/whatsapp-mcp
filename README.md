# whatsapp-mcp

Let your AI agent read your WhatsApp messages.

This is a small server that runs in your own Cloudflare account. You link your phone to it once, the way you'd link WhatsApp Web, and from then on any MCP client (Claude Code, Claude Desktop, anything that speaks MCP) can search and read your chats. It can read and search your messages, and remember names you give it for phone numbers. It can't send anything.

Ask your agent things like:

- "What did Dana say about the flights?"
- "Find every message where someone mentioned the lease, across all my chats."
- "Summarize what I missed in the family group this week."

## How it works

Your phone stays the source of truth. The server is a linked device that your agent talks to.

It doesn't stay connected to WhatsApp. When your agent asks for something, and once a day, it connects, collects whatever WhatsApp queued for it since last time, writes that to its own database, and hangs up. Your phone keeps working normally and keeps getting notifications.

Your messages live in a SQLite database inside a Durable Object in your Cloudflare account. Nothing goes anywhere else.

## Set it up

You need a Cloudflare account on the Workers Paid plan (see the note below), Node 22.18 or later, and your phone.

```sh
git clone https://github.com/finereli/whatsapp-mcp
cd whatsapp-mcp
npm install

# cf uses its own login; a Wrangler login is not reused.
npx cf auth login

# 1. A place for the sign-in tokens. Paste the returned id into cloudflare.config.ts.
npx cf kv namespaces create --title OAUTH_KV

# 2. Create .secrets.json with {"OWNER_PASSWORD":"your password"}.
# Use a password of at least 12 characters. This file is gitignored.

# 3. Deploy and upload the password with this version.
npm run deploy -- --secrets-file .secrets.json
```

`cf` prints your URL, something like `https://whatsapp-mcp.your-name.workers.dev`. Open it. The front page has the two remaining steps:

1. **Link WhatsApp.** Scan the QR code with WhatsApp (Settings, Linked Devices, Link a Device). If you're on the phone itself and can't scan a screen, use the phone number option instead. The first link imports your history. The page shows progress, and you can close it.
2. **Connect your agent.** In Claude Code:

   ```sh
   claude mcp add --transport http whatsapp https://your-url/mcp
   ```

   Then type `/mcp` and sign in with the password. Other clients: point them at the same `/mcp` URL.

For your own domain, set `worker.domains` in `cloudflare.config.ts`, or use the private deployment settings below.

### The Workers Paid note

Importing a large history decodes a lot of data in one go, and the default CPU limit on Workers is too small for it. `cloudflare.config.ts` raises it, and raising it needs the paid plan, which is a few dollars a month. I haven't tried the free plan. If you're on it, remove the `limits` block and expect the first import to be fragile.

## Things to know

**This isn't official.** WhatsApp has no API for reading your own personal messages. This uses the same protocol WhatsApp Web uses, through an open source library (Baileys). That's against WhatsApp's terms. For a linked device that only reads, the practical risk is low, but it isn't zero. Use it on your own account, and don't use it to send messages.

**You get what WhatsApp sends.** The first link imports whatever history WhatsApp decides to hand a new device. It may not be everything. It only does this once per link. To import again, relink (your stored messages are kept, and a re-import fills in anything missing).

**Some chats show up as phone numbers.** WhatsApp doesn't give a linked device every contact name, and most of these are one-off messages from people you never saved. For the ones that matter, your agent can fix it: it lists the unnamed chats, looks the numbers up in your contacts with whatever contacts tool it already has (a Google Contacts or Gmail connector, for example), and saves the names. The server never connects to a contacts service itself. See "Naming chats" below.

**Media isn't downloaded.** Photos, voice notes and documents appear as labels like `[image]` or `[voice note 12s]`, with the caption if there was one. Nothing is transcribed.

**It's for one person.** One deployment is one WhatsApp account and one owner. That's deliberate: each deployment holds a full message history and a live login to the account, so everyone should run their own.

**Relinking.** If your phone says the device was removed, or you want to start over, ask your agent to run `relink`, or open `/setup` and choose "Unlink and scan again". You scan a new QR code. Stored messages are kept.

## What your agent can do

| Tool | What it does |
| --- | --- |
| `list_chats` | Chats, most recent first. Filter by name or number. |
| `get_messages` | Read one chat. Page back or forward by date. |
| `search_messages` | Full-text search across everything, or within one chat. |
| `unnamed_chats` | Chats known only by phone number, busiest first, with the last thing the other person said. |
| `set_contact_names` | Save names for phone numbers, in any format. Names stick to the number, so they also show up in groups. |
| `sync_now` | Pull new messages right now. |
| `link_status` | Is it linked, when did it last pull, how much is stored. |
| `relink` | Unlink and start over. A human has to scan the new QR code. |

Every read tool first tops up from WhatsApp if the stored copy is more than ten minutes old.

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
                        ├─ /, /setup, /authorize, /login/*, /pair/*   (landing, sign-in, pairing UI)
                        └─ cron 04:00 UTC ──> pull()
                                   │ RPC
                                   v
              WhatsAppStore (Durable Object, one instance named "owner")
                ├─ SQLite: auth keys, messages, chats, contacts, FTS5 index
                └─ Baileys socket, opened only during a session (pairing or pull)
                                   │ WebSocket
                                   v
                              WhatsApp servers
```

One Durable Object holds everything. Its SQLite is both the Baileys auth store and the message store. The Worker is stateless apart from a KV namespace the OAuth provider uses for tokens and a short-lived "pending sign-in" record.

## Files

| File | Job |
| --- | --- |
| `src/index.ts` | Routes. OAuth provider wiring, sign-in, pairing endpoints, `/debug`, cron. |
| `src/auth.ts` | Who counts as the owner. Two modes: a password, or a login service. Also the owner's browser session. |
| `src/phone.ts` | Phone numbers in any format to WhatsApp jids. |
| `src/whatsapp-do.ts` | The Durable Object. Runs Baileys sessions, exposes RPC methods for the Worker. |
| `src/store.ts` | Schema, ingesting Baileys events into SQLite, and every query. |
| `src/auth-state.ts` | Baileys auth state backed by the DO's SQLite (replaces `useMultiFileAuthState`). |
| `src/mcp.ts` | The MCP tools, and the hint that points agents at the naming tools. |
| `src/pages.ts`, `src/landing.ts`, `src/privacy.ts`, `src/tos.ts`, `src/ui.ts` | All HTML. `ui.ts` has the shared design tokens. |
| `src/ws-shim.ts`, `src/lru-shim.ts`, `src/polyfills.ts` | Make Baileys run on workerd. See below. |
| `scripts/vendor-bridge.mjs` | Extracts the wasm from Baileys' Rust bridge. Runs on `npm install`. |
| `local-export/` | A separate one-off script that dumps your history to JSON files with no server. Not part of the deployment. |

## How sessions work

All WhatsApp traffic happens inside `runSession()` in `whatsapp-do.ts`. There are two kinds:

- **Pairing** (`startPairing`). No credentials yet. Baileys emits QR strings, kept in memory and rendered to SVG by `pairStatus()`. After a scan WhatsApp closes the socket with code 515 (restart required), and the session reconnects with the new credentials. History arrives as `messaging-history.set` chunks with a `progress` percentage. The session ends when WhatsApp reports 100 percent and the stream has been quiet for a few seconds.
- **Pull** (`pull`). Reconnects with stored credentials. WhatsApp delivers whatever it queued while we were away, then signals `receivedPendingNotifications`. The session ends after a few quiet seconds.

Callers share one session: a second `pull()` while one is running gets the same promise.

A pairing session outlives the HTTP request that started it. `startPairing` sets a Durable Object alarm, and `alarm()` awaits the session promise. An in-flight alarm handler is what keeps the object alive. The pairing page only watches; closing it doesn't stop the import.

Idle detection counts only data events (`messaging-history.set`, `messages.upsert`), not connection chatter. Counting everything keeps a session open forever, because presence and contact updates never stop.

## Data model

All in the Durable Object's SQLite (`store.ts`, `initSchema`).

- `messages(chat, id, ts, from_me, sender, push_name, type, body)`, primary key `(chat, id)`. Media is a label in `body`. Edits update `body`; deletes set it to `[deleted]`.
- `messages_fts`, an FTS5 index over `body`, kept in sync by triggers.
- `chats(jid, name, is_group)`, `contacts(jid, name, notify)` and `custom_names(jid, name)`. Display names resolve by WhatsApp's chat name, then WhatsApp's contact name, then a saved name, then the person's own push name, then the number. `custom_names` is what `set_contact_names` writes.
- `alias(lid, pn)`. WhatsApp is moving to anonymous `@lid` identifiers. This maps them to phone-number JIDs, and `addAlias` folds existing rows into the phone-number form so one person is one chat.
- `auth(k, v)`, Baileys credentials and signal keys, JSON with Buffers encoded by Baileys' `BufferJSON`.
- `meta(k, v)`, currently just `last_pull`.

Ingest is idempotent. Re-importing history upserts: it fills in a missing `sender` or `push_name` and never duplicates. That is what makes relinking safe.

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
| `OWNER_PASSWORD` | secret | Password mode (default). 12+ characters or sign-in refuses. |
| `OWNER_EMAIL` | var | Login-service mode: the one email allowed in. |
| `OPERATOR_NAME` | var, optional | Shown on the privacy page as who runs this server. |
| `DEFAULT_COUNTRY_CODE` | var, optional | Country code (digits, no plus), used when your agent saves a number written without one, e.g. `972`. |
| `LOGIN_ORIGIN` | var | Set this to switch to login-service mode. |
| `ALLOWED_ORIGINS` | var | Login-service mode: comma-separated origins whose tokens are accepted. Production should list only production. |
| `PIN` | secret, optional | 32+ random characters. Enables the `/debug` routes via an `x-pin` header. Leave it unset to leave them off. |
| `OAUTH_KV` | binding | Token store for the OAuth provider and pending sign-ins. |
| `WA` | binding | The Durable Object. |

`cloudflare.config.ts` defines the Worker, bindings, SQLite Durable Object lifecycle, and scheduled sync. `wrangler.config.ts` holds only build settings: `cf` uses Wrangler as its bundler to preserve the Baileys aliases and compiled Wasm module. Run `npm run dev`, `npm run build`, and `npm run deploy` through `cf`.

For private deployment settings, copy `cloudflare.local.example.json` to the gitignored `cloudflare.local.json`. Set `oauthKvId` to the existing KV namespace ID. Optional fields are `accountId`, `name` (defaults to `whatsapp-mcp`), `domain`, and `vars` (a map of strings, for example `OWNER_EMAIL`, `LOGIN_ORIGIN`, and `ALLOWED_ORIGINS`). Then use `npm run deploy:local -- --secrets-file .secrets.json`. Here `--mode private` selects private deployment settings; it still deploys to Cloudflare. To develop with those same settings, use `npm run dev -- --mode private`.

Keep secret values out of both config files. Upload `OWNER_PASSWORD`, and optionally `PIN`, in `.secrets.json` via `--secrets-file`. Local development still uses `.dev.vars`.

When migrating an existing deployment, preserve the Worker name, KV namespace ID, and `WhatsAppStore` class name. Its new `exports.durableObject({ storage: 'sqlite' })` declaration replaces the old `v1` migration. Transfer any values from `wrangler.local.jsonc` to `cloudflare.local.json`; `cf` does not read the old JSONC files. `wrangler.jsonc` is retained only as the pre-migration reference.

`cf` is currently in beta and is pinned to the version validated here. See [Cloudflare's migration guide](https://developers.cloudflare.com/cf/wrangler/migrate/) when updating it.

## Adapting it

- **Add a tool.** Register it in `mcp.ts` and put the SQL in `store.ts`. Read tools should call `fresh()` first. Keep tools read-only unless you mean otherwise. If a failure leaves an agent stuck, say in the tool result what to try next, the way `NAME_HINT` does for missing names.
- **Change who can sign in.** `auth.ts` picks a mode (`authMode`) and the routes in `index.ts` follow it. To add another identity provider, add a mode there and a callback route. The rest of the code only sees an opaque bearer token.
- **Make it multi-user.** Today the Durable Object is addressed by the fixed name `owner` (`wa()` in `index.ts`, `handleMcp` in `mcp.ts`), and `userId` is the constant `'owner'` in the OAuth props. To go multi-user, derive both from the signed-in identity and key the object on it. Think about whether you want to hold other people's message history first.
- **Other ways to fill in names.** Anything that can produce `{ jid, name }` rows can call `store.setCustomNames`. A CSV upload, a CardDAV pull or a scheduled job would all work. The agent route exists so the server needs no credentials for any of them.
- **Sending messages.** Not built, on purpose. Think hard before adding it.

## Debugging

With `PIN` set, these return JSON and need the header `x-pin: <PIN>`:

- `/debug`: session phase, linked or not, counts, and the last events from the session (connection changes, history chunk sizes, errors).
- `/debug/pull`: run a pull now.
- `/debug/chats?q=`, `/debug/messages?chat=`, `/debug/search?q=`, `/debug/types`: read the store without going through MCP.
- `/debug/unnamed`: the chats `unnamed_chats` would return.
- `/debug/sql?q=`: one read-only `SELECT` against the store, for finding out why a name or a count looks wrong.
- `/debug/logout`: the same as `relink`.

Local development: `npm run dev` with a `.dev.vars` containing `OWNER_PASSWORD=...` (12+ characters). It runs a local Durable Object with its own empty storage, so you can exercise the sign-in flow and see a real QR code, but linking a phone from local dev makes a second linked device.

To test the pairing UI states without a phone, serve the page with a mocked `/pair/status`. Everything the page needs is that one JSON shape: `paired`, `running`, `progress`, `qrSvg`, `messages`, `chats`.

## Checking a change

1. `npm run typecheck`, then `npm test`, `npm run build`, and `npm run deploy -- --dry-run`. The test runs the real store code against Node's built-in SQLite (Node 22.13 or later), including the migration from older versions. That SQLite has no FTS5, so search itself isn't covered.
2. Deploy, then `GET /debug` with the PIN. It should come back with `phase: "idle"` and `paired: true`.
3. `GET /debug/pull`. A quiet account should return `reason: "idle"` in about ten seconds.
4. Call `list_chats`, then `get_messages` on a Hebrew or emoji-heavy chat, then `search_messages`. Then `unnamed_chats`, and `set_contact_names` on one number, and confirm the chat shows the name.
5. If you touched ingest, relink and confirm the stored message count doesn't grow (re-import is idempotent) and that group messages show real sender names.

## Known gaps

- Chats with no name in WhatsApp and none saved show as phone numbers. Nothing refreshes names by itself: they only get saved when an agent (or you) does it.
- If the daily pull finds the session logged out, nothing tells you. `link_status` shows it the next time your agent asks.
- Edits and deletes are applied when they arrive as protocol messages. That path hasn't been tested against real ones.
- It's only been exercised against one real account.

## License

MIT
