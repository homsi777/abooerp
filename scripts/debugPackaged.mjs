/**
 * debugPackaged.mjs — أداة تشخيص التطبيق المغلف بحثاً عن مشاكل الاتصال بقاعدة البيانات
 * ════════════════════════════════════════════════════════════════════════════════════
 * 
 * يساعد في معرفة:
 *   1. ما هو المسار الذي يبحث فيه التطبيق عن ملف .env
 *   2. هل تم نسخ ملف app-config.env بشكل صحيح
 *   3. هل يمكن قراءة ملف .env من مجلد البيانات
 *   4. ما هي قيم بيانات الاتصال بقاعدة البيانات
 */

import path from 'node:path';
import fs from 'node:fs';
import os from 'node:os';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '..');

console.log('\n\x1b[1m\x1b[34m╔════════════════════════════════════════════════════╗');
console.log('║  أداة تشخيص التطبيق المغلف                         ║');
console.log('║  Packaged App Diagnostic Tool                       ║');
console.log('╚════════════════════════════════════════════════════╝\x1b[0m\n');

// ── الأمسار المتوقعة في التطبيق المغلف ──────────────────────────────────────
const diagnostics = {
  'مسار بيانات المستخدم': path.join(os.homedir(), 'AppData', 'Roaming', 'شركة عبو المحمود لنقل والخدمات الوجستية'),
  'مسار ملف server.env': path.join(os.homedir(), 'AppData', 'Roaming', 'شركة عبو المحمود لنقل والخدمات الوجستية', 'server.env'),
  'مسار ملف app-config.env (في الموارد)': path.join(path.dirname(process.execPath), 'resources', 'app-config.env'),
  'مسار ملف JWT Secret': path.join(os.homedir(), 'AppData', 'Roaming', 'شركة عبو المحمود لنقل والخدمات الوجستية', '.jwt_secret'),
  'مسار ملف Server Log': path.join(os.homedir(), 'AppData', 'Roaming', 'شركة عبو المحمود لنقل والخدمات الوجستية', 'server-process.log'),
  'مسار ملف Runtime Log': path.join(os.homedir(), 'AppData', 'Roaming', 'شركة عبو المحمود لنقل والخدمات الوجستية', 'logs', 'runtime.log'),
};

console.log('📁 الأمسار المتوقعة في التطبيق المغلف:\n');
for (const [label, filePath] of Object.entries(diagnostics)) {
  const exists = fs.existsSync(filePath);
  const icon = exists ? '✅' : '❌';
  console.log(`${icon} ${label}`);
  console.log(`   ${filePath}\n`);
}

// ── قراءة ملف .env إذا كان موجوداً ───────────────────────────────────────
console.log('\n\x1b[1m🔍 محاولة قراءة ملف .env من بيانات المستخدم:\x1b[0m\n');

const userEnvFile = diagnostics['مسار ملف server.env'];
if (fs.existsSync(userEnvFile)) {
  console.log('✅ تم العثور على ملف server.env\n');
  try {
    const envContent = fs.readFileSync(userEnvFile, 'utf-8');
    const envLines = envContent.split('\n');
    
    const dbVars = ['PGHOST', 'PGPORT', 'PGDATABASE', 'PGUSER', 'PGPASSWORD'];
    console.log('قيم قاعدة البيانات:\n');
    
    for (const line of envLines) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) continue;
      
      const [key, ...valueParts] = trimmed.split('=');
      const value = valueParts.join('=');
      
      if (dbVars.includes(key)) {
        const displayValue = key === 'PGPASSWORD' ? '****' : value;
        console.log(`  ${key}=${displayValue}`);
      }
    }
  } catch (err) {
    console.error(`❌ خطأ في قراءة الملف: ${err.message}`);
  }
} else {
  console.log('❌ لم يتم العثور على ملف server.env في بيانات المستخدم\n');
  console.log('💡 الحل: انسخ ملف .env من المشروع إلى:\n');
  console.log(`   ${userEnvFile}\n`);
}

// ── قراءة ملف Server Log ─────────────────────────────────────────────────
const serverLogFile = diagnostics['مسار ملف Server Log'];
if (fs.existsSync(serverLogFile)) {
  console.log('\n\x1b[1m📋 آخر سطور من ملف Server Log:\x1b[0m\n');
  try {
    const logContent = fs.readFileSync(serverLogFile, 'utf-8');
    const logLines = logContent.split('\n').slice(-10); // آخر 10 أسطر
    
    for (const line of logLines) {
      if (line.trim()) console.log(line);
    }
  } catch (err) {
    console.error(`❌ خطأ في قراءة السجل: ${err.message}`);
  }
} else {
  console.log('\n⚠️  لم يتم العثور على ملف Server Log (قد يكون التطبيق لم يبدأ بعد)');
}

console.log('\n\x1b[32m💡 نصيحة:\x1b[0m إذا استمرت المشكلة، تحقق من:');
console.log('   1. أن ملف server.env موجود في بيانات المستخدم');
console.log('   2. أن بيانات الاتصال بقاعدة البيانات صحيحة (خاصة PGHOST و PGPORT)');
console.log('   3. أن PostgreSQL يعمل ويستقبل الاتصالات على المضيف والمنفذ المحددين');
console.log('   4. تحقق من ملف Server Log للأخطاء المفصلة\n');
