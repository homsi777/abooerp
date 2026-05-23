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

/** سجل أحداث تفصيلي — صلاحية admin.events.read (مدير النظام فقط افتراضياً). */
export function createAdminActivityRouter(service: AuditService) {
  const router = Router();

  router.get(
    '/',
    requirePermissions(['admin.events.read']),
    asyncHandler(async (req, res) => {
      const companyId = requireCompanyId(req);
      const filters = filtersSchema.parse(req.query);
      const logs = await service.listEnriched(companyId, filters, parseDataScope(req));
      res.json({ success: true, data: logs });
    }),
  );

  return router;
}
