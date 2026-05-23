const { Client } = require('pg');
const path = require('node:path');
const fs = require('node:fs');

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

async function verify() {
  const c = new Client({
    host: process.env.PGHOST || '127.0.0.1',
    port: Number(process.env.PGPORT || 5432),
    user: process.env.PGUSER || 'postgres',
    password: process.env.PGPASSWORD || '',
    database: process.env.PGDATABASE || 'almiya_hsahin',
  });

  await c.connect();

  const cities    = await c.query("SELECT count(*) as cnt FROM cities WHERE region IS NOT NULL");
  const syriaCodes = await c.query("SELECT code, name FROM cities WHERE code IN ('DAMASCUS','ALEPPO','QAMISHLI','RAQQA','HASAKAH') ORDER BY code");
  const branches  = await c.query("SELECT count(*) as cnt FROM branches WHERE code LIKE 'BR-%'");
  const agents    = await c.query("SELECT count(*) as cnt FROM agents WHERE code LIKE 'AGT-%'");
  const qamAgent  = await c.query("SELECT name, governorate FROM agents WHERE code = 'AGT-QAMISHLI'");
  const cusPerms  = await c.query("SELECT code FROM permissions WHERE code LIKE 'customers.%' ORDER BY code");

  console.log('\n=== Syrian Seed Verification ===');
  console.log('Cities with region:', cities.rows[0].cnt);
  console.log('Sample cities:', JSON.stringify(syriaCodes.rows));
  console.log('Default branches (BR-*):', branches.rows[0].cnt);
  console.log('Default agents (AGT-*):', agents.rows[0].cnt);
  console.log('Qamishli agent:', JSON.stringify(qamAgent.rows[0]));
  console.log('\n=== Customer Permissions ===');
  console.log(cusPerms.rows.map(r => r.code).join(', '));
  console.log('\n✅ Verification complete');

  await c.end();
}

verify().catch(err => {
  console.error('Verification failed:', err.message);
  process.exit(1);
});
