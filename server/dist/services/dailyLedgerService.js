import { HttpError } from '../utils/errors.js';
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
    async upsertRow(scope, input) {
        const row = await this.repo.upsertRow(scope, input);
        if (this.shipmentPosting && row.posted_shipment_id && !row.loaded_at) {
            try {
                await this.shipmentPosting.syncPostedShipmentFromLedgerRow(scope, row.id);
            }
            catch (error) {
                const detail = error instanceof Error ? error.message : 'تعذر تحديث الشحنة المرتبطة.';
                throw new HttpError(409, `تم حفظ سطر الدفتر، لكن ${detail}`);
            }
        }
        return row;
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
