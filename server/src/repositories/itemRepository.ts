import { pool } from '../db/pool.js';
import type { DataScope } from '../utils/scope.js';

export interface ItemInput {
  companyId: string;
  code: string;
  name: string;
  description?: string;
  unit?: string;
  isActive?: boolean;
}

export interface Item {
  id: string;
  company_id: string;
  code: string;
  name: string;
  description: string | null;
  unit: string;
  is_active: boolean;
  deleted_at: string | null;
  created_at: string;
  updated_at: string;
}

export class ItemRepository {
  async list(scope?: DataScope): Promise<Item[]> {
    const conditions: string[] = ['deleted_at is null'];
    const values: any[] = [];

    if (scope?.companyId) {
      values.push(scope.companyId);
      conditions.push(`company_id = $${values.length}`);
    }

    const result = await pool.query<Item>(
      `select * from items where ${conditions.join(' and ')} order by name asc`,
      values,
    );
    return result.rows;
  }

  async getById(id: string, scope?: DataScope): Promise<Item | null> {
    const conditions: string[] = ['id = $1', 'deleted_at is null'];
    const values: any[] = [id];

    if (scope?.companyId) {
      values.push(scope.companyId);
      conditions.push(`company_id = $${values.length}`);
    }

    const result = await pool.query<Item>(
      `select * from items where ${conditions.join(' and ')} limit 1`,
      values,
    );
    return result.rows[0] ?? null;
  }

  async create(input: ItemInput): Promise<Item> {
    const result = await pool.query<Item>(
      `
      insert into items(company_id, code, name, description, unit, is_active)
      values($1, $2, $3, $4, coalesce($5, 'piece'), coalesce($6, true))
      returning *
      `,
      [
        input.companyId,
        input.code,
        input.name,
        input.description ?? null,
        input.unit ?? null,
        input.isActive ?? null,
      ],
    );
    return result.rows[0];
  }

  async update(id: string, input: Partial<ItemInput>, scope?: DataScope): Promise<Item | null> {
    const conditions: string[] = ['id = $1', 'deleted_at is null'];
    const values: any[] = [id];

    if (scope?.companyId) {
      values.push(scope.companyId);
      conditions.push(`company_id = $${values.length}`);
    }

    const result = await pool.query<Item>(
      `
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
      `,
      [
        ...values,
        input.code ?? null,
        input.name ?? null,
        input.description ?? null,
        input.unit ?? null,
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
      `update items set deleted_at = now() where ${conditions.join(' and ')} returning id`,
      values,
    );
    return (result.rowCount ?? 0) > 0;
  }
}
