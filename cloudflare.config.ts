import { readFileSync } from 'node:fs';
import { URL } from 'node:url';
import { bindings, defineConfig, exports, triggers } from 'cf/config';

interface DeploymentSettings {
  accountId?: string;
  name?: string;
  oauthKvId?: string;
  domain?: string;
  vars?: Record<string, string>;
}

export default defineConfig((ctx) => {
  // Keep a deployment's own IDs and domain out of the shared template.
  // --mode private means private deployment settings, not local execution.
  const settings: DeploymentSettings = ctx.mode === 'private'
    ? JSON.parse(readFileSync(new URL('./cloudflare.local.json', import.meta.url), 'utf8'))
    : {};
  const name = settings.name ?? 'whatsapp-mcp';

  return {
    accountId: settings.accountId,
    worker: {
      name,
      entrypoint: 'src/index.ts',
      compatibilityDate: '2025-09-01',
      compatibilityFlags: ['nodejs_compat'],
      observability: { enabled: true },
      domains: settings.domain ? [settings.domain] : [],

      // First history import decodes a lot of protobuf. Needs Workers Paid.
      limits: { cpuMs: 300000 },

      // Preserve the existing class name and SQLite namespace when upgrading.
      exports: {
        WhatsAppStore: exports.durableObject({ storage: 'sqlite' }),
      },
      env: {
        WA: bindings.durableObject({ worker: name, exportName: 'WhatsAppStore' }),
        // Create with: npx cf kv namespaces create --title OAUTH_KV
        OAUTH_KV: bindings.kv({ id: settings.oauthKvId ?? 'REPLACE_WITH_KV_NAMESPACE_ID' }),
        OWNER_PASSWORD: bindings.secret(),
        ...Object.fromEntries(Object.entries(settings.vars ?? {}).map(([key, value]) => [key, bindings.text(value)])),
      },
      triggers: [
        // Daily pull, so WhatsApp's per-device queue never goes stale.
        triggers.scheduled({ schedule: '0 4 * * *' }),
      ],
    },
  };
});
