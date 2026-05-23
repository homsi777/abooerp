import { pool } from '../db/pool.js';
import { HttpError } from '../utils/errors.js';
function buildScopeWhere(scope, startIndex = 1, alias = '') {
    const values = [];
    const conditions = [];
    const prefix = alias ? `${alias}.` : '';
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
    async saveDashboardCacheMetricsState(snapshot) {
        await pool.query(`
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
      `, [
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
        ]);
    }
    async logDashboardCacheResetAudit(entry) {
        await pool.query(`
      insert into dashboard_cache_reset_audit(
        user_id, branch_id, agent_id, reset_cache, reset_metrics, confirm, outcome, reason, at
      ) values($1, $2, $3, $4, $5, $6, $7, $8, now())
      `, [
            entry.userId ?? null,
            entry.scope?.branchId ?? null,
            entry.scope?.agentId ?? null,
            entry.resetCache,
            entry.resetMetrics,
            entry.confirm,
            entry.outcome,
            entry.reason ?? null,
        ]);
    }
    async listDashboardCacheResetAudit(limit) {
        const normalizedLimit = Math.min(100, Math.max(1, limit));
        const [entries, total] = await Promise.all([
            pool.query(`
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
        `, [normalizedLimit]),
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
    async listReceiptVouchers(scope, filters) {
        const scoped = buildScopeWhere(scope, 1);
        const values = [...scoped.values];
        const conditions = [...scoped.conditions];
        if (filters?.deliveryId) {
            values.push(filters.deliveryId);
            conditions.push(`delivery_id = $${values.length}`);
        }
        const whereClause = conditions.length ? `where ${conditions.join(' and ')}` : '';
        const result = await pool.query(`select * from receipt_vouchers ${whereClause} order by created_at desc`, values);
        return result.rows;
    }
    async getReceiptVoucherById(id, scope) {
        const scoped = buildScopeWhere(scope, 2);
        const conditions = ['id = $1', ...scoped.conditions];
        const result = await pool.query(`select * from receipt_vouchers where ${conditions.join(' and ')}`, [id, ...scoped.values]);
        return result.rows[0] ?? null;
    }
    async listPaymentVouchers(scope) {
        const scoped = buildScopeWhere(scope, 1);
        const whereClause = scoped.conditions.length ? `where ${scoped.conditions.join(' and ')}` : '';
        const result = await pool.query(`select * from payment_vouchers ${whereClause} order by created_at desc`, scoped.values);
        return result.rows;
    }
    async getPaymentVoucherById(id, scope) {
        const scoped = buildScopeWhere(scope, 2);
        const conditions = ['id = $1', ...scoped.conditions];
        const result = await pool.query(`select * from payment_vouchers where ${conditions.join(' and ')}`, [id, ...scoped.values]);
        return result.rows[0] ?? null;
    }
    async listCashboxTransactions(scope) {
        const scoped = buildScopeWhere(scope, 1);
        const whereClause = scoped.conditions.length ? `where ${scoped.conditions.join(' and ')}` : '';
        const result = await pool.query(`select * from cashbox_transactions ${whereClause} order by created_at desc`, scoped.values);
        return result.rows;
    }
    async listPartyFinancialMovements(scope) {
        const scoped = buildScopeWhere(scope, 1);
        const whereClause = scoped.conditions.length ? `where ${scoped.conditions.join(' and ')}` : '';
        const result = await pool.query(`select * from party_financial_movements ${whereClause} order by created_at desc`, scoped.values);
        return result.rows;
    }
    async listPartyStatementEntries(scope, filters) {
        const scoped = buildScopeWhere(scope, 1, 'pfm');
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
        const result = await pool.query(`
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
      `, values);
        return result.rows;
    }
    async getPartyStatementSummary(scope, filters) {
        const scoped = buildScopeWhere(scope, 1, 'pfm');
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
        const result = await pool.query(`
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
      `, values);
        return result.rows[0];
    }
    async listPartyLedger(scope, filters) {
        const scoped = buildScopeWhere(scope, 1, 'pfm');
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
        const rowsResult = await pool.query(`
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
      `, values);
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
    async getPartyCurrencySummary(scope, filters) {
        const scoped = buildScopeWhere(scope, 1, 'pfm');
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
        const result = await pool.query(`
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
      `, values);
        return result.rows;
    }
    async getPartyAnalyticsSnapshot(scope, filters) {
        const scoped = buildScopeWhere(scope, 1, 'pfm');
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
            pool.query(`
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
        `, values.slice(0, -1)),
            pool.query(`
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
        order by abs(
          coalesce(sum(case when pfm.direction in ('inflow', 'debit') then pfm.base_amount_usd else 0 end), 0)
          - coalesce(sum(case when pfm.direction in ('outflow', 'credit') then pfm.base_amount_usd else 0 end), 0)
        ) desc, pfm.party_type asc, pfm.party_id asc
        limit ${topNRef}
        `, values),
            pool.query(`
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
        `, values.slice(0, -1)),
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
    async insertCashboxAndMovementForReceipt(client, voucher) {
        await client.query(`
      insert into cashbox_transactions(
        transaction_type, source_voucher_type, source_voucher_id, branch_id, agent_id, shipment_id, delivery_id,
        notes, original_amount, original_currency, exchange_rate_to_usd, base_amount_usd, created_by_user_id
      ) values(
        'inflow', 'receipt', $1, $2, $3, $4, $5,
        $6, $7, $8, $9, $10, $11
      )
      on conflict do nothing
      `, [
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
        ]);
        const partyType = voucher.customer_id ? 'customer' : voucher.sender_receiver_id ? 'sender_receiver' : voucher.agent_id ? 'agent' : null;
        const partyId = voucher.customer_id || voucher.sender_receiver_id || voucher.agent_id;
        if (partyType && partyId) {
            await client.query(`
        insert into party_financial_movements(
          party_type, party_id, movement_type, voucher_type, voucher_id, shipment_id, delivery_id,
          branch_id, agent_id, direction, notes, original_amount, original_currency, exchange_rate_to_usd,
          base_amount_usd, created_by_user_id
        ) values(
          $1, $2, 'voucher_receipt', 'receipt', $3, $4, $5,
          $6, $7, 'inflow', $8, $9, $10, $11,
          $12, $13
        )
        on conflict do nothing
        `, [
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
            ]);
        }
    }
    async insertCashboxAndMovementForPayment(client, voucher) {
        await client.query(`
      insert into cashbox_transactions(
        transaction_type, source_voucher_type, source_voucher_id, branch_id, agent_id, shipment_id, delivery_id,
        notes, original_amount, original_currency, exchange_rate_to_usd, base_amount_usd, created_by_user_id
      ) values(
        'outflow', 'payment', $1, $2, $3, $4, $5,
        $6, $7, $8, $9, $10, $11
      )
      on conflict do nothing
      `, [
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
        ]);
        const partyType = voucher.customer_id ? 'customer' : voucher.sender_receiver_id ? 'sender_receiver' : voucher.agent_id ? 'agent' : null;
        const partyId = voucher.customer_id || voucher.sender_receiver_id || voucher.agent_id;
        if (partyType && partyId) {
            await client.query(`
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
        `, [
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
            ]);
        }
    }
    reverseDirection(direction) {
        if (direction === 'inflow')
            return 'outflow';
        if (direction === 'outflow')
            return 'inflow';
        if (direction === 'debit')
            return 'credit';
        return 'debit';
    }
    reverseCashboxType(transactionType) {
        return transactionType === 'inflow' ? 'outflow' : 'inflow';
    }
    async createVoucherReversalEntries(client, voucherType, voucher, reason) {
        const cashboxOriginals = await client.query(`
      select *
      from cashbox_transactions
      where source_voucher_type = $1
        and source_voucher_id = $2
        and is_reversal = false
      `, [voucherType, voucher.id]);
        for (const row of cashboxOriginals.rows) {
            await client.query(`
        insert into cashbox_transactions(
          transaction_type, source_voucher_type, source_voucher_id, branch_id, agent_id, shipment_id, delivery_id,
          notes, original_amount, original_currency, exchange_rate_to_usd, base_amount_usd, created_by_user_id,
          is_reversal, reversal_of_cashbox_transaction_id
        )
        values(
          $1, $2, $3, $4, $5, $6, $7,
          $8, $9, $10, $11, $12, $13,
          true, $14
        )
        on conflict do nothing
        `, [
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
            ]);
        }
        const partyOriginals = await client.query(`
      select *
      from party_financial_movements
      where voucher_type = $1
        and voucher_id = $2
        and is_reversal = false
      `, [voucherType, voucher.id]);
        for (const row of partyOriginals.rows) {
            await client.query(`
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
        `, [
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
            ]);
        }
    }
    async createReceiptVoucher(input) {
        const client = await pool.connect();
        try {
            await client.query('begin');
            const effectiveRate = input.exchangeRateToUsd ?? 1;
            const created = await client.query(`
        insert into receipt_vouchers(
          voucher_no, branch_id, agent_id, shipment_id, delivery_id, customer_id, sender_receiver_id,
          related_entity_type, related_entity_id, status, notes, original_amount, original_currency,
          exchange_rate_to_usd, base_amount_usd, created_by_user_id
        ) values(
          $1,$2,$3,$4,$5,$6,$7,
          $8,$9,$10,$11,$12,$13,
          $14,$15,$16
        )
        returning *
        `, [
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
            ]);
            const voucher = created.rows[0];
            if (voucher.status === 'confirmed') {
                await this.insertCashboxAndMovementForReceipt(client, voucher);
            }
            await client.query('commit');
            return voucher;
        }
        catch (error) {
            await client.query('rollback');
            if (error?.code === '23505' && String(error?.detail || '').includes('delivery_id')) {
                throw new HttpError(409, 'Receipt voucher already generated for this delivery.');
            }
            throw error;
        }
        finally {
            client.release();
        }
    }
    async updateReceiptVoucher(id, payload, scope) {
        const existing = await this.getReceiptVoucherById(id, scope);
        if (!existing)
            return null;
        const client = await pool.connect();
        try {
            await client.query('begin');
            const expectsUpdatedAt = Boolean(payload.expectedUpdatedAt);
            const updated = await client.query(`
        update receipt_vouchers
        set
          status = coalesce($2, status),
          notes = coalesce($3, notes),
          original_amount = coalesce($4, original_amount),
          original_currency = coalesce($5, original_currency),
          exchange_rate_to_usd = coalesce($6, exchange_rate_to_usd),
          base_amount_usd = coalesce($7, base_amount_usd),
          updated_at = now()
        where id = $1
          and (
            $8::boolean = false
            or date_trunc('milliseconds', updated_at) = date_trunc('milliseconds', $9::timestamptz)
          )
        returning *
        `, [
                id,
                payload.status ?? null,
                payload.notes ?? null,
                payload.originalAmount ?? null,
                payload.originalCurrency ?? null,
                payload.exchangeRateToUsd ?? null,
                payload.baseAmountUsd ?? null,
                expectsUpdatedAt,
                payload.expectedUpdatedAt ?? null,
            ]);
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
        }
        catch (error) {
            await client.query('rollback');
            throw error;
        }
        finally {
            client.release();
        }
    }
    async createPaymentVoucher(input) {
        const client = await pool.connect();
        try {
            await client.query('begin');
            const effectiveRate = input.exchangeRateToUsd ?? 1;
            const created = await client.query(`
        insert into payment_vouchers(
          voucher_no, branch_id, agent_id, shipment_id, delivery_id, customer_id, sender_receiver_id,
          related_entity_type, related_entity_id, status, notes, original_amount, original_currency,
          exchange_rate_to_usd, base_amount_usd, created_by_user_id
        ) values(
          $1,$2,$3,$4,$5,$6,$7,
          $8,$9,$10,$11,$12,$13,
          $14,$15,$16
        )
        returning *
        `, [
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
            ]);
            const voucher = created.rows[0];
            if (voucher.status === 'confirmed') {
                await this.insertCashboxAndMovementForPayment(client, voucher);
            }
            await client.query('commit');
            return voucher;
        }
        finally {
            client.release();
        }
    }
    async updatePaymentVoucher(id, payload, scope) {
        const existing = await this.getPaymentVoucherById(id, scope);
        if (!existing)
            return null;
        const client = await pool.connect();
        try {
            await client.query('begin');
            const expectsUpdatedAt = Boolean(payload.expectedUpdatedAt);
            const updated = await client.query(`
        update payment_vouchers
        set
          status = coalesce($2, status),
          notes = coalesce($3, notes),
          original_amount = coalesce($4, original_amount),
          original_currency = coalesce($5, original_currency),
          exchange_rate_to_usd = coalesce($6, exchange_rate_to_usd),
          base_amount_usd = coalesce($7, base_amount_usd),
          updated_at = now()
        where id = $1
          and (
            $8::boolean = false
            or date_trunc('milliseconds', updated_at) = date_trunc('milliseconds', $9::timestamptz)
          )
        returning *
        `, [
                id,
                payload.status ?? null,
                payload.notes ?? null,
                payload.originalAmount ?? null,
                payload.originalCurrency ?? null,
                payload.exchangeRateToUsd ?? null,
                payload.baseAmountUsd ?? null,
                expectsUpdatedAt,
                payload.expectedUpdatedAt ?? null,
            ]);
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
        }
        finally {
            client.release();
        }
    }
    async autoGenerateReceiptFromDelivery(deliveryId, createdByUserId, options) {
        const client = await pool.connect();
        try {
            await client.query('begin');
            const deliveryResult = await client.query(`
        select d.*, s.sender_id, s.receiver_id
        from deliveries d
        join shipments s on s.id = d.shipment_id
        where d.id = $1
        for update
        `, [deliveryId]);
            if (!deliveryResult.rowCount) {
                throw new HttpError(404, 'Delivery not found for auto-generation.');
            }
            const delivery = deliveryResult.rows[0];
            if (delivery.status !== 'delivered') {
                throw new HttpError(400, 'Delivery must be delivered before receipt auto-generation.');
            }
            const existing = await client.query(`select * from receipt_vouchers where delivery_id = $1 and status <> 'cancelled'`, [deliveryId]);
            if (existing.rowCount) {
                if (options?.throwOnDuplicate) {
                    throw new HttpError(409, 'Receipt voucher already exists for this delivery.');
                }
                await client.query('commit');
                return { created: false, voucher: existing.rows[0] };
            }
            const voucherNo = `RV-AUTO-${new Date().getFullYear()}-${String(Date.now()).slice(-7)}`;
            const inserted = await client.query(`
        insert into receipt_vouchers(
          voucher_no, branch_id, agent_id, shipment_id, delivery_id, sender_receiver_id,
          related_entity_type, related_entity_id, status, notes, original_amount, original_currency,
          exchange_rate_to_usd, base_amount_usd, created_by_user_id
        ) values(
          $1,$2,$3,$4,$5,$6,
          'delivery',$5,'confirmed',$7,$8,$9,
          $10,$11,$12
        )
        returning *
        `, [
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
            ]);
            const voucher = inserted.rows[0];
            await this.insertCashboxAndMovementForReceipt(client, voucher);
            await client.query('commit');
            return { created: true, voucher };
        }
        catch (error) {
            await client.query('rollback');
            throw error;
        }
        finally {
            client.release();
        }
    }
}
