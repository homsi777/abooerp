/**
 * تحقق أرقام الجرد الشهري لوكيل القامشلي
 * Usage: node server/scripts/verifyMonthlyInventoryQamishli.cjs [dateFrom] [dateTo]
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

const dateFrom = process.argv[2] || '2026-06-01';
const dateTo = process.argv[3] || '2026-06-30';

const LEDGER_COLLECT = '(coalesce(dlr.collect_amount_usd, 0) + coalesce(dlr.fees_amount_usd, 0))';
const LEDGER_SHIPPING_BASE = `
  case
    when greatest(${LEDGER_COLLECT}, 0) > 0 and greatest(coalesce(dlr.prepaid_amount_usd, 0), 0) > 0
    then greatest(${LEDGER_COLLECT}, 0)
    else greatest(${LEDGER_COLLECT}, 0) + greatest(coalesce(dlr.prepaid_amount_usd, 0), 0)
  end`;

const AGENT_SHARE_PCT = `
  case
    when (${LEDGER_SHIPPING_BASE}) <= 0 then 0
    when coalesce(s.agent_commission_percentage_snapshot, 0) > 0 then round(
      (${LEDGER_SHIPPING_BASE}) * s.agent_commission_percentage_snapshot / 100, 2)
    else least(coalesce(s.agent_commission_amount_snapshot, 0), (${LEDGER_SHIPPING_BASE}))
  end`;

const AGENT_SHARE_SNAPSHOT = 'coalesce(s.agent_commission_amount_snapshot, 0)';

const SHIPMENT_DATE = 'coalesce(s.effective_date, dls.ledger_date, s.created_at::date)';

async function main() {
  const client = new Client({
    host: process.env.PGHOST || '127.0.0.1',
    port: Number(process.env.PGPORT || 5432),
    user: process.env.PGUSER || 'postgres',
    password: process.env.PGPASSWORD || '',
    database: process.env.PGDATABASE || 'almiya_hsahin',
  });
  await client.connect();

  const company = await client.query(`select id from companies limit 1`);
  const companyId = company.rows[0]?.id;
  if (!companyId) {
    console.error('No company');
    process.exit(1);
  }

  const agent = await client.query(
    `select id, name, commission_percentage from agents where name ilike '%قامشلي%' limit 1`,
  );
  const agentId = agent.rows[0]?.id;
  if (!agentId) {
    console.error('Agent not found');
    process.exit(1);
  }

  console.log('Agent:', agent.rows[0].name, 'pct:', agent.rows[0].commission_percentage);
  console.log('Period:', dateFrom, '->', dateTo);

  const q = await client.query(
    `
    with ledger_lines as (
      select
        s.id,
        ${LEDGER_COLLECT}::numeric as collect_amt,
        coalesce(dlr.prepaid_amount_usd, 0)::numeric as prepaid_amt,
        coalesce(dlr.hawala_amount_usd, 0)::numeric as hawala_amt,
        coalesce(dlr.transfer_service_fee_usd, 0)::numeric as transfer_fee_amt,
        (${LEDGER_SHIPPING_BASE})::numeric as shipping_base,
        (${AGENT_SHARE_PCT})::numeric as agent_share_pct_calc,
        (${AGENT_SHARE_SNAPSHOT})::numeric as agent_share_snapshot,
        coalesce(s.agent_commission_percentage_snapshot, 0)::numeric as pct_snapshot
      from daily_ledger_rows dlr
      join shipments s on s.id = dlr.posted_shipment_id and s.deleted_at is null
      join daily_ledger_sessions dls on dls.id = dlr.session_id and dls.deleted_at is null
      where dlr.deleted_at is null
        and s.company_id = $1::uuid
        and s.agent_id = $2::uuid
        and upper(coalesce(s.status, '')) <> 'CANCELLED'
        and ${SHIPMENT_DATE} >= $3::date
        and ${SHIPMENT_DATE} <= $4::date
    )
    select
      count(*)::int as shipment_count,
      round(coalesce(sum(collect_amt), 0), 2) as collect_sum,
      round(coalesce(sum(prepaid_amt), 0), 2) as prepaid_sum,
      round(coalesce(sum(collect_amt + prepaid_amt), 0), 2) as collect_plus_prepaid_raw,
      round(coalesce(sum(shipping_base), 0), 2) as shipping_base_sum,
      round(coalesce(sum(hawala_amt), 0), 2) as hawala_sum,
      round(coalesce(sum(transfer_fee_amt), 0), 2) as transfer_fees_sum,
      round(coalesce(sum(agent_share_pct_calc), 0), 2) as agent_share_pct_sum,
      round(coalesce(sum(agent_share_snapshot), 0), 2) as agent_share_snapshot_sum,
      round(coalesce(sum(case when agent_share_pct_calc <> agent_share_snapshot then 1 else 0 end), 0), 0) as mismatch_rows
    from ledger_lines
    `,
    [companyId, agentId, dateFrom, dateTo],
  );

  const row = q.rows[0];
  const collect = Number(row.collect_sum);
  const prepaid = Number(row.prepaid_sum);
  const agentSharePct = Number(row.agent_share_pct_sum);
  const agentShareSnap = Number(row.agent_share_snapshot_sum);
  const transferFees = Number(row.transfer_fees_sum);
  const shippingBase = Number(row.shipping_base_sum);

  const companyNetPct = Math.round((collect + prepaid - agentSharePct + transferFees) * 100) / 100;
  const companyNetSnap = Math.round((collect + prepaid - agentShareSnap + transferFees) * 100) / 100;
  const pctOnRaw = Math.round((Number(row.collect_plus_prepaid_raw) * 15) / 100 * 100) / 100;
  const pctOnBase = Math.round((shippingBase * 15) / 100 * 100) / 100;

  console.log('\n=== Ledger-based totals ===');
  console.log(row);
  console.log('\n=== Manual checks ===');
  console.log('15% on collect+prepaid (raw sum):', pctOnRaw);
  console.log('15% on shipping_base (mutual exclusion):', pctOnBase);
  console.log('Company net (pct calc):', companyNetPct);
  console.log('Company net (snapshot sum):', companyNetSnap);
  console.log('\nUser reported: collect=5536.50 prepaid=871 agentShare=961.15 companyNet=5882.35');

  await client.end();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
