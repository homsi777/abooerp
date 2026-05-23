import { Router } from 'express';
import { z } from 'zod';
import { asyncHandler } from '../utils/http.js';
import { parseDataScope } from '../utils/scope.js';
import { requirePermissions } from '../middleware/authorization.js';
const manifestCreateSchema = z.object({
    manifestNo: z.string().min(1),
    branchId: z.string().uuid(),
    vehicleId: z.string().uuid().optional(),
    driverId: z.string().uuid().optional(),
    status: z.enum(['created', 'dispatched', 'closed', 'cancelled']).default('created'),
    createdBy: z.string().uuid().optional(),
    shipmentIds: z.array(z.string().uuid()).optional(),
});
const manifestUpdateSchema = manifestCreateSchema.partial();
export function createManifestRouter(service) {
    const router = Router();
    router.get('/', requirePermissions(['manifests.read']), asyncHandler(async (req, res) => {
        const items = await service.list(parseDataScope(req));
        res.json({ success: true, data: items });
    }));
    router.get('/:id', requirePermissions(['manifests.read']), asyncHandler(async (req, res) => {
        const item = await service.getById(String(req.params.id), parseDataScope(req));
        if (!item) {
            res.status(404).json({ success: false, error: 'Manifest not found' });
            return;
        }
        res.json({ success: true, data: item });
    }));
    router.post('/', requirePermissions(['manifests.write']), asyncHandler(async (req, res) => {
        const payload = manifestCreateSchema.parse(req.body);
        const item = await service.create(payload, parseDataScope(req));
        res.status(201).json({ success: true, data: item });
    }));
    router.put('/:id', requirePermissions(['manifests.write']), asyncHandler(async (req, res) => {
        const payload = manifestUpdateSchema.parse(req.body);
        const item = await service.update(String(req.params.id), payload, parseDataScope(req));
        if (!item) {
            res.status(404).json({ success: false, error: 'Manifest not found' });
            return;
        }
        res.json({ success: true, data: item });
    }));
    router.delete('/:id', requirePermissions(['manifests.write']), asyncHandler(async (req, res) => {
        const removed = await service.remove(String(req.params.id), parseDataScope(req));
        if (!removed) {
            res.status(404).json({ success: false, error: 'Manifest not found' });
            return;
        }
        res.json({ success: true });
    }));
    return router;
}
