// The source imports './x.js' (what the bundler wants); under node the file is './x.ts'.
import { register } from 'node:module';
register('data:text/javascript,' + encodeURIComponent(`
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
export async function resolve(spec, ctx, next) {
  if (spec.startsWith('.') && spec.endsWith('.js') && ctx.parentURL?.startsWith('file:')) {
    const ts = new URL(spec.slice(0, -3) + '.ts', ctx.parentURL);
    if (existsSync(fileURLToPath(ts))) return next(ts.href, ctx);
  }
  return next(spec, ctx);
}`));
