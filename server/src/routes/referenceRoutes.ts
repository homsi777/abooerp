import { Router, type RequestHandler } from 'express';
import { z } from 'zod';
import { asyncHandler } from '../utils/http.js';
import type { ReferenceService } from '../services/referenceService.js';
import { requireAnyPermissions, requirePermissions } from '../middleware/authorization.js';
import { parseDataScope } from '../utils/scope.js';

export function createReferenceRouter(options: {
  service: ReferenceService;
  createSchema: z.ZodTypeAny;
  updateSchema: z.ZodTypeAny;
  readPermissions: string[];
  writePermissions: string[];
  /** default 'all': user must have every read permission; 'any' = OR (e.g. parties OR shipments) */
  readMatch?: 'all' | 'any';
  /** default 'all'; 'any' = OR for POST/PUT/DELETE (e.g. parties.manage OR shipments.write) */
  writeMatch?: 'all' | 'any';
  /** When set, POST uses this guard instead of writeGuard (e.g. allow shipments.write for create only). */
  postGuard?: RequestHandler;
}) {
  const {
    service,
    createSchema,
    updateSchema,
    readPermissions,
    writePermissions,
    readMatch = 'all',
    writeMatch = 'all',
    postGuard: postGuardOption,
  } = options;
  const readGuard = readMatch === 'any' ? requireAnyPermissions(readPermissions) : requirePermissions(readPermissions);
  const writeGuard = writeMatch === 'any' ? requireAnyPermissions(writePermissions) : requirePermissions(writePermissions);
  const postGuard = postGuardOption ?? writeGuard;
  const router = Router();

  router.get(
    '/',
    readGuard,
    asyncHandler(async (req, res) => {
      const scope = parseDataScope(req);
      const companyId = (req as any).requestUserContext?.companyId as string | undefined;
      const items = await service.listScoped(scope, companyId);
      res.json({ success: true, data: items });
    }),
  );

  router.get(
    '/:id',
    readGuard,
    asyncHandler(async (req, res) => {
      const scope = parseDataScope(req);
      const companyId = (req as any).requestUserContext?.companyId as string | undefined;
      const id = String(req.params.id);
      const item = await service.getByIdScoped(id, scope, companyId);
      if (!item) {
        res.status(404).json({ success: false, error: 'Not found' });
        return;
      }
      res.json({ success: true, data: item });
    }),
  );

  router.post(
    '/',
    postGuard,
    asyncHandler(async (req, res) => {
      const payload = createSchema.parse(req.body) as Record<string, unknown>;
      const ctx = (req as any).requestUserContext as { userType?: string; scope?: { agentId?: string }; userId?: string; activeBranchId?: string } | undefined;
      if (ctx?.userType === 'agent' && ctx.scope?.agentId) {
        payload.agent_id = ctx.scope.agentId;
        const branchId = ctx.activeBranchId ?? (payload.branch_id as string | undefined);
        if (branchId) payload.branch_id = branchId;
        if (writePermissions.includes('parties.manage')) {
          (payload as Record<string, unknown>).created_by_user_id = ctx.userId;
        }
      }
      const item = await service.create(payload);
      res.status(201).json({ success: true, data: item });
    }),
  );

  router.put(
    '/:id',
    writeGuard,
    asyncHandler(async (req, res) => {
      const id = String(req.params.id);
      const payload = updateSchema.parse(req.body) as Record<string, unknown>;
      const item = await service.update(id, payload);
      if (!item) {
        res.status(404).json({ success: false, error: 'Not found' });
        return;
      }
      res.json({ success: true, data: item });
    }),
  );

  router.delete(
    '/:id',
    writeGuard,
    asyncHandler(async (req, res) => {
      const removed = await service.remove(String(req.params.id));
      if (!removed) {
        res.status(404).json({ success: false, error: 'Not found' });
        return;
      }
      res.json({ success: true });
    }),
  );

  return router;
}
