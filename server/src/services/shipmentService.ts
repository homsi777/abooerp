import { computeBaseAmountUsd } from '../utils/money.js';
import { pool } from '../db/pool.js';
import type { ShipmentCreateInput, ShipmentRepository } from '../repositories/shipmentRepository.js';
import { HttpError } from '../utils/errors.js';
import type { DataScope } from '../utils/scope.js';
import type { InventoryService } from './inventoryService.js';
import {
  canTransitionShipmentStatus,
  normalizeShipmentStatus,
  SHIPMENT_TRANSITIONS,
  TERMINAL_SHIPMENT_STATUSES,
  type CanonicalShipmentStatus,
} from '../domain/shipmentStatus.js';
import type { ShipmentFinancialInput, ShipmentFinancialPostingService } from './shipmentFinancialPostingService.js';
import { AgentRepository } from '../repositories/agentRepository.js';
import { TransfersService } from './transfersService.js';

export class ShipmentService {
  constructor(
    private repository: ShipmentRepository,
    private inventoryService?: InventoryService,
    private financialPosting?: ShipmentFinancialPostingService,
    private transfersService?: TransfersService,
    private agentRepository?: AgentRepository,
  ) {}

  list(scope?: DataScope) {
    return this.repository.list(scope);
  }

  async getById(id: string, scope?: DataScope) {
    const shipment = await this.repository.getById(id, scope);
    if (!shipment && (scope?.branchId || scope?.agentId) && await this.repository.existsInCompany(id, scope.companyId)) {
      throw new HttpError(403, 'غير مسموح بعرض هذه الشحنة ضمن نطاق المستخدم الحالي.');
    }
    return shipment;
  }

  async create(
    input: ShipmentCreateInput,
    scope?: DataScope,
    options?: { financial?: ShipmentFinancialInput; actorUserId?: string },
  ) {
    if (scope?.branchId && input.branchId !== scope.branchId) {
      throw new HttpError(403, 'Cannot create shipment outside scoped branch.');
    }
    if (scope?.agentId && input.agentId && input.agentId !== scope.agentId) {
      throw new HttpError(403, 'Cannot create shipment outside scoped agent.');
    }

    const effectiveCompanyId = input.companyId ?? scope?.companyId;

    const payload = {
      ...input,
      status: (normalizeShipmentStatus(input.status) === 'UNKNOWN'
        ? 'REGISTERED'
        : normalizeShipmentStatus(input.status)) as ShipmentCreateInput['status'],
      companyId: effectiveCompanyId,
      baseAmountUsd: computeBaseAmountUsd(input.originalAmount, input.exchangeRateToUsd),
    };

    if (!payload.agentId && this.agentRepository && effectiveCompanyId && payload.destinationCity?.trim()) {
      const destinationAgents = await this.agentRepository.lookupByDestination(
        effectiveCompanyId,
        payload.destinationCity,
      );
      if (destinationAgents.length === 1) {
        payload.agentId = destinationAgents[0].id;
      }
    }

    if (payload.agentId && this.agentRepository && effectiveCompanyId) {
      try {
        const agent = await this.agentRepository.getAgentById(payload.agentId, effectiveCompanyId);
        const commissionPercentage = Number(agent?.commission_percentage ?? 0);
        const baseAmount = Number(payload.freightCharge ?? 0);
        payload.agentCommissionBaseType = 'FREIGHT_CHARGE';
        payload.agentCommissionBaseAmount = baseAmount;
        payload.agentCommissionPercentageSnapshot = commissionPercentage;
        payload.agentCommissionAmountSnapshot = (baseAmount * commissionPercentage) / 100;
      } catch {
        const baseAmount = Number(payload.freightCharge ?? 0);
        payload.agentCommissionBaseType = 'FREIGHT_CHARGE';
        payload.agentCommissionBaseAmount = baseAmount;
        payload.agentCommissionPercentageSnapshot = 0;
        payload.agentCommissionAmountSnapshot = 0;
      }
    }

    const normStatus = normalizeShipmentStatus(String(payload.status));
    const needsPosting = Boolean(this.financialPosting && normStatus === 'CONFIRMED');

    let created;
    if (needsPosting) {
      const client = await pool.connect();
      try {
        await client.query('begin');
        created = await this.repository.createWithClient(client, payload);
        const uc = { userId: options?.actorUserId ?? scope?.userId };
        await this.financialPosting!.postShipmentConfirmationFinancials({
          client,
          shipmentId: created.id,
          scope,
          userContext: uc,
          financial:
            options?.financial ??
            ({
              paymentMode: 'UNPAID',
              payerPartyKind: payload.payerPartyKind ?? 'RECEIVER',
            } as ShipmentFinancialInput),
          shipmentRow: created,
        });
        await client.query('commit');
      } catch (e) {
        await client.query('rollback');
        throw e;
      } finally {
        client.release();
      }
    } else {
      created = await this.repository.create(payload);
    }

    // Reserve inventory with the real shipment ID.
    // If reservation fails (STOCK_NOT_AVAILABLE or any error), soft-delete the
    // shipment so the system stays consistent, then re-throw to the caller.
    if (this.inventoryService && effectiveCompanyId && input.inventoryItems?.length) {
      try {
        await this.inventoryService.reserveStock(
          effectiveCompanyId,
          created.id,
          input.inventoryItems,
          input.createdBy,
        );
      } catch (inventoryError) {
        await this.repository.remove(created.id, { companyId: effectiveCompanyId }).catch(() => {});
        throw inventoryError;
      }
    }

    if (
      this.transfersService
      && effectiveCompanyId
      && typeof payload.hawalaAmount === 'number'
      && payload.hawalaAmount > 0
    ) {
      try {
        let senderDisplay = 'غير معروف';
        let receiverDisplay = 'غير معروف';
        try {
          const partyResult = await pool.query<{ id: string; full_name: string }>(
            `select id, full_name from senders_receivers where id = any($1::uuid[])`,
            [[payload.senderId, payload.receiverId]],
          );
          for (const row of partyResult.rows) {
            if (String(row.id) === String(payload.senderId)) senderDisplay = row.full_name;
            if (String(row.id) === String(payload.receiverId)) receiverDisplay = row.full_name;
          }
        } catch {}

        const currency = payload.originalCurrency || 'USD';
        const transferAmount = Number(payload.hawalaAmount ?? 0);
        const transferMain = computeBaseAmountUsd(transferAmount, payload.exchangeRateToUsd || 1);
        const fee = Number(payload.transferServiceFee ?? 0);
        const feeMain = computeBaseAmountUsd(fee, payload.exchangeRateToUsd || 1);

        await this.transfersService.createTransfer({
          company_id: effectiveCompanyId,
          branch_id: payload.branchId,
          agent_id: payload.agentId,
          shipment_id: created.id,
          sender_name: senderDisplay,
          receiver_name: receiverDisplay,
          amount: transferAmount,
          currency,
          main_amount: transferMain,
          commission: 0,
          commission_currency: currency,
          commission_main: 0,
          agent_commission: 0,
          agent_commission_currency: currency,
          agent_commission_main: 0,
          transfer_service_fee: fee,
          transfer_service_fee_currency: currency,
          transfer_service_fee_main: feeMain,
          company_transfer_profit: fee,
          company_transfer_profit_currency: currency,
          company_transfer_profit_main: feeMain,
          status: 'PENDING',
          notes: `حوالة مرتبطة بالشحنة ${created.shipment_no}`,
        });
      } catch {}
    }

    return created;
  }

  async update(id: string, input: Partial<ShipmentCreateInput>, scope?: DataScope) {
    const existing = await this.repository.getById(id, scope);
    if (!existing) {
      return null;
    }

    const currentCanonical = normalizeShipmentStatus(String(existing.status));
    if (currentCanonical !== 'UNKNOWN' && TERMINAL_SHIPMENT_STATUSES.has(currentCanonical)) {
      throw new HttpError(409, 'الشحنة في حالة نهائية ولا يمكن تعديلها.');
    }

    if (input.status) {
      const currentStatus = normalizeShipmentStatus(String(existing.status));
      const nextStatus = normalizeShipmentStatus(String(input.status));
      if (currentStatus === 'UNKNOWN' || nextStatus === 'UNKNOWN') {
        throw new HttpError(400, 'Unknown shipment status transition.');
      }
      if (currentStatus !== nextStatus && !canTransitionShipmentStatus(currentStatus, nextStatus)) {
        throw new HttpError(400, `Invalid shipment status transition: ${currentStatus} -> ${nextStatus}`);
      }

      // Release inventory reservations when shipment is cancelled
      if (nextStatus === 'CANCELLED' && this.inventoryService) {
        const companyId = existing.company_id ?? scope?.companyId;
        if (companyId) {
          await this.inventoryService.releaseStock(companyId, id, input.createdBy).catch((err) => {
            console.warn('[ShipmentService] releaseStock failed on cancel:', err?.message);
          });
        }
      }
    }

    if (scope?.branchId && input.branchId && input.branchId !== scope.branchId) {
      throw new HttpError(403, 'Cannot move shipment outside scoped branch.');
    }
    if (scope?.agentId && input.agentId && input.agentId !== scope.agentId) {
      throw new HttpError(403, 'Cannot move shipment outside scoped agent.');
    }

    const payload = { ...input };
    if (typeof input.originalAmount === 'number' && typeof input.exchangeRateToUsd === 'number') {
      payload.baseAmountUsd = computeBaseAmountUsd(input.originalAmount, input.exchangeRateToUsd);
    }

    const nextAgentId = payload.agentId ?? (existing as any)?.agent_id ?? undefined;
    const needsCommissionRefresh =
      typeof payload.freightCharge === 'number'
      || typeof payload.agentId === 'string'
      || (existing as any)?.agent_commission_amount_snapshot == null;

    if (needsCommissionRefresh && nextAgentId && this.agentRepository) {
      const companyId = (existing as any)?.company_id ?? scope?.companyId;
      if (companyId) {
        try {
          const agent = await this.agentRepository.getAgentById(nextAgentId, companyId);
          const commissionPercentage = Number(agent?.commission_percentage ?? 0);
          const baseAmount = Number(
            payload.freightCharge
              ?? (existing as any)?.freight_charge
              ?? 0,
          );
          payload.agentCommissionBaseType = 'FREIGHT_CHARGE';
          payload.agentCommissionBaseAmount = baseAmount;
          payload.agentCommissionPercentageSnapshot = commissionPercentage;
          payload.agentCommissionAmountSnapshot = (baseAmount * commissionPercentage) / 100;
        } catch {
          const baseAmount = Number(
            payload.freightCharge
              ?? (existing as any)?.freight_charge
              ?? 0,
          );
          payload.agentCommissionBaseType = 'FREIGHT_CHARGE';
          payload.agentCommissionBaseAmount = baseAmount;
          payload.agentCommissionPercentageSnapshot = 0;
          payload.agentCommissionAmountSnapshot = 0;
        }
      }
    }
    const updated = await this.repository.update(id, payload);
    if (!updated && input.expectedUpdatedAt) {
      const latest = await this.repository.getById(id, scope);
      if (latest) {
        throw new HttpError(409, 'Shipment was modified by another operation. Reload and retry.');
      }
    }

    if (
      updated &&
      this.financialPosting &&
      input.status &&
      typeof input.status === 'string'
    ) {
      const prevStatus = normalizeShipmentStatus(String(existing.status));
      const nextStatus = normalizeShipmentStatus(String(input.status));
      if (
        prevStatus !== nextStatus &&
        (nextStatus === 'DELIVERED' || nextStatus === 'CONFIRMED')
      ) {
        await this.financialPosting.ensurePostedFromLifecycle(id, scope, scope?.userId);
      }
    }

    return updated;
  }

  async remove(id: string, scope?: DataScope) {
    const existing = await this.repository.getById(id, scope);
    if (!existing) {
      if ((scope?.branchId || scope?.agentId) && await this.repository.existsInCompany(id, scope.companyId)) {
        throw new HttpError(403, 'غير مسموح بحذف هذه الشحنة ضمن نطاق المستخدم الحالي.');
      }
      return false;
    }
    return this.repository.remove(id, scope);
  }

  async listStatusHistory(shipmentId: string, scope?: DataScope) {
    const existing = await this.repository.getById(shipmentId, scope);
    if (!existing) {
      if ((scope?.branchId || scope?.agentId) && await this.repository.existsInCompany(shipmentId, scope.companyId)) {
        throw new HttpError(403, 'غير مسموح بعرض سجل هذه الشحنة ضمن نطاق المستخدم الحالي.');
      }
      return [];
    }
    return this.repository.listStatusHistory(shipmentId, scope);
  }

  async confirmWithFinancials(input: {
    shipmentId: string;
    scope?: DataScope;
    note?: string;
    metadata?: Record<string, unknown>;
    changedBy?: string;
    financial: ShipmentFinancialInput;
    actorUserId?: string;
  }) {
    if (!this.financialPosting) {
      throw new HttpError(500, 'خدمة الترحيل المالي غير مهيأة.');
    }

    const client = await pool.connect();
    try {
      await client.query('begin');
      const locked = await this.repository.lockShipmentForUpdate(client, input.shipmentId, input.scope);
      if (!locked) {
        await client.query('rollback');
        if (
          input.scope &&
          (await this.repository.existsInCompany(input.shipmentId, input.scope.companyId))
        ) {
          throw new HttpError(403, 'غير مسموح بتأكيد هذه الشحنة ضمن نطاق المستخدم الحالي.');
        }
        throw new HttpError(404, 'الشحنة غير موجودة.');
      }

      const currentCanonical = normalizeShipmentStatus(String(locked.status));
      if (currentCanonical === 'UNKNOWN') {
        throw new HttpError(409, 'حالة الشحنة الحالية غير معروفة ولا يمكن تنفيذ الإجراء.');
      }
      if (!canTransitionShipmentStatus(currentCanonical, 'CONFIRMED')) {
        const allowed = SHIPMENT_TRANSITIONS[currentCanonical].join(', ');
        throw new HttpError(
          400,
          `لا يمكن تأكيد الشحنة من الحالة الحالية. الحالات المسموحة: ${allowed}`,
        );
      }

      await this.financialPosting.postShipmentConfirmationFinancials({
        client,
        shipmentId: input.shipmentId,
        scope: input.scope,
        userContext: { userId: input.actorUserId ?? input.scope?.userId },
        financial: input.financial,
        shipmentRow: locked,
      });

      const changed = await this.repository.transitionStatusCore(client, {
        shipmentId: input.shipmentId,
        nextStatus: 'CONFIRMED',
        note: input.note,
        metadata: input.metadata,
        changedBy: input.changedBy,
        source: 'api.shipments.confirm',
        scope: input.scope,
      });
      if (!changed) {
        throw new HttpError(404, 'تعذر تحديث حالة الشحنة.');
      }

      await client.query('commit');
      return changed.updated;
    } catch (error) {
      await client.query('rollback');
      throw error;
    } finally {
      client.release();
    }
  }

  async transitionStatus(input: {
    shipmentId: string;
    nextStatus: CanonicalShipmentStatus;
    note?: string;
    metadata?: Record<string, unknown>;
    changedBy?: string;
    source?: string;
    scope?: DataScope;
  }) {
    const existing = await this.repository.getById(input.shipmentId, input.scope);
    if (!existing) {
      if ((input.scope?.branchId || input.scope?.agentId) && await this.repository.existsInCompany(input.shipmentId, input.scope.companyId)) {
        throw new HttpError(403, 'غير مسموح بتنفيذ إجراء على هذه الشحنة ضمن نطاق المستخدم الحالي.');
      }
      throw new HttpError(404, 'Shipment not found');
    }

    const currentCanonical = normalizeShipmentStatus(String(existing.status));
    if (currentCanonical === 'UNKNOWN') {
      throw new HttpError(409, 'حالة الشحنة الحالية غير معروفة ولا يمكن تنفيذ الإجراء.');
    }

    if (TERMINAL_SHIPMENT_STATUSES.has(currentCanonical) && currentCanonical !== input.nextStatus) {
      throw new HttpError(409, 'لا يمكن تعديل الشحنة بعد وصولها إلى حالة نهائية.');
    }

    if (!canTransitionShipmentStatus(currentCanonical, input.nextStatus)) {
      const allowed = SHIPMENT_TRANSITIONS[currentCanonical].join(', ');
      throw new HttpError(400, `انتقال حالة الشحنة غير مسموح: ${currentCanonical} -> ${input.nextStatus}. الحالات المتاحة: ${allowed}`);
    }

    if (input.nextStatus === 'HANDED_TO_AGENT' && !existing.agent_id) {
      throw new HttpError(400, 'يجب تحديد الوكيل قبل تسليم الشحنة للوكيل.');
    }

    if (input.nextStatus === 'HANDED_TO_DRIVER' && input.metadata?.loadedPiecesCount !== undefined) {
      const loadedPiecesCount = Number(input.metadata.loadedPiecesCount);
      const piecesCount = Number(existing.pieces_count ?? 0);
      if (!Number.isInteger(loadedPiecesCount) || loadedPiecesCount < 1 || loadedPiecesCount > piecesCount) {
        throw new HttpError(400, 'Loaded parcel count must be between 1 and the shipment parcel count.');
      }
      input.metadata.loadedPiecesCount = loadedPiecesCount;
      input.metadata.totalPiecesCount = piecesCount;
    }

    const changed = await this.repository.transitionStatus({
      shipmentId: input.shipmentId,
      nextStatus: input.nextStatus,
      note: input.note,
      metadata: input.metadata,
      changedBy: input.changedBy,
      source: input.source,
      scope: input.scope,
    });

    if (!changed) {
      throw new HttpError(404, 'لم يتم العثور على الشحنة.');
    }

    if (
      this.financialPosting &&
      (input.nextStatus === 'DELIVERED' || input.nextStatus === 'CONFIRMED')
    ) {
      await this.financialPosting.ensurePostedFromLifecycle(
        input.shipmentId,
        input.scope,
        input.changedBy ?? input.scope?.userId,
      );
    }

    return changed.updated;
  }

  getShipmentFinancialCard(id: string, scope?: DataScope) {
    if (!this.financialPosting) {
      throw new HttpError(500, 'خدمة الترحيل المالي غير مهيأة.');
    }
    return this.financialPosting.getShipmentFinancialCard(id, scope);
  }

  recordShipmentPayment(
    shipmentId: string,
    input: {
      amount: number;
      cashboxId: string;
      paymentMethod?: string;
      notes?: string;
    },
    scope?: DataScope,
    actorUserId?: string,
  ) {
    if (!this.financialPosting) {
      throw new HttpError(500, 'خدمة الترحيل المالي غير مهيأة.');
    }
    return this.financialPosting.recordAdditionalPayment({
      shipmentId,
      ...input,
      scope,
      actorUserId: actorUserId ?? scope?.userId,
    });
  }

  recalculateShipmentPaymentStatus(shipmentId: string) {
    if (!this.financialPosting) {
      throw new HttpError(500, 'خدمة الترحيل المالي غير مهيأة.');
    }
    return this.financialPosting.recalculateShipmentPaymentStatus(shipmentId);
  }

  async repostFinancials(shipmentId: string, scope?: DataScope, actorUserId?: string) {
    if (!this.financialPosting) {
      throw new HttpError(500, 'خدمة الترحيل المالي غير مهيأة.');
    }
    const shipment = await this.repository.getById(shipmentId, scope);
    if (!shipment) {
      if ((scope?.branchId || scope?.agentId) && await this.repository.existsInCompany(shipmentId, scope?.companyId)) {
        throw new HttpError(403, 'غير مسموح بإعادة الترحيل المالي لهذه الشحنة ضمن نطاق المستخدم الحالي.');
      }
      throw new HttpError(404, 'الشحنة غير موجودة.');
    }
    const status = normalizeShipmentStatus(String(shipment.status));
    const repastableStatuses = new Set(['CONFIRMED', 'READY_FOR_PICKUP', 'HANDED_TO_DRIVER', 'HANDED_TO_AGENT', 'AGENT_RECEIVED', 'IN_TRANSIT', 'ARRIVED_AT_DESTINATION', 'OUT_FOR_DELIVERY', 'DELIVERED']);
    if (!repastableStatuses.has(status)) {
      throw new HttpError(400, `لا يمكن إعادة الترحيل المالي لشحنة بالحالة: ${status}. يجب أن تكون الشحنة مؤكدة أو في مرحلة تشغيلية.`);
    }
    const fs = String(shipment.financial_status ?? 'UNPOSTED');
    if (fs === 'POSTED' || fs === 'PARTIALLY_PAID' || fs === 'PAID') {
      return { alreadyPosted: true, message: 'الشحنة مرحلة مالياً بالفعل — لا حاجة لإعادة الترحيل.', shipment };
    }
    await this.financialPosting.ensurePostedFromLifecycle(shipmentId, scope, actorUserId);
    const updated = await this.repository.getById(shipmentId, scope);
    return { alreadyPosted: false, message: 'تمت إعادة الترحيل المالي بنجاح.', shipment: updated };
  }
}
