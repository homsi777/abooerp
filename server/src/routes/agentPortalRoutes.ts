import { Router, type Request } from 'express';
import { z } from 'zod';
import type { ShipmentService } from '../services/shipmentService.js';
import type { FinanceService } from '../services/financeService.js';
import type { TransfersService } from '../services/transfersService.js';
import { AgentRepository } from '../repositories/agentRepository.js';
import { requirePermissions } from '../middleware/authorization.js';
import { asyncHandler } from '../utils/http.js';
import { parseDataScope } from '../utils/scope.js';
import { normalizeShipmentStatus, type CanonicalShipmentStatus } from '../domain/shipmentStatus.js';
import { pool } from '../db/pool.js';
import { HttpError } from '../utils/errors.js';
import { AuditService } from '../services/auditService.js';
import { calculateShipmentFinancialBreakdown } from '../utils/shipmentFinancialBreakdown.js';

const actionSchema = z.object({
  note: z.string().max(400).optional(),
  metadata: z.record(z.string(), z.unknown()).optional(),
});

const accountStatementQuerySchema = z.object({
  fromDate: z.string().optional(),
  toDate: z.string().optional(),
  sourceType: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(500).default(100),
  offset: z.coerce.number().int().min(0).default(0),
});

const transfersQuerySchema = z.object({
  status: z.string().optional(),
  search: z.string().optional(),
  type: z.enum(['independent', 'shipment_linked']).optional(),
  limit: z.coerce.number().int().min(1).max(500).default(100),
  offset: z.coerce.number().int().min(0).default(0),
});

const createTransferSchema = z.object({
  senderName: z.string().min(1).max(255),
  receiverName: z.string().min(1).max(255),
  destinationCity: z.string().min(1).max(255),
  amount: z.coerce.number().positive(),
  currency: z.string().min(1).max(10).default('USD'),
  transferServiceFee: z.coerce.number().min(0).default(0),
  notes: z.string().max(1000).optional(),
});

const actionMap: Record<string, CanonicalShipmentStatus> = {
  'agent-received': 'AGENT_RECEIVED',
  'mark-in-transit': 'IN_TRANSIT',
  arrived: 'ARRIVED_AT_DESTINATION',
  'out-for-delivery': 'OUT_FOR_DELIVERY',
  deliver: 'DELIVERED',
  'request-return': 'RETURN_REQUESTED',
  'mark-returned': 'RETURNED',
};

function startOfTodayUtc(): Date {
  const d = new Date();
  d.setUTCHours(0, 0, 0, 0);
  return d;
}

function requireAgentPortalContext(req: Request) {
  const ctx = (req as any).requestUserContext as any;
  if (String(ctx?.userType ?? '').toLowerCase() !== 'agent') {
    throw new HttpError(403, 'AGENT_PORTAL_ONLY');
  }
  const companyId = ctx?.companyId as string | undefined;
  const agentId = ctx?.scope?.agentId as string | undefined;
  if (!agentId) {
    throw new HttpError(403, 'AGENT_NOT_LINKED');
  }
  if (!companyId) {
    throw new HttpError(403, 'Company scope required');
  }
  return {
    companyId,
    agentId,
    currency: String(ctx?.baseCurrency ?? 'USD').toUpperCase(),
  };
}

function parseOptionalDate(value: string | undefined, field: string): number | null {
  if (!value) return null;
  const timestamp = Date.parse(value);
  if (!Number.isFinite(timestamp)) {
    throw new HttpError(400, `${field} must be a valid date.`);
  }
  return timestamp;
}

function sourceTypeForMobile(sourceType: string): string {
  const labels: Record<string, string> = {
    shipment_commission: 'SHIPMENT_COMMISSION',
    transfer: 'TRANSFER_COMMISSION',
    receipt_voucher: 'RECEIPT_VOUCHER',
    payment_voucher: 'PAYMENT_VOUCHER',
    cashbox_transaction: 'CASHBOX_TRANSACTION',
    shipment_shipping_fee: 'SHIPMENT_SHIPPING_FEE',
    sender_collection_trust: 'SENDER_COLLECTION_TRUST',
    loading_dues: 'LOADING_DUES',
    general_collection: 'GENERAL_COLLECTION',
    shipment_hawala_trust: 'SHIPMENT_HAWALA_TRUST',
    shipment_transfer_service_fee: 'SHIPMENT_TRANSFER_SERVICE_FEE',
    transfer_principal_collected: 'TRANSFER_PRINCIPAL_COLLECTED',
    transfer_service_fee_collected: 'TRANSFER_SERVICE_FEE_COLLECTED',
    transfer_principal_paid: 'TRANSFER_PRINCIPAL_PAID',
    transfer_agent_commission: 'TRANSFER_COMMISSION',
  };
  return labels[sourceType] ?? sourceType.toUpperCase();
}

function referenceTypeForMobile(sourceType: string): string {
  const labels: Record<string, string> = {
    shipment_commission: 'SHIPMENT',
    transfer: 'TRANSFER',
    receipt_voucher: 'RECEIPT_VOUCHER',
    payment_voucher: 'PAYMENT_VOUCHER',
    cashbox_transaction: 'CASHBOX_TRANSACTION',
    shipment_shipping_fee: 'SHIPMENT',
    sender_collection_trust: 'SHIPMENT',
    loading_dues: 'SHIPMENT',
    general_collection: 'SHIPMENT',
    shipment_hawala_trust: 'SHIPMENT',
    shipment_transfer_service_fee: 'SHIPMENT',
    transfer_principal_collected: 'TRANSFER',
    transfer_service_fee_collected: 'TRANSFER',
    transfer_principal_paid: 'TRANSFER',
    transfer_agent_commission: 'TRANSFER',
  };
  return labels[sourceType] ?? sourceType.toUpperCase();
}

function transferForMobile(row: any, currentAgentId?: string) {
  const destinationAgentId = String(row.destination_agent_id ?? row.agent_id ?? '');
  const originAgentId = String(row.origin_agent_id ?? '');
  const status = String(row.status ?? 'PENDING').toUpperCase();
  const type = row.shipment_id ? 'SHIPMENT_LINKED' : 'INDEPENDENT';
  const currentAgentRole = currentAgentId
    ? destinationAgentId === currentAgentId
      ? 'DESTINATION_AGENT'
      : originAgentId === currentAgentId
        ? 'ORIGIN_AGENT'
        : 'RELATED_AGENT'
    : null;
  const canCurrentAgentComplete = Boolean(currentAgentId && destinationAgentId === currentAgentId && status === 'PENDING');
  return {
    id: String(row.id),
    transferNo: String(row.linked_shipment_no ?? row.id),
    createdAt: row.created_at ?? row.transfer_date ?? null,
    completedAt: row.posted_at ?? null,
    senderName: row.sender_name ?? null,
    senderPhone: null,
    receiverName: row.receiver_name ?? null,
    receiverPhone: null,
    type,
    amount: Number(row.amount ?? 0),
    principalAmount: Number(row.amount ?? 0),
    currency: String(row.currency ?? 'USD'),
    serviceFee: Number(row.transfer_service_fee ?? 0),
    transferFee: Number(row.transfer_service_fee ?? 0),
    serviceFeeCurrency: String(row.transfer_service_fee_currency ?? row.currency ?? 'USD'),
    agentCommission: Number(row.agent_commission ?? 0),
    agentCommissionCurrency: String(row.agent_commission_currency ?? row.currency ?? 'USD'),
    status,
    linkedShipment: row.shipment_id
      ? { id: String(row.shipment_id), shipmentNo: row.linked_shipment_no ?? null }
      : null,
    linkedShipmentNo: row.linked_shipment_no ?? null,
    notes: row.notes ?? null,
    destinationCity: row.destination_city ?? null,
    sourceCity: row.linked_source_city ?? row.origin_agent_city ?? null,
    originAgentName: row.origin_agent_name ?? null,
    destinationAgentName: row.destination_agent_name ?? null,
    collectedAt: row.collected_at ?? null,
    paidOutAt: row.paid_out_at ?? null,
    cancelledAt: row.cancelled_at ?? null,
    currentAgentRole,
    canCurrentAgentComplete,
    canDeliver: canCurrentAgentComplete,
    shouldCurrentAgentPayPrincipal: Boolean(currentAgentId && destinationAgentId === currentAgentId),
    isTransferFeeIncomeRecognized: type === 'SHIPMENT_LINKED'
      ? String(row.linked_shipment_financial_status ?? '').toUpperCase() !== 'UNPOSTED'
      : Boolean(row.collected_at),
  };
}

function shipmentDetailsForMobile(shipment: any, linkedTransfer: any | null, currentAgentId: string) {
  const breakdown = calculateShipmentFinancialBreakdown(shipment);
  const shippingAmountToCollectOnDelivery = Math.max(
    breakdown.totalDueOnDelivery - breakdown.hawalaAmount - breakdown.transferServiceFeeAmount,
    0,
  );
  return {
    shipmentInfo: {
      id: String(shipment.id),
      shipmentNo: shipment.shipment_no ?? null,
      createdAt: shipment.created_at ?? null,
      status: String(shipment.status ?? 'REGISTERED'),
      sourceCity: shipment.origin_city ?? null,
      destinationCity: shipment.destination_city ?? null,
      senderName: shipment.sender_name ?? null,
      senderPhone: shipment.sender_phone ?? null,
      receiverName: shipment.receiver_name ?? null,
      receiverPhone: shipment.receiver_phone ?? null,
      piecesCount: Number(shipment.pieces_count ?? 0),
      loadedPiecesCount: Number(shipment.loaded_pieces_count ?? 0),
      weightKg: Number(shipment.weight_kg ?? 0),
      description: shipment.description ?? null,
    },
    shipmentFinancials: {
      currency: String(shipment.original_currency ?? 'USD'),
      shippingFee: breakdown.companyShippingFee,
      senderCollectionAmount: breakdown.senderCollectionAmount,
      additionalCharges: breakdown.loadingDuesAmount,
      generalCollectionAmount: breakdown.generalCollectionAmount,
      prepaidAmount: breakdown.prepaidAmount,
      discountAmount: breakdown.discountAmount,
      shippingAmountToCollectOnDelivery,
      linkedTransferPrincipal: breakdown.hawalaAmount,
      linkedTransferServiceFee: breakdown.transferServiceFeeAmount,
      totalAmountToCollectOnDelivery: breakdown.totalDueOnDelivery,
      agentCommissionPercentage: Number(shipment.agent_commission_percentage_snapshot ?? 0),
      agentCommissionAmount: Number(shipment.agent_commission_amount_snapshot ?? 0),
    },
    linkedTransfer: linkedTransfer ? transferForMobile(linkedTransfer, currentAgentId) : null,
  };
}

async function workspaceSummaryPayload(
  service: ShipmentService,
  financeService: FinanceService,
  req: Request,
) {
  const scope = parseDataScope(req);
  const shipments = await service.list(scope);
  const t0 = startOfTodayUtc().toISOString();
  const counts: Record<string, number> = {};
  for (const row of shipments) {
    const k = normalizeShipmentStatus(String(row.status));
    counts[k] = (counts[k] ?? 0) + 1;
  }
  const todayShipments = shipments.filter((s) => String(s.created_at) >= t0);
  const upcoming = shipments.filter((s) => {
    const st = normalizeShipmentStatus(String(s.status));
    return ['REGISTERED', 'CONFIRMED', 'READY_FOR_PICKUP', 'HANDED_TO_DRIVER', 'HANDED_TO_AGENT'].includes(st);
  });

  let receiptToday = 0;
  let paymentToday = 0;
  try {
    const receipts = await financeService.listReceiptVouchers(scope, {});
    const payments = await financeService.listPaymentVouchers(scope);
    receiptToday = receipts.filter((r: { created_at?: string }) => String(r.created_at) >= t0).length;
    paymentToday = payments.filter((r: { created_at?: string }) => String(r.created_at) >= t0).length;
  } catch {
    receiptToday = -1;
    paymentToday = -1;
  }

  return {
    counts,
    totals: {
      all: shipments.length,
      today: todayShipments.length,
      upcoming: upcoming.length,
    },
    financeToday: {
      receiptVouchers: receiptToday,
      paymentVouchers: paymentToday,
    },
  };
}

export function createAgentPortalRouter(
  service: ShipmentService,
  financeService: FinanceService,
  transfersService: TransfersService,
  agents: AgentRepository,
) {
  const router = Router();
  const auditService = new AuditService();

  router.get(
    '/profile',
    requirePermissions(['agent_portal.view']),
    asyncHandler(async (req, res) => {
      const ctx = (req as any).requestUserContext;
      const companyId = ctx?.companyId as string | undefined;
      const agentId = ctx?.scope?.agentId as string | undefined;
      if (!companyId || !agentId) {
        res.status(403).json({ success: false, error: 'لا يوجد وكيل مرتبط بهذا الحساب.' });
        return;
      }
      const agent = await agents.getAgentById(agentId, companyId);
      if (!agent) {
        res.status(404).json({ success: false, error: 'الوكيل غير موجود.' });
        return;
      }
      let branchLabel: string | null = null;
      if (agent.branch_id) {
        const br = await pool.query<{ name: string }>(`select name from branches where id = $1 limit 1`, [agent.branch_id]);
        branchLabel = br.rows[0]?.name ?? null;
      }
      res.json({
        success: true,
        data: {
          agent,
          branchLabel,
          username: ctx.username as string,
        },
      });
    }),
  );

  router.post(
    '/transfers',
    requirePermissions(['agent_portal.view']),
    asyncHandler(async (req, res) => {
      const { companyId, agentId } = requireAgentPortalContext(req);
      const payload = createTransferSchema.parse(req.body);
      const transfer = await transfersService.createAgentPortalTransfer({
        companyId,
        originAgentId: agentId,
        senderName: payload.senderName,
        receiverName: payload.receiverName,
        destinationCity: payload.destinationCity,
        amount: payload.amount,
        currency: payload.currency,
        transferServiceFee: payload.transferServiceFee,
        notes: payload.notes,
        userId: (req as any).requestUserContext?.userId,
        baseCurrency: (req as any).requestUserContext?.baseCurrency,
      });
      auditService.logAsync({
        req,
        action: 'AGENT_PORTAL_TRANSFER_CREATED',
        entityType: 'transfer',
        entityId: String(transfer.id),
        metadata: { originAgentId: agentId, destinationAgentId: transfer.destination_agent_id, amount: transfer.amount, currency: transfer.currency },
      });
      res.status(201).json({ success: true, data: transferForMobile(transfer) });
    }),
  );

  router.get(
    '/workspace-summary',
    requirePermissions(['agent_portal.view']),
    asyncHandler(async (req, res) => {
      const data = await workspaceSummaryPayload(service, financeService, req);
      res.json({ success: true, data });
    }),
  );

  /** Alias for older clients / cached bundles expecting `/stats` */
  router.get(
    '/stats',
    requirePermissions(['agent_portal.view']),
    asyncHandler(async (req, res) => {
      const data = await workspaceSummaryPayload(service, financeService, req);
      res.json({ success: true, data });
    }),
  );

  router.get(
    '/shipments',
    requirePermissions(['agent_portal.view']),
    asyncHandler(async (req, res) => {
      const scope = parseDataScope(req);
      const items = await service.list(scope);
      res.json({ success: true, data: items });
    }),
  );

  router.get(
    '/shipments/:id/details',
    requirePermissions(['agent_portal.view']),
    asyncHandler(async (req, res) => {
      const { companyId, agentId } = requireAgentPortalContext(req);
      const shipment = await service.getById(String(req.params.id), parseDataScope(req));
      if (!shipment) {
        throw new HttpError(404, 'SHIPMENT_NOT_FOUND');
      }
      const linkedTransfer = await transfersService.getAgentPortalTransferByShipmentId(String(req.params.id), companyId, agentId);
      res.json({ success: true, data: shipmentDetailsForMobile(shipment, linkedTransfer, agentId) });
    }),
  );

  router.get(
    '/financial-statement',
    requirePermissions(['agent_portal.view']),
    asyncHandler(async (req, res) => {
      const { companyId, agentId, currency } = requireAgentPortalContext(req);
      const statement = await agents.getAgentFinancialStatement(companyId, agentId, currency);
      if (!statement) {
        throw new HttpError(404, 'AGENT_NOT_FOUND');
      }
      res.json({
        success: true,
        data: {
          agent: {
            id: statement.agent.id,
            code: statement.agent.code,
            name: statement.agent.name,
            commissionPercentage: Number(statement.agent.commission_percentage ?? 0),
          },
          currency,
          summary: {
            totalShippingCommission: Number(statement.summary.totalShipmentCommission ?? 0),
            totalTransferCommission: Number(statement.summary.totalTransferCommission ?? 0),
            totalDue: Number(statement.summary.totalAgentCommission ?? 0),
            totalPaid: Number(statement.summary.paidToAgent ?? 0),
            balance: Number(statement.summary.netAgentDue ?? 0),
            lastReconciliationDate: statement.lastReconciliation?.reconciled_at ?? null,
            balanceAfterLastReconciliation: Number(statement.summary.sinceLastReconciliation?.netAgentDue ?? 0),
          },
          period: {
            fromDate: null,
            toDate: null,
          },
        },
      });
    }),
  );

  router.get(
    '/account-statement',
    requirePermissions(['agent_portal.view']),
    asyncHandler(async (req, res) => {
      const { companyId, agentId, currency } = requireAgentPortalContext(req);
      const query = accountStatementQuerySchema.parse(req.query);
      const fromTimestamp = parseOptionalDate(query.fromDate, 'fromDate');
      const toTimestamp = parseOptionalDate(query.toDate, 'toDate');
      const statement = await agents.getAgentAccountStatement(companyId, agentId, currency, null);
      if (!statement) {
        throw new HttpError(404, 'AGENT_NOT_FOUND');
      }

      const orderedRows = [...statement.rows].sort((a: any, b: any) => {
        const byDate = Date.parse(String(a.at)) - Date.parse(String(b.at));
        if (byDate !== 0) return byDate;
        const byType = String(a.source_type).localeCompare(String(b.source_type));
        if (byType !== 0) return byType;
        return String(a.source_id).localeCompare(String(b.source_id));
      });
      const sourceType = query.sourceType?.trim().toUpperCase();
      const openingBalance = orderedRows
        .filter((row: any) => fromTimestamp !== null && Date.parse(String(row.at)) < fromTimestamp)
        .reduce((sum: number, row: any) => sum + Number(row.credit ?? 0) - Number(row.debit ?? 0), 0);
      const filteredRows = orderedRows.filter((row: any) => {
        const timestamp = Date.parse(String(row.at));
        if (fromTimestamp !== null && timestamp < fromTimestamp) return false;
        if (toTimestamp !== null && timestamp > toTimestamp) return false;
        return !sourceType || sourceTypeForMobile(String(row.source_type)) === sourceType;
      });

      let runningBalance = openingBalance;
      const movements = filteredRows.map((row: any) => {
        runningBalance += Number(row.credit ?? 0) - Number(row.debit ?? 0);
        return {
          id: `${row.source_type}:${row.source_id}`,
          date: row.at,
          sourceType: sourceTypeForMobile(String(row.source_type)),
          referenceType: referenceTypeForMobile(String(row.source_type)),
          referenceId: String(row.source_id),
          referenceNo: row.reference_no ?? null,
          description: row.description ?? null,
          debit: Number(row.debit ?? 0),
          credit: Number(row.credit ?? 0),
          currency: String(row.currency_code ?? currency),
          balance: runningBalance,
          status: String(row.status ?? 'POSTED').toUpperCase(),
        };
      });

      res.json({
        success: true,
        data: {
          agent: {
            id: statement.agent.id,
            code: statement.agent.code,
            name: statement.agent.name,
          },
          currency,
          openingBalance,
          closingBalance: runningBalance,
          lastReconciliationDate: statement.lastReconciliation?.reconciled_at ?? null,
          movements: movements.slice(query.offset, query.offset + query.limit),
          pagination: {
            limit: query.limit,
            offset: query.offset,
            total: movements.length,
          },
        },
      });
    }),
  );

  router.get(
    '/transfers',
    requirePermissions(['agent_portal.view']),
    asyncHandler(async (req, res) => {
      const { companyId, agentId } = requireAgentPortalContext(req);
      const query = transfersQuerySchema.parse(req.query);
      const result = await transfersService.listAgentPortalTransfers({
        companyId,
        agentId,
        status: query.status,
        search: query.search,
        type: query.type,
        limit: query.limit,
        offset: query.offset,
      });
      res.json({
        success: true,
        data: {
          items: result.items.map((row) => transferForMobile(row, agentId)),
          pagination: {
            limit: query.limit,
            offset: query.offset,
            total: result.total,
          },
        },
      });
    }),
  );

  router.get(
    '/transfers/:id',
    requirePermissions(['agent_portal.view']),
    asyncHandler(async (req, res) => {
      const { companyId, agentId } = requireAgentPortalContext(req);
      const transfer = await transfersService.getAgentPortalTransfer(String(req.params.id), companyId, agentId);
      if (!transfer) {
        throw new HttpError(404, 'TRANSFER_NOT_FOUND');
      }
      res.json({ success: true, data: transferForMobile(transfer, agentId) });
    }),
  );

  router.post(
    '/transfers/:id/complete',
    requirePermissions(['agent_portal.view']),
    asyncHandler(async (req, res) => {
      const { companyId, agentId } = requireAgentPortalContext(req);
      const transfer = await transfersService.completeAgentPortalTransfer({
        id: String(req.params.id),
        companyId,
        agentId,
        userId: (req as any).requestUserContext?.userId,
        baseCurrency: (req as any).requestUserContext?.baseCurrency,
      });
      auditService.logAsync({
        req,
        action: 'AGENT_PORTAL_TRANSFER_DELIVERED',
        entityType: 'transfer',
        entityId: String(transfer.id),
        metadata: { destinationAgentId: agentId, amount: transfer.amount, currency: transfer.currency },
      });
      res.json({ success: true, data: transferForMobile(transfer, agentId) });
    }),
  );

  router.post(
    '/shipments/:id/:action',
    requirePermissions(['agent_portal.status_action']),
    asyncHandler(async (req, res) => {
      const action = String(req.params.action);
      const target = actionMap[action];
      if (!target) {
        res.status(400).json({ success: false, error: 'الإجراء المطلوب غير مدعوم في بوابة الوكيل.' });
        return;
      }
      const payload = actionSchema.parse(req.body ?? {});
      const updated = await service.transitionStatus({
        shipmentId: String(req.params.id),
        nextStatus: target,
        note: payload.note,
        metadata: payload.metadata,
        changedBy: (req as any).requestUserContext?.userId,
        source: `agent-portal.${action}`,
        scope: parseDataScope(req),
      });
      res.json({ success: true, data: updated });
    }),
  );

  return router;
}
