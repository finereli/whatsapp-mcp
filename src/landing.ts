/**
 * The front page: what this is, a chat that shows it working, the two steps to use it, and what it does and
 * doesn't promise. Nothing private on it, since anyone can load it.
 */

import { baseCss, copyScript, esc, iconLinks, xLink } from './ui.js';
import { waitlistCss, waitlistForm } from './pages.js';

const REPO = 'https://github.com/finereli/whatsapp-mcp';
const REPO_API = 'https://api.github.com/repos/finereli/whatsapp-mcp';

const starIcon = `<svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M12 2.5l2.9 6.1 6.6.8-4.9 4.6 1.3 6.6L12 17.3 6.1 20.6l1.3-6.6L2.5 9.4l6.6-.8z"/></svg>`;
const githubIcon = `<svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M12 .5a11.5 11.5 0 0 0-3.64 22.41c.58.1.79-.25.79-.56v-2c-3.2.7-3.88-1.37-3.88-1.37-.52-1.33-1.28-1.69-1.28-1.69-1.04-.71.08-.7.08-.7 1.16.08 1.77 1.19 1.77 1.19 1.03 1.76 2.7 1.25 3.36.96.1-.75.4-1.25.73-1.54-2.55-.29-5.24-1.28-5.24-5.69 0-1.26.45-2.28 1.18-3.09-.12-.29-.51-1.46.11-3.05 0 0 .97-.31 3.17 1.18a11 11 0 0 1 5.77 0c2.2-1.49 3.17-1.18 3.17-1.18.62 1.59.23 2.76.11 3.05.74.81 1.18 1.83 1.18 3.09 0 4.42-2.69 5.39-5.25 5.68.41.36.78 1.06.78 2.14v3.17c0 .31.21.67.8.56A11.5 11.5 0 0 0 12 .5z"/></svg>`;
const sendIcon = `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 19V5M5 12l7-7 7 7"/></svg>`;
const checkIcon = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M20 6 9 17l-5-5"/></svg>`;

// Agent marks. Claude is in its own color; the others take the text color so they work in both themes.
const claudeIcon = `<svg viewBox="0 0 100 100" width="20" height="20" aria-hidden="true"><path fill="#D97757" d="m19.6 66.5 19.7-11 .3-1-.3-.5h-1l-3.3-.2-11.2-.3L14 53l-9.5-.5-2.4-.5L0 49l.2-1.5 2-1.3 2.9.2 6.3.5 9.5.6 6.9.4L38 49.1h1.6l.2-.7-.5-.4-.4-.4L29 41l-10.6-7-5.6-4.1-3-2-1.5-2-.6-4.2 2.7-3 3.7.3.9.2 3.7 2.9 8 6.1L37 36l1.5 1.2.6-.4.1-.3-.7-1.1L33 25l-6-10.4-2.7-4.3-.7-2.6c-.3-1-.4-2-.4-3l3-4.2L28 0l4.2.6L33.8 2l2.6 6 4.1 9.3L47 29.9l2 3.8 1 3.4.3 1h.7v-.5l.5-7.2 1-8.7 1-11.2.3-3.2 1.6-3.8 3-2L61 2.6l2 2.9-.3 1.8-1.1 7.7L59 27.1l-1.5 8.2h.9l1-1.1 4.1-5.4 6.9-8.6 3-3.5L77 13l2.3-1.8h4.3l3.1 4.7-1.4 4.9-4.4 5.6-3.7 4.7-5.3 7.1-3.2 5.7.3.4h.7l12-2.6 6.4-1.1 7.6-1.3 3.5 1.6.4 1.6-1.4 3.4-8.2 2-9.6 2-14.3 3.3-.2.1.2.3 6.4.6 2.8.2h6.8l12.6 1 3.3 2 1.9 2.7-.3 2-5.1 2.6-6.8-1.6-16-3.8-5.4-1.3h-.8v.4l4.6 4.5 8.3 7.5L89 80.1l.5 2.4-1.3 2-1.4-.2-9.2-7-3.6-3-8-6.8h-.5v.7l1.8 2.7 9.8 14.7.5 4.5-.7 1.4-2.6 1-2.7-.6-5.8-8-6-9-4.7-8.2-.5.4-2.9 30.2-1.3 1.5-3 1.2-2.5-2-1.4-3 1.4-6.2 1.6-8 1.3-6.4 1.2-7.9.7-2.6v-.2H49L43 72l-9 12.3-7.2 7.6-1.7.7-3-1.5.3-2.8L24 86l10-12.8 6-7.9 4-4.6-.1-.5h-.3L17.2 77.4l-4.7.6-2-2 .2-3 1-1 8-5.5Z"/></svg>`;
const chatgptIcon = `<svg viewBox="0 0 320 320" width="20" height="20" aria-hidden="true"><path fill="currentColor" d="m297.06 130.97c7.26-21.79 4.76-45.66-6.85-65.48-17.46-30.4-52.56-46.04-86.84-38.68-15.25-17.18-37.16-26.95-60.13-26.81-35.04-.08-66.13 22.48-76.91 55.82-22.51 4.61-41.94 18.7-53.31 38.67-17.59 30.32-13.58 68.54 9.92 94.54-7.26 21.79-4.76 45.66 6.85 65.48 17.46 30.4 52.56 46.04 86.84 38.68 15.24 17.18 37.16 26.95 60.13 26.8 35.06.09 66.16-22.49 76.94-55.86 22.51-4.61 41.94-18.7 53.31-38.67 17.57-30.32 13.55-68.51-9.94-94.51zm-120.28 168.11c-14.03.02-27.62-4.89-38.39-13.88.49-.26 1.34-.73 1.89-1.07l63.72-36.8c3.26-1.85 5.26-5.32 5.24-9.07v-89.83l26.93 15.55c.29.14.48.42.52.74v74.39c-.04 33.08-26.83 59.9-59.91 59.97zm-128.84-55.03c-7.03-12.14-9.56-26.37-7.15-40.18.47.28 1.3.79 1.89 1.13l63.72 36.8c3.23 1.89 7.23 1.89 10.47 0l77.79-44.92v31.1c.02.32-.13.63-.38.83l-64.41 37.19c-28.69 16.52-65.33 6.7-81.92-21.95zm-16.77-139.09c7-12.16 18.05-21.46 31.21-26.29 0 .55-.03 1.52-.03 2.2v73.61c-.02 3.74 1.98 7.21 5.23 9.06l77.79 44.91-26.93 15.55c-.27.18-.61.21-.91.08l-64.42-37.22c-28.63-16.58-38.45-53.21-21.95-81.89zm221.26 51.49-77.79-44.92 26.93-15.54c.27-.18.61-.21.91-.08l64.42 37.19c28.68 16.57 38.51 53.26 21.94 81.94-7.01 12.14-18.05 21.44-31.2 26.28v-75.81c.03-3.74-1.96-7.2-5.2-9.06zm26.8-40.34c-.47-.29-1.3-.79-1.89-1.13l-63.72-36.8c-3.23-1.89-7.23-1.89-10.47 0l-77.79 44.92v-31.1c-.02-.32.13-.63.38-.83l64.41-37.16c28.69-16.55 65.37-6.7 81.91 22 6.99 12.12 9.52 26.31 7.15 40.1zm-168.51 55.43-26.94-15.55c-.29-.14-.48-.42-.52-.74v-74.39c.02-33.12 26.89-59.96 60.01-59.94 14.01 0 27.57 4.92 38.34 13.88-.49.26-1.33.73-1.89 1.07l-63.72 36.8c-3.26 1.85-5.26 5.31-5.24 9.06l-.04 89.79zm14.63-31.54 34.65-20.01 34.65 20v40.01l-34.65 20-34.65-20z"/></svg>`;
const grokIcon = `<svg viewBox="0 0 24 24" width="20" height="20" fill="currentColor" fill-rule="evenodd" aria-hidden="true"><path d="M9.27 15.29l7.978-5.897c.391-.29.95-.177 1.137.272.98 2.369.542 5.215-1.41 7.169-1.951 1.954-4.667 2.382-7.149 1.406l-2.711 1.257c3.889 2.661 8.611 2.003 11.562-.953 2.341-2.344 3.066-5.539 2.388-8.42l.006.007c-.983-4.232.242-5.924 2.75-9.383.06-.082.12-.164.179-.248l-3.301 3.305v-.01L9.267 15.292M7.623 16.723c-2.792-2.67-2.31-6.801.071-9.184 1.761-1.763 4.647-2.483 7.166-1.425l2.705-1.25a7.808 7.808 0 00-1.829-1A8.975 8.975 0 005.984 5.83c-2.533 2.536-3.33 6.436-1.962 9.764 1.022 2.487-.653 4.246-2.34 6.022-.599.63-1.199 1.259-1.682 1.925l7.62-6.815"/></svg>`;

/** Where each button sends you to paste. The message itself is copied first. */
const AGENTS = [
  { name: 'Claude', url: 'https://claude.ai/new', icon: claudeIcon },
  { name: 'ChatGPT', url: 'https://chatgpt.com/', icon: chatgptIcon },
  { name: 'Grok', url: 'https://grok.com/', icon: grokIcon },
];

/** A made-up example. It shows what talking to your own messages is like. */
const SCENE = { q: 'When did Dana say the flights were booked?', found: 'Searched 2 chats', a: "Thursday evening. She wrote that she'd booked both flights and the confirmations were in your email." };

const STATUS = 'Searching WhatsApp messages...';

/** What an assistant reads when someone pastes "set this up for me". Plain text, no markup. */
export function llmsTxt(origin: string, hosted: boolean, full = false): string {
  const mcp = `${origin}/mcp`;
  return `# WhatsApp MCP

A read-only MCP server that lets an AI assistant search and read the user's own WhatsApp messages. It cannot send, edit or delete anything. Open source: ${REPO}
${hosted && full ? `
## Full right now

Every seat on this hosted copy is taken, so new users can't sign up yet. Tell the user that first. They can join the waitlist on ${origin} to hear when a seat opens, or run their own copy from the source (no limit, needs a Cloudflare account). Someone who already has an account can still follow the steps below.
` : ''}
## If a user asked you to set this up

The MCP endpoint is ${mcp} (streamable HTTP, OAuth with dynamic client registration).

Walk the user through these steps. They have to do the first one themselves, in a browser. Do not ask for their password or paste their messages anywhere.

1. Open ${origin} and ${hosted ? 'choose "Get started". Sign in with Google, then' : 'sign in with the password set for this server, then'} scan the QR code with WhatsApp on their phone (Settings, Linked Devices, Link a Device). The first link imports their history, which takes a minute or two.
2. Add ${mcp} to you as a remote MCP server (some apps call it a custom connector) and sign in when asked.
   - Claude on the web or desktop: Settings, Connectors, add a custom connector with that URL.
   - Claude Code: run  claude mcp add --transport http whatsapp ${mcp}  and then type /mcp to sign in.
   - ChatGPT: Settings, Connectors, add a custom MCP server with that URL (it may need developer mode).
   - Grok and other apps: add it as a remote MCP server or connector with that URL.
   Menus change between apps and versions. If they can't find it, tell them to look for "connectors", "MCP" or "custom tools".
3. Once connected you have these tools: list_chats, get_messages, search_messages (give it several queries at once), unnamed_chats, set_contact_names, sync_now, link_status, relink.

## Be straight with the user about

${hosted
  ? "- Messages are stored encrypted, so a leaked database or a look inside the hosting account shows noise. The key comes from the Google sign-in, and the person who runs this service could work out that key, so it is encryption at rest and not a lock against the operator. It is not end-to-end encrypted: while you read, the server sees the messages in plain text. Running their own copy makes the key a password only they know.\n- The stored copy is only a copy. If it is ever lost or deleted, linking again imports what WhatsApp sends."
  : "- Messages are stored encrypted with a key made from the user's password, and the stored copy is unreadable without it. It is not end-to-end encrypted: while you read, the server sees the messages in plain text, and so does whoever runs you.\n- If they lose their password they can't recover the stored copy. The messages are still in WhatsApp, and linking again imports them again."}
- WhatsApp's terms discourage third-party access like this, so there is a small chance WhatsApp restricts the account. They should use their own account.
${hosted ? '- It is a free beta with limited seats, and each account has a size limit. Bigger histories can run their own copy from the source.\n' : ''}`;
}

/**
 * `signupLimit` and `maxMessages` are the caps in force, 0 for none. `contact` is the operator's X handle.
 * `full` means every seat is taken: the page says so up front and offers the waitlist instead of a signup.
 */
export function landingPage(origin: string, hosted = false, caps: { signupLimit?: number; maxMessages?: number; contact?: string; full?: boolean } = {}): string {
  const full = hosted && Boolean(caps.full);
  const mcp = `${origin}/mcp`;
  const claudeCode = `claude mcp add --transport http whatsapp ${mcp}`;
  const subline = hosted
    ? 'Connect ChatGPT, Claude or Grok to your WhatsApp, for free.'
    : 'Connect ChatGPT, Claude or Grok to your WhatsApp. It runs in your own Cloudflare account.';
  const host = new URL(origin).host;
  const pasteMessage = `Set up WhatsApp for me via ${host}. Read ${origin}/llms.txt and walk me through it.`;
  const first = SCENE;
  const description = `${subline} Read-only, stored encrypted, open source.`;
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>WhatsApp MCP</title>${iconLinks}
<meta name="description" content="${esc(description)}">
<meta property="og:type" content="website">
<meta property="og:title" content="WhatsApp MCP">
<meta property="og:description" content="${esc(subline)}">
<meta property="og:image" content="${esc(origin)}/og.png">
<meta property="og:image:width" content="1200">
<meta property="og:image:height" content="630">
<meta name="twitter:card" content="summary_large_image">
<meta name="twitter:title" content="WhatsApp MCP">
<meta name="twitter:description" content="${esc(subline)}">
<meta name="twitter:image" content="${esc(origin)}/og.png">
<style>
${baseCss}
main { max-width: none; padding: 0; }
.wrap { max-width: 1120px; margin: 0 auto; padding-left: 16px; padding-right: 16px; }
@media (min-width: 640px) { .wrap { padding-left: 32px; padding-right: 32px; } }
.sr { position: absolute; width: 1px; height: 1px; overflow: hidden; clip: rect(0 0 0 0); white-space: nowrap; }

.top { display: flex; align-items: center; justify-content: space-between; padding-top: 22px; padding-bottom: 6px; }
.brand { display: inline-flex; align-items: center; gap: 11px; text-decoration: none; font: 600 1.05rem/1 ui-sans-serif, system-ui, -apple-system, "Segoe UI", sans-serif; }
.brand img { width: 34px; height: 34px; display: block; }
.top .muted a { text-decoration: none; }

.hero { display: grid; gap: 44px; padding-top: 44px; padding-bottom: 28px; }
@media (min-width: 940px) { .hero { grid-template-columns: minmax(0, 1fr) minmax(0, 1.05fr); gap: 64px; align-items: center; padding-top: 72px; padding-bottom: 44px; } }
h1 { font-size: clamp(2.6rem, 9vw, 4.2rem); margin-bottom: 14px; }
.lede { font-size: 1.2rem; max-width: 30rem; margin-bottom: 26px; }

.full { margin-bottom: 20px; }
${waitlistCss}.actions { display: flex; flex-wrap: wrap; gap: 12px; align-items: center; margin-bottom: 10px; }
.repo { display: inline-flex; align-items: center; gap: 9px; padding: 12px 16px; border-radius: 10px; border: 1.5px solid var(--ink); text-decoration: none; font: 600 0.95rem/1 ui-sans-serif, system-ui, sans-serif; }
.repo:hover { background: var(--code); }
.repo .count { display: none; align-items: center; gap: 5px; padding-left: 10px; margin-left: 2px; border-left: 1.5px solid var(--rule); }
.repo .count.on { display: inline-flex; }
.oss { margin: 0 0 30px; }

.agents { max-width: 30rem; }
.agents h2 { font: 600 1rem/1.3 ui-sans-serif, system-ui, sans-serif; margin: 0 0 10px; }
.agents .row { display: flex; flex-wrap: wrap; gap: 10px; }
.agent { display: inline-flex; align-items: center; gap: 9px; padding: 10px 15px 10px 12px; border-radius: 999px; border: 1.5px solid var(--rule); background: var(--theirs); color: var(--ink); font: 600 0.95rem/1 ui-sans-serif, system-ui, sans-serif; cursor: pointer; }
.agent:hover { border-color: var(--ink); }
.agent svg { flex: none; display: block; }
.hint { min-height: 1.5em; margin: 10px 0 0; font-size: 0.94rem; color: var(--action); font-weight: 600; }
.paste { margin: 2px 0 0; }

/* The chat window. It is a picture of an assistant working, so none of it is announced; the caption says what it shows. */
.window { margin: 0; border-radius: 16px; background: var(--theirs); border: 1px solid var(--rule); box-shadow: 0 1px 1px rgba(0,0,0,.04), 0 20px 44px -14px rgba(20,33,43,.26); overflow: hidden; display: flex; flex-direction: column; height: 460px; }
@media (prefers-color-scheme: dark) { .window { box-shadow: 0 0 0 1px rgba(255,255,255,.05), 0 24px 60px -20px rgba(0,0,0,.7); } }
.titlebar { display: flex; align-items: center; gap: 7px; padding: 13px 14px; border-bottom: 1px solid var(--rule); }
.titlebar i { width: 11px; height: 11px; border-radius: 50%; background: #ff5f57; }
.titlebar i:nth-child(2) { background: #febc2e; }
.titlebar i:nth-child(3) { background: #28c840; }
.titlebar b { flex: 1; text-align: center; margin-right: 47px; font: 600 0.82rem/1 ui-sans-serif, system-ui, sans-serif; color: var(--muted); }
.empty { margin: auto; max-width: 20rem; text-align: center; display: grid; gap: 6px; color: var(--muted); transition: opacity .4s; }
.empty b { color: var(--ink); font-weight: 600; font-size: 1.05rem; line-height: 1.35; }
.empty.gone { opacity: 0; }
.thread { flex: 1; min-height: 0; padding: 22px 20px 12px; display: flex; flex-direction: column; gap: 18px; overflow: hidden; }
.msg { animation: rise .35s ease-out both; }
.msg.me { align-self: flex-end; max-width: 86%; background: var(--mine); border-radius: 18px 18px 4px 18px; padding: 10px 15px; }
.msg.ai { align-self: flex-start; max-width: 94%; }
.tool { display: inline-flex; align-items: center; gap: 9px; padding: 6px 13px 6px 10px; border: 1px solid var(--rule); border-radius: 999px; font-size: 0.85rem; color: var(--muted); margin-bottom: 10px; }
.tool .spin { width: 14px; height: 14px; border-radius: 50%; border: 2px solid var(--rule); border-top-color: var(--action); animation: spin .8s linear infinite; }
.tool .tick { color: var(--action); display: inline-flex; }
.answer { line-height: 1.55; }
.answer .w { animation: fade .25s ease-out both; }
.composer { display: flex; gap: 10px; align-items: center; padding: 12px 14px 14px; border-top: 1px solid var(--rule); }
.field { flex: 1; min-width: 0; height: 44px; display: flex; align-items: center; padding: 0 17px; border: 1.5px solid var(--rule); border-radius: 999px; background: var(--fog); font-size: 0.93rem; white-space: nowrap; overflow: hidden; }
.field .ph { color: var(--muted); }
.field.has .ph { display: none; }
.caret { width: 2px; height: 1.15em; margin-left: 1px; background: var(--ink); animation: blink 1s steps(2, start) infinite; visibility: hidden; }
.field.live .caret { visibility: visible; }
.send { flex: none; width: 44px; height: 44px; border-radius: 50%; border: 0; background: var(--rule); color: var(--muted); display: grid; place-items: center; transition: background .2s, color .2s, transform .15s; }
.send.on { background: var(--action); color: var(--action-ink); }
.send.press { transform: scale(.9); }
@keyframes spin { to { transform: rotate(360deg); } }
@keyframes blink { to { visibility: hidden; } }
@keyframes rise { from { opacity: 0; transform: translateY(8px); } }
@keyframes fade { from { opacity: 0; } }
@media (prefers-reduced-motion: reduce) { .msg, .answer .w { animation: none; } .tool .spin { animation: none; } .caret { animation: none; } }

.how { padding-top: 40px; padding-bottom: 8px; }
.steps { list-style: none; padding: 0; margin: 0; display: grid; gap: 30px; counter-reset: step; max-width: 40rem; }
.steps > li { counter-increment: step; padding-left: 44px; position: relative; }
.steps > li { min-width: 0; }
.steps .alt code { overflow-wrap: anywhere; }
.steps > li::before { content: counter(step); position: absolute; left: 0; top: 1px; width: 28px; height: 28px; border-radius: 50%; border: 1.5px solid var(--ink); display: grid; place-items: center; font: 600 0.9rem/1 ui-sans-serif, system-ui, sans-serif; }
.alt { margin: 0; }

.terms { margin-top: 56px; display: grid; gap: 34px; }
@media (min-width: 940px) { .terms { grid-template-columns: 1fr 1fr; gap: 64px; } }
.facts { list-style: none; margin: 10px 0 0; padding: 0; display: grid; gap: 14px; }
.facts li { padding-left: 18px; border-left: 3px solid var(--rule); max-width: 34rem; }
.facts.yes li { border-left-color: var(--action); }
.facts strong { display: block; }

footer { margin-top: 56px; margin-bottom: 56px; padding-top: 20px; border-top: 1px solid var(--rule); }
footer p { margin: 0; max-width: none; }
</style>
</head>
<body>
<header class="wrap top">
  <a class="brand" href="/" aria-label="WhatsApp MCP home"><img src="/favicon.svg" alt="" width="34" height="34">WhatsApp MCP</a>
  <span class="muted">${xLink('finereli')}</span>
</header>

<main>
<section class="wrap hero">
  <div>
    <h1>WhatsApp MCP</h1>
    <p class="lede">${esc(subline)}</p>

    ${full ? `<div class="full" id="waitlist">
      <p class="notice"><strong>Full for now.</strong> All ${caps.signupLimit ? caps.signupLimit.toLocaleString() + ' ' : ''}seats are taken. Leave your email and you'll hear when one opens. Already signed up? <a href="/setup">Sign in</a>.</p>
      ${waitlistForm('landing')}
    </div>` : ''}
    <div class="actions">
      ${full ? '' : `<a class="button" href="/setup">${hosted ? 'Get started' : 'Link WhatsApp'}</a>`}
      <a class="repo" href="${REPO}" rel="noopener">${githubIcon}<span>Open source on GitHub</span><span class="count" id="stars">${starIcon}<span id="starCount"></span></span></a>
    </div>
    <p class="muted oss">MIT licensed. ${hosted ? 'Use this one, or run your own copy.' : 'Read it, change it, fork it.'} Built by ${xLink('finereli')}.</p>

    <div class="agents" role="group" aria-labelledby="agents-h"${full ? ' hidden' : ''}>
      <h2 id="agents-h">Or have your assistant set it up</h2>
      <div class="row">
        ${AGENTS.map((a) => `<button class="agent" type="button" data-name="${esc(a.name)}" data-url="${esc(a.url)}">${a.icon}${esc(a.name)}</button>`).join('\n        ')}
      </div>
      <p class="hint" id="hint" role="status"></p>
      <p class="muted paste">Click one, then paste into the chat.</p>
    </div>
  </div>

  <figure class="window" aria-label="An example of asking an assistant about WhatsApp messages">
    <div class="titlebar" aria-hidden="true"><i></i><i></i><i></i><b>Assistant</b></div>
    <div class="thread" id="thread" aria-hidden="true">
      <div class="empty" id="empty"><b>Your assistant can now search all your WhatsApp messages.</b><span>Ask it anything.</span></div>
    </div>
    <div class="composer" aria-hidden="true">
      <div class="field" id="field"><span id="typed"></span><span class="caret"></span><span class="ph">Ask about your WhatsApp...</span></div>
      <button class="send" id="send" type="button" tabindex="-1">${sendIcon}</button>
    </div>
    <figcaption class="sr">An example. Asked "${esc(first.q)}", the assistant searches the WhatsApp messages and answers: ${esc(first.a)}</figcaption>
  </figure>
</section>

<section class="wrap how" id="how">
  <ol class="steps">
    <li>
      <h2>${hosted ? 'Sign up and link your phone' : 'Link your phone'}</h2>
      <p>${hosted ? 'Sign in with Google, then scan' : "You'll scan"} a QR code, the same way you'd add WhatsApp Web. The first link imports your history, which takes a minute or two.</p>
    </li>
    <li>
      <h2>Connect your assistant</h2>
      <p>Add this address as an MCP server (ChatGPT calls it a connector) and sign in when it asks:</p>
      <div class="cmd"><code id="cmd">${esc(mcp)}</code><button id="copy" type="button">Copy</button></div>
      <p class="muted alt">In Claude Code: <code>${esc(claudeCode)}</code>, then type <code>/mcp</code>. Grok and any other client that speaks MCP work the same way.</p>
    </li>
  </ol>

  <section class="terms" aria-label="What this promises">
    <div>
      <h2>What you can count on</h2>
      <ul class="facts yes">
        <li><strong>It only reads.</strong>It can search and read your messages and remember names you give it. It can't send, edit or delete anything in WhatsApp.</li>
        <li><strong>Your messages are stored encrypted.</strong>${hosted
          ? 'The key comes from your Google sign-in and is never stored next to your messages, so a leaked database, a stolen backup or a peek inside the hosting account shows only noise.'
          : 'The key is made from your password and never stored in the clear. Without the password the stored copy is unreadable to everyone, including anyone with access to the database. There is no master key.'}</li>
        <li><strong>You can check.</strong>The code is open source, and ${hosted ? 'you can run your own copy for the price of a Cloudflare account' : 'this is your own copy'}.</li>
        <li><strong>You can leave.</strong>One button on your dashboard unlinks WhatsApp and erases everything.</li>
      </ul>
    </div>
    <div>
      <h2>What we don't promise</h2>
      <ul class="facts">
        <li><strong>It isn't end-to-end encryption.</strong>While your assistant is reading, the server sees your messages in plain text, and your assistant's provider sees whatever it reads.${hosted ? ' Whoever runs this service could in principle work out your key and read your messages. We don\'t, and the code is open source so you can check, but it is a promise and not a lock. If that matters, run your own copy, where the key is a password only you know.' : ''}</li>
        ${hosted
          ? '<li><strong>Your copy can disappear.</strong>Your messages are still in WhatsApp. This is only a copy, so if it is ever lost you link again and it imports what WhatsApp sends.</li>'
          : '<li><strong>A lost password can\'t be reset.</strong>Your messages are still in WhatsApp. This is only a copy, so you link again and it imports what WhatsApp sends.</li>'}
        <li><strong>WhatsApp discourages this.</strong>It connects the way WhatsApp Web does, through an unofficial library, which WhatsApp's terms discourage. There is a small chance WhatsApp restricts the account, so use it on your own account, read-only.</li>
        ${hosted && (caps.signupLimit || caps.maxMessages)
          ? `<li><strong>Spots are limited.</strong>${[caps.signupLimit ? `This service takes ${caps.signupLimit.toLocaleString()} people` : '', caps.maxMessages ? `${caps.signupLimit ? ' and ' : 'It takes '}accounts of up to ${caps.maxMessages.toLocaleString()} messages` : ''].join('')}. Anything bigger can run its own copy${caps.contact ? `, or message ${xLink(caps.contact)} on X` : ''}.</li>`
          : ''}
      </ul>
    </div>
  </section>

  <footer class="muted">
    <p><a href="${REPO}">Source and setup guide</a>. <a href="/privacy">Privacy policy</a>. <a href="/tos">Terms of service</a>.${caps.contact ? ` Questions: ${xLink(caps.contact)} on X.` : ''}</p>
  </footer>
</section>
</main>
<script>${copyScript}
${landingScript(SCENE, pasteMessage)}
(function () {
  fetch(${JSON.stringify(REPO_API)}).then(function (r) { return r.ok ? r.json() : null; }).then(function (j) {
    if (!j || typeof j.stargazers_count !== 'number') return;
    document.getElementById('starCount').textContent = j.stargazers_count.toLocaleString();
    document.getElementById('stars').className = 'count on';
  }).catch(function () {});
})();</script>
</body>
</html>`;
}

/**
 * The chat plays one scene, once: type the question, send it, wait while it searches, stream the answer, then
 * stop with the finished conversation on screen. With reduced motion it shows the finished scene straight away. The agent buttons copy the setup message.
 */
function landingScript(scene: typeof SCENE, pasteMessage: string): string {
  return `
(function () {
  var SCENE = ${JSON.stringify(scene)}, STATUS = ${JSON.stringify(STATUS)}, CHECK = ${JSON.stringify(checkIcon)};
  var MESSAGE = ${JSON.stringify(pasteMessage)};
  var $ = function (id) { return document.getElementById(id); };

  // ---- agent buttons: copy the message, open the assistant, say what to do next ----
  var hint = $('hint'), hintTimer;
  function say(text) { hint.textContent = text; clearTimeout(hintTimer); hintTimer = setTimeout(function () { hint.textContent = ''; }, 9000); }
  function copy(text) {
    if (navigator.clipboard && window.isSecureContext) return navigator.clipboard.writeText(text);
    return new Promise(function (ok, no) {
      var t = document.createElement('textarea'); t.value = text; t.style.position = 'fixed'; t.style.opacity = '0';
      document.body.appendChild(t); t.select();
      try { document.execCommand('copy') ? ok() : no(); } catch (e) { no(e); } document.body.removeChild(t);
    });
  }
  Array.prototype.forEach.call(document.querySelectorAll('.agent'), function (b) {
    b.onclick = function () {
      var name = b.getAttribute('data-name');
      var tab = window.open(b.getAttribute('data-url'), '_blank', 'noopener');
      copy(MESSAGE).then(function () { say('Copied. Paste it into ' + name + '.'); }, function () { say('Copy this into ' + name + ': ' + MESSAGE); });
      if (!tab) say('Copied. Open ' + name + ' and paste it there.');
    };
  });

  // ---- the chat ----
  var thread = $('thread'), typed = $('typed'), field = $('field'), send = $('send');
  if (!thread) return;
  var empty = $('empty');
  function el(cls, html) { var d = document.createElement('div'); d.className = cls; if (html) d.innerHTML = html; return d; }
  function esc(s) { return s.replace(/[&<>]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]; }); }
  if (matchMedia('(prefers-reduced-motion: reduce)').matches) {
    thread.innerHTML = '';
    thread.appendChild(el('msg me', esc(SCENE.q)));
    thread.appendChild(el('msg ai', '<div class="tool"><span class="tick">' + CHECK + '</span>' + esc(SCENE.found) + '</div><div class="answer">' + esc(SCENE.a) + '</div>'));
    return;
  }

  var sleep = function (ms) { return new Promise(function (r) { setTimeout(r, ms); }); };
  var seen = true;
  if ('IntersectionObserver' in window) new IntersectionObserver(function (e) { seen = e[0].isIntersecting; }).observe(thread);
  // wait while the tab is hidden or the chat is off screen, so it doesn't run its clock for nobody
  var visible = function () { return new Promise(function (r) { (function check() { (!document.hidden && seen) ? r() : setTimeout(check, 300); })(); }); };
  var pause = function (ms) { return visible().then(function () { return sleep(ms); }); };

  async function play(s) {
    typed.textContent = ''; field.className = 'field live'; send.className = 'send';
    await pause(900);
    for (var i = 0; i < s.q.length; i++) {
      typed.textContent += s.q[i]; field.className = 'field live has'; send.className = 'send on';
      await pause(34 + Math.random() * 58 + (s.q[i] === ' ' ? 40 : 0));
    }
    await pause(520);
    send.className = 'send on press'; await pause(150);
    typed.textContent = ''; field.className = 'field'; send.className = 'send';
    empty.className = 'empty gone'; await pause(400); thread.removeChild(empty);
    thread.appendChild(el('msg me', esc(s.q)));
    await pause(650);
    var ai = el('msg ai'), tool = el('tool', '<span class="spin"></span><span class="t">' + esc(STATUS) + '</span>'), ans = el('answer');
    ai.appendChild(tool); ai.appendChild(ans); thread.appendChild(ai);
    await pause(2100);
    tool.innerHTML = '<span class="tick">' + CHECK + '</span>' + esc(s.found);
    await pause(350);
    var words = s.a.split(' ');
    for (var j = 0; j < words.length; j++) {
      var w = document.createElement('span'); w.className = 'w'; w.textContent = (j ? ' ' : '') + words[j]; ans.appendChild(w);
      await pause(55 + Math.random() * 45);
    }
  }
  play(SCENE);
})();`;
}
