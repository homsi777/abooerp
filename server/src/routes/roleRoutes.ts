import { Router } from 'express';
import { z } from 'zod';
import { requirePermissions } from '../middleware/authorization.js';
import { RoleRepository } from '../repositories/roleRepository.js';
import { asyncHandler } from '../utils/http.js';
import { HttpError } from '../utils/errors.js';
import { AuditService } from '../services/auditService.js';

const createRoleSchema = z.object({
  code: z.string().min(2),
  name: z.string().min(1),
  description: z.string().optional(),
});

const updateRoleSchema = z.object({
  code: z.string().min(2).optional(),
  name: z.string().min(1).optional(),
  description: z.string().nullable().optional(),
  is_active: z.boolean().optional(),
});

const assignPermissionsSchema = z.object({
  permissionCodes: z.array(z.string().min(1)),
});

function requireCompanyId(req: any): string {
  const companyId = req.requestUserContext?.companyId as string | undefined;
  if (!companyId) {
    throw new HttpError(403, 'Company scope is required.');
  }
  return companyId;
}

export function createRoleRouter(repository: RoleRepository) {
  const router = Router();
  const auditService = new AuditService();

  router.get(
    '/',
    requirePermissions(['settings.roles.read']),
    asyncHandler(async (req, res) => {
      const companyId = requireCompanyId(req);
      const [roles, permissionCodes] = await Promise.all([
        repository.listRoles(companyId),
        repository.listPermissionCodes(),
      ]);
      res.json({
        success: true,
        data: {
          roles,
          permissionCodes,
        },
      });
    }),
  );

  router.post(
    '/',
    requirePermissions(['settings.roles.write', 'permissions.manage']),
    asyncHandler(async (req, res) => {
      const companyId = requireCompanyId(req);
      const payload = createRoleSchema.parse(req.body);
      const data = await repository.createRole(companyId, payload);
      auditService.logAsync({
        req,
        action: 'ROLE_CREATED',
        entityType: 'role',
        entityId: data.id,
        metadata: {
          code: data.code,
          name: data.name,
        },
      });
      res.status(201).json({ success: true, data });
    }),
  );

  router.put(
    '/:id',
    requirePermissions(['settings.roles.write', 'permissions.manage']),
    asyncHandler(async (req, res) => {
      const companyId = requireCompanyId(req);
      const payload = updateRoleSchema.parse(req.body);
      const data = await repository.updateRole(String(req.params.id), companyId, payload);
      if (!data) {
        res.status(404).json({ success: false, error: 'Role not found.' });
        return;
      }
      auditService.logAsync({
        req,
        action: 'ROLE_UPDATED',
        entityType: 'role',
        entityId: String(req.params.id),
        metadata: {
          changedFields: Object.keys(payload),
        },
      });
      res.json({ success: true, data });
    }),
  );

  router.delete(
    '/:id',
    requirePermissions(['settings.roles.write', 'permissions.manage']),
    asyncHandler(async (req, res) => {
      const companyId = requireCompanyId(req);
      const ok = await repository.deleteRole(String(req.params.id), companyId);
      if (!ok) {
        res.status(404).json({ success: false, error: 'Role not found.' });
        return;
      }
      auditService.logAsync({
        req,
        action: 'ROLE_DELETED',
        entityType: 'role',
        entityId: String(req.params.id),
      });
      res.json({ success: true });
    }),
  );

  router.post(
    '/:id/permissions',
    requirePermissions(['settings.roles.write', 'permissions.manage']),
    asyncHandler(async (req, res) => {
      const companyId = requireCompanyId(req);
      const roleId = String(req.params.id);
      const role = await repository.getRoleById(roleId, companyId);
      if (!role) {
        res.status(404).json({ success: false, error: 'Role not found.' });
        return;
      }
      const payload = assignPermissionsSchema.parse(req.body);
      await repository.assignPermissions(roleId, payload.permissionCodes);
      const data = await repository.getRoleById(roleId, companyId);
      auditService.logAsync({
        req,
        action: 'ROLE_PERMISSIONS_UPDATED',
        entityType: 'role',
        entityId: roleId,
        metadata: {
          permissionCodes: payload.permissionCodes,
        },
      });
      res.json({ success: true, data });
    }),
  );

  return router;
}
