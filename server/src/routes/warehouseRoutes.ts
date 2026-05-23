import { Router } from 'express';
import { z } from 'zod';
import { requirePermissions } from '../middleware/authorization.js';
import { asyncHandler } from '../utils/http.js';
import { HttpError } from '../utils/errors.js';
import { parseDataScope } from '../utils/scope.js';
import type { WarehouseService } from '../services/warehouseService.js';

const warehouseCreateSchema = z.object({
  code: z.string().min(1).max(64),
  name: z.string().min(1).max(255),
  address: z.string().optional(),
  branchId: z.string().uuid().optional(),
  isActive: z.boolean().optional(),
});

const warehouseUpdateSchema = warehouseCreateSchema.partial();

function requireCompanyId(req: any): string {
  const companyId = req.requestUserContext?.companyId as string | undefined;
  if (!companyId) throw new HttpError(403, 'Company scope is required.');
  return companyId;
}

export function createWarehouseRouter(service: WarehouseService) {
  const router = Router();

  router.get(
    '/',
    requirePermissions(['inventory.warehouse.read']),
    asyncHandler(async (req, res) => {
      const scope = parseDataScope(req);
      const warehouses = await service.list(scope);
      res.json({ success: true, data: warehouses });
    }),
  );

  router.get(
    '/:id',
    requirePermissions(['inventory.warehouse.read']),
    asyncHandler(async (req, res) => {
      const scope = parseDataScope(req);
      const warehouse = await service.getById(String(req.params.id), scope);
      res.json({ success: true, data: warehouse });
    }),
  );

  router.post(
    '/',
    requirePermissions(['inventory.warehouse.write']),
    asyncHandler(async (req, res) => {
      const companyId = requireCompanyId(req);
      const scope = parseDataScope(req);
      const body = warehouseCreateSchema.parse(req.body);
      const warehouse = await service.create({ ...body, companyId }, scope);
      res.status(201).json({ success: true, data: warehouse });
    }),
  );

  router.put(
    '/:id',
    requirePermissions(['inventory.warehouse.write']),
    asyncHandler(async (req, res) => {
      const scope = parseDataScope(req);
      const body = warehouseUpdateSchema.parse(req.body);
      const warehouse = await service.update(String(req.params.id), body, scope);
      res.json({ success: true, data: warehouse });
    }),
  );

  router.delete(
    '/:id',
    requirePermissions(['inventory.warehouse.write']),
    asyncHandler(async (req, res) => {
      const scope = parseDataScope(req);
      const result = await service.remove(String(req.params.id), scope);
      res.json({ success: true, data: result });
    }),
  );

  return router;
}
