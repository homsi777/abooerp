import { ShipmentInventoryMovementRepository, } from '../repositories/shipmentInventoryMovementRepository.js';
export class InventoryService {
    repository;
    constructor(repository = new ShipmentInventoryMovementRepository()) {
        this.repository = repository;
    }
    /**
     * Reserve stock for all inventory lines attached to a shipment.
     * Returns the created movement records.
     * Throws HTTP 409 STOCK_NOT_AVAILABLE if any line cannot be fulfilled.
     */
    reserveStock(companyId, shipmentId, lines, createdBy) {
        return this.repository.reserveStock(companyId, shipmentId, lines, createdBy);
    }
    /**
     * Release all active reservations for a shipment (on cancellation).
     * Safe to call multiple times — idempotent at the aggregate level.
     */
    releaseStock(companyId, shipmentId, createdBy) {
        return this.repository.releaseStock(companyId, shipmentId, createdBy);
    }
    /**
     * Permanently deduct stock on delivery completion.
     * Protected by DB unique index — duplicate deduction is silently ignored.
     */
    deductStock(companyId, shipmentId, createdBy) {
        return this.repository.deductStock(companyId, shipmentId, createdBy);
    }
    /**
     * Adjust on-hand stock directly (admin correction, write-off, receipt).
     * quantityDelta may be positive (increase) or negative (decrease).
     * Throws HTTP 409 on negative-stock violation.
     */
    adjustStock(companyId, itemId, warehouseId, quantityDelta, reason, createdBy) {
        return this.repository.adjustStock(companyId, itemId, warehouseId, quantityDelta, reason, createdBy);
    }
    getShipmentMovements(shipmentId, companyId) {
        return this.repository.getShipmentMovements(shipmentId, companyId);
    }
    getWarehouseMovements(warehouseId, companyId, limit) {
        return this.repository.getWarehouseMovements(warehouseId, companyId, limit);
    }
    getItemMovements(itemId, companyId, limit) {
        return this.repository.getItemMovements(itemId, companyId, limit);
    }
    isLinked() {
        return this.repository.isLinked();
    }
    isCrudReady() {
        return this.repository.isCrudReady();
    }
    isAdjustmentReady() {
        return this.repository.isAdjustmentReady();
    }
    isLabelPersistenceReady() {
        return this.repository.isLabelPersistenceReady();
    }
    isFinanceCompanyIsolationComplete() {
        return this.repository.isFinanceCompanyIsolationComplete();
    }
}
