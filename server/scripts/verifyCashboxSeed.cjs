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

  const agentCb = await c.query("SELECT count(*) as cnt FROM cashboxes WHERE type='AGENT' AND code LIKE 'CASH-AG-%'");
  const branchCb = await c.query(
    "SELECT count(*) as cnt FROM cashboxes WHERE type='BRANCH' AND code LIKE 'CASH-BR-%' AND is_active = true",
  );
  const totalCb = await c.query('SELECT count(*) as cnt FROM cashboxes');
  const raqqaCb = await c.query(
    "SELECT cb.name, cb.code, cb.currency_code, a.name as agent_name FROM cashboxes cb JOIN agents a ON a.id=cb.agent_id WHERE cb.code='CASH-AG-RAQQA-USD'",
  );
  const qamCb = await c.query(
    "SELECT cb.name, cb.code FROM cashboxes cb JOIN agents a ON a.id=cb.agent_id WHERE cb.code='CASH-AG-QAMISHLI-USD'",
  );
  const hqCb = await c.query("SELECT count(*) as cnt FROM cashboxes WHERE type='COMPANY'");
  const aleppoCb = await c.query(
    "SELECT cb.code, cb.is_active FROM cashboxes cb JOIN branches b ON b.id = cb.branch_id WHERE b.code = 'BR-ALEPPO' AND cb.type = 'BRANCH'",
  );
  let rollupCnt = 'n/a';
  try {
    const r = await c.query('SELECT count(*) as cnt FROM cashboxes WHERE parent_cashbox_id IS NOT NULL');
    rollupCnt = r.rows[0].cnt;
  } catch {
    /* migration 069 not applied */
  }
  // Check no agent has duplicate cashboxes (same currency)
  const dups = await c.query(`
    SELECT agent_id, currency_code, count(*) as cnt
    FROM cashboxes
    WHERE type = 'AGENT' AND agent_id IS NOT NULL
    GROUP BY agent_id, currency_code
    HAVING count(*) > 1
  `);

  console.log('\n=== Cashbox Seed Verification ===');
  console.log('Total cashboxes:', totalCb.rows[0].cnt);
  console.log('Agent cashboxes (CASH-AG-*):', agentCb.rows[0].cnt);
  console.log('Active branch cashboxes (CASH-BR-*):', branchCb.rows[0].cnt, '(expected 1: Aleppo)');
  console.log('Company (general) cashboxes:', hqCb.rows[0].cnt);
  console.log('Cashboxes with parent_cashbox_id (rollup link):', rollupCnt);
  console.log('Aleppo branch cashbox:', JSON.stringify(aleppoCb.rows[0]));
  console.log('');
  console.log('وكيل الرقة cashbox:', JSON.stringify(raqqaCb.rows[0]));
  console.log('وكيل القامشلي cashbox:', JSON.stringify(qamCb.rows[0]));  console.log('');
  console.log('Duplicate agent cashboxes (should be 0):', dups.rows.length);
  if (dups.rows.length > 0) {
    console.error('WARNING: Duplicate cashboxes found:', dups.rows);
  }
  console.log('\n✅ Cashbox verification complete');

  await c.end();
}

verify().catch(err => {
  console.error('Verification failed:', err.message);
  process.exit(1);
});
