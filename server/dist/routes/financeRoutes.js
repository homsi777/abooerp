import { Router } from 'express';
import { z } from 'zod';
import { asyncHandler } from '../utils/http.js';
import { parseDataScope } from '../utils/scope.js';
import { requirePermissions } from '../middleware/authorization.js';
import { currencyCodeSchema } from '../utils/money.js';
import { AuditService } from '../services/auditService.js';
import { requireIdempotencyKey } from '../middleware/idempotency.js';
const voucherBaseSchema = z.object({
    voucherNo: z.string().min(1),
    branchId: z.string().uuid().optional(),
    agentId: z.string().uuid().optional(),
    shipmentId: z.string().uuid().optional(),
    deliveryId: z.string().uuid().optional(),
    customerId: z.string().uuid().optional(),
    senderReceiverId: z.string().uuid().optional(),
    relatedEntityType: z.string().optional(),
    relatedEntityId: z.string().uuid().optional(),
    status: z.enum(['draft', 'confirmed', 'cancelled']).default('draft'),
    notes: z.string().optional(),
    originalAmount: z.coerce.number(),
    originalCurrency: currencyCodeSchema,
    exchangeRateToUsd: z.coerce.number().positive().optional(),
    baseAmountUsd: z.coerce.number().optional(),
    createdByUserId: z.string().uuid().optional(),
    expectedUpdatedAt: z.string().datetime({ offset: true }).optional(),
});
const receiptCreateSchema = voucherBaseSchema;
const receiptUpdateSchema = receiptCreateSchema.partial();
const paymentCreateSchema = voucherBaseSchema;
const paymentUpdateSchema = paymentCreateSchema.partial();
const partyStatementQuerySchema = z.object({
    partyType: z.enum(['customer', 'sender_receiver', 'agent']).optional(),
    partyId: z.string().uuid().optional(),
    fromAt: z.string().datetime({ offset: true }).optional(),
    toAt: z.string().datetime({ offset: true }).optional(),
    includeReversals: z
        .enum(['true', 'false'])
        .optional()
        .transform((value) => (value === undefined ? true : value === 'true')),
});
const partyLedgerQuerySchema = partyStatementQuerySchema.extend({
    page: z.coerce.number().int().min(1).optional(),
    pageSize: z.coerce.number().int().min(1).max(200).optional(),
});
const partyComparisonQuerySchema = z.object({
    partyType: z.enum(['customer', 'sender_receiver', 'agent']).optional(),
    partyId: z.string().uuid().optional(),
    fromAt: z.string().datetime({ offset: true }),
    toAt: z.string().datetime({ offset: true }),
    includeReversals: z
        .enum(['true', 'false'])
        .optional()
        .transform((value) => (value === undefined ? true : value === 'true')),
});
const partyAnalyticsQuerySchema = z.object({
    partyType: z.enum(['customer', 'sender_receiver', 'agent']).optional(),
    partyId: z.string().uuid().optional(),
    fromAt: z.string().datetime({ offset: true }).optional(),
    toAt: z.string().datetime({ offset: true }).optional(),
    includeReversals: z
        .enum(['true', 'false'])
        .optional()
        .transform((value) => (value === undefined ? true : value === 'true')),
    topN: z.coerce.number().int().min(1).max(20).optional(),
});
const partyDashboardPackageQuerySchema = z
    .object({
    partyType: z.enum(['customer', 'sender_receiver', 'agent']).optional(),
    partyId: z.string().uuid().optional(),
    fromAt: z.string().datetime({ offset: true }).optional(),
    toAt: z.string().datetime({ offset: true }).optional(),
    includeReversals: z
        .enum(['true', 'false'])
        .optional()
        .transform((value) => (value === undefined ? true : value === 'true')),
    page: z.coerce.number().int().min(1).optional(),
    pageSize: z.coerce.number().int().min(1).max(200).optional(),
    topN: z.coerce.number().int().min(1).max(20).optional(),
    tabs: z
        .string()
        .optional()
        .transform((value) => {
        if (!value)
            return ['statement', 'comparison', 'analytics'];
        return value
            .split(',')
            .map((tab) => tab.trim())
            .filter((tab) => tab === 'statement' || tab === 'comparison' || tab === 'analytics');
    }),
    comparisonFromAt: z.string().datetime({ offset: true }).optional(),
    comparisonToAt: z.string().datetime({ offset: true }).optional(),
})
    .superRefine((value, ctx) => {
    if (value.tabs.includes('comparison') && (!value.comparisonFromAt || !value.comparisonToAt)) {
        ctx.addIssue({
            code: z.ZodIssueCode.custom,
            message: 'comparisonFromAt and comparisonToAt are required when comparison tab is requested.',
        });
    }
});
const dashboardCacheResetSchema = z.object({
    resetCache: z.boolean().optional().default(true),
    resetMetrics: z.boolean().optional().default(true),
    confirm: z.boolean().optional().default(false),
});
export function createFinanceRouter(service) {
    const router = Router();
    const auditService = new AuditService();
    router.get('/receipt-vouchers', requirePermissions(['finance.read', 'finance.vouchers.read']), asyncHandler(async (req, res) => {
        const deliveryId = typeof req.query.deliveryId === 'string' ? req.query.deliveryId : undefined;
        const rows = await service.listReceiptVouchers(parseDataScope(req), { deliveryId });
        res.json({ success: true, data: rows });
    }));
    router.get('/receipt-vouchers/:id', requirePermissions(['finance.read', 'finance.vouchers.read']), asyncHandler(async (req, res) => {
        const row = await service.getReceiptVoucherById(String(req.params.id), parseDataScope(req));
        if (!row) {
            res.status(404).json({ success: false, error: 'Receipt voucher not found' });
            return;
        }
        res.json({ success: true, data: row });
    }));
    router.post('/receipt-vouchers', requirePermissions(['finance.write', 'finance.vouchers.write']), requireIdempotencyKey('finance.receipt.create'), asyncHandler(async (req, res) => {
        try {
            const payload = receiptCreateSchema.parse(req.body);
            const userContext = req.requestUserContext;
            const row = await service.createReceiptVoucher(payload, parseDataScope(req), {
                companyId: userContext?.companyId,
                baseCurrency: userContext?.baseCurrency,
            });
            auditService.logAsync({
                req,
                action: 'VOUCHER_CREATED',
                entityType: 'receipt_voucher',
                entityId: row.id,
                metadata: {
                    voucherNo: row.voucher_no,
                    status: row.status,
                    originalAmount: row.original_amount,
                    originalCurrency: row.original_currency,
                },
            });
            res.status(201).json({ success: true, data: row });
        }
        catch (error) {
            auditService.logAsync({
                req,
                action: 'VOUCHER_POST_FAILED',
                entityType: 'receipt_voucher',
                metadata: { reason: error?.message ?? 'unknown' },
            });
            throw error;
        }
    }));
    router.put('/receipt-vouchers/:id', requirePermissions(['finance.write', 'finance.vouchers.write']), requireIdempotencyKey('finance.receipt.update'), asyncHandler(async (req, res) => {
        try {
            const payload = receiptUpdateSchema.parse(req.body);
            const userContext = req.requestUserContext;
            const before = await service.getReceiptVoucherById(String(req.params.id), parseDataScope(req));
            const row = await service.updateReceiptVoucher(String(req.params.id), payload, parseDataScope(req), {
                companyId: userContext?.companyId,
                baseCurrency: userContext?.baseCurrency,
            });
            if (!row) {
                res.status(404).json({ success: false, error: 'Receipt voucher not found' });
                return;
            }
            auditService.logAsync({
                req,
                action: 'VOUCHER_UPDATED',
                entityType: 'receipt_voucher',
                entityId: row.id,
                metadata: {
                    changedFields: Object.keys(payload),
                    previousStatus: before?.status,
                    nextStatus: row.status,
                },
            });
            if (before?.status !== 'confirmed' && row.status === 'confirmed') {
                auditService.logAsync({
                    req,
                    action: 'VOUCHER_CONFIRMED',
                    entityType: 'receipt_voucher',
                    entityId: row.id,
                    metadata: { voucherNo: row.voucher_no },
                });
            }
            if (before?.status === 'confirmed' && row.status === 'cancelled') {
                auditService.logAsync({
                    req,
                    action: 'VOUCHER_CANCELLED',
                    entityType: 'receipt_voucher',
                    entityId: row.id,
                    metadata: { voucherNo: row.voucher_no },
                });
            }
            res.json({ success: true, data: row });
        }
        catch (error) {
            auditService.logAsync({
                req,
                action: 'VOUCHER_POST_FAILED',
                entityType: 'receipt_voucher',
                entityId: String(req.params.id),
                metadata: { reason: error?.message ?? 'unknown' },
            });
            throw error;
        }
    }));
    router.post('/receipt-vouchers/auto-generate-from-delivery/:deliveryId', requirePermissions(['finance.write', 'finance.vouchers.write']), requireIdempotencyKey('finance.receipt.auto-generate'), asyncHandler(async (req, res) => {
        try {
            const deliveryId = String(req.params.deliveryId);
            const allowDuplicate = req.query.allowDuplicate === 'true';
            const userId = req.requestUserContext?.userId;
            const result = await service.autoGenerateReceiptFromDelivery(deliveryId, userId, !allowDuplicate);
            if (result.created) {
                auditService.logAsync({
                    req,
                    action: 'VOUCHER_CREATED',
                    entityType: 'receipt_voucher',
                    entityId: result.voucher?.id,
                    metadata: {
                        source: 'delivery_auto_generate',
                        deliveryId,
                        status: result.voucher?.status,
                    },
                });
            }
            res.status(result.created ? 201 : 200).json({ success: true, data: result });
        }
        catch (error) {
            auditService.logAsync({
                req,
                action: 'VOUCHER_POST_FAILED',
                entityType: 'receipt_voucher',
                entityId: String(req.params.deliveryId),
                metadata: { reason: error?.message ?? 'unknown' },
            });
            throw error;
        }
    }));
    router.get('/payment-vouchers', requirePermissions(['finance.read', 'finance.vouchers.read']), asyncHandler(async (req, res) => {
        const rows = await service.listPaymentVouchers(parseDataScope(req));
        res.json({ success: true, data: rows });
    }));
    router.get('/payment-vouchers/:id', requirePermissions(['finance.read', 'finance.vouchers.read']), asyncHandler(async (req, res) => {
        const row = await service.getPaymentVoucherById(String(req.params.id), parseDataScope(req));
        if (!row) {
            res.status(404).json({ success: false, error: 'Payment voucher not found' });
            return;
        }
        res.json({ success: true, data: row });
    }));
    router.post('/payment-vouchers', requirePermissions(['finance.write', 'finance.vouchers.write']), requireIdempotencyKey('finance.payment.create'), asyncHandler(async (req, res) => {
        try {
            const payload = paymentCreateSchema.parse(req.body);
            const userContext = req.requestUserContext;
            const row = await service.createPaymentVoucher(payload, parseDataScope(req), {
                companyId: userContext?.companyId,
                baseCurrency: userContext?.baseCurrency,
            });
            auditService.logAsync({
                req,
                action: 'VOUCHER_CREATED',
                entityType: 'payment_voucher',
                entityId: row.id,
                metadata: {
                    voucherNo: row.voucher_no,
                    status: row.status,
                    originalAmount: row.original_amount,
                    originalCurrency: row.original_currency,
                },
            });
            res.status(201).json({ success: true, data: row });
        }
        catch (error) {
            auditService.logAsync({
                req,
                action: 'VOUCHER_POST_FAILED',
                entityType: 'payment_voucher',
                metadata: { reason: error?.message ?? 'unknown' },
            });
            throw error;
        }
    }));
    router.put('/payment-vouchers/:id', requirePermissions(['finance.write', 'finance.vouchers.write']), requireIdempotencyKey('finance.payment.update'), asyncHandler(async (req, res) => {
        try {
            const payload = paymentUpdateSchema.parse(req.body);
            const userContext = req.requestUserContext;
            const before = await service.getPaymentVoucherById(String(req.params.id), parseDataScope(req));
            const row = await service.updatePaymentVoucher(String(req.params.id), payload, parseDataScope(req), {
                companyId: userContext?.companyId,
                baseCurrency: userContext?.baseCurrency,
            });
            if (!row) {
                res.status(404).json({ success: false, error: 'Payment voucher not found' });
                return;
            }
            auditService.logAsync({
                req,
                action: 'VOUCHER_UPDATED',
                entityType: 'payment_voucher',
                entityId: row.id,
                metadata: {
                    changedFields: Object.keys(payload),
                    previousStatus: before?.status,
                    nextStatus: row.status,
                },
            });
            if (before?.status !== 'confirmed' && row.status === 'confirmed') {
                auditService.logAsync({
                    req,
                    action: 'VOUCHER_CONFIRMED',
                    entityType: 'payment_voucher',
                    entityId: row.id,
                    metadata: { voucherNo: row.voucher_no },
                });
            }
            if (before?.status === 'confirmed' && row.status === 'cancelled') {
                auditService.logAsync({
                    req,
                    action: 'VOUCHER_CANCELLED',
                    entityType: 'payment_voucher',
                    entityId: row.id,
                    metadata: { voucherNo: row.voucher_no },
                });
            }
            res.json({ success: true, data: row });
        }
        catch (error) {
            auditService.logAsync({
                req,
                action: 'VOUCHER_POST_FAILED',
                entityType: 'payment_voucher',
                entityId: String(req.params.id),
                metadata: { reason: error?.message ?? 'unknown' },
            });
            throw error;
        }
    }));
    router.get('/cashbox-transactions', requirePermissions(['finance.read', 'finance.cashbox.read']), asyncHandler(async (req, res) => {
        const rows = await service.listCashboxTransactions(parseDataScope(req));
        res.json({ success: true, data: rows });
    }));
    router.get('/party-financial-movements', requirePermissions(['finance.read', 'finance.vouchers.read']), asyncHandler(async (req, res) => {
        const rows = await service.listPartyFinancialMovements(parseDataScope(req));
        res.json({ success: true, data: rows });
    }));
    router.get('/party-statements/summary', requirePermissions(['finance.read', 'finance.vouchers.read']), asyncHandler(async (req, res) => {
        const query = partyStatementQuerySchema.parse(req.query);
        const summary = await service.getPartyStatementSummary(parseDataScope(req), query);
        auditService.logAsync({
            req,
            action: 'STATEMENT_GENERATED',
            entityType: 'party_statement',
            metadata: {
                partyType: query.partyType,
                partyId: query.partyId,
                fromAt: query.fromAt,
                toAt: query.toAt,
            },
        });
        res.json({ success: true, data: summary });
    }));
    router.get('/party-statements/entries', requirePermissions(['finance.read', 'finance.vouchers.read']), asyncHandler(async (req, res) => {
        const query = partyStatementQuerySchema.parse(req.query);
        const rows = await service.listPartyStatementEntries(parseDataScope(req), query);
        res.json({ success: true, data: rows });
    }));
    router.get('/party-statements/ledger', requirePermissions(['finance.read', 'finance.vouchers.read']), asyncHandler(async (req, res) => {
        const query = partyLedgerQuerySchema.parse(req.query);
        const result = await service.listPartyLedger(parseDataScope(req), query);
        auditService.logAsync({
            req,
            action: 'LEDGER_ACCESSED',
            entityType: 'party_ledger',
            metadata: {
                partyType: query.partyType,
                partyId: query.partyId,
                page: query.page,
                pageSize: query.pageSize,
            },
        });
        res.json({ success: true, data: result });
    }));
    router.get('/party-statements/currency-summary', requirePermissions(['finance.read', 'finance.vouchers.read']), asyncHandler(async (req, res) => {
        const query = partyStatementQuerySchema.parse(req.query);
        const result = await service.getPartyCurrencySummary(parseDataScope(req), query);
        res.json({ success: true, data: result });
    }));
    router.get('/party-statements/package', requirePermissions(['finance.read', 'finance.vouchers.read']), asyncHandler(async (req, res) => {
        const query = partyLedgerQuerySchema.parse(req.query);
        const result = await service.getPartyStatementPackage(parseDataScope(req), query);
        res.json({ success: true, data: result });
    }));
    router.get('/party-statements/compare', requirePermissions(['finance.read', 'finance.vouchers.read']), asyncHandler(async (req, res) => {
        const query = partyComparisonQuerySchema.parse(req.query);
        const result = await service.getPartyStatementComparison(parseDataScope(req), query);
        res.json({ success: true, data: result });
    }));
    router.get('/party-statements/analytics', requirePermissions(['finance.read', 'finance.vouchers.read']), asyncHandler(async (req, res) => {
        const query = partyAnalyticsQuerySchema.parse(req.query);
        const result = await service.getPartyAnalyticsSnapshot(parseDataScope(req), query);
        res.json({ success: true, data: result });
    }));
    router.get('/party-statements/dashboard-package', requirePermissions(['finance.read', 'finance.vouchers.read']), asyncHandler(async (req, res) => {
        const query = partyDashboardPackageQuerySchema.parse(req.query);
        const result = await service.getPartyDashboardPackage(parseDataScope(req), query);
        res.json({ success: true, data: result });
    }));
    router.get('/party-statements/dashboard-cache-metrics', requirePermissions(['finance.read', 'finance.vouchers.read']), asyncHandler(async (_req, res) => {
        const result = await service.getDashboardCacheMetrics();
        res.json({ success: true, data: result });
    }));
    router.post('/party-statements/dashboard-cache-reset', requirePermissions(['finance.write', 'finance.vouchers.write']), asyncHandler(async (req, res) => {
        const payload = dashboardCacheResetSchema.parse(req.body ?? {});
        const result = await service.resetDashboardCacheState(payload, {
            userId: req.requestUserContext?.userId,
            scope: parseDataScope(req),
        });
        res.json({ success: true, data: result });
    }));
    router.get('/party-statements/dashboard-cache-reset-audit', requirePermissions(['finance.read', 'finance.vouchers.read']), asyncHandler(async (req, res) => {
        const limit = typeof req.query.limit === 'string' ? Number(req.query.limit) : 20;
        const result = await service.getDashboardCacheResetAudit(Number.isFinite(limit) ? limit : 20);
        res.json({ success: true, data: result });
    }));
    return router;
}
