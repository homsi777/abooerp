import { Router } from 'express';
import { z } from 'zod';
import { requirePermissions } from '../middleware/authorization.js';
import { asyncHandler } from '../utils/http.js';
import { HttpError } from '../utils/errors.js';
import { parseDataScope } from '../utils/scope.js';
import type { ItemService } from '../services/itemService.js';

const ALLOWED_UNITS = ['piece', 'kg', 'g', 'liter', 'ml', 'meter', 'cm', 'box', 'pallet', 'set', 'other'] as const;

const itemCreateSchema = z.object({
  code: z.string().min(1).max(64),
  name: z.string().min(1).max(255),
  description: z.string().optional(),
  unit: z.enum(ALLOWED_UNITS).optional(),
  isActive: z.boolean().optional(),
});

const itemUpdateSchema = itemCreateSchema.partial();

function requireCompanyId(req: any): string {
  const companyId = req.requestUserContext?.companyId as string | undefined;
  if (!companyId) throw new HttpError(403, 'Company scope is required.');
  return companyId;
}

export function createItemRouter(service: ItemService) {
  const router = Router();

  router.get(
    '/',
    requirePermissions(['inventory.item.read']),
    asyncHandler(async (req, res) => {
      const scope = parseDataScope(req);
      const items = await service.list(scope);
      res.json({ success: true, data: items });
    }),
  );

  router.get(
    '/:id',
    requirePermissions(['inventory.item.read']),
    asyncHandler(async (req, res) => {
      const scope = parseDataScope(req);
      const item = await service.getById(String(req.params.id), scope);
      res.json({ success: true, data: item });
    }),
  );

  router.post(
    '/',
    requirePermissions(['inventory.item.write']),
    asyncHandler(async (req, res) => {
      const companyId = requireCompanyId(req);
      const scope = parseDataScope(req);
      const body = itemCreateSchema.parse(req.body);
      const item = await service.create({ ...body, companyId }, scope);
      res.status(201).json({ success: true, data: item });
    }),
  );

  router.put(
    '/:id',
    requirePermissions(['inventory.item.write']),
    asyncHandler(async (req, res) => {
      const scope = parseDataScope(req);
      const body = itemUpdateSchema.parse(req.body);
      const item = await service.update(String(req.params.id), body, scope);
      res.json({ success: true, data: item });
    }),
  );

  router.delete(
    '/:id',
    requirePermissions(['inventory.item.write']),
    asyncHandler(async (req, res) => {
      const scope = parseDataScope(req);
      const result = await service.remove(String(req.params.id), scope);
      res.json({ success: true, data: result });
    }),
  );

  return router;
}
