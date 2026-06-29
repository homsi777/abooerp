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
};

export type MonthlyInventoryReport = {
  generatedAt: string;
  filters: MonthlyInventoryFilters;
  currencyCode: 'USD';
  totals: MonthlyInventoryColumnTotals;
  rows: MonthlyInventoryRow[];
};

function money(value: unknown): number {
  const n = Number(value ?? 0);
  if (!Number.isFinite(n)) return 0;
  return Math.round(n * 100) / 100;
}

export class MonthlyInventoryReportService {
  async buildReport(scope: DataScope | undefined, filters: MonthlyInventoryFilters): Promise<MonthlyInventoryReport> {
    if (!scope?.companyId) {
      throw new HttpError(400, 'Company context is required.');
    }

    const values: unknown[] = [scope.companyId, filters.dateFrom, filters.dateTo];
    let branchShipmentFilter = '';
    let branchTransferFilter = '';
    let branchExpenseFilter = '';
    let branchAgentFilter = '';

    if (filters.branchId) {
      values.push(filters.branchId);
      const branchParam = `$${values.length}::uuid`;
      branchShipmentFilter = `and s.branch_id = ${branchParam}`;
      branchTransferFilter = `and t.branch_id = ${branchParam}`;
      branchExpenseFilter = `and coalesce(pv.branch_id, cb.branch_id) = ${branchParam}`;
      branchAgentFilter = `and ag.branch_id = ${branchParam}`;
    }

    if (scope.branchId && !filters.branchId) {
      values.push(scope.branchId);
      const branchParam = `$${values.length}::uuid`;
      branchShipmentFilter = `and s.branch_id = ${branchParam}`;
      branchTransferFilter = `and t.branch_id = ${branchParam}`;
      branchExpenseFilter = `and coalesce(pv.branch_id, cb.branch_id) = ${branchParam}`;
      branchAgentFilter = `and ag.branch_id = ${branchParam}`;
    }

    const result = await pool.query(
      `
      with shipment_totals as (
        select
          s.agent_id,
          count(*)::int as shipment_count,
          coalesce(sum(coalesce(s.transfer_fee, 0)), 0)::numeric as collect_amount,
          coalesce(sum(coalesce(s.prepaid_amount, 0)), 0)::numeric as prepaid_amount,
          coalesce(sum(coalesce(s.hawala_amount, 0)), 0)::numeric as hawala_amount,
          coalesce(sum(coalesce(s.transfer_service_fee, 0)), 0)::numeric as transfer_fee_amount
        from shipments s
        where s.company_id = $1::uuid
          and s.deleted_at is null
          and upper(coalesce(s.status, '')) <> 'CANCELLED'
          and coalesce(s.effective_date, s.created_at::date) >= $2::date
          and coalesce(s.effective_date, s.created_at::date) <= $3::date
          ${branchShipmentFilter}
        group by s.agent_id
      ),
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
          ${branchTransferFilter}
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
          ${branchExpenseFilter}
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
          ${branchExpenseFilter}
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
         or internal_expense_amount > 0
         or external_expense_amount > 0
      order by party_type asc, party_name asc
      `,
      values,
    );

    const rows: MonthlyInventoryRow[] = result.rows.map((row) => ({
      partyId: row.party_id ? String(row.party_id) : null,
      partyType: row.party_type === 'unassigned' ? 'unassigned' : 'agent',
      partyName: String(row.party_name ?? '—'),
      branchName: row.branch_name ? String(row.branch_name) : null,
      collect: money(row.collect_amount),
      prepaid: money(row.prepaid_amount),
      hawala: money(row.hawala_amount),
      transferFees: money(row.transfer_fee_amount),
      internalExpenses: money(row.internal_expense_amount),
      externalExpenses: money(row.external_expense_amount),
      shipmentCount: Number(row.shipment_count ?? 0),
      transferCount: Number(row.transfer_count ?? 0),
    }));

    const totals = rows.reduce<MonthlyInventoryColumnTotals>(
      (acc, row) => {
        acc.collect += row.collect;
        acc.prepaid += row.prepaid;
        acc.hawala += row.hawala;
        acc.transferFees += row.transferFees;
        acc.internalExpenses += row.internalExpenses;
        acc.externalExpenses += row.externalExpenses;
        return acc;
      },
      {
        collect: 0,
        prepaid: 0,
        hawala: 0,
        transferFees: 0,
        internalExpenses: 0,
        externalExpenses: 0,
      },
    );

    for (const key of Object.keys(totals) as Array<keyof MonthlyInventoryColumnTotals>) {
      totals[key] = money(totals[key]);
    }

    return {
      generatedAt: new Date().toISOString(),
      filters,
      currencyCode: 'USD',
      totals,
      rows,
    };
  }
}
