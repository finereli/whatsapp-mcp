/** Shared look for every page the Worker serves: tokens, type, buttons, and the document shell. */

export const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);

/** An X handle is letters, digits and underscores, at most 15. Anything else is dropped, since it ends up in HTML and URLs. */
export const xHandle = (v?: string): string | undefined => {
  const h = (v ?? '').trim().replace(/^@/, '');
  return /^[A-Za-z0-9_]{1,15}$/.test(h) ? h : undefined;
};
/** " DM @name on X (link)." if the operator gave a handle, else nothing. */
export const contactText = (v?: string) => { const h = xHandle(v); return h ? ` DM @${h} on X (https://x.com/${h}).` : ''; };
export const xLink = (handle: string) => `<a href="https://x.com/${handle}" rel="noopener">@${handle}</a>`;

export const baseCss = `
:root {
  --fog: #eef1f3; --ink: #14212b; --muted: #55656f; --rule: #cbd5db;
  --mine: #d9f0c9; --theirs: #ffffff; --action: #0b5d4b; --action-ink: #ffffff; --code: #e1e7eb; --err: #a8261d;
}
@media (prefers-color-scheme: dark) {
  :root { --fog: #0f1a21; --ink: #e7eef2; --muted: #93a3ad; --rule: #263640; --mine: #24493a; --theirs: #1a2832; --action: #5fd1a8; --action-ink: #0a1d16; --code: #172630; --err: #ff9a8f; }
}
* { box-sizing: border-box; }
html { -webkit-text-size-adjust: 100%; }
body { margin: 0; background: var(--fog); color: var(--ink); font: 17px/1.55 ui-sans-serif, system-ui, -apple-system, "Segoe UI", sans-serif; }
main { max-width: 40rem; margin: 0 auto; padding: 56px 16px 72px; }
h1 { font: 600 clamp(1.9rem, 6vw, 2.6rem)/1.1 "Iowan Old Style", "Palatino Linotype", Georgia, serif; letter-spacing: -0.015em; margin: 0 0 20px; }
h2 { font: 600 1.25rem/1.3 "Iowan Old Style", "Palatino Linotype", Georgia, serif; margin: 0 0 6px; }
p { margin: 0 0 16px; max-width: 34rem; }
a { color: inherit; }
.muted { color: var(--muted); font-size: 0.94rem; }
.err { color: var(--err); font-size: 0.94rem; }
.notice { border-left: 3px solid var(--action); padding: 8px 0 8px 14px; }
code { background: var(--code); border-radius: 5px; padding: 1px 6px; font: 0.88em ui-monospace, SFMono-Regular, Menlo, monospace; }

.button, button.primary { display: inline-block; font: 600 1rem/1 ui-sans-serif, system-ui, sans-serif; padding: 13px 20px; border-radius: 10px; background: var(--action); color: var(--action-ink); text-decoration: none; border: 0; cursor: pointer; }
.button:hover, button.primary:hover { filter: brightness(1.08); }
button.text { font: inherit; color: inherit; background: none; border: 0; padding: 0; text-decoration: underline; text-underline-offset: 3px; cursor: pointer; }
a:focus-visible, button:focus-visible, input:focus-visible { outline: 3px solid var(--ink); outline-offset: 3px; }

label { display: block; font-weight: 600; margin-bottom: 8px; }
input { width: 100%; max-width: 22rem; font: inherit; padding: 12px 14px; border: 1.5px solid var(--rule); border-radius: 10px; background: var(--theirs); color: var(--ink); }
input:focus { border-color: var(--ink); }
form .button, form button.primary { margin-top: 14px; display: block; }

.how { margin: 0; padding-left: 22px; display: grid; gap: 8px; }
.cmd { display: flex; gap: 8px; align-items: stretch; margin: 10px 0 12px; }
.cmd code { flex: 1; min-width: 0; overflow-x: auto; white-space: nowrap; border-radius: 10px; padding: 12px 14px; font-size: 0.88rem; }
.cmd button { font: 600 0.9rem/1 ui-sans-serif, system-ui, sans-serif; padding: 0 16px; border-radius: 10px; background: var(--action); color: var(--action-ink); border: 0; cursor: pointer; }
`;

/** The icon links every page carries. The files are served by the Worker (see brand.ts). */
export const iconLinks = `<link rel="icon" href="/favicon.svg" type="image/svg+xml"><link rel="icon" href="/favicon-32.png" type="image/png" sizes="32x32"><link rel="apple-touch-icon" href="/apple-touch-icon.png">`;

export function page(title: string, body: string, opts: { css?: string; script?: string } = {}) {
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(title)}</title>${iconLinks}<style>${baseCss}${opts.css ?? ''}</style></head>
<body><main>${body}</main>${opts.script ? `<script>${opts.script}</script>` : ''}</body></html>`;
}

/** The copy-to-clipboard behaviour shared by the front page and the done screen. Expects #cmd and #copy. */
export const copyScript = `
(function () {
  var b = document.getElementById('copy'), c = document.getElementById('cmd');
  if (!b || !c) return;
  b.onclick = function () {
    function done(t) { b.textContent = t; setTimeout(function () { b.textContent = 'Copy'; }, 1800); }
    if (navigator.clipboard) navigator.clipboard.writeText(c.textContent).then(function () { done('Copied'); }, function () { done('Select it'); });
    else done('Select it');
  };
})();`;
