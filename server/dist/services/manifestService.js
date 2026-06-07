import { HttpError } from '../utils/errors.js';
const allowedManifestTransitions = {
    created: ['dispatched', 'cancelled'],
    dispatched: ['closed', 'cancelled'],
    closed: [],
    cancelled: [],
};
export class ManifestService {
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
    listLoadableShipments(scope, filters) {
        return this.repository.listLoadableShipments(scope, filters);
    }
    create(input, scope) {
        if (scope?.branchId && input.branchId !== scope.branchId) {
            throw new HttpError(403, 'Cannot create manifest outside scoped branch.');
        }
        const payload = { ...input, companyId: input.companyId ?? scope?.companyId };
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
            if (currentStatus !== nextStatus && !allowedManifestTransitions[currentStatus]?.includes(nextStatus)) {
                throw new HttpError(400, `Invalid manifest status transition: ${currentStatus} -> ${nextStatus}`);
            }
        }
        if (scope?.branchId && input.branchId && input.branchId !== scope.branchId) {
            throw new HttpError(403, 'Cannot move manifest outside scoped branch.');
        }
        const updated = await this.repository.update(id, input);
        if (!updated && input.expectedUpdatedAt) {
            const latest = await this.repository.getById(id, scope);
            if (latest) {
                throw new HttpError(409, 'Manifest was modified by another operation. Reload and retry.');
            }
        }
        return updated;
    }
    async remove(id, scope) {
        if (scope?.branchId) {
            const existing = await this.repository.getById(id, scope);
            if (!existing) {
                return false;
            }
        }
        return this.repository.remove(id);
    }
}
