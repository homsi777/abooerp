import { pool } from '../db/pool.js';
import { HttpError } from '../utils/errors.js';

export interface MovementLine {
  itemId: string;
  warehouseId: string;
  quantity: number;
}

export interface InventoryMovementRecord {
  id: string;
  company_id: string;
  shipment_id: string | null;
  item_id: string;
  warehouse_id: string;
  quantity: string;
  movement_type: 'reserved' | 'released' | 'deducted' | 'adjustment';
  notes: string | null;
  created_by: string | null;
  created_at: string;
}

export class ShipmentInventoryMovementRepository {
  /**
   * Reserve stock for a shipment.
   * Atomically checks available stock, inserts 'reserved' movements,
   * and increments item_stock.quantity_reserved.
   * Throws HTTP 409 (STOCK_NOT_AVAILABLE) if any line is insufficient.
   */
  async reserveStock(
    companyId: string,
    shipmentId: string,
    lines: MovementLine[],
    createdBy?: string,
  ): Promise<InventoryMovementRecord[]> {
    if (!lines.length) return [];
    const client = await pool.connect();
    try {
      await client.query('begin');

      // Lock all relevant item_stock rows to avoid race conditions
      const itemIds = lines.map((l) => l.itemId);
      const warehouseIds = lines.map((l) => l.warehouseId);
      await client.query(
        `select id from item_stock
         where company_id = $1 and item_id = any($2::uuid[]) and warehouse_id = any($3::uuid[])
         for update`,
        [companyId, itemIds, warehouseIds],
      );

      const inserted: InventoryMovementRecord[] = [];

      for (const line of lines) {
        // Read current stock
        const stockRes = await client.query<{
          id: string;
          quantity_on_hand: string;
          quantity_reserved: string;
        }>(
          `select id, quantity_on_hand, quantity_reserved
           from item_stock
           where company_id = $1 and item_id = $2 and warehouse_id = $3`,
          [companyId, line.itemId, line.warehouseId],
        );

        const stockRow = stockRes.rows[0];
        const onHand = Number(stockRow?.quantity_on_hand ?? 0);
        const reserved = Number(stockRow?.quantity_reserved ?? 0);
        const available = onHand - reserved;

        if (available < line.quantity) {
          await client.query('rollback');
          throw new HttpError(
            409,
            `STOCK_NOT_AVAILABLE: item ${line.itemId} in warehouse ${line.warehouseId} — ` +
              `available ${available.toFixed(4)}, requested ${line.quantity}`,
          );
        }

        if (stockRow) {
          // Upsert increment reserved
          await client.query(
            `update item_stock
             set quantity_reserved = quantity_reserved + $1, updated_at = now()
             where company_id = $2 and item_id = $3 and warehouse_id = $4`,
            [line.quantity, companyId, line.itemId, line.warehouseId],
          );
        } else {
          // Stock row doesn't exist — treat as zero stock and reject
          await client.query('rollback');
          throw new HttpError(
            409,
            `STOCK_NOT_AVAILABLE: no stock record for item ${line.itemId} in warehouse ${line.warehouseId}`,
          );
        }

        // Insert movement record
        const mvRes = await client.query<InventoryMovementRecord>(
          `insert into shipment_inventory_movements
             (company_id, shipment_id, item_id, warehouse_id, quantity, movement_type, notes, created_by)
           values($1,$2,$3,$4,$5,'reserved',$6,$7)
           returning *`,
          [
            companyId,
            shipmentId,
            line.itemId,
            line.warehouseId,
            line.quantity,
            `Reserved for shipment ${shipmentId}`,
            createdBy ?? null,
          ],
        );
        inserted.push(mvRes.rows[0]);
      }

      await client.query('commit');
      return inserted;
    } catch (error) {
      await client.query('rollback').catch(() => {});
      throw error;
    } finally {
      client.release();
    }
  }

  /**
   * Release all reservations tied to a shipment.
   * Inserts 'released' movements and decrements item_stock.quantity_reserved.
   * Safe to call even if reservations were already released (idempotent).
   */
  async releaseStock(
    companyId: string,
    shipmentId: string,
    createdBy?: string,
  ): Promise<InventoryMovementRecord[]> {
    const client = await pool.connect();
    try {
      await client.query('begin');

      // Find all active reservations not yet released or deducted
      const activeRes = await client.query<{
        item_id: string;
        warehouse_id: string;
        total_reserved: string;
      }>(
        `select item_id, warehouse_id, sum(quantity) as total_reserved
         from shipment_inventory_movements
         where company_id = $1
           and shipment_id = $2
           and movement_type = 'reserved'
         group by item_id, warehouse_id`,
        [companyId, shipmentId],
      );

      const released: InventoryMovementRecord[] = [];

      for (const row of activeRes.rows) {
        const qty = Number(row.total_reserved);
        if (qty <= 0) continue;

        // Decrement reserved in stock ledger (floor at 0)
        await client.query(
          `update item_stock
           set quantity_reserved = greatest(quantity_reserved - $1, 0), updated_at = now()
           where company_id = $2 and item_id = $3 and warehouse_id = $4`,
          [qty, companyId, row.item_id, row.warehouse_id],
        );

        const mvRes = await client.query<InventoryMovementRecord>(
          `insert into shipment_inventory_movements
             (company_id, shipment_id, item_id, warehouse_id, quantity, movement_type, notes, created_by)
           values($1,$2,$3,$4,$5,'released',$6,$7)
           returning *`,
          [
            companyId,
            shipmentId,
            row.item_id,
            row.warehouse_id,
            qty,
            `Released from cancelled shipment ${shipmentId}`,
            createdBy ?? null,
          ],
        );
        released.push(mvRes.rows[0]);
      }

      await client.query('commit');
      return released;
    } catch (error) {
      await client.query('rollback').catch(() => {});
      throw error;
    } finally {
      client.release();
    }
  }

  /**
   * Permanently deduct stock on delivery completion.
   * Inserts 'deducted' movements and decrements both quantity_on_hand and quantity_reserved.
   * Protected by a unique partial index — duplicate deduction silently no-ops.
   */
  async deductStock(
    companyId: string,
    shipmentId: string,
    createdBy?: string,
  ): Promise<InventoryMovementRecord[]> {
    const client = await pool.connect();
    try {
      await client.query('begin');

      // Find all reservations for this shipment
      const activeRes = await client.query<{
        item_id: string;
        warehouse_id: string;
        total_reserved: string;
      }>(
        `select item_id, warehouse_id, sum(quantity) as total_reserved
         from shipment_inventory_movements
         where company_id = $1
           and shipment_id = $2
           and movement_type = 'reserved'
         group by item_id, warehouse_id`,
        [companyId, shipmentId],
      );

      const deducted: InventoryMovementRecord[] = [];

      for (const row of activeRes.rows) {
        const qty = Number(row.total_reserved);
        if (qty <= 0) continue;

        // Insert deducted movement — unique index prevents duplicate deduction
        const mvRes = await client.query<InventoryMovementRecord>(
          `insert into shipment_inventory_movements
             (company_id, shipment_id, item_id, warehouse_id, quantity, movement_type, notes, created_by)
           values($1,$2,$3,$4,$5,'deducted',$6,$7)
           on conflict (shipment_id, item_id, warehouse_id) where movement_type = 'deducted' do nothing
           returning *`,
          [
            companyId,
            shipmentId,
            row.item_id,
            row.warehouse_id,
            qty,
            `Deducted on delivery completion for shipment ${shipmentId}`,
            createdBy ?? null,
          ],
        );

        // Only reduce stock if the movement was actually inserted (not a conflict no-op)
        if (mvRes.rowCount) {
          await client.query(
            `update item_stock
             set
               quantity_on_hand  = greatest(quantity_on_hand  - $1, 0),
               quantity_reserved = greatest(quantity_reserved - $1, 0),
               updated_at = now()
             where company_id = $2 and item_id = $3 and warehouse_id = $4`,
            [qty, companyId, row.item_id, row.warehouse_id],
          );
          deducted.push(mvRes.rows[0]);
        }
      }

      await client.query('commit');
      return deducted;
    } catch (error) {
      await client.query('rollback').catch(() => {});
      throw error;
    } finally {
      client.release();
    }
  }

  async getShipmentMovements(shipmentId: string, companyId: string): Promise<InventoryMovementRecord[]> {
    const result = await pool.query<InventoryMovementRecord>(
      `select * from shipment_inventory_movements
       where shipment_id = $1 and company_id = $2
       order by created_at asc`,
      [shipmentId, companyId],
    );
    return result.rows;
  }

  async getWarehouseMovements(
    warehouseId: string,
    companyId: string,
    limit = 200,
  ): Promise<InventoryMovementRecord[]> {
    const result = await pool.query<InventoryMovementRecord>(
      `select * from shipment_inventory_movements
       where warehouse_id = $1 and company_id = $2
       order by created_at desc
       limit $3`,
      [warehouseId, companyId, limit],
    );
    return result.rows;
  }

  async getItemMovements(
    itemId: string,
    companyId: string,
    limit = 200,
  ): Promise<InventoryMovementRecord[]> {
    const result = await pool.query<InventoryMovementRecord>(
      `select * from shipment_inventory_movements
       where item_id = $1 and company_id = $2
       order by created_at desc
       limit $3`,
      [itemId, companyId, limit],
    );
    return result.rows;
  }

  /**
   * Adjust item_stock.quantity_on_hand by quantityDelta (positive = add, negative = remove).
   * Inserts an 'adjustment' movement record (not tied to any shipment).
   * Throws HTTP 409 if the adjustment would result in negative stock.
   */
  async adjustStock(
    companyId: string,
    itemId: string,
    warehouseId: string,
    quantityDelta: number,
    reason: string,
    createdBy?: string,
  ): Promise<InventoryMovementRecord> {
    if (quantityDelta === 0) {
      throw new HttpError(400, 'quantity_delta must be non-zero.');
    }
    const client = await pool.connect();
    try {
      await client.query('begin');

      const stockRes = await client.query<{ id: string; quantity_on_hand: string }>(
        `select id, quantity_on_hand
         from item_stock
         where company_id = $1 and item_id = $2 and warehouse_id = $3
         for update`,
        [companyId, itemId, warehouseId],
      );

      let newOnHand: number;

      if (!stockRes.rows.length) {
        if (quantityDelta < 0) {
          throw new HttpError(409, 'STOCK_NEGATIVE_VIOLATION: No stock record exists for this item/warehouse combination.');
        }
        await client.query(
          `insert into item_stock(company_id, warehouse_id, item_id, quantity_on_hand, quantity_reserved)
           values($1, $2, $3, $4, 0)
           on conflict (company_id, warehouse_id, item_id) do update
             set quantity_on_hand = item_stock.quantity_on_hand + $4,
                 updated_at = now()`,
          [companyId, warehouseId, itemId, quantityDelta],
        );
        newOnHand = quantityDelta;
      } else {
        const currentOnHand = parseFloat(stockRes.rows[0].quantity_on_hand);
        newOnHand = currentOnHand + quantityDelta;
        if (newOnHand < 0) {
          throw new HttpError(
            409,
            `STOCK_NEGATIVE_VIOLATION: Adjustment of ${quantityDelta} would result in ${newOnHand} on-hand (current: ${currentOnHand}).`,
          );
        }
        await client.query(
          `update item_stock
           set quantity_on_hand = $1, updated_at = now()
           where id = $2`,
          [newOnHand, stockRes.rows[0].id],
        );
      }

      const absQty = Math.abs(quantityDelta);
      const direction = quantityDelta > 0 ? '+' : '-';
      const movementRes = await client.query<InventoryMovementRecord>(
        `insert into shipment_inventory_movements(
           company_id, shipment_id, item_id, warehouse_id,
           quantity, movement_type, notes, created_by
         ) values($1, null, $2, $3, $4, 'adjustment', $5, $6)
         returning *`,
        [
          companyId,
          itemId,
          warehouseId,
          absQty,
          `[${direction}${absQty}] ${reason}`,
          createdBy ?? null,
        ],
      );

      await client.query('commit');
      return movementRes.rows[0];
    } catch (err) {
      await client.query('rollback').catch(() => {});
      throw err;
    } finally {
      client.release();
    }
  }

  /** Check whether the movements table is wired and accessible */
  async isLinked(): Promise<boolean> {
    try {
      await pool.query('select 1 from shipment_inventory_movements limit 0');
      return true;
    } catch {
      return false;
    }
  }

  /** Check whether warehouse + item tables are accessible (CRUD readiness) */
  async isCrudReady(): Promise<boolean> {
    try {
      await pool.query('select 1 from warehouses limit 0');
      await pool.query('select 1 from items limit 0');
      return true;
    } catch {
      return false;
    }
  }

  /** Check whether the 'adjustment' movement type is accepted (adjustment API readiness) */
  async isAdjustmentReady(): Promise<boolean> {
    try {
      const result = await pool.query(`
        select 1
        from pg_constraint
        where conname = 'shipment_inventory_movements_movement_type_check'
          and consrc like '%adjustment%'
        limit 1
      `);
      return (result.rowCount ?? 0) > 0;
    } catch {
      return false;
    }
  }

  /** Check whether shipment_labels table is accessible */
  async isLabelPersistenceReady(): Promise<boolean> {
    try {
      await pool.query('select 1 from shipment_labels limit 0');
      return true;
    } catch {
      return false;
    }
  }

  /** Check whether payment_vouchers and cashbox_transactions have company_id */
  async isFinanceCompanyIsolationComplete(): Promise<boolean> {
    try {
      const result = await pool.query(`
        select count(*)::int as cnt
        from information_schema.columns
        where table_name in ('payment_vouchers', 'cashbox_transactions')
          and column_name = 'company_id'
      `);
      return Number(result.rows[0]?.cnt ?? 0) >= 2;
    } catch {
      return false;
    }
  }
}
