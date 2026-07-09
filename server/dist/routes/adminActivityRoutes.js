import { Router } from 'express';
import { z } from 'zod';
import { requirePermissions } from '../middleware/authorization.js';
import { asyncHandler } from '../utils/http.js';
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
function requireCompanyId(req) {
    const companyId = req.requestUserContext?.companyId;
    if (!companyId) {
        throw new HttpError(403, 'Company scope is required.');
    }
    return companyId;
}
/** سجل أحداث تفصيلي — صلاحية admin.events.read */
export function createAdminActivityRouter(service) {
    const router = Router();
    router.get('/summary', requirePermissions(['admin.events.read']), asyncHandler(async (req, res) => {
        const companyId = requireCompanyId(req);
        const filters = filtersSchema.parse(req.query);
        const rows = await service.listSummaryByUser(companyId, filters, parseDataScope(req));
        res.json({ success: true, data: rows });
    }));
    router.get('/', requirePermissions(['admin.events.read']), asyncHandler(async (req, res) => {
        const companyId = requireCompanyId(req);
        const filters = filtersSchema.parse(req.query);
        const logs = await service.listEnriched(companyId, filters, parseDataScope(req));
        res.json({ success: true, data: logs });
    }));
    router.get('/:id', requirePermissions(['admin.events.read']), asyncHandler(async (req, res) => {
        const companyId = requireCompanyId(req);
        const id = z.string().uuid().parse(req.params.id);
        const row = await service.getEnrichedById(companyId, id, parseDataScope(req));
        if (!row) {
            throw new HttpError(404, 'الحدث غير موجود.');
        }
        res.json({ success: true, data: row });
    }));
    return router;
}
