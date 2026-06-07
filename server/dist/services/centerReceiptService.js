import { HttpError } from '../utils/errors.js';
export class CenterReceiptService {
    repository;
    constructor(repository) {
        this.repository = repository;
    }
    list(scope) {
        return this.repository.list(scope);
    }
    listProvincialInbound(scope, filters) {
        return this.repository.listProvincialInbound(scope, filters);
    }
    listVehicleTripReport(scope, filters) {
        return this.repository.listVehicleTripReport(scope, filters);
    }
    async create(input, scope) {
        if (scope?.branchId && input.branchId && input.branchId !== scope.branchId) {
            throw new HttpError(403, 'Cannot receive shipment outside scoped branch.');
        }
        if (scope?.agentId && input.agentId && input.agentId !== scope.agentId) {
            throw new HttpError(403, 'Cannot receive shipment outside scoped agent.');
        }
        return this.repository.create({
            ...input,
            companyId: input.companyId ?? scope?.companyId,
        });
    }
}
