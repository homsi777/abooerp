/**
 * Restore a pg_dump custom-format backup into the local dev database.
 * Usage: node server/scripts/restoreBackup.cjs [path-to.dump]
 */
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const envPath = path.join(__dirname, '..', '.env');
if (fs.existsSync(envPath)) {
  for (const line of fs.readFileSync(envPath, 'utf-8').split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eq = trimmed.indexOf('=');
    if (eq < 0) continue;
    const key = trimmed.slice(0, eq).trim();
    const val = trimmed.slice(eq + 1).trim();
    if (!process.env[key]) process.env[key] = val;
  }
}

function resolvePgRestore() {
  if (process.env.PGRESTORE_PATH && fs.existsSync(process.env.PGRESTORE_PATH)) {
    return process.env.PGRESTORE_PATH;
  }
  const fileName = process.platform === 'win32' ? 'pg_restore.exe' : 'pg_restore';
  const roots = [
    process.env.PGROOT,
    process.env.PGBIN?.replace(/[\\/]bin$/i, ''),
    'C:\\Program Files\\PostgreSQL',
    'C:\\Program Files (x86)\\PostgreSQL',
  ].filter(Boolean);
  for (const root of roots) {
    let entries = [];
    try {
      entries = fs.readdirSync(root);
    } catch {
      continue;
    }
    const versions = entries.filter((name) => /^\d+/.test(name)).sort((a, b) => b.localeCompare(a, undefined, { numeric: true }));
    for (const version of versions) {
      const candidate = path.join(root, version, 'bin', fileName);
      if (fs.existsSync(candidate)) return candidate;
    }
  }
  return fileName;
}

const dumpPath = path.resolve(process.argv[2] || path.join(__dirname, '..', 'backups', 'BKP-20260607123203-1244.dump'));
if (!fs.existsSync(dumpPath)) {
  console.error('[restore] Dump not found:', dumpPath);
  process.exit(1);
}

const pgRestore = resolvePgRestore();
const dbName = process.env.PGDATABASE || 'almiya_hsahin';
const env = {
  ...process.env,
  PGPASSWORD: process.env.PGPASSWORD || '',
};

console.info('[restore] Using:', pgRestore);
console.info('[restore] Target DB:', dbName);
console.info('[restore] Dump:', dumpPath);

const result = spawnSync(
  pgRestore,
  [
    '--clean',
    '--if-exists',
    '--no-owner',
    '--no-privileges',
    '-h',
    process.env.PGHOST || '127.0.0.1',
    '-p',
    String(process.env.PGPORT || 5432),
    '-U',
    process.env.PGUSER || 'postgres',
    '-d',
    dbName,
    dumpPath,
  ],
  { env, encoding: 'utf8' },
);

if (result.stdout) process.stdout.write(result.stdout);
if (result.stderr) process.stderr.write(result.stderr);

if (result.status !== 0) {
  const benign = /role .* does not exist/i.test(result.stderr || '');
  if (benign) {
    console.warn('[restore] Completed with benign role/grant warnings (OK for local dev).');
    process.exit(0);
  }
  console.error('[restore] pg_restore failed with code', result.status);
  process.exit(result.status || 1);
}

console.info('[restore] Done.');
