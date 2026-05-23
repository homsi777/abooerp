import { pool } from '../db/pool.js';
import type { DataScope } from '../utils/scope.js';

export interface CenterReceiptCreateInput {
  shipmentId: string;
  branchId?: string;
  agentId?: string;
  centerName: string;
  receivedByUserId?: string;
  notes?: string;
  companyId?: string;
}

export class CenterReceiptRepository {
  async list(scope?: DataScope) {
    const conditions: string[] = ['cr.deleted_at is null'];
    const values: unknown[] = [];

    if (scope?.companyId) {
      values.push(scope.companyId);
      conditions.push(`cr.company_id = $${values.length}`);
    }
    if (scope?.branchId) {
      values.push(scope.branchId);
      conditions.push(`cr.branch_id = $${values.length}`);
    }
    if (scope?.agentId) {
      values.push(scope.agentId);
      conditions.push(`cr.agent_id = $${values.length}`);
    }

    const result = await pool.query(
      `
      select cr.*
      from center_receipts cr
      where ${conditions.join(' and ')}
      order by cr.received_at desc
      `,
      values,
    );
    return result.rows;
  }

  async getActiveByShipment(shipmentId: string, scope?: DataScope) {
    const conditions = ['shipment_id = $1', 'deleted_at is null'];
    const values: unknown[] = [shipmentId];

    if (scope?.companyId) {
      values.push(scope.companyId);
      conditions.push(`company_id = $${values.length}`);
    }

    const result = await pool.query(
      `select * from center_receipts where ${conditions.join(' and ')} order by created_at desc limit 1`,
      values,
    );
    return result.rows[0] ?? null;
  }

  async create(input: CenterReceiptCreateInput) {
    const result = await pool.query(
      `
      insert into center_receipts(
        shipment_id, branch_id, agent_id, center_name, received_by_user_id, notes, company_id
      )
      values($1,$2,$3,$4,$5,$6,$7)
      on conflict (shipment_id) where deleted_at is null
      do update set
        center_name = excluded.center_name,
        received_by_user_id = coalesce(excluded.received_by_user_id, center_receipts.received_by_user_id),
        notes = coalesce(excluded.notes, center_receipts.notes),
        updated_at = now()
      returning *
      `,
      [
        input.shipmentId,
        input.branchId ?? null,
        input.agentId ?? null,
        input.centerName,
        input.receivedByUserId ?? null,
        input.notes ?? null,
        input.companyId ?? null,
      ],
    );
    return result.rows[0];
  }
}
