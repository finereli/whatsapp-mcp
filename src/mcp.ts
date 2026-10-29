/** The MCP surface: tools over the message store. Each read tops up from WhatsApp first if the store is stale. */
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { WebStandardStreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js';
import { z } from 'zod';
import type { Env, McpProps } from './index.js';
import type { WhatsAppStore } from './whatsapp-do.js';
import { unlockedStub } from './auth.js';
import { toJid } from './phone.js';

const STALE_MS = 10 * 60_000;

const epoch = (s?: string) => {
  if (!s) return undefined;
  const t = Date.parse(s);
  if (Number.isNaN(t)) throw new Error(`Cannot parse date "${s}" - use ISO format like 2026-03-01`);
  return Math.floor(t / 1000);
};
/** Search results are for skimming; a long broadcast shouldn't flood the context. get_messages has the full text. */
const clip = (s: string, n = 400) => (s.length > n ? `${s.slice(0, n)}... [+${s.length - n} chars]` : s);
const oneLine = (s: string, n: number) => clip(s.replace(/\s+/g, ' ').trim(), n);
const text = (t: string) => ({ content: [{ type: 'text' as const, text: t }] });

/**
 * WhatsApp doesn't give this server every contact name, so some chats are only a phone number. The
 * server doesn't manage contacts; whatever contacts tool the agent already has does the lookup. This
 * line goes wherever an agent might be stuck on a name it can't find, because that's when it helps.
 */
const NAME_HINT =
  `Can't find someone by name? Some chats are known only by phone number. Call unnamed_chats, match those numbers against the user's contacts ` +
  `if you can reach them (a Google Contacts or Gmail tool, for example), and save what you find with set_contact_names. Searching by name works after that.`;

type Rows = Record<string, any>[];

const displayNumber = (jid: string) => (jid.endsWith('@s.whatsapp.net') ? `+${jid.replace('@s.whatsapp.net', '')}` : jid);

function buildServer(wa: DurableObjectStub<WhatsAppStore>, env: Env, origin: string, TZ: string) {
  const fmt = new Intl.DateTimeFormat('sv-SE', { timeZone: TZ, dateStyle: 'short', timeStyle: 'short' });
  const when = (ts: number) => fmt.format(new Date(ts * 1000));
  const server = new McpServer(
    { name: 'whatsapp-mcp', version: '0.0.1' },
    {
      instructions:
        `Access to the user's WhatsApp history. It can read and search messages and save names for phone numbers; it cannot send anything. Timestamps are ${TZ}. ` +
        `Each read first pulls anything new from WhatsApp if the store is more than a few minutes old. ` +
        `Use list_chats to find a chat, get_messages to read it, search_messages to find things across chats. ${NAME_HINT}`,
      maxToolInputElements: 10_000,
    },
  );

  /** Top up from WhatsApp; never let a failed pull block reading what we already have. */
  const fresh = async (): Promise<string> => {
    try {
      if (!(await wa.isPaired())) return `WhatsApp is not linked yet. Open ${origin}/setup to scan the QR code.\n\n`;
      await wa.pullIfStale(STALE_MS);
      return '';
    } catch (e: any) {
      return `(could not refresh from WhatsApp: ${e?.message}; showing stored messages)\n\n`;
    }
  };

  server.registerTool(
    'list_chats',
    {
      description:
        'List chats (DMs and groups), most recently active first. Optionally filter by name or number fragment. ' +
        "If a person you're looking for isn't here by name, they may be a chat known only by number: see unnamed_chats.",
      inputSchema: { query: z.string().optional(), limit: z.number().int().min(1).max(100).default(30) },
    },
    async ({ query, limit }) => {
      const note = await fresh();
      const rows = (await wa.listChats(query, limit)) as Rows;
      if (!rows.length) return text(note + `No chats found${query ? ` matching "${query}"` : ''}. ${query ? NAME_HINT : ''}`.trimEnd());
      return text(
        note + rows.map((r) => `${r.name}${r.is_group ? ' [group]' : ''} | ${r.messages} msgs | last ${when(r.last_ts)} | ${r.jid}`).join('\n'),
      );
    },
  );

  server.registerTool(
    'get_messages',
    {
      description:
        'Read messages from one chat, oldest first. `chat` is a jid from list_chats or a name/number fragment. ' +
        'By default returns the most recent messages; pass `before` to page back in time or `after` to page forward.',
      inputSchema: {
        chat: z.string(),
        limit: z.number().int().min(1).max(500).default(50),
        before: z.string().optional().describe('ISO date/time; only messages before this'),
        after: z.string().optional().describe('ISO date/time; only messages after this'),
      },
    },
    async ({ chat, limit, before, after }) => {
      const note = await fresh();
      const matches = (await wa.resolveChat(chat)) as { jid: string; name: string }[];
      if (!matches.length) return text(note + `No chat matches "${chat}". Try list_chats. ${NAME_HINT}`);
      if (matches.length > 1 && !chat.includes('@')) {
        return text(note + `"${chat}" matches several chats, pick one by jid:\n` + matches.map((m) => `${m.name} | ${m.jid}`).join('\n'));
      }
      const rows = (await wa.getMessages({ chat: matches[0].jid, limit, before: epoch(before), after: epoch(after) })) as Rows;
      const head = `# ${matches[0].name} (${rows.length} messages)\n`;
      return text(note + head + rows.map((r) => `[${when(r.ts)}] ${r.sender}: ${r.body}`).join('\n'));
    },
  );

  server.registerTool(
    'search_messages',
    {
      description:
        'Search all messages (or one chat) for words, newest matches first. Words are matched whole, ignoring case and accents; several words must all appear; ' +
        '"quoted words" must appear together in order; a trailing * matches word starts (flight* finds flights). ' +
        'Messages are stored encrypted, so each search decrypts the history, which takes a few seconds. Put every search you need in `queries` ' +
        'and the cost is paid once for all of them. To find everything with a person, use list_chats to get their chat. If nobody by that name exists, see unnamed_chats.',
      inputSchema: {
        queries: z.array(z.string()).min(1).max(20).optional().describe('Several searches at once. Results come back grouped by query.'),
        query: z.string().optional().describe('One search. Same as queries with a single item.'),
        chat: z.string().optional().describe('Restrict to one chat (jid or name fragment)'),
        since: z.string().optional(),
        until: z.string().optional(),
        limit: z.number().int().min(1).max(200).default(30).describe('Most matches to return for each query'),
      },
    },
    async ({ queries, query, chat, since, until, limit }) => {
      const qs = [...(queries ?? []), ...(query ? [query] : [])].filter((q) => q.trim());
      if (!qs.length) return text('Give at least one search in `queries`.');
      const note = await fresh();
      let chatJid: string | undefined;
      if (chat) {
        const m = (await wa.resolveChat(chat)) as { jid: string }[];
        if (!m.length) return text(note + `No chat matches "${chat}". ${NAME_HINT}`);
        chatJid = m[0].jid;
      }
      const { hits } = await wa.search({ queries: qs, chat: chatJid, since: epoch(since), until: epoch(until), limit });
      const lines = (rows: typeof hits[number]) => rows.map((r) => `[${when(r.ts)}] ${r.chat_name} | ${r.sender}: ${clip(r.body)}`).join('\n');
      const none = `No matches. If you were looking for something a particular person said, they may be saved only as a number. ${NAME_HINT}`;
      if (qs.length === 1) return text(note + (hits[0].length ? lines(hits[0]) : none));
      return text(note + qs.map((q, i) => `## ${q} (${hits[i].length} match${hits[i].length === 1 ? '' : 'es'})\n${hits[i].length ? lines(hits[i]) : 'No matches.'}`).join('\n\n'));
    },
  );

  server.registerTool(
    'unnamed_chats',
    {
      description:
        'One-to-one chats that are known only by phone number, busiest first, with the last thing the other person said so you can tell who they are. ' +
        "Use this when a person can't be found by name. Match the numbers against the user's contacts (for example with a Google Contacts or Gmail tool), " +
        'then save the names with set_contact_names. Most of these are one-off messages from people who were never saved, so it is normal for many to stay unnamed.',
      inputSchema: { limit: z.number().int().min(1).max(200).default(50) },
      annotations: { readOnlyHint: true },
    },
    async ({ limit }) => {
      const rows = (await wa.unnamedChats(limit)) as Rows;
      if (!rows.length) return text('Every chat has a name.');
      const lines = rows.map((r) => {
        const said = r.last_theirs ? ` | they last said: "${oneLine(r.last_theirs, 120)}"` : '';
        return `${displayNumber(r.jid)} | ${r.messages} msgs | last ${when(r.last_ts)}${said}`;
      });
      return text(`${rows.length} chats known only by number (use the number as given with set_contact_names):\n${lines.join('\n')}`);
    },
  );

  server.registerTool(
    'set_contact_names',
    {
      description:
        'Save names for phone numbers, so chats and group messages from them show a name instead of a number. ' +
        "Only save names you actually found, in the user's contacts or in the conversation itself. Never guess. " +
        'Numbers can be in any format (+972 52-421-9320, 052-421-9320) or the form shown by unnamed_chats. An empty name removes a saved name. ' +
        'This only changes how names display on this server. It sends nothing to WhatsApp.',
      inputSchema: {
        names: z
          .array(
            z.object({
              number: z.string().describe('Phone number in any format, or a jid'),
              name: z.string().describe('The name to show. Empty string removes a saved name.'),
            }),
          )
          .min(1)
          .max(200),
      },
      annotations: { idempotentHint: true, destructiveHint: false },
    },
    async ({ names }) => {
      const rows: { jid: string; name: string }[] = [];
      const bad: string[] = [];
      for (const n of names) {
        const raw = n.number.trim();
        const jid = raw.includes('@') ? raw : toJid(raw, env.DEFAULT_COUNTRY_CODE);
        const name = n.name.trim().slice(0, 100);
        // a number or a masked placeholder isn't a name
        if (!jid || /∙/.test(name) || (name && /^[\d\s+-]*$/.test(name))) bad.push(raw);
        else rows.push({ jid, name });
      }
      const r = rows.length ? await wa.setNames(rows) : { saved: 0, removed: 0, withChat: 0 };
      const parts = [
        `Saved ${r.saved} name${r.saved === 1 ? '' : 's'}${r.removed ? `, removed ${r.removed}` : ''}. ${r.withChat} of ${rows.length} numbers have a chat here.`,
      ];
      if (bad.length) {
        parts.push(
          `Skipped ${bad.length} you gave that I couldn't use: ${bad.join(', ')}. A number needs a country code (or the server needs DEFAULT_COUNTRY_CODE set), and a name can't be a number.`,
        );
      }
      return text(parts.join(' '));
    },
  );

  server.registerTool(
    'link_status',
    {
      description: 'Is WhatsApp linked, when was the last pull, and how much is stored. Use this first if anything looks wrong.',
      inputSchema: {},
      annotations: { readOnlyHint: true },
    },
    async () => {
      const i = await wa.linkInfo();
      const dm = i.contact ? ` The operator is @${i.contact} on X.` : '';
      if (i.rejected) {
        return text(`Not linked. This history was larger than the service takes (${i.rejected.messages.toLocaleString()} messages; the limit is ${i.limits.messages ? `${i.limits.messages.toLocaleString()} messages` : `${i.limits.mb} MB`}), so it was not kept and the phone was unlinked. Nothing is stored.${dm}`);
      }
      if (!i.paired) return text(`Not linked. The owner needs to scan a QR code at ${origin}/setup.${i.messages ? ` The ${i.messages} messages already stored are kept.` : ''}`);
      const last = i.lastPull ? when(Math.floor(i.lastPull / 1000)) : 'never';
      const unnamed = i.unnamed ? ` ${i.unnamed} chats are known only by phone number (see unnamed_chats).` : '';
      return text(`Linked. Last pull ${last}. Stored: ${i.messages} messages across ${i.chats} chats.${unnamed} ${i.full ? ` This account has reached the size limit, so new messages are no longer being added.${dm}` : ''} To link a different phone or fix a broken session, call relink.`);
    },
  );

  server.registerTool(
    'relink',
    {
      description:
        'Unlink the current WhatsApp session and start over. Stored messages are kept. The owner must then open the returned URL and scan a QR code with their phone, which an agent cannot do for them. ' +
        'Use when link_status says not linked, or the session is broken, or the owner asks to relink or re-import history.',
      inputSchema: {},
      annotations: { destructiveHint: true },
    },
    async () => {
      await wa.logout();
      return text(`Unlinked. Ask the owner to open ${origin}/setup and scan the QR code (WhatsApp > Settings > Linked Devices > Link a Device). History is re-imported on the new link; stored messages are kept.`);
    },
  );

  server.registerTool(
    'sync_now',
    {
      description: 'Force a pull of new messages from WhatsApp right now and report how many arrived.',
      inputSchema: {},
    },
    async () => {
      if (!(await wa.isPaired())) return text(`WhatsApp is not linked yet. Open ${origin}/setup to scan the QR code.`);
      const r = await wa.pull();
      const c = await wa.counts();
      return text(`Pulled ${r.added} new messages in ${(r.ms / 1000).toFixed(1)}s (${r.reason}). Store now holds ${c.messages} messages across ${c.chats} chats.`);
    },
  );

  return server;
}

export async function handleMcp(request: Request, env: Env, who: McpProps): Promise<Response> {
  const wa = await unlockedStub(env, who);
  const server = buildServer(wa, env, new URL(request.url).origin, await wa.timezone());
  const transport = new WebStandardStreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true });
  await server.connect(transport);
  return transport.handleRequest(request);
}
