import { Router } from 'express';
import { z } from 'zod';
import type { FinanceService } from '../services/financeService.js';
import { asyncHandler } from '../utils/http.js';
import { parseDataScope } from '../utils/scope.js';
import { emit } from '../events/eventBus.js';
import { forbidUserTypes, requireAnyPermissions, requirePermissions } from '../middleware/authorization.js';
import { currencyCodeSchema } from '../utils/money.js';
import { AuditService } from '../services/auditService.js';
import { requireIdempotencyKey } from '../middleware/idempotency.js';
import { calculateShipmentFinancialBreakdown } from '../utils/shipmentFinancialBreakdown.js';
import { computeAgentRemittanceDue } from '../utils/agentShipmentSettlement.js';
import { HttpError } from '../utils/errors.js';
import { buildLedgerFinanceAuditReport } from '../services/ledgerFinanceAuditService.js';
import {
  buildDailyLedgerSummaryReport,
  buildShipmentsByDateReport,
  buildVoucherReport,
} from '../services/financeStatementsService.js';

function todayIsoDate(): string {
  return new Date().toISOString().slice(0, 10);
}

function getRequestPermissions(req: unknown): string[] {
  const userContext = (req as { requestUserContext?: { permissions?: string[] } }).requestUserContext;
  return Array.isArray(userContext?.permissions) ? userContext.permissions : [];
}

function canBackdateVouchers(req: unknown): boolean {
  const userContext = (req as { requestUserContext?: { roleCode?: string; userType?: string } }).requestUserContext;
  const roleCode = String(userContext?.roleCode ?? '').toLowerCase();
  const userType = String(userContext?.userType ?? '').toLowerCase();
  const isAdmin = roleCode === 'admin' || userType === 'admin';
  const isManager = isAdmin || roleCode === 'general_manager' || roleCode === 'branch_manager';
  return isManager || getRequestPermissions(req).includes('finance.vouchers.backdate');
}

function resolveVoucherTargetDate(createdAt?: string): string {
  if (createdAt) return createdAt.slice(0, 10);
  return todayIsoDate();
}

function assertVoucherDateAllowed(req: unknown, targetDate: string) {
  const today = todayIsoDate();
  if (targetDate > today) {
    throw new HttpError(400, 'لا يمكن إنشاء سند بتاريخ مستقبلي.');
  }
  if (targetDate !== today && !canBackdateVouchers(req)) {
    throw new HttpError(403, 'لا يمكن إنشاء أو تعديل سند بتاريخ سابق — يلزم صلاحية السندات بتاريخ سابق.');
  }
}

function voucherFxContext(req: unknown, createdAt?: string) {
  const userContext = (req as { requestUserContext?: { companyId?: string; baseCurrency?: string } }).requestUserContext;
  return {
    companyId: userContext?.companyId,
    baseCurrency: userContext?.baseCurrency,
    effectiveDate: createdAt ? createdAt.slice(0, 10) : undefined,
  };
}

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
  cashboxId: z.string().uuid().optional(),
  status: z.enum(['draft', 'confirmed', 'cancelled']).default('draft'),
  notes: z.string().optional(),
  originalAmount: z.coerce.number(),
  originalCurrency: currencyCodeSchema,
  exchangeRateToUsd: z.coerce.number().positive().optional(),
  baseAmountUsd: z.coerce.number().optional(),
  createdByUserId: z.string().uuid().optional(),
  createdAt: z.string().datetime({ offset: true }).optional(),
  expectedUpdatedAt: z.string().datetime({ offset: true }).optional(),
});

const cashboxCreateSchema = z.object({
  code: z.string().min(1),
  name: z.string().min(1),
  type: z.enum(['COMPANY', 'BRANCH', 'AGENT']),
  currencyCode: currencyCodeSchema,
  branchId: z.string().uuid().optional(),
  agentId: z.string().uuid().optional(),
  openingBalance: z.coerce.number().optional(),
  isActive: z.boolean().optional(),
  notes: z.string().optional(),
  parentCashboxId: z.string().uuid().optional().nullable(),
});

const cashboxUpdateSchema = cashboxCreateSchema.partial();

const cashboxListQuerySchema = z.object({
  search: z.string().optional(),
  type: z.enum(['COMPANY', 'BRANCH', 'AGENT']).optional(),
  branchId: z.string().uuid().optional(),
  agentId: z.string().uuid().optional(),
  currencyCode: z.string().optional(),
  isActive: z.enum(['true', 'false']).optional(),
});

const cashboxStatementQuerySchema = z.object({
  dateFrom: z.string().datetime({ offset: true }).optional(),
  dateTo: z.string().datetime({ offset: true }).optional(),
  transactionType: z.enum(['inflow', 'outflow']).optional(),
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
const debitCreditSummaryQuerySchema = z.object({
  partyType: z.enum(['customer', 'sender_receiver', 'agent']).optional(),
  partyId: z.string().uuid().optional(),
  branchId: z.string().uuid().optional(),
  currencyCode: z.string().min(3).max(3).optional(),
  dateFrom: z.string().datetime({ offset: true }).optional(),
  dateTo: z.string().datetime({ offset: true }).optional(),
  balanceDirection: z.enum(['debit', 'credit', 'balanced']).optional(),
  search: z.string().optional(),
  page: z.coerce.number().int().min(1).optional(),
  pageSize: z.coerce.number().int().min(1).max(1000).optional(),
  includeOperationalParties: z
    .enum(['true', 'false'])
    .optional()
    .transform((v) => v === 'true'),
});
const accountStatementQuerySchema = debitCreditSummaryQuerySchema.extend({
  referenceType: z.enum(['shipment', 'receipt', 'payment', 'expense', 'settlement']).optional(),
});
const partyLedgerQuerySchema = partyStatementQuerySchema.extend({
  page: z.coerce.number().int().min(1).optional(),
  pageSize: z.coerce.number().int().min(1).max(200).optional(),
});

const profitLossQuerySchema = z.object({
  fromAt: z.string().datetime({ offset: true }),
  toAt: z.string().datetime({ offset: true }),
  branchId: z.string().uuid().optional(),
  currencyCode: currencyCodeSchema.optional(),
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
        if (!value) return ['statement', 'comparison', 'analytics'] as Array<'statement' | 'comparison' | 'analytics'>;
        return value
          .split(',')
          .map((tab) => tab.trim())
          .filter((tab): tab is 'statement' | 'comparison' | 'analytics' =>
            tab === 'statement' || tab === 'comparison' || tab === 'analytics',
          );
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

const accountingReportQuerySchema = z.object({
  fromAt: z.string().datetime({ offset: true }).optional(),
  toAt: z.string().datetime({ offset: true }).optional(),
  asOf: z.string().datetime({ offset: true }).optional(),
  branchId: z.string().uuid().optional(),
  currencyCode: z.string().min(3).max(3).optional(),
});

const agentReconciliationQuerySchema = accountingReportQuerySchema.extend({
  agentId: z.string().uuid(),
});

const bilateralItemSchema = z.object({
  itemType: z.string().min(1),
  description: z.string().min(1),
  companyAmount: z.coerce.number(),
  agentAmount: z.union([z.coerce.number(), z.null()]).optional(),
  notes: z.string().optional(),
  sortOrder: z.coerce.number().int().optional(),
});

const bilateralSaveSchema = z.object({
  id: z.string().uuid().optional(),
  agentId: z.string().uuid(),
  periodFrom: z.string().datetime({ offset: true }),
  periodTo: z.string().datetime({ offset: true }),
  currencyCode: z.string().min(3).max(3).optional(),
  previousBalance: z.coerce.number().optional(),
  periodMovement: z.coerce.number().optional(),
  currentBalance: z.coerce.number().optional(),
  notes: z.string().optional(),
  agentNotes: z.string().optional(),
  forceApprove: z.boolean().optional(),
  forceNote: z.string().optional(),
  items: z.array(bilateralItemSchema).min(1),
});

const bilateralStatusSchema = z.object({
  agentNotes: z.string().optional(),
  disputeNote: z.string().optional(),
});

const ledgerFinanceAuditQuerySchema = z.object({
  fromDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).default('2026-06-01'),
});

const financeStatementDateRangeSchema = z.object({
  dateFrom: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  dateTo: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  branchId: z.string().uuid().optional(),
  agentId: z.string().uuid().optional(),
  customerId: z.string().uuid().optional(),
  cashboxId: z.string().uuid().optional(),
  currencyCode: z.string().min(3).max(3).optional(),
  status: z.string().optional(),
});

const monthlyInventoryDetailQuerySchema = financeStatementDateRangeSchema.extend({
  partyType: z.enum(['agent', 'unassigned']),
  partyId: z.string().uuid().optional(),
  partyName: z.string().optional(),
});

const closePeriodSchema = z.object({
  periodStart: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  periodEnd: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  branchId: z.string().uuid().optional().nullable(),
  currencyCode: z.string().min(3).max(3).optional(),
  notes: z.string().optional(),
});

function requireCompanyId(req: unknown): string {
  const companyId = (req as { requestUserContext?: { companyId?: string } }).requestUserContext?.companyId;
  if (!companyId) throw new HttpError(400, 'Company context is required.');
  return companyId;
}

export function createFinanceRouter(service: FinanceService) {
  const router = Router();
  const auditService = new AuditService();

  router.get(
    '/receipt-vouchers',
    requireAnyPermissions(['finance.read', 'finance.write', 'finance.view']),
    requireAnyPermissions(['finance.vouchers.read', 'finance.vouchers.view']),
    asyncHandler(async (req, res) => {
      const deliveryId = typeof req.query.deliveryId === 'string' ? req.query.deliveryId : undefined;
      const rows = await service.listReceiptVouchers(parseDataScope(req), { deliveryId });
      res.json({ success: true, data: rows });
    }),
  );

  router.get(
    '/receipt-vouchers/:id',
    requireAnyPermissions(['finance.read', 'finance.write', 'finance.view']),
    requireAnyPermissions(['finance.vouchers.read', 'finance.vouchers.view']),
    asyncHandler(async (req, res) => {
      const row = await service.getReceiptVoucherById(String(req.params.id), parseDataScope(req));
      if (!row) {
        res.status(404).json({ success: false, error: 'Receipt voucher not found' });
        return;
      }
      res.json({ success: true, data: row });
    }),
  );

  router.post(
    '/receipt-vouchers',
    requireAnyPermissions(['finance.read', 'finance.write', 'finance.view']),
    requireAnyPermissions(['finance.vouchers.create', 'finance.vouchers.write']),
    requireIdempotencyKey('finance.receipt.create'),
    asyncHandler(async (req, res) => {
      try {
        const payload = receiptCreateSchema.parse(req.body);
        assertVoucherDateAllowed(req, resolveVoucherTargetDate(payload.createdAt));
        const row = await service.createReceiptVoucher(payload, parseDataScope(req), voucherFxContext(req, payload.createdAt));
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
        emit({ type: 'voucher.created', companyId: (req as any).requestUserContext?.companyId ?? '', entityId: row.id, timestamp: new Date().toISOString(), correlationId: (req as any).correlationId });
        res.status(201).json({ success: true, data: row });
      } catch (error) {
        auditService.logAsync({
          req,
          action: 'VOUCHER_POST_FAILED',
          entityType: 'receipt_voucher',
          metadata: { reason: (error as any)?.message ?? 'unknown' },
        });
        throw error;
      }
    }),
  );

  router.put(
    '/receipt-vouchers/:id',
    forbidUserTypes(['agent'], 'لا تملك صلاحية تعديل هذا السند.'),
    requireAnyPermissions(['finance.read', 'finance.write', 'finance.view']),
    requireAnyPermissions(['finance.vouchers.update', 'finance.vouchers.write']),
    requireIdempotencyKey('finance.receipt.update'),
    asyncHandler(async (req, res) => {
      try {
        const payload = receiptUpdateSchema.parse(req.body);
        if (payload.createdAt !== undefined) {
          assertVoucherDateAllowed(req, resolveVoucherTargetDate(payload.createdAt));
        }
        const before = await service.getReceiptVoucherById(String(req.params.id), parseDataScope(req));
        const row = await service.updateReceiptVoucher(String(req.params.id), payload, parseDataScope(req), voucherFxContext(req, payload.createdAt));
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
      } catch (error) {
        auditService.logAsync({
          req,
          action: 'VOUCHER_POST_FAILED',
          entityType: 'receipt_voucher',
          entityId: String(req.params.id),
          metadata: { reason: (error as any)?.message ?? 'unknown' },
        });
        throw error;
      }
    }),
  );

  router.post(
    '/receipt-vouchers/auto-generate-from-delivery/:deliveryId',
    requireAnyPermissions(['finance.read', 'finance.write', 'finance.view']),
    requireAnyPermissions(['finance.vouchers.create', 'finance.vouchers.write']),
    requireIdempotencyKey('finance.receipt.auto-generate'),
    asyncHandler(async (req, res) => {
      try {
        const deliveryId = String(req.params.deliveryId);
        const allowDuplicate = req.query.allowDuplicate === 'true';
        const userId = (req as any).requestUserContext?.userId as string | undefined;
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
      } catch (error) {
        auditService.logAsync({
          req,
          action: 'VOUCHER_POST_FAILED',
          entityType: 'receipt_voucher',
          entityId: String(req.params.deliveryId),
          metadata: { reason: (error as any)?.message ?? 'unknown' },
        });
        throw error;
      }
    }),
  );

  router.get(
    '/payment-vouchers',
    requireAnyPermissions(['finance.read', 'finance.write', 'finance.view']),
    requireAnyPermissions(['finance.vouchers.read', 'finance.vouchers.view']),
    asyncHandler(async (req, res) => {
      const rows = await service.listPaymentVouchers(parseDataScope(req));
      res.json({ success: true, data: rows });
    }),
  );

  router.get(
    '/payment-vouchers/:id',
    requireAnyPermissions(['finance.read', 'finance.write', 'finance.view']),
    requireAnyPermissions(['finance.vouchers.read', 'finance.vouchers.view']),
    asyncHandler(async (req, res) => {
      const row = await service.getPaymentVoucherById(String(req.params.id), parseDataScope(req));
      if (!row) {
        res.status(404).json({ success: false, error: 'Payment voucher not found' });
        return;
      }
      res.json({ success: true, data: row });
    }),
  );

  router.post(
    '/payment-vouchers',
    requireAnyPermissions(['finance.read', 'finance.write', 'finance.view']),
    requireAnyPermissions(['finance.vouchers.create', 'finance.vouchers.write']),
    requireIdempotencyKey('finance.payment.create'),
    asyncHandler(async (req, res) => {
      try {
        const payload = paymentCreateSchema.parse(req.body);
        assertVoucherDateAllowed(req, resolveVoucherTargetDate(payload.createdAt));
        const row = await service.createPaymentVoucher(payload, parseDataScope(req), voucherFxContext(req, payload.createdAt));
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
      } catch (error) {
        auditService.logAsync({
          req,
          action: 'VOUCHER_POST_FAILED',
          entityType: 'payment_voucher',
          metadata: { reason: (error as any)?.message ?? 'unknown' },
        });
        throw error;
      }
    }),
  );

  router.put(
    '/payment-vouchers/:id',
    forbidUserTypes(['agent'], 'لا تملك صلاحية تعديل هذا السند.'),
    requireAnyPermissions(['finance.read', 'finance.write', 'finance.view']),
    requireAnyPermissions(['finance.vouchers.update', 'finance.vouchers.write']),
    requireIdempotencyKey('finance.payment.update'),
    asyncHandler(async (req, res) => {
      try {
        const payload = paymentUpdateSchema.parse(req.body);
        if (payload.createdAt !== undefined) {
          assertVoucherDateAllowed(req, resolveVoucherTargetDate(payload.createdAt));
        }
        const before = await service.getPaymentVoucherById(String(req.params.id), parseDataScope(req));
        const row = await service.updatePaymentVoucher(String(req.params.id), payload, parseDataScope(req), voucherFxContext(req, payload.createdAt));
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
      } catch (error) {
        auditService.logAsync({
          req,
          action: 'VOUCHER_POST_FAILED',
          entityType: 'payment_voucher',
          entityId: String(req.params.id),
          metadata: { reason: (error as any)?.message ?? 'unknown' },
        });
        throw error;
      }
    }),
  );

  router.get(
    '/cashboxes',
    requireAnyPermissions(['finance.read', 'finance.write', 'finance.view']),
    requireAnyPermissions(['finance.cashboxes.view', 'finance.cashbox.read']),
    asyncHandler(async (req, res) => {
      const q = cashboxListQuerySchema.parse(req.query);
      const isActive = q.isActive === 'true' ? true : q.isActive === 'false' ? false : undefined;
      const rows = await service.listCashboxes(parseDataScope(req), {
        search: q.search,
        type: q.type,
        branchId: q.branchId,
        agentId: q.agentId,
        currencyCode: q.currencyCode,
        isActive,
      });
      res.json({ success: true, data: rows });
    }),
  );

  router.post(
    '/cashboxes/sync',
    requireAnyPermissions(['finance.read', 'finance.write', 'finance.view']),
    requirePermissions(['finance.cashboxes.manage']),
    asyncHandler(async (req, res) => {
      const scope = parseDataScope(req);
      if (!scope.companyId) {
        res.status(400).json({ success: false, error: 'لا يمكن المزامنة بدون نطاق شركة.' });
        return;
      }
      const stats = await service.syncCompanyCashboxes(scope.companyId);
      auditService.logAsync({
        req,
        action: 'CASHBOXES_SYNCED',
        entityType: 'cashbox',
        metadata: stats,
      });
      res.json({ success: true, data: stats });
    }),
  );

  router.get(
    '/cashboxes/:id',
    requireAnyPermissions(['finance.read', 'finance.write', 'finance.view']),
    requireAnyPermissions(['finance.cashboxes.view', 'finance.cashbox.read']),
    asyncHandler(async (req, res) => {
      const row = await service.getCashboxById(String(req.params.id), parseDataScope(req));
      if (!row) {
        res.status(404).json({ success: false, error: 'الصندوق غير موجود' });
        return;
      }
      res.json({ success: true, data: row });
    }),
  );

  router.get(
    '/cashboxes/:id/movements',
    requireAnyPermissions(['finance.read', 'finance.write', 'finance.view']),
    requireAnyPermissions(['finance.cashboxes.movements.view', 'finance.cashbox.read']),
    asyncHandler(async (req, res) => {
      const rows = await service.listCashboxMovementsForCashbox(String(req.params.id), parseDataScope(req));
      res.json({ success: true, data: rows });
    }),
  );

  router.get(
    '/cashboxes/:id/statement',
    requireAnyPermissions(['finance.read', 'finance.write', 'finance.view']),
    requireAnyPermissions(['finance.cashboxes.movements.view', 'finance.cashbox.read']),
    asyncHandler(async (req, res) => {
      const q = cashboxStatementQuerySchema.parse(req.query);
      const data = await service.getCashboxStatement(String(req.params.id), parseDataScope(req), q);
      if (!data) {
        res.status(404).json({ success: false, error: 'الصندوق غير موجود' });
        return;
      }
      res.json({ success: true, data });
    }),
  );

  router.post(
    '/cashboxes',
    requireAnyPermissions(['finance.read', 'finance.write', 'finance.view']),
    requirePermissions(['finance.cashboxes.manage']),
    forbidUserTypes(['agent'], 'إنشاء صناديق جديدة متاح للإدارة فقط.'),
    asyncHandler(async (req, res) => {
      const body = cashboxCreateSchema.parse(req.body);
      const userContext = (req as any).requestUserContext;
      const row = await service.createCashbox(
        {
          companyId: userContext?.companyId,
          code: body.code,
          name: body.name,
          type: body.type,
          currencyCode: body.currencyCode,
          branchId: body.branchId ?? null,
          agentId: body.agentId ?? null,
          openingBalance: body.openingBalance,
          isActive: body.isActive,
          notes: body.notes ?? null,
          createdByUserId: userContext?.userId ?? null,
          parentCashboxId: body.parentCashboxId ?? null,
        },
        parseDataScope(req),
      );
      auditService.logAsync({
        req,
        action: 'CASHBOX_CREATED',
        entityType: 'cashbox',
        entityId: row?.id,
        metadata: { code: row?.code },
      });
      res.status(201).json({ success: true, data: row });
    }),
  );

  router.put(
    '/cashboxes/:id',
    requireAnyPermissions(['finance.read', 'finance.write', 'finance.view']),
    requirePermissions(['finance.cashboxes.manage']),
    forbidUserTypes(['agent'], 'تعديل تعريف الصندوق متاح للإدارة فقط.'),
    asyncHandler(async (req, res) => {
      const body = cashboxUpdateSchema.parse(req.body);
      const row = await service.updateCashbox(String(req.params.id), body, parseDataScope(req));
      if (!row) {
        res.status(404).json({ success: false, error: 'الصندوق غير موجود' });
        return;
      }
      auditService.logAsync({
        req,
        action: 'CASHBOX_UPDATED',
        entityType: 'cashbox',
        entityId: row.id,
        metadata: {},
      });
      res.json({ success: true, data: row });
    }),
  );

  router.get(
    '/cashbox-transactions',
    requireAnyPermissions(['finance.read', 'finance.write', 'finance.view']),
    requireAnyPermissions(['finance.cashboxes.movements.view', 'finance.cashbox.read']),
    asyncHandler(async (req, res) => {
      const rows = await service.listCashboxTransactions(parseDataScope(req));
      res.json({ success: true, data: rows });
    }),
  );

  router.get(
    '/party-financial-movements',
    requirePermissions(['finance.read', 'finance.vouchers.read']),
    forbidUserTypes(['agent'], 'هذا التقرير غير متاح لمستخدم الوكيل.'),
    asyncHandler(async (req, res) => {
      const rows = await service.listPartyFinancialMovements(parseDataScope(req));
      res.json({ success: true, data: rows });
    }),
  );

  router.get(
    '/debit-credit-summary',
    requireAnyPermissions(['finance.debit_credit.view', 'finance.read', 'finance.view']),
    forbidUserTypes(['agent'], 'مركز الدائن والمدين غير متاح لمستخدم الوكيل.'),
    asyncHandler(async (req, res) => {
      const query = debitCreditSummaryQuerySchema.parse(req.query);
      const rows = await service.getDebitCreditSummary(parseDataScope(req), query);
      res.json({ success: true, data: rows });
    }),
  );

  router.get(
    '/reports/trial-balance',
    requireAnyPermissions(['finance.read', 'finance.view']),
    forbidUserTypes(['agent'], 'ميزان المراجعة غير متاح لمستخدم الوكيل.'),
    asyncHandler(async (req, res) => {
      const query = accountingReportQuerySchema.parse(req.query);
      const data = await service.getTrialBalanceReport(parseDataScope(req), query);
      res.json({ success: true, data });
    }),
  );

  router.get(
    '/reports/balance-sheet',
    requireAnyPermissions(['finance.read', 'finance.view']),
    forbidUserTypes(['agent'], 'قائمة المركز المالي غير متاحة لمستخدم الوكيل.'),
    asyncHandler(async (req, res) => {
      const query = accountingReportQuerySchema.parse(req.query);
      const data = await service.getBalanceSheetReport(parseDataScope(req), query);
      res.json({ success: true, data });
    }),
  );

  router.get(
    '/accounting-periods',
    requireAnyPermissions(['finance.read', 'finance.view']),
    forbidUserTypes(['agent'], 'إقفال الفترات غير متاح لمستخدم الوكيل.'),
    asyncHandler(async (req, res) => {
      const limit = Math.min(100, Math.max(1, Number(req.query.limit ?? 50)));
      const data = await service.listAccountingPeriodClosures(parseDataScope(req), limit);
      res.json({ success: true, data });
    }),
  );

  router.post(
    '/accounting-periods/close',
    requireAnyPermissions(['finance.write', 'finance.read']),
    forbidUserTypes(['agent'], 'إقفال الفترات غير متاح لمستخدم الوكيل.'),
    asyncHandler(async (req, res) => {
      const payload = closePeriodSchema.parse(req.body);
      const userId = (req as { requestUserContext?: { userId?: string } }).requestUserContext?.userId;
      const data = await service.closeAccountingPeriod(parseDataScope(req), {
        periodStart: payload.periodStart,
        periodEnd: payload.periodEnd,
        branchId: payload.branchId ?? undefined,
        currencyCode: payload.currencyCode,
        notes: payload.notes,
        closedByUserId: userId ?? null,
      });
      auditService.logAsync({
        req,
        action: 'ACCOUNTING_PERIOD_CLOSED',
        entityType: 'accounting_period',
        entityId: data.id,
        metadata: { periodStart: payload.periodStart, periodEnd: payload.periodEnd },
      });
      res.json({ success: true, data });
    }),
  );

  router.get(
    '/agent-settlement',
    requireAnyPermissions(['finance.read', 'finance.view']),
    forbidUserTypes(['agent'], 'كشف تسوية الوكيل غير متاح لمستخدم الوكيل.'),
    asyncHandler(async (req, res) => {
      const query = agentReconciliationQuerySchema.parse(req.query);
      const companyId = requireCompanyId(req);
      const data = await service.getAgentSettlementPackage(companyId, query.agentId, query);
      if (!data) {
        res.status(404).json({ success: false, error: 'Agent not found.' });
        return;
      }
      auditService.logAsync({
        req,
        action: 'AGENT_SETTLEMENT_GENERATED',
        entityType: 'agent_settlement',
        entityId: query.agentId,
        metadata: { fromAt: query.fromAt, toAt: query.toAt, currencyCode: query.currencyCode },
      });
      res.json({ success: true, data });
    }),
  );

  router.get(
    '/hawala-reconciliation',
    requireAnyPermissions(['finance.read', 'finance.view']),
    forbidUserTypes(['agent'], 'مطابقة الحوالات غير متاحة لمستخدم الوكيل.'),
    asyncHandler(async (req, res) => {
      const query = agentReconciliationQuerySchema.parse(req.query);
      const companyId = requireCompanyId(req);
      const data = await service.getHawalaReconciliationPackage(companyId, query.agentId, query);
      if (!data) {
        res.status(404).json({ success: false, error: 'Agent not found.' });
        return;
      }
      auditService.logAsync({
        req,
        action: 'HAWALA_RECONCILIATION_GENERATED',
        entityType: 'hawala_reconciliation',
        entityId: query.agentId,
        metadata: { fromAt: query.fromAt, toAt: query.toAt, currencyCode: query.currencyCode },
      });
      res.json({ success: true, data });
    }),
  );

  router.get(
    '/agent-branch-reconciliation',
    requireAnyPermissions(['finance.read', 'finance.view']),
    forbidUserTypes(['agent'], 'مطابقة الوكيل والفرع الرئيسي غير متاحة لمستخدم الوكيل.'),
    asyncHandler(async (req, res) => {
      const query = agentReconciliationQuerySchema.parse(req.query);
      const companyId = requireCompanyId(req);
      const data = await service.getAgentBranchReconciliationPackage(companyId, query.agentId, query);
      if (!data) {
        res.status(404).json({ success: false, error: 'Agent not found.' });
        return;
      }
      auditService.logAsync({
        req,
        action: 'AGENT_BRANCH_RECONCILIATION_GENERATED',
        entityType: 'agent_branch_reconciliation',
        entityId: query.agentId,
        metadata: { fromAt: query.fromAt, toAt: query.toAt, currencyCode: query.currencyCode },
      });
      res.json({ success: true, data });
    }),
  );

  router.get(
    '/bilateral-reconciliations/preview',
    requireAnyPermissions(['finance.read', 'finance.view']),
    forbidUserTypes(['agent'], 'المطابقة الثنائية غير متاحة لمستخدم الوكيل.'),
    asyncHandler(async (req, res) => {
      const query = agentReconciliationQuerySchema.parse(req.query);
      const companyId = requireCompanyId(req);
      const data = await service.getBilateralReconciliationPreview(companyId, query.agentId, query);
      if (!data) {
        res.status(404).json({ success: false, error: 'Agent not found.' });
        return;
      }
      auditService.logAsync({
        req,
        action: 'BILATERAL_RECONCILIATION_PREVIEW',
        entityType: 'bilateral_reconciliation',
        entityId: query.agentId,
        metadata: { fromAt: query.fromAt, toAt: query.toAt, currencyCode: query.currencyCode },
      });
      res.json({ success: true, data });
    }),
  );

  router.get(
    '/bilateral-reconciliations',
    requireAnyPermissions(['finance.read', 'finance.view']),
    forbidUserTypes(['agent'], 'المطابقة الثنائية غير متاحة لمستخدم الوكيل.'),
    asyncHandler(async (req, res) => {
      const agentId = z.string().uuid().parse(req.query.agentId);
      const companyId = requireCompanyId(req);
      const data = await service.listBilateralReconciliations(companyId, agentId);
      res.json({ success: true, data });
    }),
  );

  router.get(
    '/bilateral-reconciliations/reports/discrepancies',
    requireAnyPermissions(['finance.read', 'finance.view']),
    forbidUserTypes(['agent'], 'تقرير الفروقات غير متاح لمستخدم الوكيل.'),
    asyncHandler(async (req, res) => {
      const agentId = z.string().uuid().parse(req.query.agentId);
      const currencyCode = z.string().min(3).max(3).optional().parse(req.query.currencyCode);
      const companyId = requireCompanyId(req);
      const data = await service.getBilateralDiscrepancyReport(companyId, agentId, currencyCode);
      res.json({ success: true, data });
    }),
  );

  router.get(
    '/bilateral-reconciliations/reports/balance-history',
    requireAnyPermissions(['finance.read', 'finance.view']),
    forbidUserTypes(['agent'], 'تقرير الذمم غير متاح لمستخدم الوكيل.'),
    asyncHandler(async (req, res) => {
      const agentId = z.string().uuid().parse(req.query.agentId);
      const currencyCode = z.string().min(3).max(3).optional().parse(req.query.currencyCode);
      const companyId = requireCompanyId(req);
      const data = await service.getBilateralBalanceHistoryReport(companyId, agentId, currencyCode);
      res.json({ success: true, data });
    }),
  );

  router.get(
    '/bilateral-reconciliations/:id',
    requireAnyPermissions(['finance.read', 'finance.view']),
    forbidUserTypes(['agent'], 'المطابقة الثنائية غير متاحة لمستخدم الوكيل.'),
    asyncHandler(async (req, res) => {
      const companyId = requireCompanyId(req);
      const data = await service.getBilateralReconciliationById(companyId, String(req.params.id));
      if (!data) {
        res.status(404).json({ success: false, error: 'المطابقة غير موجودة.' });
        return;
      }
      res.json({ success: true, data });
    }),
  );

  router.post(
    '/bilateral-reconciliations/draft',
    requireAnyPermissions(['finance.write', 'finance.vouchers.write']),
    forbidUserTypes(['agent'], 'المطابقة الثنائية غير متاحة لمستخدم الوكيل.'),
    asyncHandler(async (req, res) => {
      const payload = bilateralSaveSchema.parse(req.body);
      const companyId = requireCompanyId(req);
      const userId = (req as any).requestUserContext?.userId as string | undefined;
      const data = await service.saveBilateralReconciliationDraft(companyId, {
        ...payload,
        createdByUserId: userId ?? null,
      });
      auditService.logAsync({
        req,
        action: 'BILATERAL_RECONCILIATION_DRAFT_SAVED',
        entityType: 'bilateral_reconciliation',
        entityId: data.id,
        metadata: { agentId: payload.agentId, status: 'draft' },
      });
      res.status(201).json({ success: true, data });
    }),
  );

  router.post(
    '/bilateral-reconciliations/approve',
    requireAnyPermissions(['finance.write', 'finance.vouchers.write']),
    forbidUserTypes(['agent'], 'المطابقة الثنائية غير متاحة لمستخدم الوكيل.'),
    asyncHandler(async (req, res) => {
      const payload = bilateralSaveSchema.parse(req.body);
      const companyId = requireCompanyId(req);
      const userId = (req as any).requestUserContext?.userId as string | undefined;
      const data = await service.approveBilateralReconciliation(companyId, {
        ...payload,
        approvedByUserId: userId ?? null,
        createdByUserId: userId ?? null,
      });
      auditService.logAsync({
        req,
        action: 'BILATERAL_RECONCILIATION_APPROVED',
        entityType: 'bilateral_reconciliation',
        entityId: data.id,
        metadata: {
          agentId: payload.agentId,
          currentBalance: data.current_balance,
          currencyCode: data.currency_code,
          forceApprove: Boolean(payload.forceApprove),
          forceNote: payload.forceNote ?? null,
        },
      });
      res.status(201).json({ success: true, data });
    }),
  );

  router.post(
    '/bilateral-reconciliations/:id/send-to-agent',
    requireAnyPermissions(['finance.write', 'finance.vouchers.write']),
    forbidUserTypes(['agent'], 'المطابقة الثنائية غير متاحة لمستخدم الوكيل.'),
    asyncHandler(async (req, res) => {
      const payload = bilateralStatusSchema.parse(req.body ?? {});
      const companyId = requireCompanyId(req);
      const data = await service.sendBilateralReconciliationToAgent(
        companyId,
        String(req.params.id),
        payload.agentNotes,
      );
      if (!data) {
        res.status(404).json({ success: false, error: 'المطابقة غير موجودة.' });
        return;
      }
      auditService.logAsync({
        req,
        action: 'BILATERAL_RECONCILIATION_PENDING',
        entityType: 'bilateral_reconciliation',
        entityId: String(req.params.id),
      });
      res.json({ success: true, data });
    }),
  );

  router.post(
    '/bilateral-reconciliations/:id/dispute',
    requireAnyPermissions(['finance.write', 'finance.vouchers.write']),
    forbidUserTypes(['agent'], 'المطابقة الثنائية غير متاحة لمستخدم الوكيل.'),
    asyncHandler(async (req, res) => {
      const payload = bilateralStatusSchema.parse(req.body ?? {});
      const companyId = requireCompanyId(req);
      const data = await service.disputeBilateralReconciliation(
        companyId,
        String(req.params.id),
        String(payload.disputeNote ?? ''),
      );
      if (!data) {
        res.status(404).json({ success: false, error: 'المطابقة غير موجودة.' });
        return;
      }
      auditService.logAsync({
        req,
        action: 'BILATERAL_RECONCILIATION_DISPUTED',
        entityType: 'bilateral_reconciliation',
        entityId: String(req.params.id),
        metadata: { disputeNote: payload.disputeNote },
      });
      res.json({ success: true, data });
    }),
  );

  router.get(
    '/ledger-finance-audit',
    requireAnyPermissions(['finance.read', 'finance.view']),
    forbidUserTypes(['agent'], 'تحقق الدفter المالي غير متاح لمستخدم الوكيل.'),
    asyncHandler(async (req, res) => {
      const query = ledgerFinanceAuditQuerySchema.parse(req.query);
      const companyId = requireCompanyId(req);
      const data = await buildLedgerFinanceAuditReport(companyId, query.fromDate);
      auditService.logAsync({
        req,
        action: 'LEDGER_FINANCE_AUDIT_GENERATED',
        entityType: 'ledger_finance_audit',
        metadata: { fromDate: query.fromDate },
      });
      res.json({ success: true, data });
    }),
  );

  router.get(
    '/finance-statements/vouchers/:type',
    requireAnyPermissions(['finance.read', 'finance.view']),
    forbidUserTypes(['agent'], 'كشف السندات غير متاح لمستخدم الوكيل.'),
    asyncHandler(async (req, res) => {
      const type = String(req.params.type);
      if (type !== 'receipt' && type !== 'payment') {
        res.status(400).json({ success: false, error: 'نوع السند غير صالح.' });
        return;
      }
      const query = financeStatementDateRangeSchema.parse(req.query);
      const data = await buildVoucherReport(parseDataScope(req), type, {
        dateFrom: query.dateFrom,
        dateTo: query.dateTo,
        branchId: query.branchId,
        agentId: query.agentId,
        customerId: query.customerId,
        cashboxId: query.cashboxId,
        status: query.status,
      });
      res.json({ success: true, data });
    }),
  );

  router.get(
    '/finance-statements/daily-ledger-summary',
    requireAnyPermissions(['finance.read', 'finance.view']),
    forbidUserTypes(['agent'], 'كشف ملخص الدفتر غير متاح لمستخدم الوكيل.'),
    asyncHandler(async (req, res) => {
      const query = financeStatementDateRangeSchema.parse(req.query);
      const companyId = requireCompanyId(req);
      const data = await buildDailyLedgerSummaryReport(companyId, {
        dateFrom: query.dateFrom,
        dateTo: query.dateTo,
        branchId: query.branchId,
      });
      res.json({ success: true, data });
    }),
  );

  router.get(
    '/finance-statements/shipments-by-date',
    requireAnyPermissions(['finance.read', 'finance.view', 'shipments.read']),
    asyncHandler(async (req, res) => {
      const query = financeStatementDateRangeSchema.parse(req.query);
      const data = await buildShipmentsByDateReport(parseDataScope(req), {
        dateFrom: query.dateFrom,
        dateTo: query.dateTo,
        branchId: query.branchId,
        agentId: query.agentId,
        currencyCode: query.currencyCode,
      });
      res.json({ success: true, data });
    }),
  );

  router.get(
    '/financial-reports/monthly-inventory/party-detail',
    requireAnyPermissions(['finance.read', 'finance.view']),
    forbidUserTypes(['agent'], 'تفاصيل الجرد الشهري غير متاحة لمستخدم الوكيل.'),
    asyncHandler(async (req, res) => {
      const query = monthlyInventoryDetailQuerySchema.parse(req.query);
      const data = await service.getMonthlyInventoryPartyDetail(parseDataScope(req), {
        dateFrom: query.dateFrom,
        dateTo: query.dateTo ?? query.dateFrom,
        branchId: query.branchId,
        partyType: query.partyType,
        partyId: query.partyId,
        partyName: query.partyName,
      });
      res.json({ success: true, data });
    }),
  );

  router.get(
    '/financial-reports/monthly-inventory',
    requireAnyPermissions(['finance.read', 'finance.view']),
    forbidUserTypes(['agent'], 'الجرد الشهري غير متاح لمستخدم الوكيل.'),
    asyncHandler(async (req, res) => {
      const query = financeStatementDateRangeSchema.parse(req.query);
      const data = await service.getMonthlyInventoryReport(parseDataScope(req), {
        dateFrom: query.dateFrom,
        dateTo: query.dateTo ?? query.dateFrom,
        branchId: query.branchId,
      });
      res.json({ success: true, data });
    }),
  );

  router.get(
    '/financial-reports/profit-loss',
    requireAnyPermissions(['finance.read', 'finance.view']),
    forbidUserTypes(['agent'], 'تقرير الأرباح والخسائر غير متاح لمستخدم الوكيل.'),
    asyncHandler(async (req, res) => {
      const query = profitLossQuerySchema.parse(req.query);
      const data = await service.getProfitLossReport(parseDataScope(req), {
        fromAt: query.fromAt,
        toAt: query.toAt,
        branchId: query.branchId,
        currencyCode: query.currencyCode,
      });
      auditService.logAsync({
        req,
        action: 'PROFIT_LOSS_REPORT_GENERATED',
        entityType: 'financial_report',
        metadata: {
          fromAt: query.fromAt,
          toAt: query.toAt,
          branchId: query.branchId,
          currencyCode: query.currencyCode,
        },
      });
      res.json({ success: true, data });
    }),
  );

  router.get(
    '/account-statement',
    requireAnyPermissions(['finance.account_statement.view', 'finance.read', 'finance.view']),
    forbidUserTypes(['agent'], 'كشف الحساب التفصيلي غير متاح لمستخدم الوكيل.'),
    asyncHandler(async (req, res) => {
      const query = accountStatementQuerySchema.parse(req.query);
      const rows = await service.getDetailedAccountStatement(parseDataScope(req), query);
      res.json({ success: true, data: rows });
    }),
  );

  router.get(
    '/party-statements/summary',
    requirePermissions(['finance.read', 'finance.vouchers.read']),
    forbidUserTypes(['agent'], 'تقارير الأطراف غير متاحة لمستخدم الوكيل.'),
    asyncHandler(async (req, res) => {
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
    }),
  );

  router.get(
    '/party-statements/entries',
    requirePermissions(['finance.read', 'finance.vouchers.read']),
    forbidUserTypes(['agent'], 'تقارير الأطراف غير متاحة لمستخدم الوكيل.'),
    asyncHandler(async (req, res) => {
      const query = partyStatementQuerySchema.parse(req.query);
      const rows = await service.listPartyStatementEntries(parseDataScope(req), query);
      res.json({ success: true, data: rows });
    }),
  );

  router.get(
    '/party-statements/ledger',
    requirePermissions(['finance.read', 'finance.vouchers.read']),
    forbidUserTypes(['agent'], 'تقارير الأطراف غير متاحة لمستخدم الوكيل.'),
    asyncHandler(async (req, res) => {
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
    }),
  );

  router.get(
    '/party-statements/currency-summary',
    requirePermissions(['finance.read', 'finance.vouchers.read']),
    forbidUserTypes(['agent'], 'تقارير الأطراف غير متاحة لمستخدم الوكيل.'),
    asyncHandler(async (req, res) => {
      const query = partyStatementQuerySchema.parse(req.query);
      const result = await service.getPartyCurrencySummary(parseDataScope(req), query);
      res.json({ success: true, data: result });
    }),
  );

  router.get(
    '/party-statements/package',
    requirePermissions(['finance.read', 'finance.vouchers.read']),
    forbidUserTypes(['agent'], 'تقارير الأطراف غير متاحة لمستخدم الوكيل.'),
    asyncHandler(async (req, res) => {
      const query = partyLedgerQuerySchema.parse(req.query);
      const result = await service.getPartyStatementPackage(parseDataScope(req), query);
      res.json({ success: true, data: result });
    }),
  );

  router.get(
    '/party-statements/compare',
    requirePermissions(['finance.read', 'finance.vouchers.read']),
    forbidUserTypes(['agent'], 'تقارير الأطراف غير متاحة لمستخدم الوكيل.'),
    asyncHandler(async (req, res) => {
      const query = partyComparisonQuerySchema.parse(req.query);
      const result = await service.getPartyStatementComparison(parseDataScope(req), query);
      res.json({ success: true, data: result });
    }),
  );

  router.get(
    '/party-statements/analytics',
    requirePermissions(['finance.read', 'finance.vouchers.read']),
    forbidUserTypes(['agent'], 'تقارير الأطراف غير متاحة لمستخدم الوكيل.'),
    asyncHandler(async (req, res) => {
      const query = partyAnalyticsQuerySchema.parse(req.query);
      const result = await service.getPartyAnalyticsSnapshot(parseDataScope(req), query);
      res.json({ success: true, data: result });
    }),
  );

  router.get(
    '/party-statements/dashboard-package',
    requirePermissions(['finance.read', 'finance.vouchers.read']),
    forbidUserTypes(['agent'], 'تقارير الأطراف غير متاحة لمستخدم الوكيل.'),
    asyncHandler(async (req, res) => {
      const query = partyDashboardPackageQuerySchema.parse(req.query);
      const result = await service.getPartyDashboardPackage(parseDataScope(req), query);
      res.json({ success: true, data: result });
    }),
  );

  router.get(
    '/party-statements/dashboard-cache-metrics',
    requirePermissions(['finance.read', 'finance.vouchers.read']),
    forbidUserTypes(['agent'], 'تقارير الأطراف غير متاحة لمستخدم الوكيل.'),
    asyncHandler(async (_req, res) => {
      const result = await service.getDashboardCacheMetrics();
      res.json({ success: true, data: result });
    }),
  );

  router.post(
    '/party-statements/dashboard-cache-reset',
    requirePermissions(['finance.write', 'finance.vouchers.write']),
    forbidUserTypes(['agent'], 'تقارير الأطراف غير متاحة لمستخدم الوكيل.'),
    asyncHandler(async (req, res) => {
      const payload = dashboardCacheResetSchema.parse(req.body ?? {});
      const result = await service.resetDashboardCacheState(payload, {
        userId: (req as any).requestUserContext?.userId as string | undefined,
        scope: parseDataScope(req),
      });
      res.json({ success: true, data: result });
    }),
  );

  router.get(
    '/party-statements/dashboard-cache-reset-audit',
    requirePermissions(['finance.read', 'finance.vouchers.read']),
    forbidUserTypes(['agent'], 'تقارير الأطراف غير متاحة لمستخدم الوكيل.'),
    asyncHandler(async (req, res) => {
      const limit = typeof req.query.limit === 'string' ? Number(req.query.limit) : 20;
      const result = await service.getDashboardCacheResetAudit(Number.isFinite(limit) ? limit : 20);
      res.json({ success: true, data: result });
    }),
  );

  // ── Agent COD Statement ───────────────────────────────────────────────────────
  router.get(
    '/agent-cod-statement',
    requirePermissions(['finance.read', 'shipments.read']),
    asyncHandler(async (req, res) => {
      const { pool } = await import('../db/pool.js');
      const scope = parseDataScope(req);
      const uc = (req as any).requestUserContext as { userType?: string; userId?: string; agentId?: string } | undefined;
      const q = req.query as Record<string, string | undefined>;

      // AgentUser: force-scope to their own agent
      const isAgentUser = uc?.userType === 'agent';
      const forcedAgentId = isAgentUser ? (scope.agentId ?? uc?.agentId) : null;

      const values: unknown[] = [];
      const conditions: string[] = ['s.deleted_at is null'];

      if (scope.companyId) {
        values.push(scope.companyId);
        conditions.push(`s.company_id = $${values.length}`);
      }

      if (forcedAgentId) {
        values.push(forcedAgentId);
        conditions.push(`s.agent_id = $${values.length}::uuid`);
      } else if (q.agentId) {
        values.push(q.agentId);
        conditions.push(`s.agent_id = $${values.length}::uuid`);
      }

      if (q.branchId) {
        values.push(q.branchId);
        conditions.push(`s.branch_id = $${values.length}::uuid`);
      }
      if (q.dateFrom) {
        values.push(q.dateFrom);
        conditions.push(`s.created_at >= $${values.length}::timestamptz`);
      }
      if (q.dateTo) {
        values.push(q.dateTo);
        conditions.push(`s.created_at <= $${values.length}::timestamptz`);
      }
      if (q.shipmentStatus) {
        values.push(q.shipmentStatus);
        conditions.push(`s.status = $${values.length}`);
      }
      if (q.currencyCode) {
        values.push(q.currencyCode.toUpperCase());
        conditions.push(`s.original_currency = $${values.length}`);
      }
      if (q.shipmentNo) {
        values.push(`%${q.shipmentNo}%`);
        conditions.push(`s.shipment_no ilike $${values.length}`);
      }
      if (q.senderName) {
        values.push(`%${q.senderName}%`);
        conditions.push(`sr_s.full_name ilike $${values.length}`);
      }
      if (q.receiverName) {
        values.push(`%${q.receiverName}%`);
        conditions.push(`sr_r.full_name ilike $${values.length}`);
      }
      if (q.search?.trim()) {
        values.push(`%${q.search.trim()}%`);
        const n = values.length;
        conditions.push(`(
          s.shipment_no ilike $${n}
          or sr_s.full_name ilike $${n}
          or sr_r.full_name ilike $${n}
          or ag.name ilike $${n}
          or s.destination_city ilike $${n}
        )`);
      }

      // Collection status filter based on payment_status + transfer_fee
      if (q.collectionStatus) {
        if (q.collectionStatus === 'UNPAID') {
          conditions.push(`(s.payment_status = 'UNPAID' or s.payment_status is null) and s.original_amount > 0`);
        } else if (q.collectionStatus === 'PARTIAL') {
          conditions.push(`s.payment_status = 'PARTIAL'`);
        } else if (q.collectionStatus === 'PAID') {
          conditions.push(`s.payment_status = 'PAID'`);
        }
      }

      const pageSize = Math.min(500, Math.max(1, Number(q.pageSize ?? 200)));
      const page = Math.max(1, Number(q.page ?? 1));
      const offset = (page - 1) * pageSize;

      const whereClause = conditions.length ? `where ${conditions.join(' and ')}` : '';

      const dataResult = await pool.query(
        `
        select
          s.id                                             as shipment_id,
          s.shipment_no,
          s.created_at                                     as shipment_date,
          s.agent_id,
          ag.name                                          as agent_name,
          s.branch_id,
          b.name                                           as branch_name,
          sr_s.full_name                                   as sender_name,
          sr_r.full_name                                   as receiver_name,
          s.destination_city                               as destination,
          s.status                                         as shipment_status,
          s.original_currency                              as currency_code,
          case
            when coalesce(s.transfer_fee, 0) <> 0
              or coalesce(s.additional_charges, 0) <> 0
              or coalesce(s.prepaid_amount, 0) <> 0
              or coalesce(s.discount_amount, 0) <> 0
            then greatest(
              coalesce(s.original_amount, 0)
              - coalesce(s.transfer_fee, 0)
              - coalesce(s.additional_charges, 0)
              + coalesce(s.prepaid_amount, 0)
              + coalesce(s.discount_amount, 0),
              0
            )
            else coalesce(s.freight_charge, s.original_amount, 0)
          end                                              as shipping_fee_amount,
          coalesce(s.transfer_fee, 0)                      as sender_collection_amount,
          coalesce(s.additional_charges, 0)                as loading_dues_amount,
          coalesce(s.prepaid_amount, 0)                    as prepaid_amount,
          (
            case
              when coalesce(s.transfer_fee, 0) <> 0
                or coalesce(s.additional_charges, 0) <> 0
                or coalesce(s.prepaid_amount, 0) <> 0
                or coalesce(s.discount_amount, 0) <> 0
              then greatest(
                coalesce(s.original_amount, 0)
                - coalesce(s.transfer_fee, 0)
                - coalesce(s.additional_charges, 0)
                + coalesce(s.prepaid_amount, 0)
                + coalesce(s.discount_amount, 0),
                0
              )
              else coalesce(s.freight_charge, s.original_amount, 0)
            end
            + coalesce(s.transfer_fee, 0)
            + coalesce(s.additional_charges, 0)
            - coalesce(s.prepaid_amount, 0)
            - coalesce(s.discount_amount, 0)
          )                                                as total_due_on_delivery,
          coalesce(s.paid_amount, 0)                       as collected_amount,
          greatest((
            case
              when coalesce(s.transfer_fee, 0) <> 0
                or coalesce(s.additional_charges, 0) <> 0
                or coalesce(s.prepaid_amount, 0) <> 0
                or coalesce(s.discount_amount, 0) <> 0
              then greatest(
                coalesce(s.original_amount, 0)
                - coalesce(s.transfer_fee, 0)
                - coalesce(s.additional_charges, 0)
                + coalesce(s.prepaid_amount, 0)
                + coalesce(s.discount_amount, 0),
                0
              )
              else coalesce(s.freight_charge, s.original_amount, 0)
            end
            + coalesce(s.transfer_fee, 0)
            + coalesce(s.additional_charges, 0)
            - coalesce(s.prepaid_amount, 0)
            - coalesce(s.discount_amount, 0)
          ) - coalesce(s.paid_amount, 0), 0)               as remaining_to_collect,
          0                                                as paid_to_sender_amount,
          coalesce(s.transfer_fee, 0)                      as remaining_to_sender,
          cb.name                                          as collection_cashbox_name,
          (
            select rv2.voucher_no
            from receipt_vouchers rv2
            where rv2.shipment_id = s.id and rv2.status = 'confirmed'
            order by rv2.created_at desc limit 1
          )                                                as last_receipt_voucher_no,
          s.description                                    as notes,
          s.financial_status,
          s.payment_status,
          coalesce(s.freight_charge, 0) as freight_charge,
          coalesce(s.transfer_fee, 0) as transfer_fee,
          coalesce(s.hawala_amount, 0) as hawala_amount,
          coalesce(s.transfer_service_fee, tr.transfer_service_fee, 0) as shipment_transfer_service_fee,
          coalesce(s.agent_commission_percentage_snapshot, 0) as agent_commission_percentage_snapshot,
          coalesce(s.agent_commission_amount_snapshot, 0)     as agent_commission_amount_snapshot,
          coalesce(tr.transfer_service_fee, 0)                as transfer_service_fee,
          coalesce(tr.transfer_service_fee_currency, 'USD')   as transfer_service_fee_currency,
          count(*) over()::int                             as total_count
        from shipments s
        left join agents ag        on ag.id = s.agent_id
        left join branches b       on b.id = s.branch_id
        left join senders_receivers sr_s on sr_s.id = s.sender_id
        left join senders_receivers sr_r on sr_r.id = s.receiver_id
        left join cashboxes cb     on cb.id = s.default_cashbox_id
        left join lateral (
          select
            t.transfer_service_fee,
            t.transfer_service_fee_currency
          from transfers t
          where t.shipment_id = s.id
            and t.company_id = s.company_id
          order by t.created_at desc
          limit 1
        ) tr on true
        ${whereClause}
        order by s.created_at desc
        limit ${pageSize} offset ${offset}
        `,
        values,
      );

      const total = dataResult.rows.length ? Number(dataResult.rows[0].total_count ?? 0) : 0;
      const rows = dataResult.rows.map(({ total_count, ...r }) => {
        const shippingPrice = Number(r.freight_charge ?? 0) + Number(r.transfer_fee ?? 0);
        const commission = Number(r.agent_commission_amount_snapshot ?? 0);
        const prepaid = Number(r.prepaid_amount ?? 0);
        const hawalaAmount = Number(r.hawala_amount ?? 0);
        const transferServiceFee = Number(r.shipment_transfer_service_fee ?? r.transfer_service_fee ?? 0);
        const agentRemittanceDue = computeAgentRemittanceDue({
          transferFee: r.transfer_fee,
          hawalaAmount,
          transferServiceFee,
          agentCommissionAmount: commission,
        });
        return {
        shipmentId: r.shipment_id,
        shipmentNo: r.shipment_no,
        shipmentDate: r.shipment_date,
        agentId: r.agent_id,
        agentName: r.agent_name ?? '—',
        branchId: r.branch_id,
        branchName: r.branch_name ?? '—',
        senderName: r.sender_name ?? '—',
        receiverName: r.receiver_name ?? '—',
        destination: r.destination ?? '—',
        shipmentStatus: r.shipment_status,
        currencyCode: r.currency_code,
        shippingFeeAmount: shippingPrice > 0 ? shippingPrice : Number(r.shipping_fee_amount ?? 0),
        senderCollectionAmount: Number(r.sender_collection_amount ?? 0),
        loadingDuesAmount: Number(r.loading_dues_amount ?? 0),
        prepaidAmount: prepaid,
        hawalaAmount,
        totalDueOnDelivery: Number(r.total_due_on_delivery ?? 0),
        collectedAmount: Number(r.collected_amount ?? 0),
        remainingToCollect: Number(r.remaining_to_collect ?? 0),
        paidToSenderAmount: 0,
        remainingToSender: Number(r.remaining_to_sender ?? 0),
        collectionCashboxName: r.collection_cashbox_name ?? '—',
        lastReceiptVoucherNo: r.last_receipt_voucher_no ?? '—',
        notes: r.notes ?? '',
        financialStatus: r.financial_status,
        paymentStatus: r.payment_status,
        freightPaymentType: prepaid > 0 ? 'PREPAID' : 'COLLECTION',
        agentCommissionPercentageSnapshot: Number(r.agent_commission_percentage_snapshot ?? 0),
        agentCommissionAmount: commission,
        agentRemittanceDue,
        agentOwesCompany: agentRemittanceDue,
        companyOwesAgent: prepaid > 0 ? commission : 0,
        transferServiceFee,
        transferServiceFeeCurrency: String(r.transfer_service_fee_currency ?? 'USD'),
      };
      });

      // Summary totals
      const sumResult = await pool.query(
        `
        select
          coalesce(sum(
            case
              when coalesce(s.transfer_fee, 0) <> 0
                or coalesce(s.additional_charges, 0) <> 0
                or coalesce(s.prepaid_amount, 0) <> 0
                or coalesce(s.discount_amount, 0) <> 0
              then greatest(
                coalesce(s.original_amount, 0)
                - coalesce(s.transfer_fee, 0)
                - coalesce(s.additional_charges, 0)
                + coalesce(s.prepaid_amount, 0)
                + coalesce(s.discount_amount, 0),
                0
              )
              else coalesce(s.freight_charge, s.original_amount, 0)
            end
          ), 0)                                                                  as total_shipping_fees,
          coalesce(sum(coalesce(s.transfer_fee, 0)), 0)                           as total_sender_collections,
          coalesce(sum(
            case
              when coalesce(s.transfer_fee, 0) <> 0
                or coalesce(s.additional_charges, 0) <> 0
                or coalesce(s.prepaid_amount, 0) <> 0
                or coalesce(s.discount_amount, 0) <> 0
              then greatest(
                coalesce(s.original_amount, 0)
                - coalesce(s.transfer_fee, 0)
                - coalesce(s.additional_charges, 0)
                + coalesce(s.prepaid_amount, 0)
                + coalesce(s.discount_amount, 0),
                0
              )
              else coalesce(s.freight_charge, s.original_amount, 0)
            end
            + coalesce(s.transfer_fee, 0)
            + coalesce(s.additional_charges, 0)
            - coalesce(s.prepaid_amount, 0)
            - coalesce(s.discount_amount, 0)
          ), 0)                                                                    as total_due_on_delivery,
          coalesce(sum(coalesce(s.paid_amount, 0)), 0)                            as total_collected,
          coalesce(sum(greatest((
            case
              when coalesce(s.transfer_fee, 0) <> 0
                or coalesce(s.additional_charges, 0) <> 0
                or coalesce(s.prepaid_amount, 0) <> 0
                or coalesce(s.discount_amount, 0) <> 0
              then greatest(
                coalesce(s.original_amount, 0)
                - coalesce(s.transfer_fee, 0)
                - coalesce(s.additional_charges, 0)
                + coalesce(s.prepaid_amount, 0)
                + coalesce(s.discount_amount, 0),
                0
              )
              else coalesce(s.freight_charge, s.original_amount, 0)
            end
            + coalesce(s.transfer_fee, 0)
            + coalesce(s.additional_charges, 0)
            - coalesce(s.prepaid_amount, 0)
            - coalesce(s.discount_amount, 0)
          ) - coalesce(s.paid_amount, 0), 0)), 0)                              as total_remaining_to_collect,
          coalesce(sum(coalesce(s.transfer_fee, 0)), 0)                           as total_remaining_to_senders,
          coalesce(sum(coalesce(s.agent_commission_amount_snapshot, 0)), 0)       as total_agent_commission,
          coalesce(sum(
            greatest(
              coalesce(s.transfer_fee, 0)
              + coalesce(s.hawala_amount, 0)
              + coalesce(s.transfer_service_fee, 0)
              - coalesce(s.agent_commission_amount_snapshot, 0),
              0
            )
          ), 0)                                                                  as total_agent_remittance_due,
          coalesce(sum(
            case
              when coalesce(s.prepaid_amount, 0) > 0 then 0
              else greatest(
                greatest(coalesce(s.freight_charge, 0) + coalesce(s.transfer_fee, 0), 0)
                - coalesce(s.agent_commission_amount_snapshot, 0),
                0
              )
            end
          ), 0)                                                                  as total_agent_owes_company,
          coalesce(sum(coalesce(s.hawala_amount, 0)), 0)                         as total_hawala_amount,
          coalesce(sum(coalesce(s.transfer_service_fee, 0)), 0)                   as total_transfer_service_fees,
          coalesce(sum(
            case
              when coalesce(s.prepaid_amount, 0) > 0 then coalesce(s.agent_commission_amount_snapshot, 0)
              else 0
            end
          ), 0)                                                                  as total_company_owes_agent,
          count(*)::int                                                            as shipment_count,
          s.original_currency                                                     as currency_code
        from shipments s
        left join senders_receivers sr_s on sr_s.id = s.sender_id
        left join senders_receivers sr_r on sr_r.id = s.receiver_id
        left join agents ag        on ag.id = s.agent_id
        ${whereClause}
        group by s.original_currency
        `,
        values,
      );

      let totalConfirmedReceiptsFromAgent = 0;
      if (forcedAgentId || q.agentId) {
        const receiptAgentId = forcedAgentId ?? q.agentId;
        const receiptValues: unknown[] = [];
        const receiptConditions: string[] = [`rv.status = 'confirmed'`];
        if (scope.companyId) {
          receiptValues.push(scope.companyId);
          receiptConditions.push(`rv.company_id = $${receiptValues.length}`);
        }
        receiptValues.push(receiptAgentId);
        receiptConditions.push(`rv.agent_id = $${receiptValues.length}::uuid`);
        if (q.currencyCode) {
          receiptValues.push(q.currencyCode.toUpperCase());
          receiptConditions.push(`upper(rv.original_currency) = $${receiptValues.length}`);
        }
        const receiptSumResult = await pool.query(
          `
          select coalesce(sum(rv.original_amount), 0)::numeric as total_confirmed_receipts
          from receipt_vouchers rv
          where ${receiptConditions.join(' and ')}
          `,
          receiptValues,
        );
        totalConfirmedReceiptsFromAgent = Number(receiptSumResult.rows[0]?.total_confirmed_receipts ?? 0);
      }

      const summary = sumResult.rows.map((r) => {
        const totalAgentRemittanceDue = Number(r.total_agent_remittance_due ?? 0);
        return {
        currencyCode: r.currency_code,
        totalShippingFees: Number(r.total_shipping_fees),
        totalSenderCollections: Number(r.total_sender_collections),
        totalDueOnDelivery: Number(r.total_due_on_delivery),
        totalCollected: Number(r.total_collected),
        totalRemainingToCollect: Number(r.total_remaining_to_collect),
        totalPaidToSenders: 0,
        totalRemainingToSenders: Number(r.total_remaining_to_senders),
        totalAgentCommission: Number(r.total_agent_commission ?? 0),
        totalAgentRemittanceDue,
        totalAgentOwesCompany: totalAgentRemittanceDue,
        totalCompanyOwesAgent: Number(r.total_company_owes_agent ?? 0),
        totalHawalaAmount: Number(r.total_hawala_amount ?? 0),
        totalTransferServiceFees: Number(r.total_transfer_service_fees ?? 0),
        totalConfirmedReceiptsFromAgent,
        agentBalanceDue: Math.max(totalAgentRemittanceDue - totalConfirmedReceiptsFromAgent, 0),
        shipmentCount: Number(r.shipment_count),
      };
      });

      res.json({ success: true, data: { rows, summary, page, pageSize, total } });
    }),
  );

  // ── Delivery Readiness Reports ───────────────────────────────────────────────
  const deliveryReportQuerySchema = z.object({
    dateFrom: z.string().datetime({ offset: true }).optional(),
    dateTo: z.string().datetime({ offset: true }).optional(),
    branchId: z.string().uuid().optional(),
    agentId: z.string().uuid().optional(),
    cashboxId: z.string().uuid().optional(),
    status: z.string().min(1).optional(),
  });

  router.get(
    '/delivery-reports/pending-transfers',
    requirePermissions(['finance.read', 'transfers.read']),
    forbidUserTypes(['agent'], 'التقارير غير متاحة لمستخدم الوكيل.'),
    asyncHandler(async (req, res) => {
      const { pool } = await import('../db/pool.js');
      const scope = parseDataScope(req);
      const q = deliveryReportQuerySchema.parse(req.query);

      if (!scope.companyId) {
        res.status(403).json({ success: false, error: 'Company scope required' });
        return;
      }

      const values: unknown[] = [scope.companyId];
      const conditions: string[] = [`t.company_id = $1::uuid`, `t.status = 'PENDING'`];

      if (q.branchId) {
        values.push(q.branchId);
        conditions.push(`t.branch_id = $${values.length}::uuid`);
      }
      if (q.agentId) {
        values.push(q.agentId);
        conditions.push(`t.agent_id = $${values.length}::uuid`);
      }
      if (q.dateFrom) {
        values.push(q.dateFrom);
        conditions.push(`t.created_at >= $${values.length}::timestamptz`);
      }
      if (q.dateTo) {
        values.push(q.dateTo);
        conditions.push(`t.created_at <= $${values.length}::timestamptz`);
      }

      const result = await pool.query(
        `
        select
          t.id,
          t.created_at,
          t.status,
          s.shipment_no,
          b.name as branch_name,
          a.name as agent_name,
          t.sender_name,
          t.receiver_name,
          t.transfer_service_fee,
          t.transfer_service_fee_currency
        from transfers t
        left join shipments s on s.id = t.shipment_id
        left join branches b on b.id = t.branch_id
        left join agents a on a.id = t.agent_id
        where ${conditions.join(' and ')}
        order by t.created_at desc
        limit 2000
        `,
        values,
      );

      res.json({ success: true, data: { rows: result.rows } });
    }),
  );

  router.get(
    '/delivery-reports/transfer-profit',
    requirePermissions(['finance.read', 'transfers.read']),
    forbidUserTypes(['agent'], 'التقارير غير متاحة لمستخدم الوكيل.'),
    asyncHandler(async (req, res) => {
      const { pool } = await import('../db/pool.js');
      const scope = parseDataScope(req);
      const q = deliveryReportQuerySchema.parse(req.query);

      if (!scope.companyId) {
        res.status(403).json({ success: false, error: 'Company scope required' });
        return;
      }

      const values: unknown[] = [scope.companyId];
      const conditions: string[] = [`t.company_id = $1::uuid`];

      if (q.branchId) {
        values.push(q.branchId);
        conditions.push(`t.branch_id = $${values.length}::uuid`);
      }
      if (q.cashboxId) {
        values.push(q.cashboxId);
        conditions.push(`t.posted_cashbox_id = $${values.length}::uuid`);
      }
      if (q.status) {
        values.push(String(q.status).toUpperCase());
        conditions.push(`t.status = $${values.length}`);
      }
      if (q.dateFrom) {
        values.push(q.dateFrom);
        conditions.push(`coalesce(t.posted_at, t.created_at) >= $${values.length}::timestamptz`);
      }
      if (q.dateTo) {
        values.push(q.dateTo);
        conditions.push(`coalesce(t.posted_at, t.created_at) <= $${values.length}::timestamptz`);
      }

      const rowsResult = await pool.query(
        `
        select
          coalesce(t.posted_at, t.created_at) as report_date,
          t.id,
          s.shipment_no,
          t.transfer_service_fee,
          t.transfer_service_fee_currency,
          t.company_transfer_profit,
          t.company_transfer_profit_currency,
          cb.name as cashbox_name,
          rv.voucher_no as receipt_voucher_no,
          t.status
        from transfers t
        left join shipments s on s.id = t.shipment_id
        left join cashboxes cb on cb.id = t.posted_cashbox_id
        left join receipt_vouchers rv on rv.id = t.receipt_voucher_id
        where ${conditions.join(' and ')}
        order by coalesce(t.posted_at, t.created_at) desc
        limit 2000
        `,
        values,
      );

      const summaryResult = await pool.query(
        `
        select
          coalesce(sum(case when t.status = 'COMPLETED' then coalesce(t.transfer_service_fee, 0) else 0 end), 0) as total_transfer_service_fees,
          count(*) filter (where t.status = 'COMPLETED')::int as completed_count,
          count(*) filter (where t.status = 'CANCELLED')::int as cancelled_count,
          count(*) filter (where t.status = 'PENDING')::int as pending_count
        from transfers t
        where ${conditions.join(' and ')}
        `,
        values,
      );

      res.json({
        success: true,
        data: {
          rows: rowsResult.rows,
          summary: {
            totalTransferServiceFees: Number(summaryResult.rows[0]?.total_transfer_service_fees ?? 0),
            completedCount: Number(summaryResult.rows[0]?.completed_count ?? 0),
            cancelledCount: Number(summaryResult.rows[0]?.cancelled_count ?? 0),
            pendingCount: Number(summaryResult.rows[0]?.pending_count ?? 0),
          },
        },
      });
    }),
  );

  router.get(
    '/delivery-reports/legacy-additional-charges',
    requirePermissions(['finance.read', 'shipments.read']),
    forbidUserTypes(['agent'], 'التقارير غير متاحة لمستخدم الوكيل.'),
    asyncHandler(async (req, res) => {
      const { pool } = await import('../db/pool.js');
      const scope = parseDataScope(req);
      const q = deliveryReportQuerySchema.parse(req.query);

      if (!scope.companyId) {
        res.status(403).json({ success: false, error: 'Company scope required' });
        return;
      }

      const values: unknown[] = [scope.companyId];
      const conditions: string[] = [
        `s.company_id = $1::uuid`,
        `s.deleted_at is null`,
        `coalesce(s.additional_charges, 0) > 0`,
        `coalesce(s.transfer_service_fee, 0) = 0`,
      ];

      if (q.branchId) {
        values.push(q.branchId);
        conditions.push(`s.branch_id = $${values.length}::uuid`);
      }
      if (q.dateFrom) {
        values.push(q.dateFrom);
        conditions.push(`s.created_at >= $${values.length}::timestamptz`);
      }
      if (q.dateTo) {
        values.push(q.dateTo);
        conditions.push(`s.created_at <= $${values.length}::timestamptz`);
      }
      if (q.status) {
        values.push(String(q.status).toUpperCase());
        conditions.push(`s.status = $${values.length}`);
      }

      const result = await pool.query(
        `
        select
          s.id as shipment_id,
          s.shipment_no,
          s.created_at,
          sr_s.full_name as sender_name,
          sr_r.full_name as receiver_name,
          s.additional_charges,
          s.transfer_service_fee,
          s.status
        from shipments s
        left join senders_receivers sr_s on sr_s.id = s.sender_id
        left join senders_receivers sr_r on sr_r.id = s.receiver_id
        where ${conditions.join(' and ')}
        order by s.created_at desc
        limit 2000
        `,
        values,
      );

      res.json({ success: true, data: { rows: result.rows } });
    }),
  );

  router.get(
    '/delivery-reports/agent-commission-review',
    requirePermissions(['finance.read', 'shipments.read']),
    forbidUserTypes(['agent'], 'التقارير غير متاحة لمستخدم الوكيل.'),
    asyncHandler(async (req, res) => {
      const { pool } = await import('../db/pool.js');
      const scope = parseDataScope(req);
      const q = deliveryReportQuerySchema.parse(req.query);

      if (!scope.companyId) {
        res.status(403).json({ success: false, error: 'Company scope required' });
        return;
      }

      const values: unknown[] = [scope.companyId];
      const conditions: string[] = [
        `s.company_id = $1::uuid`,
        `s.deleted_at is null`,
        `s.agent_id is not null`,
      ];

      if (q.branchId) {
        values.push(q.branchId);
        conditions.push(`s.branch_id = $${values.length}::uuid`);
      }
      if (q.agentId) {
        values.push(q.agentId);
        conditions.push(`s.agent_id = $${values.length}::uuid`);
      }
      if (q.dateFrom) {
        values.push(q.dateFrom);
        conditions.push(`s.created_at >= $${values.length}::timestamptz`);
      }
      if (q.dateTo) {
        values.push(q.dateTo);
        conditions.push(`s.created_at <= $${values.length}::timestamptz`);
      }
      if (q.status) {
        values.push(String(q.status).toUpperCase());
        conditions.push(`s.status = $${values.length}`);
      }

      const result = await pool.query(
        `
        select
          s.id as shipment_id,
          s.shipment_no,
          s.created_at,
          a.name as agent_name,
          coalesce(s.freight_charge, 0) as freight_charge,
          coalesce(s.agent_commission_percentage_snapshot, 0) as commission_percentage_snapshot,
          coalesce(s.agent_commission_amount_snapshot, 0) as commission_amount_snapshot,
          coalesce(s.agent_commission_base_type, 'FREIGHT_CHARGE') as base_type,
          s.status,
          round(
            (greatest(coalesce(s.freight_charge, 0) + coalesce(s.transfer_fee, 0), 0)
              * coalesce(s.agent_commission_percentage_snapshot, 0)) / 100.0,
            4
          ) as expected_commission_amount
        from shipments s
        join agents a on a.id = s.agent_id
        where ${conditions.join(' and ')}
        order by s.created_at desc
        limit 2000
        `,
        values,
      );

      res.json({ success: true, data: { rows: result.rows } });
    }),
  );

  // Diagnostic: count legacy sender_receiver shipment_charge movements and identify affected shipments
  router.get(
    '/diagnostics/sender-receiver-movements',
    requirePermissions(['finance.read']),
    forbidUserTypes(['agent'], 'التشخيص غير متاح لمستخدم الوكيل.'),
    asyncHandler(async (req, res) => {
      const { pool } = await import('../db/pool.js');
      const scope = parseDataScope(req);

      // Count legacy movements
      const countRes = await pool.query(
        `select count(*) as total,
                count(case when s.agent_id is not null then 1 end) as with_agent,
                count(case when s.agent_id is null then 1 end) as without_agent
         from party_financial_movements pfm
         join shipments s on s.id = pfm.shipment_id
         where pfm.party_type = 'sender_receiver'
           and pfm.movement_type = 'shipment_charge'
           and pfm.is_reversal = false
           ${scope?.companyId ? `and s.company_id = '${scope.companyId}'` : ''}`,
      );

      // List affected shipments
      const listRes = await pool.query(
        `select s.shipment_no, s.id as shipment_id, pfm.id as movement_id,
                pfm.original_amount, pfm.original_currency,
                pfm.party_id as posted_to_receiver_id,
                s.agent_id,
                s.financial_status,
                coalesce(pfm.posted_at, pfm.created_at) as created_at
         from party_financial_movements pfm
         join shipments s on s.id = pfm.shipment_id
         where pfm.party_type = 'sender_receiver'
           and pfm.movement_type = 'shipment_charge'
           and pfm.is_reversal = false
           ${scope?.companyId ? `and s.company_id = '${scope.companyId}'` : ''}
         order by coalesce(pfm.posted_at, pfm.created_at) desc
         limit 100`,
      );

      res.json({
        success: true,
        data: {
          summary: {
            totalLegacyMovements: Number(countRes.rows[0]?.total ?? 0),
            withAgent: Number(countRes.rows[0]?.with_agent ?? 0),
            withoutAgent: Number(countRes.rows[0]?.without_agent ?? 0),
            message: 'الحركات المُرحَّلة خطأً على مرسل/مستلم بدلاً من الوكيل أو المسؤول المالي الصحيح.',
          },
          affectedShipments: listRes.rows,
        },
      });
    }),
  );

  router.get(
    '/diagnostics/shipment-breakdown',
    requirePermissions(['finance.read']),
    forbidUserTypes(['agent'], 'التشخيص المالي غير متاح لمستخدم الوكيل.'),
    asyncHandler(async (req, res) => {
      const { pool } = await import('../db/pool.js');
      const scope = parseDataScope(req);
      const values: unknown[] = [];
      const conditions = [
        `pfm.movement_type = 'shipment_charge'`,
        `pfm.is_reversal = false`,
        `coalesce(s.transfer_fee, 0) <> 0`,
      ];
      if (scope.companyId) {
        values.push(scope.companyId);
        conditions.push(`s.company_id = $${values.length}::uuid`);
      }
      if (typeof req.query.shipmentNo === 'string' && req.query.shipmentNo.trim()) {
        values.push(`%${req.query.shipmentNo.trim()}%`);
        conditions.push(`s.shipment_no ilike $${values.length}`);
      }
      const result = await pool.query(
        `
        select
          s.id as shipment_id,
          s.shipment_no,
          s.agent_id,
          pfm.id as movement_id,
          pfm.notes,
          pfm.original_amount,
          pfm.original_currency,
          s.original_amount as shipment_original_amount,
          s.freight_charge,
          s.transfer_fee,
          s.additional_charges,
          s.prepaid_amount,
          s.discount_amount,
          s.paid_amount,
          s.remaining_amount,
          s.financial_status,
          s.payment_status
        from party_financial_movements pfm
        join shipments s on s.id = pfm.shipment_id
        where ${conditions.join(' and ')}
        order by coalesce(pfm.posted_at, pfm.created_at) desc
        limit 200
        `,
        values,
      );
      const affectedShipments = result.rows.map((row) => {
        const breakdown = calculateShipmentFinancialBreakdown(row);
        return {
          ...row,
          breakdown,
          reason: 'حركة شحن قديمة واحدة تحتوي تحصيل المرسل أو إضافات ضمن مبلغ واحد.',
        };
      });
      res.json({ success: true, data: { affectedCount: affectedShipments.length, affectedShipments } });
    }),
  );

  router.post(
    '/repair/shipment-breakdown/:shipmentId',
    requirePermissions(['finance.write']),
    forbidUserTypes(['agent'], 'إصلاح القيود المالية غير متاح لمستخدم الوكيل.'),
    asyncHandler(async (req, res) => {
      const { pool } = await import('../db/pool.js');
      const scope = parseDataScope(req);
      const dryRun = req.body?.dryRun !== false;
      const shipmentId = String(req.params.shipmentId);
      const client = await pool.connect();
      try {
        await client.query('begin');
        const shipmentResult = await client.query(
          `
          select s.*, sr.full_name as sender_name
          from shipments s
          left join senders_receivers sr on sr.id = s.sender_id
          where s.id = $1::uuid
            ${scope.companyId ? 'and s.company_id = $2::uuid' : ''}
          for update
          `,
          scope.companyId ? [shipmentId, scope.companyId] : [shipmentId],
        );
        const shipment = shipmentResult.rows[0];
        if (!shipment) {
          await client.query('rollback');
          res.status(404).json({ success: false, error: { message: 'الشحنة غير موجودة أو خارج النطاق.' } });
          return;
        }

        const legacyResult = await client.query(
          `
          select *
          from party_financial_movements
          where shipment_id = $1::uuid
            and movement_type = 'shipment_charge'
            and is_reversal = false
          order by created_at asc
          `,
          [shipmentId],
        );
        const breakdown = calculateShipmentFinancialBreakdown(shipment);
        const existingComponents = await client.query(
          `
          select movement_type, original_amount, notes
          from party_financial_movements
          where shipment_id = $1::uuid
            and movement_type in ('shipment_shipping_fee', 'sender_collection_trust', 'loading_dues', 'general_collection')
            and is_reversal = false
          order by created_at asc
          `,
          [shipmentId],
        );

        const preview = {
          shipmentId,
          shipmentNo: shipment.shipment_no,
          legacyMovements: legacyResult.rows,
          existingComponents: existingComponents.rows,
          breakdown,
          willRepair: (legacyResult.rowCount ?? 0) > 0 && (existingComponents.rowCount ?? 0) === 0,
        };

        if (dryRun || !preview.willRepair) {
          await client.query('rollback');
          res.json({ success: true, data: { dryRun: true, ...preview } });
          return;
        }

        await client.query(
          `
          update party_financial_movements
          set is_reversal = true,
              reverse_reason = 'تم استبدال حركة الشحن الإجمالية بقيود تفصيلية حسب مكونات الشحنة'
          where shipment_id = $1::uuid
            and movement_type = 'shipment_charge'
            and is_reversal = false
          `,
          [shipmentId],
        );

        const legacy = legacyResult.rows[0];
        const partyType = legacy?.party_type ?? (shipment.agent_id ? 'agent' : null);
        const partyId = legacy?.party_id ?? shipment.agent_id;
        if (partyType && partyId) {
          const components = [
            ['shipment_shipping_fee', breakdown.companyShippingFee, `أجور شحن للشركة — الشحنة رقم ${shipment.shipment_no}`],
            ['sender_collection_trust', breakdown.senderCollectionAmount, `تحصيل لصالح المرسل${shipment.sender_name ? ` ${shipment.sender_name}` : ''} — الشحنة رقم ${shipment.shipment_no}`],
            ['loading_dues', breakdown.loadingDuesAmount, `مستحقات تحميل / إضافي — الشحنة رقم ${shipment.shipment_no}`],
            ['general_collection', breakdown.generalCollectionAmount, `تحصيل إضافي — الشحنة رقم ${shipment.shipment_no}`],
          ].filter(([, amount]) => Number(amount) > 0);

          for (const [movementType, amount, notes] of components) {
            const n = Number(amount);
            await client.query(
              `
              insert into party_financial_movements(
                party_type, party_id, movement_type, voucher_type, voucher_id, shipment_id,
                branch_id, agent_id, direction, notes, original_amount, original_currency,
                exchange_rate_to_usd, base_amount_usd, created_by_user_id,
                reference_type, reference_id, reference_no, debit_amount, credit_amount,
                currency_code, exchange_rate, posted_at, metadata
              ) values (
                $1, $2, $3, null, null, $4,
                $5, $6, 'debit', $7, $8, $9,
                $10, $11, $12,
                'SHIPMENT', $4, $13, $8, 0,
                $9, $10, now(), $14::jsonb
              )
              on conflict do nothing
              `,
              [
                partyType,
                partyId,
                movementType,
                shipmentId,
                shipment.branch_id,
                shipment.agent_id,
                notes,
                n,
                shipment.original_currency,
                Number(shipment.exchange_rate_to_usd ?? 1),
                Number((n * Number(shipment.exchange_rate_to_usd ?? 1)).toFixed(2)),
                (req as any).requestUserContext?.userId ?? null,
                shipment.shipment_no,
                JSON.stringify({ repair: 'shipment_breakdown', breakdown, component: movementType }),
              ],
            );
          }
        }

        await client.query('commit');
        auditService.logAsync({
          req,
          action: 'SHIPMENT_BREAKDOWN_REPAIR',
          entityType: 'shipment',
          entityId: shipmentId,
          metadata: { shipmentNo: shipment.shipment_no, breakdown },
        });
        res.json({ success: true, data: { dryRun: false, ...preview } });
      } catch (error) {
        await client.query('rollback');
        throw error;
      } finally {
        client.release();
      }
    }),
  );

  return router;
}
