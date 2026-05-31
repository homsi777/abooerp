import type { PoolClient } from 'pg';
import { pool } from '../db/pool.js';
import { HttpError } from '../utils/errors.js';
import type { DataScope } from '../utils/scope.js';
import { buildShipmentBreakdownMetadata, type ShipmentFinancialBreakdown } from '../utils/shipmentFinancialBreakdown.js';

export type VoucherStatus = 'draft' | 'confirmed' | 'cancelled';
export type CurrencyCode = string;

export interface ReceiptVoucherInput {
  voucherNo: string;
  branchId?: string;
  agentId?: string;
  shipmentId?: string;
  deliveryId?: string;
  customerId?: string;
  senderReceiverId?: string;
  relatedEntityType?: string;
  relatedEntityId?: string;
  status: VoucherStatus;
  notes?: string;
  originalAmount: number;
  originalCurrency: CurrencyCode;
  exchangeRateToUsd?: number;
  baseAmountUsd?: number;
  createdByUserId?: string;
  createdAt?: string;
  expectedUpdatedAt?: string;
  companyId?: string;
  cashboxId?: string;
}

export interface PaymentVoucherInput extends ReceiptVoucherInput {}

export interface CashboxInput {
  companyId: string;
  code: string;
  name: string;
  type: 'COMPANY' | 'BRANCH' | 'AGENT';
  currencyCode: string;
  branchId?: string | null;
  agentId?: string | null;
  openingBalance?: number;
  currentBalance?: number;
  isActive?: boolean;
  notes?: string | null;
  createdByUserId?: string | null;
  parentCashboxId?: string | null;
}

export interface CashboxListFilters {
  search?: string;
  type?: 'COMPANY' | 'BRANCH' | 'AGENT';
  branchId?: string;
  agentId?: string;
  currencyCode?: string;
  isActive?: boolean;
}

interface AutoGenerateOptions {
  throwOnDuplicate?: boolean;
}

export interface PartyStatementFilters {
  partyType?: 'customer' | 'sender_receiver' | 'agent';
  partyId?: string;
  fromAt?: string;
  toAt?: string;
  includeReversals?: boolean;
}

export interface PartyLedgerFilters extends PartyStatementFilters {
  page?: number;
  pageSize?: number;
}

export interface PartyAnalyticsFilters extends PartyStatementFilters {
  topN?: number;
}

export interface DebitCreditSummaryFilters {
  partyType?: 'customer' | 'sender_receiver' | 'agent';
  partyId?: string;
  branchId?: string;
  currencyCode?: string;
  dateFrom?: string;
  dateTo?: string;
  balanceDirection?: 'debit' | 'credit' | 'balanced';
  search?: string;
  page?: number;
  pageSize?: number;
  /** When true, also shows sender_receiver operational parties. Default: false (financial parties only). */
  includeOperationalParties?: boolean;
}

export interface AccountStatementFilters extends DebitCreditSummaryFilters {
  referenceType?: 'shipment' | 'receipt' | 'payment' | 'expense' | 'settlement';
}

export type ShipmentComponentMovementType =
  | 'shipment_shipping_fee'
  | 'sender_collection_trust'
  | 'loading_dues'
  | 'shipment_hawala_trust'
  | 'shipment_transfer_service_fee'
  | 'general_collection';

export interface DashboardCacheMetricsSnapshot {
  ttlMs: number;
  resetControl: {
    enabled: boolean;
    requireConfirm: boolean;
  };
  cacheEntries: number;
  inFlightEntries: number;
  counters: {
    hits: number;
    misses: number;
    inFlightHits: number;
    sets: number;
    invalidations: number;
    evictions: number;
  };
}

export interface DashboardCacheResetAuditRecord {
  userId?: string;
  scope?: {
    branchId?: string;
    agentId?: string;
  };
  resetCache: boolean;
  resetMetrics: boolean;
  confirm: boolean;
  outcome: 'success' | 'blocked';
  reason?: string;
}

function buildScopeWhere(scope?: DataScope, startIndex = 1, alias = '', skipCompany = false) {
  const values: string[] = [];
  const conditions: string[] = [];
  const prefix = alias ? `${alias}.` : '';
  if (!skipCompany && scope?.companyId) {
    values.push(scope.companyId);
    conditions.push(`${prefix}company_id = $${startIndex + values.length - 1}`);
  }
  // Agent mini-ERP finance: bind strictly to voucher.agent_id (ignore branch header overlap).
  if (scope?.financeAgentScope) {
    if (scope.agentId) {
      values.push(scope.agentId);
      conditions.push(`${prefix}agent_id = $${startIndex + values.length - 1}`);
      return { values, conditions };
    }
    conditions.push('false');
    return { values, conditions };
  }
  if (scope?.branchId) {
    values.push(scope.branchId);
    conditions.push(`${prefix}branch_id = $${startIndex + values.length - 1}`);
  }
  if (scope?.agentId) {
    values.push(scope.agentId);
    conditions.push(`${prefix}agent_id = $${startIndex + values.length - 1}`);
  }
  return { values, conditions };
}

export class FinanceRepository {
  async getDashboardCacheMetricsState() {
    const result = await pool.query('select * from dashboard_cache_metrics_state where id = true limit 1');
    return result.rows[0] ?? null;
  }

  async saveDashboardCacheMetricsState(snapshot: DashboardCacheMetricsSnapshot) {
    await pool.query(
      `
      insert into dashboard_cache_metrics_state(
        id, ttl_ms, reset_enabled, reset_require_confirm, cache_entries, in_flight_entries,
        hits, misses, in_flight_hits, sets, invalidations, evictions, updated_at
      ) values(
        true, $1, $2, $3, $4, $5,
        $6, $7, $8, $9, $10, $11, now()
      )
      on conflict (id) do update
      set
        ttl_ms = excluded.ttl_ms,
        reset_enabled = excluded.reset_enabled,
        reset_require_confirm = excluded.reset_require_confirm,
        cache_entries = excluded.cache_entries,
        in_flight_entries = excluded.in_flight_entries,
        hits = excluded.hits,
        misses = excluded.misses,
        in_flight_hits = excluded.in_flight_hits,
        sets = excluded.sets,
        invalidations = excluded.invalidations,
        evictions = excluded.evictions,
        updated_at = now()
      `,
      [
        snapshot.ttlMs,
        snapshot.resetControl.enabled,
        snapshot.resetControl.requireConfirm,
        snapshot.cacheEntries,
        snapshot.inFlightEntries,
        snapshot.counters.hits,
        snapshot.counters.misses,
        snapshot.counters.inFlightHits,
        snapshot.counters.sets,
        snapshot.counters.invalidations,
        snapshot.counters.evictions,
      ],
    );
  }

  async logDashboardCacheResetAudit(entry: DashboardCacheResetAuditRecord) {
    await pool.query(
      `
      insert into dashboard_cache_reset_audit(
        user_id, branch_id, agent_id, reset_cache, reset_metrics, confirm, outcome, reason, at
      ) values($1, $2, $3, $4, $5, $6, $7, $8, now())
      `,
      [
        entry.userId ?? null,
        entry.scope?.branchId ?? null,
        entry.scope?.agentId ?? null,
        entry.resetCache,
        entry.resetMetrics,
        entry.confirm,
        entry.outcome,
        entry.reason ?? null,
      ],
    );
  }

  async listDashboardCacheResetAudit(limit: number) {
    const normalizedLimit = Math.min(100, Math.max(1, limit));
    const [entries, total] = await Promise.all([
      pool.query(
        `
        select
          at,
          user_id as "userId",
          branch_id as "branchId",
          agent_id as "agentId",
          reset_cache as "resetCache",
          reset_metrics as "resetMetrics",
          confirm,
          outcome,
          reason
        from dashboard_cache_reset_audit
        order by created_at desc
        limit $1
        `,
        [normalizedLimit],
      ),
      pool.query('select count(*)::int as total from dashboard_cache_reset_audit'),
    ]);

    return {
      total: total.rows[0]?.total ?? 0,
      entries: entries.rows.map((row) => ({
        at: row.at,
        userId: row.userId ?? undefined,
        scope: {
          branchId: row.branchId ?? undefined,
          agentId: row.agentId ?? undefined,
        },
        resetCache: row.resetCache,
        resetMetrics: row.resetMetrics,
        confirm: row.confirm,
        outcome: row.outcome,
        reason: row.reason ?? undefined,
      })),
    };
  }

  async listReceiptVouchers(scope?: DataScope, filters?: { deliveryId?: string }) {
    const scoped = buildScopeWhere(scope, 1, 'v');
    const values = [...scoped.values];
    const conditions = [...scoped.conditions];
    if (filters?.deliveryId) {
      values.push(filters.deliveryId);
      conditions.push(`v.delivery_id = $${values.length}`);
    }
    const whereClause = conditions.length ? `where ${conditions.join(' and ')}` : '';
    const result = await pool.query(
      `
      select
        v.*,
        case
          when v.sender_receiver_id is not null then sr.full_name
          when v.customer_id is not null then c.name
          when v.agent_id is not null then a.name
          else null
        end as party_display_name,
        cb.name as cashbox_name,
        cb.code as cashbox_code
      from receipt_vouchers v
      left join customers c on c.id = v.customer_id
      left join senders_receivers sr on sr.id = v.sender_receiver_id
      left join agents a on a.id = v.agent_id
      left join cashboxes cb on cb.id = v.cashbox_id
      ${whereClause}
      order by v.created_at desc
      `,
      values,
    );
    return result.rows;
  }

  async getReceiptVoucherById(id: string, scope?: DataScope) {
    const scoped = buildScopeWhere(scope, 2);
    const conditions = ['id = $1', ...scoped.conditions];
    const result = await pool.query(`select * from receipt_vouchers where ${conditions.join(' and ')}`, [id, ...scoped.values]);
    return result.rows[0] ?? null;
  }

  async listPaymentVouchers(scope?: DataScope) {
    const scoped = buildScopeWhere(scope, 1, 'v');
    const whereClause = scoped.conditions.length ? `where ${scoped.conditions.join(' and ')}` : '';
    const result = await pool.query(
      `
      select
        v.*,
        case
          when v.sender_receiver_id is not null then sr.full_name
          when v.customer_id is not null then c.name
          when v.agent_id is not null then a.name
          else null
        end as party_display_name,
        cb.name as cashbox_name,
        cb.code as cashbox_code
      from payment_vouchers v
      left join customers c on c.id = v.customer_id
      left join senders_receivers sr on sr.id = v.sender_receiver_id
      left join agents a on a.id = v.agent_id
      left join cashboxes cb on cb.id = v.cashbox_id
      ${whereClause}
      order by v.created_at desc
      `,
      scoped.values,
    );
    return result.rows;
  }

  async getPaymentVoucherById(id: string, scope?: DataScope) {
    const scoped = buildScopeWhere(scope, 2);
    const conditions = ['id = $1', ...scoped.conditions];
    const result = await pool.query(`select * from payment_vouchers where ${conditions.join(' and ')}`, [id, ...scoped.values]);
    return result.rows[0] ?? null;
  }

  async listCashboxTransactions(scope?: DataScope) {
    if (scope?.financeAgentScope) {
      if (!scope.companyId || !scope.agentId) {
        return [];
      }
      const result = await pool.query(
        `
        select ct.*
        from cashbox_transactions ct
        left join cashboxes cb on cb.id = ct.cashbox_id
        where ct.company_id = $1::uuid
          and (
            cb.agent_id = $2::uuid
            or (ct.cashbox_id is null and ct.agent_id = $2::uuid)
          )
        order by ct.created_at desc
        `,
        [scope.companyId, scope.agentId],
      );
      return result.rows;
    }
    const scoped = buildScopeWhere(scope, 1, 'ct');
    const whereClause = scoped.conditions.length ? `where ${scoped.conditions.join(' and ')}` : '';
    const result = await pool.query(
      `select ct.* from cashbox_transactions ct ${whereClause} order by ct.created_at desc`,
      scoped.values,
    );
    return result.rows;
  }

  async listCashboxes(scope?: DataScope, filters?: CashboxListFilters) {
    const conditions: string[] = [];
    const values: unknown[] = [];

    if (scope?.companyId) {
      values.push(scope.companyId);
      conditions.push(`c.company_id = $${values.length}::uuid`);
    }

    if (scope?.financeAgentScope) {
      if (!scope.agentId) {
        return [];
      }
      values.push(scope.agentId);
      conditions.push(`c.agent_id = $${values.length}::uuid`);
      conditions.push(`c.type = 'AGENT'`);
    } else {
      if (filters?.type) {
        values.push(filters.type);
        conditions.push(`c.type = $${values.length}`);
      }
      if (filters?.branchId) {
        values.push(filters.branchId);
        conditions.push(`c.branch_id = $${values.length}::uuid`);
      }
      if (filters?.agentId) {
        values.push(filters.agentId);
        conditions.push(`c.agent_id = $${values.length}::uuid`);
      }
      if (filters?.currencyCode) {
        values.push(filters.currencyCode.toUpperCase());
        conditions.push(`c.currency_code = $${values.length}`);
      }
      if (filters?.isActive === true || filters?.isActive === false) {
        values.push(filters.isActive);
        conditions.push(`c.is_active = $${values.length}`);
      }
    }

    if (filters?.search?.trim()) {
      const q = `%${filters.search.trim()}%`;
      values.push(q);
      const i = values.length;
      values.push(q);
      conditions.push(`(c.name ilike $${i} or c.code ilike $${i + 1})`);
    }

    const whereSql = conditions.length ? `where ${conditions.join(' and ')}` : '';
    const result = await pool.query(
      `
      select
        c.*,
        b.name as branch_name,
        a.name as agent_name,
        u.username as created_by_username,
        pc.name as parent_cashbox_name,
        pc.code as parent_cashbox_code
      from cashboxes c
      left join branches b on b.id = c.branch_id
      left join agents a on a.id = c.agent_id
      left join users u on u.id = c.created_by_user_id
      left join cashboxes pc on pc.id = c.parent_cashbox_id
      ${whereSql}
      order by c.code asc
      `,
      values,
    );
    return result.rows;
  }

  async getCashboxById(id: string, scope?: DataScope) {
    const result = await pool.query(
      `
      select
        c.*,
        b.name as branch_name,
        a.name as agent_name,
        u.username as created_by_username,
        pc.name as parent_cashbox_name,
        pc.code as parent_cashbox_code
      from cashboxes c
      left join branches b on b.id = c.branch_id
      left join agents a on a.id = c.agent_id
      left join users u on u.id = c.created_by_user_id
      left join cashboxes pc on pc.id = c.parent_cashbox_id
      where c.id = $1::uuid
      limit 1
      `,
      [id],
    );
    const row = result.rows[0];
    if (!row) return null;
    if (scope?.companyId && String(row.company_id) !== scope.companyId) {
      return null;
    }
    if (scope?.financeAgentScope) {
      if (!scope.agentId || String(row.agent_id) !== String(scope.agentId)) {
        return null;
      }
    }
    return row;
  }

  async resolveBranchCode(branchId: string, companyId: string): Promise<string | null> {
    const r = await pool.query<{ code: string }>(
      `select code from branches where id = $1::uuid and company_id = $2::uuid limit 1`,
      [branchId, companyId],
    );
    return r.rows[0]?.code ?? null;
  }

  async findDefaultCompanyCashboxUsdId(companyId: string): Promise<string | null> {
    const r = await pool.query<{ id: string }>(
      `
      select id
      from cashboxes
      where company_id = $1::uuid
        and type = 'COMPANY'
        and currency_code = 'USD'
        and is_active = true
      order by case when code = 'CASH-GENERAL-USD' then 0 else 1 end, created_at asc
      limit 1
      `,
      [companyId],
    );
    return r.rows[0]?.id ?? null;
  }

  async findActiveBranchCashboxUsd(companyId: string): Promise<{ id: string; branch_id: string } | null> {
    const r = await pool.query<{ id: string; branch_id: string }>(
      `
      select id, branch_id
      from cashboxes
      where company_id = $1::uuid
        and type = 'BRANCH'
        and currency_code = 'USD'
        and is_active = true
      limit 1
      `,
      [companyId],
    );
    return r.rows[0] ?? null;
  }

  async findAnyAgentCashbox(companyId: string, agentId: string): Promise<Record<string, unknown> | null> {
    const r = await pool.query(
      `
      select *
      from cashboxes
      where company_id = $1::uuid
        and agent_id = $2::uuid
        and type = 'AGENT'
      limit 1
      `,
      [companyId, agentId],
    );
    return r.rows[0] ?? null;
  }

  async createCashbox(input: CashboxInput) {
    const opening = input.openingBalance ?? 0;
    const current = input.currentBalance ?? opening;
    const result = await pool.query(
      `
      insert into cashboxes(
        company_id, branch_id, agent_id, code, name, type, currency_code,
        opening_balance, current_balance, is_active, notes, created_by_user_id, parent_cashbox_id, created_at, updated_at
      ) values ($1,$2,$3,$4,$5,$6,$7,$8,$9,coalesce($10,true),$11,$12,$13,now(),now())
      returning *
      `,
      [
        input.companyId,
        input.branchId ?? null,
        input.agentId ?? null,
        input.code.trim(),
        input.name.trim(),
        input.type,
        String(input.currencyCode).toUpperCase(),
        opening,
        current,
        input.isActive,
        input.notes ?? null,
        input.createdByUserId ?? null,
        input.parentCashboxId ?? null,
      ],
    );
    return result.rows[0] ?? null;
  }

  async updateCashbox(id: string, input: Partial<CashboxInput>, scope?: DataScope) {
    const existing = await this.getCashboxById(id, scope);
    if (!existing) return null;
    const result = await pool.query(
      `
      update cashboxes
      set
        code = coalesce($2, code),
        name = coalesce($3, name),
        branch_id = coalesce($4, branch_id),
        agent_id = coalesce($5, agent_id),
        currency_code = coalesce($6, currency_code),
        opening_balance = coalesce($7, opening_balance),
        is_active = coalesce($8, is_active),
        notes = coalesce($9, notes),
        updated_at = now()
      where id = $1::uuid
      returning *
      `,
      [
        id,
        input.code?.trim() ?? null,
        input.name?.trim() ?? null,
        input.branchId !== undefined ? input.branchId : null,
        input.agentId !== undefined ? input.agentId : null,
        input.currencyCode ? String(input.currencyCode).toUpperCase() : null,
        input.openingBalance ?? null,
        input.isActive ?? null,
        input.notes !== undefined ? input.notes : null,
      ],
    );
    return result.rows[0] ?? null;
  }

  async listCashboxMovementsForCashbox(cashboxId: string, scope?: DataScope) {
    const cb = await this.getCashboxById(cashboxId, scope);
    if (!cb) return [];

    const result = await pool.query(
      `
      select
        ct.*,
        u.username as created_by_username
      from cashbox_transactions ct
      left join users u on u.id = ct.created_by_user_id
      where ct.cashbox_id = $1::uuid
      order by ct.created_at asc
      `,
      [cashboxId],
    );
    return result.rows;
  }

  async getCashboxStatement(
    cashboxId: string,
    scope?: DataScope,
    filters?: { dateFrom?: string; dateTo?: string; transactionType?: 'inflow' | 'outflow' },
  ) {
    const cb = await this.getCashboxById(cashboxId, scope);
    if (!cb) return null;

    const values: unknown[] = [cashboxId];
    const periodConditions = ['ct.cashbox_id = $1::uuid'];
    const beforeConditions = ['ct.cashbox_id = $1::uuid'];

    if (filters?.dateFrom) {
      values.push(filters.dateFrom);
      const ref = `$${values.length}::timestamptz`;
      periodConditions.push(`ct.created_at >= ${ref}`);
      beforeConditions.push(`ct.created_at < ${ref}`);
    }
    if (filters?.dateTo) {
      values.push(filters.dateTo);
      periodConditions.push(`ct.created_at <= $${values.length}::timestamptz`);
    }
    if (filters?.transactionType) {
      values.push(filters.transactionType);
      periodConditions.push(`ct.transaction_type = $${values.length}`);
    }

    const beforeResult = await pool.query(
      `
      select coalesce(sum(case when transaction_type = 'inflow' then original_amount else -original_amount end), 0) as delta
      from cashbox_transactions ct
      where ${beforeConditions.join(' and ')}
      `,
      values.slice(0, filters?.dateFrom ? 2 : 1),
    );
    const openingBalance = Number(cb.opening_balance || 0) + Number(beforeResult.rows[0]?.delta || 0);

    const result = await pool.query(
      `
      select
        ct.*,
        coalesce(rv.voucher_no, pv.voucher_no, '-') as reference_no,
        coalesce(rv.status, pv.status, case when ct.is_reversal then 'reversal' else 'posted' end) as status,
        coalesce(rv.related_entity_type, pv.related_entity_type) as related_entity_type,
        case
          when coalesce(rv.related_entity_type, pv.related_entity_type) = 'cashbox_transfer' then 'cashbox_transfer'
          when ct.source_voucher_type = 'receipt' then 'receipt_voucher'
          when pv.related_entity_type = 'expense' then 'expense'
          when pv.related_entity_type = 'salary_record' then 'salary_record'
          when ct.source_voucher_type = 'payment' then 'payment_voucher'
          else ct.source_voucher_type
        end as source_label,
        case
          when pv.related_entity_type = 'salary_record' then emp.name
          when coalesce(rv.related_entity_type, pv.related_entity_type) = 'cashbox_transfer' then 'مناقلة بين الصناديق'
          when coalesce(rv.related_entity_type, pv.related_entity_type) = 'manual_party' then
            trim(split_part(regexp_replace(coalesce(rv.notes, pv.notes, ''), '^\\s*جهة:\\s*', ''), ' - ', 1))
          when rv.sender_receiver_id is not null then rv_sr.full_name
          when pv.sender_receiver_id is not null then pv_sr.full_name
          when rv.customer_id is not null then rv_c.name
          when pv.customer_id is not null then pv_c.name
          when rv.agent_id is not null then rv_a.name
          when pv.agent_id is not null then pv_a.name
          when pv.related_entity_type = 'expense' then 'مصروف داخلي'
          else null
        end as party_display_name,
        coalesce(u.username, u.full_name, '-') as created_by_username
      from cashbox_transactions ct
      left join receipt_vouchers rv on ct.source_voucher_type = 'receipt' and rv.id = ct.source_voucher_id
      left join payment_vouchers pv on ct.source_voucher_type = 'payment' and pv.id = ct.source_voucher_id
      left join customers rv_c on rv_c.id = rv.customer_id
      left join customers pv_c on pv_c.id = pv.customer_id
      left join senders_receivers rv_sr on rv_sr.id = rv.sender_receiver_id
      left join senders_receivers pv_sr on pv_sr.id = pv.sender_receiver_id
      left join agents rv_a on rv_a.id = rv.agent_id
      left join agents pv_a on pv_a.id = pv.agent_id
      left join salary_records sal on pv.related_entity_type = 'salary_record' and sal.id = pv.related_entity_id
      left join employees emp on emp.id = sal.employee_id
      left join users u on u.id = ct.created_by_user_id
      where ${periodConditions.join(' and ')}
      order by ct.created_at asc, ct.id asc
      `,
      values,
    );

    let running = openingBalance;
    let totalIncoming = 0;
    let totalOutgoing = 0;
    const rows = result.rows.map((row) => {
      const amount = Number(row.original_amount || 0);
      const incoming = row.transaction_type === 'inflow' ? amount : 0;
      const outgoing = row.transaction_type === 'outflow' ? amount : 0;
      totalIncoming += incoming;
      totalOutgoing += outgoing;
      running += incoming - outgoing;
      return {
        ...row,
        debit_in: incoming,
        credit_out: outgoing,
        running_balance: Number(running.toFixed(2)),
      };
    });

    return {
      cashbox: cb,
      summary: {
        openingBalance: Number(openingBalance.toFixed(2)),
        totalIncoming: Number(totalIncoming.toFixed(2)),
        totalOutgoing: Number(totalOutgoing.toFixed(2)),
        closingBalance: Number(running.toFixed(2)),
      },
      rows,
    };
  }

  async listPartyFinancialMovements(scope?: DataScope) {
    const scoped = buildScopeWhere(scope, 1, '', true);
    const whereClause = scoped.conditions.length ? `where ${scoped.conditions.join(' and ')}` : '';
    const result = await pool.query(`select * from party_financial_movements ${whereClause} order by created_at desc`, scoped.values);
    return result.rows;
  }

  async getDebitCreditSummary(scope?: DataScope, filters?: DebitCreditSummaryFilters) {
    const scoped = buildScopeWhere(scope, 1, 'pfm', true);
    const values: string[] = [...scoped.values];
    const conditions: string[] = [...scoped.conditions, 'pfm.is_reversal = false'];

    if (filters?.partyType) {
      // Explicit party type filter — honour exactly what was requested
      values.push(filters.partyType);
      conditions.push(`pfm.party_type = $${values.length}`);
    } else if (!filters?.includeOperationalParties) {
      // Default: financial parties only (agents and account customers).
      // sender_receiver are operational contacts, not ledger parties by default.
      conditions.push(`pfm.party_type in ('agent', 'customer')`);
    }
    if (filters?.partyId) {
      values.push(filters.partyId);
      conditions.push(`pfm.party_id = $${values.length}::uuid`);
    }
    if (filters?.branchId) {
      values.push(filters.branchId);
      conditions.push(`pfm.branch_id = $${values.length}::uuid`);
    }
    if (filters?.currencyCode) {
      values.push(filters.currencyCode.toUpperCase());
      conditions.push(`pfm.original_currency = $${values.length}`);
    }
    if (filters?.dateFrom) {
      values.push(filters.dateFrom);
      conditions.push(`pfm.created_at >= $${values.length}::timestamptz`);
    }
    if (filters?.dateTo) {
      values.push(filters.dateTo);
      conditions.push(`pfm.created_at <= $${values.length}::timestamptz`);
    }
    if (filters?.search?.trim()) {
      values.push(`%${filters.search.trim()}%`);
      conditions.push(`(
        coalesce(c.name, sr.full_name, ag.name, '') ilike $${values.length}
        or coalesce(c.code, sr.code, ag.code, '') ilike $${values.length}
      )`);
    }

    const page = Math.max(1, Number(filters?.page ?? 1));
    const pageSize = Math.min(500, Math.max(1, Number(filters?.pageSize ?? 100)));
    const offset = (page - 1) * pageSize;

    values.push(String(pageSize));
    const limitRef = `$${values.length}`;
    values.push(String(offset));
    const offsetRef = `$${values.length}`;

    const whereClause = conditions.length ? `where ${conditions.join(' and ')}` : '';
    const debitExpr = `case when pfm.direction in ('debit', 'inflow') then coalesce(nullif(pfm.debit_amount, 0), pfm.original_amount) else 0 end`;
    const creditExpr = `case when pfm.direction in ('credit', 'outflow') then coalesce(nullif(pfm.credit_amount, 0), pfm.original_amount) else 0 end`;
    const directionHaving =
      filters?.balanceDirection === 'debit'
        ? `having sum(${debitExpr}) > sum(${creditExpr})`
        : filters?.balanceDirection === 'credit'
          ? `having sum(${creditExpr}) > sum(${debitExpr})`
          : filters?.balanceDirection === 'balanced'
            ? `having sum(${debitExpr}) = sum(${creditExpr})`
            : '';

    const result = await pool.query(
      `
      select
        pfm.party_type,
        pfm.party_id,
        coalesce(c.code, sr.code, ag.code, '-') as party_code,
        coalesce(c.name, sr.full_name, ag.name, '-') as party_name,
        b.name as branch_name,
        pfm.original_currency as currency_code,
        coalesce(sum(${debitExpr}), 0)::numeric as total_debit,
        coalesce(sum(${creditExpr}), 0)::numeric as total_credit,
        (
          coalesce(sum(${debitExpr}), 0)
          - coalesce(sum(${creditExpr}), 0)
        )::numeric as balance,
        max(pfm.created_at) as last_movement_at,
        count(*)::int as movement_count,
        count(*) over()::int as total_count
      from party_financial_movements pfm
      left join customers c on pfm.party_type = 'customer' and c.id = pfm.party_id
      left join senders_receivers sr on pfm.party_type = 'sender_receiver' and sr.id = pfm.party_id
      left join agents ag on pfm.party_type = 'agent' and ag.id = pfm.party_id
      left join branches b on b.id = pfm.branch_id
      ${whereClause}
      group by pfm.party_type, pfm.party_id, party_code, party_name, b.name, pfm.original_currency
      ${directionHaving}
      order by max(pfm.created_at) desc, party_name asc
      limit ${limitRef}
      offset ${offsetRef}
      `,
      values,
    );

    const total = result.rows.length ? Number(result.rows[0].total_count ?? 0) : 0;
    const rows = result.rows.map((row) => {
      const { total_count, ...rest } = row;
      return rest;
    });

    return { page, pageSize, total, rows };
  }

  async getDetailedAccountStatement(scope?: DataScope, filters?: AccountStatementFilters) {
    const scoped = buildScopeWhere(scope, 1, 'pfm', true);
    const values: string[] = [...scoped.values];
    const conditions: string[] = [...scoped.conditions, 'pfm.is_reversal = false'];

    if (filters?.partyType) {
      // Explicit party type requested — honour it
      values.push(filters.partyType);
      conditions.push(`pfm.party_type = $${values.length}`);
    } else if (!filters?.includeOperationalParties) {
      // Default: exclude operational sender_receiver contacts from financial statements
      conditions.push(`pfm.party_type in ('agent', 'customer')`);
    }
    if (filters?.partyId) {
      values.push(filters.partyId);
      conditions.push(`pfm.party_id = $${values.length}::uuid`);
    }
    if (filters?.branchId) {
      values.push(filters.branchId);
      conditions.push(`pfm.branch_id = $${values.length}::uuid`);
    }
    if (filters?.currencyCode) {
      values.push(filters.currencyCode.toUpperCase());
      conditions.push(`pfm.original_currency = $${values.length}`);
    }
    if (filters?.dateFrom) {
      values.push(filters.dateFrom);
      conditions.push(`pfm.created_at >= $${values.length}::timestamptz`);
    }
    if (filters?.dateTo) {
      values.push(filters.dateTo);
      conditions.push(`pfm.created_at <= $${values.length}::timestamptz`);
    }
    if (filters?.referenceType) {
      if (filters.referenceType === 'shipment') {
        conditions.push(`(pfm.shipment_id is not null or pfm.movement_type in ('shipment_charge', 'shipment_shipping_fee', 'sender_collection_trust', 'loading_dues', 'general_collection'))`);
      }
      if (filters.referenceType === 'receipt') conditions.push(`pfm.voucher_type = 'receipt'`);
      if (filters.referenceType === 'payment') conditions.push(`pfm.voucher_type = 'payment'`);
      if (filters.referenceType === 'expense') conditions.push(`1=0`);
      if (filters.referenceType === 'settlement') conditions.push(`1=0`);
    }
    if (filters?.search?.trim()) {
      values.push(`%${filters.search.trim()}%`);
      conditions.push(`(
        coalesce(c.name, sr.full_name, ag.name, '') ilike $${values.length}
        or coalesce(c.code, sr.code, ag.code, '') ilike $${values.length}
        or coalesce(rv.voucher_no, pv.voucher_no, sh.shipment_no, '') ilike $${values.length}
        or coalesce(pfm.notes, rv.notes, pv.notes, '') ilike $${values.length}
      )`);
    }

    const page = Math.max(1, Number(filters?.page ?? 1));
    const pageSize = Math.min(1000, Math.max(1, Number(filters?.pageSize ?? 200)));
    const offset = (page - 1) * pageSize;
    values.push(String(pageSize));
    const limitRef = `$${values.length}`;
    values.push(String(offset));
    const offsetRef = `$${values.length}`;

    const whereClause = conditions.length ? `where ${conditions.join(' and ')}` : '';

    const result = await pool.query(
      `
      select
        pfm.id,
        pfm.created_at as date,
        pfm.party_type,
        pfm.party_id,
        coalesce(c.name, sr.full_name, ag.name, '-') as party_name,
        case
          when pfm.movement_type in ('shipment_charge', 'shipment_shipping_fee', 'sender_collection_trust', 'loading_dues', 'general_collection') then 'shipment'
          when pfm.voucher_type = 'receipt' then 'receipt'
          when pfm.voucher_type = 'payment' then 'payment'
          when pfm.shipment_id is not null then 'shipment'
          else coalesce(pfm.reference_type, pfm.movement_type::text, 'movement')
        end as reference_type,
        coalesce(rv.voucher_no, pv.voucher_no, case when pfm.movement_type in ('shipment_charge', 'shipment_shipping_fee', 'sender_collection_trust', 'loading_dues', 'general_collection') then sh.shipment_no end, '-') as reference_no,
        sh.shipment_no,
        coalesce(
          nullif(trim(pfm.notes), ''),
          case
            when pfm.movement_type = 'shipment_charge' and coalesce(sh.shipment_no, '') <> ''
              then 'أجرة شحن على الشحنة رقم ' || sh.shipment_no
          end,
          rv.notes,
          pv.notes,
          ''
        ) as description,
        case when pfm.direction in ('debit', 'inflow') then coalesce(nullif(pfm.debit_amount, 0), pfm.original_amount) else 0 end::numeric as debit,
        case when pfm.direction in ('credit', 'outflow') then coalesce(nullif(pfm.credit_amount, 0), pfm.original_amount) else 0 end::numeric as credit,
        pfm.original_currency as currency_code,
        case when pfm.voucher_type = 'receipt' then 'cash' when pfm.voucher_type = 'payment' then 'cash' else null end as payment_method,
        b.name as branch_name,
        coalesce(u.username, u.full_name, '-') as username,
        pfm.notes,
        count(*) over()::int as total_count
      from party_financial_movements pfm
      left join receipt_vouchers rv on pfm.voucher_type = 'receipt' and rv.id = pfm.voucher_id
      left join payment_vouchers pv on pfm.voucher_type = 'payment' and pv.id = pfm.voucher_id
      left join shipments sh on sh.id = pfm.shipment_id
      left join branches b on b.id = pfm.branch_id
      left join users u on u.id = pfm.created_by_user_id
      left join customers c on pfm.party_type = 'customer' and c.id = pfm.party_id
      left join senders_receivers sr on pfm.party_type = 'sender_receiver' and sr.id = pfm.party_id
      left join agents ag on pfm.party_type = 'agent' and ag.id = pfm.party_id
      ${whereClause}
      order by pfm.created_at asc, pfm.id asc
      limit ${limitRef}
      offset ${offsetRef}
      `,
      values,
    );

    const total = result.rows.length ? Number(result.rows[0].total_count ?? 0) : 0;
    const rows = result.rows.map((row) => {
      const { total_count, ...rest } = row;
      return rest;
    });

    return { page, pageSize, total, rows };
  }

  async listPartyStatementEntries(scope?: DataScope, filters?: PartyStatementFilters) {
    const scoped = buildScopeWhere(scope, 1, 'pfm', true);
    const values = [...scoped.values];
    const conditions = [...scoped.conditions];

    if (filters?.partyType) {
      values.push(filters.partyType);
      conditions.push(`pfm.party_type = $${values.length}`);
    }
    if (filters?.partyId) {
      values.push(filters.partyId);
      conditions.push(`pfm.party_id = $${values.length}`);
    }
    if (filters?.fromAt) {
      values.push(filters.fromAt);
      conditions.push(`pfm.created_at >= $${values.length}::timestamptz`);
    }
    if (filters?.toAt) {
      values.push(filters.toAt);
      conditions.push(`pfm.created_at <= $${values.length}::timestamptz`);
    }
    if (filters?.includeReversals === false) {
      conditions.push('pfm.is_reversal = false');
    }

    const whereClause = conditions.length ? `where ${conditions.join(' and ')}` : '';
    const result = await pool.query(
      `
      select
        pfm.*,
        case
          when pfm.direction in ('inflow', 'debit') then pfm.base_amount_usd
          when pfm.direction in ('outflow', 'credit') then -pfm.base_amount_usd
          else 0
        end as signed_base_amount_usd
      from party_financial_movements pfm
      ${whereClause}
      order by pfm.created_at asc, pfm.id asc
      `,
      values,
    );
    return result.rows;
  }

  async getPartyStatementSummary(scope?: DataScope, filters?: PartyStatementFilters) {
    const scoped = buildScopeWhere(scope, 1, 'pfm', true);
    const values = [...scoped.values];
    const baseConditions = [...scoped.conditions];

    if (filters?.partyType) {
      values.push(filters.partyType);
      baseConditions.push(`pfm.party_type = $${values.length}`);
    }
    if (filters?.partyId) {
      values.push(filters.partyId);
      baseConditions.push(`pfm.party_id = $${values.length}`);
    }
    if (filters?.includeReversals === false) {
      baseConditions.push('pfm.is_reversal = false');
    }

    const openingConditions = [...baseConditions];
    const periodConditions = [...baseConditions];

    if (filters?.fromAt) {
      values.push(filters.fromAt);
      const fromRef = `$${values.length}::timestamptz`;
      openingConditions.push(`pfm.created_at < ${fromRef}`);
      periodConditions.push(`pfm.created_at >= ${fromRef}`);
    }
    if (filters?.toAt) {
      values.push(filters.toAt);
      periodConditions.push(`pfm.created_at <= $${values.length}::timestamptz`);
    }

    const openingWhere = openingConditions.length ? `where ${openingConditions.join(' and ')}` : '';
    const periodWhere = periodConditions.length ? `where ${periodConditions.join(' and ')}` : '';

    const result = await pool.query(
      `
      with opening as (
        select coalesce(sum(
          case
            when pfm.direction in ('inflow', 'debit') then pfm.base_amount_usd
            when pfm.direction in ('outflow', 'credit') then -pfm.base_amount_usd
            else 0
          end
        ), 0)::numeric as opening_balance_usd
        from party_financial_movements pfm
        ${openingWhere}
      ),
      period as (
        select
          coalesce(sum(case when pfm.direction in ('inflow', 'debit') then pfm.base_amount_usd else 0 end), 0)::numeric as period_inflow_usd,
          coalesce(sum(case when pfm.direction in ('outflow', 'credit') then pfm.base_amount_usd else 0 end), 0)::numeric as period_outflow_usd
        from party_financial_movements pfm
        ${periodWhere}
      )
      select
        opening.opening_balance_usd,
        period.period_inflow_usd,
        period.period_outflow_usd,
        (opening.opening_balance_usd + period.period_inflow_usd - period.period_outflow_usd)::numeric as closing_balance_usd
      from opening, period
      `,
      values,
    );

    return result.rows[0];
  }

  async listPartyLedger(scope?: DataScope, filters?: PartyLedgerFilters) {
    const scoped = buildScopeWhere(scope, 1, 'pfm', true);
    const values = [...scoped.values];
    const conditions = [...scoped.conditions];

    if (filters?.partyType) {
      values.push(filters.partyType);
      conditions.push(`pfm.party_type = $${values.length}`);
    }
    if (filters?.partyId) {
      values.push(filters.partyId);
      conditions.push(`pfm.party_id = $${values.length}`);
    }
    if (filters?.fromAt) {
      values.push(filters.fromAt);
      conditions.push(`pfm.created_at >= $${values.length}::timestamptz`);
    }
    if (filters?.toAt) {
      values.push(filters.toAt);
      conditions.push(`pfm.created_at <= $${values.length}::timestamptz`);
    }
    if (filters?.includeReversals === false) {
      conditions.push('pfm.is_reversal = false');
    }

    const page = Math.max(1, filters?.page ?? 1);
    const pageSize = Math.min(200, Math.max(1, filters?.pageSize ?? 25));
    const offset = (page - 1) * pageSize;

    values.push(String(pageSize));
    const limitRef = `$${values.length}`;
    values.push(String(offset));
    const offsetRef = `$${values.length}`;

    const whereClause = conditions.length ? `where ${conditions.join(' and ')}` : '';

    const rowsResult = await pool.query(
      `
      select
        pfm.*,
        case
          when pfm.direction in ('inflow', 'debit') then pfm.base_amount_usd
          when pfm.direction in ('outflow', 'credit') then -pfm.base_amount_usd
          else 0
        end as signed_base_amount_usd,
        count(*) over()::int as total_count
      from party_financial_movements pfm
      ${whereClause}
      order by pfm.created_at desc, pfm.id desc
      limit ${limitRef}
      offset ${offsetRef}
      `,
      values,
    );

    const total = rowsResult.rows.length ? Number(rowsResult.rows[0].total_count) : 0;
    const rows = rowsResult.rows.map((row) => {
      const { total_count, ...rest } = row;
      return rest;
    });

    return {
      page,
      pageSize,
      total,
      rows,
    };
  }

  async getPartyCurrencySummary(scope?: DataScope, filters?: PartyStatementFilters) {
    const scoped = buildScopeWhere(scope, 1, 'pfm', true);
    const values = [...scoped.values];
    const conditions = [...scoped.conditions];

    if (filters?.partyType) {
      values.push(filters.partyType);
      conditions.push(`pfm.party_type = $${values.length}`);
    }
    if (filters?.partyId) {
      values.push(filters.partyId);
      conditions.push(`pfm.party_id = $${values.length}`);
    }
    if (filters?.fromAt) {
      values.push(filters.fromAt);
      conditions.push(`pfm.created_at >= $${values.length}::timestamptz`);
    }
    if (filters?.toAt) {
      values.push(filters.toAt);
      conditions.push(`pfm.created_at <= $${values.length}::timestamptz`);
    }
    if (filters?.includeReversals === false) {
      conditions.push('pfm.is_reversal = false');
    }

    const whereClause = conditions.length ? `where ${conditions.join(' and ')}` : '';
    const result = await pool.query(
      `
      select
        pfm.original_currency,
        count(*)::int as entries_count,
        coalesce(sum(case when pfm.direction in ('inflow', 'debit') then pfm.original_amount else 0 end), 0)::numeric as inflow_original_amount,
        coalesce(sum(case when pfm.direction in ('outflow', 'credit') then pfm.original_amount else 0 end), 0)::numeric as outflow_original_amount,
        (
          coalesce(sum(case when pfm.direction in ('inflow', 'debit') then pfm.original_amount else 0 end), 0)
          - coalesce(sum(case when pfm.direction in ('outflow', 'credit') then pfm.original_amount else 0 end), 0)
        )::numeric as net_original_amount,
        coalesce(sum(case when pfm.direction in ('inflow', 'debit') then pfm.base_amount_usd else 0 end), 0)::numeric as inflow_base_usd,
        coalesce(sum(case when pfm.direction in ('outflow', 'credit') then pfm.base_amount_usd else 0 end), 0)::numeric as outflow_base_usd,
        (
          coalesce(sum(case when pfm.direction in ('inflow', 'debit') then pfm.base_amount_usd else 0 end), 0)
          - coalesce(sum(case when pfm.direction in ('outflow', 'credit') then pfm.base_amount_usd else 0 end), 0)
        )::numeric as net_base_usd
      from party_financial_movements pfm
      ${whereClause}
      group by pfm.original_currency
      order by pfm.original_currency asc
      `,
      values,
    );
    return result.rows;
  }

  async getPartyAnalyticsSnapshot(scope?: DataScope, filters?: PartyAnalyticsFilters) {
    const scoped = buildScopeWhere(scope, 1, 'pfm', true);
    const values = [...scoped.values];
    const conditions = [...scoped.conditions];

    if (filters?.partyType) {
      values.push(filters.partyType);
      conditions.push(`pfm.party_type = $${values.length}`);
    }
    if (filters?.partyId) {
      values.push(filters.partyId);
      conditions.push(`pfm.party_id = $${values.length}`);
    }
    if (filters?.fromAt) {
      values.push(filters.fromAt);
      conditions.push(`pfm.created_at >= $${values.length}::timestamptz`);
    }
    if (filters?.toAt) {
      values.push(filters.toAt);
      conditions.push(`pfm.created_at <= $${values.length}::timestamptz`);
    }
    if (filters?.includeReversals === false) {
      conditions.push('pfm.is_reversal = false');
    }

    const whereClause = conditions.length ? `where ${conditions.join(' and ')}` : '';
    const topN = Math.min(20, Math.max(1, filters?.topN ?? 5));

    values.push(String(topN));
    const topNRef = `$${values.length}`;

    const [kpis, topParties, trend] = await Promise.all([
      pool.query(
        `
        select
          count(*)::int as entries_count,
          count(distinct concat(pfm.party_type, ':', pfm.party_id))::int as parties_count,
          coalesce(sum(case when pfm.direction in ('inflow', 'debit') then pfm.base_amount_usd else 0 end), 0)::numeric as inflow_base_usd,
          coalesce(sum(case when pfm.direction in ('outflow', 'credit') then pfm.base_amount_usd else 0 end), 0)::numeric as outflow_base_usd,
          (
            coalesce(sum(case when pfm.direction in ('inflow', 'debit') then pfm.base_amount_usd else 0 end), 0)
            - coalesce(sum(case when pfm.direction in ('outflow', 'credit') then pfm.base_amount_usd else 0 end), 0)
          )::numeric as net_base_usd
        from party_financial_movements pfm
        ${whereClause}
        `,
        values.slice(0, -1),
      ),
      pool.query(
        `
        select
          t.party_type,
          t.party_id,
          t.entries_count,
          t.inflow_base_usd,
          t.outflow_base_usd,
          t.net_base_usd,
          case
            when t.party_type = 'customer' then c.name
            when t.party_type = 'sender_receiver' then sr.full_name
            when t.party_type = 'agent' then a.name
            else null
          end as party_name
        from (
          select
            pfm.party_type,
            pfm.party_id,
            count(*)::int as entries_count,
            coalesce(sum(case when pfm.direction in ('inflow', 'debit') then pfm.base_amount_usd else 0 end), 0)::numeric as inflow_base_usd,
            coalesce(sum(case when pfm.direction in ('outflow', 'credit') then pfm.base_amount_usd else 0 end), 0)::numeric as outflow_base_usd,
            (
              coalesce(sum(case when pfm.direction in ('inflow', 'debit') then pfm.base_amount_usd else 0 end), 0)
              - coalesce(sum(case when pfm.direction in ('outflow', 'credit') then pfm.base_amount_usd else 0 end), 0)
            )::numeric as net_base_usd
          from party_financial_movements pfm
          ${whereClause}
          group by pfm.party_type, pfm.party_id
        ) t
        left join customers c on t.party_type = 'customer' and c.id = t.party_id::uuid
        left join senders_receivers sr on t.party_type = 'sender_receiver' and sr.id = t.party_id::uuid
        left join agents a on t.party_type = 'agent' and a.id = t.party_id::uuid
        where
          abs(t.net_base_usd) > 0.0001
          or t.inflow_base_usd > 0.0001
          or t.outflow_base_usd > 0.0001
        order by abs(t.net_base_usd) desc, t.party_type asc, t.party_id asc
        limit ${topNRef}
        `,
        values,
      ),
      pool.query(
        `
        select
          date_trunc('day', pfm.created_at) as day,
          coalesce(sum(case when pfm.direction in ('inflow', 'debit') then pfm.base_amount_usd else 0 end), 0)::numeric as inflow_base_usd,
          coalesce(sum(case when pfm.direction in ('outflow', 'credit') then pfm.base_amount_usd else 0 end), 0)::numeric as outflow_base_usd,
          (
            coalesce(sum(case when pfm.direction in ('inflow', 'debit') then pfm.base_amount_usd else 0 end), 0)
            - coalesce(sum(case when pfm.direction in ('outflow', 'credit') then pfm.base_amount_usd else 0 end), 0)
          )::numeric as net_base_usd
        from party_financial_movements pfm
        ${whereClause}
        group by date_trunc('day', pfm.created_at)
        order by day asc
        `,
        values.slice(0, -1),
      ),
    ]);

    return {
      kpis: kpis.rows[0] ?? {
        entries_count: 0,
        parties_count: 0,
        inflow_base_usd: 0,
        outflow_base_usd: 0,
        net_base_usd: 0,
      },
      topParties: topParties.rows,
      trend: trend.rows,
    };
  }

  private async applyCashboxBalanceDelta(client: any, cashboxId: string | null | undefined, currency: string, delta: number) {
    if (!cashboxId) return;
    const cur = String(currency || '').toUpperCase();
    const result = await client.query(
      `
      update cashboxes
      set current_balance = current_balance + $2::numeric, updated_at = now()
      where id = $1::uuid and currency_code = $3
      returning id
      `,
      [cashboxId, delta, cur],
    );
    if (!result.rowCount) {
      throw new HttpError(400, 'صندوق غير موجود أو العملة لا تطابق عملة الصندوق.');
    }
  }

  /** Resolve cashbox for auto-generated delivery receipts: agent box → company HQ same currency. */
  async resolveDefaultCashboxForAutoReceipt(
    client: any,
    companyId: string,
    agentId: string | null | undefined,
    currency: string,
  ): Promise<string | null> {
    const cur = String(currency || '').toUpperCase();
    if (agentId) {
      const agentBox = await client.query(
        `
        select id from cashboxes
        where company_id = $1::uuid and agent_id = $2::uuid and is_active = true and currency_code = $3
        order by created_at asc
        limit 1
        `,
        [companyId, agentId, cur],
      );
      if (agentBox.rows[0]?.id) return agentBox.rows[0].id as string;
    }
    const hq = await client.query(
      `
      select id from cashboxes
      where company_id = $1::uuid and type = 'COMPANY' and is_active = true and currency_code = $2
      order by created_at asc
      limit 1
      `,
      [companyId, cur],
    );
    return (hq.rows[0]?.id as string) ?? null;
  }

  private async insertCashboxAndMovementForReceipt(client: any, voucher: any) {
    await client.query(
      `
      insert into cashbox_transactions(
        transaction_type, source_voucher_type, source_voucher_id, branch_id, agent_id, shipment_id, delivery_id,
        notes, original_amount, original_currency, exchange_rate_to_usd, base_amount_usd, created_by_user_id,
        company_id, cashbox_id, created_at
      ) values(
        'inflow', 'receipt', $1, $2, $3, $4, $5,
        $6, $7, $8, $9, $10, $11,
        coalesce($12, (select id from companies where is_active = true order by created_at limit 1)),
        $13, coalesce($14::timestamptz, now())
      )
      on conflict do nothing
      `,
      [
        voucher.id,
        voucher.branch_id,
        voucher.agent_id,
        voucher.shipment_id,
        voucher.delivery_id,
        voucher.notes ?? 'Receipt voucher cash impact',
        voucher.original_amount,
        voucher.original_currency,
        voucher.exchange_rate_to_usd,
        voucher.base_amount_usd,
        voucher.created_by_user_id,
        voucher.company_id ?? null,
        voucher.cashbox_id ?? null,
        voucher.created_at ?? null,
      ],
    );

    if (voucher.cashbox_id) {
      await this.applyCashboxBalanceDelta(client, voucher.cashbox_id, voucher.original_currency, Number(voucher.original_amount));
    }

    const partyType = voucher.customer_id ? 'customer' : voucher.sender_receiver_id ? 'sender_receiver' : voucher.agent_id ? 'agent' : null;
    const partyId = voucher.customer_id || voucher.sender_receiver_id || voucher.agent_id;

    if (partyType && partyId) {
      await client.query(
        `
        insert into party_financial_movements(
          party_type, party_id, movement_type, voucher_type, voucher_id, shipment_id, delivery_id,
          branch_id, agent_id, direction, notes, original_amount, original_currency, exchange_rate_to_usd,
          base_amount_usd, created_by_user_id,
          reference_type, reference_id, reference_no, debit_amount, credit_amount,
          currency_code, exchange_rate, cashbox_id, payment_method, posted_at
        ) values(
          $1, $2, 'voucher_receipt', 'receipt', $3, $4, $5,
          $6, $7, 'credit', $8, $9, $10, $11,
          $12, $13,
          case when $4::uuid is not null then 'SHIPMENT' else 'RECEIPT' end,
          coalesce($4::uuid, $3::uuid), $14, 0, $9,
          $10, $11, $15, 'cash', now()
        )
        on conflict do nothing
        `,
        [
          partyType,
          partyId,
          voucher.id,
          voucher.shipment_id,
          voucher.delivery_id,
          voucher.branch_id,
          voucher.agent_id,
          voucher.notes ?? 'Receipt movement',
          voucher.original_amount,
          voucher.original_currency,
          voucher.exchange_rate_to_usd,
          voucher.base_amount_usd,
          voucher.created_by_user_id,
          voucher.voucher_no,
          voucher.cashbox_id ?? null,
        ],
      );
    }
  }

  private async insertCashboxAndMovementForPayment(client: any, voucher: any) {
    await client.query(
      `
      insert into cashbox_transactions(
        transaction_type, source_voucher_type, source_voucher_id, branch_id, agent_id, shipment_id, delivery_id,
        notes, original_amount, original_currency, exchange_rate_to_usd, base_amount_usd, created_by_user_id,
        company_id, cashbox_id
      ) values(
        'outflow', 'payment', $1, $2, $3, $4, $5,
        $6, $7, $8, $9, $10, $11,
        coalesce($12, (select id from companies where is_active = true order by created_at limit 1)),
        $13
      )
      on conflict do nothing
      `,
      [
        voucher.id,
        voucher.branch_id,
        voucher.agent_id,
        voucher.shipment_id,
        voucher.delivery_id,
        voucher.notes ?? 'Payment voucher cash impact',
        voucher.original_amount,
        voucher.original_currency,
        voucher.exchange_rate_to_usd,
        voucher.base_amount_usd,
        voucher.created_by_user_id,
        voucher.company_id ?? null,
        voucher.cashbox_id ?? null,
      ],
    );

    if (voucher.cashbox_id) {
      await this.applyCashboxBalanceDelta(
        client,
        voucher.cashbox_id,
        voucher.original_currency,
        -Number(voucher.original_amount),
      );
    }

    const partyType = voucher.customer_id ? 'customer' : voucher.sender_receiver_id ? 'sender_receiver' : voucher.agent_id ? 'agent' : null;
    const partyId = voucher.customer_id || voucher.sender_receiver_id || voucher.agent_id;

    if (partyType && partyId) {
      await client.query(
        `
        insert into party_financial_movements(
          party_type, party_id, movement_type, voucher_type, voucher_id, shipment_id, delivery_id,
          branch_id, agent_id, direction, notes, original_amount, original_currency, exchange_rate_to_usd,
          base_amount_usd, created_by_user_id
        ) values(
          $1, $2, 'voucher_payment', 'payment', $3, $4, $5,
          $6, $7, 'outflow', $8, $9, $10, $11,
          $12, $13
        )
        on conflict do nothing
        `,
        [
          partyType,
          partyId,
          voucher.id,
          voucher.shipment_id,
          voucher.delivery_id,
          voucher.branch_id,
          voucher.agent_id,
          voucher.notes ?? 'Payment movement',
          voucher.original_amount,
          voucher.original_currency,
          voucher.exchange_rate_to_usd,
          voucher.base_amount_usd,
          voucher.created_by_user_id,
        ],
      );
    }
  }

  private reverseDirection(direction: 'debit' | 'credit' | 'inflow' | 'outflow') {
    if (direction === 'inflow') return 'outflow';
    if (direction === 'outflow') return 'inflow';
    if (direction === 'debit') return 'credit';
    return 'debit';
  }

  private reverseCashboxType(transactionType: 'inflow' | 'outflow') {
    return transactionType === 'inflow' ? 'outflow' : 'inflow';
  }

  private async createVoucherReversalEntries(client: any, voucherType: 'receipt' | 'payment', voucher: any, reason: string) {
    const cashboxOriginals = await client.query(
      `
      select *
      from cashbox_transactions
      where source_voucher_type = $1
        and source_voucher_id = $2
        and is_reversal = false
      `,
      [voucherType, voucher.id],
    );

    for (const row of cashboxOriginals.rows) {
      await client.query(
        `
        insert into cashbox_transactions(
          transaction_type, source_voucher_type, source_voucher_id, branch_id, agent_id, shipment_id, delivery_id,
          notes, original_amount, original_currency, exchange_rate_to_usd, base_amount_usd, created_by_user_id,
          is_reversal, reversal_of_cashbox_transaction_id, company_id, cashbox_id
        )
        values(
          $1, $2, $3, $4, $5, $6, $7,
          $8, $9, $10, $11, $12, $13,
          true, $14,
          coalesce($15, (select id from companies where is_active = true order by created_at limit 1)),
          $16
        )
        on conflict do nothing
        `,
        [
          this.reverseCashboxType(row.transaction_type),
          row.source_voucher_type,
          row.source_voucher_id,
          row.branch_id,
          row.agent_id,
          row.shipment_id,
          row.delivery_id,
          `Reversal: ${reason}`,
          row.original_amount,
          row.original_currency,
          row.exchange_rate_to_usd,
          row.base_amount_usd,
          voucher.created_by_user_id,
          row.id,
          row.company_id ?? null,
          row.cashbox_id ?? null,
        ],
      );

      if (row.cashbox_id) {
        const amt = Number(row.original_amount);
        const balDelta = row.transaction_type === 'inflow' ? -amt : amt;
        await this.applyCashboxBalanceDelta(client, row.cashbox_id, row.original_currency, balDelta);
      }
    }

    const partyOriginals = await client.query(
      `
      select *
      from party_financial_movements
      where voucher_type = $1
        and voucher_id = $2
        and is_reversal = false
      `,
      [voucherType, voucher.id],
    );

    for (const row of partyOriginals.rows) {
      await client.query(
        `
        insert into party_financial_movements(
          party_type, party_id, movement_type, voucher_type, voucher_id, shipment_id, delivery_id,
          branch_id, agent_id, direction, notes, original_amount, original_currency, exchange_rate_to_usd,
          base_amount_usd, created_by_user_id, is_reversal, reversal_of_movement_id
        )
        values(
          $1, $2, $3, $4, $5, $6, $7,
          $8, $9, $10, $11, $12, $13, $14,
          $15, $16, true, $17
        )
        on conflict do nothing
        `,
        [
          row.party_type,
          row.party_id,
          row.movement_type,
          row.voucher_type,
          row.voucher_id,
          row.shipment_id,
          row.delivery_id,
          row.branch_id,
          row.agent_id,
          this.reverseDirection(row.direction),
          `Reversal: ${reason}`,
          row.original_amount,
          row.original_currency,
          row.exchange_rate_to_usd,
          row.base_amount_usd,
          voucher.created_by_user_id,
          row.id,
        ],
      );
    }
  }

  async createReceiptVoucherWithClient(client: PoolClient, input: ReceiptVoucherInput) {
    const effectiveRate = input.exchangeRateToUsd ?? 1;
    const created = await client.query(
      `
      insert into receipt_vouchers(
        voucher_no, branch_id, agent_id, shipment_id, delivery_id, customer_id, sender_receiver_id,
        related_entity_type, related_entity_id, status, notes, original_amount, original_currency,
        exchange_rate_to_usd, base_amount_usd, created_by_user_id, company_id, cashbox_id, created_at, updated_at
      ) values(
        $1,$2,$3,$4,$5,$6,$7,
        $8,$9,$10,$11,$12,$13,
        $14,$15,$16,
        coalesce($17::uuid, (select id from companies where is_active = true order by created_at asc limit 1)),
        $18, coalesce($19::timestamptz, now()), now()
      )
      returning *
      `,
      [
        input.voucherNo,
        input.branchId ?? null,
        input.agentId ?? null,
        input.shipmentId ?? null,
        input.deliveryId ?? null,
        input.customerId ?? null,
        input.senderReceiverId ?? null,
        input.relatedEntityType ?? null,
        input.relatedEntityId ?? null,
        input.status,
        input.notes ?? null,
        input.originalAmount,
        input.originalCurrency,
        effectiveRate,
        input.baseAmountUsd ?? Number((input.originalAmount * effectiveRate).toFixed(2)),
        input.createdByUserId ?? null,
        input.companyId ?? null,
        input.cashboxId ?? null,
        input.createdAt ?? null,
      ],
    );
    const voucher = created.rows[0];
    if (voucher.status === 'confirmed') {
      await this.insertCashboxAndMovementForReceipt(client, voucher);
    }
    return voucher;
  }

  async createReceiptVoucher(input: ReceiptVoucherInput) {
    const client = await pool.connect();
    try {
      await client.query('begin');
      const voucher = await this.createReceiptVoucherWithClient(client, input);
      await client.query('commit');
      return voucher;
    } catch (error: any) {
      await client.query('rollback');
      if (error?.code === '23505' && String(error?.detail || '').includes('delivery_id')) {
        throw new HttpError(409, 'Receipt voucher already generated for this delivery.');
      }
      throw error;
    } finally {
      client.release();
    }
  }

  async insertShipmentChargeMovement(
    client: PoolClient,
    input: {
      partyType: 'customer' | 'sender_receiver' | 'agent';
      partyId: string;
      shipmentId: string;
      branchId: string | null;
      agentId: string | null;
      amount: number;
      currency: string;
      exchangeRateToUsd: number;
      baseAmountUsd: number;
      notes: string;
      createdByUserId: string | null;
      shipmentNo: string;
    },
  ) {
    await client.query(
      `
      insert into party_financial_movements(
        party_type, party_id, movement_type, voucher_type, voucher_id, shipment_id,
        branch_id, agent_id, direction, notes, original_amount, original_currency,
        exchange_rate_to_usd, base_amount_usd, created_by_user_id,
        reference_type, reference_id, reference_no,
        debit_amount, credit_amount, currency_code, exchange_rate, posted_at
      ) values (
        $1, $2, 'shipment_charge', null, null, $3,
        $4, $5, 'debit', $6, $7, $8,
        $9, $10, $11,
        'SHIPMENT', $3, $12,
        $7, 0, $8, $9, now()
      )
      `,
      [
        input.partyType,
        input.partyId,
        input.shipmentId,
        input.branchId,
        input.agentId,
        input.notes,
        input.amount,
        input.currency,
        input.exchangeRateToUsd,
        input.baseAmountUsd,
        input.createdByUserId,
        input.shipmentNo,
      ],
    );
  }

  async insertShipmentBreakdownMovements(
    client: PoolClient,
    input: {
      partyType: 'customer' | 'sender_receiver' | 'agent';
      partyId: string;
      shipmentId: string;
      branchId: string | null;
      agentId: string | null;
      currency: string;
      exchangeRateToUsd: number;
      createdByUserId: string | null;
      shipmentNo: string;
      senderName?: string | null;
      breakdown: ShipmentFinancialBreakdown;
    },
  ) {
    const metadata = buildShipmentBreakdownMetadata(input.breakdown);
    const components = [
      {
        movementType: 'shipment_shipping_fee' as ShipmentComponentMovementType,
        amount: input.breakdown.companyShippingFee,
        notes: `أجور شحن للشركة — الشحنة رقم ${input.shipmentNo}`,
      },
      {
        movementType: 'sender_collection_trust' as ShipmentComponentMovementType,
        amount: input.breakdown.senderCollectionAmount,
        notes: `تحصيل لصالح المرسل${input.senderName ? ` ${input.senderName}` : ''} — الشحنة رقم ${input.shipmentNo}`,
      },
      {
        movementType: 'loading_dues' as ShipmentComponentMovementType,
        amount: input.breakdown.loadingDuesAmount,
        notes: `مستحقات تحميل / إضافي — الشحنة رقم ${input.shipmentNo}`,
      },
      {
        movementType: 'shipment_hawala_trust' as ShipmentComponentMovementType,
        amount: input.breakdown.hawalaAmount,
        notes: `أصل حوالة بعهدة الوكيل — الشحنة رقم ${input.shipmentNo}`,
      },
      {
        movementType: 'shipment_transfer_service_fee' as ShipmentComponentMovementType,
        amount: input.breakdown.transferServiceFeeAmount,
        notes: `أجرة خدمة حوالة مرتبطة بالشحنة — الشحنة رقم ${input.shipmentNo}`,
      },
      {
        movementType: 'general_collection' as ShipmentComponentMovementType,
        amount: input.breakdown.generalCollectionAmount,
        notes: `تحصيل إضافي — الشحنة رقم ${input.shipmentNo}`,
      },
    ].filter((component) => component.amount > 0);

    for (const component of components) {
      const baseAmountUsd = Number((component.amount * input.exchangeRateToUsd).toFixed(2));
      await client.query(
        `
        insert into party_financial_movements(
          party_type, party_id, movement_type, voucher_type, voucher_id, shipment_id,
          branch_id, agent_id, direction, notes, original_amount, original_currency,
          exchange_rate_to_usd, base_amount_usd, created_by_user_id,
          reference_type, reference_id, reference_no,
          debit_amount, credit_amount, currency_code, exchange_rate, posted_at, metadata
        ) values (
          $1, $2, $3, null, null, $4,
          $5, $6, 'debit', $7, $8, $9,
          $10, $11, $12,
          'SHIPMENT', $4, $13,
          $8, 0, $9, $10, now(), $14::jsonb
        )
        on conflict do nothing
        `,
        [
          input.partyType,
          input.partyId,
          component.movementType,
          input.shipmentId,
          input.branchId,
          input.agentId,
          component.notes,
          component.amount,
          input.currency,
          input.exchangeRateToUsd,
          baseAmountUsd,
          input.createdByUserId,
          input.shipmentNo,
          JSON.stringify({ ...metadata, component: component.movementType }),
        ],
      );
    }
  }

  async listPartyMovementsForShipment(shipmentId: string, scope?: DataScope) {
    const scoped = buildScopeWhere(scope, 2, 'pfm', true);
    const values: unknown[] = [shipmentId, ...scoped.values];
    const conditions: string[] = ['pfm.shipment_id = $1', ...scoped.conditions];
    const whereClause = conditions.length ? `where ${conditions.join(' and ')}` : '';
    const result = await pool.query(
      `
      select pfm.* from party_financial_movements pfm
      ${whereClause}
      order by pfm.created_at asc, pfm.id asc
      `,
      values,
    );
    return result.rows;
  }

  async updateReceiptVoucher(id: string, payload: Partial<ReceiptVoucherInput>, scope?: DataScope) {
    const existing = await this.getReceiptVoucherById(id, scope);
    if (!existing) return null;

    let nextCashboxId = existing.cashbox_id as string | null | undefined;
    if (existing.status === 'draft' && payload.cashboxId !== undefined) {
      nextCashboxId = payload.cashboxId ?? null;
    }

    const client = await pool.connect();
    try {
      await client.query('begin');
      const expectsUpdatedAt = Boolean(payload.expectedUpdatedAt);
      const updated = await client.query(
        `
        update receipt_vouchers
        set
          status = coalesce($2, status),
          notes = coalesce($3, notes),
          original_amount = coalesce($4, original_amount),
          original_currency = coalesce($5, original_currency),
          exchange_rate_to_usd = coalesce($6, exchange_rate_to_usd),
          base_amount_usd = coalesce($7, base_amount_usd),
          cashbox_id = $10,
          updated_at = now()
        where id = $1
          and (
            $8::boolean = false
            or date_trunc('milliseconds', updated_at) = date_trunc('milliseconds', $9::timestamptz)
          )
        returning *
        `,
        [
          id,
          payload.status ?? null,
          payload.notes ?? null,
          payload.originalAmount ?? null,
          payload.originalCurrency ?? null,
          payload.exchangeRateToUsd ?? null,
          payload.baseAmountUsd ?? null,
          expectsUpdatedAt,
          payload.expectedUpdatedAt ?? null,
          nextCashboxId ?? null,
        ],
      );
      const voucher = updated.rows[0];
      const movedToConfirmed = existing.status !== 'confirmed' && voucher.status === 'confirmed';
      const movedToCancelled = existing.status === 'confirmed' && voucher.status === 'cancelled';
      if (movedToConfirmed) {
        await this.insertCashboxAndMovementForReceipt(client, voucher);
      }
      if (movedToCancelled) {
        await this.createVoucherReversalEntries(client, 'receipt', voucher, `Receipt voucher ${voucher.voucher_no} cancelled`);
      }
      await client.query('commit');
      return voucher;
    } catch (error) {
      await client.query('rollback');
      throw error;
    } finally {
      client.release();
    }
  }

  async updateReceiptVoucherWithClient(client: PoolClient, id: string, payload: Partial<ReceiptVoucherInput>) {
    const existingResult = await client.query(
      `
      select * from receipt_vouchers
      where id = $1
      for update
      `,
      [id],
    );
    const existing = existingResult.rows[0];
    if (!existing) return null;

    let nextCashboxId = existing.cashbox_id as string | null | undefined;
    if (existing.status === 'draft' && payload.cashboxId !== undefined) {
      nextCashboxId = payload.cashboxId ?? null;
    }

    const expectsUpdatedAt = Boolean(payload.expectedUpdatedAt);
    const updated = await client.query(
      `
      update receipt_vouchers
      set
        status = coalesce($2, status),
        notes = coalesce($3, notes),
        original_amount = coalesce($4, original_amount),
        original_currency = coalesce($5, original_currency),
        exchange_rate_to_usd = coalesce($6, exchange_rate_to_usd),
        base_amount_usd = coalesce($7, base_amount_usd),
        cashbox_id = $10,
        updated_at = now()
      where id = $1
        and (
          $8::boolean = false
          or date_trunc('milliseconds', updated_at) = date_trunc('milliseconds', $9::timestamptz)
        )
      returning *
      `,
      [
        id,
        payload.status ?? null,
        payload.notes ?? null,
        payload.originalAmount ?? null,
        payload.originalCurrency ?? null,
        payload.exchangeRateToUsd ?? null,
        payload.baseAmountUsd ?? null,
        expectsUpdatedAt,
        payload.expectedUpdatedAt ?? null,
        nextCashboxId ?? null,
      ],
    );
    const voucher = updated.rows[0];
    const movedToConfirmed = existing.status !== 'confirmed' && voucher.status === 'confirmed';
    const movedToCancelled = existing.status === 'confirmed' && voucher.status === 'cancelled';
    if (movedToConfirmed) {
      await this.insertCashboxAndMovementForReceipt(client, voucher);
    }
    if (movedToCancelled) {
      await this.createVoucherReversalEntries(client, 'receipt', voucher, `Receipt voucher ${voucher.voucher_no} cancelled`);
    }
    return voucher;
  }

  async createPaymentVoucherWithClient(client: PoolClient, input: PaymentVoucherInput) {
    const effectiveRate = input.exchangeRateToUsd ?? 1;
    const created = await client.query(
      `
      insert into payment_vouchers(
        voucher_no, branch_id, agent_id, shipment_id, delivery_id, customer_id, sender_receiver_id,
        related_entity_type, related_entity_id, status, notes, original_amount, original_currency,
        exchange_rate_to_usd, base_amount_usd, created_by_user_id, company_id, cashbox_id
      ) values(
        $1,$2,$3,$4,$5,$6,$7,
        $8,$9,$10,$11,$12,$13,
        $14,$15,$16,
        coalesce($17, (select id from companies where is_active = true order by created_at limit 1)),
        $18
      )
      returning *
      `,
      [
        input.voucherNo,
        input.branchId ?? null,
        input.agentId ?? null,
        input.shipmentId ?? null,
        input.deliveryId ?? null,
        input.customerId ?? null,
        input.senderReceiverId ?? null,
        input.relatedEntityType ?? null,
        input.relatedEntityId ?? null,
        input.status,
        input.notes ?? null,
        input.originalAmount,
        input.originalCurrency,
        effectiveRate,
        input.baseAmountUsd ?? Number((input.originalAmount * effectiveRate).toFixed(2)),
        input.createdByUserId ?? null,
        input.companyId ?? null,
        input.cashboxId ?? null,
      ],
    );
    const voucher = created.rows[0];
    if (voucher.status === 'confirmed') {
      await this.insertCashboxAndMovementForPayment(client, voucher);
    }
    return voucher;
  }

  async createPaymentVoucher(input: PaymentVoucherInput) {
    const client = await pool.connect();
    try {
      await client.query('begin');
      const voucher = await this.createPaymentVoucherWithClient(client, input);
      await client.query('commit');
      return voucher;
    } catch (error) {
      await client.query('rollback');
      throw error;
    } finally {
      client.release();
    }
  }

  async updatePaymentVoucher(id: string, payload: Partial<PaymentVoucherInput>, scope?: DataScope) {
    const existing = await this.getPaymentVoucherById(id, scope);
    if (!existing) return null;

    let nextCashboxId = existing.cashbox_id as string | null | undefined;
    if (existing.status === 'draft' && payload.cashboxId !== undefined) {
      nextCashboxId = payload.cashboxId ?? null;
    }

    const client = await pool.connect();
    try {
      await client.query('begin');
      const expectsUpdatedAt = Boolean(payload.expectedUpdatedAt);
      const updated = await client.query(
        `
        update payment_vouchers
        set
          status = coalesce($2, status),
          notes = coalesce($3, notes),
          original_amount = coalesce($4, original_amount),
          original_currency = coalesce($5, original_currency),
          exchange_rate_to_usd = coalesce($6, exchange_rate_to_usd),
          base_amount_usd = coalesce($7, base_amount_usd),
          cashbox_id = $10,
          updated_at = now()
        where id = $1
          and (
            $8::boolean = false
            or date_trunc('milliseconds', updated_at) = date_trunc('milliseconds', $9::timestamptz)
          )
        returning *
        `,
        [
          id,
          payload.status ?? null,
          payload.notes ?? null,
          payload.originalAmount ?? null,
          payload.originalCurrency ?? null,
          payload.exchangeRateToUsd ?? null,
          payload.baseAmountUsd ?? null,
          expectsUpdatedAt,
          payload.expectedUpdatedAt ?? null,
          nextCashboxId ?? null,
        ],
      );
      const voucher = updated.rows[0];
      const movedToConfirmed = existing.status !== 'confirmed' && voucher.status === 'confirmed';
      const movedToCancelled = existing.status === 'confirmed' && voucher.status === 'cancelled';
      if (movedToConfirmed) {
        await this.insertCashboxAndMovementForPayment(client, voucher);
      }
      if (movedToCancelled) {
        await this.createVoucherReversalEntries(client, 'payment', voucher, `Payment voucher ${voucher.voucher_no} cancelled`);
      }
      await client.query('commit');
      return voucher;
    } finally {
      client.release();
    }
  }

  async updatePaymentVoucherWithClient(client: PoolClient, id: string, payload: Partial<PaymentVoucherInput>) {
    const existingResult = await client.query(`select * from payment_vouchers where id = $1 for update`, [id]);
    const existing = existingResult.rows[0];
    if (!existing) return null;

    let nextCashboxId = existing.cashbox_id as string | null | undefined;
    if (existing.status === 'draft' && payload.cashboxId !== undefined) {
      nextCashboxId = payload.cashboxId ?? null;
    }
    const updated = await client.query(
      `
      update payment_vouchers
      set status = coalesce($2, status),
          notes = coalesce($3, notes),
          original_amount = coalesce($4, original_amount),
          original_currency = coalesce($5, original_currency),
          exchange_rate_to_usd = coalesce($6, exchange_rate_to_usd),
          base_amount_usd = coalesce($7, base_amount_usd),
          cashbox_id = $8,
          updated_at = now()
      where id = $1
      returning *
      `,
      [
        id,
        payload.status ?? null,
        payload.notes ?? null,
        payload.originalAmount ?? null,
        payload.originalCurrency ?? null,
        payload.exchangeRateToUsd ?? null,
        payload.baseAmountUsd ?? null,
        nextCashboxId ?? null,
      ],
    );
    const voucher = updated.rows[0];
    if (existing.status !== 'confirmed' && voucher.status === 'confirmed') {
      await this.insertCashboxAndMovementForPayment(client, voucher);
    }
    if (existing.status === 'confirmed' && voucher.status === 'cancelled') {
      await this.createVoucherReversalEntries(client, 'payment', voucher, `Payment voucher ${voucher.voucher_no} cancelled`);
    }
    return voucher;
  }

  async autoGenerateReceiptFromDelivery(deliveryId: string, createdByUserId?: string, options?: AutoGenerateOptions) {
    const client = await pool.connect();
    try {
      await client.query('begin');
      const deliveryResult = await client.query(
        `
        select d.*, s.sender_id, s.receiver_id
        from deliveries d
        join shipments s on s.id = d.shipment_id
        where d.id = $1
        for update
        `,
        [deliveryId],
      );
      if (!deliveryResult.rowCount) {
        throw new HttpError(404, 'Delivery not found for auto-generation.');
      }
      const delivery = deliveryResult.rows[0];

      if (delivery.status !== 'delivered') {
        throw new HttpError(400, 'Delivery must be delivered before receipt auto-generation.');
      }

      const existing = await client.query(
        `select * from receipt_vouchers where delivery_id = $1 and status <> 'cancelled'`,
        [deliveryId],
      );
      if (existing.rowCount) {
        if (options?.throwOnDuplicate) {
          throw new HttpError(409, 'Receipt voucher already exists for this delivery.');
        }
        await client.query('commit');
        return { created: false, voucher: existing.rows[0] };
      }

      const voucherNo = `RV-AUTO-${new Date().getFullYear()}-${String(Date.now()).slice(-7)}`;
      const companyIdForBox =
        delivery.company_id ??
        (await client.query(`select id from companies where is_active = true order by created_at asc limit 1`)).rows[0]?.id;
      const resolvedCashboxId = await this.resolveDefaultCashboxForAutoReceipt(
        client,
        companyIdForBox,
        delivery.agent_id,
        delivery.original_currency,
      );
      const inserted = await client.query(
        `
        insert into receipt_vouchers(
          voucher_no, branch_id, agent_id, shipment_id, delivery_id, sender_receiver_id,
          related_entity_type, related_entity_id, status, notes, original_amount, original_currency,
          exchange_rate_to_usd, base_amount_usd, created_by_user_id, company_id, cashbox_id
        ) values(
          $1,$2,$3,$4,$5,$6,
          'delivery',$5,'confirmed',$7,$8,$9,
          $10,$11,$12,
          coalesce($13::uuid, (select id from companies where is_active = true order by created_at asc limit 1)),
          $14
        )
        returning *
        `,
        [
          voucherNo,
          delivery.branch_id,
          delivery.agent_id,
          delivery.shipment_id,
          delivery.id,
          delivery.receiver_id,
          `Auto-generated from delivery ${delivery.delivery_no}`,
          delivery.original_amount,
          delivery.original_currency,
          delivery.exchange_rate_to_usd,
          delivery.base_amount_usd,
          createdByUserId ?? delivery.operator_user_id ?? null,
          delivery.company_id ?? null,
          resolvedCashboxId,
        ],
      );
      const voucher = inserted.rows[0];
      await this.insertCashboxAndMovementForReceipt(client, voucher);

      await client.query('commit');
      return { created: true, voucher };
    } catch (error) {
      await client.query('rollback');
      throw error;
    } finally {
      client.release();
    }
  }
}
