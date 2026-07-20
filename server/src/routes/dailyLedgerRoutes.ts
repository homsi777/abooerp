import express from 'express';
import { z } from 'zod';
import { requirePermissions, requireAnyPermissions } from '../middleware/authorization.js';
import {
  canAccessAnyCompanyBranch,
  canUseDailyLedgerAction,
  canViewAllDailyLedgerEntries,
  dailyLedgerOwnerUserId,
  DAILY_LEDGER_DELETE_ROWS_PERMISSION,
  DAILY_LEDGER_POST_SHIPMENTS_PERMISSION,
  DAILY_LEDGER_CANCEL_SESSION_PERMISSION,
  DAILY_LEDGER_DISPATCH_UNDO_PERMISSION,
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
import { AuditService } from '../services/auditService.js';
import {
  dailyLedgerRowAuditSnapshot,
  diffDailyLedgerRowSnapshots,
} from '../utils/dailyLedgerAudit.js';
import { env } from '../config/env.js';
import { queuePostShipmentsAction } from '../sync/localDeferredActions.js';

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
  const auditService = new AuditService();

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
        receiptNo: z.string().optional(),
        parcelType: z.string().optional(),
        senderName: z.string().optional(),
        receiverName: z.string().optional(),
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
        receiptNo: q.receiptNo,
        parcelType: q.parcelType,
        senderName: q.senderName,
        receiverName: q.receiverName,
        limit: q.limit ?? 250,
        offset: q.offset ?? 0,
      });
      res.setHeader('X-Daily-Ledger-View-Scope', viewAllEntries ? 'all' : 'own');
      res.json({ success: true, data: rows });
    },
  );

  router.get(
    '/duplicate-receipts',
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
        dateFrom: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
        dateTo: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
        allBranches: z.coerce.boolean().optional(),
        scopeMode: z.enum(['same_day', 'cross_date', 'all']).optional(),
        limit: z.coerce.number().min(1).max(500).optional(),
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

      const createdByUserId = dailyLedgerOwnerUserId(roleCode, userType, scope.userId, permissions);
      const data = await service.listDuplicateReceiptGroups(scope, {
        branchId: effectiveBranchId,
        dateFrom: q.dateFrom,
        dateTo: q.dateTo,
        createdByUserId,
        scopeMode: q.scopeMode ?? 'all',
        limit: q.limit ?? 200,
      });
      res.json({ success: true, data });
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
        dispatchId: uuid.nullable().optional(),
        operationId: uuid.optional(),
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
      const previousRows =
        input.rowId != null ? await service.fetchRowAuditSnapshots(scope, [input.rowId]) : [];
      const previousSnapshot =
        previousRows[0] != null ? dailyLedgerRowAuditSnapshot(previousRows[0]) : null;
      const row = await service.upsertRow(scope, {
        ...input,
        restrictToCreatedByUserId: ownerUserId,
      });
      const afterSnapshot = dailyLedgerRowAuditSnapshot(row);
      const isUpdate = previousSnapshot != null;
      const diff =
        previousSnapshot != null
          ? diffDailyLedgerRowSnapshots(previousSnapshot, afterSnapshot)
          : { changedFields: [] as string[], changes: {} as Record<string, { before: unknown; after: unknown }> };
      auditService.logAsync({
        req,
        context: { branchId: row.branch_id },
        action: isUpdate ? 'DAILY_LEDGER_ROW_UPDATED' : 'DAILY_LEDGER_ROW_CREATED',
        entityType: 'daily_ledger_row',
        entityId: row.id,
        metadata: {
          summary: isUpdate
            ? `تعديل سطر ${row.row_no}${row.receipt_no ? ` — إيصال ${row.receipt_no}` : ''}`
            : `إدخال سطر ${row.row_no}${row.receipt_no ? ` — إيصال ${row.receipt_no}` : ''}`,
          ledgerDate: row.ledger_date,
          lineLabel: row.line_label,
          rowNo: row.row_no,
          receiptNo: row.receipt_no,
          destination: row.destination,
          senderName: row.sender_name,
          receiverName: row.receiver_name,
          collectUsd: afterSnapshot.collectUsd,
          prepaidUsd: afterSnapshot.prepaidUsd,
          ...(isUpdate
            ? {
                changedFields: diff.changedFields,
                changes: diff.changes,
                before: previousSnapshot,
                after: afterSnapshot,
              }
            : { after: afterSnapshot }),
        },
      });
      res.json({ success: true, data: row });
    },
  );

  router.get(
    '/dispatch-definitions',
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
        branchId: uuid,
        ledgerDate: z.string().min(1),
        lineLabel: z.string().min(1),
        suggestNext: z.coerce.boolean().optional(),
      });
      const q = querySchema.parse(req.query);
      const branchBypass = roleCode === 'admin' || userType === 'admin' || canAccessAnyCompanyBranch(roleCode, userType);
      if (allowedBranchIds.length && !allowedBranchIds.includes(q.branchId) && !branchBypass) {
        res.status(403).json({ success: false, error: 'Requested branch scope is not allowed for this user.' });
        return;
      }
      if (isDailyLedgerScopedOperator(roleCode) && lockedBranchId && q.branchId !== lockedBranchId) {
        res.status(403).json({ success: false, error: 'لا يمكن عرض إرساليات فرع مختلف عن الفرع التابع لك.' });
        return;
      }
      const definitions = await service.listDispatchDefinitions(scope, {
        branchId: q.branchId,
        ledgerDate: q.ledgerDate,
        lineLabel: q.lineLabel,
      });
      const nextNo = q.suggestNext
        ? await service.suggestNextDispatchNo(scope, {
            branchId: q.branchId,
            ledgerDate: q.ledgerDate,
            lineLabel: q.lineLabel,
          })
        : undefined;
      res.json({
        success: true,
        data: {
          definitions,
          nextDispatchNo: nextNo,
        },
      });
    },
  );

  router.post(
    '/dispatch-definitions',
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
        dispatchNo: z.coerce.number().int().min(1),
        driverId: uuid.nullable().optional(),
        vehicleId: uuid.nullable().optional(),
        driverLabel: z.string().nullable().optional(),
        vehicleLabel: z.string().nullable().optional(),
        tripNo: z.string().nullable().optional(),
        notes: z.string().nullable().optional(),
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
        res.status(403).json({ success: false, error: 'لا يمكن إنشاء إرسالية على فرع مختلف عن الفرع التابع لك.' });
        return;
      }
      try {
        const created = await service.createDispatchDefinition(scope, input);
        res.json({ success: true, data: created });
      } catch (error) {
        if (error instanceof HttpError) {
          res.status(error.statusCode).json({ success: false, error: error.message });
          return;
        }
        throw error;
      }
    },
  );

  router.patch(
    '/dispatch-definitions/:id',
    requirePermissions(['shipments.write']),
    async (req, res) => {
      const scope = parseDataScope(req);
      const paramsSchema = z.object({ id: uuid });
      const bodySchema = z.object({
        driverId: uuid.nullable().optional(),
        vehicleId: uuid.nullable().optional(),
        driverLabel: z.string().nullable().optional(),
        vehicleLabel: z.string().nullable().optional(),
        tripNo: z.string().nullable().optional(),
        notes: z.string().nullable().optional(),
      });
      const params = paramsSchema.parse(req.params);
      const input = bodySchema.parse(req.body);
      try {
        const updated = await service.updateDispatchDefinition(scope, params.id, input);
        res.json({ success: true, data: updated });
      } catch (error) {
        if (error instanceof HttpError) {
          res.status(error.statusCode).json({ success: false, error: error.message });
          return;
        }
        throw error;
      }
    },
  );

  router.delete(
    '/dispatch-definitions/:id',
    requirePermissions(['shipments.write']),
    async (req, res) => {
      const scope = parseDataScope(req);
      const paramsSchema = z.object({ id: uuid });
      const params = paramsSchema.parse(req.params);
      try {
        await service.deleteDispatchDefinition(scope, params.id);
        res.json({ success: true });
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
        saveOperationId: uuid.optional(),
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
        if (env.SYNC_NODE_ROLE === 'local') {
          if (!scope.companyId) throw new HttpError(400, 'Company scope is required.');
          const queued = await queuePostShipmentsAction({
            companyId: scope.companyId,
            branchId: input.branchId,
            userId: createdByUserId ?? scope.userId,
            payload: { ...input, createdByUserId },
          });
          res.status(202).json({ success: true, data: {
            posted: [], skipped: [], errors: [], pendingCentral: true,
            operationId: queued.operationId, queuedRowIds: input.rowIds ?? [],
          } });
          return;
        }
        const { saveOperationId, ...postInput } = input;
        const result = await service.postPendingShipments(
          scope,
          { ...postInput, createdByUserId, operationId: saveOperationId },
          allowedBranchIds,
        );
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
      const snapshots = await service.fetchRowAuditSnapshots(scope, rowIds);
      const result = await service.deleteRows(scope, rowIds, allowedBranchIds, createdByUserId);
      for (const snapshotRow of snapshots) {
        if (!result.deletedIds.includes(snapshotRow.id)) continue;
        const snap = dailyLedgerRowAuditSnapshot(snapshotRow);
        auditService.logAsync({
          req,
          context: { branchId: snapshotRow.branch_id },
          action: 'DAILY_LEDGER_ROW_DELETED',
          entityType: 'daily_ledger_row',
          entityId: snapshotRow.id,
          metadata: {
            summary: `حذف سطر ${snap.rowNo}${snap.receiptNo ? ` — إيصال ${snap.receiptNo}` : ''}`,
            ledgerDate: snap.ledgerDate,
            lineLabel: snap.lineLabel,
            rowNo: snap.rowNo,
            receiptNo: snap.receiptNo,
            destination: snap.destination,
            before: snap,
          },
        });
      }
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
        if (error instanceof HttpError) {
          res.status(error.statusCode).json({ success: false, error: error.message });
          return;
        }
        console.error('[daily-ledger] transfer/confirm failed', error);
        res.status(500).json({
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
        if (error instanceof HttpError) {
          res.status(error.statusCode).json({ success: false, error: error.message });
          return;
        }
        res.status(500).json({
          success: false,
          error: error instanceof Error ? error.message : 'تعذر تسجيل حدث الطباعة.',
        });
      }
    },
  );

  const printDocumentRowSchema = z.object({
    rowId: uuid,
    rowNo: z.number().int(),
    receiptNo: z.string().nullable().optional(),
    destination: z.string(),
    parcelType: z.string().optional(),
    parcelCount: z.number().nullable().optional(),
    weightKg: z.string().nullable().optional(),
    senderName: z.string().optional(),
    receiverName: z.string().optional(),
    collectAmountUsd: z.string().optional(),
    prepaidAmountUsd: z.string().optional(),
    hawalaAmountUsd: z.string().optional(),
    transferServiceFeeUsd: z.string().optional(),
    notes: z.string().nullable().optional(),
    driverLabel: z.string().nullable().optional(),
    sessionId: uuid.nullable().optional(),
  });

  router.post(
    '/print/document',
    requirePermissions(['shipments.read']),
    async (req, res) => {
      const scope = parseDataScope(req);
      const bodySchema = z.object({
        branchId: uuid.nullable().optional(),
        ledgerDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
        ledgerDateTo: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional(),
        lineLabel: z.string().nullable().optional(),
        originLabel: z.string().nullable().optional(),
        driverId: uuid.nullable().optional(),
        driverLabel: z.string().nullable().optional(),
        destinationLabel: z.string().nullable().optional(),
        searchQuery: z.string().nullable().optional(),
        printType: z.string().optional(),
        printScope: z.string().nullable().optional(),
        title: z.string().nullable().optional(),
        rowCount: z.number().int().min(0).optional(),
        piecesCount: z.number().int().min(0).optional(),
        weightKg: z.number().min(0).optional(),
        collectTotalUsd: z.number().min(0).optional(),
        prepaidTotalUsd: z.number().min(0).optional(),
        hawalaTotalUsd: z.number().min(0).optional(),
        transferFeeTotalUsd: z.number().min(0).optional(),
        rowsSnapshot: z.array(printDocumentRowSchema).optional(),
      });
      try {
        const input = bodySchema.parse(req.body);
        const document = await service.createPrintDocument(scope, {
          ...input,
          rowsSnapshot: input.rowsSnapshot?.map((row) => ({
            rowId: row.rowId,
            rowNo: row.rowNo,
            receiptNo: row.receiptNo ?? null,
            destination: row.destination,
            parcelType: row.parcelType ?? '',
            parcelCount: row.parcelCount ?? null,
            weightKg: row.weightKg ?? null,
            senderName: row.senderName ?? '',
            receiverName: row.receiverName ?? '',
            collectAmountUsd: row.collectAmountUsd ?? '0',
            prepaidAmountUsd: row.prepaidAmountUsd ?? '0',
            hawalaAmountUsd: row.hawalaAmountUsd ?? '0',
            transferServiceFeeUsd: row.transferServiceFeeUsd ?? '0',
            notes: row.notes ?? null,
            driverLabel: row.driverLabel ?? null,
            sessionId: row.sessionId ?? null,
          })),
        });
        res.json({ success: true, data: document });
      } catch (error) {
        if (error instanceof HttpError) {
          res.status(error.statusCode).json({ success: false, error: error.message });
          return;
        }
        res.status(500).json({
          success: false,
          error: error instanceof Error ? error.message : 'تعذر حفظ توثيق الطباعة.',
        });
      }
    },
  );

  router.get(
    '/print/documents',
    requireAnyPermissions(['daily_ledger.documentation.read', 'shipments.read']),
    async (req, res) => {
      const scope = parseDataScope(req);
      const querySchema = z.object({
        branchId: uuid.optional(),
        dateFrom: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
        dateTo: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
        driverId: uuid.optional(),
        destination: z.string().optional(),
        searchQuery: z.string().optional(),
        limit: z.coerce.number().int().min(1).max(500).optional(),
        offset: z.coerce.number().int().min(0).optional(),
      });
      try {
        const q = querySchema.parse(req.query);
        const rows = await service.listPrintDocuments(scope, q);
        res.json({ success: true, data: rows });
      } catch (error) {
        if (error instanceof HttpError) {
          res.status(error.statusCode).json({ success: false, error: error.message });
          return;
        }
        res.status(500).json({
          success: false,
          error: error instanceof Error ? error.message : 'تعذر تحميل توثيق الطباعة.',
        });
      }
    },
  );

  router.get(
    '/print/documents/:id',
    requireAnyPermissions(['daily_ledger.documentation.read', 'shipments.read']),
    async (req, res) => {
      const scope = parseDataScope(req);
      const documentId = uuid.parse(req.params.id);
      try {
        const document = await service.getPrintDocument(scope, documentId);
        if (!document) {
          res.status(404).json({ success: false, error: 'سجل التوثيق غير موجود.' });
          return;
        }
        res.json({ success: true, data: document });
      } catch (error) {
        if (error instanceof HttpError) {
          res.status(error.statusCode).json({ success: false, error: error.message });
          return;
        }
        res.status(500).json({
          success: false,
          error: error instanceof Error ? error.message : 'تعذر تحميل تفاصيل التوثيق.',
        });
      }
    },
  );

  router.delete(
    '/print/documents/:id',
    requirePermissions(['shipments.write']),
    async (req, res) => {
      const scope = parseDataScope(req);
      const documentId = uuid.parse(req.params.id);
      try {
        const deleted = await service.deletePrintDocument(scope, documentId);
        if (!deleted) {
          res.status(404).json({ success: false, error: 'سجل التوثيق غير موجود.' });
          return;
        }
        res.json({ success: true, data: { id: documentId } });
      } catch (error) {
        if (error instanceof HttpError) {
          res.status(error.statusCode).json({ success: false, error: error.message });
          return;
        }
        res.status(500).json({
          success: false,
          error: error instanceof Error ? error.message : 'تعذر حذف سجل التوثيق.',
        });
      }
    },
  );

  const dispatchSaveRowSchema = z.object({
    rowId: z.string().uuid(),
    rowNo: z.number().int(),
    receiptNo: z.string().nullable().optional(),
    destination: z.string(),
    parcelType: z.string().optional(),
    parcelCount: z.number().int().nullable().optional(),
    weightKg: z.string().nullable().optional(),
    senderName: z.string().optional(),
    receiverName: z.string().optional(),
    collectAmountUsd: z.string().optional(),
    prepaidAmountUsd: z.string().optional(),
    hawalaAmountUsd: z.string().optional(),
    transferServiceFeeUsd: z.string().optional(),
    notes: z.string().nullable().optional(),
    driverLabel: z.string().nullable().optional(),
    dispatchNo: z.number().int().nullable().optional(),
    ledgerDate: z.string().nullable().optional(),
  });

  router.post(
    '/dispatch-saves',
    requireAnyPermissions(['daily_ledger.dispatch_save.read', 'daily_ledger.post_shipments']),
    async (req, res) => {
      const scope = parseDataScope(req);
      const bodySchema = z.object({
        branchId: uuid,
        dispatchId: uuid.nullable().optional(),
        dispatchNo: z.number().int().positive().nullable().optional(),
        ledgerDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
        lineLabel: z.string(),
        originLabel: z.string().nullable().optional(),
        driverId: uuid.nullable().optional(),
        vehicleId: uuid.nullable().optional(),
        driverLabel: z.string().nullable().optional(),
        vehicleLabel: z.string().nullable().optional(),
        tripNo: z.string().nullable().optional(),
        destinationLabel: z.string().nullable().optional(),
        saveMode: z.enum(['all', 'custom']),
        rowCount: z.number().int().min(0).optional(),
        piecesCount: z.number().int().min(0).optional(),
        weightKg: z.number().min(0).optional(),
        collectTotalUsd: z.number().min(0).optional(),
        prepaidTotalUsd: z.number().min(0).optional(),
        hawalaTotalUsd: z.number().min(0).optional(),
        transferFeeTotalUsd: z.number().min(0).optional(),
        postedCount: z.number().int().min(0).optional(),
        errorCount: z.number().int().min(0).optional(),
        skippedCount: z.number().int().min(0).optional(),
        receiptNos: z.array(z.string()).optional(),
        rowIds: z.array(uuid).optional(),
        rowsSnapshot: z.array(dispatchSaveRowSchema).optional(),
        outcome: z.enum(['success', 'partial', 'failed']).nullable().optional(),
        summary: z.string().nullable().optional(),
        notes: z.string().nullable().optional(),
        operationId: uuid.nullable().optional(),
      });
      try {
        const input = bodySchema.parse(req.body);
        const log = await service.createDispatchSaveLog(scope, {
          ...input,
          userId: scope.userId,
          rowsSnapshot: input.rowsSnapshot?.map((row) => ({
            rowId: row.rowId,
            rowNo: row.rowNo,
            receiptNo: row.receiptNo ?? null,
            destination: row.destination,
            parcelType: row.parcelType ?? '',
            parcelCount: row.parcelCount ?? null,
            weightKg: row.weightKg ?? null,
            senderName: row.senderName ?? '',
            receiverName: row.receiverName ?? '',
            collectAmountUsd: row.collectAmountUsd ?? '0',
            prepaidAmountUsd: row.prepaidAmountUsd ?? '0',
            hawalaAmountUsd: row.hawalaAmountUsd ?? '0',
            transferServiceFeeUsd: row.transferServiceFeeUsd ?? '0',
            notes: row.notes ?? null,
            driverLabel: row.driverLabel ?? null,
            dispatchNo: row.dispatchNo ?? null,
            ledgerDate: row.ledgerDate ?? null,
          })),
        });
        res.json({ success: true, data: log });
      } catch (error) {
        if (error instanceof HttpError) {
          res.status(error.statusCode).json({ success: false, error: error.message });
          return;
        }
        res.status(500).json({
          success: false,
          error: error instanceof Error ? error.message : 'تعذر حفظ سجل الإرسالية.',
        });
      }
    },
  );

  router.get(
    '/dispatch-saves',
    requireAnyPermissions(['daily_ledger.dispatch_save.read', 'shipments.read']),
    async (req, res) => {
      const scope = parseDataScope(req);
      const querySchema = z.object({
        branchId: uuid.optional(),
        dateFrom: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
        dateTo: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
        driverId: uuid.optional(),
        destination: z.string().optional(),
        searchQuery: z.string().optional(),
        saveMode: z.enum(['all', 'custom']).optional(),
        limit: z.coerce.number().int().min(1).max(500).optional(),
        offset: z.coerce.number().int().min(0).optional(),
      });
      try {
        const q = querySchema.parse(req.query);
        const rows = await service.listDispatchSaveLogs(scope, q);
        res.json({ success: true, data: rows });
      } catch (error) {
        if (error instanceof HttpError) {
          res.status(error.statusCode).json({ success: false, error: error.message });
          return;
        }
        res.status(500).json({
          success: false,
          error: error instanceof Error ? error.message : 'تعذر تحميل سجل حفظ الإرساليات.',
        });
      }
    },
  );

  router.get(
    '/dispatch-saves/:id',
    requireAnyPermissions(['daily_ledger.dispatch_save.read', 'shipments.read']),
    async (req, res) => {
      const scope = parseDataScope(req);
      const logId = uuid.parse(req.params.id);
      try {
        const log = await service.getDispatchSaveLog(scope, logId);
        if (!log) {
          res.status(404).json({ success: false, error: 'سجل الإرسالية غير موجود.' });
          return;
        }
        res.json({ success: true, data: log });
      } catch (error) {
        if (error instanceof HttpError) {
          res.status(error.statusCode).json({ success: false, error: error.message });
          return;
        }
        res.status(500).json({
          success: false,
          error: error instanceof Error ? error.message : 'تعذر تحميل تفاصيل سجل الإرسالية.',
        });
      }
    },
  );

  router.post(
    '/dispatch-saves/:id/mark-printed',
    requireAnyPermissions(['daily_ledger.dispatch_save.read', 'shipments.read']),
    async (req, res) => {
      const scope = parseDataScope(req);
      const logId = uuid.parse(req.params.id);
      const bodySchema = z.object({
        printDocumentId: uuid.nullable().optional(),
      });
      try {
        const input = bodySchema.parse(req.body ?? {});
        const log = await service.markDispatchSavePrinted(scope, logId, input);
        if (!log) {
          res.status(404).json({ success: false, error: 'سجل الإرسالية غير موجود.' });
          return;
        }
        res.json({ success: true, data: log });
      } catch (error) {
        if (error instanceof HttpError) {
          res.status(error.statusCode).json({ success: false, error: error.message });
          return;
        }
        res.status(500).json({
          success: false,
          error: error instanceof Error ? error.message : 'تعذر تحديث حالة الطباعة.',
        });
      }
    },
  );

  router.post(
    '/dispatch-operations/begin',
    requireAnyPermissions(['daily_ledger.post_shipments', 'shipments.write']),
    async (req, res) => {
      const scope = parseDataScope(req);
      const bodySchema = z.object({
        branchId: uuid,
        ledgerDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
        lineLabel: z.string(),
        originLabel: z.string().nullable().optional(),
        driverId: uuid.nullable().optional(),
        vehicleId: uuid.nullable().optional(),
        driverLabel: z.string().nullable().optional(),
        vehicleLabel: z.string().nullable().optional(),
        tripNo: z.string().nullable().optional(),
        saveMode: z.enum(['all', 'custom']).optional(),
        dispatchId: uuid.nullable().optional(),
        idempotencyKey: z.string().min(8).max(120).optional(),
        existingRowIds: z.array(uuid).optional(),
      });
      try {
        const input = bodySchema.parse(req.body);
        const operation = await service.beginDispatchOperation(scope, input);
        res.json({ success: true, data: operation });
      } catch (error) {
        if (error instanceof HttpError) {
          res.status(error.statusCode).json({ success: false, error: error.message });
          return;
        }
        res.status(500).json({
          success: false,
          error: error instanceof Error ? error.message : 'تعذر بدء عملية الحفظ.',
        });
      }
    },
  );

  router.post(
    '/dispatch-saves/:id/undo-preview',
    requireAnyPermissions([DAILY_LEDGER_DISPATCH_UNDO_PERMISSION, 'daily_ledger.dispatch_save.read']),
    async (req, res) => {
      const userContext = (req as any).requestUserContext as any;
      const roleCode = String(userContext?.roleCode ?? '').toLowerCase();
      const userType = String(userContext?.userType ?? '').toLowerCase();
      const permissions = getRequestPermissions(req);
      if (!canUseDailyLedgerAction(roleCode, userType, permissions, DAILY_LEDGER_DISPATCH_UNDO_PERMISSION)) {
        res.status(403).json({ success: false, error: 'لا تملك صلاحية إلغاء حفظ الإرسالية.' });
        return;
      }
      const scope = parseDataScope(req);
      const logId = uuid.parse(req.params.id);
      try {
        const preview = await service.previewDispatchSaveUndo(scope, logId);
        res.json({ success: true, data: preview });
      } catch (error) {
        if (error instanceof HttpError) {
          res.status(error.statusCode).json({ success: false, error: error.message });
          return;
        }
        res.status(500).json({
          success: false,
          error: error instanceof Error ? error.message : 'تعذر معاينة الإلغاء.',
        });
      }
    },
  );

  router.post(
    '/dispatch-saves/:id/undo',
    requireAnyPermissions([DAILY_LEDGER_DISPATCH_UNDO_PERMISSION]),
    async (req, res) => {
      const userContext = (req as any).requestUserContext as any;
      const roleCode = String(userContext?.roleCode ?? '').toLowerCase();
      const userType = String(userContext?.userType ?? '').toLowerCase();
      const permissions = getRequestPermissions(req);
      if (!canUseDailyLedgerAction(roleCode, userType, permissions, DAILY_LEDGER_DISPATCH_UNDO_PERMISSION)) {
        res.status(403).json({ success: false, error: 'لا تملك صلاحية إلغاء حفظ الإرسالية.' });
        return;
      }
      const scope = parseDataScope(req);
      const logId = uuid.parse(req.params.id);
      const bodySchema = z.object({
        reason: z.string().max(500).nullable().optional(),
      });
      try {
        const input = bodySchema.parse(req.body ?? {});
        const result = await service.undoDispatchSave(scope, logId, input);
        res.json({ success: true, data: result });
      } catch (error) {
        if (error instanceof HttpError) {
          res.status(error.statusCode).json({ success: false, error: error.message });
          return;
        }
        res.status(500).json({
          success: false,
          error: error instanceof Error ? error.message : 'تعذر إلغاء حفظ الإرسالية.',
        });
      }
    },
  );

  return router;
}
