import { pool } from '../db/pool.js';
export class AgentRepository {
    async listAgents(companyId, branchId, includeInactive = false) {
        const result = await pool.query(`
      select a.id, a.code, a.name, a.phone, a.governorate, a.branch_id, a.is_active, a.created_at::text, a.updated_at::text
      from agents a
      join branches b on b.id = a.branch_id
      where b.company_id = $1
        and ($2::uuid is null or a.branch_id = $2::uuid)
        and ($3::boolean = true or a.is_active = true)
      order by a.created_at desc
      `, [companyId, branchId ?? null, includeInactive]);
        return result.rows;
    }
    async getAgentById(id, companyId) {
        const result = await pool.query(`
      select a.id, a.code, a.name, a.phone, a.governorate, a.branch_id, a.is_active, a.created_at::text, a.updated_at::text
      from agents a
      join branches b on b.id = a.branch_id
      where a.id = $1
        and b.company_id = $2
      limit 1
      `, [id, companyId]);
        return result.rows[0] ?? null;
    }
    async branchBelongsToCompany(branchId, companyId) {
        const result = await pool.query(`
      select 1
      from branches
      where id = $1 and company_id = $2
      limit 1
      `, [branchId, companyId]);
        return (result.rowCount ?? 0) > 0;
    }
    async createAgent(companyId, data) {
        const result = await pool.query(`
      insert into agents(code, name, phone, governorate, branch_id, is_active)
      values ($1, $2, $3, $4, $5, coalesce($6, true))
      returning id, code, name, phone, governorate, branch_id, is_active, created_at::text, updated_at::text
      `, [data.code, data.name, data.phone ?? null, data.governorate ?? null, data.branch_id ?? null, data.is_active ?? true]);
        return result.rows[0];
    }
    async updateAgent(id, companyId, data) {
        const result = await pool.query(`
      update agents a
      set
        code = coalesce($3, a.code),
        name = coalesce($4, a.name),
        phone = coalesce($5, a.phone),
        governorate = coalesce($6, a.governorate),
        branch_id = case when $9::boolean = true then null else coalesce($7::uuid, a.branch_id) end,
        is_active = coalesce($8, a.is_active),
        updated_at = now()
      where a.id = $1
        and exists(
          select 1
          from branches b
          where b.id = a.branch_id
            and b.company_id = $2
        )
      returning a.id, a.code, a.name, a.phone, a.governorate, a.branch_id, a.is_active, a.created_at::text, a.updated_at::text
      `, [
            id,
            companyId,
            data.code ?? null,
            data.name ?? null,
            data.phone ?? null,
            data.governorate ?? null,
            data.branch_id ?? null,
            data.is_active,
            data.branch_id === null,
        ]);
        return result.rows[0] ?? null;
    }
    async deactivateAgent(id, companyId) {
        const result = await pool.query(`
      update agents a
      set is_active = false, updated_at = now()
      where a.id = $1
        and exists(
          select 1
          from branches b
          where b.id = a.branch_id
            and b.company_id = $2
        )
        and a.is_active = true
      `, [id, companyId]);
        return (result.rowCount ?? 0) > 0;
    }
}
