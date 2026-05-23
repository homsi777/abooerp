import { pool } from '../db/pool.js';
import type { DataScope } from '../utils/scope.js';

export interface ManifestCreateInput {
  manifestNo: string;
  branchId: string;
  vehicleId?: string;
  driverId?: string;
  status: 'created' | 'dispatched' | 'closed' | 'cancelled';
  companyId?: string;
  createdBy?: string;
  shipmentIds?: string[];
  expectedUpdatedAt?: string;
}

export class ManifestRepository {
  async list(scope?: DataScope) {
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

    const result = await pool.query(
      `select * from manifests where ${conditions.join(' and ')} order by created_at desc`,
      values,
    );
    return result.rows;
  }

  async getById(id: string, scope?: DataScope) {
    const conditions = ['m.id = $1', 'm.deleted_at is null'];
    const values: unknown[] = [id];

    if (scope?.companyId) {
      values.push(scope.companyId);
      conditions.push(`m.company_id = $${values.length}`);
    }
    if (scope?.branchId) {
      values.push(scope.branchId);
      conditions.push(`m.branch_id = $${values.length}`);
    }

    const manifest = await pool.query(
      `select m.* from manifests m where ${conditions.join(' and ')}`,
      values,
    );
    if (!manifest.rowCount) {
      return null;
    }
    const shipments = await pool.query(
      `
      select s.*
      from manifest_shipments ms
      join shipments s on s.id = ms.shipment_id and s.deleted_at is null
      where ms.manifest_id = $1
      `,
      [id],
    );
    return { ...manifest.rows[0], shipments: shipments.rows };
  }

  async create(input: ManifestCreateInput) {
    const client = await pool.connect();
    try {
      await client.query('begin');

      const manifest = await client.query(
        `
        insert into manifests(manifest_no, branch_id, vehicle_id, driver_id, status, company_id, created_by)
        values($1, $2, $3, $4, $5, $6, $7)
        returning *
        `,
        [
          input.manifestNo,
          input.branchId,
          input.vehicleId ?? null,
          input.driverId ?? null,
          input.status,
          input.companyId ?? null,
          input.createdBy ?? null,
        ],
      );

      if (input.shipmentIds?.length) {
        for (const shipmentId of input.shipmentIds) {
          await client.query(
            'insert into manifest_shipments(manifest_id, shipment_id) values($1, $2) on conflict do nothing',
            [manifest.rows[0].id, shipmentId],
          );
          await client.query(
            "update shipments set status = 'manifested', updated_at = now() where id = $1 and status <> 'delivered' and deleted_at is null",
            [shipmentId],
          );
        }
        await client.query(
          `
          update daily_ledger_rows
          set
            loaded_manifest_id = $1,
            loaded_at = now(),
            updated_at = now()
          where deleted_at is null
            and posted_shipment_id = any($2::uuid[])
          `,
          [manifest.rows[0].id, input.shipmentIds],
        );
      }

      await client.query('commit');
      return manifest.rows[0];
    } catch (error) {
      await client.query('rollback');
      throw error;
    } finally {
      client.release();
    }
  }

  async update(id: string, input: Partial<ManifestCreateInput>) {
    const client = await pool.connect();
    try {
      await client.query('begin');

      const expectsUpdatedAt = Boolean(input.expectedUpdatedAt);
      const result = await client.query(
        `
        update manifests
        set
          branch_id = coalesce($2, branch_id),
          vehicle_id = coalesce($3, vehicle_id),
          driver_id = coalesce($4, driver_id),
          status = coalesce($5, status),
          updated_at = now()
        where id = $1
          and deleted_at is null
          and (
            $6::boolean = false
            or date_trunc('milliseconds', updated_at) = date_trunc('milliseconds', $7::timestamptz)
          )
        returning *
        `,
        [
          id,
          input.branchId ?? null,
          input.vehicleId ?? null,
          input.driverId ?? null,
          input.status ?? null,
          expectsUpdatedAt,
          input.expectedUpdatedAt ?? null,
        ],
      );

      if (!result.rowCount) {
        await client.query('rollback');
        return null;
      }

      if (input.shipmentIds) {
        await client.query('delete from manifest_shipments where manifest_id = $1', [id]);
        for (const shipmentId of input.shipmentIds) {
          await client.query(
            'insert into manifest_shipments(manifest_id, shipment_id) values($1, $2) on conflict do nothing',
            [id, shipmentId],
          );
          await client.query(
            "update shipments set status = 'manifested', updated_at = now() where id = $1 and status <> 'delivered' and deleted_at is null",
            [shipmentId],
          );
        }
        if (input.shipmentIds.length) {
          await client.query(
            `
            update daily_ledger_rows
            set
              loaded_manifest_id = $1,
              loaded_at = now(),
              updated_at = now()
            where deleted_at is null
              and posted_shipment_id = any($2::uuid[])
            `,
            [id, input.shipmentIds],
          );
        }
      }

      await client.query('commit');
      return result.rows[0] ?? null;
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
      `update manifests set deleted_at = now() where ${conditions.join(' and ')} returning id`,
      values,
    );
    return Boolean(result.rowCount);
  }
}
