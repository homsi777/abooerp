import { pool } from '../db/pool.js';
export class ItemRepository {
    async list(scope) {
        const conditions = ['deleted_at is null'];
        const values = [];
        if (scope?.companyId) {
            values.push(scope.companyId);
            conditions.push(`company_id = $${values.length}`);
        }
        const result = await pool.query(`select * from items where ${conditions.join(' and ')} order by name asc`, values);
        return result.rows;
    }
    async getById(id, scope) {
        const conditions = ['id = $1', 'deleted_at is null'];
        const values = [id];
        if (scope?.companyId) {
            values.push(scope.companyId);
            conditions.push(`company_id = $${values.length}`);
        }
        const result = await pool.query(`select * from items where ${conditions.join(' and ')} limit 1`, values);
        return result.rows[0] ?? null;
    }
    async create(input) {
        const result = await pool.query(`
      insert into items(company_id, code, name, description, unit, is_active)
      values($1, $2, $3, $4, coalesce($5, 'piece'), coalesce($6, true))
      returning *
      `, [
            input.companyId,
            input.code,
            input.name,
            input.description ?? null,
            input.unit ?? null,
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
      update items
      set
        code        = coalesce($${values.length + 1}, code),
        name        = coalesce($${values.length + 2}, name),
        description = coalesce($${values.length + 3}, description),
        unit        = coalesce($${values.length + 4}, unit),
        is_active   = coalesce($${values.length + 5}, is_active),
        updated_at  = now()
      where ${conditions.join(' and ')}
      returning *
      `, [
            ...values,
            input.code ?? null,
            input.name ?? null,
            input.description ?? null,
            input.unit ?? null,
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
        const result = await pool.query(`update items set deleted_at = now() where ${conditions.join(' and ')} returning id`, values);
        return (result.rowCount ?? 0) > 0;
    }
}
