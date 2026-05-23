import { pool } from '../db/pool.js';
export async function loadUserContextByUserId(userId) {
    const userResult = await pool.query(`
    select
      u.id,
      u.username,
      u.role_id,
      r.code as role_code,
      coalesce(array_agg(distinct coalesce(rp.permission_code, p.code)) filter (where coalesce(rp.permission_code, p.code) is not null), '{}'::text[]) as permissions,
      u.status,
      u.is_active,
      u.agent_id,
      u.company_id
    from users u
    join roles r on r.id = u.role_id
    left join role_permissions rp on rp.role_id = u.role_id
    left join permissions p on p.id = rp.permission_id and p.is_active = true
    where u.id = $1
    group by u.id, u.username, u.role_id, r.code, u.status, u.is_active, u.agent_id, u.company_id
    `, [userId]);
    if (!userResult.rowCount) {
        return null;
    }
    const user = userResult.rows[0];
    if (!user.is_active || user.status !== 'active') {
        return null;
    }
    let companyId = user.company_id;
    if (!companyId) {
        const companyResult = await pool.query(`
      select id
      from companies
      where is_active = true
      order by created_at asc
      limit 1
      `);
        companyId = companyResult.rows[0]?.id ?? null;
    }
    if (!companyId) {
        return null;
    }
    const allowedResult = await pool.query(`
    select ub.branch_id
    from user_branches ub
    join branches b on b.id = ub.branch_id
    where ub.user_id = $1
      and b.company_id = $2
      and b.is_active = true
    order by ub.created_at asc
    `, [user.id, companyId]);
    const allowedBranchIds = allowedResult.rows.map((row) => row.branch_id);
    const baseCurrencyResult = await pool.query(`
    select code
    from currencies
    where company_id = $1
      and is_base = true
      and is_active = true
    limit 1
    `, [companyId]);
    const baseCurrency = baseCurrencyResult.rows[0]?.code ?? 'USD';
    const effectiveBranchId = allowedBranchIds[0];
    return {
        userId: user.id,
        username: user.username,
        roleId: user.role_id,
        roleCode: user.role_code,
        permissions: user.permissions ?? [],
        status: user.status,
        companyId,
        baseCurrency,
        allowedBranchIds,
        scope: {
            branchId: effectiveBranchId ?? undefined,
            agentId: user.agent_id ?? undefined,
        },
    };
}
export function toAuthUserDto(context) {
    return {
        id: context.userId,
        username: context.username,
        role: context.roleCode,
        permissions: context.permissions,
        companyId: context.companyId,
        baseCurrency: context.baseCurrency,
        branchId: context.activeBranchId ?? context.scope.branchId ?? null,
        allowedBranchIds: context.allowedBranchIds,
    };
}
