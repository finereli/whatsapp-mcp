import { defineWranglerConfig } from 'wrangler/experimental-config';

// cf uses Wrangler as the bundler; runtime configuration lives in cloudflare.config.ts.
export default defineWranglerConfig({
  alias: {
    ws: './src/ws-shim.ts',
    'lru-cache': './src/lru-shim.ts',
    'whatsapp-rust-bridge': './vendor/whatsapp-rust-bridge/index.js',
  },
  rules: [{ type: 'CompiledWasm', globs: ['**/*.wasm'], fallthrough: true }],
  // The project already maintains its runtime types and explicit Env interfaces.
  types: { generate: false },
});
