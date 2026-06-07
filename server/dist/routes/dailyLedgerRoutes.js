import express from 'express';
import { z } from 'zod';
import { requirePermissions } from '../middleware/authorization.js';
import { parseDataScope } from '../utils/scope.js';
import { appendQuickLedgerClientLogs } from '../services/quickLedgerLogService.js';
const uuid = z.string().uuid();
function todayIsoDate() {
    return new Date().toISOString().slice(0, 10);
}
function assertLedgerDateAllowed(roleCode, userType, ledgerDate, permissions = []) {
    const today = todayIsoDate();
    const isAdmin = roleCode === 'admin' || userType === 'admin';
    const isManager = isAdmin || roleCode === 'general_manager' || roleCode === 'branch_manager';
    const canUsePastDates = isManager || permissions.includes('shipments.ledger.past_dates');
    if (ledgerDate > today) {
        throw new Error('لا يمكن إدخال بيانات بتاريخ مستقبلي.');
    }
    if (ledgerDate !== today && !canUsePastDates) {
        throw new Error('لا يمكن العمل على تاريخ مختلف عن اليوم — يلزم صلاحية تعديل تاريخ دفتر الشحن.');
    }
}
function getRequestPermissions(req) {
    const userContext = req.requestUserContext;
    return Array.isArray(userContext?.permissions) ? userContext.permissions : [];
}
export function createDailyLedgerRouter(service) {
    const router = express.Router();
    router.get('/rows', requirePermissions(['shipments.read']), async (req, res) => {
        const userContext = req.requestUserContext;
        const allowedBranchIds = Array.isArray(userContext?.allowedBranchIds) ? userContext.allowedBranchIds : [];
        const roleCode = String(userContext?.roleCode ?? '').toLowerCase();
        const userType = String(userContext?.userType ?? '').toLowerCase();
        const lockedBranchId = (typeof userContext?.activeBranchId === 'string' ? userContext.activeBranchId : undefined) ??
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
            onlyWithData: q.onlyWithData,
            q: q.q,
            limit: q.limit ?? 250,
            offset: q.offset ?? 0,
        });
        res.json({ success: true, data: rows });
    });
    router.post('/rows/upsert', requirePermissions(['shipments.write']), async (req, res) => {
        const userContext = req.requestUserContext;
        const allowedBranchIds = Array.isArray(userContext?.allowedBranchIds) ? userContext.allowedBranchIds : [];
        const roleCode = String(userContext?.roleCode ?? '').toLowerCase();
        const userType = String(userContext?.userType ?? '').toLowerCase();
        const lockedBranchId = (typeof userContext?.activeBranchId === 'string' ? userContext.activeBranchId : undefined) ??
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
        }
        catch (dateError) {
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
    });
    router.post('/rows/:id/post', requirePermissions(['shipments.write']), async (req, res) => {
        const userContext = req.requestUserContext;
        const allowedBranchIds = Array.isArray(userContext?.allowedBranchIds) ? userContext.allowedBranchIds : [];
        const scope = parseDataScope(req);
        const paramsSchema = z.object({ id: uuid });
        const bodySchema = z.object({
            shipmentId: uuid,
            expectedUpdatedAt: z.string().optional(),
        });
        const params = paramsSchema.parse(req.params);
        const body = bodySchema.parse(req.body);
        const ok = await service.markPosted(scope, {
            rowId: params.id,
            shipmentId: body.shipmentId,
            expectedUpdatedAt: body.expectedUpdatedAt,
        }, allowedBranchIds);
        res.json({ success: true, data: { ok } });
    });
    router.post('/rows/post-shipments', requirePermissions(['shipments.write']), async (req, res) => {
        const userContext = req.requestUserContext;
        const allowedBranchIds = Array.isArray(userContext?.allowedBranchIds) ? userContext.allowedBranchIds : [];
        const roleCode = String(userContext?.roleCode ?? '').toLowerCase();
        const userType = String(userContext?.userType ?? '').toLowerCase();
        const lockedBranchId = (typeof userContext?.activeBranchId === 'string' ? userContext.activeBranchId : undefined) ??
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
            assertLedgerDateAllowed(roleCode, userType, input.ledgerDate, getRequestPermissions(req));
        }
        catch (dateError) {
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
    });
    router.post('/client-logs', requirePermissions(['shipments.write']), async (req, res) => {
        const userContext = req.requestUserContext;
        const scope = parseDataScope(req);
        if (!scope.companyId) {
            res.status(400).json({ success: false, error: 'Company scope is required.' });
            return;
        }
        const bodySchema = z.object({
            entries: z
                .array(z.object({
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
            }))
                .min(1)
                .max(200),
        });
        const { entries } = bodySchema.parse(req.body);
        const result = await appendQuickLedgerClientLogs(scope.companyId, userContext?.userId ?? scope.userId ?? null, entries);
        res.json({ success: true, data: result });
    });
    router.post('/rows/delete', requirePermissions(['shipments.write']), async (req, res) => {
        const userContext = req.requestUserContext;
        const allowedBranchIds = Array.isArray(userContext?.allowedBranchIds) ? userContext.allowedBranchIds : [];
        const scope = parseDataScope(req);
        const bodySchema = z.object({
            rowIds: z.array(uuid).min(1),
        });
        const { rowIds } = bodySchema.parse(req.body);
        const result = await service.deleteRows(scope, rowIds, allowedBranchIds);
        res.json({ success: true, data: result });
    });
    return router;
}
