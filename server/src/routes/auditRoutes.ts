import { Router } from 'express';
import { z } from 'zod';
import { requirePermissions } from '../middleware/authorization.js';
import { asyncHandler } from '../utils/http.js';
import { AuditService } from '../services/auditService.js';
import { HttpError } from '../utils/errors.js';
import { parseDataScope } from '../utils/scope.js';

const filtersSchema = z.object({
  fromAt: z.string().datetime({ offset: true }).optional(),
  toAt: z.string().datetime({ offset: true }).optional(),
  userId: z.string().uuid().optional(),
  entityType: z.string().optional(),
  action: z.string().optional(),
  branchId: z.string().uuid().optional(),
  limit: z.coerce.number().int().min(1).max(500).optional(),
});

function requireCompanyId(req: any): string {
  const companyId = req.requestUserContext?.companyId as string | undefined;
  if (!companyId) {
    throw new HttpError(403, 'Company scope is required.');
  }
  return companyId;
}

export function createAuditRouter(service: AuditService) {
  const router = Router();

  router.get(
    '/',
    requirePermissions(['settings.audit.read']),
    asyncHandler(async (req, res) => {
      const companyId = requireCompanyId(req);
      const filters = filtersSchema.parse(req.query);
      const logs = await service.list(companyId, filters, parseDataScope(req));
      res.json({ success: true, data: logs });
    }),
  );

  router.get(
    '/:id',
    requirePermissions(['settings.audit.read']),
    asyncHandler(async (req, res) => {
      const companyId = requireCompanyId(req);
      const row = await service.getById(String(req.params.id));
      if (!row || row.company_id !== companyId) {
        res.status(404).json({ success: false, error: 'Audit log not found.' });
        return;
      }
      const scope = parseDataScope(req);
      if (scope.branchId && row.branch_id && row.branch_id !== scope.branchId) {
        res.status(404).json({ success: false, error: 'Audit log not found.' });
        return;
      }
      res.json({ success: true, data: row });
    }),
  );

  return router;
}
