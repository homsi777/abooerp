/**
 * إصلاح ترحيل مالي من تاريخ محدد:
 * 1) backfill effective_date + posted_at
 * 2) ترحيل مالي لشحنات مربوطة بالدفتر وحالتها UNPOSTED
 * 3) محاولة ترحيل أسطر الدفتر الجاهزة غير المُرحَّلة
 *
 * Usage:
 *   npx tsx server/src/scripts/repairLedgerFinanceSinceDate.ts
 *   npx tsx server/src/scripts/repairLedgerFinanceSinceDate.ts 2026-06-01
 *   npx tsx server/src/scripts/repairLedgerFinanceSinceDate.ts 2026-06-01 --dry-run
 */
import dotenv from 'dotenv';
import { pool, testDatabaseConnection } from '../db/pool.js';
import { AgentRepository } from '../repositories/agentRepository.js';
import { DailyLedgerRepository } from '../repositories/dailyLedgerRepository.js';
import { FinanceRepository } from '../repositories/financeRepository.js';
import { ShipmentRepository } from '../repositories/shipmentRepository.js';
import { InventoryService } from '../services/inventoryService.js';
import { TransfersRepository } from '../repositories/transfersRepository.js';
import { TransfersService } from '../services/transfersService.js';
import { DailyLedgerShipmentPostingService } from '../services/dailyLedgerShipmentPostingService.js';
import { ShipmentFinancialPostingService } from '../services/shipmentFinancialPostingService.js';
import { ShipmentService } from '../services/shipmentService.js';
import type { ShipmentFinancialInput } from '../services/shipmentFinancialPostingService.js';

dotenv.config();

const FROM_DATE = process.argv[2] || '2026-06-01';
const DRY_RUN = process.argv.includes('--dry-run');

function buildPostingServices() {
  const shipmentRepo = new ShipmentRepository();
  const financeRepo = new FinanceRepository();
  const financialPosting = new ShipmentFinancialPostingService(shipmentRepo, financeRepo);
  const agentRepo = new AgentRepository();
  const shipmentService = new ShipmentService(
    shipmentRepo,
    new InventoryService(),
    financialPosting,
    new TransfersService(new TransfersRepository(pool), financeRepo),
    agentRepo,
  );
  const postingService = new DailyLedgerShipmentPostingService(
    new DailyLedgerRepository(),
    shipmentService,
    agentRepo,
    financialPosting,
  );
  return { financialPosting, postingService };
}

async function columnExists(table: string, column: string): Promise<boolean> {
  const r = await pool.query<{ ok: boolean }>(
    `
    select exists (
      select 1 from information_schema.columns
      where table_name = $1 and column_name = $2
    ) as ok
    `,
    [table, column],
  );
  return Boolean(r.rows[0]?.ok);
}

async function syncLedgerAmountsToShipments(fromDate: string) {
  const result = await pool.query(
    `
    update shipments sh
    set
      transfer_fee = coalesce(dlr.collect_amount_usd, 0),
      prepaid_amount = coalesce(dlr.prepaid_amount_usd, 0),
      hawala_amount = coalesce(dlr.hawala_amount_usd, 0),
      transfer_service_fee = coalesce(dlr.transfer_service_fee_usd, 0),
      freight_charge = case
        when coalesce(dlr.prepaid_amount_usd, 0) > 0 then coalesce(dlr.prepaid_amount_usd, 0)
        else coalesce(sh.freight_charge, 0)
      end,
      original_amount = round(
        coalesce(dlr.collect_amount_usd, 0)::numeric
        + coalesce(dlr.prepaid_amount_usd, 0)::numeric
        + coalesce(dlr.hawala_amount_usd, 0)::numeric
        + coalesce(dlr.transfer_service_fee_usd, 0)::numeric,
        2
      ),
      updated_at = now()
    from daily_ledger_rows dlr
    join daily_ledger_sessions ls on ls.id = dlr.session_id
    where dlr.posted_shipment_id = sh.id
      and dlr.deleted_at is null
      and ls.deleted_at is null
      and ls.ledger_date >= $1::date
      and sh.deleted_at is null
    `,
    [fromDate],
  );
  console.log(`[sync] updated shipment amounts from ledger on ${result.rowCount} rows`);
}

async function backfillDates() {
  if (!(await columnExists('shipments', 'effective_date'))) {
    console.log('[backfill] skip — shipments.effective_date not migrated yet');
    return;
  }
  const shipResult = await pool.query(`
    update shipments s
    set effective_date = ls.ledger_date
    from daily_ledger_rows dlr
    join daily_ledger_sessions ls on ls.id = dlr.session_id
    where dlr.posted_shipment_id = s.id
      and dlr.deleted_at is null
      and ls.deleted_at is null
      and s.effective_date is null
  `);
  console.log(`[backfill] effective_date on ${shipResult.rowCount} shipments`);

  const movResult = await pool.query(`
    update party_financial_movements pfm
    set posted_at = s.effective_date::timestamptz
    from shipments s
    where pfm.shipment_id = s.id
      and s.effective_date is not null
      and pfm.posted_at::date != s.effective_date
      and pfm.is_reversal = false
  `);
  console.log(`[backfill] posted_at on ${movResult.rowCount} movements`);
}

async function repairUnpostedFinancials(companyId: string, financialPosting: ShipmentFinancialPostingService) {
  const rows = await pool.query<{
    shipment_id: string;
    ledger_date: string;
    branch_id: string;
    financial_responsibility_type: string | null;
    financial_responsibility_id: string | null;
    agent_id: string | null;
  }>(
    `
    select distinct on (sh.id)
      sh.id as shipment_id,
      ls.ledger_date::text as ledger_date,
      ls.branch_id::text as branch_id,
      sh.financial_responsibility_type,
      sh.financial_responsibility_id::text as financial_responsibility_id,
      sh.agent_id::text as agent_id
    from daily_ledger_rows dlr
    join daily_ledger_sessions ls on ls.id = dlr.session_id
    join shipments sh on sh.id = dlr.posted_shipment_id and sh.deleted_at is null
    where dlr.deleted_at is null
      and ls.deleted_at is null
      and ls.ledger_date >= $1::date
      and ls.company_id = $2::uuid
      and coalesce(sh.financial_status, 'UNPOSTED') = 'UNPOSTED'
    order by sh.id, ls.ledger_date
    `,
    [FROM_DATE, companyId],
  );

  let fixed = 0;
  let failed = 0;

  for (const row of rows.rows) {
    const financial: ShipmentFinancialInput = {
      paymentMode: 'UNPAID',
      ...(row.financial_responsibility_type === 'ACCOUNT_CUSTOMER' && row.financial_responsibility_id
        ? {
            financialResponsibilityType: 'ACCOUNT_CUSTOMER' as const,
            financialResponsibilityId: row.financial_responsibility_id,
          }
        : row.agent_id
          ? {
              financialResponsibilityType: 'AGENT' as const,
              financialResponsibilityId: row.agent_id,
            }
          : {}),
      allowZeroAmountNote: 'إصلاح ترحيل مالي — backfill من الدفتر',
    };

    if (DRY_RUN) {
      console.log(`[dry-run] would post financials for shipment ${row.shipment_id} (${row.ledger_date})`);
      fixed += 1;
      continue;
    }

    const client = await pool.connect();
    try {
      await client.query('begin');
      await financialPosting.postShipmentConfirmationFinancials({
        client,
        shipmentId: row.shipment_id,
        scope: { companyId, branchId: row.branch_id },
        financial,
        effectiveDate: row.ledger_date,
      });
      await client.query('commit');
      await repairEffectiveDateUpdates(row.shipment_id, row.ledger_date);
      fixed += 1;
    } catch (error) {
      await client.query('rollback');
      failed += 1;
      console.error(
        `[financial] failed ${row.shipment_id}:`,
        error instanceof Error ? error.message : error,
      );
    } finally {
      client.release();
    }
  }

  console.log(`[financial] posted ${fixed}, failed ${failed}`);
  return { fixed, failed };
}

async function repairEffectiveDateUpdates(shipmentId: string, ledgerDate: string) {
  if (!(await columnExists('shipments', 'effective_date'))) return;
  await pool.query(
    `update shipments set effective_date = coalesce($2::date, effective_date) where id = $1`,
    [shipmentId, ledgerDate],
  );
}

async function postPendingLedgerRows(
  companyId: string,
  postingService: DailyLedgerShipmentPostingService,
) {
  const sessions = await pool.query<{
    branch_id: string;
    ledger_date: string;
    line_label: string;
    unposted: string;
  }>(
    `
    select
      s.branch_id::text as branch_id,
      s.ledger_date::text as ledger_date,
      s.line_label,
      count(*) filter (
        where r.posted_shipment_id is null
          and coalesce(trim(r.receipt_no), '') <> ''
          and coalesce(trim(r.destination), '') <> ''
          and coalesce(trim(r.sender_name), '') <> ''
          and coalesce(trim(r.receiver_name), '') <> ''
      )::text as unposted
    from daily_ledger_sessions s
    join daily_ledger_rows r on r.session_id = s.id and r.deleted_at is null
    where s.deleted_at is null
      and s.company_id = $1::uuid
      and s.ledger_date >= $2::date
    group by s.branch_id, s.ledger_date, s.line_label
    having count(*) filter (
      where r.posted_shipment_id is null
        and coalesce(trim(r.receipt_no), '') <> ''
        and coalesce(trim(r.destination), '') <> ''
        and coalesce(trim(r.sender_name), '') <> ''
        and coalesce(trim(r.receiver_name), '') <> ''
    ) > 0
    order by s.ledger_date, s.line_label
    `,
    [companyId, FROM_DATE],
  );

  const branches = await pool.query<{ id: string }>(
    `select id from branches where company_id = $1`,
    [companyId],
  );
  const allowedBranchIds = branches.rows.map((b) => b.id);

  let posted = 0;
  let errors = 0;

  for (const session of sessions.rows) {
    const count = Number(session.unposted);
    if (count <= 0) continue;

    if (DRY_RUN) {
      console.log(
        `[dry-run] would post ${count} rows for ${session.ledger_date} / ${session.line_label}`,
      );
      continue;
    }

    const result = await postingService.postPendingShipments(
      { companyId, branchId: session.branch_id },
      {
        branchId: session.branch_id,
        ledgerDate: session.ledger_date,
        lineLabel: session.line_label,
      },
      allowedBranchIds,
    );

    posted += result.posted.length;
    errors += result.errors.length;
    if (result.posted.length || result.errors.length) {
      console.log(
        `[ledger] ${session.ledger_date} / ${session.line_label}: posted=${result.posted.length} errors=${result.errors.length}`,
      );
      for (const err of result.errors.slice(0, 5)) {
        console.log(`  row ${err.rowNo}: ${err.message}`);
      }
    }
  }

  console.log(`[ledger] total posted=${posted}, errors=${errors}`);
  return { posted, errors };
}

async function main() {
  await testDatabaseConnection();
  const company = await pool.query<{ id: string; name: string }>(
    `select id, name from companies order by created_at limit 1`,
  );
  if (!company.rows[0]) throw new Error('No company');
  const companyId = company.rows[0].id;

  console.log(`Repair from ${FROM_DATE} for ${company.rows[0].name}${DRY_RUN ? ' (DRY RUN)' : ''}`);

  const { financialPosting, postingService } = buildPostingServices();

  if (!DRY_RUN) {
    await backfillDates();
    await syncLedgerAmountsToShipments(FROM_DATE);
  } else {
    console.log('[dry-run] skip backfill + sync');
  }

  await repairUnpostedFinancials(companyId, financialPosting);
  await postPendingLedgerRows(companyId, postingService);

  await pool.end();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
