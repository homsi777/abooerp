import { computeBaseAmountUsd } from '../utils/money.js';
import { pool } from '../db/pool.js';
import { resolveAgentDestinationLabel } from '../utils/agentDestination.js';
import { HttpError } from '../utils/errors.js';
import { canTransitionShipmentStatus, normalizeShipmentStatus, SHIPMENT_TRANSITIONS, TERMINAL_SHIPMENT_STATUSES, } from '../domain/shipmentStatus.js';
import { computeAgentCommissionSnapshot } from '../utils/shipmentAgentCommission.js';
export class ShipmentService {
    repository;
    inventoryService;
    financialPosting;
    transfersService;
    agentRepository;
    constructor(repository, inventoryService, financialPosting, transfersService, agentRepository) {
        this.repository = repository;
        this.inventoryService = inventoryService;
        this.financialPosting = financialPosting;
        this.transfersService = transfersService;
        this.agentRepository = agentRepository;
    }
    list(scope, filters) {
        return this.repository.list(scope, filters);
    }
    async getById(id, scope) {
        const shipment = await this.repository.getById(id, scope);
        if (!shipment && (scope?.branchId || scope?.agentId) && await this.repository.existsInCompany(id, scope.companyId)) {
            throw new HttpError(403, 'غير مسموح بعرض هذه الشحنة ضمن نطاق المستخدم الحالي.');
        }
        return shipment;
    }
    async resolveSenderReceiverNames(senderId, receiverId) {
        let senderDisplay = 'غير معروف';
        let receiverDisplay = 'غير معروف';
        try {
            const partyResult = await pool.query(`select id, full_name from senders_receivers where id = any($1::uuid[])`, [[senderId, receiverId]]);
            for (const row of partyResult.rows) {
                if (String(row.id) === String(senderId))
                    senderDisplay = row.full_name;
                if (String(row.id) === String(receiverId))
                    receiverDisplay = row.full_name;
            }
        }
        catch {
            /* optional */
        }
        return { senderDisplay, receiverDisplay };
    }
    async syncShipmentLinkedTransfer(shipment, input, transferDate) {
        if (!this.transfersService)
            return;
        const companyId = String(shipment.company_id ?? input.companyId ?? '');
        if (!companyId)
            return;
        const hawalaAmount = Number(typeof input.hawalaAmount === 'number' ? input.hawalaAmount : shipment.hawala_amount ?? 0);
        const transferServiceFee = Number(typeof input.transferServiceFee === 'number'
            ? input.transferServiceFee
            : shipment.transfer_service_fee ?? 0);
        if (hawalaAmount <= 0 && transferServiceFee <= 0)
            return;
        const agentId = String(input.agentId ?? shipment.agent_id ?? '');
        if (!agentId)
            return;
        const senderId = String(input.senderId ?? shipment.sender_id ?? '');
        const receiverId = String(input.receiverId ?? shipment.receiver_id ?? '');
        const names = senderId && receiverId
            ? await this.resolveSenderReceiverNames(senderId, receiverId)
            : { senderDisplay: 'غير معروف', receiverDisplay: 'غير معروف' };
        const payload = {
            companyId,
            branchId: String(input.branchId ?? shipment.branch_id ?? '') || undefined,
            agentId,
            destinationCity: String(input.destinationCity ?? shipment.destination_city ?? '') || undefined,
            shipmentId: String(shipment.id),
            shipmentNo: String(shipment.shipment_no ?? input.shipmentNo ?? ''),
            senderName: names.senderDisplay,
            receiverName: names.receiverDisplay,
            hawalaAmount,
            transferServiceFee,
            currency: String(input.originalCurrency ?? shipment.original_currency ?? 'USD'),
            exchangeRateToUsd: Number(input.exchangeRateToUsd ?? shipment.exchange_rate_to_usd ?? 1) || 1,
            transferDate: transferDate ??
                (typeof input.effectiveDate === 'string' ? input.effectiveDate : undefined) ??
                (shipment.effective_date ? String(shipment.effective_date).slice(0, 10) : undefined),
        };
        await this.transfersService.ensureShipmentLinkedTransfer(payload);
    }
    async create(input, scope, options) {
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
                : normalizeShipmentStatus(input.status)),
            companyId: effectiveCompanyId,
            baseAmountUsd: computeBaseAmountUsd(input.originalAmount, input.exchangeRateToUsd),
        };
        if (!payload.agentId && this.agentRepository && effectiveCompanyId && payload.destinationCity?.trim()) {
            try {
                const agent = await this.agentRepository.resolveAgentForDestination(effectiveCompanyId, payload.destinationCity);
                payload.agentId = agent.id;
                payload.destinationCity = resolveAgentDestinationLabel(agent) || payload.destinationCity;
            }
            catch {
                /* keep destination without auto agent when ambiguous */
            }
        }
        if (payload.agentId && this.agentRepository && effectiveCompanyId) {
            try {
                const agent = await this.agentRepository.getAgentById(payload.agentId, effectiveCompanyId);
                Object.assign(payload, computeAgentCommissionSnapshot({
                    freightCharge: payload.freightCharge,
                    transferFee: payload.transferFee,
                    commissionPercentage: agent?.commission_percentage ?? 0,
                }));
            }
            catch {
                Object.assign(payload, computeAgentCommissionSnapshot({
                    freightCharge: payload.freightCharge,
                    transferFee: payload.transferFee,
                    commissionPercentage: 0,
                }));
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
                await this.financialPosting.postShipmentConfirmationFinancials({
                    client,
                    shipmentId: created.id,
                    scope,
                    userContext: uc,
                    financial: options?.financial ??
                        {
                            paymentMode: 'UNPAID',
                            payerPartyKind: payload.payerPartyKind ?? 'RECEIVER',
                        },
                    shipmentRow: created,
                    effectiveDate: options?.effectiveDate ?? input.effectiveDate,
                });
                await client.query('commit');
            }
            catch (e) {
                await client.query('rollback');
                throw e;
            }
            finally {
                client.release();
            }
        }
        else {
            created = await this.repository.create(payload);
        }
        // Reserve inventory with the real shipment ID.
        // If reservation fails (STOCK_NOT_AVAILABLE or any error), soft-delete the
        // shipment so the system stays consistent, then re-throw to the caller.
        if (this.inventoryService && effectiveCompanyId && input.inventoryItems?.length) {
            try {
                await this.inventoryService.reserveStock(effectiveCompanyId, created.id, input.inventoryItems, input.createdBy);
            }
            catch (inventoryError) {
                await this.repository.remove(created.id, { companyId: effectiveCompanyId }).catch(() => { });
                throw inventoryError;
            }
        }
        if (this.transfersService
            && effectiveCompanyId
            && (Number(payload.hawalaAmount ?? 0) > 0 || Number(payload.transferServiceFee ?? 0) > 0)) {
            try {
                await this.syncShipmentLinkedTransfer(created, payload, options?.effectiveDate ?? input.effectiveDate);
            }
            catch (error) {
                console.error('[ShipmentService] failed to ensure shipment-linked transfer', error);
            }
        }
        return created;
    }
    async update(id, input, scope) {
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
        const nextAgentId = payload.agentId ?? existing?.agent_id ?? undefined;
        const needsCommissionRefresh = typeof payload.freightCharge === 'number'
            || typeof payload.transferFee === 'number'
            || typeof payload.agentId === 'string'
            || existing?.agent_commission_amount_snapshot == null;
        if (needsCommissionRefresh && nextAgentId && this.agentRepository) {
            const companyId = existing?.company_id ?? scope?.companyId;
            if (companyId) {
                try {
                    const agent = await this.agentRepository.getAgentById(nextAgentId, companyId);
                    Object.assign(payload, computeAgentCommissionSnapshot({
                        freightCharge: payload.freightCharge ?? existing?.freight_charge,
                        transferFee: payload.transferFee ?? existing?.transfer_fee,
                        commissionPercentage: agent?.commission_percentage ?? 0,
                    }));
                }
                catch {
                    Object.assign(payload, computeAgentCommissionSnapshot({
                        freightCharge: payload.freightCharge ?? existing?.freight_charge,
                        transferFee: payload.transferFee ?? existing?.transfer_fee,
                        commissionPercentage: 0,
                    }));
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
        if (updated &&
            this.financialPosting &&
            input.status &&
            typeof input.status === 'string') {
            const prevStatus = normalizeShipmentStatus(String(existing.status));
            const nextStatus = normalizeShipmentStatus(String(input.status));
            if (prevStatus !== nextStatus &&
                (nextStatus === 'DELIVERED' || nextStatus === 'CONFIRMED')) {
                await this.financialPosting.ensurePostedFromLifecycle(id, scope, scope?.userId);
            }
        }
        if (updated &&
            (typeof input.hawalaAmount === 'number' ||
                typeof input.transferServiceFee === 'number' ||
                Number(updated.hawala_amount ?? 0) > 0)) {
            try {
                await this.syncShipmentLinkedTransfer(updated, payload, payload.effectiveDate);
            }
            catch (error) {
                console.error('[ShipmentService] failed to sync shipment-linked transfer on update', error);
            }
        }
        return updated;
    }
    async remove(id, scope) {
        const existing = await this.repository.getById(id, scope);
        if (!existing) {
            if ((scope?.branchId || scope?.agentId) && await this.repository.existsInCompany(id, scope.companyId)) {
                throw new HttpError(403, 'غير مسموح بحذف هذه الشحنة ضمن نطاق المستخدم الحالي.');
            }
            return false;
        }
        return this.repository.remove(id, scope);
    }
    async listStatusHistory(shipmentId, scope) {
        const existing = await this.repository.getById(shipmentId, scope);
        if (!existing) {
            if ((scope?.branchId || scope?.agentId) && await this.repository.existsInCompany(shipmentId, scope.companyId)) {
                throw new HttpError(403, 'غير مسموح بعرض سجل هذه الشحنة ضمن نطاق المستخدم الحالي.');
            }
            return [];
        }
        return this.repository.listStatusHistory(shipmentId, scope);
    }
    async confirmWithFinancials(input) {
        if (!this.financialPosting) {
            throw new HttpError(500, 'خدمة الترحيل المالي غير مهيأة.');
        }
        const client = await pool.connect();
        try {
            await client.query('begin');
            const locked = await this.repository.lockShipmentForUpdate(client, input.shipmentId, input.scope);
            if (!locked) {
                await client.query('rollback');
                if (input.scope &&
                    (await this.repository.existsInCompany(input.shipmentId, input.scope.companyId))) {
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
                throw new HttpError(400, `لا يمكن تأكيد الشحنة من الحالة الحالية. الحالات المسموحة: ${allowed}`);
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
        }
        catch (error) {
            await client.query('rollback');
            throw error;
        }
        finally {
            client.release();
        }
    }
    async transitionStatus(input) {
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
        if (this.financialPosting &&
            (input.nextStatus === 'DELIVERED' || input.nextStatus === 'CONFIRMED')) {
            await this.financialPosting.ensurePostedFromLifecycle(input.shipmentId, input.scope, input.changedBy ?? input.scope?.userId);
        }
        return changed.updated;
    }
    getShipmentFinancialCard(id, scope) {
        if (!this.financialPosting) {
            throw new HttpError(500, 'خدمة الترحيل المالي غير مهيأة.');
        }
        return this.financialPosting.getShipmentFinancialCard(id, scope);
    }
    recordShipmentPayment(shipmentId, input, scope, actorUserId) {
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
    recalculateShipmentPaymentStatus(shipmentId) {
        if (!this.financialPosting) {
            throw new HttpError(500, 'خدمة الترحيل المالي غير مهيأة.');
        }
        return this.financialPosting.recalculateShipmentPaymentStatus(shipmentId);
    }
    async repostFinancials(shipmentId, scope, actorUserId) {
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
