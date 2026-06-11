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

async function main() {
  const c = new Client({
    host: process.env.PGHOST || '127.0.0.1',
    port: Number(process.env.PGPORT || 5432),
    user: process.env.PGUSER || 'postgres',
    password: process.env.PGPASSWORD || '',
    database: process.env.PGDATABASE || 'almiya_hsahin',
  });
  await c.connect();

  const missing = await c.query(`
    select a.id, a.code, a.name, a.governorate, a.is_active, a.branch_id
    from agents a
    where a.is_active = true
      and not exists (
        select 1 from cashboxes cb where cb.agent_id = a.id and cb.type = 'AGENT'
      )
    order by a.name
  `);
  console.log('Active agents WITHOUT AGENT cashbox:', missing.rows.length);
  for (const r of missing.rows) console.log(r);

  const rows = await c.query(`
    select a.name, a.governorate, cb.code, cb.current_balance, cb.is_active
    from agents a
    left join cashboxes cb on cb.agent_id = a.id and cb.type = 'AGENT'
    where a.is_active
    order by a.name
  `);
  console.log('\nAll active agents + cashbox:');
  for (const r of rows.rows) console.log(r);

  await c.end();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
