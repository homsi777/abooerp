const { Client } = require('pg');
const path = require('node:path');
const fs   = require('node:fs');

// ── Load server/.env if not already set ──────────────────────────────────────
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

async function ensureDatabase() {
  const adminClient = new Client({
    host: process.env.PGHOST || 'localhost',
    port: Number(process.env.PGPORT || 5432),
    user: process.env.PGUSER || 'postgres',
    password: process.env.PGPASSWORD || '',
    database: 'postgres',
  });

  const dbName = process.env.PGDATABASE || 'almiya_hsahin';

  await adminClient.connect();
  const exists = await adminClient.query('select 1 from pg_database where datname = $1', [dbName]);
  if (exists.rowCount === 0) {
    await adminClient.query(`create database "${dbName}"`);
    console.info(`[DB] Created database: ${dbName}`);
  } else {
    console.info(`[DB] Database already exists: ${dbName}`);
  }
  await adminClient.end();
}

module.exports = { ensureDatabase };

// Self-invoke when run directly
ensureDatabase().catch((err) => {
  console.error('[DB] Failed to ensure database:', err?.message ?? err);
  process.exit(1);
});
