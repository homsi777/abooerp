import { pool } from '../db/pool.js';
import { resolveDriverIdByLabel } from '../utils/dailyLedgerDriverMatch.js';
import { HttpError } from '../utils/errors.js';
async function resolveDriverLabel(client, resolvedDriverId, driverLabel) {
    const trimmed = String(driverLabel ?? '').trim().replace(/\s+/g, ' ');
    if (trimmed)
        return trimmed;
    if (!resolvedDriverId)
        return null;
    const result = await client.query(`select full_name from drivers where id = $1::uuid limit 1`, [resolvedDriverId]);
    const name = String(result.rows[0]?.full_name ?? '').trim().replace(/\s+/g, ' ');
    return name || null;
}
async function resolveVehicleLabel(client, vehicleId, vehicleLabel) {
    const trimmed = String(vehicleLabel ?? '').trim().replace(/\s+/g, ' ');
    if (trimmed)
        return trimmed;
    if (!vehicleId)
        return null;
    const result = await client.query(`select plate_number, model from vehicles where id = $1::uuid limit 1`, [vehicleId]);
    const row = result.rows[0];
    if (!row)
        return null;
    const plate = String(row.plate_number ?? '').trim();
    const model = String(row.model ?? '').trim();
    return model ? `${plate} — ${model}` : plate || null;
}
async function resolveFleetLabels(client, input) {
    const driverId = input.driverId ?? (await resolveDriverIdByLabel(client, input.driverLabel));
    const driverLabel = await resolveDriverLabel(client, driverId, input.driverLabel);
    const vehicleId = input.vehicleId ?? null;
    const vehicleLabel = await resolveVehicleLabel(client, vehicleId, input.vehicleLabel);
    return { driverId, vehicleId, driverLabel, vehicleLabel };
}
export class DailyLedgerDispatchRepository {
    async listDefinitions(scope, filters) {
        if (!scope.companyId)
            throw new HttpError(400, 'Company scope is required.');
        const result = await pool.query(`
      select
        d.*,
        coalesce(rc.rows_count, 0)::int as rows_count
      from daily_ledger_dispatch_definitions d
      left join lateral (
        select count(*)::int as rows_count
        from daily_ledger_rows r
        where r.dispatch_id = d.id
          and r.deleted_at is null
      ) rc on true
      where d.company_id = $1::uuid
        and d.deleted_at is null
        and d.branch_id = $2::uuid
        and d.ledger_date = $3::date
        and d.line_label = $4
      order by d.dispatch_no asc
      `, [scope.companyId, filters.branchId, filters.ledgerDate, filters.lineLabel]);
        return result.rows;
    }
    async getDefinitionById(scope, id) {
        if (!scope.companyId)
            throw new HttpError(400, 'Company scope is required.');
        const result = await pool.query(`
      select d.*
      from daily_ledger_dispatch_definitions d
      where d.id = $1::uuid
        and d.company_id = $2::uuid
        and d.deleted_at is null
      limit 1
      `, [id, scope.companyId]);
        return result.rows[0] ?? null;
    }
    async createDefinition(scope, input) {
        if (!scope.companyId)
            throw new HttpError(400, 'Company scope is required.');
        const client = await pool.connect();
        try {
            await client.query('begin');
            const fleet = await resolveFleetLabels(client, input);
            const result = await client.query(`
        insert into daily_ledger_dispatch_definitions(
          company_id, branch_id, ledger_date, line_label, dispatch_no,
          driver_id, vehicle_id, driver_label, vehicle_label, trip_no, notes,
          created_by, updated_by
        )
        values($1,$2,$3::date,$4,$5,$6,$7,$8,$9,$10,$11,$12,$12)
        returning *
        `, [
                scope.companyId,
                input.branchId,
                input.ledgerDate,
                input.lineLabel,
                input.dispatchNo,
                fleet.driverId,
                fleet.vehicleId,
                fleet.driverLabel,
                fleet.vehicleLabel,
                input.tripNo ?? null,
                input.notes ?? null,
                input.userId ?? scope.userId ?? null,
            ]);
            await client.query('commit');
            return result.rows[0];
        }
        catch (error) {
            await client.query('rollback');
            if (error && typeof error === 'object' && 'code' in error && error.code === '23505') {
                throw new HttpError(409, `رقم الإرسالية ${input.dispatchNo} موجود مسبقاً لهذا التاريخ.`);
            }
            throw error;
        }
        finally {
            client.release();
        }
    }
    async updateDefinition(scope, id, input) {
        if (!scope.companyId)
            throw new HttpError(400, 'Company scope is required.');
        const client = await pool.connect();
        try {
            await client.query('begin');
            const existing = await this.getDefinitionById(scope, id);
            if (!existing)
                throw new HttpError(404, 'تعريف الإرسالية غير موجود.');
            const fleet = await resolveFleetLabels(client, {
                driverId: input.driverId !== undefined ? input.driverId : existing.driver_id,
                vehicleId: input.vehicleId !== undefined ? input.vehicleId : existing.vehicle_id,
                driverLabel: input.driverLabel !== undefined ? input.driverLabel : existing.driver_label,
                vehicleLabel: input.vehicleLabel !== undefined ? input.vehicleLabel : existing.vehicle_label,
            });
            const result = await client.query(`
        update daily_ledger_dispatch_definitions
        set
          driver_id = $3,
          vehicle_id = $4,
          driver_label = $5,
          vehicle_label = $6,
          trip_no = coalesce($7, trip_no),
          notes = coalesce($8, notes),
          updated_by = $9,
          updated_at = now()
        where id = $1::uuid
          and company_id = $2::uuid
          and deleted_at is null
        returning *
        `, [
                id,
                scope.companyId,
                fleet.driverId,
                fleet.vehicleId,
                fleet.driverLabel,
                fleet.vehicleLabel,
                input.tripNo ?? null,
                input.notes ?? null,
                input.userId ?? scope.userId ?? null,
            ]);
            if (!result.rows.length)
                throw new HttpError(404, 'تعريف الإرسالية غير موجود.');
            await client.query('commit');
            return result.rows[0];
        }
        catch (error) {
            await client.query('rollback');
            throw error;
        }
        finally {
            client.release();
        }
    }
    async deleteDefinition(scope, id, userId) {
        if (!scope.companyId)
            throw new HttpError(400, 'Company scope is required.');
        const linked = await pool.query(`
      select count(*)::text as count
      from daily_ledger_rows r
      where r.dispatch_id = $1::uuid
        and r.deleted_at is null
      `, [id]);
        if (Number(linked.rows[0]?.count ?? 0) > 0) {
            throw new HttpError(409, 'لا يمكن حذف تعريف الإرسالية — يوجد أسطر مرتبطة به.');
        }
        const result = await pool.query(`
      update daily_ledger_dispatch_definitions
      set deleted_at = now(), updated_by = $3, updated_at = now()
      where id = $1::uuid
        and company_id = $2::uuid
        and deleted_at is null
      `, [id, scope.companyId, userId ?? scope.userId ?? null]);
        if (!result.rowCount)
            throw new HttpError(404, 'تعريف الإرسالية غير موجود.');
    }
    async suggestNextDispatchNo(scope, filters) {
        if (!scope.companyId)
            return 1;
        const result = await pool.query(`
      select max(dispatch_no) as max_no
      from daily_ledger_dispatch_definitions
      where company_id = $1::uuid
        and branch_id = $2::uuid
        and ledger_date = $3::date
        and line_label = $4
        and deleted_at is null
      `, [scope.companyId, filters.branchId, filters.ledgerDate, filters.lineLabel]);
        return (Number(result.rows[0]?.max_no) || 0) + 1;
    }
}
/** يُستخدم عند الحفظ لربط السطر بتعريف الإرسالية واستخراج السائق/المركبة */
export async function resolveFleetFromDispatchDefinition(client, companyId, dispatchId, scope) {
    const result = await client.query(`
    select driver_id, vehicle_id, driver_label, vehicle_label, trip_no
    from daily_ledger_dispatch_definitions
    where id = $1::uuid
      and company_id = $2::uuid
      and branch_id = $3::uuid
      and ledger_date = $4::date
      and line_label = $5
      and deleted_at is null
    limit 1
    `, [dispatchId, companyId, scope.branchId, scope.ledgerDate, scope.lineLabel]);
    const row = result.rows[0];
    if (!row) {
        throw new HttpError(404, 'تعريف الإرسالية غير موجود أو لا يطابق التاريخ/الخط.');
    }
    return {
        driverId: row.driver_id,
        vehicleId: row.vehicle_id,
        driverLabel: row.driver_label,
        vehicleLabel: row.vehicle_label,
        tripNo: row.trip_no,
    };
}
