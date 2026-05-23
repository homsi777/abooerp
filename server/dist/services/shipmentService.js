import { computeBaseAmountUsd } from '../utils/money.js';
import { HttpError } from '../utils/errors.js';
const allowedShipmentTransitions = {
    created: ['in_transit', 'manifested', 'cancelled'],
    in_transit: ['manifested', 'delivered', 'cancelled'],
    manifested: ['in_transit', 'delivered', 'cancelled'],
    delivered: [],
    cancelled: [],
};
export class ShipmentService {
    repository;
    constructor(repository) {
        this.repository = repository;
    }
    list(scope) {
        return this.repository.list(scope);
    }
    getById(id, scope) {
        return this.repository.getById(id, scope);
    }
    create(input, scope) {
        if (scope?.branchId && input.branchId !== scope.branchId) {
            throw new HttpError(403, 'Cannot create shipment outside scoped branch.');
        }
        if (scope?.agentId && input.agentId && input.agentId !== scope.agentId) {
            throw new HttpError(403, 'Cannot create shipment outside scoped agent.');
        }
        const payload = {
            ...input,
            baseAmountUsd: computeBaseAmountUsd(input.originalAmount, input.exchangeRateToUsd),
        };
        return this.repository.create(payload);
    }
    async update(id, input, scope) {
        if (input.status) {
            const existing = await this.repository.getById(id, scope);
            if (!existing) {
                return null;
            }
            const currentStatus = existing.status;
            const nextStatus = input.status;
            if (currentStatus !== nextStatus && !allowedShipmentTransitions[currentStatus]?.includes(nextStatus)) {
                throw new HttpError(400, `Invalid shipment status transition: ${currentStatus} -> ${nextStatus}`);
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
        const updated = await this.repository.update(id, payload);
        if (!updated && input.expectedUpdatedAt) {
            const latest = await this.repository.getById(id, scope);
            if (latest) {
                throw new HttpError(409, 'Shipment was modified by another operation. Reload and retry.');
            }
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
