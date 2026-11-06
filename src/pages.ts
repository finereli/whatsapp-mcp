/** The pages a person sees while signing in and linking their phone. */
import { esc, page, xLink } from './ui.js';

export function messagePage(title: string, text: string, status?: { href: string; label: string }) {
  return page(title, `<h1>${esc(title)}</h1><p>${esc(text)}</p>${status ? `<a class="button" href="${esc(status.href)}">${esc(status.label)}</a>` : ''}`);
}

export function consentPage(clientName: string, signInUrl: string, full = false, limit = 0) {
  return page('Allow access', `
<h1>Give ${esc(clientName)} read access?</h1>
<p>It will be able to search and read your WhatsApp messages, and to save names for phone numbers. It can't send anything.</p>
${full ? `<p class="notice">New signups are closed for now: ${limit ? `all ${limit.toLocaleString()} spots` : 'every spot'} are taken. If you already have an account, continue. If not, <a href="/#waitlist">join the waitlist</a> and I'll email you when a spot opens.</p>` : ''}
<a class="button" href="${esc(signInUrl)}">Continue</a>
<p class="muted" style="margin-top:20px"><a href="/privacy">Privacy policy</a> and <a href="/tos">terms of service</a></p>`);
}

/** Why it's full, in the operator's words. Shared by the front page and the "full" page. */
export const fullLine = (limit: number) =>
  `I set this up for ${limit ? `${limit.toLocaleString()} people` : 'a limited number of people'} on my own Cloudflare account, and they're all here. I'm working on making room for more. Leave your email and I'll let you know when a spot opens.`;

/** Scoped to .waitlist, because the front page has its own .field and .hint. */
export const waitlistCss = `
.waitlist { margin: 0 0 24px; }
.waitlist .wl-hint { margin: 6px 0 0; }
`;

/** The waitlist form. `source` says where it was shown, so the operator can tell a landing visitor from a sign-in. */
export function waitlistForm(source: string, email = '') {
  return `<form method="post" action="/waitlist" class="waitlist">
  <label for="wl-email">Your email</label>
  <input id="wl-email" type="email" name="email" autocomplete="email" required maxlength="254" value="${esc(email)}">
  <p class="muted wl-hint">I'll email you when a spot opens.</p>
  <input type="hidden" name="source" value="${esc(source)}">
  <input type="text" name="website" tabindex="-1" autocomplete="off" aria-hidden="true" style="position:absolute;left:-9999px">
  <button class="primary" type="submit">Join the waitlist</button>
</form>`;
}

/** Shown to someone who tries to sign up after the cap. */
export function fullPage(limit: number, contact?: string, email = '') {
  return page('Full for now', `
<h1>Full for now</h1>
<p>${fullLine(limit)}</p>
${waitlistForm('sign-in', email)}
<p>${contact ? `Questions? I'm ${xLink(contact)} on X. ` : ''}You can also run your own copy, which has no limit. <a href="https://github.com/finereli/whatsapp-mcp">The setup guide</a> takes a few minutes.</p>
<p class="muted"><a href="/">Back</a></p>`, { css: waitlistCss });
}

/** After joining the waitlist. */
export function waitlistDonePage(added: boolean, contact?: string) {
  return page('On the list', `
<h1>${added ? "You're on the list" : "You're already on the list"}</h1>
<p>I'll email you when a spot opens. ${contact ? `Questions? I'm ${xLink(contact)} on X.` : ''}</p>
<p class="muted"><a href="/">Back</a></p>`);
}

/** A waitlist submission that isn't an email address. */
export function waitlistErrorPage(contact?: string) {
  return page('Check the email', `
<h1>That doesn't look like an email address</h1>
${waitlistForm('retry')}
<p class="muted">${contact ? `Or message ${xLink(contact)} on X. ` : ''}<a href="/">Back</a></p>`, { css: waitlistCss });
}

const field = (id: string, label: string, input: string, hint = '') =>
  `<div class="field"><label for="${id}">${label}</label>${input}${hint ? `<p class="muted hint">${hint}</p>` : ''}</div>`;

const formCss = `
.field { margin: 0 0 18px; }
.hint { margin: 6px 0 0; }
`;

/** The password page of a copy that has one person. Everyone else signs in with Google and never sees this. */
export function loginPage(action: string, o: { error?: string }) {
  return page('Sign in', `
<h1>Your password</h1>
<form method="post" action="${esc(action)}">
  ${field('pw', 'The password you set for this server',
    `<input id="pw" type="password" name="password" autocomplete="current-password" autofocus required aria-describedby="${o.error ? 'e' : ''}">`)}
  ${o.error ? `<p class="err" id="e" role="alert">${esc(o.error)}</p>` : ''}
  <button class="primary">Sign in</button>
</form>`, { css: formCss });
}

const pairCss = `
.link { display: flex; gap: 28px; align-items: center; margin: 0 0 22px; }
.qr { flex: none; width: 236px; aspect-ratio: 1; padding: 12px; border-radius: 16px; background: #fff; display: grid; place-items: center; box-shadow: 0 0 0 1px var(--rule); }
.qr svg { width: 100%; height: 100%; display: block; }
.qr-wait { color: #55656f; font-size: 0.9rem; text-align: center; padding: 0 12px; }
@media (max-width: 560px) { .link { flex-direction: column; align-items: flex-start; } .qr { width: min(100%, 300px); } }

.code { display: flex; gap: 6px; margin: 0 0 22px; align-items: center; }
.code span { width: 2.2ch; padding: 10px 0; text-align: center; border: 1.5px solid var(--rule); border-radius: 8px; background: var(--theirs); font: 600 1.6rem/1 ui-monospace, SFMono-Regular, Menlo, monospace; }
.code i { width: 10px; height: 2px; background: var(--muted); }

.progress { height: 10px; border-radius: 999px; background: var(--rule); overflow: hidden; margin: 6px 0 14px; max-width: 34rem; }
.bar { height: 100%; width: 0; border-radius: 999px; background: var(--action); transition: width .6s ease; }
.bar.wait { width: 35%; animation: slide 1.4s ease-in-out infinite; }
@keyframes slide { 0% { margin-left: -35%; } 100% { margin-left: 100%; } }
@media (prefers-reduced-motion: reduce) { .bar { transition: none; } .bar.wait { animation: none; margin-left: 0; } }
.stat { font-size: 1.05rem; }
.tick { display: inline-block; vertical-align: -3px; margin-right: 8px; color: var(--action); }
.section { margin-top: 34px; }
.quiet { margin-top: 44px; padding-top: 18px; border-top: 1px solid var(--rule); }
.quiet .row { display: flex; gap: 14px; align-items: center; flex-wrap: wrap; }
`;

/** `req` is the base64 OAuth request to complete once linked, or null for the standalone /setup flow. */
export function pairPage(token: string, req: string | null) {
  return page('Link WhatsApp', `<div id="app" aria-live="polite"></div>`, {
    css: pairCss,
    script: `var T = ${JSON.stringify(token)}, REQ = ${JSON.stringify(req)};\n${PAIR_JS}`,
  });
}

// No template literals in here on purpose: this is plain browser JS embedded in a TS template string.
const PAIR_JS = `
var app = document.getElementById('app');
var mode = 'qr', view = '', redirecting = false, shownCode = null;
var tickIcon = '<svg class="tick" width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M20 6 9 17l-5-5"/></svg>';

function post(path, body) {
  return fetch(path, { method: 'POST', headers: { 'content-type': 'application/json', authorization: 'Bearer ' + T }, body: JSON.stringify(body || {}) });
}
function get(path) {
  return fetch(path, { headers: { authorization: 'Bearer ' + T } }).then(function (r) { if (r.status === 401) throw new Error('expired'); return r.json(); });
}
function el(id) { return document.getElementById(id); }
function fmt(n) { return Number(n).toLocaleString(); }
function howto(steps) { return '<ol class="how">' + steps.map(function (s) { return '<li>' + s + '</li>'; }).join('') + '</ol>'; }

// Rebuild a screen only when it changes, so the QR and progress bar can update in place without flicker.
function screen(name, html) {
  if (view === name) return false;
  view = name; app.innerHTML = html; return true;
}

function qrScreen() {
  if (!screen('qr',
    '<h1>Link your phone</h1>' +
    '<div class="link"><div class="qr" id="qr"><div class="qr-wait">Connecting to WhatsApp...</div></div>' +
    howto(['Open WhatsApp on your phone', 'Go to Settings, then Linked Devices', 'Tap Link a Device and scan this code']) + '</div>' +
    '<p class="muted">The code refreshes by itself. <button class="text" id="switch" type="button">Use a phone number instead</button></p>')) return;
  el('switch').onclick = function () { mode = 'code'; shownCode = null; };
}

function codeScreen() {
  var first = screen('code',
    '<h1>Link with a phone number</h1>' +
    '<div id="codeArea"><form id="f"><label for="phone">Your WhatsApp number, with country code</label>' +
    '<input id="phone" inputmode="tel" autocomplete="tel" placeholder="+972 50 123 4567" required autofocus>' +
    '<p id="codeErr" class="err" role="alert" style="margin:10px 0 0"></p><button class="primary" type="submit">Get code</button></form></div>' +
    '<p class="muted" style="margin-top:22px"><button class="text" id="switch" type="button">Scan a QR code instead</button></p>');
  if (!first) return;
  el('switch').onclick = function () { mode = 'qr'; };
  el('f').onsubmit = function (e) {
    e.preventDefault();
    var btn = e.target.querySelector('button'); btn.disabled = true; btn.textContent = 'Requesting...';
    post('/pair/code', { phone: el('phone').value }).then(function (r) { return r.json(); }).then(function (j) {
      if (j.code) {
        shownCode = j.code;
        var chars = j.code.replace(/[^A-Za-z0-9]/g, '').split('');
        el('codeArea').innerHTML = '<div class="code" aria-label="Pairing code">' +
          chars.map(function (c, i) { return (i === 4 ? '<i></i>' : '') + '<span>' + c + '</span>'; }).join('') + '</div>' +
          howto(['On your phone, open Settings, then Linked Devices', 'Tap Link a Device, then Link with phone number instead', 'Enter this code']);
      } else {
        el('codeErr').textContent = j.error || 'Could not get a code. Check the number and try again.';
        btn.disabled = false; btn.textContent = 'Get code';
      }
    });
  };
}

function importScreen(s) {
  screen('import',
    '<h1>Importing your messages</h1>' +
    '<div class="progress" role="progressbar" aria-valuemin="0" aria-valuemax="100"><div class="bar" id="bar"></div></div>' +
    '<p class="stat" id="count"></p>' +
    '<p class="muted">You can close this page. The import keeps going in the background.</p>');
  var bar = el('bar');
  if (typeof s.progress === 'number') { bar.className = 'bar'; bar.style.width = Math.max(4, s.progress) + '%'; bar.parentNode.setAttribute('aria-valuenow', s.progress); }
  else { bar.className = 'bar wait'; }
  el('count').textContent = s.messages ? fmt(s.messages) + ' messages from ' + fmt(s.chats) + ' chats' + (typeof s.progress === 'number' ? ' (' + s.progress + '%)' : '') : 'Waiting for WhatsApp to send your history...';
}

function rejectedScreen(s) {
  var lim = s.limits.messages ? fmt(s.limits.messages) + ' messages' : s.limits.mb + ' MB';
  var dm = s.contact ? ' Message <a href="https://x.com/' + s.contact + '" rel="noopener">@' + s.contact + '</a> on X and we can talk about it.' : '';
  if (!screen('rejected',
    '<h1>Your history is too big for this service</h1>' +
    '<p>WhatsApp sent more than this service takes (' + lim + '). Nothing was kept: what arrived has been deleted and your phone is unlinked.</p>' +
    '<p>You can run your own copy, which has no limit: <a href="https://github.com/finereli/whatsapp-mcp">the setup guide</a> takes a few minutes.' + dm + '</p>' +
    '<div class="quiet"><div class="row" id="relinkRow"><button class="text" id="erase" type="button">Delete my account</button><a href="/signout">Sign out</a></div></div>')) return;
  wireErase();
}

function wireErase() {
  el('erase').onclick = function () {
    el('relinkRow').innerHTML = '<span>Delete every message and your account? This can\\'t be undone.</span> <button class="primary" id="yes" type="button">Delete everything</button> <button class="text" id="no" type="button">Cancel</button>';
    el('no').onclick = function () { view = ''; };
    el('yes').onclick = function () { this.disabled = true; this.textContent = 'Deleting...'; post('/pair/delete').then(function () { location.href = '/signout'; }); };
  };
}

function doneScreen(s) {
  if (REQ) { screen('finishing', '<h1>' + tickIcon + 'Linked</h1><p>Finishing sign-in...</p>'); return finish(); }
  var cmd = 'claude mcp add --transport http whatsapp ' + location.origin + '/mcp';
  if (!screen('done',
    '<h1>' + tickIcon + 'WhatsApp is linked</h1>' +
    '<p class="stat" id="summary"></p><p class="err" id="fullnote"></p><p class="muted" id="unnamed"></p>' +
    '<div class="section"><h2>Connect your agent</h2>' +
    '<p>In Claude Code, run this, then type <code>/mcp</code> and sign in:</p>' +
    '<div class="cmd"><code id="cmd"></code><button id="copy" type="button">Copy</button></div>' +
    '<p class="muted">Other MCP clients: point them at <code id="url"></code>.</p></div>' +
    '<div class="quiet"><div class="row" id="relinkRow"><button class="text" id="relink" type="button">Unlink and scan again</button>' +
    '<button class="text" id="erase" type="button">Delete my data</button><a href="/signout">Sign out</a></div></div>')) { summarize(s); return; }
  summarize(s);
  el('cmd').textContent = cmd; el('url').textContent = location.origin + '/mcp';
  el('copy').onclick = function () {
    var b = el('copy');
    function done(t) { b.textContent = t; setTimeout(function () { b.textContent = 'Copy'; }, 1800); }
    if (navigator.clipboard) navigator.clipboard.writeText(cmd).then(function () { done('Copied'); }, function () { done('Select it'); }); else done('Select it');
  };
  el('relink').onclick = function () {
    el('relinkRow').innerHTML = '<span>Unlink this phone? Your stored messages are kept.</span> <button class="primary" id="yes" type="button">Unlink</button> <button class="text" id="no" type="button">Cancel</button>';
    el('no').onclick = function () { view = ''; };
    el('yes').onclick = function () { this.disabled = true; this.textContent = 'Unlinking...'; post('/pair/relink').then(function () { location.reload(); }); };
  };
  wireErase();
}

function summarize(s) {
  el('summary').textContent = fmt(s.messages) + ' messages from ' + fmt(s.chats) + ' chats are stored and ready.';
  el('fullnote').innerHTML = s.full ? 'This account has reached the size limit for this service, so new messages are no longer being added.' + (s.contact ? ' Message <a href="https://x.com/' + s.contact + '" rel="noopener">@' + s.contact + '</a> on X.' : '') : '';
  el('unnamed').textContent = s.unnamed ? fmt(s.unnamed) + ' chats are known only by phone number. Ask your agent to find their names in your contacts.' : '';
}

function finish() {
  if (redirecting) return; redirecting = true;
  post('/pair/finish', { req: REQ }).then(function (r) { return r.json(); }).then(function (j) {
    if (j.redirectTo) location.href = j.redirectTo;
    else { redirecting = false; el('app').insertAdjacentHTML('beforeend', '<p class="err">' + (j.error || 'Could not finish sign-in.') + '</p>'); }
  });
}

function tick() {
  get('/pair/status').then(function (s) {
    if (s.rejected) rejectedScreen(s);
    else if (s.paired && s.running) importScreen(s);
    else if (s.paired) doneScreen(s);
    else {
      if (mode === 'qr') { qrScreen(); var q = el('qr'); if (q && s.qrSvg) q.innerHTML = s.qrSvg; }
      else codeScreen();
    }
    setTimeout(tick, 1500);
  }).catch(function (e) {
    if (e.message === 'expired') {
      app.innerHTML = '<h1>Session expired</h1><p>Sign in again to continue.</p><a class="button" href="/setup">Sign in</a>';
    } else { setTimeout(tick, 3000); }
  });
}

post('/pair/start').then(tick);
`;
