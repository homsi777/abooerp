#!/usr/bin/env node
/**
 * تحقق من عزل مدخل البيانات وظهور المدير لكل الأسطر.
 * الاستخدام: node server/scripts/verifyDailyLedgerOperatorScope.cjs 2026-06-10
 *            node server/scripts/verifyDailyLedgerOperatorScope.cjs 2026-06-10 "فرع حلب"
 */
const path = require('node:path');
const { config } = require('dotenv');
const { Pool } = require('pg');

config({ path: path.resolve(process.cwd(), 'server/.env') });
config({ path: path.resolve(process.cwd(), '.env') });

const ledgerDate = process.argv[2];
const branchName = process.argv[3] || null;

if (!ledgerDate) {
  console.error('Usage: node server/scripts/verifyDailyLedgerOperatorScope.cjs YYYY-MM-DD [branchName]');
  process.exit(1);
}

const pool = new Pool({
  host: process.env.PGHOST,
  port: Number(process.env.PGPORT || 5432),
  database: process.env.PGDATABASE,
  user: process.env.PGUSER,
  password: process.env.PGPASSWORD,
});

async function main() {
  const conditions = ['r.deleted_at is null', 's.deleted_at is null', 's.ledger_date = $1::date'];
  const params = [ledgerDate];
  if (branchName) {
    params.push(`%${branchName}%`);
    conditions.push(`b.name ilike $${params.length}`);
  }
  const where = conditions.join(' and ');

  const summary = await pool.query(
    `
    select
      u.username,
      r.created_by,
      count(*)::int as rows_count
    from daily_ledger_rows r
    join daily_ledger_sessions s on s.id = r.session_id
    join branches b on b.id = s.branch_id
    left join users u on u.id = r.created_by
    where ${where}
    group by u.username, r.created_by
    order by rows_count desc, u.username nulls last
    `,
    params,
  );

  const total = await pool.query(
    `
    select count(*)::int as total
    from daily_ledger_rows r
    join daily_ledger_sessions s on s.id = r.session_id
    join branches b on b.id = s.branch_id
    where ${where}
    `,
    params,
  );

  console.log(`Ledger date: ${ledgerDate}`);
  if (branchName) console.log(`Branch contains: ${branchName}`);
  console.log(`Total rows: ${total.rows[0]?.total ?? 0}`);
  console.log('By operator:');
  for (const row of summary.rows) {
    console.log(`  - ${row.username ?? '(بدون created_by)'}: ${row.rows_count}`);
  }

  await pool.end();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
