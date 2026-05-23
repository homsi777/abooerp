import { pool } from '../db/pool.js';
export class UserRepository {
    async listUsers(companyId) {
        const result = await pool.query(`
      select
        u.id,
        u.username,
        u.full_name,
        u.email,
        u.phone,
        u.role_id,
        r.code as role_code,
        r.name as role_name,
        u.company_id,
        u.status,
        u.is_active,
        coalesce(array_agg(distinct ub.branch_id) filter (where ub.branch_id is not null), '{}'::uuid[])::text[] as branch_ids,
        u.created_at::text,
        u.updated_at::text
      from users u
      join roles r on r.id = u.role_id
      left join user_branches ub on ub.user_id = u.id
      where u.company_id = $1
      group by u.id, r.code, r.name
      order by u.created_at desc
      `, [companyId]);
        return result.rows;
    }
    async getUserById(id, companyId) {
        const result = await pool.query(`
      select
        u.id,
        u.username,
        u.full_name,
        u.email,
        u.phone,
        u.role_id,
        r.code as role_code,
        r.name as role_name,
        u.company_id,
        u.status,
        u.is_active,
        coalesce(array_agg(distinct ub.branch_id) filter (where ub.branch_id is not null), '{}'::uuid[])::text[] as branch_ids,
        u.created_at::text,
        u.updated_at::text
      from users u
      join roles r on r.id = u.role_id
      left join user_branches ub on ub.user_id = u.id
      where u.id = $1
        and u.company_id = $2
      group by u.id, r.code, r.name
      `, [id, companyId]);
        return result.rows[0] ?? null;
    }
    async isRoleAllowedForCompany(roleId, companyId) {
        const result = await pool.query(`
      select 1
      from roles
      where id = $1
        and is_active = true
        and (is_system = true or company_id = $2)
      limit 1
      `, [roleId, companyId]);
        return (result.rowCount ?? 0) > 0;
    }
    async createUser(companyId, data) {
        const result = await pool.query(`
      insert into users(
        username,
        full_name,
        email,
        phone,
        password_hash,
        role_id,
        role,
        company_id,
        status,
        is_active
      )
      select
        $1,
        $2,
        $3,
        $4,
        $5,
        r.id,
        r.code,
        $7,
        coalesce($8, 'active'),
        coalesce($9, true)
      from roles r
      where r.id = $6
      returning id
      `, [
            data.username,
            data.full_name,
            data.email ?? null,
            data.phone ?? null,
            data.password_hash,
            data.role_id,
            companyId,
            data.status ?? 'active',
            data.is_active ?? true,
        ]);
        return (await this.getUserById(result.rows[0].id, companyId));
    }
    async updateUser(id, companyId, data) {
        const result = await pool.query(`
      update users u
      set
        username = coalesce($3, u.username),
        full_name = coalesce($4, u.full_name),
        email = case when $5::text = '__NULL__' then null else coalesce($5, u.email) end,
        phone = case when $6::text = '__NULL__' then null else coalesce($6, u.phone) end,
        password_hash = coalesce($7, u.password_hash),
        role_id = coalesce($8, u.role_id),
        role = coalesce((select r2.code from roles r2 where r2.id = $8), u.role),
        status = coalesce($9, u.status),
        is_active = coalesce($10, u.is_active),
        updated_at = now()
      where u.id = $1
        and u.company_id = $2
      returning u.id
      `, [
            id,
            companyId,
            data.username ?? null,
            data.full_name ?? null,
            typeof data.email === 'undefined' ? null : data.email ?? '__NULL__',
            typeof data.phone === 'undefined' ? null : data.phone ?? '__NULL__',
            data.password_hash ?? null,
            data.role_id ?? null,
            data.status ?? null,
            data.is_active,
        ]);
        if (!result.rowCount) {
            return null;
        }
        return this.getUserById(id, companyId);
    }
    async deactivateUser(id, companyId) {
        const result = await pool.query(`
      update users
      set
        is_active = false,
        status = 'inactive',
        updated_at = now()
      where id = $1
        and company_id = $2
        and is_active = true
      `, [id, companyId]);
        return (result.rowCount ?? 0) > 0;
    }
    async assignBranches(userId, companyId, branchIds) {
        const validResult = await pool.query(`
      select id
      from branches
      where company_id = $1
        and is_active = true
        and id = any($2::uuid[])
      `, [companyId, branchIds]);
        if (validResult.rowCount !== branchIds.length) {
            throw new Error('One or more branches are invalid for this company scope.');
        }
        await pool.query('delete from user_branches where user_id = $1', [userId]);
        if (branchIds.length > 0) {
            await pool.query(`
        insert into user_branches(user_id, branch_id)
        select $1, unnest($2::uuid[])
        `, [userId, branchIds]);
            await pool.query(`
        update users
        set branch_id = $2, updated_at = now()
        where id = $1
        `, [userId, branchIds[0]]);
        }
        else {
            await pool.query(`
        update users
        set branch_id = null, updated_at = now()
        where id = $1
        `, [userId]);
        }
    }
    async getUserBranches(userId) {
        const result = await pool.query(`
      select branch_id
      from user_branches
      where user_id = $1
      order by created_at asc
      `, [userId]);
        return result.rows.map((row) => row.branch_id);
    }
}
