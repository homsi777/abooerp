import { pool } from '../db/pool.js';
export class BranchRepository {
    async listBranches(companyId, includeInactive = false) {
        const result = await pool.query(`
      select id, code, name, city, address, phone, company_id, is_active, created_at::text, updated_at::text
      from branches
      where company_id = $1
        and ($2::boolean = true or is_active = true)
      order by created_at desc
      `, [companyId, includeInactive]);
        return result.rows;
    }
    async getBranchById(branchId, companyId) {
        const result = await pool.query(`
      select id, code, name, city, address, phone, company_id, is_active, created_at::text, updated_at::text
      from branches
      where id = $1 and company_id = $2
      limit 1
      `, [branchId, companyId]);
        return result.rows[0] ?? null;
    }
    async createBranch(companyId, data) {
        const result = await pool.query(`
      insert into branches(code, name, city, address, phone, company_id, is_active)
      values ($1, $2, $3, $4, $5, $6, coalesce($7, true))
      returning id, code, name, city, address, phone, company_id, is_active, created_at::text, updated_at::text
      `, [data.code, data.name, data.city ?? null, data.address ?? null, data.phone ?? null, companyId, data.is_active ?? true]);
        return result.rows[0];
    }
    async updateBranch(branchId, companyId, data) {
        const result = await pool.query(`
      update branches
      set
        code = coalesce($3, code),
        name = coalesce($4, name),
        city = coalesce($5, city),
        address = coalesce($6, address),
        phone = coalesce($7, phone),
        is_active = coalesce($8, is_active),
        updated_at = now()
      where id = $1 and company_id = $2
      returning id, code, name, city, address, phone, company_id, is_active, created_at::text, updated_at::text
      `, [branchId, companyId, data.code ?? null, data.name ?? null, data.city ?? null, data.address ?? null, data.phone ?? null, data.is_active]);
        return result.rows[0] ?? null;
    }
    async deactivateBranch(branchId, companyId) {
        const result = await pool.query(`
      update branches
      set is_active = false, updated_at = now()
      where id = $1 and company_id = $2 and is_active = true
      `, [branchId, companyId]);
        return (result.rowCount ?? 0) > 0;
    }
}
