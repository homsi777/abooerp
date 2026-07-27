/**
 * تحقق قراءة فقط: مقارنة نطاق الشاشة vs كل الخطوط لتاريخ معيّن.
 * Usage: node server/scripts/verifyDailyLedgerScope.cjs [ledgerDate] [lineLabel] [branchId]
 * Example: node server/scripts/verifyDailyLedgerScope.cjs 2026-06-09 "فرع حلب"
 */
const fs = require('node:fs');
const path = require('node:path');
const { Client } = require('pg');

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

const ledgerDate = process.argv[2] || '2026-06-09';
const lineLabel = process.argv[3] || 'فرع حلب';
const branchIdArg = process.argv[4] || null;

const PRINTABLE_SQL = `
  (
    coalesce(nullif(trim(r.receipt_no), ''), '') <> ''
    or coalesce(nullif(trim(r.destination), ''), '') <> ''
    or coalesce(nullif(trim(r.sender_name), ''), '') <> ''
    or coalesce(nullif(trim(r.receiver_name), ''), '') <> ''
    or coalesce(nullif(trim(r.parcel_type), ''), '') <> ''
    or coalesce(r.parcel_count, 0) > 0
    or coalesce(r.weight_kg::numeric, 0) > 0
    or coalesce(r.collect_amount_usd, 0) <> 0
    or coalesce(r.prepaid_amount_usd, 0) <> 0
    or coalesce(r.hawala_amount_usd, 0) <> 0
    or coalesce(r.transfer_service_fee_usd, 0) <> 0
    or coalesce(r.fees_amount_usd, 0) <> 0
  )
`;

async function main() {
  const client = new Client({
    host: process.env.PGHOST || '127.0.0.1',
    port: Number(process.env.PGPORT || 5432),
    user: process.env.PGUSER || 'postgres',
    password: process.env.PGPASSWORD || '',
    database: process.env.PGDATABASE || 'almiya_hsahin',
  });
  await client.connect();

  let branchId = branchIdArg;
  if (!branchId) {
    const branch = await client.query(
      `select id, name from branches where name ilike $1 limit 1`,
      [`%${lineLabel.replace('فرع ', '')}%`],
    );
    branchId = branch.rows[0]?.id ?? null;
    if (branch.rows[0]) console.log('Branch:', branch.rows[0].name, branchId);
  }

  if (!branchId) {
    console.error('branchId required — pass as 3rd arg or ensure branch exists');
    await client.end();
    process.exit(1);
  }

  const screenScope = await client.query(
    `
    select
      count(*)::int as total_rows,
      count(*) filter (where ${PRINTABLE_SQL})::int as printable_rows,
      count(*) filter (where r.posted_shipment_id is not null)::int as posted_rows,
      coalesce(sum(r.parcel_count), 0)::numeric as pieces,
      coalesce(sum(r.weight_kg), 0)::numeric as weight_kg,
      coalesce(sum(r.collect_amount_usd + r.fees_amount_usd), 0)::numeric as collection_usd,
      coalesce(sum(r.prepaid_amount_usd), 0)::numeric as prepaid_usd,
      coalesce(sum(r.hawala_amount_usd), 0)::numeric as hawala_usd,
      coalesce(sum(r.transfer_service_fee_usd), 0)::numeric as transfer_fee_usd
    from daily_ledger_rows r
    join daily_ledger_sessions s on s.id = r.session_id
    where r.deleted_at is null and s.deleted_at is null
      and s.branch_id = $1::uuid
      and s.ledger_date = $2::date
      and s.line_label = $3
    `,
    [branchId, ledgerDate, lineLabel],
  );

  const allLines = await client.query(
    `
    select s.line_label, count(r.id)::int as rows
    from daily_ledger_sessions s
    left join daily_ledger_rows r on r.session_id = s.id and r.deleted_at is null
    where s.deleted_at is null
      and s.branch_id = $1::uuid
      and s.ledger_date = $2::date
    group by s.line_label
    order by rows desc
    `,
    [branchId, ledgerDate],
  );

  console.log(`\n=== Screen scope: ${ledgerDate} / ${lineLabel} ===`);
  console.log(screenScope.rows[0]);
  const row = screenScope.rows[0];
  const screenMoney =
    Number(row.collection_usd) + Number(row.hawala_usd) + Number(row.transfer_fee_usd);
  console.log('Screen money total (collect+hawala+fee):', screenMoney);
  console.log('Grand total (+prepaid):', screenMoney + Number(row.prepaid_usd));

  console.log(`\n=== All lines same date (would differ if printAllLines=true) ===`);
  for (const line of allLines.rows) {
    console.log(`  ${line.line_label}: ${line.rows} rows`);
  }

  await client.end();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
