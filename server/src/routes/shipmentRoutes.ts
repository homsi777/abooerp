import { Router } from 'express';
import { z } from 'zod';
import type { ShipmentService } from '../services/shipmentService.js';
import { asyncHandler } from '../utils/http.js';
import { currencyCodeSchema } from '../utils/money.js';
import { parseDataScope } from '../utils/scope.js';
import { requirePermissions } from '../middleware/authorization.js';
import { requireIdempotencyKey } from '../middleware/idempotency.js';
import { AuditService } from '../services/auditService.js';
import { licenseGuard } from '../middleware/licenseGuard.js';
import { emit } from '../events/eventBus.js';
import { sendAgentShipmentNotification, sendLinkedPartyShipmentNotifications } from '../services/telegramService.js';
import { CANONICAL_SHIPMENT_STATUSES, type CanonicalShipmentStatus } from '../domain/shipmentStatus.js';

const inventoryLineSchema = z.object({
  itemId: z.string().uuid(),
  warehouseId: z.string().uuid(),
  quantity: z.coerce.number().positive(),
});

const financialPostingSchema = z.object({
  paymentMode: z.enum(['UNPAID', 'PAID_NOW', 'PARTIAL']).default('UNPAID'),
  paidAmount: z.number().nonnegative().optional(),
  cashboxId: z.string().uuid().optional(),
  paymentMethod: z.enum(['cash', 'transfer', 'other']).optional(),
  /** New: preferred over payerPartyKind. Determines which party bears the charge. */
  financialResponsibilityType: z.enum(['AGENT', 'ACCOUNT_CUSTOMER', 'COMPANY_CASH', 'FREE']).optional(),
  financialResponsibilityId: z.string().uuid().optional(),
  /** Legacy: still accepted but no longer defaulted to RECEIVER */
  payerPartyKind: z.enum(['SENDER', 'RECEIVER', 'CUSTOMER', 'AGENT']).optional(),
  allowZeroAmountNote: z.string().max(400).optional(),
});

const shipmentCreateSchema = z.object({
  shipmentNo: z.string().min(1),
  referenceNo: z.string().optional(),
  customerId: z.string().uuid().optional(),
  senderId: z.string().uuid(),
  receiverId: z.string().uuid(),
  branchId: z.string().uuid(),
  agentId: z.string().uuid().optional(),
  originCity: z.string().optional(),
  destinationCity: z.string().min(1),
  description: z.string().optional(),
  piecesCount: z.coerce.number().int().positive().default(1),
  weightKg: z.coerce.number().positive().optional(),
  status: z.string().min(1).default('REGISTERED'),
  originalAmount: z.coerce.number(),
  originalCurrency: currencyCodeSchema,
  exchangeRateToUsd: z.coerce.number().positive(),
  baseAmountUsd: z.coerce.number().optional(),
  createdBy: z.string().uuid().optional(),
  expectedUpdatedAt: z.string().datetime({ offset: true }).optional(),
  /** Optional: inventory lines to reserve on shipment creation */
  inventoryItems: z.array(inventoryLineSchema).optional(),
  payerPartyKind: z.enum(['SENDER', 'RECEIVER', 'CUSTOMER']).optional(),
  defaultCashboxId: z.string().uuid().optional(),
  financial: financialPostingSchema.optional(),
  /** Fee breakdown (migration 058) */
  freightCharge: z.coerce.number().nonnegative().optional(),
  transferFee: z.coerce.number().nonnegative().optional(),
  additionalCharges: z.coerce.number().nonnegative().optional(),
  prepaidAmount: z.coerce.number().nonnegative().optional(),
  discountAmount: z.coerce.number().nonnegative().optional(),
  transferServiceFee: z.coerce.number().nonnegative().optional(),
});

const shipmentUpdateSchema = shipmentCreateSchema.partial();

const statusActionPayloadSchema = z.object({
  note: z.string().max(400).optional(),
  metadata: z.record(z.string(), z.unknown()).optional(),
});

const confirmPayloadSchema = z.object({
  note: z.string().max(400).optional(),
  metadata: z.record(z.string(), z.unknown()).optional(),
  financial: financialPostingSchema.optional(),
});

const recordPaymentSchema = z.object({
  amount: z.coerce.number().positive(),
  cashboxId: z.string().uuid(),
  paymentMethod: z.enum(['cash', 'transfer', 'other']).optional(),
  notes: z.string().max(500).optional(),
});

const statusActionMap: Record<string, CanonicalShipmentStatus> = {
  confirm: 'CONFIRMED',
  'mark-ready': 'READY_FOR_PICKUP',
  'handover-driver': 'HANDED_TO_DRIVER',
  'handover-agent': 'HANDED_TO_AGENT',
  'agent-received': 'AGENT_RECEIVED',
  'mark-in-transit': 'IN_TRANSIT',
  arrived: 'ARRIVED_AT_DESTINATION',
  'out-for-delivery': 'OUT_FOR_DELIVERY',
  deliver: 'DELIVERED',
  'request-return': 'RETURN_REQUESTED',
  'mark-returned': 'RETURNED',
  cancel: 'CANCELLED',
};

function statusForAction(action: keyof typeof statusActionMap): CanonicalShipmentStatus {
  return statusActionMap[action];
}

export function createShipmentRouter(service: ShipmentService) {
  const router = Router();
  const auditService = new AuditService();

  router.get(
    '/',
    requirePermissions(['shipments.read']),
    asyncHandler(async (req, res) => {
      const items = await service.list(parseDataScope(req));
      res.json({ success: true, data: items });
    }),
  );

  router.get(
    '/:id/financial-card',
    requirePermissions(['shipments.read']),
    asyncHandler(async (req, res) => {
      const scope = parseDataScope(req);
      const data = await service.getShipmentFinancialCard(String(req.params.id), scope);
      res.json({ success: true, data });
    }),
  );

  router.get(
    '/:id/financial-movements',
    requirePermissions(['shipments.read']),
    asyncHandler(async (req, res) => {
      const card = await service.getShipmentFinancialCard(String(req.params.id), parseDataScope(req));
      res.json({ success: true, data: card.movements });
    }),
  );

  router.get(
    '/:id',
    requirePermissions(['shipments.read']),
    asyncHandler(async (req, res) => {
      const item = await service.getById(String(req.params.id), parseDataScope(req));
      if (!item) {
        res.status(404).json({ success: false, error: 'Shipment not found' });
        return;
      }
      res.json({ success: true, data: item });
    }),
  );

  router.get(
    '/:id/status-history',
    requirePermissions(['shipments.read']),
    asyncHandler(async (req, res) => {
      const rows = await service.listStatusHistory(String(req.params.id), parseDataScope(req));
      res.json({ success: true, data: rows });
    }),
  );

  router.post(
    '/',
    requirePermissions(['shipments.write']),
    licenseGuard('shipment'),
    requireIdempotencyKey('shipments.create'),
    asyncHandler(async (req, res) => {
      const scope = parseDataScope(req);
      try {
        const parsed = shipmentCreateSchema.parse(req.body);
        const uc = (req as any).requestUserContext as { userType?: string; userId?: string } | undefined;
        const { financial: financialPayload, ...parsedRest } = parsed;
        const payload =
          uc?.userType === 'agent'
            ? {
                ...parsedRest,
                createdBy: uc.userId,
                branchId: scope.branchId ?? parsedRest.branchId,
                agentId: scope.agentId ?? parsedRest.agentId,
              }
            : parsedRest;
        const item = await service.create(payload as any, scope, {
          financial: financialPayload,
          actorUserId: uc?.userId,
        });
        const hasInventory = Boolean(payload.inventoryItems?.length);
        auditService.logAsync({
          req,
          action: 'SHIPMENT_CREATED',
          entityType: 'shipment',
          entityId: item.id,
          metadata: {
            shipmentNo: item.shipment_no,
            branchId: item.branch_id,
            status: item.status,
            destinationCity: item.destination_city,
            originalAmount: item.original_amount,
            originalCurrency: item.original_currency,
          },
        });
        // Notify agent's Telegram bot if an agent is assigned (non-blocking)
        if (item.agent_id && scope.companyId) {
          void sendAgentShipmentNotification(scope.companyId, item.agent_id, {
            shipmentNo: item.shipment_no,
            destinationCity: item.destination_city,
            piecesCount: item.pieces_count,
            weightKg: item.weight_kg ?? undefined,
          });
        }
        if (scope.companyId) {
          void sendLinkedPartyShipmentNotifications(scope.companyId, item.id);
        }
        if (hasInventory) {
          auditService.logAsync({
            req,
            action: 'SHIPMENT_STOCK_RESERVED',
            entityType: 'shipment',
            entityId: item.id,
            metadata: {
              shipmentNo: item.shipment_no,
              inventoryLines: payload.inventoryItems,
            },
          });
        }
        emit({ type: 'shipment.created', companyId: scope.companyId ?? '', branchId: item.branch_id ?? null, entityId: item.id, timestamp: new Date().toISOString(), correlationId: (req as any).correlationId });
        res.status(201).json({ success: true, data: item });
      } catch (error) {
        auditService.logAsync({
          req,
          action: 'SHIPMENT_CREATE_FAILED',
          entityType: 'shipment',
          metadata: { reason: (error as any)?.message ?? 'unknown' },
        });
        throw error;
      }
    }),
  );

  router.put(
    '/:id',
    requirePermissions(['shipments.write']),
    requireIdempotencyKey('shipments.update'),
    asyncHandler(async (req, res) => {
      const scope = parseDataScope(req);
      try {
        const payload = shipmentUpdateSchema.parse(req.body);
        const item = await service.update(String(req.params.id), payload as any, scope);
        if (!item) {
          res.status(404).json({ success: false, error: 'Shipment not found' });
          return;
        }
        auditService.logAsync({
          req,
          action: 'SHIPMENT_UPDATED',
          entityType: 'shipment',
          entityId: item.id,
          metadata: {
            shipmentNo: item.shipment_no,
            newStatus: item.status,
            updatedFields: Object.keys(payload),
          },
        });
        if (item.status === 'cancelled') {
          auditService.logAsync({
            req,
            action: 'SHIPMENT_STOCK_RELEASED',
            entityType: 'shipment',
            entityId: item.id,
            metadata: { shipmentNo: item.shipment_no, reason: 'shipment_cancelled' },
          });
        }
        emit({ type: 'shipment.updated', companyId: scope.companyId ?? '', branchId: item.branch_id ?? null, entityId: item.id, timestamp: new Date().toISOString(), correlationId: (req as any).correlationId });
        res.json({ success: true, data: item });
      } catch (error) {
        auditService.logAsync({
          req,
          action: 'SHIPMENT_UPDATE_FAILED',
          entityType: 'shipment',
          entityId: String(req.params.id),
          metadata: { reason: (error as any)?.message ?? 'unknown' },
        });
        throw error;
      }
    }),
  );

  router.delete(
    '/:id',
    requirePermissions(['shipments.write']),
    asyncHandler(async (req, res) => {
      const scope = parseDataScope(req);
      const removed = await service.remove(String(req.params.id), scope);
      if (!removed) {
        res.status(404).json({ success: false, error: 'Shipment not found' });
        return;
      }
      auditService.logAsync({
        req,
        action: 'SHIPMENT_DELETED',
        entityType: 'shipment',
        entityId: String(req.params.id),
        metadata: {},
      });
      emit({
        type: 'shipment.deleted',
        companyId: parseDataScope(req).companyId ?? '',
        branchId: null,
        entityId: String(req.params.id),
        timestamp: new Date().toISOString(),
        correlationId: (req as any).correlationId ?? null,
      });
      res.json({ success: true });
    }),
  );

  router.post(
    '/:id/confirm',
    requirePermissions(['shipments.write']),
    requireIdempotencyKey('shipments.confirm'),
    asyncHandler(async (req, res) => {
      const payload = confirmPayloadSchema.parse(req.body ?? {});
      const scope = parseDataScope(req);
      const uc = (req as any).requestUserContext as { userId?: string } | undefined;
      const financial = {
        paymentMode: 'UNPAID' as const,
        // No longer default payerPartyKind to RECEIVER — responsibility resolved from shipment data
        ...payload.financial,
      };
      const updated = await service.confirmWithFinancials({
        shipmentId: String(req.params.id),
        scope,
        note: payload.note,
        metadata: payload.metadata,
        changedBy: uc?.userId,
        financial,
        actorUserId: uc?.userId,
      });

      auditService.logAsync({
        req,
        action: 'SHIPMENT_CONFIRMED',
        entityType: 'shipment',
        entityId: updated.id,
        metadata: {
          nextStatus: 'CONFIRMED',
          note: payload.note ?? null,
          financial: payload.financial ?? null,
        },
      });

      emit({
        type: 'shipment.updated',
        companyId: scope.companyId ?? '',
        branchId: updated.branch_id ?? null,
        entityId: updated.id,
        timestamp: new Date().toISOString(),
        correlationId: (req as any).correlationId,
      });

      res.json({ success: true, data: updated });
    }),
  );

  router.post(
    '/:id/repost-financials',
    requirePermissions(['shipments.write']),
    requireIdempotencyKey('shipments.repost-financials'),
    asyncHandler(async (req, res) => {
      const scope = parseDataScope(req);
      const uc = (req as any).requestUserContext as { userId?: string; userType?: string } | undefined;
      const result = await service.repostFinancials(String(req.params.id), scope, uc?.userId);
      auditService.logAsync({
        req,
        action: 'SHIPMENT_FINANCIAL_REPOSTED',
        entityType: 'shipment',
        entityId: String(req.params.id),
        metadata: { alreadyPosted: result.alreadyPosted, message: result.message },
      });
      res.json({ success: true, data: result });
    }),
  );

  router.post(
    '/:id/record-payment',
    requirePermissions(['shipments.write', 'finance.vouchers.create']),
    requireIdempotencyKey('shipments.record-payment'),
    asyncHandler(async (req, res) => {
      const body = recordPaymentSchema.parse(req.body ?? {});
      const scope = parseDataScope(req);
      const uc = (req as any).requestUserContext as { userId?: string } | undefined;
      const updated = await service.recordShipmentPayment(
        String(req.params.id),
        {
          amount: body.amount,
          cashboxId: body.cashboxId,
          paymentMethod: body.paymentMethod,
          notes: body.notes,
        },
        scope,
        uc?.userId,
      );
      res.json({ success: true, data: updated });
    }),
  );

  const registerStatusAction = (
    actionPath: keyof typeof statusActionMap,
    permissionKey: string,
    actionAudit: string,
  ) => {
    router.post(
      `/:id/${actionPath}`,
      requirePermissions(['shipments.write']),
      requireIdempotencyKey(`shipments.${actionPath}`),
      asyncHandler(async (req, res) => {
        const payload = statusActionPayloadSchema.parse(req.body ?? {});
        const scope = parseDataScope(req);
        const targetStatus = statusForAction(actionPath);
        if (!(CANONICAL_SHIPMENT_STATUSES as readonly string[]).includes(targetStatus)) {
          res.status(400).json({ success: false, error: 'Invalid lifecycle action.' });
          return;
        }

        const updated = await service.transitionStatus({
          shipmentId: String(req.params.id),
          nextStatus: targetStatus,
          note: payload.note,
          metadata: payload.metadata,
          changedBy: (req as any).requestUserContext?.userId,
          source: `api.shipments.${actionPath}`,
          scope,
        });

        auditService.logAsync({
          req,
          action: actionAudit,
          entityType: 'shipment',
          entityId: updated.id,
          metadata: {
            nextStatus: targetStatus,
            permissionKey,
            note: payload.note ?? null,
          },
        });

        emit({
          type: 'shipment.updated',
          companyId: scope.companyId ?? '',
          branchId: updated.branch_id ?? null,
          entityId: updated.id,
          timestamp: new Date().toISOString(),
          correlationId: (req as any).correlationId,
        });

        res.json({ success: true, data: updated });
      }),
    );
  };

  registerStatusAction('mark-ready', 'shipments.mark_ready', 'SHIPMENT_READY_FOR_PICKUP');
  registerStatusAction('handover-driver', 'shipments.handover_driver', 'SHIPMENT_HANDED_TO_DRIVER');
  registerStatusAction('handover-agent', 'shipments.handover_agent', 'SHIPMENT_HANDED_TO_AGENT');
  registerStatusAction('agent-received', 'shipments.agent_received', 'SHIPMENT_AGENT_RECEIVED');
  registerStatusAction('mark-in-transit', 'shipments.mark_in_transit', 'SHIPMENT_IN_TRANSIT');
  registerStatusAction('arrived', 'shipments.mark_arrived', 'SHIPMENT_ARRIVED_DESTINATION');
  registerStatusAction('out-for-delivery', 'shipments.out_for_delivery', 'SHIPMENT_OUT_FOR_DELIVERY');
  registerStatusAction('deliver', 'shipments.deliver', 'SHIPMENT_DELIVERED');
  registerStatusAction('request-return', 'shipments.return', 'SHIPMENT_RETURN_REQUESTED');
  registerStatusAction('mark-returned', 'shipments.return', 'SHIPMENT_RETURNED');
  registerStatusAction('cancel', 'shipments.cancel', 'SHIPMENT_CANCELLED');

  return router;
}
