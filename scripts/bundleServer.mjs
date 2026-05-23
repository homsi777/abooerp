/**
 * esbuild — يجمع سيرفر Express بجميع تبعياته في ملف ESM واحد.
 * الناتج: dist-server/server.mjs
 * ثم يُنشئ dist-server/server-wrapper.cjs لتشغيله عبر utilityProcess.fork()
 *
 * يُستخدم في: npm run electron:package
 */

import { build } from 'esbuild';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '..');

console.log('[bundle-server] Building server bundle...');

await build({
  entryPoints: [path.join(root, 'server/src/index.ts')],
  bundle: true,
  platform: 'node',
  target: 'node20',
  // CJS is required: express and pg use dynamic require() internally.
  // ESM bundles break with "Dynamic require of X is not supported" errors.
  format: 'cjs',
  outfile: path.join(root, 'dist-server/server.cjs'),
  external: ['fsevents'],
  sourcemap: 'inline',
  minify: false,
  define: {
    'process.env.NODE_ENV': '"production"',
  },
  alias: {
    'pg-native': path.join(root, 'scripts/_stub.cjs'),
  },
});

console.log('[bundle-server] ✅ dist-server/server.cjs written successfully.');

// ── CJS wrapper ──────────────────────────────────────────────────────────────
// A thin CJS entry that loads server.cjs (also CJS) and captures fatal errors.
const wrapper = `'use strict';
// Auto-generated CJS wrapper that loads the server bundle
const path = require('path');
const fs   = require('fs');

const serverCjs = path.join(__dirname, 'server.cjs');
const logFile   = path.join(process.env.APPDATA || process.env.HOME || '', 'server-crash.log');

function fatal(err) {
  const msg = '[server-wrapper] FATAL: ' + (err && err.stack ? err.stack : String(err)) + '\\n';
  process.stderr.write(msg);
  try { fs.appendFileSync(logFile, new Date().toISOString() + ' ' + msg); } catch {}
  process.exit(1);
}

process.on('uncaughtException', fatal);
process.on('unhandledRejection', fatal);

try {
  require(serverCjs);
} catch (e) {
  fatal(e);
}
`;

fs.writeFileSync(path.join(root, 'dist-server/server-wrapper.cjs'), wrapper, 'utf-8');
console.log('[bundle-server] ✅ dist-server/server-wrapper.cjs written successfully.');
