import express from 'express';
import { z } from 'zod';
import { requirePermissions } from '../middleware/authorization.js';
import {
  canAccessAnyCompanyBranch,
  canUseDailyLedgerAction,
  canViewAllDailyLedgerEntries,
  dailyLedgerOwnerUserId,
  DAILY_LEDGER_DELETE_ROWS_PERMISSION,
  DAILY_LEDGER_POST_SHIPMENTS_PERMISSION,
  DAILY_LEDGER_CANCEL_SESSION_PERMISSION,
  DAILY_LEDGER_TRANSFER_CREATE_PERMISSION,
  DAILY_LEDGER_VIEW_LOADED_PERMISSION,
  isDailyLedgerScopedOperator,
} from '../utils/dailyLedgerAccess.js';
import { parseDataScope } from '../utils/scope.js';
import { DailyLedgerService } from '../services/dailyLedgerService.js';
import type { DailyLedgerTransferService } from '../services/dailyLedgerTransferService.js';
import { appendQuickLedgerClientLogs } from '../services/quickLedgerLogService.js';
import { HttpError } from '../utils/errors.js';
import { emit } from '../events/eventBus.js';

const uuid = z.string().uuid();

function todayIsoDate(): string {
  return new Date().toISOString().slice(0, 10);
}

function assertLedgerDateAllowed(
  roleCode: string,
  userType: string,
  ledgerDate: string,
  permissions: string[] = [],
) {
  const today = todayIsoDate();
  const isAdmin = roleCode === 'admin' || userType === 'admin';
  const isManager =
    isAdmin || roleCode === 'general_manager' || roleCode === 'branch_manager' || roleCode === 'manager';
  const canUsePastDates =
    isManager ||
    permissions.includes('shipments.ledger.past_dates') ||
    permissions.includes('daily_ledger.backdate.create');
  const canUseFutureDates =
    isManager || permissions.includes('shipments.ledger.future_dates');
  if (ledgerDate > today && !canUseFutureDates) {
    throw new Error('لا يمكن إدخال بيانات بتاريخ مستقبلي — يلزم صلاحية تاريخ مستقبلي لدفتر الشحن.');
  }
  if (ledgerDate !== today && !canUsePastDates) {
    throw new Error('لا يمكن العمل على تاريخ مختلف عن اليوم — يلزم صلاحية تعديل تاريخ دفتر الشحن.');
  }
}

function getRequestPermissions(req: unknown): string[] {
  const userContext = (req as { requestUserContext?: { permissions?: string[] } }).requestUserContext;
  return Array.isArray(userContext?.permissions) ? userContext.permissions : [];
}

/** صلاحية نقل الإرسالية — admin/مدير دائماً، أو من يملك الصلاحية صراحةً */
function canTransferLedger(roleCode: string, userType: string, permissions: string[]): boolean {
  return canUseDailyLedgerAction(roleCode, userType, permissions, DAILY_LEDGER_TRANSFER_CREATE_PERMISSION);
}

export function createDailyLedgerRouter(
  service: DailyLedgerService,
  transferService?: DailyLedgerTransferService,
) {
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
        onlyWithData: z.coerce.boolean().optional(),
        allBranches: z.coerce.boolean().optional(),
        q: z.string().optional(),
        limit: z.coerce.number().min(1).max(10000).optional(),
        offset: z.coerce.number().min(0).optional(),
      });
      const q = querySchema.parse(req.query);
      const permissions = getRequestPermissions(req);
      const viewAllEntries = canViewAllDailyLedgerEntries(roleCode, userType, permissions);
      const wantsAllBranches = q.allBranches === true;

      if (wantsAllBranches && !viewAllEntries) {
        res.status(403).json({
          success: false,
          error: 'عرض كل الفروع متاح للمدير فقط.',
        });
        return;
      }

      const effectiveBranchId = wantsAllBranches ? undefined : (q.branchId ?? lockedBranchId);
      if (!effectiveBranchId && !wantsAllBranches) {
        res.status(400).json({ success: false, error: 'branchId is required.' });
        return;
      }
      const branchBypass = roleCode === 'admin' || userType === 'admin' || canAccessAnyCompanyBranch(roleCode, userType);
      if (
        effectiveBranchId &&
        allowedBranchIds.length &&
        !allowedBranchIds.includes(effectiveBranchId) &&
        !branchBypass
      ) {
        res.status(403).json({ success: false, error: 'Requested branch scope is not allowed for this user.' });
        return;
      }
      if (isDailyLedgerScopedOperator(roleCode) && lockedBranchId && effectiveBranchId && effectiveBranchId !== lockedBranchId) {
        res.status(403).json({ success: false, error: 'لا يمكن عرض فرع مختلف عن الفرع التابع لك.' });
        return;
      }

      const canViewLoadedRows = canUseDailyLedgerAction(
        roleCode,
        userType,
        permissions,
        DAILY_LEDGER_VIEW_LOADED_PERMISSION,
      );
      const includeLoaded = canViewLoadedRows ? q.includeLoaded : false;

      const createdByUserId = dailyLedgerOwnerUserId(roleCode, userType, scope.userId, permissions);
      const rows = await service.listRows(scope, {
        branchId: effectiveBranchId,
        ledgerDate: q.ledgerDate,
        dateFrom: q.dateFrom,
        dateTo: q.dateTo,
        lineLabel: q.lineLabel,
        driverId: q.driverId,
        vehicleId: q.vehicleId,
        includeLoaded: includeLoaded ?? false,
        onlyWithData: q.onlyWithData,
        createdByUserId,
        q: q.q,
        limit: q.limit ?? 250,
        offset: q.offset ?? 0,
      });
      res.setHeader('X-Daily-Ledger-View-Scope', viewAllEntries ? 'all' : 'own');
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
        assertLedgerDateAllowed(roleCode, userType, input.ledgerDate, getRequestPermissions(req));
      } catch (dateError) {
        res.status(400).json({
          success: false,
          error: dateError instanceof Error ? dateError.message : 'تاريخ الدفتر غير مسموح.',
        });
        return;
      }
      const branchBypass = roleCode === 'admin' || userType === 'admin' || canAccessAnyCompanyBranch(roleCode, userType);
      if (allowedBranchIds.length && !allowedBranchIds.includes(input.branchId) && !branchBypass) {
        res.status(403).json({ success: false, error: 'Requested branch scope is not allowed for this user.' });
        return;
      }
      if (isDailyLedgerScopedOperator(roleCode) && lockedBranchId && input.branchId !== lockedBranchId) {
        res.status(403).json({ success: false, error: 'لا يمكن الحفظ على فرع مختلف عن الفرع التابع لك.' });
        return;
      }

      const ownerUserId = dailyLedgerOwnerUserId(roleCode, userType, scope.userId, getRequestPermissions(req));
      const row = await service.upsertRow(scope, {
        ...input,
        restrictToCreatedByUserId: ownerUserId,
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
        sessionId: uuid.optional(),
        rowIds: z.array(uuid).optional(),
      });
      const input = bodySchema.parse(req.body);
      try {
        assertLedgerDateAllowed(roleCode, userType, input.ledgerDate, getRequestPermissions(req));
      } catch (dateError) {
        res.status(400).json({
          success: false,
          error: dateError instanceof Error ? dateError.message : 'تاريخ الدفتر غير مسموح.',
        });
        return;
      }
      const branchBypass = roleCode === 'admin' || userType === 'admin' || canAccessAnyCompanyBranch(roleCode, userType);
      if (allowedBranchIds.length && !allowedBranchIds.includes(input.branchId) && !branchBypass) {
        res.status(403).json({ success: false, error: 'Requested branch scope is not allowed for this user.' });
        return;
      }
      if (isDailyLedgerScopedOperator(roleCode) && lockedBranchId && input.branchId !== lockedBranchId) {
        res.status(403).json({ success: false, error: 'لا يمكن الحفظ على فرع مختلف عن الفرع التابع لك.' });
        return;
      }

      const permissions = getRequestPermissions(req);
      if (!canUseDailyLedgerAction(roleCode, userType, permissions, DAILY_LEDGER_POST_SHIPMENTS_PERMISSION)) {
        res.status(403).json({ success: false, error: 'لا تملك صلاحية حفظ الشحنات من دفتر الشحن.' });
        return;
      }

      const createdByUserId = dailyLedgerOwnerUserId(roleCode, userType, scope.userId, permissions);
      try {
        const result = await service.postPendingShipments(scope, { ...input, createdByUserId }, allowedBranchIds);
        const correlationId = (req as any).correlationId as string | undefined;
        const timestamp = new Date().toISOString();
        for (const posted of result.posted) {
          emit({
            type: 'shipment.created',
            companyId: scope.companyId ?? '',
            branchId: input.branchId,
            entityId: posted.shipmentId,
            timestamp,
            correlationId: correlationId ?? null,
          });
          emit({
            type: 'shipment.updated',
            companyId: scope.companyId ?? '',
            branchId: input.branchId,
            entityId: posted.shipmentId,
            timestamp,
            correlationId: correlationId ?? null,
          });
        }
        res.json({ success: true, data: result });
      } catch (error) {
        if (error instanceof HttpError) {
          res.status(error.statusCode).json({ success: false, error: error.message });
          return;
        }
        throw error;
      }
    },
  );

  router.post(
    '/client-logs',
    requirePermissions(['shipments.write']),
    async (req, res) => {
      const userContext = (req as any).requestUserContext as any;
      const scope = parseDataScope(req);
      if (!scope.companyId) {
        res.status(400).json({ success: false, error: 'Company scope is required.' });
        return;
      }
      const bodySchema = z.object({
        entries: z
          .array(
            z.object({
              id: z.string(),
              at: z.string(),
              level: z.string(),
              phase: z.string(),
              message: z.string(),
              batchId: z.string().optional(),
              rowLabel: z.string().optional(),
              receiptNo: z.string().optional(),
              destination: z.string().optional(),
              details: z.record(z.string(), z.unknown()).optional(),
            }),
          )
          .min(1)
          .max(200),
      });
      const { entries } = bodySchema.parse(req.body);
      const result = await appendQuickLedgerClientLogs(
        scope.companyId,
        userContext?.userId ?? scope.userId ?? null,
        entries,
      );
      res.json({ success: true, data: result });
    },
  );

  router.post(
    '/rows/delete',
    requirePermissions(['shipments.write']),
    async (req, res) => {
      const userContext = (req as any).requestUserContext as any;
      const allowedBranchIds: string[] = Array.isArray(userContext?.allowedBranchIds) ? userContext.allowedBranchIds : [];
      const roleCode = String(userContext?.roleCode ?? '').toLowerCase();
      const userType = String(userContext?.userType ?? '').toLowerCase();
      const permissions = getRequestPermissions(req);
      if (!canUseDailyLedgerAction(roleCode, userType, permissions, DAILY_LEDGER_DELETE_ROWS_PERMISSION)) {
        res.status(403).json({ success: false, error: 'لا تملك صلاحية حذف أسطر دفتر الشحن.' });
        return;
      }
      const scope = parseDataScope(req);
      const bodySchema = z.object({
        rowIds: z.array(uuid).min(1),
      });
      const { rowIds } = bodySchema.parse(req.body);
      const createdByUserId = dailyLedgerOwnerUserId(roleCode, userType, scope.userId, permissions);
      const result = await service.deleteRows(scope, rowIds, allowedBranchIds, createdByUserId);
      res.json({ success: true, data: result });
    },
  );

  router.post(
    '/sessions/cancel',
    requirePermissions(['shipments.write']),
    async (req, res) => {
      const userContext = (req as any).requestUserContext as any;
      const allowedBranchIds: string[] = Array.isArray(userContext?.allowedBranchIds) ? userContext.allowedBranchIds : [];
      const roleCode = String(userContext?.roleCode ?? '').toLowerCase();
      const userType = String(userContext?.userType ?? '').toLowerCase();
      const permissions = getRequestPermissions(req);
      if (
        !canUseDailyLedgerAction(roleCode, userType, permissions, DAILY_LEDGER_CANCEL_SESSION_PERMISSION) &&
        !canUseDailyLedgerAction(roleCode, userType, permissions, DAILY_LEDGER_TRANSFER_CREATE_PERMISSION)
      ) {
        res.status(403).json({ success: false, error: 'لا تملك صلاحية إلغاء إرسالية.' });
        return;
      }
      const scope = parseDataScope(req);
      const bodySchema = z.object({ sessionId: uuid });
      const { sessionId } = bodySchema.parse(req.body);
      const createdByUserId = dailyLedgerOwnerUserId(roleCode, userType, scope.userId, permissions);
      try {
        const result = await service.cancelSession(scope, sessionId, allowedBranchIds, createdByUserId);
        res.json({ success: true, data: result });
      } catch (error) {
        if (error instanceof HttpError) {
          res.status(error.statusCode).json({ success: false, error: error.message });
          return;
        }
        throw error;
      }
    },
  );

  router.post(
    '/transfer/validate',
    requirePermissions(['shipments.write']),
    async (req, res) => {
      if (!transferService) {
        res.status(500).json({ success: false, error: 'خدمة نقل الإرسالية غير مُهيأة.' });
        return;
      }
      const userContext = (req as any).requestUserContext as any;
      const roleCode = String(userContext?.roleCode ?? '').toLowerCase();
      const userType = String(userContext?.userType ?? '').toLowerCase();
      const permissions = getRequestPermissions(req);
      if (!canTransferLedger(roleCode, userType, permissions)) {
        res.status(403).json({ success: false, error: 'لا تملك صلاحية نقل إرسالية' });
        return;
      }
      const scope = parseDataScope(req);
      const bodySchema = z.object({ rowIds: z.array(uuid).min(1) });
      const input = bodySchema.parse(req.body);
      const result = await transferService.validateTransfer(scope, input);
      res.json({ success: true, data: result });
    },
  );

  router.post(
    '/transfer/confirm',
    requirePermissions(['shipments.write']),
    async (req, res) => {
      if (!transferService) {
        res.status(500).json({ success: false, error: 'خدمة نقل الإرسالية غير مُهيأة.' });
        return;
      }
      const userContext = (req as any).requestUserContext as any;
      const roleCode = String(userContext?.roleCode ?? '').toLowerCase();
      const userType = String(userContext?.userType ?? '').toLowerCase();
      const permissions = getRequestPermissions(req);
      if (!canTransferLedger(roleCode, userType, permissions)) {
        res.status(403).json({ success: false, error: 'لا تملك صلاحية نقل إرسالية' });
        return;
      }
      const scope = parseDataScope(req);
      const bodySchema = z.object({
        rowIds: z.array(uuid).min(1),
        target: z.object({
          ledgerDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
          driverId: uuid.nullable().optional(),
          vehicleId: uuid.nullable().optional(),
          lineLabel: z.string().nullable().optional(),
          notes: z.string().nullable().optional(),
        }),
        reason: z.string().min(1),
      });
      const input = bodySchema.parse(req.body);
      try {
        // التاريخ الهدف يخضع لنفس قيود تاريخ الدفتر
        assertLedgerDateAllowed(roleCode, userType, input.target.ledgerDate, permissions);
      } catch (dateError) {
        res.status(400).json({
          success: false,
          error: dateError instanceof Error ? dateError.message : 'تاريخ الإرسالية غير مسموح.',
        });
        return;
      }
      try {
        const result = await transferService.confirmTransfer(scope, input);
        res.json({ success: true, data: result });
      } catch (error) {
        const status = (error as { status?: number }).status ?? 500;
        res.status(status).json({
          success: false,
          error: error instanceof Error ? error.message : 'تعذر نقل الإرسالية.',
        });
      }
    },
  );

  router.post(
    '/print/record',
    requirePermissions(['shipments.read']),
    async (req, res) => {
      const scope = parseDataScope(req);
      const bodySchema = z.object({
        sessions: z
          .array(
            z.object({
              sessionId: uuid,
              rowCount: z.number().int().min(0).optional(),
              piecesCount: z.number().int().min(0).optional(),
              weightKg: z.number().min(0).optional(),
            }),
          )
          .min(1),
        printType: z.string().optional(),
        printScope: z.string().optional(),
      });
      const input = bodySchema.parse(req.body);
      try {
        for (const session of input.sessions) {
          await service.recordSessionPrint(scope, {
            sessionId: session.sessionId,
            printType: input.printType,
            printScope: input.printScope,
            rowCount: session.rowCount,
            piecesCount: session.piecesCount,
            weightKg: session.weightKg,
          });
        }
        res.json({ success: true, data: { recorded: input.sessions.length } });
      } catch (error) {
        const status = (error as { status?: number }).status ?? 500;
        res.status(status).json({
          success: false,
          error: error instanceof Error ? error.message : 'تعذر تسجيل حدث الطباعة.',
        });
      }
    },
  );

  return router;
}
