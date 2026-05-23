/**
 * validatePackage.mjs — التحقق من صحة ملفات التغليف قبل إنشاء التطبيق المغلف
 * ═════════════════════════════════════════════════════════════════════════════
 * 
 * يتحقق من:
 *   1. وجود ملف server/.env (لأنه سيتم نسخه إلى app-config.env في الموارد)
 *   2. وجود dist-server/server.cjs (السيرفر المجمع)
 *   3. وجود dist/ (واجهة المستخدم المبنية)
 *   4. وجود dist-electron/main.js (الـ Electron المترجم)
 * 
 * يُستخدم في: npm run electron:package (قبل electron-builder)
 */

import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '..');

const checks = [
  { name: 'server/.env', path: path.join(root, 'server', '.env'), critical: true },
  { name: 'dist-server/server.cjs', path: path.join(root, 'dist-server', 'server.cjs'), critical: true },
  { name: 'dist-server/server-wrapper.cjs', path: path.join(root, 'dist-server', 'server-wrapper.cjs'), critical: true },
  { name: 'dist/', path: path.join(root, 'dist'), critical: true, isDir: true },
  { name: 'dist-electron/main.js', path: path.join(root, 'dist-electron', 'main.js'), critical: true },
];

console.log('\n\x1b[1m\x1b[34m╔════════════════════════════════════════════════════╗');
console.log('║  التحقق من صحة ملفات التغليف                       ║');
console.log('╚════════════════════════════════════════════════════╝\x1b[0m\n');

let allOk = true;

for (const check of checks) {
  const exists = check.isDir
    ? fs.existsSync(check.path) && fs.statSync(check.path).isDirectory()
    : fs.existsSync(check.path);

  const icon = exists ? '✅' : '❌';
  const severity = check.critical ? '[CRITICAL]' : '[INFO]';
  
  console.log(`${icon} ${severity} ${check.name}`);

  if (!exists) {
    if (check.critical) {
      allOk = false;
      console.log(`   💥 الملف مفقود ولا يمكن الاستمرار\n`);
    } else {
      console.log(`   ⚠️  الملف مفقود (تحذير فقط)\n`);
    }
  }
}

if (!allOk) {
  console.error('\n\x1b[31m╔════════════════════════════════════════════════════╗');
  console.error('║  ❌ فشل التحقق — لا يمكن إنشاء التطبيق المغلف        ║');
  console.error('╚════════════════════════════════════════════════════╝\x1b[0m\n');
  
  console.log('🔧 الخطوات المطلوبة:\n');
  console.log('1️⃣  تأكد من وجود ملف server/.env');
  console.log('   إذا لم يكن موجوداً، انسخه من server/.env.example:\n');
  console.log('   $ cp server/.env.example server/.env\n');
  
  console.log('2️⃣  تأكد من تشغيل الأوامر التالية بالترتيب:\n');
  console.log('   $ npm run build\n');
  console.log('   $ npm run electron:compile\n');
  console.log('   $ npm run server:bundle\n');
  
  console.log('3️⃣  ثم أعد تشغيل أمر التغليف:\n');
  console.log('   $ npm run electron:package\n');
  
  process.exit(1);
}

console.log('\n\x1b[32m╔════════════════════════════════════════════════════╗');
console.log('║  ✅ جميع الملفات جاهزة — يمكن البدء بالتغليف        ║');
console.log('╚════════════════════════════════════════════════════╝\x1b[0m\n');
