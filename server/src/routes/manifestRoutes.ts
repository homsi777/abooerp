import { Router } from 'express';
import { z } from 'zod';
import { asyncHandler } from '../utils/http.js';
import type { ManifestService } from '../services/manifestService.js';
import { parseDataScope } from '../utils/scope.js';
import { emit } from '../events/eventBus.js';
import { requirePermissions } from '../middleware/authorization.js';
import { requireIdempotencyKey } from '../middleware/idempotency.js';
import { AuditService } from '../services/auditService.js';

const manifestCreateSchema = z.object({
  manifestNo: z.string().min(1),
  branchId: z.string().uuid(),
  vehicleId: z.string().uuid().optional(),
  driverId: z.string().uuid().optional(),
  status: z.enum(['created', 'dispatched', 'closed', 'cancelled']).default('created'),
  createdBy: z.string().uuid().optional(),
  shipmentIds: z.array(z.string().uuid()).optional(),
  expectedUpdatedAt: z.string().datetime({ offset: true }).optional(),
});

const manifestUpdateSchema = manifestCreateSchema.partial();

export function createManifestRouter(service: ManifestService) {
  const router = Router();
  const auditService = new AuditService();

  router.get(
    '/',
    requirePermissions(['manifests.read']),
    asyncHandler(async (req, res) => {
      const items = await service.list(parseDataScope(req));
      res.json({ success: true, data: items });
    }),
  );

  router.get(
    '/:id',
    requirePermissions(['manifests.read']),
    asyncHandler(async (req, res) => {
      const item = await service.getById(String(req.params.id), parseDataScope(req));
      if (!item) {
        res.status(404).json({ success: false, error: 'Manifest not found' });
        return;
      }
      res.json({ success: true, data: item });
    }),
  );

  router.post(
    '/',
    requirePermissions(['manifests.write']),
    requireIdempotencyKey('manifests.create'),
    asyncHandler(async (req, res) => {
      const scope = parseDataScope(req);
      try {
        const payload = manifestCreateSchema.parse(req.body);
        const item = await service.create(payload, scope);
        auditService.logAsync({
          req,
          action: 'MANIFEST_CREATED',
          entityType: 'manifest',
          entityId: item.id,
          metadata: {
            manifestNo: item.manifest_no,
            branchId: item.branch_id,
            status: item.status,
            shipmentCount: payload.shipmentIds?.length ?? 0,
          },
        });
        emit({ type: 'manifest.updated', companyId: scope.companyId ?? '', branchId: item.branch_id ?? null, entityId: item.id, timestamp: new Date().toISOString(), correlationId: (req as any).correlationId });
        res.status(201).json({ success: true, data: item });
      } catch (error) {
        auditService.logAsync({
          req,
          action: 'MANIFEST_CREATE_FAILED',
          entityType: 'manifest',
          metadata: { reason: (error as any)?.message ?? 'unknown' },
        });
        throw error;
      }
    }),
  );

  router.put(
    '/:id',
    requirePermissions(['manifests.write']),
    requireIdempotencyKey('manifests.update'),
    asyncHandler(async (req, res) => {
      const scope = parseDataScope(req);
      try {
        const payload = manifestUpdateSchema.parse(req.body);
        const item = await service.update(String(req.params.id), payload, scope);
        if (!item) {
          res.status(404).json({ success: false, error: 'Manifest not found' });
          return;
        }
        const isStatusChange = Boolean(payload.status);
        auditService.logAsync({
          req,
          action: isStatusChange ? 'MANIFEST_EXECUTED' : 'MANIFEST_UPDATED',
          entityType: 'manifest',
          entityId: item.id,
          metadata: {
            manifestNo: item.manifest_no,
            status: item.status,
            shipmentCount: payload.shipmentIds?.length,
          },
        });
        emit({ type: 'manifest.updated', companyId: scope.companyId ?? '', branchId: item.branch_id ?? null, entityId: item.id, timestamp: new Date().toISOString(), correlationId: (req as any).correlationId });
        res.json({ success: true, data: item });
      } catch (error) {
        auditService.logAsync({
          req,
          action: 'MANIFEST_UPDATE_FAILED',
          entityType: 'manifest',
          entityId: String(req.params.id),
          metadata: { reason: (error as any)?.message ?? 'unknown' },
        });
        throw error;
      }
    }),
  );

  router.delete(
    '/:id',
    requirePermissions(['manifests.write']),
    asyncHandler(async (req, res) => {
      const scope = parseDataScope(req);
      const removed = await service.remove(String(req.params.id), scope);
      if (!removed) {
        res.status(404).json({ success: false, error: 'Manifest not found' });
        return;
      }
      auditService.logAsync({
        req,
        action: 'MANIFEST_DELETED',
        entityType: 'manifest',
        entityId: String(req.params.id),
        metadata: {},
      });
      res.json({ success: true });
    }),
  );

  return router;
}
