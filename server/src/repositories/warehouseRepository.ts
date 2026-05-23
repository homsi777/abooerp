import { pool } from '../db/pool.js';
import type { DataScope } from '../utils/scope.js';

export interface WarehouseInput {
  companyId: string;
  branchId?: string;
  code: string;
  name: string;
  address?: string;
  isActive?: boolean;
}

export interface Warehouse {
  id: string;
  company_id: string;
  branch_id: string | null;
  code: string;
  name: string;
  address: string | null;
  is_active: boolean;
  deleted_at: string | null;
  created_at: string;
  updated_at: string;
}

export class WarehouseRepository {
  async list(scope?: DataScope): Promise<Warehouse[]> {
    const conditions: string[] = ['deleted_at is null'];
    const values: any[] = [];

    if (scope?.companyId) {
      values.push(scope.companyId);
      conditions.push(`company_id = $${values.length}`);
    }
    if (scope?.branchId) {
      values.push(scope.branchId);
      conditions.push(`branch_id = $${values.length}`);
    }

    const where = conditions.join(' and ');
    const result = await pool.query<Warehouse>(
      `select * from warehouses where ${where} order by name asc`,
      values,
    );
    return result.rows;
  }

  async getById(id: string, scope?: DataScope): Promise<Warehouse | null> {
    const conditions: string[] = ['id = $1', 'deleted_at is null'];
    const values: any[] = [id];

    if (scope?.companyId) {
      values.push(scope.companyId);
      conditions.push(`company_id = $${values.length}`);
    }

    const result = await pool.query<Warehouse>(
      `select * from warehouses where ${conditions.join(' and ')} limit 1`,
      values,
    );
    return result.rows[0] ?? null;
  }

  async create(input: WarehouseInput): Promise<Warehouse> {
    const result = await pool.query<Warehouse>(
      `
      insert into warehouses(company_id, branch_id, code, name, address, is_active)
      values($1, $2, $3, $4, $5, coalesce($6, true))
      returning *
      `,
      [
        input.companyId,
        input.branchId ?? null,
        input.code,
        input.name,
        input.address ?? null,
        input.isActive ?? null,
      ],
    );
    return result.rows[0];
  }

  async update(id: string, input: Partial<WarehouseInput>, scope?: DataScope): Promise<Warehouse | null> {
    const conditions: string[] = ['id = $1', 'deleted_at is null'];
    const values: any[] = [id];

    if (scope?.companyId) {
      values.push(scope.companyId);
      conditions.push(`company_id = $${values.length}`);
    }

    const result = await pool.query<Warehouse>(
      `
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
      `,
      [
        ...values,
        input.code ?? null,
        input.name ?? null,
        input.address ?? null,
        input.branchId ?? null,
        input.isActive ?? null,
      ],
    );
    return result.rows[0] ?? null;
  }

  async remove(id: string, scope?: DataScope): Promise<boolean> {
    const conditions: string[] = ['id = $1', 'deleted_at is null'];
    const values: any[] = [id];

    if (scope?.companyId) {
      values.push(scope.companyId);
      conditions.push(`company_id = $${values.length}`);
    }

    const result = await pool.query(
      `update warehouses set deleted_at = now() where ${conditions.join(' and ')} returning id`,
      values,
    );
    return (result.rowCount ?? 0) > 0;
  }
}
