/**
 * devStartup.cjs — بدء بيئة التطوير بشكل كامل وآمن
 * ═══════════════════════════════════════════════════
 * الخطوات:
 *   1. تحرير المنافذ المستخدمة
 *   2. التأكد من وجود قاعدة البيانات
 *   3. تشغيل المايجريشن
 *   4. تشغيل السيد (البيانات الأولية)
 */

'use strict';

const { execSync, spawn } = require('node:child_process');
const path   = require('node:path');
const fs     = require('node:fs');

const ROOT = path.resolve(__dirname, '..', '..');

// ── تحميل .env يدوياً قبل أي شيء ──────────────────────────────────────────
const envPath = path.join(ROOT, 'server', '.env');
if (fs.existsSync(envPath)) {
  const lines = fs.readFileSync(envPath, 'utf-8').split('\n');
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eq = trimmed.indexOf('=');
    if (eq < 0) continue;
    const key = trimmed.slice(0, eq).trim();
    const val = trimmed.slice(eq + 1).trim();
    if (!process.env[key]) process.env[key] = val;
  }
}

// ── قراءة المنافذ ──────────────────────────────────────────────────────────
const devPorts = JSON.parse(
  fs.readFileSync(path.join(ROOT, 'config', 'dev-ports.json'), 'utf-8'),
);
const API_PORT  = devPorts.api  || 4010;
const VITE_PORT = devPorts.vite || 5188;

// ── مساعد: تنفيذ أمر متزامن مع عرض مخرجاته ────────────────────────────────
function run(label, cmd, opts = {}) {
  console.log(`\n\x1b[36m► ${label}\x1b[0m`);
  try {
    execSync(cmd, {
      stdio: 'inherit',
      cwd: ROOT,
      env: { ...process.env },
      ...opts,
    });
    console.log(`\x1b[32m  ✓ ${label} — اكتملت\x1b[0m`);
  } catch (err) {
    console.error(`\x1b[31m  ✗ ${label} — فشلت\x1b[0m`);
    throw err;
  }
}

// ── مساعد: تحرير منفذ بأمان ─────────────────────────────────────────────────
async function tryKillPort(port) {
  try {
    const killPort = require('kill-port');
    await killPort(port);
  } catch { /* المنفذ حر أو kill-port غير متوفر */ }
}

// ════════════════════════════════════════════════════════════════════════════
async function main() {
  console.log('\n\x1b[1m\x1b[34m');
  console.log('╔═══════════════════════════════════════════════════════╗');
  console.log('║  شركة عبو المحمود لنقل والخدمات الوجستية — بدء بيئة التطوير  ║');
  console.log('╚═══════════════════════════════════════════════════════╝');
  console.log('\x1b[0m');

  // 1. تحرير المنافذ
  console.log(`\x1b[36m► تحرير المنافذ ${API_PORT} و ${VITE_PORT}...\x1b[0m`);
  await Promise.all([tryKillPort(API_PORT), tryKillPort(VITE_PORT)]);
  console.log(`\x1b[32m  ✓ المنافذ محررة\x1b[0m`);

  // 2. التأكد من قاعدة البيانات
  run('التحقق من قاعدة البيانات', 'node server/scripts/ensureDatabase.cjs');

  // 3. تشغيل المايجريشن
  run('تشغيل المايجريشن', 'npx tsx server/src/db/migrate.ts');

  // 4. تشغيل السيد
  run('تهيئة البيانات الأولية', 'npx tsx server/src/db/seed.ts');

  console.log('\n\x1b[1m\x1b[32m');
  console.log('╔═══════════════════════════════════════════════════════╗');
  console.log('║  ✅ قاعدة البيانات جاهزة — بدء تشغيل التطبيق...     ║');
  console.log(`║  🖥  السيرفر : http://127.0.0.1:${API_PORT}                 ║`);
  console.log(`║  ⚡ Vite    : http://127.0.0.1:${VITE_PORT}                 ║`);
  console.log('╚═══════════════════════════════════════════════════════╝');
  console.log('\x1b[0m');
}

main().catch((err) => {
  console.error('\n\x1b[31m[devStartup] فشل الإعداد المسبق:\x1b[0m', err?.message ?? err);
  process.exit(1);
});
