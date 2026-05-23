import { Router } from 'express';
import { asyncHandler } from '../utils/http.js';
import { requirePermissions } from '../middleware/authorization.js';
import { pool } from '../db/pool.js';
import { HttpError } from '../utils/errors.js';

function requireCompanyId(req: any): string {
  const companyId = req.requestUserContext?.companyId as string | undefined;
  if (!companyId) throw new HttpError(403, 'Company scope is required.');
  return companyId;
}

export function createPermissionsRouter() {
  const router = Router();

  router.get(
    '/',
    requirePermissions(['permissions.view']),
    asyncHandler(async (_req, res) => {
      const result = await pool.query(
        `
        select code, name, module, action, is_active
        from permissions
        where is_active = true
        order by module asc, code asc
        `,
      );
      res.json({ success: true, data: result.rows });
    }),
  );

  router.get(
    '/overview',
    requirePermissions(['permissions.view']),
    asyncHandler(async (req, res) => {
      const companyId = requireCompanyId(req);
      const [users, roles, permissions, agents, branches] = await Promise.all([
        pool.query(
          `select count(*)::int as count from users where company_id = $1`,
          [companyId],
        ),
        pool.query(
          `select count(*)::int as count from roles where is_system = true or company_id = $1`,
          [companyId],
        ),
        pool.query(`select count(*)::int as count from permissions where is_active = true`),
        pool.query(
          `select count(*)::int as count from agents a join branches b on b.id = a.branch_id where b.company_id = $1`,
          [companyId],
        ),
        pool.query(
          `select count(*)::int as count from branches where company_id = $1`,
          [companyId],
        ),
      ]);

      res.json({
        success: true,
        data: {
          users: users.rows[0]?.count ?? 0,
          roles: roles.rows[0]?.count ?? 0,
          permissions: permissions.rows[0]?.count ?? 0,
          agents: agents.rows[0]?.count ?? 0,
          branches: branches.rows[0]?.count ?? 0,
        },
      });
    }),
  );

  return router;
}
