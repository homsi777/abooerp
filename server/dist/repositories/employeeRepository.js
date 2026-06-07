import { pool } from '../db/pool.js';
export class EmployeeRepository {
    async list(companyId, includeInactive = false) {
        const conditions = ['company_id = $1', 'deleted_at is null'];
        if (!includeInactive)
            conditions.push('is_active = true');
        const result = await pool.query(`select * from employees where ${conditions.join(' and ')} order by name asc`, [companyId]);
        return result.rows;
    }
    async getById(id, companyId) {
        const result = await pool.query(`select * from employees where id = $1 and company_id = $2 and deleted_at is null limit 1`, [id, companyId]);
        return result.rows[0] ?? null;
    }
    async create(input) {
        const result = await pool.query(`
      insert into employees(
        company_id, branch_id, code, name, position,
        basic_salary, currency, salary_type, hire_date, phone, notes, is_active
      ) values(
        $1, $2, $3, $4, $5,
        coalesce($6, 0), coalesce($7, 'USD'), coalesce($8, 'monthly'), $9, $10, $11, coalesce($12, true)
      )
      returning *
      `, [
            input.companyId,
            input.branchId ?? null,
            input.code,
            input.name,
            input.position ?? null,
            input.basicSalary ?? null,
            input.currency ?? null,
            input.salaryType ?? null,
            input.hireDate ?? null,
            input.phone ?? null,
            input.notes ?? null,
            input.isActive ?? null,
        ]);
        return result.rows[0];
    }
    async update(id, companyId, input) {
        const result = await pool.query(`
      update employees
      set
        code         = coalesce($3, code),
        name         = coalesce($4, name),
        position     = coalesce($5, position),
        basic_salary = coalesce($6, basic_salary),
        currency     = coalesce($7, currency),
        salary_type  = coalesce($8, salary_type),
        hire_date    = coalesce($9, hire_date),
        phone        = coalesce($10, phone),
        notes        = coalesce($11, notes),
        branch_id    = coalesce($12, branch_id),
        is_active    = coalesce($13, is_active),
        updated_at   = now()
      where id = $1 and company_id = $2 and deleted_at is null
      returning *
      `, [
            id,
            companyId,
            input.code ?? null,
            input.name ?? null,
            input.position ?? null,
            input.basicSalary ?? null,
            input.currency ?? null,
            input.salaryType ?? null,
            input.hireDate ?? null,
            input.phone ?? null,
            input.notes ?? null,
            input.branchId ?? null,
            input.isActive ?? null,
        ]);
        return result.rows[0] ?? null;
    }
    async remove(id, companyId) {
        const result = await pool.query(`update employees set deleted_at = now() where id = $1 and company_id = $2 and deleted_at is null returning id`, [id, companyId]);
        return (result.rowCount ?? 0) > 0;
    }
}
