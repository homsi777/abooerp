import { pool } from '../db/pool.js';

export interface AgentRecord {
  id: string;
  code: string;
  name: string;
  phone: string | null;
  governorate: string | null;
  city: string | null;
  area: string | null;
  address: string | null;
  notes: string | null;
  branch_id: string | null;
  telegram_chat_id: string | null;
  is_active: boolean;
  commission_percentage: number;
  created_at: string;
  updated_at: string;
}

export interface CreateAgentInput {
  code: string;
  name: string;
  phone?: string;
  governorate?: string;
  city?: string;
  area?: string;
  address?: string;
  notes?: string;
  branch_id: string;
  telegram_chat_id?: string | null;
  is_active?: boolean;
  commission_percentage?: number;
}

export interface UpdateAgentInput {
  code?: string;
  name?: string;
  phone?: string;
  governorate?: string;
  city?: string;
  area?: string;
  address?: string;
  notes?: string;
  branch_id?: string | null;
  telegram_chat_id?: string | null;
  is_active?: boolean;
  commission_percentage?: number;
}

export interface CreateAgentReconciliationInput {
  balanceAmount?: number;
  currencyCode?: string;
  notes?: string;
  createdByUserId?: string | null;
}

export class AgentRepository {
  async listAgents(companyId: string, branchId?: string, includeInactive = false): Promise<AgentRecord[]> {
    const result = await pool.query<AgentRecord>(
      `
      select a.id, a.code, a.name, a.phone, a.governorate, a.city, a.area, a.address, a.notes, a.branch_id, a.telegram_chat_id, a.is_active, a.commission_percentage, a.created_at::text, a.updated_at::text
      from agents a
      join branches b on b.id = a.branch_id
      where b.company_id = $1
        and ($2::uuid is null or a.branch_id = $2::uuid)
        and ($3::boolean = true or a.is_active = true)
      order by a.created_at desc
      `,
      [companyId, branchId ?? null, includeInactive],
    );
    return result.rows;
  }

  async getAgentById(id: string, companyId: string): Promise<AgentRecord | null> {
    const result = await pool.query<AgentRecord>(
      `
      select a.id, a.code, a.name, a.phone, a.governorate, a.city, a.area, a.address, a.notes, a.branch_id, a.telegram_chat_id, a.is_active, a.commission_percentage, a.created_at::text, a.updated_at::text
      from agents a
      join branches b on b.id = a.branch_id
      where a.id = $1
        and b.company_id = $2
      limit 1
      `,
      [id, companyId],
    );
    return result.rows[0] ?? null;
  }

  async branchBelongsToCompany(branchId: string, companyId: string): Promise<boolean> {
    const result = await pool.query(
      `
      select 1
      from branches
      where id = $1 and company_id = $2
      limit 1
      `,
      [branchId, companyId],
    );
    return (result.rowCount ?? 0) > 0;
  }

  async createAgent(companyId: string, data: CreateAgentInput): Promise<AgentRecord> {
    const result = await pool.query<AgentRecord>(
      `
      insert into agents(code, name, phone, governorate, city, area, address, notes, branch_id, telegram_chat_id, is_active, commission_percentage)
      values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, coalesce($11, true), coalesce($12, 0))
      returning id, code, name, phone, governorate, city, area, address, notes, branch_id, telegram_chat_id, is_active, commission_percentage, created_at::text, updated_at::text
      `,
      [data.code, data.name, data.phone ?? null, data.governorate ?? null, data.city ?? null, data.area ?? null, data.address ?? null, data.notes ?? null, data.branch_id ?? null, data.telegram_chat_id ?? null, data.is_active ?? true, data.commission_percentage ?? 0],
    );
    return result.rows[0];
  }

  async updateAgent(id: string, companyId: string, data: UpdateAgentInput): Promise<AgentRecord | null> {
    const result = await pool.query<AgentRecord>(
      `
      update agents a
      set
        code        = coalesce($3, a.code),
        name        = coalesce($4, a.name),
        phone       = coalesce($5, a.phone),
        governorate = coalesce($6, a.governorate),
        city        = coalesce($7, a.city),
        area        = coalesce($8, a.area),
        address     = coalesce($9, a.address),
        notes       = coalesce($10, a.notes),
        branch_id   = case when $13::boolean = true then null else coalesce($11::uuid, a.branch_id) end,
        is_active   = coalesce($12, a.is_active),
        telegram_chat_id = case when $15::boolean = true then null else coalesce($14, a.telegram_chat_id) end,
        commission_percentage = coalesce($16, a.commission_percentage),
        updated_at  = now()
      where a.id = $1
        and exists(
          select 1
          from branches b
          where b.id = a.branch_id
            and b.company_id = $2
        )
      returning a.id, a.code, a.name, a.phone, a.governorate, a.city, a.area, a.address, a.notes, a.branch_id, a.telegram_chat_id, a.is_active, a.commission_percentage, a.created_at::text, a.updated_at::text
      `,
      [
        id,
        companyId,
        data.code ?? null,
        data.name ?? null,
        data.phone ?? null,
        data.governorate ?? null,
        data.city ?? null,
        data.area ?? null,
        data.address ?? null,
        data.notes ?? null,
        data.branch_id ?? null,
        data.is_active,
        data.branch_id === null,
        data.telegram_chat_id ?? null,
        data.telegram_chat_id === null,
        data.commission_percentage ?? null,
      ],
    );
    return result.rows[0] ?? null;
  }

  async deactivateAgent(id: string, companyId: string): Promise<boolean> {
    const result = await pool.query(
      `
      update agents a
      set is_active = false, updated_at = now()
      where a.id = $1
        and exists(
          select 1
          from branches b
          where b.id = a.branch_id
            and b.company_id = $2
        )
        and a.is_active = true
      `,
      [id, companyId],
    );
    return (result.rowCount ?? 0) > 0;
  }

  async lookupByDestination(companyId: string, destination: string, _branchId?: string): Promise<AgentRecord[]> {
    const normalized = destination.trim().toLowerCase();
    const result = await pool.query<AgentRecord>(
      `
      select a.id, a.code, a.name, a.phone, a.governorate, a.city, a.area, a.address, a.notes, a.branch_id, a.telegram_chat_id, a.is_active, a.commission_percentage, a.created_at::text, a.updated_at::text
      from agents a
      join branches b on b.id = a.branch_id
      where b.company_id = $1
        and a.is_active = true
        and (
          lower(coalesce(a.area, '')) = $2
          or lower(coalesce(a.city, '')) = $2
          or lower(coalesce(a.governorate, '')) = $2
        )
      order by a.created_at desc
      `,
      [companyId, normalized],
    );
    return result.rows;
  }

  private async getLastAgentReconciliation(companyId: string, agentId: string) {
    const result = await pool.query(
      `
      select
        ar.id,
        ar.reconciled_at::text as reconciled_at,
        ar.balance_amount,
        ar.currency_code,
        ar.notes,
        ar.created_at::text as created_at,
        u.full_name as created_by_name
      from agent_account_reconciliations ar
      left join users u on u.id = ar.created_by_user_id
      where ar.company_id = $1
        and ar.agent_id = $2
      order by ar.reconciled_at desc, ar.created_at desc
      limit 1
      `,
      [companyId, agentId],
    );
    return result.rows[0] ?? null;
  }

  async createAgentReconciliation(companyId: string, agentId: string, input: CreateAgentReconciliationInput) {
    const agent = await this.getAgentById(agentId, companyId);
    if (!agent) return null;

    const result = await pool.query(
      `
      insert into agent_account_reconciliations(
        company_id,
        agent_id,
        balance_amount,
        currency_code,
        notes,
        created_by_user_id
      )
      values ($1, $2, $3, $4, $5, $6)
      returning id, reconciled_at::text, balance_amount, currency_code, notes, created_at::text
      `,
      [
        companyId,
        agentId,
        Number(input.balanceAmount ?? 0),
        input.currencyCode || 'USD',
        input.notes?.trim() || null,
        input.createdByUserId ?? null,
      ],
    );
    return result.rows[0];
  }

  async getAgentFinancialStatement(companyId: string, agentId: string, currencyCode?: string) {
    const agent = await this.getAgentById(agentId, companyId);
    if (!agent) return null;
    const lastReconciliation = await this.getLastAgentReconciliation(companyId, agentId);
    const lastReconciledAt = lastReconciliation?.reconciled_at ?? null;

    const shipments = await pool.query(
      `
      select
        s.id,
        s.shipment_no,
        s.created_at,
        s.status,
        s.destination_city,
        s.original_amount,
        s.original_currency,
        s.freight_charge,
        coalesce(s.agent_commission_base_amount, s.freight_charge, 0) as agent_commission_base_amount,
        coalesce(s.agent_commission_percentage_snapshot, $3::numeric, 0) as agent_commission_percentage_snapshot,
        coalesce(s.agent_commission_amount_snapshot, round((coalesce(s.freight_charge, 0) * coalesce($3::numeric, 0)) / 100, 2), 0) as agent_commission_amount_snapshot,
        sender.full_name as sender_name,
        receiver.full_name as receiver_name
      from shipments s
      left join senders_receivers sender on sender.id = s.sender_id
      left join senders_receivers receiver on receiver.id = s.receiver_id
      where s.company_id = $1
        and s.agent_id = $2
        and s.deleted_at is null
        and upper(s.status) <> 'CANCELLED'
        and ($4::text is null or upper(s.original_currency) = upper($4))
      order by s.created_at desc
      limit 500
      `,
      [companyId, agentId, Number(agent.commission_percentage ?? 0), currencyCode ?? null],
    );

    const transfers = await pool.query(
      `
      select
        t.id,
        t.transfer_date,
        t.created_at,
        t.status,
        t.sender_name,
        t.receiver_name,
        t.amount,
        t.currency,
        t.agent_commission,
        t.agent_commission_currency,
        t.transfer_service_fee,
        t.transfer_service_fee_currency,
        s.shipment_no
      from transfers t
      left join shipments s on s.id = t.shipment_id
      where t.company_id = $1
        and t.agent_id = $2
        and upper(t.status) <> 'CANCELLED'
        and ($3::text is null or upper(t.agent_commission_currency) = upper($3))
      order by coalesce(t.transfer_date, t.created_at) desc
      limit 500
      `,
      [companyId, agentId, currencyCode ?? null],
    );

    const vouchers = await pool.query(
      `
      select * from (
        select 'receipt' as voucher_kind, rv.id, rv.voucher_no, rv.created_at, rv.status, rv.notes,
          rv.original_amount, rv.original_currency, rv.cashbox_id, cb.name as cashbox_name
        from receipt_vouchers rv
        left join cashboxes cb on cb.id = rv.cashbox_id
        where rv.company_id = $1 and rv.agent_id = $2
          and ($3::text is null or upper(rv.original_currency) = upper($3))
        union all
        select 'payment' as voucher_kind, pv.id, pv.voucher_no, pv.created_at, pv.status, pv.notes,
          pv.original_amount, pv.original_currency, pv.cashbox_id, cb.name as cashbox_name
        from payment_vouchers pv
        left join cashboxes cb on cb.id = pv.cashbox_id
        where pv.company_id = $1 and pv.agent_id = $2
          and ($3::text is null or upper(pv.original_currency) = upper($3))
      ) rows
      order by created_at desc
      limit 500
      `,
      [companyId, agentId, currencyCode ?? null],
    );

    const summaryResult = await pool.query(
      `
      with shipment_totals as (
        select
          count(*)::int as shipments_count,
          coalesce(sum(coalesce(agent_commission_amount_snapshot, round((coalesce(freight_charge, 0) * coalesce($4::numeric, 0)) / 100, 2), 0)), 0)::numeric as shipment_commission,
          count(*) filter (where $3::timestamptz is not null and created_at > $3::timestamptz)::int as shipments_since_count,
          coalesce(sum(coalesce(agent_commission_amount_snapshot, round((coalesce(freight_charge, 0) * coalesce($4::numeric, 0)) / 100, 2), 0)) filter (where $3::timestamptz is not null and created_at > $3::timestamptz), 0)::numeric as shipment_commission_since
        from shipments
        where company_id = $1 and agent_id = $2 and deleted_at is null and upper(status) <> 'CANCELLED'
          and ($5::text is null or upper(original_currency) = upper($5))
      ),
      transfer_totals as (
        select
          count(*)::int as transfers_count,
          coalesce(sum(coalesce(agent_commission, 0)), 0)::numeric as transfer_commission,
          count(*) filter (where $3::timestamptz is not null and coalesce(transfer_date, created_at) > $3::timestamptz)::int as transfers_since_count,
          coalesce(sum(coalesce(agent_commission, 0)) filter (where $3::timestamptz is not null and coalesce(transfer_date, created_at) > $3::timestamptz), 0)::numeric as transfer_commission_since
        from transfers
        where company_id = $1 and agent_id = $2 and upper(status) = 'COMPLETED'
          and ($5::text is null or upper(agent_commission_currency) = upper($5))
      ),
      receipt_totals as (
        select
          count(*)::int as receipts_count,
          coalesce(sum(original_amount) filter (where status = 'confirmed'), 0)::numeric as receipts,
          count(*) filter (where $3::timestamptz is not null and created_at > $3::timestamptz)::int as receipts_since_count,
          coalesce(sum(original_amount) filter (where status = 'confirmed' and $3::timestamptz is not null and created_at > $3::timestamptz), 0)::numeric as receipts_since
        from receipt_vouchers
        where company_id = $1 and agent_id = $2
          and ($5::text is null or upper(original_currency) = upper($5))
      ),
      payment_totals as (
        select
          count(*)::int as payments_count,
          coalesce(sum(original_amount) filter (where status = 'confirmed'), 0)::numeric as payments,
          count(*) filter (where $3::timestamptz is not null and created_at > $3::timestamptz)::int as payments_since_count,
          coalesce(sum(original_amount) filter (where status = 'confirmed' and $3::timestamptz is not null and created_at > $3::timestamptz), 0)::numeric as payments_since
        from payment_vouchers
        where company_id = $1 and agent_id = $2
          and ($5::text is null or upper(original_currency) = upper($5))
      )
      select *
      from shipment_totals, transfer_totals, receipt_totals, payment_totals
      `,
      [companyId, agentId, lastReconciledAt, Number(agent.commission_percentage ?? 0), currencyCode ?? null],
    );
    const totals = summaryResult.rows[0] ?? {};
    const movementTotalsResult = await pool.query(
      `
      select
        coalesce(sum(debit_amount), 0)::numeric as debit,
        coalesce(sum(credit_amount), 0)::numeric as credit
      from party_financial_movements
      where party_type = 'agent'
        and party_id = $1
        and is_reversal = false
        and ($2::text is null or upper(coalesce(currency_code, original_currency)) = upper($2))
      `,
      [agentId, currencyCode ?? null],
    );
    const movementTotals = movementTotalsResult.rows[0] ?? {};

    const totalShipmentCommission = Number(totals.shipment_commission || 0);
    const totalTransferCommission = Number(totals.transfer_commission || 0);
    const totalReceipts = Number(totals.receipts || 0);
    const totalPayments = Number(totals.payments || 0);
    const sinceShipmentCommission = lastReconciledAt ? Number(totals.shipment_commission_since || 0) : totalShipmentCommission;
    const sinceTransferCommission = lastReconciledAt ? Number(totals.transfer_commission_since || 0) : totalTransferCommission;
    const sinceReceipts = lastReconciledAt ? Number(totals.receipts_since || 0) : totalReceipts;
    const sincePayments = lastReconciledAt ? Number(totals.payments_since || 0) : totalPayments;
    const totalAgentCommission = totalShipmentCommission + totalTransferCommission;
    const sinceAgentCommission = sinceShipmentCommission + sinceTransferCommission;
    const detailedStatement = await this.getAgentAccountStatement(companyId, agentId, currencyCode, null);
    const settlementBalance = Number(detailedStatement?.summary.netAgentDue ?? 0);
    const settlementBalanceSince = Number(detailedStatement?.summary.sinceLastReconciliation.netAgentDue ?? settlementBalance);

    return {
      agent,
      generatedAt: new Date().toISOString(),
      lastReconciliation,
      summary: {
        shipmentsCount: Number(totals.shipments_count || 0),
        transfersCount: Number(totals.transfers_count || 0),
        vouchersCount: Number(totals.receipts_count || 0) + Number(totals.payments_count || 0),
        totalShipmentCommission,
        totalTransferCommission,
        totalAgentCommission,
        totalReceipts,
        totalPayments,
        netVoucherBalance: totalReceipts - totalPayments,
        paidToAgent: totalPayments,
        netAgentDue: settlementBalance,
        accountDebit: Number(movementTotals.debit || 0),
        accountCredit: Number(movementTotals.credit || 0),
        settlementBalance,
        sinceLastReconciliation: {
          shipmentsCount: lastReconciledAt ? Number(totals.shipments_since_count || 0) : Number(totals.shipments_count || 0),
          transfersCount: lastReconciledAt ? Number(totals.transfers_since_count || 0) : Number(totals.transfers_count || 0),
          receiptsCount: lastReconciledAt ? Number(totals.receipts_since_count || 0) : Number(totals.receipts_count || 0),
          paymentsCount: lastReconciledAt ? Number(totals.payments_since_count || 0) : Number(totals.payments_count || 0),
          totalShipmentCommission: sinceShipmentCommission,
          totalTransferCommission: sinceTransferCommission,
          totalAgentCommission: sinceAgentCommission,
          totalReceipts: sinceReceipts,
          totalPayments: sincePayments,
          paidToAgent: sincePayments,
          netAgentDue: settlementBalanceSince,
        },
      },
      shipments: shipments.rows,
      transfers: transfers.rows,
      vouchers: vouchers.rows,
    };
  }

  async getAgentAccountStatement(companyId: string, agentId: string, currencyCode?: string, rowLimit: number | null = 1000) {
    const agent = await this.getAgentById(agentId, companyId);
    if (!agent) return null;
    const lastReconciliation = await this.getLastAgentReconciliation(companyId, agentId);
    const lastReconciledAt = lastReconciliation?.reconciled_at ?? null;

    const result = await pool.query(
      `
      select *
      from (
        select
          s.created_at as at,
          'shipment_commission' as source_type,
          s.id::text as source_id,
          s.shipment_no as reference_no,
          concat('عمولة شحن - ', coalesce(s.destination_city, '-')) as description,
          0::numeric as debit,
          coalesce(s.agent_commission_amount_snapshot, round((coalesce(s.freight_charge, 0) * coalesce($3::numeric, 0)) / 100, 2), 0)::numeric as credit,
          s.original_currency as currency_code,
          s.status,
          coalesce(sender.full_name, '-') as party_name
        from shipments s
        left join senders_receivers sender on sender.id = s.sender_id
        where s.company_id = $1 and s.agent_id = $2 and s.deleted_at is null and upper(s.status) <> 'CANCELLED'

        union all

        select
          coalesce(pfm.posted_at, pfm.created_at) as at,
          pfm.movement_type as source_type,
          coalesce(pfm.shipment_id, pfm.reference_id, pfm.id)::text as source_id,
          coalesce(pfm.reference_no, pfm.reference_id::text) as reference_no,
          pfm.notes as description,
          coalesce(pfm.debit_amount, 0)::numeric as debit,
          coalesce(pfm.credit_amount, 0)::numeric as credit,
          coalesce(pfm.currency_code, pfm.original_currency) as currency_code,
          'POSTED' as status,
          'حركة مالية موثقة' as party_name
        from party_financial_movements pfm
        where pfm.party_type = 'agent'
          and pfm.party_id = $2
          and pfm.is_reversal = false
          and pfm.movement_type in (
            'shipment_shipping_fee',
            'sender_collection_trust',
            'loading_dues',
            'general_collection',
            'shipment_hawala_trust',
            'transfer_principal_collected',
            'transfer_service_fee_collected',
            'transfer_principal_paid',
            'transfer_agent_commission'
          )

        union all

        select
          coalesce(t.transfer_date, t.created_at) as at,
          'transfer' as source_type,
          t.id::text as source_id,
          coalesce(s.shipment_no, t.id::text) as reference_no,
          concat('حوالة - ', t.sender_name, ' إلى ', t.receiver_name) as description,
          0::numeric as debit,
          coalesce(t.agent_commission, 0)::numeric as credit,
          t.agent_commission_currency as currency_code,
          t.status,
          concat(t.sender_name, ' / ', t.receiver_name) as party_name
        from transfers t
        left join shipments s on s.id = t.shipment_id
        where t.company_id = $1 and t.agent_id = $2
          and upper(t.status) = 'COMPLETED'
          and not exists (
            select 1
            from party_financial_movements pfm
            where pfm.reference_type = 'TRANSFER'
              and pfm.reference_id = t.id
              and pfm.movement_type = 'transfer_agent_commission'
              and pfm.party_type = 'agent'
              and pfm.party_id = $2
              and pfm.is_reversal = false
          )

        union all

        select
          rv.created_at as at,
          'receipt_voucher' as source_type,
          rv.id::text as source_id,
          rv.voucher_no as reference_no,
          coalesce(rv.notes, 'سند قبض للوكيل') as description,
          0::numeric as debit,
          coalesce(rv.original_amount, 0)::numeric as credit,
          rv.original_currency as currency_code,
          rv.status,
          'سند قبض' as party_name
        from receipt_vouchers rv
        where rv.company_id = $1 and rv.agent_id = $2

        union all

        select
          pv.created_at as at,
          'payment_voucher' as source_type,
          pv.id::text as source_id,
          pv.voucher_no as reference_no,
          coalesce(pv.notes, 'سند دفع للوكيل') as description,
          coalesce(pv.original_amount, 0)::numeric as debit,
          0::numeric as credit,
          pv.original_currency as currency_code,
          pv.status,
          'سند دفع' as party_name
        from payment_vouchers pv
        where pv.company_id = $1 and pv.agent_id = $2

        union all

        select
          ct.created_at as at,
          'cashbox_transaction' as source_type,
          ct.id::text as source_id,
          coalesce(rv.voucher_no, pv.voucher_no, ct.id::text) as reference_no,
          coalesce(ct.notes, 'حركة صندوق وكيل') as description,
          case when ct.transaction_type = 'inflow' then ct.original_amount else 0 end as debit,
          case when ct.transaction_type = 'outflow' then ct.original_amount else 0 end as credit,
          ct.original_currency as currency_code,
          coalesce(rv.status, pv.status, 'posted') as status,
          coalesce(cb.name, 'صندوق وكيل') as party_name
        from cashbox_transactions ct
        left join cashboxes cb on cb.id = ct.cashbox_id
        left join receipt_vouchers rv on ct.source_voucher_type = 'receipt' and rv.id = ct.source_voucher_id
        left join payment_vouchers pv on ct.source_voucher_type = 'payment' and pv.id = ct.source_voucher_id
        where ct.company_id = $1 and (ct.agent_id = $2 or cb.agent_id = $2)
          and ct.source_voucher_id is null
      ) x
      where ($4::text is null or upper(x.currency_code) = upper($4))
      order by at desc
      limit $5
      `,
      [companyId, agentId, Number(agent.commission_percentage ?? 0), currencyCode ?? null, rowLimit],
    );

    const totalDebit = result.rows.reduce((sum, row) => sum + Number(row.debit || 0), 0);
    const totalCredit = result.rows.reduce((sum, row) => sum + Number(row.credit || 0), 0);
    const sinceRows = lastReconciledAt
      ? result.rows.filter((row) => new Date(row.at).getTime() > new Date(lastReconciledAt).getTime())
      : result.rows;
    const sinceDebit = sinceRows.reduce((sum, row) => sum + Number(row.debit || 0), 0);
    const sinceCredit = sinceRows.reduce((sum, row) => sum + Number(row.credit || 0), 0);

    return {
      agent,
      generatedAt: new Date().toISOString(),
      lastReconciliation,
      summary: {
        rowsCount: result.rows.length,
        totalDebit,
        totalCredit,
        balance: totalDebit - totalCredit,
        netAgentDue: totalCredit - totalDebit,
        sinceLastReconciliation: {
          rowsCount: sinceRows.length,
          totalDebit: sinceDebit,
          totalCredit: sinceCredit,
          balance: sinceDebit - sinceCredit,
          netAgentDue: sinceCredit - sinceDebit,
        },
      },
      rows: result.rows,
    };
  }
}
