/**
 * تحقق شامل: دفتر الشحن ↔ الشحنات ↔ الذمم من تاريخ محدد (افتراضي 2026-06-01).
 *
 * Usage:
 *   node server/scripts/verifyLedgerFinanceSinceDate.cjs
 *   node server/scripts/verifyLedgerFinanceSinceDate.cjs 2026-06-01
 *   node server/scripts/verifyLedgerFinanceSinceDate.cjs 2026-06-01 --json > report.json
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

const FROM_DATE = process.argv[2] || '2026-06-01';
const JSON_OUT = process.argv.includes('--json');
const REPORT_PATH = path.join(
  process.cwd(),
  `ledger-finance-verify-${FROM_DATE.replace(/-/g, '')}-${new Date().toISOString().slice(0, 10)}.txt`,
);

function money(n) {
  const v = Number(n ?? 0);
  if (!Number.isFinite(v)) return 0;
  return Math.round(v * 100) / 100;
}

function fmt(n) {
  return money(n).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

async function main() {
  const client = new Client({
    host: process.env.PGHOST || '127.0.0.1',
    port: Number(process.env.PGPORT || 5432),
    user: process.env.PGUSER || 'postgres',
    password: process.env.PGPASSWORD || '',
    database: process.env.PGDATABASE || 'almiya_hsahin',
  });
  await client.connect();

  const companyRes = await client.query(`select id, name from companies order by created_at limit 1`);
  const company = companyRes.rows[0];
  if (!company) {
    console.error('No company found.');
    process.exit(1);
  }

  const dailySummary = await client.query(
    `
    select
      s.ledger_date::text as ledger_date,
      count(distinct s.id)::int as sessions,
      count(r.id)::int as total_rows,
      count(*) filter (
        where r.posted_shipment_id is not null
      )::int as posted_rows,
      count(*) filter (
        where r.posted_shipment_id is null
          and coalesce(trim(r.receipt_no), '') <> ''
          and coalesce(trim(r.destination), '') <> ''
          and coalesce(trim(r.sender_name), '') <> ''
          and coalesce(trim(r.receiver_name), '') <> ''
      )::int as unposted_postable,
      count(*) filter (
        where r.posted_shipment_id is null
          and (
            coalesce(trim(r.receipt_no), '') = ''
            or coalesce(trim(r.destination), '') = ''
            or coalesce(trim(r.sender_name), '') = ''
            or coalesce(trim(r.receiver_name), '') = ''
          )
      )::int as incomplete_rows,
      coalesce(sum(coalesce(r.collect_amount_usd, 0)), 0)::numeric as collect_usd,
      coalesce(sum(coalesce(r.prepaid_amount_usd, 0)), 0)::numeric as prepaid_usd,
      coalesce(sum(coalesce(r.hawala_amount_usd, 0)), 0)::numeric as hawala_usd,
      coalesce(sum(coalesce(r.transfer_service_fee_usd, 0)), 0)::numeric as transfer_fee_usd,
      coalesce(sum(coalesce(r.weight_kg, 0)), 0)::numeric as weight_kg
    from daily_ledger_rows r
    join daily_ledger_sessions s on s.id = r.session_id
    where r.deleted_at is null
      and s.deleted_at is null
      and s.ledger_date >= $1::date
      and s.company_id = $2::uuid
    group by s.ledger_date
    order by s.ledger_date
    `,
    [FROM_DATE, company.id],
  );

  const sessionDetail = await client.query(
    `
    select
      s.ledger_date::text as ledger_date,
      s.line_label,
      s.branch_id::text as branch_id,
      count(r.id)::int as total_rows,
      count(*) filter (where r.posted_shipment_id is not null)::int as posted_rows,
      count(*) filter (
        where r.posted_shipment_id is null
          and coalesce(trim(r.receipt_no), '') <> ''
          and coalesce(trim(r.destination), '') <> ''
          and coalesce(trim(r.sender_name), '') <> ''
          and coalesce(trim(r.receiver_name), '') <> ''
      )::int as unposted_postable,
      coalesce(sum(coalesce(r.collect_amount_usd, 0)), 0)::numeric as collect_usd,
      coalesce(sum(coalesce(r.prepaid_amount_usd, 0)), 0)::numeric as prepaid_usd,
      coalesce(sum(coalesce(r.hawala_amount_usd, 0)), 0)::numeric as hawala_usd,
      coalesce(sum(coalesce(r.transfer_service_fee_usd, 0)), 0)::numeric as transfer_fee_usd
    from daily_ledger_rows r
    join daily_ledger_sessions s on s.id = r.session_id
    where r.deleted_at is null
      and s.deleted_at is null
      and s.ledger_date >= $1::date
      and s.company_id = $2::uuid
    group by s.ledger_date, s.line_label, s.branch_id
    order by s.ledger_date, s.line_label
    `,
    [FROM_DATE, company.id],
  );

  const unpostedFinancials = await client.query(
    `
    select
      ls.ledger_date::text as ledger_date,
      ls.line_label,
      count(*)::int as count,
      array_agg(dlr.row_no order by dlr.row_no) filter (where true) as row_nos
    from daily_ledger_rows dlr
    join daily_ledger_sessions ls on ls.id = dlr.session_id
    join shipments sh on sh.id = dlr.posted_shipment_id and sh.deleted_at is null
    where dlr.deleted_at is null
      and ls.deleted_at is null
      and ls.ledger_date >= $1::date
      and ls.company_id = $2::uuid
      and coalesce(sh.financial_status, 'UNPOSTED') = 'UNPOSTED'
    group by ls.ledger_date, ls.line_label
    order by ls.ledger_date, ls.line_label
    `,
    [FROM_DATE, company.id],
  );

  const noMovements = await client.query(
    `
    select
      ls.ledger_date::text as ledger_date,
      ls.line_label,
      count(*)::int as count
    from daily_ledger_rows dlr
    join daily_ledger_sessions ls on ls.id = dlr.session_id
    join shipments sh on sh.id = dlr.posted_shipment_id and sh.deleted_at is null
    where dlr.deleted_at is null
      and ls.deleted_at is null
      and ls.ledger_date >= $1::date
      and ls.company_id = $2::uuid
      and (
        coalesce(dlr.collect_amount_usd, 0)
        + coalesce(dlr.prepaid_amount_usd, 0)
        + coalesce(dlr.hawala_amount_usd, 0)
        + coalesce(dlr.transfer_service_fee_usd, 0)
      ) > 0
      and not exists (
        select 1
        from party_financial_movements pfm
        where pfm.shipment_id = sh.id
          and pfm.is_reversal = false
      )
    group by ls.ledger_date, ls.line_label
    order by ls.ledger_date, ls.line_label
    `,
    [FROM_DATE, company.id],
  );

  const duplicateReceipts = await client.query(
    `
    select
      s.ledger_date::text as ledger_date,
      s.line_label,
      lower(trim(r.receipt_no)) as receipt_no,
      count(*)::int as cnt,
      array_agg(r.row_no order by r.row_no) as row_nos,
      array_agg((r.posted_shipment_id is not null) order by r.row_no) as posted_flags
    from daily_ledger_rows r
    join daily_ledger_sessions s on s.id = r.session_id
    where r.deleted_at is null
      and s.deleted_at is null
      and s.ledger_date >= $1::date
      and s.company_id = $2::uuid
      and coalesce(trim(r.receipt_no), '') <> ''
    group by s.ledger_date, s.line_label, lower(trim(r.receipt_no))
    having count(*) > 1
    order by s.ledger_date, s.line_label, cnt desc
    `,
    [FROM_DATE, company.id],
  );

  const hasEffectiveDate = await client.query(`
    select exists (
      select 1 from information_schema.columns
      where table_name = 'shipments' and column_name = 'effective_date'
    ) as ok
  `);
  const useEffectiveDate = Boolean(hasEffectiveDate.rows[0]?.ok);
  const shipmentDateExpr = useEffectiveDate
    ? 'coalesce(sh.effective_date, ls.ledger_date)'
    : 'ls.ledger_date';

  const ledgerVsShipments = await client.query(
    `
    with ledger_totals as (
      select
        s.ledger_date,
        coalesce(sum(coalesce(r.collect_amount_usd, 0)), 0)::numeric as collect,
        coalesce(sum(coalesce(r.prepaid_amount_usd, 0)), 0)::numeric as prepaid,
        coalesce(sum(coalesce(r.hawala_amount_usd, 0)), 0)::numeric as hawala,
        coalesce(sum(coalesce(r.transfer_service_fee_usd, 0)), 0)::numeric as fee
      from daily_ledger_rows r
      join daily_ledger_sessions s on s.id = r.session_id
      where r.deleted_at is null
        and s.deleted_at is null
        and s.ledger_date >= $1::date
        and s.company_id = $2::uuid
        and r.posted_shipment_id is not null
      group by s.ledger_date
    ),
    shipment_totals as (
      select
        ${shipmentDateExpr} as ledger_date,
        coalesce(sum(coalesce(sh.transfer_fee, 0)), 0)::numeric as collect,
        coalesce(sum(coalesce(sh.prepaid_amount, 0)), 0)::numeric as prepaid,
        coalesce(sum(coalesce(sh.hawala_amount, 0)), 0)::numeric as hawala,
        coalesce(sum(coalesce(sh.transfer_service_fee, 0)), 0)::numeric as fee
      from shipments sh
      join daily_ledger_rows dlr on dlr.posted_shipment_id = sh.id and dlr.deleted_at is null
      join daily_ledger_sessions ls on ls.id = dlr.session_id and ls.deleted_at is null
      where sh.deleted_at is null
        and sh.company_id = $2::uuid
        and ls.ledger_date >= $1::date
      group by ${shipmentDateExpr}
    )
    select
      coalesce(l.ledger_date, s.ledger_date)::text as ledger_date,
      coalesce(l.collect, 0)::numeric as ledger_collect,
      coalesce(s.collect, 0)::numeric as shipment_collect,
      coalesce(l.prepaid, 0)::numeric as ledger_prepaid,
      coalesce(s.prepaid, 0)::numeric as shipment_prepaid,
      coalesce(l.hawala, 0)::numeric as ledger_hawala,
      coalesce(s.hawala, 0)::numeric as shipment_hawala,
      coalesce(l.fee, 0)::numeric as ledger_fee,
      coalesce(s.fee, 0)::numeric as shipment_fee
    from ledger_totals l
    full outer join shipment_totals s on s.ledger_date = l.ledger_date
    order by coalesce(l.ledger_date, s.ledger_date)
    `,
    [FROM_DATE, company.id],
  );

  const movementTotals = await client.query(
    `
    select
      ${shipmentDateExpr}::text as ledger_date,
      coalesce(sum(pfm.original_amount) filter (where pfm.movement_type = 'sender_collection_trust'), 0)::numeric as collect_movements,
      coalesce(sum(pfm.original_amount) filter (where pfm.movement_type in ('shipment_shipping_fee')), 0)::numeric as shipping_fee_movements,
      coalesce(sum(pfm.original_amount) filter (where pfm.movement_type = 'shipment_hawala_trust'), 0)::numeric as hawala_movements,
      coalesce(sum(pfm.original_amount) filter (where pfm.movement_type = 'shipment_transfer_service_fee'), 0)::numeric as fee_movements,
      count(distinct sh.id)::int as shipments_with_movements
    from party_financial_movements pfm
    join shipments sh on sh.id = pfm.shipment_id and sh.deleted_at is null
    join daily_ledger_rows dlr on dlr.posted_shipment_id = sh.id and dlr.deleted_at is null
    join daily_ledger_sessions ls on ls.id = dlr.session_id and ls.deleted_at is null
    where pfm.is_reversal = false
      and pfm.party_type = 'agent'
      and ls.ledger_date >= $1::date
      and sh.company_id = $2::uuid
    group by ${shipmentDateExpr}
    order by ${shipmentDateExpr}
    `,
    [FROM_DATE, company.id],
  );

  const unpostedPostableSample = await client.query(
    `
    select
      s.ledger_date::text as ledger_date,
      s.line_label,
      r.row_no,
      r.receipt_no,
      r.destination,
      r.sender_name,
      r.receiver_name
    from daily_ledger_rows r
    join daily_ledger_sessions s on s.id = r.session_id
    where r.deleted_at is null
      and s.deleted_at is null
      and s.ledger_date >= $1::date
      and s.company_id = $2::uuid
      and r.posted_shipment_id is null
      and coalesce(trim(r.receipt_no), '') <> ''
      and coalesce(trim(r.destination), '') <> ''
      and coalesce(trim(r.sender_name), '') <> ''
      and coalesce(trim(r.receiver_name), '') <> ''
    order by s.ledger_date, s.line_label, r.row_no
    limit 100
    `,
    [FROM_DATE, company.id],
  );

  const grand = dailySummary.rows.reduce(
    (acc, row) => {
      acc.totalRows += Number(row.total_rows);
      acc.postedRows += Number(row.posted_rows);
      acc.unpostedPostable += Number(row.unposted_postable);
      acc.incompleteRows += Number(row.incomplete_rows);
      acc.collect += money(row.collect_usd);
      acc.prepaid += money(row.prepaid_usd);
      acc.hawala += money(row.hawala_usd);
      acc.fee += money(row.transfer_fee_usd);
      acc.weightKg += money(row.weight_kg);
      return acc;
    },
    {
      totalRows: 0,
      postedRows: 0,
      unpostedPostable: 0,
      incompleteRows: 0,
      collect: 0,
      prepaid: 0,
      hawala: 0,
      fee: 0,
      weightKg: 0,
    },
  );

  const issues = [];
  if (grand.unpostedPostable > 0) {
    issues.push(`${grand.unpostedPostable} سطر جاهز للترحيل لكن غير مُرحَّل`);
  }
  const unpostedFinCount = unpostedFinancials.rows.reduce((s, r) => s + Number(r.count), 0);
  if (unpostedFinCount > 0) {
    issues.push(`${unpostedFinCount} شحنة مربوطة بالدفتر بدون ترحيل مالي (UNPOSTED)`);
  }
  const noMovCount = noMovements.rows.reduce((s, r) => s + Number(r.count), 0);
  if (noMovCount > 0) {
    issues.push(`${noMovCount} شحنة بمبالغ بدون حركات ذمم`);
  }
  if (duplicateReceipts.rows.length > 0) {
    issues.push(`${duplicateReceipts.rows.length} إيصال مكرر داخل نفس اليوم/الخط`);
  }

  for (const row of ledgerVsShipments.rows) {
    const mov = movementTotals.rows.find((m) => m.ledger_date === row.ledger_date);
    const diffs = [
      ['collect', row.ledger_collect, mov?.collect_movements ?? row.shipment_collect],
      ['hawala', row.ledger_hawala, mov?.hawala_movements ?? row.shipment_hawala],
      ['fee', row.ledger_fee, mov?.fee_movements ?? row.shipment_fee],
    ];
    for (const [label, ledgerAmt, compareAmt] of diffs) {
      if (Math.abs(money(ledgerAmt) - money(compareAmt)) > 0.02) {
        const source = mov ? 'ذمم' : 'شحنات';
        issues.push(`فرق ${label} في ${row.ledger_date}: دفتر ${fmt(ledgerAmt)} ≠ ${source} ${fmt(compareAmt)}`);
      }
    }
    if (
      mov &&
      (Math.abs(money(row.shipment_hawala) - money(row.ledger_hawala)) > 0.02 ||
        Math.abs(money(row.shipment_collect) - money(row.ledger_collect)) > 0.02)
    ) {
      issues.push(
        `تنبيه مزامنة شحنات ${row.ledger_date}: أعمدة الشحنة لا تطابق الدفter (hawala=${fmt(row.shipment_hawala)} vs ${fmt(row.ledger_hawala)})`,
      );
    }
  }

  const report = {
    generatedAt: new Date().toISOString(),
    company: company.name,
    fromDate: FROM_DATE,
    grand,
    issues,
    dailySummary: dailySummary.rows,
    sessionDetail: sessionDetail.rows,
    unpostedFinancials: unpostedFinancials.rows,
    noMovements: noMovements.rows,
    duplicateReceipts: duplicateReceipts.rows,
    ledgerVsShipments: ledgerVsShipments.rows,
    movementTotals: movementTotals.rows,
    unpostedPostableSample: unpostedPostableSample.rows,
  };

  if (JSON_OUT) {
    console.log(JSON.stringify(report, null, 2));
    await client.end();
    return;
  }

  const lines = [];
  lines.push('=== تحقق شامل: دفتر الشحن ↔ الشحنات ↔ الذمم ===');
  lines.push(`التاريخ: ${new Date().toISOString()}`);
  lines.push(`الشركة: ${company.name}`);
  lines.push(`من تاريخ: ${FROM_DATE}`);
  lines.push('');
  lines.push('--- ملخص إجمالي ---');
  lines.push(`أسطر الدفتر: ${grand.totalRows} | مُرحَّل: ${grand.postedRows} | جاهز غير مُرحَّل: ${grand.unpostedPostable} | ناقص: ${grand.incompleteRows}`);
  lines.push(`تحصيل: USD ${fmt(grand.collect)} | دفع مسبق: USD ${fmt(grand.prepaid)} | حوالة: USD ${fmt(grand.hawala)} | أجور حوالة: USD ${fmt(grand.fee)}`);
  lines.push(`الوزن: ${fmt(grand.weightKg)} كغ`);
  lines.push('');
  lines.push('--- حسب اليوم ---');
  for (const row of dailySummary.rows) {
    lines.push(
      `${row.ledger_date} | أسطر ${row.total_rows} (مُرحَّل ${row.posted_rows}, متبقي ${row.unposted_postable}, ناقص ${row.incomplete_rows}) | تحصيل ${fmt(row.collect_usd)} | مسبق ${fmt(row.prepaid_usd)} | حوالة ${fmt(row.hawala_usd)} | أجور ${fmt(row.transfer_fee_usd)} | ${fmt(row.weight_kg)} كغ`,
    );
  }
  lines.push('');
  lines.push('--- مشاكل ---');
  if (issues.length === 0) {
    lines.push('لا توجد مشاكل حرجة.');
  } else {
    for (const issue of issues) lines.push(`• ${issue}`);
  }
  if (duplicateReceipts.rows.length) {
    lines.push('');
    lines.push('--- إيصالات مكررة ---');
    for (const row of duplicateReceipts.rows.slice(0, 50)) {
      lines.push(`${row.ledger_date} / ${row.line_label} | ${row.receipt_no} x${row.cnt} rows=${JSON.stringify(row.row_nos)} posted=${JSON.stringify(row.posted_flags)}`);
    }
  }
  if (unpostedFinancials.rows.length) {
    lines.push('');
    lines.push('--- شحنات بدون ترحيل مالي ---');
    for (const row of unpostedFinancials.rows) {
      lines.push(`${row.ledger_date} / ${row.line_label}: ${row.count} (rows ${JSON.stringify(row.row_nos)?.slice(0, 120)}...)`);
    }
  }
  if (unpostedPostableSample.rows.length) {
    lines.push('');
    lines.push('--- عينة أسطر جاهزة غير مُرحَّلة (أول 100) ---');
    for (const row of unpostedPostableSample.rows) {
      lines.push(`${row.ledger_date} / ${row.line_label} | سطر ${row.row_no} | إيصال ${row.receipt_no} | ${row.destination}`);
    }
  }
  lines.push('');
  lines.push('--- حركات الذمم (وكلاء) حسب اليوم ---');
  for (const row of movementTotals.rows) {
    lines.push(
      `${row.ledger_date} | تحصيل ${fmt(row.collect_movements)} | أجور شحن ${fmt(row.shipping_fee_movements)} | حوالة ${fmt(row.hawala_movements)} | أجور حوالة ${fmt(row.fee_movements)} | شحنات ${row.shipments_with_movements}`,
    );
  }

  const text = lines.join('\n');
  fs.writeFileSync(REPORT_PATH, text, 'utf-8');
  console.log(text);
  console.log(`\n[Saved] ${REPORT_PATH}`);

  await client.end();
  process.exit(issues.length > 0 ? 2 : 0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
