import { pool } from '../db/pool.js';

export interface UserRecord {
  id: string;
  username: string;
  full_name: string;
  email: string | null;
  phone: string | null;
  role_id: string;
  role_code: string;
  role_name: string;
  user_type: 'admin' | 'employee' | 'agent' | 'accountant' | 'branch_supervisor' | 'delivery' | 'viewer';
  agent_id: string | null;
  agent_name: string | null;
  company_id: string;
  status: 'active' | 'inactive' | 'locked';
  is_active: boolean;
  branch_ids: string[];
  default_branch_id: string | null;
  last_login_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface CreateUserInput {
  username: string;
  full_name: string;
  email?: string;
  phone?: string;
  password_hash: string;
  role_id: string;
  user_type?: 'admin' | 'employee' | 'agent' | 'accountant' | 'branch_supervisor' | 'delivery' | 'viewer';
  agent_id?: string | null;
  status?: 'active' | 'inactive' | 'locked';
  is_active?: boolean;
}

export interface UpdateUserInput {
  username?: string;
  full_name?: string;
  email?: string | null;
  phone?: string | null;
  password_hash?: string;
  role_id?: string;
  user_type?: 'admin' | 'employee' | 'agent' | 'accountant' | 'branch_supervisor' | 'delivery' | 'viewer';
  agent_id?: string | null;
  status?: 'active' | 'inactive' | 'locked';
  is_active?: boolean;
}

export class UserRepository {
  async listUsers(companyId: string): Promise<UserRecord[]> {
    const result = await pool.query<UserRecord>(
      `
      with user_branch_scope as (
        select
          ub.user_id,
          coalesce(array_agg(distinct ub.branch_id) filter (where ub.branch_id is not null), '{}'::uuid[])::text[] as branch_ids
        from user_branches ub
        join branches b on b.id = ub.branch_id
        where b.company_id = $1
        group by ub.user_id
      )
      select
        u.id,
        u.username,
        u.full_name,
        u.email,
        u.phone,
        u.role_id,
        r.code as role_code,
        r.name as role_name,
        coalesce(u.user_type, 'employee') as user_type,
        u.agent_id,
        a.name as agent_name,
        u.company_id,
        u.status,
        u.is_active,
        coalesce(ubs.branch_ids, '{}'::text[]) as branch_ids,
        u.branch_id as default_branch_id,
        u.last_login_at::text,
        u.created_at::text,
        u.updated_at::text
      from users u
      join roles r on r.id = u.role_id
      left join agents a on a.id = u.agent_id
      left join user_branch_scope ubs on ubs.user_id = u.id
      where u.company_id = $1
      order by u.created_at desc
      `,
      [companyId],
    );
    return result.rows;
  }

  async getUserById(id: string, companyId: string): Promise<UserRecord | null> {
    const result = await pool.query<UserRecord>(
      `
      with user_branch_scope as (
        select
          ub.user_id,
          coalesce(array_agg(distinct ub.branch_id) filter (where ub.branch_id is not null), '{}'::uuid[])::text[] as branch_ids
        from user_branches ub
        join branches b on b.id = ub.branch_id
        where b.company_id = $2
        group by ub.user_id
      )
      select
        u.id,
        u.username,
        u.full_name,
        u.email,
        u.phone,
        u.role_id,
        r.code as role_code,
        r.name as role_name,
        coalesce(u.user_type, 'employee') as user_type,
        u.agent_id,
        a.name as agent_name,
        u.company_id,
        u.status,
        u.is_active,
        coalesce(ubs.branch_ids, '{}'::text[]) as branch_ids,
        u.branch_id as default_branch_id,
        u.last_login_at::text,
        u.created_at::text,
        u.updated_at::text
      from users u
      join roles r on r.id = u.role_id
      left join agents a on a.id = u.agent_id
      left join user_branch_scope ubs on ubs.user_id = u.id
      where u.id = $1
        and u.company_id = $2
      `,
      [id, companyId],
    );
    return result.rows[0] ?? null;
  }

  async isRoleAllowedForCompany(roleId: string, companyId: string): Promise<boolean> {
    const result = await pool.query(
      `
      select 1
      from roles
      where id = $1
        and is_active = true
        and (is_system = true or company_id = $2)
      limit 1
      `,
      [roleId, companyId],
    );
    return (result.rowCount ?? 0) > 0;
  }

  async createUser(companyId: string, data: CreateUserInput): Promise<UserRecord> {
    const result = await pool.query<{ id: string }>(
      `
      insert into users(
        username,
        full_name,
        email,
        phone,
        password_hash,
        role_id,
        user_type,
        agent_id,
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
        coalesce($7, 'employee'),
        $8,
        r.code,
        $9,
        coalesce($10, 'active'),
        coalesce($11, true)
      from roles r
      where r.id = $6
      returning id
      `,
      [
        data.username,
        data.full_name,
        data.email ?? null,
        data.phone ?? null,
        data.password_hash,
        data.role_id,
        data.user_type ?? 'employee',
        data.agent_id ?? null,
        companyId,
        data.status ?? 'active',
        data.is_active ?? true,
      ],
    );
    return (await this.getUserById(result.rows[0].id, companyId)) as UserRecord;
  }

  async updateUser(id: string, companyId: string, data: UpdateUserInput): Promise<UserRecord | null> {
    const result = await pool.query<{ id: string }>(
      `
      update users u
      set
        username = coalesce($3, u.username),
        full_name = coalesce($4, u.full_name),
        email = case when $5::text = '__NULL__' then null else coalesce($5, u.email) end,
        phone = case when $6::text = '__NULL__' then null else coalesce($6, u.phone) end,
        password_hash = coalesce($7, u.password_hash),
        role_id = coalesce($8, u.role_id),
        user_type = coalesce($9, u.user_type),
        agent_id = case when $10::text = '__NULL__' then null else coalesce($10::uuid, u.agent_id) end,
        role = coalesce((select r2.code from roles r2 where r2.id = $8), u.role),
        status = coalesce($11, u.status),
        is_active = coalesce($12, u.is_active),
        updated_at = now()
      where u.id = $1
        and u.company_id = $2
      returning u.id
      `,
      [
        id,
        companyId,
        data.username ?? null,
        data.full_name ?? null,
        typeof data.email === 'undefined' ? null : data.email ?? '__NULL__',
        typeof data.phone === 'undefined' ? null : data.phone ?? '__NULL__',
        data.password_hash ?? null,
        data.role_id ?? null,
        data.user_type ?? null,
        typeof data.agent_id === 'undefined' ? null : data.agent_id ?? '__NULL__',
        data.status ?? null,
        data.is_active,
      ],
    );
    if (!result.rowCount) {
      return null;
    }
    return this.getUserById(id, companyId);
  }

  async deactivateUser(id: string, companyId: string): Promise<boolean> {
    const result = await pool.query(
      `
      update users
      set
        is_active = false,
        status = 'inactive',
        updated_at = now()
      where id = $1
        and company_id = $2
        and is_active = true
      `,
      [id, companyId],
    );
    return (result.rowCount ?? 0) > 0;
  }

  async assignBranches(userId: string, companyId: string, branchIds: string[]): Promise<void> {
    const validResult = await pool.query<{ id: string }>(
      `
      select id
      from branches
      where company_id = $1
        and is_active = true
        and id = any($2::uuid[])
      `,
      [companyId, branchIds],
    );
    if (validResult.rowCount !== branchIds.length) {
      throw new Error('One or more branches are invalid for this company scope.');
    }

    await pool.query('delete from user_branches where user_id = $1', [userId]);
    if (branchIds.length > 0) {
      await pool.query(
        `
        insert into user_branches(user_id, branch_id)
        select $1, unnest($2::uuid[])
        `,
        [userId, branchIds],
      );
      await pool.query(
        `
        update users
        set branch_id = $2, updated_at = now()
        where id = $1
        `,
        [userId, branchIds[0]],
      );
    } else {
      await pool.query(
        `
        update users
        set branch_id = null, updated_at = now()
        where id = $1
        `,
        [userId],
      );
    }
  }

  async setAccessScope(userId: string, companyId: string, payload: {
    role_id?: string;
    user_type?: 'admin' | 'employee' | 'agent' | 'accountant' | 'branch_supervisor' | 'delivery' | 'viewer';
    agent_id?: string | null;
    branch_ids: string[];
  }): Promise<UserRecord | null> {
    await this.updateUser(userId, companyId, {
      role_id: payload.role_id,
      user_type: payload.user_type,
      agent_id: payload.agent_id,
    });
    await this.assignBranches(userId, companyId, payload.branch_ids);
    return this.getUserById(userId, companyId);
  }

  async getUserBranches(userId: string): Promise<string[]> {
    const result = await pool.query<{ branch_id: string }>(
      `
      select branch_id
      from user_branches
      where user_id = $1
      order by created_at asc
      `,
      [userId],
    );
    return result.rows.map((row) => row.branch_id);
  }
}
