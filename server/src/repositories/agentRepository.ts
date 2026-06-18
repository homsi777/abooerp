import { pool } from '../db/pool.js';
import { numericCodeKey, normalizeDestinationKey } from '../utils/agentDestination.js';
import {
  dedupeAgentsForDestination,
  formatAgentCodes,
  pickPreferredAgentForGovernorate,
} from '../utils/agentDestinationResolve.js';
import {
  governorateLookupKey,
  normalizeAgentCode,
  normalizeAgentGovernorate,
  normalizeAgentName,
  normalizeOptionalLocation,
} from '../utils/agentValidation.js';
import {
  computeAgentBalanceDue,
  computeCommissionOnPrepaidPortion,
  computeAgentHawalaRemittanceDue,
  computeAgentRemittanceDue,
  computeAgentShippingRemittanceDue,
  computeAgentTransferRemittanceDue,
  computeNetRequiredFromAgent,
  resolveAgentTransferRole,
  resolvePrepaidAtMainBranch,
} from '../utils/agentShipmentSettlement.js';

function shipmentShippingPriceSql(alias = 's'): string {
  const p = `${alias}.`;
  return `greatest(case when coalesce(${p}prepaid_amount, 0) > 0 then coalesce(${p}prepaid_amount, 0) + coalesce(${p}transfer_fee, 0) else coalesce(${p}freight_charge, 0) + coalesce(${p}transfer_fee, 0) end, 0)`;
}

function shipmentTableShippingPriceSql(): string {
  return `greatest(case when coalesce(prepaid_amount, 0) > 0 then coalesce(prepaid_amount, 0) + coalesce(transfer_fee, 0) else coalesce(freight_charge, 0) + coalesce(transfer_fee, 0) end, 0)`;
}

function resolveAgentReportCurrency(code?: string | null): string {
  const normalized = String(code ?? 'USD').trim().toUpperCase();
  return normalized || 'USD';
}

function shipmentEffectiveAtSql(alias = ''): string {
  const p = alias ? `${alias}.` : '';
  return `coalesce(${p}effective_date::timestamptz, ${p}created_at)`;
}

export type AgentStatementOptions = {
  currencyCode?: string;
  fromAt?: string;
  toAt?: string;
};
import { HttpError } from '../utils/errors.js';

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
    const normalized = this.normalizeAgentInput(data);
    await this.assertAgentBusinessRules(companyId, normalized);
    const result = await pool.query<AgentRecord>(
      `
      insert into agents(code, name, phone, governorate, city, area, address, notes, branch_id, telegram_chat_id, is_active, commission_percentage)
      values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, coalesce($11, true), coalesce($12, 0))
      returning id, code, name, phone, governorate, city, area, address, notes, branch_id, telegram_chat_id, is_active, commission_percentage, created_at::text, updated_at::text
      `,
      [
        normalized.code,
        normalized.name,
        normalized.phone ?? null,
        normalized.governorate ?? null,
        normalized.city ?? null,
        normalized.area ?? null,
        normalized.address ?? null,
        normalized.notes ?? null,
        normalized.branch_id ?? null,
        normalized.telegram_chat_id ?? null,
        normalized.is_active ?? true,
        normalized.commission_percentage ?? 0,
      ],
    );
    return result.rows[0];
  }

  async updateAgent(id: string, companyId: string, data: UpdateAgentInput): Promise<AgentRecord | null> {
    const existing = await this.getAgentById(id, companyId);
    if (!existing) return null;

    const merged: CreateAgentInput = {
      code: data.code ?? existing.code,
      name: data.name ?? existing.name,
      phone: data.phone ?? existing.phone ?? undefined,
      governorate: data.governorate ?? existing.governorate ?? undefined,
      city: data.city ?? existing.city ?? undefined,
      area: data.area ?? existing.area ?? undefined,
      address: data.address ?? existing.address ?? undefined,
      notes: data.notes ?? existing.notes ?? undefined,
      branch_id:
        data.branch_id === undefined || data.branch_id === null
          ? (existing.branch_id ?? '')
          : data.branch_id,
      telegram_chat_id: data.telegram_chat_id === null ? null : (data.telegram_chat_id ?? existing.telegram_chat_id),
      is_active: data.is_active ?? existing.is_active,
      commission_percentage: data.commission_percentage ?? existing.commission_percentage,
    };
    if (!merged.branch_id) {
      throw new HttpError(400, 'الفرع المرتبط مطلوب للوكيل.');
    }
    const normalized = this.normalizeAgentInput(merged);
    await this.assertAgentBusinessRules(companyId, normalized, id);

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
        normalized.phone ?? null,
        normalized.governorate ?? null,
        normalized.city ?? null,
        normalized.area ?? null,
        normalized.address ?? null,
        normalized.notes ?? null,
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
      `,
      [id, companyId],
    );
    return (result.rowCount ?? 0) > 0;
  }

  async getAgentUsageSummary(companyId: string, agentId: string) {
    const result = await pool.query<{ shipments: number; users: number; cashboxes: number }>(
      `
      select
        (select count(*)::int from shipments s where s.agent_id = $2) as shipments,
        (select count(*)::int from users u where u.agent_id = $2) as users,
        (select count(*)::int from cashboxes c where c.company_id = $1 and c.agent_id = $2) as cashboxes
      `,
      [companyId, agentId],
    );
    return result.rows[0] ?? { shipments: 0, users: 0, cashboxes: 0 };
  }

  async removeAgentPermanently(id: string, companyId: string): Promise<boolean> {
    const agent = await this.getAgentById(id, companyId);
    if (!agent) return false;

    const usage = await this.getAgentUsageSummary(companyId, id);
    if (usage.shipments > 0) {
      throw new HttpError(
        409,
        `لا يمكن حذف الوكيل «${agent.code}» لوجود ${usage.shipments} شحنة مرتبطة. يمكنك تعطيله بدلاً من الحذف.`,
      );
    }
    if (usage.users > 0) {
      throw new HttpError(
        409,
        `لا يمكن حذف الوكيل «${agent.code}» لوجود ${usage.users} مستخدم مرتبط. يمكنك تعطيله بدلاً من الحذف.`,
      );
    }

    const result = await pool.query(
      `
      delete from agents a
      using branches b
      where a.id = $1
        and a.branch_id = b.id
        and b.company_id = $2
      `,
      [id, companyId],
    );
    return (result.rowCount ?? 0) > 0;
  }

  private normalizeAgentInput(data: CreateAgentInput): CreateAgentInput {
    return {
      ...data,
      code: normalizeAgentCode(data.code),
      name: normalizeAgentName(data.name),
      governorate: normalizeAgentGovernorate(data.governorate) ?? undefined,
      city: normalizeOptionalLocation(data.city) ?? undefined,
      area: normalizeOptionalLocation(data.area) ?? undefined,
      phone: data.phone?.trim() || undefined,
      address: data.address?.trim() || undefined,
      notes: data.notes?.trim() || undefined,
    };
  }

  private async assertAgentBusinessRules(companyId: string, data: CreateAgentInput, excludeAgentId?: string) {
    const isActive = data.is_active ?? true;
    const governorate = normalizeAgentGovernorate(data.governorate);
    if (isActive && !governorate) {
      throw new HttpError(400, 'المحافظة (الوجهة) مطلوبة للوكيل النشط — يجب أن تطابق عمود «الجهة» في دفتر الشحن.');
    }

    if (!isActive || !governorate) return;

    const lookupKey = governorateLookupKey(governorate);
    const conflicts = await pool.query<{ id: string; code: string; name: string; governorate: string | null }>(
      `
      select a.id, a.code, a.name, a.governorate
      from agents a
      join branches b on b.id = a.branch_id
      where b.company_id = $1
        and a.is_active = true
        and ($2::uuid is null or a.id <> $2::uuid)
        and lower(trim(replace(coalesce(a.governorate, ''), 'وكيل ', ''))) = $3
      order by a.created_at asc
      limit 5
      `,
      [companyId, excludeAgentId ?? null, lookupKey],
    );

    if (conflicts.rows.length > 0) {
      const sample = conflicts.rows.map((row) => `${row.code} (${row.governorate ?? row.name})`).join('، ');
      throw new HttpError(
        409,
        `وجهة «${governorate}» مرتبطة بوكيل نشط آخر: ${sample}. يجب وكيل واحد فقط لكل محافظة — عطّل أو احذف المكرر.`,
      );
    }
  }

  async lookupByDestination(companyId: string, destination: string, _branchId?: string): Promise<AgentRecord[]> {
    const normalized = normalizeDestinationKey(destination);
    const numericKey = numericCodeKey(destination);
    const result = await pool.query<AgentRecord>(
      `
      select a.id, a.code, a.name, a.phone, a.governorate, a.city, a.area, a.address, a.notes, a.branch_id, a.telegram_chat_id, a.is_active, a.commission_percentage, a.created_at::text, a.updated_at::text
      from agents a
      join branches b on b.id = a.branch_id
      where b.company_id = $1
        and a.is_active = true
        and (
          lower(trim(coalesce(a.area, ''))) = $2
          or lower(trim(coalesce(a.city, ''))) = $2
          or lower(trim(replace(coalesce(a.governorate, ''), 'وكيل ', ''))) = $2
          or lower(trim(a.code)) = $2
          or (
            $3::text is not null
            and trim(a.code) ~ '^[0-9]+$'
            and coalesce(nullif(ltrim(trim(a.code), '0'), ''), '0') = $3
          )
        )
      order by a.created_at desc
      `,
      [companyId, normalized, numericKey],
    );
    return dedupeAgentsForDestination(result.rows, destination);
  }

  async resolveAgentForDestination(companyId: string, destination: string): Promise<AgentRecord> {
    const trimmed = String(destination ?? '').trim().replace(/\s+/g, ' ');
    const agents = await this.lookupByDestination(companyId, trimmed);
    if (agents.length === 1) return agents[0];

    const normalized = normalizeDestinationKey(trimmed);
    const allMatches = await pool.query<AgentRecord>(
      `
      select a.id, a.code, a.name, a.phone, a.governorate, a.city, a.area, a.address, a.notes, a.branch_id, a.telegram_chat_id, a.is_active, a.commission_percentage, a.created_at::text, a.updated_at::text
      from agents a
      join branches b on b.id = a.branch_id
      where b.company_id = $1
        and a.is_active = true
        and (
          lower(trim(coalesce(a.area, ''))) = $2
          or lower(trim(coalesce(a.city, ''))) = $2
          or lower(trim(replace(coalesce(a.governorate, ''), 'وكيل ', ''))) = $2
          or lower(trim(a.code)) = $2
        )
      order by a.created_at desc
      `,
      [companyId, normalized],
    );

    if (!allMatches.rows.length) {
      throw new HttpError(
        400,
        `لا يوجد وكيل نشط للوجهة «${trimmed}». أضف وكيلاً نشطاً وحدّد محافظته في تعريف الوكلاء.`,
      );
    }

    const byGovernorate = allMatches.rows.filter(
      (agent) => governorateLookupKey(agent.governorate) === governorateLookupKey(trimmed),
    );
    if (byGovernorate.length > 1) {
      const preferred = pickPreferredAgentForGovernorate(byGovernorate);
      if (preferred) return preferred;
      throw new HttpError(
        400,
        `يوجد أكثر من وكيل للوجهة «${trimmed}»: ${formatAgentCodes(byGovernorate)}. عطّل الوكيل المكرر أو ادمج التعريفات.`,
      );
    }

    if (allMatches.rows.length > 1) {
      throw new HttpError(
        400,
        `تعذر تحديد وكيل واحد للوجهة «${trimmed}» — ${formatAgentCodes(allMatches.rows)}. استخدم كود الوكيل الرقمي أو محافظة واحدة فقط.`,
      );
    }

    return allMatches.rows[0];
  }

  async getLastAgentReconciliationRecord(companyId: string, agentId: string) {
    return this.getLastAgentReconciliation(companyId, agentId);
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

  async getAgentFinancialStatement(
    companyId: string,
    agentId: string,
    options?: AgentStatementOptions | string,
  ) {
    const opts: AgentStatementOptions =
      typeof options === 'string' ? { currencyCode: options } : options ?? {};
    const reportCurrency = resolveAgentReportCurrency(opts.currencyCode ?? 'USD');
    const currencyCode = reportCurrency;
    const agent = await this.getAgentById(agentId, companyId);
    if (!agent) return null;
    const lastReconciliation = await this.getLastAgentReconciliation(companyId, agentId);
    const lastReconciledAt = lastReconciliation?.reconciled_at ?? null;

    const shipmentValues: unknown[] = [
      companyId,
      agentId,
      Number(agent.commission_percentage ?? 0),
      currencyCode ?? null,
    ];
    const shipmentDateFilters: string[] = [];
    if (opts.fromAt) {
      shipmentValues.push(opts.fromAt);
      shipmentDateFilters.push(`and coalesce(s.effective_date::timestamptz, s.created_at) >= $${shipmentValues.length}::timestamptz`);
    }
    if (opts.toAt) {
      shipmentValues.push(opts.toAt);
      shipmentDateFilters.push(`and coalesce(s.effective_date::timestamptz, s.created_at) <= $${shipmentValues.length}::timestamptz`);
    }

    const shipments = await pool.query(
      `
      select
        s.id,
        s.shipment_no,
        coalesce(s.effective_date::timestamptz, s.created_at) as created_at,
        s.status,
        s.destination_city,
        s.original_amount,
        s.original_currency,
        s.freight_charge,
        s.transfer_fee,
        s.hawala_amount,
        s.transfer_service_fee,
        s.prepaid_amount,
        coalesce(
          s.agent_commission_base_amount,
          ${shipmentShippingPriceSql('s')},
          0
        ) as agent_commission_base_amount,
        coalesce(s.agent_commission_percentage_snapshot, $3::numeric, 0) as agent_commission_percentage_snapshot,
        coalesce(
          s.agent_commission_amount_snapshot,
          round(
            (${shipmentShippingPriceSql('s')} * coalesce($3::numeric, 0)) / 100,
            2
          ),
          0
        ) as agent_commission_amount_snapshot,
        sender.full_name as sender_name,
        receiver.full_name as receiver_name
      from shipments s
      left join senders_receivers sender on sender.id = s.sender_id
      left join senders_receivers receiver on receiver.id = s.receiver_id
      where s.company_id = $1
        and s.agent_id = $2
        and s.deleted_at is null
        and upper(s.status) <> 'CANCELLED'
        and upper(coalesce(s.original_currency, 'USD')) = upper($4)
        ${shipmentDateFilters.join(' ')}
      order by coalesce(s.effective_date::timestamptz, s.created_at) desc
      limit 500
      `,
      shipmentValues,
    );

    const transferValues: unknown[] = [companyId, agentId, currencyCode ?? null];
    const transferDateFilters: string[] = [];
    if (opts.fromAt) {
      transferValues.push(opts.fromAt);
      transferDateFilters.push(`and coalesce(t.transfer_date, t.created_at) >= $${transferValues.length}::timestamptz`);
    }
    if (opts.toAt) {
      transferValues.push(opts.toAt);
      transferDateFilters.push(`and coalesce(t.transfer_date, t.created_at) <= $${transferValues.length}::timestamptz`);
    }

    const transfers = await pool.query(
      `
      select
        t.id,
        t.transfer_date,
        t.created_at,
        t.collected_at,
        t.paid_out_at,
        t.status,
        t.sender_name,
        t.receiver_name,
        t.destination_city,
        t.amount,
        t.currency,
        t.agent_commission,
        t.agent_commission_currency,
        t.transfer_service_fee,
        t.transfer_service_fee_currency,
        t.origin_agent_id,
        t.destination_agent_id,
        t.agent_id,
        t.shipment_id,
        s.shipment_no
      from transfers t
      left join shipments s on s.id = t.shipment_id
      where t.company_id = $1
        and upper(t.status) <> 'CANCELLED'
        and (
          t.origin_agent_id = $2::uuid
          or t.destination_agent_id = $2::uuid
          or t.agent_id = $2::uuid
        )
        and (
          upper(coalesce(t.currency, 'USD')) = upper($3)
          or upper(coalesce(t.agent_commission_currency, t.currency, 'USD')) = upper($3)
        )
        ${transferDateFilters.join(' ')}
      order by coalesce(t.transfer_date, t.created_at) desc
      limit 500
      `,
      transferValues,
    );

    const vouchers = await pool.query(
      `
      select * from (
        select 'receipt' as voucher_kind, rv.id, rv.voucher_no, rv.created_at, rv.status, rv.notes,
          rv.original_amount, rv.original_currency, rv.cashbox_id, cb.name as cashbox_name
        from receipt_vouchers rv
        left join cashboxes cb on cb.id = rv.cashbox_id
        where rv.company_id = $1 and rv.agent_id = $2
          and upper(coalesce(rv.original_currency, 'USD')) = upper($3)
        union all
        select 'payment' as voucher_kind, pv.id, pv.voucher_no, pv.created_at, pv.status, pv.notes,
          pv.original_amount, pv.original_currency, pv.cashbox_id, cb.name as cashbox_name
        from payment_vouchers pv
        left join cashboxes cb on cb.id = pv.cashbox_id
        where pv.company_id = $1 and pv.agent_id = $2
          and upper(coalesce(pv.original_currency, 'USD')) = upper($3)
      ) rows
      order by created_at desc
      limit 500
      `,
      [companyId, agentId, currencyCode ?? null],
    );

    const summaryValues: unknown[] = [
      companyId,
      agentId,
      lastReconciledAt,
      Number(agent.commission_percentage ?? 0),
      currencyCode ?? null,
    ];
    const summaryShipmentDateFilters: string[] = [];
    const summaryTransferDateFilters: string[] = [];
    const summaryVoucherDateFilters: string[] = [];
    if (opts.fromAt) {
      summaryValues.push(opts.fromAt);
      const p = summaryValues.length;
      summaryShipmentDateFilters.push(`and ${shipmentEffectiveAtSql()} >= $${p}::timestamptz`);
      summaryTransferDateFilters.push(`and coalesce(transfer_date, created_at) >= $${p}::timestamptz`);
      summaryVoucherDateFilters.push(`and created_at >= $${p}::timestamptz`);
    }
    if (opts.toAt) {
      summaryValues.push(opts.toAt);
      const p = summaryValues.length;
      summaryShipmentDateFilters.push(`and ${shipmentEffectiveAtSql()} <= $${p}::timestamptz`);
      summaryTransferDateFilters.push(`and coalesce(transfer_date, created_at) <= $${p}::timestamptz`);
      summaryVoucherDateFilters.push(`and created_at <= $${p}::timestamptz`);
    }

    const summaryResult = await pool.query(
      `
      with shipment_totals as (
        select
          count(*)::int as shipments_count,
          coalesce(sum(coalesce(agent_commission_amount_snapshot, round((${shipmentTableShippingPriceSql()}) * coalesce($4::numeric, 0) / 100, 2), 0)), 0)::numeric as shipment_commission,
          count(*) filter (where $3::timestamptz is not null and created_at > $3::timestamptz)::int as shipments_since_count,
          coalesce(sum(coalesce(agent_commission_amount_snapshot, round((${shipmentTableShippingPriceSql()}) * coalesce($4::numeric, 0) / 100, 2), 0)) filter (where $3::timestamptz is not null and created_at > $3::timestamptz), 0)::numeric as shipment_commission_since
        from shipments
        where company_id = $1 and agent_id = $2 and deleted_at is null and upper(status) <> 'CANCELLED'
          and upper(coalesce(original_currency, 'USD')) = upper($5)
          ${summaryShipmentDateFilters.join(' ')}
      ),
      transfer_totals as (
        select
          count(*)::int as transfers_count,
          coalesce(sum(coalesce(agent_commission, 0)) filter (
            where destination_agent_id = $2::uuid
              or (destination_agent_id is null and agent_id = $2::uuid)
          ), 0)::numeric as transfer_commission,
          coalesce(sum(coalesce(amount, 0)) filter (
            where origin_agent_id = $2::uuid
              and shipment_id is null
              and collection_receipt_voucher_id is not null
          ), 0)::numeric as transfer_principal_collected,
          coalesce(sum(coalesce(transfer_service_fee, 0)) filter (
            where origin_agent_id = $2::uuid
              and shipment_id is null
              and collection_receipt_voucher_id is not null
          ), 0)::numeric as transfer_service_fee_collected,
          coalesce(sum(coalesce(amount, 0)) filter (
            where (
              destination_agent_id = $2::uuid
              or (destination_agent_id is null and agent_id = $2::uuid)
            )
              and upper(status) = 'COMPLETED'
          ), 0)::numeric as transfer_principal_paid,
          count(*) filter (where $3::timestamptz is not null and coalesce(transfer_date, created_at) > $3::timestamptz)::int as transfers_since_count,
          coalesce(sum(coalesce(agent_commission, 0)) filter (
            where $3::timestamptz is not null
              and coalesce(transfer_date, created_at) > $3::timestamptz
              and (
                destination_agent_id = $2::uuid
                or (destination_agent_id is null and agent_id = $2::uuid)
              )
          ), 0)::numeric as transfer_commission_since,
          coalesce(sum(coalesce(amount, 0) + coalesce(transfer_service_fee, 0)) filter (
            where $3::timestamptz is not null
              and coalesce(transfer_date, created_at) > $3::timestamptz
              and origin_agent_id = $2::uuid
              and shipment_id is null
              and collection_receipt_voucher_id is not null
          ), 0)::numeric as transfer_remittance_since
        from transfers
        where company_id = $1
          and upper(status) <> 'CANCELLED'
          and (
            origin_agent_id = $2::uuid
            or destination_agent_id = $2::uuid
            or agent_id = $2::uuid
          )
          and (
            upper(coalesce(currency, 'USD')) = upper($5)
            or upper(coalesce(agent_commission_currency, currency, 'USD')) = upper($5)
          )
          ${summaryTransferDateFilters.join(' ')}
      ),
      receipt_totals as (
        select
          count(*)::int as receipts_count,
          coalesce(sum(original_amount) filter (where status = 'confirmed'), 0)::numeric as receipts,
          count(*) filter (where $3::timestamptz is not null and created_at > $3::timestamptz)::int as receipts_since_count,
          coalesce(sum(original_amount) filter (where status = 'confirmed' and $3::timestamptz is not null and created_at > $3::timestamptz), 0)::numeric as receipts_since
        from receipt_vouchers
        where company_id = $1 and agent_id = $2
          and upper(coalesce(original_currency, 'USD')) = upper($5)
          ${summaryVoucherDateFilters.join(' ')}
      ),
      payment_totals as (
        select
          count(*)::int as payments_count,
          coalesce(sum(original_amount) filter (where status = 'confirmed'), 0)::numeric as payments,
          count(*) filter (where $3::timestamptz is not null and created_at > $3::timestamptz)::int as payments_since_count,
          coalesce(sum(original_amount) filter (where status = 'confirmed' and $3::timestamptz is not null and created_at > $3::timestamptz), 0)::numeric as payments_since
        from payment_vouchers
        where company_id = $1 and agent_id = $2
          and upper(coalesce(original_currency, 'USD')) = upper($5)
          ${summaryVoucherDateFilters.join(' ')}
      )
      select *
      from shipment_totals, transfer_totals, receipt_totals, payment_totals
      `,
      summaryValues,
    );
    const totals = summaryResult.rows[0] ?? {};
    const remittanceValues: unknown[] = [
      companyId,
      agentId,
      Number(agent.commission_percentage ?? 0),
      currencyCode ?? null,
    ];
    const remittanceDateFilters: string[] = [];
    if (opts.fromAt) {
      remittanceValues.push(opts.fromAt);
      remittanceDateFilters.push(`and coalesce(s.effective_date::timestamptz, s.created_at) >= $${remittanceValues.length}::timestamptz`);
    }
    if (opts.toAt) {
      remittanceValues.push(opts.toAt);
      remittanceDateFilters.push(`and coalesce(s.effective_date::timestamptz, s.created_at) <= $${remittanceValues.length}::timestamptz`);
    }
    const remittanceResult = await pool.query(
      `
      select
        coalesce(sum(
          greatest(
            coalesce(s.transfer_fee, 0)
            + coalesce(s.hawala_amount, 0)
            + coalesce(s.transfer_service_fee, 0)
            - coalesce(
              s.agent_commission_amount_snapshot,
              round((${shipmentShippingPriceSql('s')} * coalesce($3::numeric, 0)) / 100, 2),
              0
            ),
            0
          )
        ), 0)::numeric as total_remittance_due,
        coalesce(sum(coalesce(s.transfer_fee, 0)), 0)::numeric as shipping_gross_collect,
        coalesce(sum(coalesce(s.hawala_amount, 0) + coalesce(s.transfer_service_fee, 0)), 0)::numeric as hawala_remittance_due
      from shipments s
      where s.company_id = $1
        and s.agent_id = $2
        and s.deleted_at is null
        and upper(s.status) <> 'CANCELLED'
        and upper(coalesce(s.original_currency, 'USD')) = upper($4)
        ${remittanceDateFilters.join(' ')}
      `,
      remittanceValues,
    );
    const totalAgentRemittanceDueFromShipments = Number(remittanceResult.rows[0]?.total_remittance_due ?? 0);
    const shippingGrossCollectFromShipments = Number(remittanceResult.rows[0]?.shipping_gross_collect ?? 0);
    const hawalaRemittanceDueFromShipments = Number(remittanceResult.rows[0]?.hawala_remittance_due ?? 0);
    const totalTransferPrincipalCollected = Number(totals.transfer_principal_collected || 0);
    const totalTransferServiceFeeCollected = Number(totals.transfer_service_fee_collected || 0);
    const totalTransferRemittanceDue = totalTransferPrincipalCollected + totalTransferServiceFeeCollected;
    const totalTransferPrincipalPaid = Number(totals.transfer_principal_paid || 0);
    const totalAgentRemittanceDue = totalAgentRemittanceDueFromShipments + totalTransferRemittanceDue;
    const movementTotalsResult = await pool.query(
      `
      select
        coalesce(sum(debit_amount), 0)::numeric as debit,
        coalesce(sum(credit_amount), 0)::numeric as credit
      from party_financial_movements
      where party_type = 'agent'
        and party_id = $1
        and is_reversal = false
        and upper(coalesce(currency_code, original_currency, 'USD')) = upper($2)
      `,
      [agentId, currencyCode],
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
    const sinceTransferRemittanceDue = lastReconciledAt
      ? Number(totals.transfer_remittance_since || 0)
      : totalTransferRemittanceDue;
    const totalAgentCommission = totalShipmentCommission;
    const sinceAgentCommission = sinceShipmentCommission;
    const detailedStatement = await this.getAgentAccountStatement(companyId, agentId, reportCurrency, null);
    const settlementBalance = Number(detailedStatement?.summary.netAgentDue ?? 0);
    const settlementBalanceSince = Number(detailedStatement?.summary.sinceLastReconciliation.netAgentDue ?? settlementBalance);
    const agentBalanceDue = computeAgentBalanceDue({
      totalRemittanceDue: totalAgentRemittanceDue,
      totalShippingCommission: totalShipmentCommission,
      confirmedReceiptsFromAgent: totalReceipts,
      confirmedPaymentsToAgent: totalPayments,
    });
    const accountBalanceDue = Number(detailedStatement?.summary.agentBalanceDue ?? agentBalanceDue);

    return {
      agent,
      reportCurrency,
      generatedAt: new Date().toISOString(),
      lastReconciliation,
      accountStatement: detailedStatement
        ? {
            summary: detailedStatement.summary,
            rows: detailedStatement.rows,
          }
        : { summary: {}, rows: [] },
      summary: {
        shipmentsCount: Number(totals.shipments_count || 0),
        transfersCount: Number(totals.transfers_count || 0),
        vouchersCount: Number(totals.receipts_count || 0) + Number(totals.payments_count || 0),
        totalShipmentCommission,
        totalTransferCommission: 0,
        totalAgentCommission,
        commissionNote: 'عمولة الوكيل على الشحن فقط — لا عمولة على الحوالات',
        totalAgentRemittanceDue,
        totalAgentRemittanceDueFromShipments,
        shippingGrossCollectFromShipments,
        shippingRemittanceDueFromShipments: shippingGrossCollectFromShipments,
        hawalaRemittanceDueFromShipments,
        totalTransferRemittanceDue,
        totalTransferPrincipalCollected,
        totalTransferServiceFeeCollected,
        totalTransferPrincipalPaid,
        totalReceipts,
        totalPayments,
        netVoucherBalance: totalReceipts - totalPayments,
        paidToAgent: totalPayments,
        agentBalanceDue: accountBalanceDue,
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
          totalAgentRemittanceDue,
          totalAgentRemittanceDueFromShipments,
          totalTransferRemittanceDue: sinceTransferRemittanceDue,
          totalTransferPrincipalCollected,
          totalTransferServiceFeeCollected,
          totalTransferPrincipalPaid,
          totalReceipts: sinceReceipts,
          totalPayments: sincePayments,
          paidToAgent: sincePayments,
          agentBalanceDue: accountBalanceDue,
          netAgentDue: settlementBalanceSince,
        },
      },
      shipments: shipments.rows.map((row) => {
        const settlementInput = {
          prepaidAmount: row.prepaid_amount,
          freightCharge: row.freight_charge,
          transferFee: row.transfer_fee,
          hawalaAmount: row.hawala_amount,
          transferServiceFee: row.transfer_service_fee,
          agentCommissionAmount: row.agent_commission_amount_snapshot,
        };
        return {
          ...row,
          prepaid_at_main_branch: resolvePrepaidAtMainBranch(settlementInput),
          agent_commission_on_prepaid: computeCommissionOnPrepaidPortion(settlementInput),
          agent_shipping_remittance_due: computeAgentShippingRemittanceDue(settlementInput),
          agent_hawala_remittance_due: computeAgentHawalaRemittanceDue({
            hawalaAmount: row.hawala_amount,
            transferServiceFee: row.transfer_service_fee,
          }),
          agent_net_required_from_agent: computeNetRequiredFromAgent(settlementInput),
          agent_remittance_due: computeAgentRemittanceDue(settlementInput),
        };
      }),
      transfers: transfers.rows.map((row) => {
        const agentRole = resolveAgentTransferRole(
          agentId,
          row.origin_agent_id,
          row.destination_agent_id,
          row.agent_id,
        );
        return {
          ...row,
          agent_role: agentRole,
          agent_remittance_due: computeAgentTransferRemittanceDue({
            agentRole,
            status: row.status,
            amount: row.amount,
            transferServiceFee: row.transfer_service_fee,
            linkedShipmentId: row.shipment_id,
            collectedAt: row.collected_at,
          }),
        };
      }),
      vouchers: vouchers.rows,
    };
  }

  async getAgentAccountStatement(companyId: string, agentId: string, currencyCode?: string, rowLimit: number | null = 1000) {
    const agent = await this.getAgentById(agentId, companyId);
    if (!agent) return null;
    const reportCurrency = resolveAgentReportCurrency(currencyCode ?? 'USD');
    const lastReconciliation = await this.getLastAgentReconciliation(companyId, agentId);
    const lastReconciledAt = lastReconciliation?.reconciled_at ?? null;

    const result = await pool.query(
      `
      select *
      from (
        select
          coalesce(s.effective_date::timestamptz, s.created_at) as at,
          'shipment_commission' as source_type,
          s.id::text as source_id,
          s.shipment_no as reference_no,
          concat('عمولة شحن - ', coalesce(s.destination_city, '-')) as description,
          0::numeric as debit,
          coalesce(
            s.agent_commission_amount_snapshot,
            round((${shipmentShippingPriceSql('s')} * coalesce($3::numeric, 0)) / 100, 2),
            0
          )::numeric as credit,
          s.original_currency as currency_code,
          s.status,
          coalesce(sender.full_name, '-') as party_name
        from shipments s
        left join senders_receivers sender on sender.id = s.sender_id
        where s.company_id = $1 and s.agent_id = $2 and s.deleted_at is null and upper(s.status) <> 'CANCELLED'
          and upper(coalesce(s.original_currency, 'USD')) = upper($4)

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
          and upper(coalesce(pfm.currency_code, pfm.original_currency, 'USD')) = upper($4)
          and pfm.movement_type in (
            'shipment_shipping_fee',
            'sender_collection_trust',
            'loading_dues',
            'general_collection',
            'shipment_hawala_trust',
            'shipment_transfer_service_fee',
            'transfer_principal_collected',
            'transfer_service_fee_collected',
            'transfer_principal_paid',
            'transfer_agent_commission'
          )

        union all

        select
          rv.created_at as at,
          'receipt_voucher' as source_type,
          rv.id::text as source_id,
          rv.voucher_no as reference_no,
          coalesce(rv.notes, 'سند قبض من الوكيل') as description,
          0::numeric as debit,
          coalesce(rv.original_amount, 0)::numeric as credit,
          rv.original_currency as currency_code,
          rv.status,
          'سند قبض' as party_name
        from receipt_vouchers rv
        where rv.company_id = $1 and rv.agent_id = $2 and rv.status = 'confirmed'
          and upper(coalesce(rv.original_currency, 'USD')) = upper($4)

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
          and upper(coalesce(pv.original_currency, 'USD')) = upper($4)

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
          and upper(coalesce(ct.original_currency, 'USD')) = upper($4)
      ) x
      order by at desc
      limit $5
      `,
      [companyId, agentId, Number(agent.commission_percentage ?? 0), reportCurrency, rowLimit],
    );

    const totalDebit = result.rows.reduce((sum, row) => sum + Number(row.debit || 0), 0);
    const totalCredit = result.rows.reduce((sum, row) => sum + Number(row.credit || 0), 0);
    const agentBalanceDue = Math.max(totalDebit - totalCredit, 0);
    const sinceRows = lastReconciledAt
      ? result.rows.filter((row) => new Date(row.at).getTime() > new Date(lastReconciledAt).getTime())
      : result.rows;
    const sinceDebit = sinceRows.reduce((sum, row) => sum + Number(row.debit || 0), 0);
    const sinceCredit = sinceRows.reduce((sum, row) => sum + Number(row.credit || 0), 0);
    const sinceAgentBalanceDue = Math.max(sinceDebit - sinceCredit, 0);

    return {
      agent,
      reportCurrency,
      generatedAt: new Date().toISOString(),
      lastReconciliation,
      summary: {
        rowsCount: result.rows.length,
        totalDebit,
        totalCredit,
        balance: totalDebit - totalCredit,
        agentBalanceDue,
        netAgentDue: totalCredit - totalDebit,
        sinceLastReconciliation: {
          rowsCount: sinceRows.length,
          totalDebit: sinceDebit,
          totalCredit: sinceCredit,
          balance: sinceDebit - sinceCredit,
          agentBalanceDue: sinceAgentBalanceDue,
          netAgentDue: sinceCredit - sinceDebit,
        },
      },
      rows: result.rows,
    };
  }
}
