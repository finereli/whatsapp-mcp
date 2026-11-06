#!/usr/bin/env node
/**
 * Rebuild wrangler.local.jsonc from what is deployed, for when the local file is lost or you're on a new machine.
 *
 *   CLOUDFLARE_API_TOKEN=... node scripts/pull-config.mjs [worker-name] [--force] [--out file]
 *
 * It reads the live Worker's settings from Cloudflare (bindings, vars, KV and Durable Object namespaces, email,
 * custom domains, cron schedules, limits, the last migration applied) and merges them over wrangler.jsonc, which
 * supplies what Cloudflare doesn't report (main, alias, rules). Secrets stay on Cloudflare: only their names are
 * listed, as a comment. The output is gitignored; it holds your own ids and addresses.
 *
 * Set CLOUDFLARE_ACCOUNT_ID if the token can see more than one account. Needs Node 18+.
 */
import { existsSync, readFileSync, writeFileSync } from 'node:fs';

const args = process.argv.slice(2);
const force = args.includes('--force');
const outIdx = args.indexOf('--out');
const out = outIdx >= 0 ? args[outIdx + 1] : 'wrangler.local.jsonc';
const named = args.filter((a, i) => !a.startsWith('--') && args[i - 1] !== '--out')[0];

const token = process.env.CLOUDFLARE_API_TOKEN;
if (!token) fail('Set CLOUDFLARE_API_TOKEN (a token that can read Workers settings).');
if (existsSync(out) && !force) fail(`${out} exists. Pass --force to overwrite it, or --out another file.`);

/** wrangler.jsonc has comments and trailing commas; JSON.parse wants neither. */
function parseJsonc(text) {
  let s = '', inStr = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inStr) { s += c; if (c === '\\') s += text[++i]; else if (c === '"') inStr = false; continue; }
    if (c === '"') { inStr = true; s += c; continue; }
    if (c === '/' && text[i + 1] === '/') { while (i < text.length && text[i] !== '\n') i++; s += '\n'; continue; }
    if (c === '/' && text[i + 1] === '*') { i = text.indexOf('*/', i + 2) + 1; continue; }
    s += c;
  }
  return JSON.parse(s.replace(/,(\s*[}\]])/g, '$1'));
}

const template = parseJsonc(readFileSync('wrangler.jsonc', 'utf8'));
const name = named ?? template.name;

async function cf(path) {
  const res = await fetch(`https://api.cloudflare.com/client/v4${path}`, { headers: { authorization: `Bearer ${token}` } });
  const body = await res.json().catch(() => ({}));
  if (!res.ok || body.success === false) throw new Error(`${path}: ${res.status} ${JSON.stringify(body.errors ?? body).slice(0, 300)}`);
  return body.result;
}

let account = process.env.CLOUDFLARE_ACCOUNT_ID;
if (!account) {
  const accounts = await cf('/accounts');
  if (accounts.length !== 1) fail(`The token sees ${accounts.length} accounts. Set CLOUDFLARE_ACCOUNT_ID.`);
  account = accounts[0].id;
}
const base = `/accounts/${account}/workers`;

const scripts = await cf(`${base}/scripts`);
const script = scripts.find((s) => s.id === name);
if (!script) fail(`No Worker named "${name}" in this account. Pass the name as the first argument.`);
const [settings, schedules, subdomain, domains] = await Promise.all([
  cf(`${base}/scripts/${name}/settings`),
  cf(`${base}/scripts/${name}/schedules`).catch(() => ({ schedules: [] })),
  cf(`${base}/scripts/${name}/subdomain`).catch(() => ({ enabled: false })),
  cf(`${base}/domains`).catch(() => []),
]);

const config = {
  $schema: template.$schema,
  name,
  main: template.main,
  compatibility_date: settings.compatibility_date ?? template.compatibility_date,
  compatibility_flags: settings.compatibility_flags ?? template.compatibility_flags,
  observability: { enabled: Boolean(settings.observability?.enabled) },
  workers_dev: Boolean(subdomain.enabled),
  alias: template.alias,
  rules: template.rules,
};

const routes = domains.filter((d) => d.service === name).map((d) => ({ pattern: d.hostname, custom_domain: true }));
if (routes.length) config.routes = routes;

const vars = {}, secrets = [], unknown = [];
const dos = [], kv = [], email = [];
for (const b of settings.bindings) {
  if (b.type === 'plain_text') vars[b.name] = b.text;
  else if (b.type === 'json') vars[b.name] = b.json;
  else if (b.type === 'secret_text') secrets.push(b.name);
  else if (b.type === 'durable_object_namespace') dos.push({ name: b.name, class_name: b.class_name });
  else if (b.type === 'kv_namespace') kv.push({ binding: b.name, id: b.namespace_id });
  else if (b.type === 'send_email') email.push({ name: b.name, ...(b.destination_address ? { destination_address: b.destination_address } : {}), ...(b.allowed_destination_addresses ? { allowed_destination_addresses: b.allowed_destination_addresses } : {}) });
  else unknown.push(`${b.name} (${b.type})`);
}
if (dos.length) config.durable_objects = { bindings: dos };

// Wrangler sends only the migrations after the Worker's last applied tag, and refuses a list that doesn't
// contain it. A copy deployed from another config may be further along than the repo, so pad with empty steps.
const migrations = [...(template.migrations ?? [])];
const live = script.migration_tag;
if (live && !migrations.some((m) => m.tag === live)) {
  const n = Number(/^v(\d+)$/.exec(live)?.[1]);
  const have = migrations.map((m) => Number(/^v(\d+)$/.exec(m.tag)?.[1])).filter(Number.isFinite);
  if (Number.isFinite(n) && have.length && n > Math.max(...have)) {
    for (let i = Math.max(...have) + 1; i <= n; i++) migrations.push({ tag: `v${i}` });
  } else {
    unknown.push(`migration tag "${live}" is not in wrangler.jsonc and can't be padded: add it by hand`);
  }
}
config.migrations = migrations;
if (kv.length) config.kv_namespaces = kv;
if (settings.limits?.cpu_ms) config.limits = { cpu_ms: settings.limits.cpu_ms };
const crons = (schedules.schedules ?? []).map((s) => s.cron);
if (crons.length) config.triggers = { crons };
if (email.length) config.send_email = email;
if (Object.keys(vars).length) config.vars = vars;

const notes = [
  `// ${out}: pulled from the live Worker "${name}" on ${new Date().toISOString().slice(0, 10)} by scripts/pull-config.mjs.`,
  `// Not committed: it holds this deployment's own ids and addresses.`,
  secrets.length ? `// Secrets on the Worker (kept there, not here): ${secrets.join(', ')}` : '',
  live && !template.migrations?.some((m) => m.tag === live) ? `// Migrations after the repo's own are empty placeholders up to the live tag (${live}).` : '',
  ...unknown.map((u) => `// NOT CARRIED OVER, check by hand: ${u}`),
].filter(Boolean);
writeFileSync(out, `${notes.join('\n')}\n${JSON.stringify(config, null, 2)}\n`);
console.log(`Wrote ${out}.${unknown.length ? `\n${unknown.length} thing(s) to check by hand: ${unknown.join('; ')}` : ''}`);
console.log(`Check it with: npx wrangler deploy -c ${out} --dry-run`);

function fail(msg) { console.error(msg); process.exit(1); }
