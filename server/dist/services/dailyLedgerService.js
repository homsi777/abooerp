export class DailyLedgerService {
    repo;
    shipmentPosting;
    constructor(repo, shipmentPosting) {
        this.repo = repo;
        this.shipmentPosting = shipmentPosting;
    }
    listRows(scope, filters) {
        return this.repo.listRows(scope, filters);
    }
    upsertRow(scope, input) {
        return this.repo.upsertRow(scope, input);
    }
    markPosted(scope, input, allowedBranchIds) {
        return this.repo.markPosted(scope, { ...input, userId: scope.userId }, allowedBranchIds);
    }
    markLoadedByShipmentIds(input) {
        return this.repo.markLoadedByShipmentIds(input);
    }
    postPendingShipments(scope, filters, allowedBranchIds) {
        if (!this.shipmentPosting) {
            throw new Error('Daily ledger shipment posting is not configured.');
        }
        return this.shipmentPosting.postPendingShipments(scope, filters, allowedBranchIds);
    }
    deleteRows(scope, rowIds, allowedBranchIds) {
        return this.repo.deleteRows(scope, { rowIds, userId: scope.userId }, allowedBranchIds);
    }
}
