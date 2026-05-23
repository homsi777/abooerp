import { Router } from 'express';
import { z } from 'zod';
import { requirePermissions } from '../middleware/authorization.js';
import { asyncHandler } from '../utils/http.js';
import { HttpError } from '../utils/errors.js';
import { AuditService } from '../services/auditService.js';
function requireCompanyId(req) {
    const companyId = req.requestUserContext?.companyId;
    if (!companyId)
        throw new HttpError(403, 'Company scope is required.');
    return companyId;
}
const updateSchema = z.object({
    terms: z.record(z.string(), z.string()),
});
export function createTerminologyRouter(service) {
    const router = Router();
    const auditService = new AuditService();
    router.get('/terminology-settings', requirePermissions(['settings.terminology.read']), asyncHandler(async (req, res) => {
        const companyId = requireCompanyId(req);
        const data = await service.get(companyId);
        res.json({ success: true, data: { terms: data } });
    }));
    router.put('/terminology-settings', requirePermissions(['settings.terminology.write']), asyncHandler(async (req, res) => {
        const companyId = requireCompanyId(req);
        const userId = req.requestUserContext?.userId;
        const payload = updateSchema.parse(req.body ?? {});
        const data = await service.update(companyId, payload.terms, userId ?? null);
        auditService.logAsync({
            req,
            action: 'TERMINOLOGY_UPDATED',
            entityType: 'terminology_settings',
            metadata: {
                keyCount: Object.keys(data).length,
            },
        });
        res.json({ success: true, data: { terms: data } });
    }));
    return router;
}
