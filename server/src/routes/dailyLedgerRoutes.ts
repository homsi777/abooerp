import express from 'express';
import { z } from 'zod';
import { requirePermissions } from '../middleware/authorization.js';
import { parseDataScope } from '../utils/scope.js';
import { DailyLedgerService } from '../services/dailyLedgerService.js';

const uuid = z.string().uuid();

function todayIsoDate(): string {
  return new Date().toISOString().slice(0, 10);
}

function assertLedgerDateAllowed(roleCode: string, userType: string, ledgerDate: string) {
  const today = todayIsoDate();
  const isAdmin = roleCode === 'admin' || userType === 'admin';
  const isManager = isAdmin || roleCode === 'general_manager' || roleCode === 'branch_manager';
  if (ledgerDate > today) {
    throw new Error('لا يمكن إدخال بيانات بتاريخ مستقبلي.');
  }
  if (roleCode === 'data_entry' && ledgerDate !== today) {
    throw new Error('مدخل البيانات يعمل على تاريخ اليوم فقط. للتواريخ السابقة يستخدم المدير حسابه.');
  }
  if (!isManager && ledgerDate < today) {
    throw new Error('لا يمكن إدخال بيانات بتاريخ سابق إلا من حساب المدير.');
  }
}

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
        dateFrom: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
        dateTo: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
        lineLabel: z.string().optional(),
        driverId: uuid.optional(),
        vehicleId: uuid.optional(),
        includeLoaded: z.coerce.boolean().optional(),
        q: z.string().optional(),
        limit: z.coerce.number().min(1).max(10000).optional(),
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
        dateFrom: q.dateFrom,
        dateTo: q.dateTo,
        lineLabel: q.lineLabel,
        driverId: q.driverId,
        vehicleId: q.vehicleId,
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
        driverId: uuid.nullable().optional(),
        vehicleId: uuid.nullable().optional(),
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
        rowId: uuid.optional(),
      });
      const input = bodySchema.parse(req.body);
      try {
        assertLedgerDateAllowed(roleCode, userType, input.ledgerDate);
      } catch (dateError) {
        res.status(400).json({
          success: false,
          error: dateError instanceof Error ? dateError.message : 'تاريخ الدفتر غير مسموح.',
        });
        return;
      }
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

  router.post(
    '/rows/post-shipments',
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
        rowIds: z.array(uuid).optional(),
      });
      const input = bodySchema.parse(req.body);
      try {
        assertLedgerDateAllowed(roleCode, userType, input.ledgerDate);
      } catch (dateError) {
        res.status(400).json({
          success: false,
          error: dateError instanceof Error ? dateError.message : 'تاريخ الدفتر غير مسموح.',
        });
        return;
      }
      if (allowedBranchIds.length && !allowedBranchIds.includes(input.branchId) && roleCode !== 'admin' && userType !== 'admin') {
        res.status(403).json({ success: false, error: 'Requested branch scope is not allowed for this user.' });
        return;
      }
      if (roleCode === 'data_entry' && lockedBranchId && input.branchId !== lockedBranchId) {
        res.status(403).json({ success: false, error: 'لا يمكن لمدخل البيانات الحفظ على فرع مختلف عن الفرع التابع له.' });
        return;
      }

      const result = await service.postPendingShipments(scope, input, allowedBranchIds);
      res.json({ success: true, data: result });
    },
  );

  return router;
}
