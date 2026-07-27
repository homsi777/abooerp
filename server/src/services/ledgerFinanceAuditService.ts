import { pool } from '../db/pool.js';

function money(value: unknown): number {
  const n = Number(value ?? 0);
  if (!Number.isFinite(n)) return 0;
  return Math.round(n * 100) / 100;
}

export type LedgerFinanceAuditRow = {
  ledgerDate: string;
  sessions: number;
  totalRows: number;
  postedRows: number;
  unpostedPostable: number;
  incompleteRows: number;
  collectUsd: number;
  prepaidUsd: number;
  hawalaUsd: number;
  transferFeeUsd: number;
  weightKg: number;
  collectMovements: number;
  hawalaMovements: number;
  feeMovements: number;
  shipmentsWithMovements: number;
  issues: string[];
};

export type LedgerFinanceAuditReport = {
  fromDate: string;
  generatedAt: string;
  grand: {
    totalRows: number;
    postedRows: number;
    unpostedPostable: number;
    incompleteRows: number;
    collect: number;
    prepaid: number;
    hawala: number;
    fee: number;
    weightKg: number;
  };
  issues: string[];
  days: LedgerFinanceAuditRow[];
  duplicateReceipts: Array<{
    ledgerDate: string;
    lineLabel: string;
    receiptNo: string;
    count: number;
    rowNos: number[];
  }>;
  unpostedPostableSample: Array<{
    ledgerDate: string;
    lineLabel: string;
    rowNo: number;
    receiptNo: string;
  }>;
};

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

export async function buildLedgerFinanceAuditReport(
  companyId: string,
  fromDate: string,
): Promise<LedgerFinanceAuditReport> {
  const useEffectiveDate = await columnExists('shipments', 'effective_date');
  const shipmentDateExpr = useEffectiveDate
    ? 'coalesce(sh.effective_date, ls.ledger_date)'
    : 'ls.ledger_date';

  const [dailySummary, movementTotals, duplicateReceipts, unpostedPostableSample] = await Promise.all([
    pool.query(
      `
      select
        s.ledger_date::text as ledger_date,
        count(distinct s.id)::int as sessions,
        count(r.id)::int as total_rows,
        count(*) filter (where r.posted_shipment_id is not null)::int as posted_rows,
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
      [fromDate, companyId],
    ),
    pool.query(
      `
      select
        ${shipmentDateExpr}::text as ledger_date,
        coalesce(sum(pfm.original_amount) filter (where pfm.movement_type = 'sender_collection_trust'), 0)::numeric as collect_movements,
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
      [fromDate, companyId],
    ),
    pool.query(
      `
      select
        s.ledger_date::text as ledger_date,
        s.line_label,
        lower(trim(r.receipt_no)) as receipt_no,
        count(*)::int as cnt,
        array_agg(r.row_no order by r.row_no) as row_nos
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
      limit 100
      `,
      [fromDate, companyId],
    ),
    pool.query(
      `
      select
        s.ledger_date::text as ledger_date,
        s.line_label,
        r.row_no,
        r.receipt_no
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
      limit 50
      `,
      [fromDate, companyId],
    ),
  ]);

  const movementByDate = new Map(
    movementTotals.rows.map((row) => [String(row.ledger_date), row]),
  );

  const days: LedgerFinanceAuditRow[] = dailySummary.rows.map((row) => {
    const mov = movementByDate.get(String(row.ledger_date));
    const dayIssues: string[] = [];
    const ledgerCollect = money(row.collect_usd);
    const ledgerHawala = money(row.hawala_usd);
    const ledgerFee = money(row.transfer_fee_usd);
    const movCollect = money(mov?.collect_movements);
    const movHawala = money(mov?.hawala_movements);
    const movFee = money(mov?.fee_movements);

    if (Number(row.unposted_postable) > 0) {
      dayIssues.push(`${row.unposted_postable} سطر جاهز غير مُرحَّل`);
    }
    if (Math.abs(ledgerCollect - movCollect) > 0.02 && Number(row.posted_rows) > 0) {
      dayIssues.push(`تحصيل: دفتر ${ledgerCollect} ≠ ذمم ${movCollect}`);
    }
    if (Math.abs(ledgerHawala - movHawala) > 0.02 && Number(row.posted_rows) > 0) {
      dayIssues.push(`حوالة: دفتر ${ledgerHawala} ≠ ذمم ${movHawala}`);
    }
    if (Math.abs(ledgerFee - movFee) > 0.02 && Number(row.posted_rows) > 0) {
      dayIssues.push(`أجور حوالة: دفتر ${ledgerFee} ≠ ذمم ${movFee}`);
    }

    return {
      ledgerDate: String(row.ledger_date),
      sessions: Number(row.sessions),
      totalRows: Number(row.total_rows),
      postedRows: Number(row.posted_rows),
      unpostedPostable: Number(row.unposted_postable),
      incompleteRows: Number(row.incomplete_rows),
      collectUsd: ledgerCollect,
      prepaidUsd: money(row.prepaid_usd),
      hawalaUsd: ledgerHawala,
      transferFeeUsd: ledgerFee,
      weightKg: money(row.weight_kg),
      collectMovements: movCollect,
      hawalaMovements: movHawala,
      feeMovements: movFee,
      shipmentsWithMovements: Number(mov?.shipments_with_movements ?? 0),
      issues: dayIssues,
    };
  });

  const grand = days.reduce(
    (acc, day) => {
      acc.totalRows += day.totalRows;
      acc.postedRows += day.postedRows;
      acc.unpostedPostable += day.unpostedPostable;
      acc.incompleteRows += day.incompleteRows;
      acc.collect += day.collectUsd;
      acc.prepaid += day.prepaidUsd;
      acc.hawala += day.hawalaUsd;
      acc.fee += day.transferFeeUsd;
      acc.weightKg += day.weightKg;
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

  const issues: string[] = [];
  if (grand.unpostedPostable > 0) {
    issues.push(`${grand.unpostedPostable} سطر جاهز للترحيل لكن غير مُرحَّل — يلزم حفظ الدفter`);
  }
  if (duplicateReceipts.rows.length > 0) {
    issues.push(`${duplicateReceipts.rows.length} إيصال مكرر يمنع الترحيل`);
  }
  for (const day of days) {
    for (const issue of day.issues) {
      issues.push(`${day.ledgerDate}: ${issue}`);
    }
  }

  return {
    fromDate,
    generatedAt: new Date().toISOString(),
    grand,
    issues,
    days,
    duplicateReceipts: duplicateReceipts.rows.map((row) => ({
      ledgerDate: String(row.ledger_date),
      lineLabel: String(row.line_label),
      receiptNo: String(row.receipt_no),
      count: Number(row.cnt),
      rowNos: (row.row_nos as number[]) ?? [],
    })),
    unpostedPostableSample: unpostedPostableSample.rows.map((row) => ({
      ledgerDate: String(row.ledger_date),
      lineLabel: String(row.line_label),
      rowNo: Number(row.row_no),
      receiptNo: String(row.receipt_no ?? ''),
    })),
  };
}
