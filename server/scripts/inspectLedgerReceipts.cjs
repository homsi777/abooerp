/**
 * Inspect daily ledger receipt duplicates (local debugging).
 * Usage: node server/scripts/inspectLedgerReceipts.cjs [ledgerDate] [lineLabel] [receiptNo]
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

const ledgerDate = process.argv[2] || '2026-06-06';
const lineLabel = process.argv[3] || 'فرع حلب';
const receiptNo = process.argv[4] || null;

async function main() {
  const client = new Client({
    host: process.env.PGHOST || '127.0.0.1',
    port: Number(process.env.PGPORT || 5432),
    user: process.env.PGUSER || 'postgres',
    password: process.env.PGPASSWORD || '',
    database: process.env.PGDATABASE || 'almiya_hsahin',
  });
  await client.connect();

  const stats = await client.query(
    `
    select
      count(*) filter (where r.posted_shipment_id is not null)::int as posted,
      count(*) filter (where r.posted_shipment_id is null)::int as unposted,
      count(*)::int as total
    from daily_ledger_rows r
    join daily_ledger_sessions s on s.id = r.session_id
    where r.deleted_at is null and s.deleted_at is null
      and s.ledger_date = $1::date and s.line_label = $2
    `,
    [ledgerDate, lineLabel],
  );
  console.log(`\n=== ${ledgerDate} / ${lineLabel} ===`);
  console.log('Posted / Unposted / Total:', stats.rows[0]);

  const dups = await client.query(
    `
    select
      lower(trim(r.receipt_no)) as receipt,
      count(*)::int as cnt,
      array_agg(r.row_no order by r.row_no) as row_nos,
      array_agg((r.posted_shipment_id is not null) order by r.row_no) as posted_flags
    from daily_ledger_rows r
    join daily_ledger_sessions s on s.id = r.session_id
    where r.deleted_at is null and s.deleted_at is null
      and s.ledger_date = $1::date and s.line_label = $2
      and coalesce(trim(r.receipt_no), '') <> ''
    group by 1
    having count(*) > 1
    order by cnt desc, receipt asc
    limit 30
    `,
    [ledgerDate, lineLabel],
  );
  console.log(`\nDuplicate receipts (${dups.rows.length}):`);
  for (const row of dups.rows) {
    console.log(`  ${row.receipt}: x${row.cnt} rows ${row.row_nos} posted=${row.posted_flags}`);
  }

  const crossPosted = await client.query(
    `
    select u.row_no as unposted_row, u.receipt_no, p.row_no as posted_row
    from daily_ledger_rows u
    join daily_ledger_sessions su on su.id = u.session_id
    join daily_ledger_rows p on p.deleted_at is null and p.posted_shipment_id is not null
    join daily_ledger_sessions sp on sp.id = p.session_id
      and sp.ledger_date = su.ledger_date and sp.line_label = su.line_label
    where u.deleted_at is null and u.posted_shipment_id is null and su.deleted_at is null
      and su.ledger_date = $1::date and su.line_label = $2
      and lower(trim(u.receipt_no)) = lower(trim(p.receipt_no))
      and coalesce(trim(u.receipt_no), '') <> ''
    order by u.row_no
    limit 50
    `,
    [ledgerDate, lineLabel],
  );
  console.log(`\nUnposted rows matching a posted receipt (${crossPosted.rows.length}):`);
  for (const row of crossPosted.rows) {
    console.log(`  unposted row ${row.unposted_row} conflicts with posted row ${row.posted_row} (${row.receipt_no})`);
  }

  if (receiptNo) {
    const rows = await client.query(
      `
      select r.id, r.row_no, r.receipt_no, (r.posted_shipment_id is not null) as posted,
             s.ledger_date, s.line_label, r.posted_shipment_id
      from daily_ledger_rows r
      join daily_ledger_sessions s on s.id = r.session_id
      where r.deleted_at is null and s.deleted_at is null
        and lower(trim(r.receipt_no)) = lower($1)
      order by s.ledger_date, r.row_no
      `,
      [receiptNo],
    );
    const shipments = await client.query(
      `
      select id, shipment_no, created_at::text
      from shipments
      where deleted_at is null and lower(trim(shipment_no)) = lower($1)
      `,
      [receiptNo],
    );
    console.log(`\nReceipt ${receiptNo} in ledger (${rows.rows.length}):`);
    console.log(rows.rows);
    console.log(`Shipments with ${receiptNo} (${shipments.rows.length}):`);
    console.log(shipments.rows);
  }

  await client.end();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
