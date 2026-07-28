import { Router } from 'express';
import { z } from 'zod';
import { asyncHandler } from '../utils/http.js';
import { requirePermissions } from '../middleware/authorization.js';
import { requireIdempotencyKey } from '../middleware/idempotency.js';
import { env } from '../config/env.js';
import { pool } from '../db/pool.js';
import { queueCancelTransferAction, queueCompleteTransferAction } from '../sync/localDeferredActions.js';
import { runLocalSyncCycle } from '../sync/localSyncWorker.js';
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
  origin_agent_id: z.string().uuid().optional(),
  destination_agent_id: z.string().uuid().optional(),
  destination_city: z.string().optional(),
  collection_cashbox_id: z.string().uuid().optional(),
});

const completeTransferSchema = z.object({
  cashboxId: z.string().uuid(),
  voucherNo: z.string().min(1).optional(),
});

const cancelTransferSchema = z.object({
  reason: z.string().min(1).optional(),
});

const transferReportQuerySchema = z.object({
  dateFrom: z.string().datetime({ offset: true }).optional(),
  dateTo: z.string().datetime({ offset: true }).optional(),
  branchId: z.string().uuid().optional(),
  status: z.enum(['PENDING', 'COMPLETED', 'CANCELLED']).optional(),
  originAgentId: z.string().uuid().optional(),
  destinationAgentId: z.string().uuid().optional(),
  destinationCity: z.string().min(1).optional(),
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

  router.get('/reports/statement', requirePermissions(['transfers.read']), asyncHandler(async (req, res) => {
    const scope = parseDataScope(req);
    const q = transferReportQuerySchema.parse(req.query);

    if (!scope.companyId) {
      res.status(403).json({ success: false, error: 'Company scope required' });
      return;
    }

    const report = await transfersService.getTransferReport({
      company_id: String(scope.companyId),
      branch_id: q.branchId ?? scope.branchId,
      agent_id: scope.agentId,
      dateFrom: q.dateFrom,
      dateTo: q.dateTo,
      status: q.status,
      originAgentId: q.originAgentId,
      destinationAgentId: q.destinationAgentId,
      destinationCity: q.destinationCity,
    });

    res.json({ success: true, data: report });
  }));

  router.post('/', requirePermissions(['transfers.write']), asyncHandler(async (req, res) => {
    const scope = parseDataScope(req);
    const data = createTransferSchema.parse(req.body);
    
    if (!scope.companyId) {
      res.status(403).json({ success: false, error: 'Company scope required' });
      return;
    }

    const payload = {
      ...data,
      company_id: String(scope.companyId),
      branch_id: scope.branchId,
      agent_id: data.destination_agent_id ?? scope.agentId,
      status: data.status || 'PENDING'
    };
    if (!data.shipment_id && (!data.origin_agent_id || !data.destination_agent_id || !data.collection_cashbox_id)) {
      throw new HttpError(400, 'الحوالة المستقلة تتطلب وكيل المصدر ووكيل الوجهة وصندوق قبض المصدر.');
    }
    const transfer = data.collection_cashbox_id
      ? await transfersService.createTransferAndCollect({
          payload,
          collectionCashboxId: data.collection_cashbox_id,
          userId: scope.userId,
          baseCurrency: (req as any).requestUserContext?.baseCurrency,
        })
      : await transfersService.createTransfer(payload);

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
      const baseCurrency = (req as any).requestUserContext?.baseCurrency as string | undefined;
      if (env.SYNC_NODE_ROLE === 'local') {
        if (!scope.branchId) throw new HttpError(400, 'يجب اختيار الفرع قبل تسليم الحوالة.');
        const queued = await queueCompleteTransferAction({
          companyId: String(scope.companyId),
          branchId: String(scope.branchId),
          userId: scope.userId,
          transferId: String(req.params.id),
          cashboxId: data.cashboxId,
          voucherNo: data.voucherNo,
        });
        await runLocalSyncCycle();
        const operation = await pool.query<{ sync_status: string }>(
          `select sync_status from sync_outbox where operation_id=$1::uuid`,
          [queued.operationId],
        );
        const localTransfer = await pool.query(
          `select * from transfers where id=$1::uuid and company_id=$2::uuid`,
          [String(req.params.id), String(scope.companyId)],
        );
        const pendingCentral = operation.rows[0]?.sync_status !== 'ACKNOWLEDGED';
        res.status(pendingCentral ? 202 : 200).json({
          success: true,
          data: { ...(localTransfer.rows[0] ?? {}), pendingCentral, operationId: queued.operationId },
        });
        return;
      }
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
      if (env.SYNC_NODE_ROLE === 'local') {
        if (!scope.branchId) throw new HttpError(400, 'يجب اختيار الفرع قبل إلغاء الحوالة.');
        const queued = await queueCancelTransferAction({
          companyId: String(scope.companyId),
          branchId: String(scope.branchId),
          userId: scope.userId,
          transferId: String(req.params.id),
          reason: data.reason,
        });
        await runLocalSyncCycle();
        const operation = await pool.query<{ sync_status: string }>(
          `select sync_status from sync_outbox where operation_id=$1::uuid`,
          [queued.operationId],
        );
        const localTransfer = await pool.query(
          `select * from transfers where id=$1::uuid and company_id=$2::uuid`,
          [String(req.params.id), String(scope.companyId)],
        );
        const pendingCentral = operation.rows[0]?.sync_status !== 'ACKNOWLEDGED';
        res.status(pendingCentral ? 202 : 200).json({
          success: true,
          data: { ...(localTransfer.rows[0] ?? {}), pendingCentral, operationId: queued.operationId },
        });
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
