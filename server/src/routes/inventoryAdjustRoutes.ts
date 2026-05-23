import { Router } from 'express';
import { z } from 'zod';
import { requirePermissions } from '../middleware/authorization.js';
import { asyncHandler } from '../utils/http.js';
import { HttpError } from '../utils/errors.js';
import { parseDataScope } from '../utils/scope.js';
import { AuditService } from '../services/auditService.js';
import type { InventoryService } from '../services/inventoryService.js';

const adjustStockSchema = z.object({
  item_id: z.string().uuid(),
  warehouse_id: z.string().uuid(),
  quantity_delta: z.number().refine((n) => n !== 0, { message: 'quantity_delta must be non-zero.' }),
  reason: z.string().min(1).max(500),
});

function requireCompanyId(req: any): string {
  const companyId = req.requestUserContext?.companyId as string | undefined;
  if (!companyId) throw new HttpError(403, 'Company scope is required.');
  return companyId;
}

export function createInventoryAdjustRouter(inventoryService: InventoryService) {
  const router = Router();
  const auditService = new AuditService();

  /**
   * POST /api/v1/inventory/adjust-stock
   *
   * Directly adjusts item_stock.quantity_on_hand for admin corrections.
   * quantity_delta may be positive (receive stock) or negative (write-off).
   * Throws 409 if adjustment would cause negative on-hand stock.
   * Emits STOCK_ADJUSTED audit event.
   */
  router.post(
    '/inventory/adjust-stock',
    requirePermissions(['inventory.stock.write']),
    asyncHandler(async (req, res) => {
      const companyId = requireCompanyId(req);
      const userId = (req as any).requestUserContext?.userId as string | undefined;
      const body = adjustStockSchema.parse(req.body);

      const movement = await inventoryService.adjustStock(
        companyId,
        body.item_id,
        body.warehouse_id,
        body.quantity_delta,
        body.reason,
        userId,
      );

      auditService.logAsync({
        req,
        action: 'STOCK_ADJUSTED',
        entityType: 'item_stock',
        entityId: body.item_id,
        metadata: {
          itemId: body.item_id,
          warehouseId: body.warehouse_id,
          quantityDelta: body.quantity_delta,
          reason: body.reason,
          movementId: movement.id,
        },
      });

      res.status(201).json({ success: true, data: movement });
    }),
  );

  return router;
}
