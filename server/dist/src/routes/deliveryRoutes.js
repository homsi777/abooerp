import { Router } from 'express';
import { z } from 'zod';
import { asyncHandler } from '../utils/http.js';
import { currencyCodeSchema } from '../utils/money.js';
import { parseDataScope } from '../utils/scope.js';
import { requirePermissions } from '../middleware/authorization.js';
import { requireIdempotencyKey } from '../middleware/idempotency.js';
import { AuditService } from '../services/auditService.js';
const deliveryCreateSchema = z.object({
    deliveryNo: z.string().min(1),
    shipmentId: z.string().uuid(),
    branchId: z.string().uuid().optional(),
    agentId: z.string().uuid().optional(),
    operatorUserId: z.string().uuid().optional(),
    status: z.enum(['pending', 'delivered', 'failed', 'returned']).default('pending'),
    recipientName: z.string().optional(),
    receivedAt: z.string().datetime().optional(),
    notes: z.string().optional(),
    originalAmount: z.coerce.number(),
    originalCurrency: currencyCodeSchema,
    exchangeRateToUsd: z.coerce.number().positive(),
    baseAmountUsd: z.coerce.number().optional(),
});
const deliveryUpdateSchema = deliveryCreateSchema.partial();
export function createDeliveryRouter(service) {
    const router = Router();
    const auditService = new AuditService();
    router.get('/', requirePermissions(['deliveries.read']), asyncHandler(async (req, res) => {
        const items = await service.list(parseDataScope(req));
        res.json({ success: true, data: items });
    }));
    router.get('/:id', requirePermissions(['deliveries.read']), asyncHandler(async (req, res) => {
        const item = await service.getById(String(req.params.id), parseDataScope(req));
        if (!item) {
            res.status(404).json({ success: false, error: 'Delivery not found' });
            return;
        }
        res.json({ success: true, data: item });
    }));
    router.post('/', requirePermissions(['deliveries.write']), requireIdempotencyKey('deliveries.create'), asyncHandler(async (req, res) => {
        try {
            const payload = deliveryCreateSchema.parse(req.body);
            const item = await service.create(payload, parseDataScope(req));
            res.status(201).json({ success: true, data: item });
        }
        catch (error) {
            auditService.logAsync({
                req,
                action: 'STOCK_APPLY_FAILED',
                entityType: 'delivery',
                metadata: { reason: error?.message ?? 'unknown' },
            });
            throw error;
        }
    }));
    router.put('/:id', requirePermissions(['deliveries.write']), requireIdempotencyKey('deliveries.update'), asyncHandler(async (req, res) => {
        try {
            const payload = deliveryUpdateSchema.parse(req.body);
            const item = await service.update(String(req.params.id), payload, parseDataScope(req));
            if (!item) {
                res.status(404).json({ success: false, error: 'Delivery not found' });
                return;
            }
            res.json({ success: true, data: item });
        }
        catch (error) {
            auditService.logAsync({
                req,
                action: 'STOCK_APPLY_FAILED',
                entityType: 'delivery',
                entityId: String(req.params.id),
                metadata: { reason: error?.message ?? 'unknown' },
            });
            throw error;
        }
    }));
    router.delete('/:id', requirePermissions(['deliveries.write']), asyncHandler(async (req, res) => {
        const removed = await service.remove(String(req.params.id), parseDataScope(req));
        if (!removed) {
            res.status(404).json({ success: false, error: 'Delivery not found' });
            return;
        }
        res.json({ success: true });
    }));
    return router;
}
