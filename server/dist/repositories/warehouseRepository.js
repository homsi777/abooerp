import { pool } from '../db/pool.js';
export class WarehouseRepository {
    async list(scope) {
        const conditions = ['deleted_at is null'];
        const values = [];
        if (scope?.companyId) {
            values.push(scope.companyId);
            conditions.push(`company_id = $${values.length}`);
        }
        if (scope?.branchId) {
            values.push(scope.branchId);
            conditions.push(`branch_id = $${values.length}`);
        }
        const where = conditions.join(' and ');
        const result = await pool.query(`select * from warehouses where ${where} order by name asc`, values);
        return result.rows;
    }
    async getById(id, scope) {
        const conditions = ['id = $1', 'deleted_at is null'];
        const values = [id];
        if (scope?.companyId) {
            values.push(scope.companyId);
            conditions.push(`company_id = $${values.length}`);
        }
        const result = await pool.query(`select * from warehouses where ${conditions.join(' and ')} limit 1`, values);
        return result.rows[0] ?? null;
    }
    async create(input) {
        const result = await pool.query(`
      insert into warehouses(company_id, branch_id, code, name, address, is_active)
      values($1, $2, $3, $4, $5, coalesce($6, true))
      returning *
      `, [
            input.companyId,
            input.branchId ?? null,
            input.code,
            input.name,
            input.address ?? null,
            input.isActive ?? null,
        ]);
        return result.rows[0];
    }
    async update(id, input, scope) {
        const conditions = ['id = $1', 'deleted_at is null'];
        const values = [id];
        if (scope?.companyId) {
            values.push(scope.companyId);
            conditions.push(`company_id = $${values.length}`);
        }
        const result = await pool.query(`
      update warehouses
      set
        code       = coalesce($${values.length + 1}, code),
        name       = coalesce($${values.length + 2}, name),
        address    = coalesce($${values.length + 3}, address),
        branch_id  = coalesce($${values.length + 4}, branch_id),
        is_active  = coalesce($${values.length + 5}, is_active),
        updated_at = now()
      where ${conditions.join(' and ')}
      returning *
      `, [
            ...values,
            input.code ?? null,
            input.name ?? null,
            input.address ?? null,
            input.branchId ?? null,
            input.isActive ?? null,
        ]);
        return result.rows[0] ?? null;
    }
    async remove(id, scope) {
        const conditions = ['id = $1', 'deleted_at is null'];
        const values = [id];
        if (scope?.companyId) {
            values.push(scope.companyId);
            conditions.push(`company_id = $${values.length}`);
        }
        const result = await pool.query(`update warehouses set deleted_at = now() where ${conditions.join(' and ')} returning id`, values);
        return (result.rowCount ?? 0) > 0;
    }
}
