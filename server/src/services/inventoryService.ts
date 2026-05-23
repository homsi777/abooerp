import {
  ShipmentInventoryMovementRepository,
  type MovementLine,
  type InventoryMovementRecord,
} from '../repositories/shipmentInventoryMovementRepository.js';

export type { MovementLine, InventoryMovementRecord };

export class InventoryService {
  constructor(
    private readonly repository = new ShipmentInventoryMovementRepository(),
  ) {}

  /**
   * Reserve stock for all inventory lines attached to a shipment.
   * Returns the created movement records.
   * Throws HTTP 409 STOCK_NOT_AVAILABLE if any line cannot be fulfilled.
   */
  reserveStock(
    companyId: string,
    shipmentId: string,
    lines: MovementLine[],
    createdBy?: string,
  ): Promise<InventoryMovementRecord[]> {
    return this.repository.reserveStock(companyId, shipmentId, lines, createdBy);
  }

  /**
   * Release all active reservations for a shipment (on cancellation).
   * Safe to call multiple times — idempotent at the aggregate level.
   */
  releaseStock(
    companyId: string,
    shipmentId: string,
    createdBy?: string,
  ): Promise<InventoryMovementRecord[]> {
    return this.repository.releaseStock(companyId, shipmentId, createdBy);
  }

  /**
   * Permanently deduct stock on delivery completion.
   * Protected by DB unique index — duplicate deduction is silently ignored.
   */
  deductStock(
    companyId: string,
    shipmentId: string,
    createdBy?: string,
  ): Promise<InventoryMovementRecord[]> {
    return this.repository.deductStock(companyId, shipmentId, createdBy);
  }

  /**
   * Adjust on-hand stock directly (admin correction, write-off, receipt).
   * quantityDelta may be positive (increase) or negative (decrease).
   * Throws HTTP 409 on negative-stock violation.
   */
  adjustStock(
    companyId: string,
    itemId: string,
    warehouseId: string,
    quantityDelta: number,
    reason: string,
    createdBy?: string,
  ): Promise<InventoryMovementRecord> {
    return this.repository.adjustStock(companyId, itemId, warehouseId, quantityDelta, reason, createdBy);
  }

  getShipmentMovements(shipmentId: string, companyId: string) {
    return this.repository.getShipmentMovements(shipmentId, companyId);
  }

  getWarehouseMovements(warehouseId: string, companyId: string, limit?: number) {
    return this.repository.getWarehouseMovements(warehouseId, companyId, limit);
  }

  getItemMovements(itemId: string, companyId: string, limit?: number) {
    return this.repository.getItemMovements(itemId, companyId, limit);
  }

  isLinked(): Promise<boolean> {
    return this.repository.isLinked();
  }

  isCrudReady(): Promise<boolean> {
    return this.repository.isCrudReady();
  }

  isAdjustmentReady(): Promise<boolean> {
    return this.repository.isAdjustmentReady();
  }

  isLabelPersistenceReady(): Promise<boolean> {
    return this.repository.isLabelPersistenceReady();
  }

  isFinanceCompanyIsolationComplete(): Promise<boolean> {
    return this.repository.isFinanceCompanyIsolationComplete();
  }
}
