import { pool } from '../db/pool.js';

export interface EmployeeInput {
  companyId: string;
  branchId?: string | null;
  code: string;
  name: string;
  position?: string;
  basicSalary?: number;
  currency?: string;
  salaryType?: 'monthly' | 'weekly';
  hireDate?: string;
  phone?: string;
  notes?: string;
  isActive?: boolean;
}

export interface Employee {
  id: string;
  company_id: string;
  branch_id: string | null;
  code: string;
  name: string;
  position: string | null;
  basic_salary: string;
  currency: string;
  salary_type: 'monthly' | 'weekly';
  hire_date: string | null;
  phone: string | null;
  notes: string | null;
  is_active: boolean;
  deleted_at: string | null;
  created_at: string;
  updated_at: string;
}

export class EmployeeRepository {
  async list(companyId: string, includeInactive = false): Promise<Employee[]> {
    const conditions = ['company_id = $1', 'deleted_at is null'];
    if (!includeInactive) conditions.push('is_active = true');
    const result = await pool.query<Employee>(
      `select * from employees where ${conditions.join(' and ')} order by name asc`,
      [companyId],
    );
    return result.rows;
  }

  async getById(id: string, companyId: string): Promise<Employee | null> {
    const result = await pool.query<Employee>(
      `select * from employees where id = $1 and company_id = $2 and deleted_at is null limit 1`,
      [id, companyId],
    );
    return result.rows[0] ?? null;
  }

  async create(input: EmployeeInput): Promise<Employee> {
    const result = await pool.query<Employee>(
      `
      insert into employees(
        company_id, branch_id, code, name, position,
        basic_salary, currency, salary_type, hire_date, phone, notes, is_active
      ) values(
        $1, $2, $3, $4, $5,
        coalesce($6, 0), coalesce($7, 'USD'), coalesce($8, 'monthly'), $9, $10, $11, coalesce($12, true)
      )
      returning *
      `,
      [
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
      ],
    );
    return result.rows[0];
  }

  async update(id: string, companyId: string, input: Partial<EmployeeInput>): Promise<Employee | null> {
    const result = await pool.query<Employee>(
      `
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
      `,
      [
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
      ],
    );
    return result.rows[0] ?? null;
  }

  async remove(id: string, companyId: string): Promise<boolean> {
    const result = await pool.query(
      `update employees set deleted_at = now() where id = $1 and company_id = $2 and deleted_at is null returning id`,
      [id, companyId],
    );
    return (result.rowCount ?? 0) > 0;
  }
}
