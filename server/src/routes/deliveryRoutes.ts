import { Router } from 'express';
import { z } from 'zod';
import type { DeliveryService } from '../services/deliveryService.js';
import { asyncHandler } from '../utils/http.js';
import { currencyCodeSchema } from '../utils/money.js';
import { emit } from '../events/eventBus.js';
import { parseDataScope } from '../utils/scope.js';
import { requirePermissions } from '../middleware/authorization.js';
import { requireIdempotencyKey } from '../middleware/idempotency.js';
import { AuditService } from '../services/auditService.js';
import { licenseGuard } from '../middleware/licenseGuard.js';

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
  expectedUpdatedAt: z.string().datetime({ offset: true }).optional(),
});

const deliveryUpdateSchema = deliveryCreateSchema.partial();

export function createDeliveryRouter(service: DeliveryService) {
  const router = Router();
  const auditService = new AuditService();

  router.get(
    '/',
    requirePermissions(['deliveries.read']),
    asyncHandler(async (req, res) => {
      const items = await service.list(parseDataScope(req));
      res.json({ success: true, data: items });
    }),
  );

  router.get(
    '/:id',
    requirePermissions(['deliveries.read']),
    asyncHandler(async (req, res) => {
      const item = await service.getById(String(req.params.id), parseDataScope(req));
      if (!item) {
        res.status(404).json({ success: false, error: 'Delivery not found' });
        return;
      }
      res.json({ success: true, data: item });
    }),
  );

  router.post(
    '/',
    requirePermissions(['deliveries.write']),
    licenseGuard('delivery'),
    requireIdempotencyKey('deliveries.create'),
    asyncHandler(async (req, res) => {
      const scope = parseDataScope(req);
      try {
        const payload = deliveryCreateSchema.parse(req.body);
        const item = await service.create(payload as any, scope);
        auditService.logAsync({
          req,
          action: 'DELIVERY_CREATED',
          entityType: 'delivery',
          entityId: item.id,
          metadata: {
            deliveryNo: item.delivery_no,
            shipmentId: item.shipment_id,
            status: item.status,
            branchId: item.branch_id,
            agentId: item.agent_id,
          },
        });
        if (item.status === 'delivered') {
          auditService.logAsync({
            req,
            action: 'SHIPMENT_STOCK_DEDUCTED',
            entityType: 'shipment',
            entityId: item.shipment_id,
            metadata: { deliveryId: item.id, deliveryNo: item.delivery_no, trigger: 'delivery_create' },
          });
        }
        emit({ type: 'delivery.updated', companyId: scope.companyId ?? '', branchId: item.branch_id ?? null, entityId: item.id, timestamp: new Date().toISOString(), correlationId: (req as any).correlationId });
        res.status(201).json({ success: true, data: item });
      } catch (error) {
        auditService.logAsync({
          req,
          action: 'DELIVERY_CREATE_FAILED',
          entityType: 'delivery',
          metadata: { reason: (error as any)?.message ?? 'unknown' },
        });
        throw error;
      }
    }),
  );

  router.put(
    '/:id',
    requirePermissions(['deliveries.write']),
    requireIdempotencyKey('deliveries.update'),
    asyncHandler(async (req, res) => {
      const scope = parseDataScope(req);
      try {
        const payload = deliveryUpdateSchema.parse(req.body);
        const item = await service.update(String(req.params.id), payload as any, scope);
        if (!item) {
          res.status(404).json({ success: false, error: 'Delivery not found' });
          return;
        }
        const isCompletion = item.status === 'delivered';
        auditService.logAsync({
          req,
          action: isCompletion ? 'DELIVERY_COMPLETED' : 'DELIVERY_UPDATED',
          entityType: 'delivery',
          entityId: item.id,
          metadata: {
            deliveryNo: item.delivery_no,
            shipmentId: item.shipment_id,
            newStatus: item.status,
            recipientName: item.recipient_name,
            updatedFields: Object.keys(payload),
          },
        });
        if (isCompletion) {
          auditService.logAsync({
            req,
            action: 'SHIPMENT_STOCK_DEDUCTED',
            entityType: 'shipment',
            entityId: item.shipment_id,
            metadata: {
              deliveryId: item.id,
              deliveryNo: item.delivery_no,
              shipmentId: item.shipment_id,
            },
          });
        }
        emit({ type: 'delivery.updated', companyId: scope.companyId ?? '', branchId: item.branch_id ?? null, entityId: item.id, timestamp: new Date().toISOString(), correlationId: (req as any).correlationId });
        res.json({ success: true, data: item });
      } catch (error) {
        auditService.logAsync({
          req,
          action: 'DELIVERY_UPDATE_FAILED',
          entityType: 'delivery',
          entityId: String(req.params.id),
          metadata: { reason: (error as any)?.message ?? 'unknown' },
        });
        throw error;
      }
    }),
  );

  router.delete(
    '/:id',
    requirePermissions(['deliveries.write']),
    asyncHandler(async (req, res) => {
      const scope = parseDataScope(req);
      const removed = await service.remove(String(req.params.id), scope);
      if (!removed) {
        res.status(404).json({ success: false, error: 'Delivery not found' });
        return;
      }
      auditService.logAsync({
        req,
        action: 'DELIVERY_DELETED',
        entityType: 'delivery',
        entityId: String(req.params.id),
        metadata: {},
      });
      res.json({ success: true });
    }),
  );

  return router;
}
