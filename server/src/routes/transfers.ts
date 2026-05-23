import { Router } from 'express';
import { z } from 'zod';
import { asyncHandler } from '../utils/http.js';
import { requirePermissions } from '../middleware/authorization.js';
import { requireIdempotencyKey } from '../middleware/idempotency.js';
import { parseDataScope } from '../utils/scope.js';
import { TransfersService } from '../services/transfersService.js';
import { HttpError } from '../utils/errors.js';
import { AuditService } from '../services/auditService.js';

const createTransferSchema = z.object({
  sender_name: z.string().min(1),
  receiver_name: z.string().min(1),
  amount: z.coerce.number().positive(),
  currency: z.string().min(1),
  main_amount: z.coerce.number().positive(),
  // Legacy (kept accepted for backward compatibility)
  commission: z.coerce.number().min(0).default(0),
  commission_currency: z.string().default('USD'),
  commission_main: z.coerce.number().min(0).default(0),
  // Explicit fields
  agent_commission: z.coerce.number().min(0).optional(),
  agent_commission_currency: z.string().optional(),
  agent_commission_main: z.coerce.number().min(0).optional(),
  transfer_service_fee: z.coerce.number().min(0).default(0),
  transfer_service_fee_currency: z.string().default('USD'),
  transfer_service_fee_main: z.coerce.number().min(0).default(0),
  company_transfer_profit: z.coerce.number().min(0).optional(),
  company_transfer_profit_currency: z.string().optional(),
  company_transfer_profit_main: z.coerce.number().min(0).optional(),
  status: z.string().optional(),
  notes: z.string().optional(),
  shipment_id: z.string().uuid().optional(),
});

const completeTransferSchema = z.object({
  cashboxId: z.string().uuid(),
  voucherNo: z.string().min(1).optional(),
});

const cancelTransferSchema = z.object({
  reason: z.string().min(1).optional(),
});

export function createTransfersRouter(transfersService: TransfersService) {
  const router = Router();
  const auditService = new AuditService();

  router.get('/', requirePermissions(['transfers.read']), asyncHandler(async (req, res) => {
    const scope = parseDataScope(req);
    const { status, search } = req.query;
    
    if (!scope.companyId) {
      res.status(403).json({ success: false, error: 'Company scope required' });
      return;
    }

    const transfers = await transfersService.listTransfers({
      company_id: String(scope.companyId),
      branch_id: scope.branchId,
      agent_id: scope.agentId,
      status: typeof status === 'string' ? status : undefined,
      search: typeof search === 'string' ? search : undefined,
    });
    
    res.json({ success: true, data: transfers });
  }));

  router.post('/', requirePermissions(['transfers.write']), asyncHandler(async (req, res) => {
    const scope = parseDataScope(req);
    const data = createTransferSchema.parse(req.body);
    
    if (!scope.companyId) {
      res.status(403).json({ success: false, error: 'Company scope required' });
      return;
    }

    const transfer = await transfersService.createTransfer({
      ...data,
      company_id: String(scope.companyId),
      branch_id: scope.branchId,
      agent_id: scope.agentId,
      status: data.status || 'PENDING'
    });

    auditService.logAsync({
      req,
      action: 'TRANSFER_CREATED',
      entityType: 'transfer',
      entityId: transfer.id,
      metadata: {
        status: transfer.status,
        branchId: transfer.branch_id,
        agentId: transfer.agent_id,
        amount: transfer.amount,
        currency: transfer.currency,
        transferServiceFee: transfer.transfer_service_fee,
        transferServiceFeeCurrency: transfer.transfer_service_fee_currency,
      },
    });
    
    res.json({ success: true, data: transfer });
  }));

  router.put('/:id/status', requirePermissions(['transfers.write']), asyncHandler(async (req, res) => {
    const scope = parseDataScope(req);
    const { status } = z.object({ status: z.string().min(1) }).parse(req.body);
    
    if (!scope.companyId) {
      res.status(403).json({ success: false, error: 'Company scope required' });
      return;
    }

    const normalized = String(status).toUpperCase();
    if (normalized === 'COMPLETED' || normalized === 'CANCELLED') {
      throw new HttpError(400, 'استخدم زر الترحيل/الإلغاء (V2) بدلاً من تغيير الحالة مباشرة.');
    }
    const transfer = await transfersService.updateTransferStatus(String(req.params.id), String(scope.companyId), status);
    
    res.json({ success: true, data: transfer });
  }));

  router.post(
    '/:id/complete',
    requirePermissions(['transfers.write']),
    requireIdempotencyKey('transfers.complete'),
    asyncHandler(async (req, res) => {
      const scope = parseDataScope(req);
      const data = completeTransferSchema.parse(req.body);
      if (!scope.companyId) {
        res.status(403).json({ success: false, error: 'Company scope required' });
        return;
      }
      const baseCurrency = (req as any).requestContext?.baseCurrency as string | undefined;
      const transfer = await transfersService.completeTransfer({
        id: String(req.params.id),
        companyId: String(scope.companyId),
        cashboxId: data.cashboxId,
        voucherNo: data.voucherNo,
        userId: scope.userId,
        baseCurrency,
      });
      auditService.logAsync({
        req,
        action: 'TRANSFER_COMPLETED',
        entityType: 'transfer',
        entityId: transfer.id,
        metadata: {
          status: transfer.status,
          postedCashboxId: transfer.posted_cashbox_id,
          receiptVoucherId: transfer.receipt_voucher_id,
          transferServiceFee: transfer.transfer_service_fee,
          transferServiceFeeCurrency: transfer.transfer_service_fee_currency,
        },
      });
      res.json({ success: true, data: transfer });
    }),
  );

  router.post(
    '/:id/cancel',
    requirePermissions(['transfers.write']),
    requireIdempotencyKey('transfers.cancel'),
    asyncHandler(async (req, res) => {
      const scope = parseDataScope(req);
      const data = cancelTransferSchema.parse(req.body);
      if (!scope.companyId) {
        res.status(403).json({ success: false, error: 'Company scope required' });
        return;
      }
      const transfer = await transfersService.cancelTransfer({
        id: String(req.params.id),
        companyId: String(scope.companyId),
        userId: scope.userId,
        reason: data.reason,
      });
      auditService.logAsync({
        req,
        action: 'TRANSFER_CANCELLED',
        entityType: 'transfer',
        entityId: transfer.id,
        metadata: {
          status: transfer.status,
          reason: data.reason,
          receiptVoucherId: transfer.receipt_voucher_id,
          postedCashboxId: transfer.posted_cashbox_id,
          transferServiceFee: transfer.transfer_service_fee,
          transferServiceFeeCurrency: transfer.transfer_service_fee_currency,
        },
      });
      res.json({ success: true, data: transfer });
    }),
  );

  router.delete('/:id', requirePermissions(['transfers.delete']), asyncHandler(async (req, res) => {
    const scope = parseDataScope(req);
    
    if (!scope.companyId) {
      res.status(403).json({ success: false, error: 'Company scope required' });
      return;
    }

    const transfer = await transfersService.deleteTransfer({
      id: String(req.params.id),
      companyId: String(scope.companyId),
      userId: scope.userId,
      reason: 'حذف إداري (تحويل إلى إلغاء)',
    });

    auditService.logAsync({
      req,
      action: 'TRANSFER_DELETE_CONVERTED_TO_CANCEL',
      entityType: 'transfer',
      entityId: transfer.id,
      metadata: {
        status: transfer.status,
        reason: 'حذف إداري (تحويل إلى إلغاء)',
        cancellationReason: transfer.cancellation_reason,
      },
    });
    
    res.json({ success: true, data: transfer });
  }));

  return router;
}
