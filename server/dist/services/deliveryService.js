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
    constructor(repository, financeService) {
        this.repository = repository;
        this.financeService = financeService;
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
            baseAmountUsd: computeBaseAmountUsd(input.originalAmount, input.exchangeRateToUsd),
        };
        const created = await this.repository.create(payload);
        if (created?.status === 'delivered') {
            await this.financeService?.autoGenerateReceiptFromDelivery(created.id, input.operatorUserId, false);
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
        if (updated?.status === 'delivered') {
            await this.financeService?.autoGenerateReceiptFromDelivery(updated.id, input.operatorUserId, false);
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
}
