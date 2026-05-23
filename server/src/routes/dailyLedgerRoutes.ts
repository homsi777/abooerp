import express from 'express';
import { z } from 'zod';
import { requirePermissions } from '../middleware/authorization.js';
import { parseDataScope } from '../utils/scope.js';
import { DailyLedgerService } from '../services/dailyLedgerService.js';

const uuid = z.string().uuid();

export function createDailyLedgerRouter(service: DailyLedgerService) {
  const router = express.Router();

  router.get(
    '/rows',
    requirePermissions(['shipments.read']),
    async (req, res) => {
      const userContext = (req as any).requestUserContext as any;
      const allowedBranchIds: string[] = Array.isArray(userContext?.allowedBranchIds) ? userContext.allowedBranchIds : [];
      const roleCode = String(userContext?.roleCode ?? '').toLowerCase();
      const userType = String(userContext?.userType ?? '').toLowerCase();
      const lockedBranchId =
        (typeof userContext?.activeBranchId === 'string' ? userContext.activeBranchId : undefined) ??
        (typeof userContext?.scope?.branchId === 'string' ? userContext.scope.branchId : undefined) ??
        allowedBranchIds[0] ??
        null;
      const scope = parseDataScope(req);
      const querySchema = z.object({
        branchId: uuid.optional(),
        ledgerDate: z.string().optional(),
        lineLabel: z.string().optional(),
        includeLoaded: z.coerce.boolean().optional(),
        q: z.string().optional(),
        limit: z.coerce.number().min(1).max(500).optional(),
        offset: z.coerce.number().min(0).optional(),
      });
      const q = querySchema.parse(req.query);
      const effectiveBranchId = q.branchId ?? lockedBranchId;
      if (!effectiveBranchId) {
        res.status(400).json({ success: false, error: 'branchId is required.' });
        return;
      }
      if (allowedBranchIds.length && !allowedBranchIds.includes(effectiveBranchId) && roleCode !== 'admin' && userType !== 'admin') {
        res.status(403).json({ success: false, error: 'Requested branch scope is not allowed for this user.' });
        return;
      }
      if (roleCode === 'data_entry' && lockedBranchId && effectiveBranchId !== lockedBranchId) {
        res.status(403).json({ success: false, error: 'لا يمكن لمدخل البيانات عرض فرع مختلف عن الفرع التابع له.' });
        return;
      }

      const rows = await service.listRows(scope, {
        branchId: effectiveBranchId,
        ledgerDate: q.ledgerDate,
        lineLabel: q.lineLabel,
        includeLoaded: q.includeLoaded ?? false,
        q: q.q,
        limit: q.limit ?? 250,
        offset: q.offset ?? 0,
      });
      res.json({ success: true, data: rows });
    },
  );

  router.post(
    '/rows/upsert',
    requirePermissions(['shipments.write']),
    async (req, res) => {
      const userContext = (req as any).requestUserContext as any;
      const allowedBranchIds: string[] = Array.isArray(userContext?.allowedBranchIds) ? userContext.allowedBranchIds : [];
      const roleCode = String(userContext?.roleCode ?? '').toLowerCase();
      const userType = String(userContext?.userType ?? '').toLowerCase();
      const lockedBranchId =
        (typeof userContext?.activeBranchId === 'string' ? userContext.activeBranchId : undefined) ??
        (typeof userContext?.scope?.branchId === 'string' ? userContext.scope.branchId : undefined) ??
        allowedBranchIds[0] ??
        null;
      const scope = parseDataScope(req);
      const bodySchema = z.object({
        branchId: uuid,
        ledgerDate: z.string().min(1),
        lineLabel: z.string().min(1),
        originLabel: z.string().optional(),
        tripNo: z.string().nullable().optional(),
        vehicleLabel: z.string().nullable().optional(),
        driverLabel: z.string().nullable().optional(),
        rowNo: z.coerce.number().int().min(1),
        receiptNo: z.string().nullable().optional(),
        destination: z.string().optional(),
        parcelType: z.string().optional(),
        parcelCount: z.coerce.number().int().min(1).nullable().optional(),
        weightKg: z.coerce.number().nullable().optional(),
        senderName: z.string().optional(),
        receiverName: z.string().optional(),
        collectAmountUsd: z.coerce.number().optional(),
        prepaidAmountUsd: z.coerce.number().optional(),
        hawalaAmountUsd: z.coerce.number().optional(),
        feesAmountUsd: z.coerce.number().optional(),
        transferServiceFeeUsd: z.coerce.number().optional(),
        notes: z.string().nullable().optional(),
      });
      const input = bodySchema.parse(req.body);
      if (allowedBranchIds.length && !allowedBranchIds.includes(input.branchId) && roleCode !== 'admin' && userType !== 'admin') {
        res.status(403).json({ success: false, error: 'Requested branch scope is not allowed for this user.' });
        return;
      }
      if (roleCode === 'data_entry' && lockedBranchId && input.branchId !== lockedBranchId) {
        res.status(403).json({ success: false, error: 'لا يمكن لمدخل البيانات الحفظ على فرع مختلف عن الفرع التابع له.' });
        return;
      }

      const row = await service.upsertRow(scope, {
        ...input,
      });
      res.json({ success: true, data: row });
    },
  );

  router.post(
    '/rows/:id/post',
    requirePermissions(['shipments.write']),
    async (req, res) => {
      const userContext = (req as any).requestUserContext as any;
      const allowedBranchIds: string[] = Array.isArray(userContext?.allowedBranchIds) ? userContext.allowedBranchIds : [];
      const scope = parseDataScope(req);
      const paramsSchema = z.object({ id: uuid });
      const bodySchema = z.object({
        shipmentId: uuid,
        expectedUpdatedAt: z.string().optional(),
      });
      const params = paramsSchema.parse(req.params);
      const body = bodySchema.parse(req.body);

      const ok = await service.markPosted(
        scope,
        {
        rowId: params.id,
        shipmentId: body.shipmentId,
        expectedUpdatedAt: body.expectedUpdatedAt,
        },
        allowedBranchIds,
      );
      res.json({ success: true, data: { ok } });
    },
  );

  return router;
}
