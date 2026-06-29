import { pool } from '../db/pool.js';
import type { DataScope } from '../utils/scope.js';
import { HttpError } from '../utils/errors.js';

export type MonthlyInventoryFilters = {
  dateFrom: string;
  dateTo: string;
  branchId?: string;
};

export type MonthlyInventoryRow = {
  partyId: string | null;
  partyType: 'agent' | 'unassigned';
  partyName: string;
  branchName: string | null;
  collect: number;
  prepaid: number;
  hawala: number;
  transferFees: number;
  internalExpenses: number;
  externalExpenses: number;
  /** عمولة الوكيل (نسبة من التحصيل + الدفع المسبق) */
  agentShare: number;
  /** إيراد الربح قبل عمولة الوكيل: تحصيل + مسبق + أجور حوالات */
  grossProfit: number;
  /** صافي فرع حلب بعد عمولة الوكيل والمصاريف الداخلية والخارجية */
  companyFinalNet: number;
  shipmentCount: number;
  transferCount: number;
};

export type MonthlyInventoryColumnTotals = {
  collect: number;
  prepaid: number;
  hawala: number;
  transferFees: number;
  internalExpenses: number;
  externalExpenses: number;
  agentShare: number;
  grossProfit: number;
  companyFinalNet: number;
};

export type MonthlyInventoryReport = {
  generatedAt: string;
  filters: MonthlyInventoryFilters;
  currencyCode: 'USD';
  totals: MonthlyInventoryColumnTotals;
  rows: MonthlyInventoryRow[];
};

export type MonthlyInventoryDetailLine = {
  id: string;
  category: 'shipment' | 'transfer' | 'internal_expense' | 'external_expense';
  categoryLabel: string;
  eventDate: string;
  referenceNo: string;
  description: string;
  collect: number;
  prepaid: number;
  hawala: number;
  transferFees: number;
  internalExpenses: number;
  externalExpenses: number;
  agentShare: number;
  grossProfit: number;
  companyFinalNet: number;
};

export type MonthlyInventoryPartyDetail = {
  generatedAt: string;
  filters: MonthlyInventoryFilters & {
    partyId: string | null;
    partyType: 'agent' | 'unassigned';
    partyName: string;
  };
  currencyCode: 'USD';
  totals: MonthlyInventoryColumnTotals;
  lines: MonthlyInventoryDetailLine[];
};

function money(value: unknown): number {
  const n = Number(value ?? 0);
  if (!Number.isFinite(n)) return 0;
  return Math.round(n * 100) / 100;
}

/** ربح تشغيلي قبل عمولة الوكيل — بدون أصل الحوالة (عهدة توريد). */
function computeGrossProfit(input: {
  collect: number;
  prepaid: number;
  transferFees: number;
}): number {
  return money(input.collect + input.prepaid + input.transferFees);
}

/**
 * صافي الشركة (حلب):
 * عمولة الوكيل تُخصم من التحصيل+المسبق فقط — أجور الحوالات كاملة للشركة.
 */
function computeCompanyFinalNet(input: {
  collect: number;
  prepaid: number;
  transferFees: number;
  agentShare: number;
  internalExpenses: number;
  externalExpenses: number;
}): number {
  const shippingAfterCommission = money(money(input.collect) + money(input.prepaid) - money(input.agentShare));
  return money(
    shippingAfterCommission
      + money(input.transferFees)
      - money(input.internalExpenses)
      - money(input.externalExpenses),
  );
}

/** عمولة الوكيل — حصراً من تحصيل + دفع مسبق (نفس قاعدة الدفتر). */
const AGENT_SHARE_FROM_LEDGER_SQL = `
  case
    when greatest(coalesce(dlr.collect_amount_usd, 0) + coalesce(dlr.prepaid_amount_usd, 0), 0) <= 0 then 0::numeric
    when coalesce(s.agent_commission_percentage_snapshot, 0) > 0 then round(
      (coalesce(dlr.collect_amount_usd, 0) + coalesce(dlr.prepaid_amount_usd, 0))
      * s.agent_commission_percentage_snapshot / 100,
      2
    )
    else least(
      coalesce(s.agent_commission_amount_snapshot, 0),
      greatest(coalesce(dlr.collect_amount_usd, 0) + coalesce(dlr.prepaid_amount_usd, 0), 0)
    )
  end::numeric`;

const AGENT_SHARE_FROM_SHIPMENT_SQL = `
  case
    when greatest(
      coalesce(s.transfer_fee, 0) + greatest(coalesce(s.prepaid_amount, 0), coalesce(s.freight_charge, 0)),
      0
    ) <= 0 then 0::numeric
    when coalesce(s.agent_commission_percentage_snapshot, 0) > 0 then round(
      (coalesce(s.transfer_fee, 0) + greatest(coalesce(s.prepaid_amount, 0), coalesce(s.freight_charge, 0)))
      * s.agent_commission_percentage_snapshot / 100,
      2
    )
    else coalesce(s.agent_commission_amount_snapshot, 0)
  end::numeric`;

function emptyTotals(): MonthlyInventoryColumnTotals {
  return {
    collect: 0,
    prepaid: 0,
    hawala: 0,
    transferFees: 0,
    internalExpenses: 0,
    externalExpenses: 0,
    agentShare: 0,
    grossProfit: 0,
    companyFinalNet: 0,
  };
}

function accumulateTotals(
  acc: MonthlyInventoryColumnTotals,
  row: Pick<
    MonthlyInventoryRow,
    | 'collect'
    | 'prepaid'
    | 'hawala'
    | 'transferFees'
    | 'internalExpenses'
    | 'externalExpenses'
    | 'agentShare'
    | 'grossProfit'
    | 'companyFinalNet'
  >,
): MonthlyInventoryColumnTotals {
  acc.collect += row.collect;
  acc.prepaid += row.prepaid;
  acc.hawala += row.hawala;
  acc.transferFees += row.transferFees;
  acc.internalExpenses += row.internalExpenses;
  acc.externalExpenses += row.externalExpenses;
  acc.agentShare += row.agentShare;
  acc.grossProfit += row.grossProfit;
  acc.companyFinalNet += row.companyFinalNet;
  return acc;
}

function finalizeTotals(totals: MonthlyInventoryColumnTotals): MonthlyInventoryColumnTotals {
  const next = { ...totals };
  for (const key of Object.keys(next) as Array<keyof MonthlyInventoryColumnTotals>) {
    next[key] = money(next[key]);
  }
  return next;
}

type ScopeFilters = {
  companyId: string;
  dateFrom: string;
  dateTo: string;
  branchShipmentFilter: string;
  branchTransferFilter: string;
  branchExpenseFilter: string;
  values: unknown[];
};

function buildScopeFilters(
  scope: DataScope | undefined,
  filters: MonthlyInventoryFilters,
): ScopeFilters {
  if (!scope?.companyId) {
    throw new HttpError(400, 'Company context is required.');
  }

  const values: unknown[] = [scope.companyId, filters.dateFrom, filters.dateTo];
  let branchShipmentFilter = '';
  let branchTransferFilter = '';
  let branchExpenseFilter = '';

  if (filters.branchId) {
    values.push(filters.branchId);
    const branchParam = `$${values.length}::uuid`;
    branchShipmentFilter = `and s.branch_id = ${branchParam}`;
    branchTransferFilter = `and t.branch_id = ${branchParam}`;
    branchExpenseFilter = `and coalesce(pv.branch_id, cb.branch_id) = ${branchParam}`;
  }

  if (scope.branchId && !filters.branchId) {
    values.push(scope.branchId);
    const branchParam = `$${values.length}::uuid`;
    branchShipmentFilter = `and s.branch_id = ${branchParam}`;
    branchTransferFilter = `and t.branch_id = ${branchParam}`;
    branchExpenseFilter = `and coalesce(pv.branch_id, cb.branch_id) = ${branchParam}`;
  }

  return {
    companyId: scope.companyId,
    dateFrom: filters.dateFrom,
    dateTo: filters.dateTo,
    branchShipmentFilter,
    branchTransferFilter,
    branchExpenseFilter,
    values,
  };
}

function agentMatchSql(values: unknown[], agentId: string | null, expression: string): string {
  if (agentId) {
    values.push(agentId);
    return `${expression} = $${values.length}::uuid`;
  }
  return `${expression} is null`;
}

const CATEGORY_LABELS: Record<MonthlyInventoryDetailLine['category'], string> = {
  shipment: 'شحنة',
  transfer: 'حوالة مستقلة',
  internal_expense: 'مصروف داخلي',
  external_expense: 'مصروف خارجي',
};

/** شروط تاريخ الشحنة — تاريخ الدفتر أولاً ثم effective_date */
const SHIPMENT_LEDGER_DATE_EXPR =
  'coalesce(s.effective_date, dls.ledger_date, s.created_at::date)';
const SHIPMENT_ORPHAN_DATE_EXPR = 'coalesce(s.effective_date, s.created_at::date)';

function shipmentLedgerMoneyCtes(branchShipmentFilter: string): string {
  return `
      shipment_money_lines as (
        select
          s.id as shipment_id,
          s.agent_id,
          coalesce(dlr.collect_amount_usd, 0)::numeric as collect_amount,
          coalesce(dlr.prepaid_amount_usd, 0)::numeric as prepaid_amount,
          coalesce(dlr.hawala_amount_usd, 0)::numeric as hawala_amount,
          coalesce(dlr.transfer_service_fee_usd, 0)::numeric as transfer_fee_amount,
          ${AGENT_SHARE_FROM_LEDGER_SQL} as agent_share_amount
        from daily_ledger_rows dlr
        inner join shipments s on s.id = dlr.posted_shipment_id and s.deleted_at is null
        inner join daily_ledger_sessions dls on dls.id = dlr.session_id and dls.deleted_at is null
        where dlr.deleted_at is null
          and dlr.posted_shipment_id is not null
          and s.company_id = $1::uuid
          and upper(coalesce(s.status, '')) <> 'CANCELLED'
          and ${SHIPMENT_LEDGER_DATE_EXPR} >= $2::date
          and ${SHIPMENT_LEDGER_DATE_EXPR} <= $3::date
          ${branchShipmentFilter}

        union all

        select
          s.id as shipment_id,
          s.agent_id,
          coalesce(s.transfer_fee, 0)::numeric as collect_amount,
          greatest(coalesce(s.prepaid_amount, 0), coalesce(s.freight_charge, 0))::numeric as prepaid_amount,
          coalesce(s.hawala_amount, 0)::numeric as hawala_amount,
          coalesce(s.transfer_service_fee, 0)::numeric as transfer_fee_amount,
          ${AGENT_SHARE_FROM_SHIPMENT_SQL} as agent_share_amount
        from shipments s
        where s.company_id = $1::uuid
          and s.deleted_at is null
          and upper(coalesce(s.status, '')) <> 'CANCELLED'
          and ${SHIPMENT_ORPHAN_DATE_EXPR} >= $2::date
          and ${SHIPMENT_ORPHAN_DATE_EXPR} <= $3::date
          ${branchShipmentFilter}
          and not exists (
            select 1
            from daily_ledger_rows dlr
            where dlr.posted_shipment_id = s.id
              and dlr.deleted_at is null
          )
      ),
      shipment_totals as (
        select
          agent_id,
          count(*)::int as shipment_count,
          coalesce(sum(collect_amount), 0)::numeric as collect_amount,
          coalesce(sum(prepaid_amount), 0)::numeric as prepaid_amount,
          coalesce(sum(hawala_amount), 0)::numeric as hawala_amount,
          coalesce(sum(transfer_fee_amount), 0)::numeric as transfer_fee_amount,
          coalesce(sum(agent_share_amount), 0)::numeric as agent_share_amount
        from shipment_money_lines
        group by agent_id
      )`;
}

export class MonthlyInventoryReportService {
  async buildReport(scope: DataScope | undefined, filters: MonthlyInventoryFilters): Promise<MonthlyInventoryReport> {
    const scoped = buildScopeFilters(scope, filters);
    const values = [...scoped.values];
    let branchAgentFilter = '';

    if (filters.branchId) {
      values.push(filters.branchId);
      branchAgentFilter = `and ag.branch_id = $${values.length}::uuid`;
    } else if (scope?.branchId) {
      values.push(scope.branchId);
      branchAgentFilter = `and ag.branch_id = $${values.length}::uuid`;
    }

    const result = await pool.query(
      `
      with ${shipmentLedgerMoneyCtes(scoped.branchShipmentFilter)},
      standalone_transfer_totals as (
        select
          coalesce(t.agent_id, t.destination_agent_id) as agent_id,
          count(*)::int as transfer_count,
          coalesce(sum(coalesce(t.amount, 0)), 0)::numeric as hawala_amount,
          coalesce(sum(coalesce(t.transfer_service_fee, 0)), 0)::numeric as transfer_fee_amount
        from transfers t
        where t.company_id = $1::uuid
          and t.shipment_id is null
          and upper(coalesce(t.status, '')) <> 'CANCELLED'
          and coalesce(t.transfer_date::date, t.created_at::date) >= $2::date
          and coalesce(t.transfer_date::date, t.created_at::date) <= $3::date
          ${scoped.branchTransferFilter}
        group by coalesce(t.agent_id, t.destination_agent_id)
      ),
      internal_expense_totals as (
        select
          coalesce(pv.agent_id, cb.agent_id) as agent_id,
          coalesce(sum(coalesce(pv.base_amount_usd, 0)), 0)::numeric as expense_amount
        from payment_vouchers pv
        left join cashboxes cb on cb.id = pv.cashbox_id
        where pv.company_id = $1::uuid
          and pv.status = 'confirmed'
          and pv.related_entity_type = 'expense'
          and pv.created_at >= $2::date::timestamptz
          and pv.created_at <= ($3::date::text || 'T23:59:59.999Z')::timestamptz
          ${scoped.branchExpenseFilter}
        group by coalesce(pv.agent_id, cb.agent_id)
      ),
      external_expense_totals as (
        select
          coalesce(pv.agent_id, cb.agent_id) as agent_id,
          coalesce(sum(coalesce(pv.base_amount_usd, 0)), 0)::numeric as expense_amount
        from payment_vouchers pv
        left join cashboxes cb on cb.id = pv.cashbox_id
        where pv.company_id = $1::uuid
          and pv.status = 'confirmed'
          and pv.related_entity_type = 'manual_party'
          and pv.created_at >= $2::date::timestamptz
          and pv.created_at <= ($3::date::text || 'T23:59:59.999Z')::timestamptz
          ${scoped.branchExpenseFilter}
        group by coalesce(pv.agent_id, cb.agent_id)
      ),
      party_ids as (
        select agent_id from shipment_totals
        union
        select agent_id from standalone_transfer_totals
        union
        select agent_id from internal_expense_totals
        union
        select agent_id from external_expense_totals
      ),
      agent_rows as (
        select
          ag.id as party_id,
          'agent'::text as party_type,
          ag.name as party_name,
          b.name as branch_name,
          coalesce(st.shipment_count, 0) as shipment_count,
          coalesce(tt.transfer_count, 0) as transfer_count,
          coalesce(st.collect_amount, 0) as collect_amount,
          coalesce(st.prepaid_amount, 0) as prepaid_amount,
          coalesce(st.hawala_amount, 0) + coalesce(tt.hawala_amount, 0) as hawala_amount,
          coalesce(st.transfer_fee_amount, 0) + coalesce(tt.transfer_fee_amount, 0) as transfer_fee_amount,
          coalesce(st.agent_share_amount, 0) as agent_share_amount,
          coalesce(ie.expense_amount, 0) as internal_expense_amount,
          coalesce(ee.expense_amount, 0) as external_expense_amount
        from party_ids pid
        join agents ag on ag.id = pid.agent_id
        join branches b on b.id = ag.branch_id and b.company_id = $1::uuid
        left join shipment_totals st on st.agent_id = ag.id
        left join standalone_transfer_totals tt on tt.agent_id = ag.id
        left join internal_expense_totals ie on ie.agent_id = ag.id
        left join external_expense_totals ee on ee.agent_id = ag.id
        where pid.agent_id is not null
          ${branchAgentFilter}
      ),
      unassigned_row as (
        select
          null::uuid as party_id,
          'unassigned'::text as party_type,
          'غير مُسنَد لوكيل'::text as party_name,
          null::text as branch_name,
          coalesce((select shipment_count from shipment_totals where agent_id is null), 0) as shipment_count,
          coalesce((select transfer_count from standalone_transfer_totals where agent_id is null), 0) as transfer_count,
          coalesce((select collect_amount from shipment_totals where agent_id is null), 0) as collect_amount,
          coalesce((select prepaid_amount from shipment_totals where agent_id is null), 0) as prepaid_amount,
          coalesce((select hawala_amount from shipment_totals where agent_id is null), 0)
            + coalesce((select hawala_amount from standalone_transfer_totals where agent_id is null), 0) as hawala_amount,
          coalesce((select transfer_fee_amount from shipment_totals where agent_id is null), 0)
            + coalesce((select transfer_fee_amount from standalone_transfer_totals where agent_id is null), 0) as transfer_fee_amount,
          coalesce((select agent_share_amount from shipment_totals where agent_id is null), 0) as agent_share_amount,
          coalesce((select expense_amount from internal_expense_totals where agent_id is null), 0) as internal_expense_amount,
          coalesce((select expense_amount from external_expense_totals where agent_id is null), 0) as external_expense_amount
      )
      select * from agent_rows
      union all
      select * from unassigned_row
      where shipment_count > 0
         or transfer_count > 0
         or collect_amount > 0
         or prepaid_amount > 0
         or hawala_amount > 0
         or transfer_fee_amount > 0
         or agent_share_amount > 0
         or internal_expense_amount > 0
         or external_expense_amount > 0
      order by party_type asc, party_name asc
      `,
      values,
    );

    const rows: MonthlyInventoryRow[] = result.rows.map((row) => {
      const collect = money(row.collect_amount);
      const prepaid = money(row.prepaid_amount);
      const hawala = money(row.hawala_amount);
      const transferFees = money(row.transfer_fee_amount);
      const internalExpenses = money(row.internal_expense_amount);
      const externalExpenses = money(row.external_expense_amount);
      const agentShare = money(row.agent_share_amount);
      const grossProfit = computeGrossProfit({ collect, prepaid, transferFees });
      const companyFinalNet = computeCompanyFinalNet({
        collect,
        prepaid,
        transferFees,
        agentShare,
        internalExpenses,
        externalExpenses,
      });
      return {
        partyId: row.party_id ? String(row.party_id) : null,
        partyType: row.party_type === 'unassigned' ? 'unassigned' : 'agent',
        partyName: String(row.party_name ?? '—'),
        branchName: row.branch_name ? String(row.branch_name) : null,
        collect,
        prepaid,
        hawala,
        transferFees,
        internalExpenses,
        externalExpenses,
        agentShare,
        grossProfit,
        companyFinalNet,
        shipmentCount: Number(row.shipment_count ?? 0),
        transferCount: Number(row.transfer_count ?? 0),
      };
    });

    const totals = finalizeTotals(
      rows.reduce((acc, row) => accumulateTotals(acc, row), emptyTotals()),
    );

    return {
      generatedAt: new Date().toISOString(),
      filters,
      currencyCode: 'USD',
      totals,
      rows,
    };
  }

  async buildPartyDetail(
    scope: DataScope | undefined,
    filters: MonthlyInventoryFilters & {
      partyId?: string | null;
      partyType: 'agent' | 'unassigned';
      partyName?: string;
    },
  ): Promise<MonthlyInventoryPartyDetail> {
    const scoped = buildScopeFilters(scope, filters);
    const values = [...scoped.values];
    const agentId = filters.partyType === 'unassigned' ? null : (filters.partyId ?? null);
    if (filters.partyType === 'agent' && !agentId) {
      throw new HttpError(400, 'partyId is required for agent party detail.');
    }

    const shipmentAgentFilter = agentMatchSql(values, agentId, 's.agent_id');
    const transferAgentFilter = agentMatchSql(
      values,
      agentId,
      'coalesce(t.agent_id, t.destination_agent_id)',
    );
    const expenseAgentFilter = agentMatchSql(
      values,
      agentId,
      'coalesce(pv.agent_id, cb.agent_id)',
    );

    let partyName = filters.partyName?.trim() || '';
    if (!partyName && agentId) {
      const agentResult = await pool.query<{ name: string }>(
        `
        select a.name
        from agents a
        join branches b on b.id = a.branch_id
        where a.id = $1::uuid
          and b.company_id = $2::uuid
        limit 1
        `,
        [agentId, scoped.companyId],
      );
      partyName = agentResult.rows[0]?.name ?? 'وكيل';
    }
    if (!partyName) partyName = 'غير مُسنَد لوكيل';

    const result = await pool.query(
      `
      select *
      from (
        select
          dlr.id::text as id,
          'shipment'::text as category,
          ${SHIPMENT_LEDGER_DATE_EXPR}::text as event_date,
          coalesce(nullif(trim(dlr.receipt_no), ''), s.shipment_no, '') as reference_no,
          trim(
            concat_ws(
              ' — ',
              nullif(trim(coalesce(dlr.destination, s.destination_city, '')), ''),
              nullif(
                trim(concat(coalesce(dlr.sender_name, sr_s.full_name, ''), ' → ', coalesce(dlr.receiver_name, sr_r.full_name, ''))),
                ' → '
              )
            )
          ) as description,
          coalesce(dlr.collect_amount_usd, 0)::numeric as collect_amount,
          coalesce(dlr.prepaid_amount_usd, 0)::numeric as prepaid_amount,
          coalesce(dlr.hawala_amount_usd, 0)::numeric as hawala_amount,
          coalesce(dlr.transfer_service_fee_usd, 0)::numeric as transfer_fee_amount,
          0::numeric as internal_expense_amount,
          0::numeric as external_expense_amount,
          ${AGENT_SHARE_FROM_LEDGER_SQL} as agent_share_amount
        from daily_ledger_rows dlr
        inner join shipments s on s.id = dlr.posted_shipment_id and s.deleted_at is null
        inner join daily_ledger_sessions dls on dls.id = dlr.session_id and dls.deleted_at is null
        left join senders_receivers sr_s on sr_s.id = s.sender_id
        left join senders_receivers sr_r on sr_r.id = s.receiver_id
        where dlr.deleted_at is null
          and dlr.posted_shipment_id is not null
          and s.company_id = $1::uuid
          and upper(coalesce(s.status, '')) <> 'CANCELLED'
          and ${SHIPMENT_LEDGER_DATE_EXPR} >= $2::date
          and ${SHIPMENT_LEDGER_DATE_EXPR} <= $3::date
          and ${shipmentAgentFilter}
          ${scoped.branchShipmentFilter}

        union all

        select
          s.id::text as id,
          'shipment'::text as category,
          ${SHIPMENT_ORPHAN_DATE_EXPR}::text as event_date,
          coalesce(s.shipment_no, '') as reference_no,
          trim(
            concat_ws(
              ' — ',
              nullif(trim(coalesce(s.destination_city, '')), ''),
              nullif(trim(concat(coalesce(sr_s.full_name, ''), ' → ', coalesce(sr_r.full_name, ''))), ' → ')
            )
          ) as description,
          coalesce(s.transfer_fee, 0)::numeric as collect_amount,
          greatest(coalesce(s.prepaid_amount, 0), coalesce(s.freight_charge, 0))::numeric as prepaid_amount,
          coalesce(s.hawala_amount, 0)::numeric as hawala_amount,
          coalesce(s.transfer_service_fee, 0)::numeric as transfer_fee_amount,
          0::numeric as internal_expense_amount,
          0::numeric as external_expense_amount,
          ${AGENT_SHARE_FROM_SHIPMENT_SQL} as agent_share_amount
        from shipments s
        left join senders_receivers sr_s on sr_s.id = s.sender_id
        left join senders_receivers sr_r on sr_r.id = s.receiver_id
        where s.company_id = $1::uuid
          and s.deleted_at is null
          and upper(coalesce(s.status, '')) <> 'CANCELLED'
          and ${SHIPMENT_ORPHAN_DATE_EXPR} >= $2::date
          and ${SHIPMENT_ORPHAN_DATE_EXPR} <= $3::date
          and ${shipmentAgentFilter}
          ${scoped.branchShipmentFilter}
          and not exists (
            select 1
            from daily_ledger_rows dlr
            where dlr.posted_shipment_id = s.id
              and dlr.deleted_at is null
          )

        union all

        select
          t.id::text as id,
          'transfer'::text as category,
          coalesce(t.transfer_date::date, t.created_at::date)::text as event_date,
          coalesce(nullif(trim(t.notes), ''), t.id::text) as reference_no,
          trim(concat(coalesce(t.sender_name, ''), ' → ', coalesce(t.receiver_name, ''))) as description,
          0::numeric as collect_amount,
          0::numeric as prepaid_amount,
          coalesce(t.amount, 0)::numeric as hawala_amount,
          coalesce(t.transfer_service_fee, 0)::numeric as transfer_fee_amount,
          0::numeric as internal_expense_amount,
          0::numeric as external_expense_amount,
          0::numeric as agent_share_amount
        from transfers t
        where t.company_id = $1::uuid
          and t.shipment_id is null
          and upper(coalesce(t.status, '')) <> 'CANCELLED'
          and coalesce(t.transfer_date::date, t.created_at::date) >= $2::date
          and coalesce(t.transfer_date::date, t.created_at::date) <= $3::date
          and ${transferAgentFilter}
          ${scoped.branchTransferFilter}

        union all

        select
          pv.id::text as id,
          'internal_expense'::text as category,
          pv.created_at::date::text as event_date,
          coalesce(pv.voucher_no, '') as reference_no,
          coalesce(nullif(trim(pv.notes), ''), 'مصروف داخلي') as description,
          0::numeric as collect_amount,
          0::numeric as prepaid_amount,
          0::numeric as hawala_amount,
          0::numeric as transfer_fee_amount,
          coalesce(pv.base_amount_usd, 0)::numeric as internal_expense_amount,
          0::numeric as external_expense_amount,
          0::numeric as agent_share_amount
        from payment_vouchers pv
        left join cashboxes cb on cb.id = pv.cashbox_id
        where pv.company_id = $1::uuid
          and pv.status = 'confirmed'
          and pv.related_entity_type = 'expense'
          and pv.created_at >= $2::date::timestamptz
          and pv.created_at <= ($3::date::text || 'T23:59:59.999Z')::timestamptz
          and ${expenseAgentFilter}
          ${scoped.branchExpenseFilter}

        union all

        select
          pv.id::text as id,
          'external_expense'::text as category,
          pv.created_at::date::text as event_date,
          coalesce(pv.voucher_no, '') as reference_no,
          coalesce(
            nullif(
              trim(split_part(regexp_replace(coalesce(pv.notes, ''), '^\\s*جهة:\\s*', ''), ' - ', 1)),
              ''
            ),
            coalesce(nullif(trim(pv.notes), ''), 'مصروف خارجي')
          ) as description,
          0::numeric as collect_amount,
          0::numeric as prepaid_amount,
          0::numeric as hawala_amount,
          0::numeric as transfer_fee_amount,
          0::numeric as internal_expense_amount,
          coalesce(pv.base_amount_usd, 0)::numeric as external_expense_amount,
          0::numeric as agent_share_amount
        from payment_vouchers pv
        left join cashboxes cb on cb.id = pv.cashbox_id
        where pv.company_id = $1::uuid
          and pv.status = 'confirmed'
          and pv.related_entity_type = 'manual_party'
          and pv.created_at >= $2::date::timestamptz
          and pv.created_at <= ($3::date::text || 'T23:59:59.999Z')::timestamptz
          and ${expenseAgentFilter}
          ${scoped.branchExpenseFilter}
      ) lines
      where
        collect_amount <> 0
        or prepaid_amount <> 0
        or hawala_amount <> 0
        or transfer_fee_amount <> 0
        or internal_expense_amount <> 0
        or external_expense_amount <> 0
        or agent_share_amount <> 0
      order by event_date asc, category asc, reference_no asc
      `,
      values,
    );

    const lines: MonthlyInventoryDetailLine[] = result.rows.map((row) => {
      const category = row.category as MonthlyInventoryDetailLine['category'];
      const collect = money(row.collect_amount);
      const prepaid = money(row.prepaid_amount);
      const hawala = money(row.hawala_amount);
      const transferFees = money(row.transfer_fee_amount);
      const internalExpenses = money(row.internal_expense_amount);
      const externalExpenses = money(row.external_expense_amount);
      const agentShare = money(row.agent_share_amount);
      const grossProfit = computeGrossProfit({ collect, prepaid, transferFees });
      const companyFinalNet = computeCompanyFinalNet({
        collect,
        prepaid,
        transferFees,
        agentShare,
        internalExpenses,
        externalExpenses,
      });
      return {
        id: String(row.id),
        category,
        categoryLabel: CATEGORY_LABELS[category] ?? String(row.category),
        eventDate: String(row.event_date ?? '').slice(0, 10),
        referenceNo: String(row.reference_no ?? ''),
        description: String(row.description ?? ''),
        collect,
        prepaid,
        hawala,
        transferFees,
        internalExpenses,
        externalExpenses,
        agentShare,
        grossProfit,
        companyFinalNet,
      };
    });

    const totals = finalizeTotals(
      lines.reduce((acc, line) => accumulateTotals(acc, line), emptyTotals()),
    );

    return {
      generatedAt: new Date().toISOString(),
      filters: {
        ...filters,
        partyId: agentId,
        partyType: filters.partyType,
        partyName,
      },
      currencyCode: 'USD',
      totals,
      lines,
    };
  }
}
