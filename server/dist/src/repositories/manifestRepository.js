import { pool } from '../db/pool.js';
export class ManifestRepository {
    async list(scope) {
        const values = [];
        const conditions = [];
        if (scope?.branchId) {
            values.push(scope.branchId);
            conditions.push(`branch_id = $${values.length}`);
        }
        const whereClause = conditions.length ? `where ${conditions.join(' and ')}` : '';
        const result = await pool.query(`select * from manifests ${whereClause} order by created_at desc`, values);
        return result.rows;
    }
    async getById(id, scope) {
        const values = [id];
        const conditions = ['id = $1'];
        if (scope?.branchId) {
            values.push(scope.branchId);
            conditions.push(`branch_id = $${values.length}`);
        }
        const manifest = await pool.query(`select * from manifests where ${conditions.join(' and ')}`, values);
        if (!manifest.rowCount) {
            return null;
        }
        const shipments = await pool.query(`
      select s.*
      from manifest_shipments ms
      join shipments s on s.id = ms.shipment_id
      where ms.manifest_id = $1
      `, [id]);
        return { ...manifest.rows[0], shipments: shipments.rows };
    }
    async create(input) {
        const client = await pool.connect();
        try {
            await client.query('begin');
            const manifest = await client.query(`
        insert into manifests(manifest_no, branch_id, vehicle_id, driver_id, status, created_by)
        values($1, $2, $3, $4, $5, $6)
        returning *
        `, [input.manifestNo, input.branchId, input.vehicleId ?? null, input.driverId ?? null, input.status, input.createdBy ?? null]);
            if (input.shipmentIds?.length) {
                for (const shipmentId of input.shipmentIds) {
                    await client.query('insert into manifest_shipments(manifest_id, shipment_id) values($1, $2) on conflict do nothing', [manifest.rows[0].id, shipmentId]);
                    await client.query("update shipments set status = 'manifested', updated_at = now() where id = $1 and status <> 'delivered'", [shipmentId]);
                }
            }
            await client.query('commit');
            return manifest.rows[0];
        }
        catch (error) {
            await client.query('rollback');
            throw error;
        }
        finally {
            client.release();
        }
    }
    async update(id, input) {
        const client = await pool.connect();
        try {
            await client.query('begin');
            const result = await client.query(`
        update manifests
        set
          branch_id = coalesce($2, branch_id),
          vehicle_id = coalesce($3, vehicle_id),
          driver_id = coalesce($4, driver_id),
          status = coalesce($5, status),
          updated_at = now()
        where id = $1
        returning *
        `, [id, input.branchId ?? null, input.vehicleId ?? null, input.driverId ?? null, input.status ?? null]);
            if (!result.rowCount) {
                await client.query('rollback');
                return null;
            }
            if (input.shipmentIds) {
                await client.query('delete from manifest_shipments where manifest_id = $1', [id]);
                for (const shipmentId of input.shipmentIds) {
                    await client.query('insert into manifest_shipments(manifest_id, shipment_id) values($1, $2) on conflict do nothing', [id, shipmentId]);
                    await client.query("update shipments set status = 'manifested', updated_at = now() where id = $1 and status <> 'delivered'", [shipmentId]);
                }
            }
            await client.query('commit');
            return result.rows[0] ?? null;
        }
        catch (error) {
            await client.query('rollback');
            throw error;
        }
        finally {
            client.release();
        }
    }
    async remove(id) {
        const result = await pool.query('delete from manifests where id = $1 returning id', [id]);
        return Boolean(result.rowCount);
    }
}
