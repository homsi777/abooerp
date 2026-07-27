import { pool } from '../db/pool.js';
import type { DataScope } from '../utils/scope.js';
import { buildLedgerFinanceAuditReport } from './ledgerFinanceAuditService.js';

function money(value: unknown): number {
  const n = Number(value ?? 0);
  if (!Number.isFinite(n)) return 0;
  return Math.round(n * 100) / 100;
}

function voucherScopeWhere(scope: DataScope | undefined, startIndex = 1, alias = 'v') {
  const values: unknown[] = [];
  const conditions: string[] = [];
  const p = `${alias}.`;
  if (scope?.companyId) {
    values.push(scope.companyId);
    conditions.push(`${p}company_id = $${startIndex + values.length - 1}::uuid`);
  }
  if (scope?.financeAgentScope && scope.agentId) {
    values.push(scope.agentId);
    conditions.push(`${p}agent_id = $${startIndex + values.length - 1}::uuid`);
    return { values, conditions };
  }
  if (scope?.branchId) {
    values.push(scope.branchId);
    conditions.push(`${p}branch_id = $${startIndex + values.length - 1}::uuid`);
  }
  if (scope?.agentId) {
    values.push(scope.agentId);
    conditions.push(`${p}agent_id = $${startIndex + values.length - 1}::uuid`);
  }
  return { values, conditions };
}

export type VoucherReportFilters = {
  dateFrom?: string;
  dateTo?: string;
  branchId?: string;
  agentId?: string;
  customerId?: string;
  cashboxId?: string;
  status?: string;
};

export async function buildVoucherReport(
  scope: DataScope,
  voucherType: 'receipt' | 'payment',
  filters: VoucherReportFilters,
) {
  const table = voucherType === 'receipt' ? 'receipt_vouchers' : 'payment_vouchers';
  const scoped = voucherScopeWhere(scope, 1, 'v');
  const values: unknown[] = [...scoped.values];
  const conditions: string[] = [...scoped.conditions, `v.status <> 'cancelled'`];

  if (filters.dateFrom) {
    values.push(filters.dateFrom);
    conditions.push(`v.created_at >= $${values.length}::timestamptz`);
  }
  if (filters.dateTo) {
    values.push(`${filters.dateTo}T23:59:59.999Z`);
    conditions.push(`v.created_at <= $${values.length}::timestamptz`);
  }
  if (filters.branchId) {
    values.push(filters.branchId);
    conditions.push(`v.branch_id = $${values.length}::uuid`);
  }
  if (filters.agentId) {
    values.push(filters.agentId);
    conditions.push(`v.agent_id = $${values.length}::uuid`);
  }
  if (filters.customerId) {
    values.push(filters.customerId);
    conditions.push(`v.customer_id = $${values.length}::uuid`);
  }
  if (filters.cashboxId) {
    values.push(filters.cashboxId);
    conditions.push(`v.cashbox_id = $${values.length}::uuid`);
  }
  if (filters.status) {
    values.push(filters.status);
    conditions.push(`v.status = $${values.length}`);
  }

  const whereClause = conditions.length ? `where ${conditions.join(' and ')}` : '';

  const result = await pool.query(
    `
    select
      v.id,
      v.voucher_no,
      v.status,
      v.created_at,
      v.original_amount,
      v.original_currency,
      v.base_amount_usd,
      v.notes,
      v.branch_id,
      b.name as branch_name,
      v.cashbox_id,
      cb.name as cashbox_name,
      cb.code as cashbox_code,
      v.agent_id,
      a.name as agent_name,
      v.customer_id,
      c.name as customer_name,
      v.sender_receiver_id,
      sr.full_name as sender_receiver_name,
      case
        when v.sender_receiver_id is not null then sr.full_name
        when v.customer_id is not null then c.name
        when v.agent_id is not null then a.name
        else null
      end as party_display_name
    from ${table} v
    left join branches b on b.id = v.branch_id
    left join cashboxes cb on cb.id = v.cashbox_id
    left join agents a on a.id = v.agent_id
    left join customers c on c.id = v.customer_id
    left join senders_receivers sr on sr.id = v.sender_receiver_id
    ${whereClause}
    order by v.created_at asc, v.voucher_no asc
    `,
    values,
  );

  const rows = result.rows;
  const summaryByCurrency: Record<string, { count: number; total: number }> = {};
  for (const row of rows) {
    const cur = String(row.original_currency ?? 'USD').toUpperCase();
    if (!summaryByCurrency[cur]) summaryByCurrency[cur] = { count: 0, total: 0 };
    summaryByCurrency[cur].count += 1;
    summaryByCurrency[cur].total = money(summaryByCurrency[cur].total + Number(row.original_amount ?? 0));
  }

  return {
    voucherType,
    generatedAt: new Date().toISOString(),
    filters,
    summary: {
      count: rows.length,
      byCurrency: Object.entries(summaryByCurrency).map(([currency, s]) => ({
        currency,
        count: s.count,
        total: s.total,
      })),
      totalBaseUsd: money(rows.reduce((sum, r) => sum + Number(r.base_amount_usd ?? 0), 0)),
    },
    rows,
  };
}

export async function buildShipmentsByDateReport(
  scope: DataScope,
  filters: {
    dateFrom: string;
    dateTo?: string;
    branchId?: string;
    agentId?: string;
    currencyCode?: string;
  },
) {
  const values: unknown[] = [];
  const conditions: string[] = ['s.deleted_at is null'];

  if (scope.companyId) {
    values.push(scope.companyId);
    conditions.push(`s.company_id = $${values.length}::uuid`);
  }
  if (scope.branchId && !filters.branchId) {
    values.push(scope.branchId);
    conditions.push(`s.branch_id = $${values.length}::uuid`);
  }
  if (filters.branchId) {
    values.push(filters.branchId);
    conditions.push(`s.branch_id = $${values.length}::uuid`);
  }
  if (scope.agentId) {
    values.push(scope.agentId);
    conditions.push(`s.agent_id = $${values.length}::uuid`);
  } else if (filters.agentId) {
    values.push(filters.agentId);
    conditions.push(`s.agent_id = $${values.length}::uuid`);
  }

  values.push(filters.dateFrom);
  conditions.push(`coalesce(s.effective_date, s.created_at::date) >= $${values.length}::date`);
  const toDate = filters.dateTo ?? filters.dateFrom;
  values.push(toDate);
  conditions.push(`coalesce(s.effective_date, s.created_at::date) <= $${values.length}::date`);

  if (filters.currencyCode) {
    values.push(filters.currencyCode.toUpperCase());
    conditions.push(`upper(s.original_currency) = $${values.length}`);
  }

  const whereClause = `where ${conditions.join(' and ')}`;

  const result = await pool.query(
    `
    select
      s.id,
      s.shipment_no,
      coalesce(s.effective_date, s.created_at::date)::text as shipment_date,
      s.status,
      s.financial_status,
      s.payment_status,
      ag.name as agent_name,
      b.name as branch_name,
      sr_s.full_name as sender_name,
      sr_r.full_name as receiver_name,
      s.destination_city as destination,
      s.original_currency as currency_code,
      coalesce(s.transfer_fee, 0)::numeric as collect_amount,
      coalesce(s.prepaid_amount, 0)::numeric as prepaid_amount,
      coalesce(s.hawala_amount, 0)::numeric as hawala_amount,
      coalesce(s.transfer_service_fee, 0)::numeric as transfer_service_fee,
      coalesce(s.agent_commission_amount_snapshot, 0)::numeric as agent_commission,
      coalesce(s.weight_kg, 0)::numeric as weight_kg
    from shipments s
    left join agents ag on ag.id = s.agent_id
    left join branches b on b.id = s.branch_id
    left join senders_receivers sr_s on sr_s.id = s.sender_id
    left join senders_receivers sr_r on sr_r.id = s.receiver_id
    ${whereClause}
    order by coalesce(s.effective_date, s.created_at::date), s.shipment_no
  `,
    values,
  );

  const rows = result.rows;
  const summary = rows.reduce(
    (acc, row) => {
      acc.count += 1;
      acc.collect += money(row.collect_amount);
      acc.prepaid += money(row.prepaid_amount);
      acc.hawala += money(row.hawala_amount);
      acc.transferFee += money(row.transfer_service_fee);
      acc.commission += money(row.agent_commission);
      acc.weightKg += money(row.weight_kg);
      return acc;
    },
    { count: 0, collect: 0, prepaid: 0, hawala: 0, transferFee: 0, commission: 0, weightKg: 0 },
  );

  return {
    generatedAt: new Date().toISOString(),
    filters: { ...filters, dateTo: toDate },
    summary,
    rows,
  };
}

export async function buildDailyLedgerSummaryReport(
  companyId: string,
  filters: { dateFrom: string; dateTo?: string; branchId?: string },
) {
  const fromDate = filters.dateFrom;
  const toDate = filters.dateTo ?? filters.dateFrom;

  const audit = await buildLedgerFinanceAuditReport(companyId, fromDate);
  const days = audit.days.filter((d) => d.ledgerDate >= fromDate && d.ledgerDate <= toDate);

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

  return {
    generatedAt: new Date().toISOString(),
    dateFrom: fromDate,
    dateTo: toDate,
    branchId: filters.branchId ?? null,
    grand,
    days,
    issues: audit.issues.filter((issue) => {
      const m = issue.match(/^(\d{4}-\d{2}-\d{2})/);
      if (!m) return true;
      return m[1] >= fromDate && m[1] <= toDate;
    }),
  };
}
