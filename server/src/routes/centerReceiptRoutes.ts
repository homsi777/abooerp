import { Router } from 'express';
import { z } from 'zod';
import type { CenterReceiptService } from '../services/centerReceiptService.js';
import { requirePermissions } from '../middleware/authorization.js';
import { requireIdempotencyKey } from '../middleware/idempotency.js';
import { asyncHandler } from '../utils/http.js';
import { parseDataScope } from '../utils/scope.js';
import { AuditService } from '../services/auditService.js';
import { emit } from '../events/eventBus.js';

const centerReceiptCreateSchema = z.object({
  shipmentId: z.string().uuid(),
  branchId: z.string().uuid().optional(),
  agentId: z.string().uuid().optional(),
  centerName: z.string().min(1),
  notes: z.string().optional(),
});

export function createCenterReceiptRouter(service: CenterReceiptService) {
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

  router.post(
    '/',
    requirePermissions(['deliveries.write']),
    requireIdempotencyKey('center-receipts.create'),
    asyncHandler(async (req, res) => {
      const scope = parseDataScope(req);
      const context = (req as any).requestUserContext;
      const payload = centerReceiptCreateSchema.parse(req.body);
      const item = await service.create(
        {
          ...payload,
          receivedByUserId: context?.userId,
        },
        scope,
      );
      auditService.logAsync({
        req,
        action: 'CENTER_RECEIPT_CREATED',
        entityType: 'center_receipt',
        entityId: item.id,
        metadata: {
          shipmentId: item.shipment_id,
          centerName: item.center_name,
          branchId: item.branch_id,
          agentId: item.agent_id,
        },
      });
      emit({
        type: 'shipment.updated',
        companyId: scope.companyId ?? '',
        branchId: item.branch_id ?? null,
        entityId: item.shipment_id,
        timestamp: new Date().toISOString(),
        correlationId: (req as any).correlationId,
      });
      res.status(201).json({ success: true, data: item });
    }),
  );

  return router;
}
