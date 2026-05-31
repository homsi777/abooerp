import type { PoolClient } from 'pg';
import { pool } from '../db/pool.js';
import type { DataScope } from '../utils/scope.js';
import type { CanonicalShipmentStatus } from '../domain/shipmentStatus.js';

export interface InventoryLine {
  itemId: string;
  warehouseId: string;
  quantity: number;
}

export interface ShipmentCreateInput {
  shipmentNo: string;
  referenceNo?: string;
  customerId?: string;
  senderId: string;
  receiverId: string;
  branchId: string;
  agentId?: string;
  originCity?: string;
  destinationCity: string;
  description?: string;
  piecesCount: number;
  weightKg?: number;
  status: CanonicalShipmentStatus | 'created' | 'in_transit' | 'manifested' | 'delivered' | 'cancelled';
  originalAmount: number;
  originalCurrency: 'USD' | 'SYP' | 'TRY';
  exchangeRateToUsd: number;
  baseAmountUsd: number;
  companyId?: string;
  createdBy?: string;
  expectedUpdatedAt?: string;
  /** Optional inventory lines to reserve on creation */
  inventoryItems?: InventoryLine[];
  payerPartyKind?: 'SENDER' | 'RECEIVER' | 'CUSTOMER';
  defaultCashboxId?: string;
  /** Fee breakdown columns (migration 058) */
  freightCharge?: number;
  transferFee?: number;
  additionalCharges?: number;
  hawalaAmount?: number;
  prepaidAmount?: number;
  discountAmount?: number;
  transferServiceFee?: number;
  /** Agent commission snapshot (migration 075) */
  agentCommissionBaseType?: 'FREIGHT_CHARGE';
  agentCommissionBaseAmount?: number;
  agentCommissionPercentageSnapshot?: number;
  agentCommissionAmountSnapshot?: number;
}

export class ShipmentRepository {
  private applyScope(conditions: string[], values: unknown[], scope?: DataScope, tableAlias = '') {
    const prefix = tableAlias ? `${tableAlias}.` : '';
    if (scope?.companyId) {
      values.push(scope.companyId);
      conditions.push(`${prefix}company_id = $${values.length}`);
    }
    if (scope?.branchId && !scope?.agentId) {
      values.push(scope.branchId);
      conditions.push(`${prefix}branch_id = $${values.length}`);
    }
    // Agent user without linked agents row: only shipments they personally created.
    if (scope?.financeAgentScope && scope.userId && !scope.agentId) {
      values.push(scope.userId);
      conditions.push(`${prefix}created_by = $${values.length}`);
      return;
    }
    // Logged-in agent (mini-ERP): never treat "same branch" as enough — prevents seeing other agents' shipments.
    if (scope?.financeAgentScope && scope.agentId && scope.userId) {
      values.push(scope.agentId);
      const agentParam = `$${values.length}`;
      values.push(scope.userId);
      const userParam = `$${values.length}`;
      const destinationHints = [scope.agentArea, scope.agentCity, scope.agentGovernorate]
        .filter((v): v is string => Boolean(v && v.trim().length))
        .map((v) => v.toLowerCase().trim());

      const destClause =
        destinationHints.length > 0
          ? (() => {
              values.push(destinationHints);
              const hintParam = `$${values.length}`;
              return `(lower(coalesce(${prefix}destination_city, '')) = any(${hintParam}::text[]) and (${prefix}agent_id is null or ${prefix}agent_id = ${agentParam}))`;
            })()
          : 'false';

      conditions.push(`(${prefix}agent_id = ${agentParam} or ${prefix}created_by = ${userParam} or ${destClause})`);
      return;
    }
    if (scope?.agentId) {
      values.push(scope.agentId);
      const agentParam = `$${values.length}`;
      const destinationHints = [scope.agentArea, scope.agentCity, scope.agentGovernorate]
        .filter((v): v is string => Boolean(v && v.trim().length))
        .map((v) => v.toLowerCase().trim());

      const orParts: string[] = [`${prefix}agent_id = ${agentParam}`];
      if (scope.branchId) {
        values.push(scope.branchId);
        orParts.push(`${prefix}branch_id = $${values.length}`);
      }
      if (destinationHints.length > 0) {
        values.push(destinationHints);
        orParts.push(`lower(coalesce(${prefix}destination_city, '')) = any($${values.length}::text[])`);
      }
      conditions.push(`(${orParts.join(' or ')})`);
    }
  }

  async list(scope?: DataScope) {
    const conditions: string[] = ['s.deleted_at is null'];
    const values: unknown[] = [];
    this.applyScope(conditions, values, scope, 's');

    const result = await pool.query(
      `
      select
        s.*,
        coalesce(
          nullif(latest_driver_load.metadata->>'loadedPiecesCount', '')::integer,
          0
        ) as loaded_pieces_count,
        sender.full_name as sender_name,
        receiver.full_name as receiver_name
      from shipments s
      left join senders_receivers sender on sender.id = s.sender_id
      left join senders_receivers receiver on receiver.id = s.receiver_id
      left join lateral (
        select h.metadata
        from shipment_status_history h
        where h.shipment_id = s.id
          and h.next_status = 'HANDED_TO_DRIVER'
          and h.metadata ? 'loadedPiecesCount'
        order by h.changed_at desc
        limit 1
      ) latest_driver_load on true
      where ${conditions.join(' and ')}
      order by s.created_at desc
      `,
      values,
    );
    return result.rows;
  }

  async getById(id: string, scope?: DataScope) {
    const conditions = ['s.id = $1', 's.deleted_at is null'];
    const values: unknown[] = [id];
    this.applyScope(conditions, values, scope, 's');

    const result = await pool.query(
      `
      select
        s.*,
        coalesce(
          nullif(latest_driver_load.metadata->>'loadedPiecesCount', '')::integer,
          0
        ) as loaded_pieces_count,
        sender.full_name as sender_name,
        receiver.full_name as receiver_name
      from shipments s
      left join senders_receivers sender on sender.id = s.sender_id
      left join senders_receivers receiver on receiver.id = s.receiver_id
      left join lateral (
        select h.metadata
        from shipment_status_history h
        where h.shipment_id = s.id
          and h.next_status = 'HANDED_TO_DRIVER'
          and h.metadata ? 'loadedPiecesCount'
        order by h.changed_at desc
        limit 1
      ) latest_driver_load on true
      where ${conditions.join(' and ')}
      `,
      values,
    );
    return result.rows[0] ?? null;
  }

  async existsInCompany(id: string, companyId?: string): Promise<boolean> {
    const values: unknown[] = [id];
    const conditions = ['id = $1', 'deleted_at is null'];
    if (companyId) {
      values.push(companyId);
      conditions.push(`company_id = $${values.length}`);
    }
    const result = await pool.query(
      `select 1 from shipments where ${conditions.join(' and ')} limit 1`,
      values,
    );
    return (result.rowCount ?? 0) > 0;
  }

  async createWithClient(client: PoolClient, input: ShipmentCreateInput) {
    const result = await client.query(
      `
      insert into shipments(
        shipment_no, reference_no, customer_id, sender_id, receiver_id, branch_id, agent_id,
        origin_city, destination_city, description, pieces_count, weight_kg, status,
        original_amount, original_currency, exchange_rate_to_usd, base_amount_usd,
        company_id, created_by,
        payer_party_kind, default_cashbox_id,
        freight_charge, transfer_fee, additional_charges, hawala_amount, prepaid_amount, discount_amount, transfer_service_fee,
        agent_commission_base_type, agent_commission_base_amount,
        agent_commission_percentage_snapshot, agent_commission_amount_snapshot
      )
      values(
        $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,
        $20,$21,$22,$23,$24,$25,$26,$27,$28,$29,$30,$31,$32
      )
      returning *
      `,
      [
        input.shipmentNo,
        input.referenceNo ?? null,
        input.customerId ?? null,
        input.senderId,
        input.receiverId,
        input.branchId,
        input.agentId ?? null,
        input.originCity ?? null,
        input.destinationCity,
        input.description ?? null,
        input.piecesCount,
        input.weightKg ?? null,
        input.status,
        input.originalAmount,
        input.originalCurrency,
        input.exchangeRateToUsd,
        input.baseAmountUsd,
        input.companyId ?? null,
        input.createdBy ?? null,
        input.payerPartyKind ?? null,
        input.defaultCashboxId ?? null,
        input.freightCharge ?? input.originalAmount,
        input.transferFee ?? 0,
        input.additionalCharges ?? 0,
        input.hawalaAmount ?? 0,
        input.prepaidAmount ?? 0,
        input.discountAmount ?? 0,
        input.transferServiceFee ?? 0,
        input.agentCommissionBaseType ?? null,
        typeof input.agentCommissionBaseAmount === 'number' ? input.agentCommissionBaseAmount : null,
        typeof input.agentCommissionPercentageSnapshot === 'number' ? input.agentCommissionPercentageSnapshot : null,
        typeof input.agentCommissionAmountSnapshot === 'number' ? input.agentCommissionAmountSnapshot : null,
      ],
    );

    const created = result.rows[0];

    await client.query(
      `
      insert into shipment_status_history(
        shipment_id, status, previous_status, next_status, note, changed_by, source, metadata
      ) values($1, $2, null, $2, $3, $4, $5, $6::jsonb)
      `,
      [created.id, input.status, 'Shipment created', input.createdBy ?? null, 'shipment.create', '{}'],
    );

    return created;
  }

  async create(input: ShipmentCreateInput) {
    const client = await pool.connect();
    try {
      await client.query('begin');
      const created = await this.createWithClient(client, input);
      await client.query('commit');
      return created;
    } catch (error) {
      await client.query('rollback');
      throw error;
    } finally {
      client.release();
    }
  }

  async lockShipmentForUpdate(client: PoolClient, shipmentId: string, scope?: DataScope) {
    const where: string[] = ['id = $1', 'deleted_at is null'];
    const values: unknown[] = [shipmentId];
    this.applyScope(where, values, scope);
    const locked = await client.query(`select * from shipments where ${where.join(' and ')} for update`, values);
    return locked.rows[0] ?? null;
  }

  async update(id: string, payload: Partial<ShipmentCreateInput>) {
    const client = await pool.connect();
    try {
      await client.query('begin');

      const previous = await client.query(
        'select status from shipments where id = $1 and deleted_at is null',
        [id],
      );
      if (!previous.rowCount) {
        await client.query('rollback');
        return null;
      }
      const previousStatus = previous.rows[0].status as ShipmentCreateInput['status'];

      const expectsUpdatedAt = Boolean(payload.expectedUpdatedAt);
      const result = await client.query(
        `
        update shipments
        set
          reference_no = coalesce($2, reference_no),
          customer_id = coalesce($3, customer_id),
          sender_id = coalesce($4, sender_id),
          receiver_id = coalesce($5, receiver_id),
          branch_id = coalesce($6, branch_id),
          agent_id = coalesce($7, agent_id),
          origin_city = coalesce($8, origin_city),
          destination_city = coalesce($9, destination_city),
          description = coalesce($10, description),
          pieces_count = coalesce($11, pieces_count),
          weight_kg = coalesce($12, weight_kg),
          status = coalesce($13, status),
          original_amount = coalesce($14, original_amount),
          original_currency = coalesce($15, original_currency),
          exchange_rate_to_usd = coalesce($16, exchange_rate_to_usd),
          base_amount_usd = coalesce($17, base_amount_usd),
          updated_by = coalesce($18, updated_by),
          freight_charge = coalesce($21, freight_charge),
          transfer_fee = coalesce($22, transfer_fee),
          additional_charges = coalesce($23, additional_charges),
          prepaid_amount = coalesce($24, prepaid_amount),
          discount_amount = coalesce($25, discount_amount),
          hawala_amount = coalesce($26, hawala_amount),
          transfer_service_fee = coalesce($27, transfer_service_fee),
          agent_commission_base_type = coalesce($28, agent_commission_base_type),
          agent_commission_base_amount = coalesce($29, agent_commission_base_amount),
          agent_commission_percentage_snapshot = coalesce($30, agent_commission_percentage_snapshot),
          agent_commission_amount_snapshot = coalesce($31, agent_commission_amount_snapshot),
          updated_at = now()
        where id = $1
          and deleted_at is null
          and (
            $19::boolean = false
            or date_trunc('milliseconds', updated_at) = date_trunc('milliseconds', $20::timestamptz)
          )
        returning *
        `,
        [
          id,
          payload.referenceNo ?? null,
          payload.customerId ?? null,
          payload.senderId ?? null,
          payload.receiverId ?? null,
          payload.branchId ?? null,
          payload.agentId ?? null,
          payload.originCity ?? null,
          payload.destinationCity ?? null,
          payload.description ?? null,
          payload.piecesCount ?? null,
          payload.weightKg ?? null,
          payload.status ?? null,
          payload.originalAmount ?? null,
          payload.originalCurrency ?? null,
          payload.exchangeRateToUsd ?? null,
          payload.baseAmountUsd ?? null,
          payload.createdBy ?? null,
          expectsUpdatedAt,
          payload.expectedUpdatedAt ?? null,
          typeof payload.freightCharge === 'number' ? payload.freightCharge : null,
          typeof payload.transferFee === 'number' ? payload.transferFee : null,
          typeof payload.additionalCharges === 'number' ? payload.additionalCharges : null,
          typeof payload.hawalaAmount === 'number' ? payload.hawalaAmount : null,
          typeof payload.prepaidAmount === 'number' ? payload.prepaidAmount : null,
          typeof payload.discountAmount === 'number' ? payload.discountAmount : null,
          typeof payload.transferServiceFee === 'number' ? payload.transferServiceFee : null,
          payload.agentCommissionBaseType ?? null,
          typeof payload.agentCommissionBaseAmount === 'number' ? payload.agentCommissionBaseAmount : null,
          typeof payload.agentCommissionPercentageSnapshot === 'number' ? payload.agentCommissionPercentageSnapshot : null,
          typeof payload.agentCommissionAmountSnapshot === 'number' ? payload.agentCommissionAmountSnapshot : null,
        ],
      );

      const updated = result.rows[0] ?? null;
      if (!updated) {
        await client.query('rollback');
        return null;
      }

      const nextStatus = updated.status as ShipmentCreateInput['status'];
      if (previousStatus !== nextStatus) {
        await client.query(
          `
          insert into shipment_status_history(
            shipment_id, status, previous_status, next_status, note, changed_by, source, metadata
          )
          values($1, $2, $3, $2, $4, $5, $6, $7::jsonb)
          `,
          [
            id,
            nextStatus,
            previousStatus,
            `Status changed from ${previousStatus} to ${nextStatus}`,
            payload.createdBy ?? null,
            'shipment.update',
            '{}',
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
    this.applyScope(conditions, values, scope);

    const result = await pool.query(
      `update shipments set deleted_at = now() where ${conditions.join(' and ')} returning id`,
      values,
    );
    return Boolean(result.rowCount);
  }

  async transitionStatusCore(
    client: PoolClient,
    input: {
      shipmentId: string;
      nextStatus: CanonicalShipmentStatus;
      changedBy?: string;
      note?: string;
      source?: string;
      metadata?: Record<string, unknown>;
      scope?: DataScope;
    },
  ) {
    const where: string[] = ['id = $1', 'deleted_at is null'];
    const values: unknown[] = [input.shipmentId];
    this.applyScope(where, values, input.scope);

    const locked = await client.query(`select * from shipments where ${where.join(' and ')} for update`, values);

    if (!locked.rowCount) {
      return null;
    }

    const current = locked.rows[0];
    const previousStatus = String(current.status);

    const updated = await client.query(
      `
      update shipments
      set
        status = $2,
        updated_by = coalesce($3, updated_by),
        updated_at = now()
      where id = $1 and deleted_at is null
      returning *
      `,
      [input.shipmentId, input.nextStatus, input.changedBy ?? null],
    );

    const next = updated.rows[0];

    await client.query(
      `
      insert into shipment_status_history(
        shipment_id, status, previous_status, next_status, note, changed_by, source, metadata
      ) values($1, $2, $3, $2, $4, $5, $6, $7::jsonb)
      `,
      [
        input.shipmentId,
        input.nextStatus,
        previousStatus,
        input.note ?? null,
        input.changedBy ?? null,
        input.source ?? 'shipment.lifecycle-action',
        JSON.stringify(input.metadata ?? {}),
      ],
    );

    return { previous: current, updated: next };
  }

  async transitionStatus(input: {
    shipmentId: string;
    nextStatus: CanonicalShipmentStatus;
    changedBy?: string;
    note?: string;
    source?: string;
    metadata?: Record<string, unknown>;
    scope?: DataScope;
  }) {
    const client = await pool.connect();
    try {
      await client.query('begin');
      const result = await this.transitionStatusCore(client, input);
      if (!result) {
        await client.query('rollback');
        return null;
      }
      await client.query('commit');
      return result;
    } catch (error) {
      await client.query('rollback');
      throw error;
    } finally {
      client.release();
    }
  }

  async listStatusHistory(shipmentId: string, scope?: DataScope) {
    const conditions: string[] = ['h.shipment_id = $1'];
    const values: unknown[] = [shipmentId];
    this.applyScope(conditions, values, scope, 's');

    const result = await pool.query(
      `
      select h.*
      from shipment_status_history h
      join shipments s on s.id = h.shipment_id
      where ${conditions.join(' and ')}
      order by h.changed_at desc
      `,
      values,
    );
    return result.rows;
  }
}
