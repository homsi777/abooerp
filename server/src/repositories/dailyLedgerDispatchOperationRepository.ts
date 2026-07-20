import type { PoolClient } from 'pg';
import { pool } from '../db/pool.js';
import { HttpError } from '../utils/errors.js';
import type { DataScope } from '../utils/scope.js';

export type DispatchOperationStatus =
  | 'PROCESSING'
  | 'COMPLETED'
  | 'PARTIAL'
  | 'FAILED'
  | 'UNDONE';

export type DispatchOperationRecord = {
  id: string;
  company_id: string;
  branch_id: string;
  dispatch_id: string | null;
  save_log_id: string | null;
  operation_type: string;
  status: DispatchOperationStatus;
  idempotency_key: string | null;
  undo_of_operation_id: string | null;
  ledger_date: string;
  line_label: string;
  origin_label: string | null;
  driver_id: string | null;
  vehicle_id: string | null;
  driver_label: string | null;
  vehicle_label: string | null;
  trip_no: string | null;
  save_mode: string | null;
  request_summary: Record<string, unknown>;
  result_summary: Record<string, unknown>;
  created_by: string | null;
  completed_at: string | null;
  cancelled_at: string | null;
  cancelled_by: string | null;
  cancellation_reason: string | null;
  created_at: string;
  updated_at: string;
};

export type DispatchOperationRowRecord = {
  id: string;
  operation_id: string;
  row_id: string;
  row_existed_before: boolean;
  before_session_id: string | null;
  before_row_no: number | null;
  before_dispatch_id: string | null;
  before_branch_id: string | null;
  before_ledger_date: string | null;
  before_line_label: string | null;
  before_driver_id: string | null;
  before_vehicle_id: string | null;
  before_driver_label: string | null;
  before_vehicle_label: string | null;
  before_trip_no: string | null;
  before_posted_shipment_id: string | null;
  before_updated_at: string | null;
  after_session_id: string | null;
  after_row_no: number | null;
  after_dispatch_id: string | null;
  after_branch_id: string | null;
  after_ledger_date: string | null;
  after_line_label: string | null;
  after_driver_id: string | null;
  after_vehicle_id: string | null;
  after_driver_label: string | null;
  after_vehicle_label: string | null;
  after_trip_no: string | null;
  after_posted_shipment_id: string | null;
  after_updated_at: string | null;
  shipment_id: string | null;
  shipment_disposition: 'CREATED' | 'REUSED' | 'EXISTING_POSTED' | null;
  financial_posted_by_operation: boolean;
  linked_transfer_id: string | null;
  before_snapshot: Record<string, unknown>;
  after_snapshot: Record<string, unknown>;
};

export type BeginDispatchOperationInput = {
  branchId: string;
  ledgerDate: string;
  lineLabel: string;
  originLabel?: string | null;
  driverId?: string | null;
  vehicleId?: string | null;
  driverLabel?: string | null;
  vehicleLabel?: string | null;
  tripNo?: string | null;
  saveMode?: 'all' | 'custom';
  dispatchId?: string | null;
  idempotencyKey?: string | null;
  existingRowIds?: string[];
};

type RowLocationSnapshot = {
  id: string;
  session_id: string;
  row_no: number;
  dispatch_id: string | null;
  posted_shipment_id: string | null;
  updated_at: string;
  receipt_no: string | null;
  branch_id: string;
  ledger_date: string;
  line_label: string;
  driver_id: string | null;
  vehicle_id: string | null;
  driver_label: string | null;
  vehicle_label: string | null;
  trip_no: string | null;
};

export class DailyLedgerDispatchOperationRepository {
  async begin(scope: DataScope, input: BeginDispatchOperationInput): Promise<DispatchOperationRecord> {
    if (!scope.companyId) throw new HttpError(400, 'Company scope is required.');

    if (input.idempotencyKey) {
      const existing = await pool.query<DispatchOperationRecord>(
        `
        select *
        from daily_ledger_dispatch_operations
        where company_id = $1::uuid and idempotency_key = $2
        limit 1
        `,
        [scope.companyId, input.idempotencyKey],
      );
      if (existing.rows[0]) return existing.rows[0];
    }

    const client = await pool.connect();
    try {
      await client.query('begin');

      const opResult = await client.query<DispatchOperationRecord>(
        `
        insert into daily_ledger_dispatch_operations (
          company_id, branch_id, dispatch_id, operation_type, status, idempotency_key,
          ledger_date, line_label, origin_label, driver_id, vehicle_id, driver_label,
          vehicle_label, trip_no, save_mode, request_summary, created_by
        )
        values (
          $1, $2, $3, 'SAVE', 'PROCESSING', $4,
          $5::date, $6, $7, $8, $9, $10,
          $11, $12, $13, $14::jsonb, $15
        )
        returning *
        `,
        [
          scope.companyId,
          input.branchId,
          input.dispatchId ?? null,
          input.idempotencyKey ?? null,
          input.ledgerDate,
          input.lineLabel,
          input.originLabel ?? null,
          input.driverId ?? null,
          input.vehicleId ?? null,
          input.driverLabel ?? null,
          input.vehicleLabel ?? null,
          input.tripNo ?? null,
          input.saveMode ?? 'all',
          JSON.stringify({ existingRowIds: input.existingRowIds ?? [] }),
          scope.userId ?? null,
        ],
      );
      const operation = opResult.rows[0];

      const existingIds = (input.existingRowIds ?? []).filter(Boolean);
      if (existingIds.length) {
        const locations = await client.query<RowLocationSnapshot>(
          `
          select
            r.id,
            r.session_id,
            r.row_no,
            r.dispatch_id,
            r.posted_shipment_id,
            r.updated_at::text as updated_at,
            r.receipt_no,
            s.branch_id,
            s.ledger_date::text as ledger_date,
            s.line_label,
            s.driver_id,
            s.vehicle_id,
            s.driver_label,
            s.vehicle_label,
            s.trip_no
          from daily_ledger_rows r
          join daily_ledger_sessions s on s.id = r.session_id
          where r.deleted_at is null
            and s.deleted_at is null
            and s.company_id = $1::uuid
            and r.id = any($2::uuid[])
          `,
          [scope.companyId, existingIds],
        );

        for (const loc of locations.rows) {
          await client.query(
            `
            insert into daily_ledger_dispatch_operation_rows (
              operation_id, row_id, row_existed_before,
              before_session_id, before_row_no, before_dispatch_id, before_branch_id,
              before_ledger_date, before_line_label, before_driver_id, before_vehicle_id,
              before_driver_label, before_vehicle_label, before_trip_no,
              before_posted_shipment_id, before_updated_at, before_snapshot
            )
            values (
              $1, $2, true,
              $3, $4, $5, $6,
              $7::date, $8, $9, $10,
              $11, $12, $13,
              $14, $15::timestamptz, $16::jsonb
            )
            on conflict (operation_id, row_id) do nothing
            `,
            [
              operation.id,
              loc.id,
              loc.session_id,
              loc.row_no,
              loc.dispatch_id,
              loc.branch_id,
              loc.ledger_date,
              loc.line_label,
              loc.driver_id,
              loc.vehicle_id,
              loc.driver_label,
              loc.vehicle_label,
              loc.trip_no,
              loc.posted_shipment_id,
              loc.updated_at,
              JSON.stringify(loc),
            ],
          );
        }
      }

      await client.query('commit');
      return operation;
    } catch (error) {
      await client.query('rollback');
      throw error;
    } finally {
      client.release();
    }
  }

  async getById(scope: DataScope, id: string): Promise<DispatchOperationRecord | null> {
    if (!scope.companyId) throw new HttpError(400, 'Company scope is required.');
    const result = await pool.query<DispatchOperationRecord>(
      `
      select *, ledger_date::text as ledger_date, created_at::text as created_at, updated_at::text as updated_at
      from daily_ledger_dispatch_operations
      where id = $1::uuid and company_id = $2::uuid
      limit 1
      `,
      [id, scope.companyId],
    );
    return result.rows[0] ?? null;
  }

  async getBySaveLogId(scope: DataScope, saveLogId: string): Promise<DispatchOperationRecord | null> {
    if (!scope.companyId) throw new HttpError(400, 'Company scope is required.');
    const result = await pool.query<DispatchOperationRecord>(
      `
      select *, ledger_date::text as ledger_date, created_at::text as created_at, updated_at::text as updated_at
      from daily_ledger_dispatch_operations
      where save_log_id = $1::uuid and company_id = $2::uuid
      order by created_at desc
      limit 1
      `,
      [saveLogId, scope.companyId],
    );
    return result.rows[0] ?? null;
  }

  async listRows(operationId: string, client?: PoolClient): Promise<DispatchOperationRowRecord[]> {
    const db = client ?? pool;
    const result = await db.query<DispatchOperationRowRecord>(
      `
      select
        *,
        before_ledger_date::text as before_ledger_date,
        after_ledger_date::text as after_ledger_date,
        before_updated_at::text as before_updated_at,
        after_updated_at::text as after_updated_at
      from daily_ledger_dispatch_operation_rows
      where operation_id = $1::uuid
      order by coalesce(after_row_no, before_row_no, 0) asc
      `,
      [operationId],
    );
    return result.rows;
  }

  async ensureRowForUpsert(
    scope: DataScope,
    operationId: string,
    rowId: string,
  ): Promise<void> {
    if (!scope.companyId) throw new HttpError(400, 'Company scope is required.');
    const loc = await pool.query<RowLocationSnapshot>(
      `
      select
        r.id,
        r.session_id,
        r.row_no,
        r.dispatch_id,
        r.posted_shipment_id,
        r.updated_at::text as updated_at,
        r.receipt_no,
        s.branch_id,
        s.ledger_date::text as ledger_date,
        s.line_label,
        s.driver_id,
        s.vehicle_id,
        s.driver_label,
        s.vehicle_label,
        s.trip_no
      from daily_ledger_rows r
      join daily_ledger_sessions s on s.id = r.session_id
      where r.id = $1::uuid
        and r.deleted_at is null
        and s.deleted_at is null
        and s.company_id = $2::uuid
      limit 1
      `,
      [rowId, scope.companyId],
    );
    const row = loc.rows[0];
    if (!row) return;

    await pool.query(
      `
      insert into daily_ledger_dispatch_operation_rows (
        operation_id, row_id, row_existed_before,
        after_session_id, after_row_no, after_dispatch_id, after_branch_id,
        after_ledger_date, after_line_label, after_driver_id, after_vehicle_id,
        after_driver_label, after_vehicle_label, after_trip_no,
        after_posted_shipment_id, after_updated_at, after_snapshot
      )
      values (
        $1, $2, false,
        $3, $4, $5, $6,
        $7::date, $8, $9, $10,
        $11, $12, $13,
        $14, $15::timestamptz, $16::jsonb
      )
      on conflict (operation_id, row_id) do update
      set
        after_session_id = excluded.after_session_id,
        after_row_no = excluded.after_row_no,
        after_dispatch_id = excluded.after_dispatch_id,
        after_branch_id = excluded.after_branch_id,
        after_ledger_date = excluded.after_ledger_date,
        after_line_label = excluded.after_line_label,
        after_driver_id = excluded.after_driver_id,
        after_vehicle_id = excluded.after_vehicle_id,
        after_driver_label = excluded.after_driver_label,
        after_vehicle_label = excluded.after_vehicle_label,
        after_trip_no = excluded.after_trip_no,
        after_posted_shipment_id = excluded.after_posted_shipment_id,
        after_updated_at = excluded.after_updated_at,
        after_snapshot = excluded.after_snapshot,
        updated_at = now()
      `,
      [
        operationId,
        row.id,
        row.session_id,
        row.row_no,
        row.dispatch_id,
        row.branch_id,
        row.ledger_date,
        row.line_label,
        row.driver_id,
        row.vehicle_id,
        row.driver_label,
        row.vehicle_label,
        row.trip_no,
        row.posted_shipment_id,
        row.updated_at,
        JSON.stringify(row),
      ],
    );
  }

  async markPostedShipment(
    operationId: string,
    rowId: string,
    shipmentId: string,
    disposition: 'CREATED' | 'REUSED' | 'EXISTING_POSTED',
    financialPosted: boolean,
    linkedTransferId?: string | null,
  ): Promise<void> {
    await pool.query(
      `
      update daily_ledger_dispatch_operation_rows
      set
        shipment_id = $3,
        shipment_disposition = $4,
        financial_posted_by_operation = $5,
        linked_transfer_id = coalesce($6, linked_transfer_id),
        after_posted_shipment_id = $3,
        updated_at = now()
      where operation_id = $1::uuid and row_id = $2::uuid
      `,
      [operationId, rowId, shipmentId, disposition, financialPosted, linkedTransferId ?? null],
    );

    if (disposition === 'CREATED') {
      await pool.query(
        `update shipments set source_operation_id = $2, updated_at = now() where id = $1::uuid and source_operation_id is null`,
        [shipmentId, operationId],
      );
    }

    // Tag movements/transfers created or completed by this save so undo reverses only this operation's effects.
    if (disposition === 'CREATED' || financialPosted) {
      await pool.query(
        `
        update party_financial_movements
        set source_operation_id = $2
        where shipment_id = $1::uuid
          and is_reversal = false
          and source_operation_id is null
        `,
        [shipmentId, operationId],
      );
      await pool.query(
        `
        update transfers
        set source_operation_id = $2
        where shipment_id = $1::uuid
          and source_operation_id is null
        `,
        [shipmentId, operationId],
      );
    }
  }

  async finalize(
    scope: DataScope,
    operationId: string,
    input: {
      saveLogId: string;
      dispatchId?: string | null;
      status: DispatchOperationStatus;
      resultSummary?: Record<string, unknown>;
    },
  ): Promise<DispatchOperationRecord | null> {
    if (!scope.companyId) throw new HttpError(400, 'Company scope is required.');
    const client = await pool.connect();
    try {
      await client.query('begin');
      const op = await client.query<DispatchOperationRecord>(
        `
        update daily_ledger_dispatch_operations
        set
          save_log_id = $3,
          dispatch_id = coalesce($4, dispatch_id),
          status = $5,
          result_summary = coalesce($6::jsonb, result_summary),
          completed_at = now(),
          updated_at = now()
        where id = $1::uuid and company_id = $2::uuid
        returning *
        `,
        [
          operationId,
          scope.companyId,
          input.saveLogId,
          input.dispatchId ?? null,
          input.status,
          JSON.stringify(input.resultSummary ?? {}),
        ],
      );
      await client.query(
        `
        update daily_ledger_dispatch_save_logs
        set
          operation_id = $2,
          undo_status = case
            when $3 in ('COMPLETED', 'PARTIAL') then 'undoable'
            else 'not_undoable'
          end
        where id = $1::uuid and company_id = $4::uuid
        `,
        [input.saveLogId, operationId, input.status, scope.companyId],
      );
      await client.query('commit');
      return op.rows[0] ?? null;
    } catch (error) {
      await client.query('rollback');
      throw error;
    } finally {
      client.release();
    }
  }

  async markUndone(
    client: PoolClient,
    scope: DataScope,
    operationId: string,
    saveLogId: string | null,
    input: { userId?: string | null; reason?: string | null },
  ): Promise<void> {
    await client.query(
      `
      update daily_ledger_dispatch_operations
      set
        status = 'UNDONE',
        cancelled_at = now(),
        cancelled_by = $3,
        cancellation_reason = $4,
        updated_at = now()
      where id = $1::uuid and company_id = $2::uuid
      `,
      [operationId, scope.companyId, input.userId ?? null, input.reason ?? null],
    );
    if (saveLogId) {
      await client.query(
        `
        update daily_ledger_dispatch_save_logs
        set
          cancelled_at = now(),
          cancelled_by = $3,
          cancellation_reason = $4,
          undo_status = 'undone'
        where id = $1::uuid and company_id = $2::uuid
        `,
        [saveLogId, scope.companyId, input.userId ?? null, input.reason ?? null],
      );
    }
  }
}
