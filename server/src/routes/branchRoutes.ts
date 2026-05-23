import { Router } from 'express';
import { z } from 'zod';
import { BranchRepository } from '../repositories/branchRepository.js';
import { asyncHandler } from '../utils/http.js';
import { requirePermissions } from '../middleware/authorization.js';
import { HttpError } from '../utils/errors.js';
import { AuditService } from '../services/auditService.js';

const createSchema = z.object({
  code: z.string().min(1),
  name: z.string().min(1),
  city: z.string().optional(),
  address: z.string().optional(),
  phone: z.string().optional(),
  is_active: z.boolean().optional(),
});

const updateSchema = createSchema.partial();

function requireCompanyId(req: any): string {
  const companyId = req.requestUserContext?.companyId as string | undefined;
  if (!companyId) {
    throw new HttpError(403, 'Company scope is required.');
  }
  return companyId;
}

function parseBoolFlag(value: unknown): boolean {
  if (typeof value !== 'string') return false;
  return value === '1' || value.toLowerCase() === 'true';
}

export function createBranchRouter(repository: BranchRepository) {
  const router = Router();
  const auditService = new AuditService();

  router.get(
    '/',
    requirePermissions(['settings.branches.read']),
    asyncHandler(async (req, res) => {
      const companyId = requireCompanyId(req);
      const includeInactive = parseBoolFlag(req.query.includeInactive);
      const data = await repository.listBranches(companyId, includeInactive);
      res.json({ success: true, data });
    }),
  );

  router.post(
    '/',
    requirePermissions(['settings.branches.write']),
    asyncHandler(async (req, res) => {
      const companyId = requireCompanyId(req);
      const payload = createSchema.parse(req.body);
      const data = await repository.createBranch(companyId, payload);
      auditService.logAsync({
        req,
        action: 'BRANCH_CREATED',
        entityType: 'branch',
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
    requirePermissions(['settings.branches.write']),
    asyncHandler(async (req, res) => {
      const companyId = requireCompanyId(req);
      const payload = updateSchema.parse(req.body);
      const data = await repository.updateBranch(String(req.params.id), companyId, payload);
      if (!data) {
        res.status(404).json({ success: false, error: 'Branch not found.' });
        return;
      }
      auditService.logAsync({
        req,
        action: 'BRANCH_UPDATED',
        entityType: 'branch',
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
    requirePermissions(['settings.branches.write']),
    asyncHandler(async (req, res) => {
      const companyId = requireCompanyId(req);
      const removed = await repository.deactivateBranch(String(req.params.id), companyId);
      if (!removed) {
        res.status(404).json({ success: false, error: 'Branch not found.' });
        return;
      }
      auditService.logAsync({
        req,
        action: 'BRANCH_DEACTIVATED',
        entityType: 'branch',
        entityId: String(req.params.id),
      });
      res.json({ success: true });
    }),
  );

  return router;
}
