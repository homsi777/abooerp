import { pool } from '../db/pool.js';
import type { DataScope } from '../utils/scope.js';

export interface ReferenceEntityConfig {
  table:
    | 'customers'
    | 'senders_receivers'
    | 'drivers'
    | 'vehicles'
    | 'branches'
    | 'agents'
    | 'cities'
    | 'goods_types'
    | 'tariffs';
  createFields: string[];
  updateFields: string[];
}

export class ReferenceRepository {
  constructor(private readonly config: ReferenceEntityConfig) {}

  async list() {
    const result = await pool.query(`select * from ${this.config.table} order by created_at desc`);
    return result.rows;
  }

  async listScoped(scope?: DataScope, companyId?: string) {
    const table = this.config.table;

    if (scope?.financeAgentScope && scope.agentId && scope.userId && companyId) {
      if (table === 'senders_receivers') {
        const result = await pool.query(
          `
          select distinct sr.*
          from senders_receivers sr
          where (
              sr.agent_id = $1
              or sr.created_by_user_id = $2
              or exists (
                select 1
                from shipments s
                where s.deleted_at is null
                  and s.company_id = $3
                  and (s.sender_id = sr.id or s.receiver_id = sr.id)
                  and (s.agent_id = $1 or s.created_by = $2)
              )
            )
          order by sr.created_at desc
          `,
          [scope.agentId, scope.userId, companyId],
        );
        return result.rows;
      }

      if (table === 'drivers' || table === 'vehicles') {
        const alias = table === 'drivers' ? 'd' : 'v';
        const result = await pool.query(
          `
          select ${alias}.*
          from ${table} ${alias}
          left join branches b on b.id = ${alias}.branch_id
          where (
              ${alias}.agent_id = $1
              or ( $2::uuid is not null and ${alias}.branch_id = $2::uuid)
            )
            and (
              ${alias}.agent_id = $1
              or (b.id is not null and b.company_id = $3)
            )
          order by ${alias}.created_at desc
          `,
          [scope.agentId, scope.branchId ?? null, companyId],
        );
        return result.rows;
      }
    }

    return this.list();
  }

  async getById(id: string) {
    const result = await pool.query(`select * from ${this.config.table} where id = $1`, [id]);
    return result.rows[0] ?? null;
  }

  async getByIdScoped(id: string, scope?: DataScope, companyId?: string) {
    const rows = await this.listScoped(scope, companyId);
    return rows.find((row: any) => String(row.id) === String(id)) ?? null;
  }

  async create(payload: Record<string, unknown>) {
    const fields = this.config.createFields;
    const placeholders = fields.map((_, index) => `$${index + 1}`);
    const values = fields.map((field) => payload[field]);
    const result = await pool.query(
      `insert into ${this.config.table} (${fields.join(', ')}) values (${placeholders.join(', ')}) returning *`,
      values,
    );
    return result.rows[0];
  }

  async update(id: string, payload: Record<string, unknown>) {
    const fields = this.config.updateFields.filter((field) => field in payload);
    if (!fields.length) {
      return this.getById(id);
    }

    const assignments = fields.map((field, index) => `${field} = $${index + 2}`);
    const values = fields.map((field) => payload[field]);
    const result = await pool.query(
      `update ${this.config.table}
       set ${assignments.join(', ')}, updated_at = now()
       where id = $1
       returning *`,
      [id, ...values],
    );
    return result.rows[0] ?? null;
  }

  async remove(id: string) {
    const result = await pool.query(`delete from ${this.config.table} where id = $1 returning id`, [id]);
    return Boolean(result.rowCount);
  }
}
