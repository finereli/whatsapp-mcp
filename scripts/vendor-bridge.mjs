// workerd refuses to compile wasm from bytes at runtime, and whatsapp-rust-bridge
// ships its wasm as base64 compiled via `new WebAssembly.Module(bytes)`. Extract
// the SIMD build into a real .wasm file so the bundler can include it as a
// CompiledWasm module, and patch the loader to use it. wrangler.config.ts aliases
// the package to vendor/whatsapp-rust-bridge.
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';

const src = readFileSync('node_modules/whatsapp-rust-bridge/dist/index.js', 'utf8');
const m = src.match(/if \(simdSupported && tryInit\("([A-Za-z0-9+/=]+)"\)\)/);
if (!m) throw new Error('could not find the SIMD wasm blob');
const tailStart = src.indexOf('var forceNoSimd');
const tailEnd = src.indexOf('var __wasmSimdActive = simdUsed;') + 'var __wasmSimdActive = simdUsed;'.length;
if (tailStart < 0 || tailEnd < tailStart) throw new Error('could not find the loader tail');

const out = 'vendor/whatsapp-rust-bridge';
mkdirSync(out, { recursive: true });
writeFileSync(`${out}/bridge.wasm`, Buffer.from(m[1], 'base64'));
const patched =
  src.slice(0, tailStart) +
  `import bridgeWasm from './bridge.wasm';\ninitSync({ module: bridgeWasm });\nvar __wasmSimdActive = true;` +
  src.slice(tailEnd);
writeFileSync(`${out}/index.js`, patched);
console.log(`vendored bridge: ${(m[1].length * 0.75 / 1e6).toFixed(1)}MB wasm`);
