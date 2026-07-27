/**
 * فحص تكرار أسطر الدفter — إيصالات، حوالات، أجور حوالة، حركات مالية.
 * Usage: node server/scripts/auditCloudLedgerDuplicates.cjs [fromDate YYYY-MM-DD]
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

const fromDate = process.argv[2] || '2025-01-01';

function section(title) {
  console.log(`\n${'='.repeat(72)}\n${title}\n${'='.repeat(72)}`);
}

function printRows(label, rows, limit = 25) {
  console.log(`\n${label} (${rows.length}${rows.length > limit ? ` — أول ${limit}` : ''}):`);
  if (!rows.length) {
    console.log('  ✓ لا توجد');
    return;
  }
  for (const row of rows.slice(0, limit)) {
    console.log(' ', row);
  }
}

async function main() {
  const client = new Client({
    host: process.env.PGHOST || '127.0.0.1',
    port: Number(process.env.PGPORT || 5432),
    user: process.env.PGUSER || 'postgres',
    password: process.env.PGPASSWORD || '',
    database: process.env.PGDATABASE || 'almiya_hsahin',
    ssl: process.env.PGSSL_ENABLED === 'true' ? { rejectUnauthorized: process.env.PGSSL_REJECT_UNAUTHORIZED !== 'false' } : false,
  });
  await client.connect();

  const dbInfo = await client.query('select current_database() as db, now()::text as now');
  section(`فحص قاعدة البيانات — ${dbInfo.rows[0].db} — من ${fromDate}`);
  console.log('وقت الفحص:', dbInfo.rows[0].now);
  console.log('Host:', process.env.PGHOST || '127.0.0.1');

  const totals = await client.query(
    `
    select
      count(*) filter (where r.deleted_at is null)::int as active_rows,
      count(*) filter (where r.deleted_at is null and r.posted_shipment_id is not null)::int as posted_rows,
      count(*) filter (
        where r.deleted_at is null
          and coalesce(r.hawala_amount_usd, 0) <> 0
      )::int as rows_with_hawala,
      count(*) filter (
        where r.deleted_at is null
          and coalesce(r.transfer_service_fee_usd, 0) <> 0
      )::int as rows_with_transfer_fee
    from daily_ledger_rows r
    join daily_ledger_sessions s on s.id = r.session_id and s.deleted_at is null
    where s.ledger_date >= $1::date
    `,
    [fromDate],
  );
  console.log('\nملخص الدفتر:', totals.rows[0]);

  const dupReceiptSameDayLine = await client.query(
    `
    select
      s.ledger_date::text as ledger_date,
      s.line_label,
      b.name as branch_name,
      lower(trim(r.receipt_no)) as receipt_no,
      count(*)::int as cnt,
      array_agg(r.row_no order by r.row_no) as row_nos,
      array_agg((r.posted_shipment_id is not null) order by r.row_no) as posted_flags,
      coalesce(sum(r.hawala_amount_usd), 0)::numeric as hawala_sum,
      coalesce(sum(r.transfer_service_fee_usd), 0)::numeric as transfer_fee_sum
    from daily_ledger_rows r
    join daily_ledger_sessions s on s.id = r.session_id
    join branches b on b.id = s.branch_id
    where r.deleted_at is null and s.deleted_at is null
      and s.ledger_date >= $1::date
      and coalesce(trim(r.receipt_no), '') <> ''
    group by s.ledger_date, s.line_label, b.name, lower(trim(r.receipt_no))
    having count(*) > 1
    order by cnt desc, s.ledger_date desc
    limit 100
    `,
    [fromDate],
  );
  printRows('① إيصالات مكررة — نفس التاريخ + الخط + الفرع', dupReceiptSameDayLine.rows);

  const dupReceiptGlobalPosted = await client.query(
    `
    select
      lower(trim(r.receipt_no)) as receipt_no,
      count(*) filter (where r.posted_shipment_id is not null)::int as posted_count,
      count(*)::int as total_rows,
      array_agg(distinct s.ledger_date::text order by s.ledger_date::text) as dates,
      array_agg(distinct s.line_label) as lines
    from daily_ledger_rows r
    join daily_ledger_sessions s on s.id = r.session_id
    where r.deleted_at is null and s.deleted_at is null
      and s.ledger_date >= $1::date
      and coalesce(trim(r.receipt_no), '') <> ''
    group by lower(trim(r.receipt_no))
    having count(*) filter (where r.posted_shipment_id is not null) > 1
    order by posted_count desc
    limit 100
    `,
    [fromDate],
  );
  printRows('② إيصال مُرحَّل أكثر من مرة (شحنات/أسطر مكررة)', dupReceiptGlobalPosted.rows);

  const unpostedMatchesPosted = await client.query(
    `
    select
      su.ledger_date::text as ledger_date,
      su.line_label,
      u.row_no as unposted_row,
      p.row_no as posted_row,
      u.receipt_no,
      u.hawala_amount_usd,
      u.transfer_service_fee_usd
    from daily_ledger_rows u
    join daily_ledger_sessions su on su.id = u.session_id
    join daily_ledger_rows p on p.deleted_at is null and p.posted_shipment_id is not null
    join daily_ledger_sessions sp on sp.id = p.session_id
      and sp.ledger_date = su.ledger_date and sp.line_label = su.line_label
    where u.deleted_at is null and u.posted_shipment_id is null and su.deleted_at is null
      and su.ledger_date >= $1::date
      and lower(trim(u.receipt_no)) = lower(trim(p.receipt_no))
      and coalesce(trim(u.receipt_no), '') <> ''
    order by su.ledger_date desc, u.row_no
    limit 100
    `,
    [fromDate],
  );
  printRows('③ سطر غير مُرحَّل يطابق إيصالاً مُرحَّلاً (ازدواج محتمل)', unpostedMatchesPosted.rows);

  const dupShipments = await client.query(
    `
    select
      lower(trim(sh.shipment_no)) as shipment_no,
      count(*)::int as cnt,
      array_agg(sh.id::text order by sh.created_at) as shipment_ids,
      array_agg(sh.created_at::text order by sh.created_at) as created_at
    from shipments sh
    where sh.deleted_at is null
      and coalesce(trim(sh.shipment_no), '') <> ''
      and coalesce(sh.effective_date, sh.created_at::date) >= $1::date
    group by lower(trim(sh.shipment_no))
    having count(*) > 1
    order by cnt desc
    limit 100
    `,
    [fromDate],
  );
  printRows('④ شحنات مكررة بنفس رقم الإيصال/الشحنة', dupShipments.rows);

  const dupMovements = await client.query(
    `
    select
      pfm.shipment_id::text,
      sh.shipment_no,
      pfm.movement_type,
      pfm.party_type,
      pfm.party_id::text,
      count(*)::int as cnt,
      array_agg(pfm.id::text order by pfm.created_at) as movement_ids,
      coalesce(sum(pfm.original_amount), 0)::numeric as amount_sum
    from party_financial_movements pfm
    left join shipments sh on sh.id = pfm.shipment_id
    where pfm.is_reversal = false
      and pfm.shipment_id is not null
      and pfm.movement_type in (
        'shipment_hawala_trust',
        'shipment_transfer_service_fee',
        'sender_collection_trust',
        'shipment_shipping_fee'
      )
      and coalesce(pfm.posted_at, pfm.created_at)::date >= $1::date
    group by pfm.shipment_id, sh.shipment_no, pfm.movement_type, pfm.party_type, pfm.party_id
    having count(*) > 1
    order by cnt desc
    limit 100
    `,
    [fromDate],
  );
  printRows('⑤ حركات مالية مكررة — حوالة / أجرة حوالة / تحصيل (نفس الشحنة)', dupMovements.rows);

  const ledgerVsMovements = await client.query(
    `
    with ledger as (
      select
        s.ledger_date::text as ledger_date,
        coalesce(sum(r.hawala_amount_usd), 0)::numeric as ledger_hawala,
        coalesce(sum(r.transfer_service_fee_usd), 0)::numeric as ledger_transfer_fee,
        coalesce(sum(r.collect_amount_usd + r.fees_amount_usd), 0)::numeric as ledger_collect
      from daily_ledger_rows r
      join daily_ledger_sessions s on s.id = r.session_id
      where r.deleted_at is null and s.deleted_at is null
        and r.posted_shipment_id is not null
        and s.ledger_date >= $1::date
      group by s.ledger_date
    ),
    movements as (
      select
        coalesce(sh.effective_date, ls.ledger_date)::text as ledger_date,
        coalesce(sum(pfm.original_amount) filter (where pfm.movement_type = 'shipment_hawala_trust'), 0)::numeric as mov_hawala,
        coalesce(sum(pfm.original_amount) filter (where pfm.movement_type = 'shipment_transfer_service_fee'), 0)::numeric as mov_transfer_fee,
        coalesce(sum(pfm.original_amount) filter (where pfm.movement_type = 'sender_collection_trust'), 0)::numeric as mov_collect
      from party_financial_movements pfm
      join shipments sh on sh.id = pfm.shipment_id and sh.deleted_at is null
      join daily_ledger_rows dlr on dlr.posted_shipment_id = sh.id and dlr.deleted_at is null
      join daily_ledger_sessions ls on ls.id = dlr.session_id and ls.deleted_at is null
      where pfm.is_reversal = false
        and pfm.party_type = 'agent'
        and coalesce(sh.effective_date, ls.ledger_date) >= $1::date
      group by coalesce(sh.effective_date, ls.ledger_date)
    )
    select
      l.ledger_date,
      l.ledger_hawala,
      m.mov_hawala,
      (l.ledger_hawala - coalesce(m.mov_hawala, 0))::numeric as hawala_diff,
      l.ledger_transfer_fee,
      m.mov_transfer_fee,
      (l.ledger_transfer_fee - coalesce(m.mov_transfer_fee, 0))::numeric as transfer_fee_diff,
      l.ledger_collect,
      m.mov_collect,
      (l.ledger_collect - coalesce(m.mov_collect, 0))::numeric as collect_diff
    from ledger l
    left join movements m on m.ledger_date = l.ledger_date
    where abs(l.ledger_hawala - coalesce(m.mov_hawala, 0)) > 0.02
       or abs(l.ledger_transfer_fee - coalesce(m.mov_transfer_fee, 0)) > 0.02
       or abs(l.ledger_collect - coalesce(m.mov_collect, 0)) > 0.02
    order by l.ledger_date desc
    limit 100
    `,
    [fromDate],
  );
  printRows('⑥ فرق يومي — دفتر vs ذمم (حوالة / أجرة / تحصيل)', ledgerVsMovements.rows);

  const hawalaHeavyDupes = await client.query(
    `
    select
      lower(trim(r.receipt_no)) as receipt_no,
      count(*)::int as rows_cnt,
      count(distinct r.posted_shipment_id) filter (where r.posted_shipment_id is not null)::int as shipments_cnt,
      coalesce(sum(r.hawala_amount_usd), 0)::numeric as hawala_total,
      coalesce(sum(r.transfer_service_fee_usd), 0)::numeric as transfer_fee_total
    from daily_ledger_rows r
    join daily_ledger_sessions s on s.id = r.session_id
    where r.deleted_at is null and s.deleted_at is null
      and s.ledger_date >= $1::date
      and coalesce(trim(r.receipt_no), '') <> ''
      and (
        coalesce(r.hawala_amount_usd, 0) <> 0
        or coalesce(r.transfer_service_fee_usd, 0) <> 0
      )
    group by lower(trim(r.receipt_no))
    having count(*) > 1
    order by hawala_total desc, transfer_fee_total desc
    limit 100
    `,
    [fromDate],
  );
  printRows('⑦ إيصالات بحوالات/أجور — أسطر متعددة لنفس الإيصال', hawalaHeavyDupes.rows);

  section('الخلاصة');
  const issues = [
    ['إيصالات مكررة (يوم/خط/فرع)', dupReceiptSameDayLine.rows.length],
    ['إيصالات مُرحَّلة أكثر من مرة', dupReceiptGlobalPosted.rows.length],
    ['غير مُرحَّل يطابق مُرحَّل', unpostedMatchesPosted.rows.length],
    ['شحنات مكررة', dupShipments.rows.length],
    ['حركات مالية مكررة', dupMovements.rows.length],
    ['فرق دفتر/ذمم يومي', ledgerVsMovements.rows.length],
    ['حوالات/أجور — إيصال بعدة أسطر', hawalaHeavyDupes.rows.length],
  ];
  let totalIssues = 0;
  for (const [label, count] of issues) {
    const mark = count === 0 ? '✓' : '⚠';
    console.log(`${mark} ${label}: ${count}`);
    totalIssues += count;
  }
  console.log(`\nإجمالي بنود تحتاج مراجعة: ${totalIssues}`);
  if (totalIssues === 0) {
    console.log('لم يُكتشف تكرار واضح في النطاق المفحوص.');
  } else {
    console.log('راجع البنود ⚠ أعلاه — قد تشير لازدواج في الحوالات أو أجور الشحن.');
  }

  await client.end();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
