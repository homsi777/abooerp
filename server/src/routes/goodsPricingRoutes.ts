import { Router } from 'express';
import { z } from 'zod';
import { asyncHandler } from '../utils/http.js';
import { requirePermissions } from '../middleware/authorization.js';
import { HttpError } from '../utils/errors.js';
import { GoodsPricingService } from '../services/goodsPricing/service.js';

const uuid = z.string().uuid();

// Same permission pair that protects the existing (unused) tariffs
// management endpoints — reused per the task's instruction, no new roles.
const READ_PERMISSIONS = ['finance.read'];
const WRITE_PERMISSIONS = ['finance.write'];

function userIdFrom(req: any): string | null {
  return (req.requestUserContext?.userId as string | undefined) ?? null;
}

export function createGoodsPricingRouter(service: GoodsPricingService) {
  const router = Router();

  router.get(
    '/groups',
    requirePermissions(READ_PERMISSIONS),
    asyncHandler(async (_req, res) => {
      const rows = await service.listGroups();
      res.json({ success: true, data: rows });
    }),
  );

  router.post(
    '/groups',
    requirePermissions(WRITE_PERMISSIONS),
    asyncHandler(async (req, res) => {
      const body = z.object({ name: z.string().min(1), notes: z.string().nullable().optional() }).parse(req.body);
      const created = await service.createGroup(body, userIdFrom(req));
      res.status(201).json({ success: true, data: created });
    }),
  );

  router.patch(
    '/groups/:id',
    requirePermissions(WRITE_PERMISSIONS),
    asyncHandler(async (req, res) => {
      const body = z
        .object({ name: z.string().min(1).optional(), notes: z.string().nullable().optional(), isActive: z.boolean().optional() })
        .parse(req.body);
      const updated = await service.updateGroup(uuid.parse(req.params.id), body, userIdFrom(req));
      res.json({ success: true, data: updated });
    }),
  );

  router.put(
    '/groups/:id/price',
    requirePermissions(WRITE_PERMISSIONS),
    asyncHandler(async (req, res) => {
      const body = z.object({ pricingUnit: z.string(), unitPriceUsd: z.union([z.string(), z.number()]) }).parse(req.body);
      const saved = await service.setGroupPrice(uuid.parse(req.params.id), body, userIdFrom(req));
      res.json({ success: true, data: saved });
    }),
  );

  router.delete(
    '/groups/:id/price',
    requirePermissions(WRITE_PERMISSIONS),
    asyncHandler(async (req, res) => {
      await service.deactivateGroupPrice(uuid.parse(req.params.id), userIdFrom(req));
      res.json({ success: true });
    }),
  );

  router.get(
    '/unclassified',
    requirePermissions(READ_PERMISSIONS),
    asyncHandler(async (req, res) => {
      const query = z
        .object({ search: z.string().optional(), page: z.coerce.number().int().min(1).default(1), pageSize: z.coerce.number().int().min(1).max(200).default(50) })
        .parse(req.query);
      const result = await service.listUnclassified(query.search, query.page, query.pageSize);
      res.json({ success: true, data: result.rows, total: result.total, page: query.page, pageSize: query.pageSize });
    }),
  );

  router.get(
    '/coverage',
    requirePermissions(READ_PERMISSIONS),
    asyncHandler(async (_req, res) => {
      const coverage = await service.getCoverage();
      res.json({ success: true, data: coverage });
    }),
  );

  router.post(
    '/groups/:id/members',
    requirePermissions(WRITE_PERMISSIONS),
    asyncHandler(async (req, res) => {
      const body = z.object({ goodsTypeIds: z.array(uuid).min(1) }).parse(req.body);
      await service.addMembers(uuid.parse(req.params.id), body.goodsTypeIds, userIdFrom(req));
      res.json({ success: true });
    }),
  );

  router.delete(
    '/groups/:id/members/:goodsTypeId',
    requirePermissions(WRITE_PERMISSIONS),
    asyncHandler(async (req, res) => {
      await service.removeMember(uuid.parse(req.params.id), uuid.parse(req.params.goodsTypeId));
      res.json({ success: true });
    }),
  );

  router.get(
    '/parties',
    requirePermissions(READ_PERMISSIONS),
    asyncHandler(async (req, res) => {
      const query = z
        .object({ search: z.string().optional(), page: z.coerce.number().int().min(1).default(1), pageSize: z.coerce.number().int().min(1).max(100).default(30) })
        .parse(req.query);
      if (query.search && query.search.trim().length > 0 && query.search.trim().length < 2) {
        throw new HttpError(400, 'يلزم حرفان على الأقل للبحث.');
      }
      const rows = await service.searchParties(query.search, query.page, query.pageSize);
      res.json({ success: true, data: rows });
    }),
  );

  router.get(
    '/parties/:partyId/prices',
    requirePermissions(READ_PERMISSIONS),
    asyncHandler(async (req, res) => {
      const rows = await service.getPartyPrices(uuid.parse(req.params.partyId));
      res.json({ success: true, data: rows });
    }),
  );

  router.put(
    '/parties/:partyId/prices/:groupId',
    requirePermissions(WRITE_PERMISSIONS),
    asyncHandler(async (req, res) => {
      const body = z.object({ pricingUnit: z.string(), unitPriceUsd: z.union([z.string(), z.number()]) }).parse(req.body);
      const saved = await service.setPartyPrice(uuid.parse(req.params.partyId), uuid.parse(req.params.groupId), body, userIdFrom(req));
      res.json({ success: true, data: saved });
    }),
  );

  router.delete(
    '/parties/:partyId/prices/:groupId',
    requirePermissions(WRITE_PERMISSIONS),
    asyncHandler(async (req, res) => {
      await service.deactivatePartyPrice(uuid.parse(req.params.partyId), uuid.parse(req.params.groupId), userIdFrom(req));
      res.json({ success: true });
    }),
  );

  router.get(
    '/history',
    requirePermissions(READ_PERMISSIONS),
    asyncHandler(async (req, res) => {
      const query = z.object({ page: z.coerce.number().int().min(1).default(1), pageSize: z.coerce.number().int().min(1).max(200).default(50) }).parse(req.query);
      const rows = await service.listHistory(query.page, query.pageSize);
      res.json({ success: true, data: rows });
    }),
  );

  return router;
}
