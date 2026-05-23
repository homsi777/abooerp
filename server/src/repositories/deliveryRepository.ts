import { pool } from '../db/pool.js';
import type { DataScope } from '../utils/scope.js';

export interface DeliveryCreateInput {
  deliveryNo: string;
  shipmentId: string;
  branchId?: string;
  agentId?: string;
  operatorUserId?: string;
  status: 'pending' | 'delivered' | 'failed' | 'returned';
  recipientName?: string;
  receivedAt?: string;
  notes?: string;
  originalAmount: number;
  originalCurrency: 'USD' | 'SYP' | 'TRY';
  exchangeRateToUsd: number;
  baseAmountUsd: number;
  companyId?: string;
  expectedUpdatedAt?: string;
}

export class DeliveryRepository {
  async list(scope?: DataScope) {
    if (scope?.financeAgentScope && scope.companyId && scope.agentId && scope.userId) {
      const result = await pool.query(
        `
        select d.*
        from deliveries d
        join shipments s on s.id = d.shipment_id and s.deleted_at is null
        where d.deleted_at is null
          and d.company_id = $1
          and (
            d.agent_id = $2
            or s.agent_id = $2
            or s.created_by = $3
          )
        order by d.created_at desc
        `,
        [scope.companyId, scope.agentId, scope.userId],
      );
      return result.rows;
    }

    const conditions: string[] = ['deleted_at is null'];
    const values: unknown[] = [];

    if (scope?.companyId) {
      values.push(scope.companyId);
      conditions.push(`company_id = $${values.length}`);
    }
    if (scope?.branchId) {
      values.push(scope.branchId);
      conditions.push(`branch_id = $${values.length}`);
    }
    if (scope?.agentId) {
      values.push(scope.agentId);
      conditions.push(`agent_id = $${values.length}`);
    }

    const result = await pool.query(
      `select * from deliveries where ${conditions.join(' and ')} order by created_at desc`,
      values,
    );
    return result.rows;
  }

  async getById(id: string, scope?: DataScope) {
    if (scope?.financeAgentScope && scope.companyId && scope.agentId && scope.userId) {
      const result = await pool.query(
        `
        select d.*
        from deliveries d
        join shipments s on s.id = d.shipment_id and s.deleted_at is null
        where d.id = $1
          and d.deleted_at is null
          and d.company_id = $2
          and (
            d.agent_id = $3
            or s.agent_id = $3
            or s.created_by = $4
          )
        `,
        [id, scope.companyId, scope.agentId, scope.userId],
      );
      return result.rows[0] ?? null;
    }

    const conditions = ['id = $1', 'deleted_at is null'];
    const values: unknown[] = [id];

    if (scope?.companyId) {
      values.push(scope.companyId);
      conditions.push(`company_id = $${values.length}`);
    }
    if (scope?.branchId) {
      values.push(scope.branchId);
      conditions.push(`branch_id = $${values.length}`);
    }
    if (scope?.agentId) {
      values.push(scope.agentId);
      conditions.push(`agent_id = $${values.length}`);
    }

    const result = await pool.query(
      `select * from deliveries where ${conditions.join(' and ')}`,
      values,
    );
    return result.rows[0] ?? null;
  }

  async create(input: DeliveryCreateInput) {
    const client = await pool.connect();
    try {
      await client.query('begin');

      const result = await client.query(
        `
        insert into deliveries(
          delivery_no, shipment_id, branch_id, agent_id, operator_user_id, status, recipient_name,
          received_at, notes, original_amount, original_currency, exchange_rate_to_usd, base_amount_usd,
          company_id
        )
        values($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)
        returning *
        `,
        [
          input.deliveryNo,
          input.shipmentId,
          input.branchId ?? null,
          input.agentId ?? null,
          input.operatorUserId ?? null,
          input.status,
          input.recipientName ?? null,
          input.receivedAt ?? null,
          input.notes ?? null,
          input.originalAmount,
          input.originalCurrency,
          input.exchangeRateToUsd,
          input.baseAmountUsd,
          input.companyId ?? null,
        ],
      );

      if (input.status === 'delivered') {
        const prev = await client.query(
          'select status from shipments where id = $1 and deleted_at is null for update',
          [input.shipmentId],
        );
        const previousStatus = String(prev.rows[0]?.status ?? 'UNKNOWN');
        await client.query(
          "update shipments set status = 'DELIVERED', updated_at = now() where id = $1 and deleted_at is null",
          [input.shipmentId],
        );
        await client.query(
          `
          insert into shipment_status_history(
            shipment_id, status, previous_status, next_status, note, changed_by, source, metadata
          ) values($1, $2, $3, $2, $4, $5, $6, $7::jsonb)
          `,
          [
            input.shipmentId,
            'DELIVERED',
            previousStatus,
            'Delivery marked delivered',
            input.operatorUserId ?? null,
            'delivery.create',
            JSON.stringify({ deliveryStatus: input.status }),
          ],
        );
      }

      await client.query('commit');
      return result.rows[0];
    } catch (error) {
      await client.query('rollback');
      throw error;
    } finally {
      client.release();
    }
  }

  async update(id: string, input: Partial<DeliveryCreateInput>) {
    const client = await pool.connect();
    try {
      await client.query('begin');

      const expectsUpdatedAt = Boolean(input.expectedUpdatedAt);
      const result = await client.query(
        `
        update deliveries
        set
          branch_id = coalesce($2, branch_id),
          agent_id = coalesce($3, agent_id),
          operator_user_id = coalesce($4, operator_user_id),
          status = coalesce($5, status),
          recipient_name = coalesce($6, recipient_name),
          received_at = coalesce($7, received_at),
          notes = coalesce($8, notes),
          original_amount = coalesce($9, original_amount),
          original_currency = coalesce($10, original_currency),
          exchange_rate_to_usd = coalesce($11, exchange_rate_to_usd),
          base_amount_usd = coalesce($12, base_amount_usd),
          updated_at = now()
        where id = $1
          and deleted_at is null
          and (
            $13::boolean = false
            or date_trunc('milliseconds', updated_at) = date_trunc('milliseconds', $14::timestamptz)
          )
        returning *
        `,
        [
          id,
          input.branchId ?? null,
          input.agentId ?? null,
          input.operatorUserId ?? null,
          input.status ?? null,
          input.recipientName ?? null,
          input.receivedAt ?? null,
          input.notes ?? null,
          input.originalAmount ?? null,
          input.originalCurrency ?? null,
          input.exchangeRateToUsd ?? null,
          input.baseAmountUsd ?? null,
          expectsUpdatedAt,
          input.expectedUpdatedAt ?? null,
        ],
      );

      const updated = result.rows[0] ?? null;
      if (!updated) {
        await client.query('rollback');
        return null;
      }

      if (updated.status === 'delivered') {
        const prev = await client.query(
          'select status from shipments where id = $1 and deleted_at is null for update',
          [updated.shipment_id],
        );
        const previousStatus = String(prev.rows[0]?.status ?? 'UNKNOWN');
        await client.query(
          "update shipments set status = 'DELIVERED', updated_at = now() where id = $1 and deleted_at is null",
          [updated.shipment_id],
        );
        await client.query(
          `
          insert into shipment_status_history(
            shipment_id, status, previous_status, next_status, note, changed_by, source, metadata
          ) values($1, $2, $3, $2, $4, $5, $6, $7::jsonb)
          `,
          [
            updated.shipment_id,
            'DELIVERED',
            previousStatus,
            'Delivery updated to delivered',
            updated.operator_user_id ?? null,
            'delivery.update',
            JSON.stringify({ deliveryStatus: updated.status }),
          ],
        );
      }
      if (updated.status === 'returned') {
        const prev = await client.query(
          'select status from shipments where id = $1 and deleted_at is null for update',
          [updated.shipment_id],
        );
        const previousStatus = String(prev.rows[0]?.status ?? 'UNKNOWN');
        await client.query(
          "update shipments set status = 'RETURNED', updated_at = now() where id = $1 and deleted_at is null",
          [updated.shipment_id],
        );
        await client.query(
          `
          insert into shipment_status_history(
            shipment_id, status, previous_status, next_status, note, changed_by, source, metadata
          ) values($1, $2, $3, $2, $4, $5, $6, $7::jsonb)
          `,
          [
            updated.shipment_id,
            'RETURNED',
            previousStatus,
            'Delivery updated to returned',
            updated.operator_user_id ?? null,
            'delivery.update',
            JSON.stringify({ deliveryStatus: updated.status }),
          ],
        );
      }
      if (updated.status === 'failed') {
        const prev = await client.query(
          'select status from shipments where id = $1 and deleted_at is null for update',
          [updated.shipment_id],
        );
        const previousStatus = String(prev.rows[0]?.status ?? 'UNKNOWN');
        await client.query(
          "update shipments set status = 'RETURN_REQUESTED', updated_at = now() where id = $1 and deleted_at is null",
          [updated.shipment_id],
        );
        await client.query(
          `
          insert into shipment_status_history(
            shipment_id, status, previous_status, next_status, note, changed_by, source, metadata
          ) values($1, $2, $3, $2, $4, $5, $6, $7::jsonb)
          `,
          [
            updated.shipment_id,
            'RETURN_REQUESTED',
            previousStatus,
            'Delivery updated to failed',
            updated.operator_user_id ?? null,
            'delivery.update',
            JSON.stringify({ deliveryStatus: updated.status }),
          ],
        );
      }

      await client.query('commit');
      return updated;
    } catch (error) {
      await client.query('rollback');
      throw error;
    } finally {
      client.release();
    }
  }

  async remove(id: string, scope?: DataScope) {
    const conditions = ['id = $1', 'deleted_at is null'];
    const values: unknown[] = [id];

    if (scope?.companyId) {
      values.push(scope.companyId);
      conditions.push(`company_id = $${values.length}`);
    }

    const result = await pool.query(
      `update deliveries set deleted_at = now() where ${conditions.join(' and ')} returning id`,
      values,
    );
    return Boolean(result.rowCount);
  }
}
