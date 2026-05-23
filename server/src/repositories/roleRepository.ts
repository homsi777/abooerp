import { pool } from '../db/pool.js';

export interface RoleRecord {
  id: string;
  code: string;
  name: string;
  description: string | null;
  company_id: string | null;
  is_system: boolean;
  is_active: boolean;
  permissions: string[];
  created_at: string;
}

export interface CreateRoleInput {
  code: string;
  name: string;
  description?: string;
}

export interface UpdateRoleInput {
  code?: string;
  name?: string;
  description?: string | null;
  is_active?: boolean;
}

export class RoleRepository {
  async listRoles(companyId: string): Promise<RoleRecord[]> {
    const result = await pool.query<RoleRecord>(
      `
      select
        r.id,
        r.code,
        r.name,
        r.description,
        r.company_id,
        r.is_system,
        r.is_active,
        coalesce(array_agg(distinct coalesce(rp.permission_code, p.code)) filter (where coalesce(rp.permission_code, p.code) is not null), '{}'::text[]) as permissions,
        r.created_at::text
      from roles r
      left join role_permissions rp on rp.role_id = r.id
      left join permissions p on p.id = rp.permission_id
      where r.is_system = true
         or r.company_id = $1
      group by r.id
      order by r.is_system desc, r.created_at asc
      `,
      [companyId],
    );
    return result.rows;
  }

  async getRoleById(roleId: string, companyId: string): Promise<RoleRecord | null> {
    const result = await pool.query<RoleRecord>(
      `
      select
        r.id,
        r.code,
        r.name,
        r.description,
        r.company_id,
        r.is_system,
        r.is_active,
        coalesce(array_agg(distinct coalesce(rp.permission_code, p.code)) filter (where coalesce(rp.permission_code, p.code) is not null), '{}'::text[]) as permissions,
        r.created_at::text
      from roles r
      left join role_permissions rp on rp.role_id = r.id
      left join permissions p on p.id = rp.permission_id
      where r.id = $1
        and (r.is_system = true or r.company_id = $2)
      group by r.id
      `,
      [roleId, companyId],
    );
    return result.rows[0] ?? null;
  }

  async createRole(companyId: string, data: CreateRoleInput): Promise<RoleRecord> {
    const result = await pool.query<{ id: string }>(
      `
      insert into roles(code, name, description, company_id, is_system, is_active)
      values ($1, $2, $3, $4, false, true)
      returning id
      `,
      [data.code, data.name, data.description ?? null, companyId],
    );
    return (await this.getRoleById(result.rows[0].id, companyId)) as RoleRecord;
  }

  async updateRole(roleId: string, companyId: string, data: UpdateRoleInput): Promise<RoleRecord | null> {
    const role = await this.getRoleById(roleId, companyId);
    if (!role) return null;
    if (role.is_system) {
      if (data.code || data.name || typeof data.description !== 'undefined') {
        throw new Error('System roles are protected from identity edits.');
      }
    }

    await pool.query(
      `
      update roles
      set
        code = case when is_system then code else coalesce($3, code) end,
        name = case when is_system then name else coalesce($4, name) end,
        description = case
          when is_system then description
          when $5::text = '__NULL__' then null
          else coalesce($5, description)
        end,
        is_active = coalesce($6, is_active),
        updated_at = now()
      where id = $1
        and (is_system = true or company_id = $2)
      `,
      [
        roleId,
        companyId,
        data.code ?? null,
        data.name ?? null,
        typeof data.description === 'undefined' ? null : data.description ?? '__NULL__',
        data.is_active,
      ],
    );
    return this.getRoleById(roleId, companyId);
  }

  async deleteRole(roleId: string, companyId: string): Promise<boolean> {
    const role = await this.getRoleById(roleId, companyId);
    if (!role) return false;
    if (role.is_system) {
      throw new Error('System roles cannot be deleted.');
    }
    const usersUsingRole = await pool.query(
      `
      select 1
      from users
      where role_id = $1
      limit 1
      `,
      [roleId],
    );
    if ((usersUsingRole.rowCount ?? 0) > 0) {
      throw new Error('Role is assigned to users and cannot be deleted.');
    }

    await pool.query('delete from role_permissions where role_id = $1', [roleId]);
    const result = await pool.query(
      `
      delete from roles
      where id = $1
        and company_id = $2
        and is_system = false
      `,
      [roleId, companyId],
    );
    return (result.rowCount ?? 0) > 0;
  }

  async assignPermissions(roleId: string, permissionCodes: string[]): Promise<void> {
    const permissions = await pool.query<{ id: string; code: string }>(
      `
      select id, code
      from permissions
      where code = any($1::text[])
        and is_active = true
      `,
      [permissionCodes],
    );
    if (permissions.rowCount !== permissionCodes.length) {
      throw new Error('One or more permission codes are invalid.');
    }

    await pool.query('delete from role_permissions where role_id = $1', [roleId]);
    for (const permission of permissions.rows) {
      await pool.query(
        `
        insert into role_permissions(role_id, permission_id, permission_code)
        values ($1, $2, $3)
        on conflict (role_id, permission_id) do update
        set permission_code = excluded.permission_code
        `,
        [roleId, permission.id, permission.code],
      );
    }
  }

  async getRolePermissions(roleId: string): Promise<string[]> {
    const result = await pool.query<{ permission_code: string | null; code: string | null }>(
      `
      select rp.permission_code, p.code
      from role_permissions rp
      left join permissions p on p.id = rp.permission_id
      where rp.role_id = $1
      `,
      [roleId],
    );
    return result.rows.map((row) => row.permission_code ?? row.code).filter((code): code is string => Boolean(code));
  }

  async listPermissionCodes(): Promise<string[]> {
    const result = await pool.query<{ code: string }>(
      `
      select code
      from permissions
      where is_active = true
      order by code asc
      `,
    );
    return result.rows.map((row) => row.code);
  }
}
