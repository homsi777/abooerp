import { computeBaseAmountUsd } from '../utils/money.js';
import { HttpError } from '../utils/errors.js';
const allowedDeliveryTransitions = {
    pending: ['delivered', 'failed', 'returned'],
    failed: ['pending', 'returned'],
    returned: [],
    delivered: [],
};
export class DeliveryService {
    repository;
    financeService;
    inventoryService;
    constructor(repository, financeService, inventoryService) {
        this.repository = repository;
        this.financeService = financeService;
        this.inventoryService = inventoryService;
    }
    list(scope) {
        return this.repository.list(scope);
    }
    getById(id, scope) {
        return this.repository.getById(id, scope);
    }
    async create(input, scope) {
        if (scope?.branchId && input.branchId && input.branchId !== scope.branchId) {
            throw new HttpError(403, 'Cannot create delivery outside scoped branch.');
        }
        if (scope?.agentId && input.agentId && input.agentId !== scope.agentId) {
            throw new HttpError(403, 'Cannot create delivery outside scoped agent.');
        }
        const payload = {
            ...input,
            companyId: input.companyId ?? scope?.companyId,
            baseAmountUsd: computeBaseAmountUsd(input.originalAmount, input.exchangeRateToUsd),
        };
        const created = await this.repository.create(payload);
        if (created?.status === 'delivered') {
            await this._handleDeliveredPostProcessing(created.id, created.shipment_id, created.company_id ?? payload.companyId, input.operatorUserId);
        }
        return created;
    }
    async update(id, input, scope) {
        if (input.status) {
            const existing = await this.repository.getById(id, scope);
            if (!existing) {
                return null;
            }
            const currentStatus = existing.status;
            const nextStatus = input.status;
            if (currentStatus !== nextStatus && !allowedDeliveryTransitions[currentStatus]?.includes(nextStatus)) {
                throw new HttpError(400, `Invalid delivery status transition: ${currentStatus} -> ${nextStatus}`);
            }
        }
        if (scope?.branchId && input.branchId && input.branchId !== scope.branchId) {
            throw new HttpError(403, 'Cannot move delivery outside scoped branch.');
        }
        if (scope?.agentId && input.agentId && input.agentId !== scope.agentId) {
            throw new HttpError(403, 'Cannot move delivery outside scoped agent.');
        }
        const payload = { ...input };
        if (typeof input.originalAmount === 'number' && typeof input.exchangeRateToUsd === 'number') {
            payload.baseAmountUsd = computeBaseAmountUsd(input.originalAmount, input.exchangeRateToUsd);
        }
        const updated = await this.repository.update(id, payload);
        if (!updated && input.expectedUpdatedAt) {
            const latest = await this.repository.getById(id, scope);
            if (latest) {
                throw new HttpError(409, 'Delivery was modified by another operation. Reload and retry.');
            }
        }
        if (updated?.status === 'delivered') {
            await this._handleDeliveredPostProcessing(updated.id, updated.shipment_id, updated.company_id ?? scope?.companyId, input.operatorUserId);
        }
        return updated;
    }
    async remove(id, scope) {
        if (scope?.branchId || scope?.agentId) {
            const existing = await this.repository.getById(id, scope);
            if (!existing) {
                return false;
            }
        }
        return this.repository.remove(id);
    }
    /**
     * Post-processing when a delivery reaches 'delivered' status.
     * Stock deduction is attempted FIRST. If it fails, delivery completion is
     * aborted with HTTP 409 STOCK_DEDUCTION_FAILED — guaranteeing that finance
     * posting cannot succeed without a successful inventory deduction.
     */
    async _handleDeliveredPostProcessing(deliveryId, shipmentId, companyId, operatorUserId) {
        if (this.inventoryService && companyId) {
            try {
                await this.inventoryService.deductStock(companyId, shipmentId, operatorUserId);
            }
            catch (err) {
                console.error('[DeliveryService] Stock deduction failed — aborting delivery completion:', err?.message);
                throw new HttpError(409, 'STOCK_DEDUCTION_FAILED');
            }
        }
        await this.financeService?.autoGenerateReceiptFromDelivery(deliveryId, operatorUserId, false);
    }
}
