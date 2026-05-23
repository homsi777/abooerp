import { Router } from 'express';
import { z } from 'zod';
import { asyncHandler } from '../utils/http.js';
import { currencyCodeSchema } from '../utils/money.js';
import { parseDataScope } from '../utils/scope.js';
import { requirePermissions } from '../middleware/authorization.js';
import { requireIdempotencyKey } from '../middleware/idempotency.js';
import { AuditService } from '../services/auditService.js';
const shipmentCreateSchema = z.object({
    shipmentNo: z.string().min(1),
    referenceNo: z.string().optional(),
    customerId: z.string().uuid().optional(),
    senderId: z.string().uuid(),
    receiverId: z.string().uuid(),
    branchId: z.string().uuid(),
    agentId: z.string().uuid().optional(),
    originCity: z.string().optional(),
    destinationCity: z.string().min(1),
    description: z.string().optional(),
    piecesCount: z.coerce.number().int().positive().default(1),
    weightKg: z.coerce.number().positive().optional(),
    status: z.enum(['created', 'in_transit', 'manifested', 'delivered', 'cancelled']).default('created'),
    originalAmount: z.coerce.number(),
    originalCurrency: currencyCodeSchema,
    exchangeRateToUsd: z.coerce.number().positive(),
    baseAmountUsd: z.coerce.number().optional(),
    createdBy: z.string().uuid().optional(),
    expectedUpdatedAt: z.string().datetime({ offset: true }).optional(),
});
const shipmentUpdateSchema = shipmentCreateSchema.partial();
export function createShipmentRouter(service) {
    const router = Router();
    const auditService = new AuditService();
    router.get('/', requirePermissions(['shipments.read']), asyncHandler(async (req, res) => {
        const items = await service.list(parseDataScope(req));
        res.json({ success: true, data: items });
    }));
    router.get('/:id', requirePermissions(['shipments.read']), asyncHandler(async (req, res) => {
        const item = await service.getById(String(req.params.id), parseDataScope(req));
        if (!item) {
            res.status(404).json({ success: false, error: 'Shipment not found' });
            return;
        }
        res.json({ success: true, data: item });
    }));
    router.post('/', requirePermissions(['shipments.write']), requireIdempotencyKey('shipments.create'), asyncHandler(async (req, res) => {
        try {
            const payload = shipmentCreateSchema.parse(req.body);
            const item = await service.create(payload, parseDataScope(req));
            res.status(201).json({ success: true, data: item });
        }
        catch (error) {
            auditService.logAsync({
                req,
                action: 'POST_FAILED',
                entityType: 'shipment',
                metadata: { reason: error?.message ?? 'unknown' },
            });
            throw error;
        }
    }));
    router.put('/:id', requirePermissions(['shipments.write']), requireIdempotencyKey('shipments.update'), asyncHandler(async (req, res) => {
        try {
            const payload = shipmentUpdateSchema.parse(req.body);
            const item = await service.update(String(req.params.id), payload, parseDataScope(req));
            if (!item) {
                res.status(404).json({ success: false, error: 'Shipment not found' });
                return;
            }
            res.json({ success: true, data: item });
        }
        catch (error) {
            auditService.logAsync({
                req,
                action: 'POST_FAILED',
                entityType: 'shipment',
                entityId: String(req.params.id),
                metadata: { reason: error?.message ?? 'unknown' },
            });
            throw error;
        }
    }));
    router.delete('/:id', requirePermissions(['shipments.write']), asyncHandler(async (req, res) => {
        const removed = await service.remove(String(req.params.id), parseDataScope(req));
        if (!removed) {
            res.status(404).json({ success: false, error: 'Shipment not found' });
            return;
        }
        res.json({ success: true });
    }));
    return router;
}
