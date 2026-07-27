import { pool } from '../db/pool.js';
import { HttpError } from '../utils/errors.js';
import type { DataScope } from '../utils/scope.js';
import { DailyLedgerDispatchOperationRepository } from '../repositories/dailyLedgerDispatchOperationRepository.js';
import { DailyLedgerDispatchSaveRepository } from '../repositories/dailyLedgerDispatchSaveRepository.js';

export type DispatchUndoPreview = {
  undoable: boolean;
  saveLogId: string;
  operationId: string | null;
  reason?: string;
  blockers: string[];
  rowCount: number;
  shipmentCount: number;
  createdShipmentCount: number;
  movementCount: number;
  transferCount: number;
  rows: Array<{
    rowId: string;
    receiptNo: string | null;
    beforeLedgerDate: string | null;
    afterLedgerDate: string | null;
    beforeRowNo: number | null;
    afterRowNo: number | null;
    shipmentDisposition: string | null;
  }>;
};

export class DailyLedgerDispatchUndoService {
  constructor(
    private operations = new DailyLedgerDispatchOperationRepository(),
    private saveLogs = new DailyLedgerDispatchSaveRepository(),
  ) {}

  async preview(scope: DataScope, saveLogId: string): Promise<DispatchUndoPreview> {
    if (!scope.companyId) throw new HttpError(400, 'Company scope is required.');
    const log = await this.saveLogs.getById(scope, saveLogId);
    if (!log) throw new HttpError(404, 'سجل الإرسالية غير موجود.');

    const operation =
      (log as { operation_id?: string | null }).operation_id
        ? await this.operations.getById(scope, String((log as { operation_id?: string }).operation_id))
        : await this.operations.getBySaveLogId(scope, saveLogId);

    if (!operation) {
      return {
        undoable: false,
        saveLogId,
        operationId: null,
        reason: 'هذا السجل سابق لنظام الاستعادة — الإلغاء متاح للحفظ الجديد فقط.',
        blockers: ['legacy_save_log'],
        rowCount: 0,
        shipmentCount: 0,
        createdShipmentCount: 0,
        movementCount: 0,
        transferCount: 0,
        rows: [],
      };
    }

    if (operation.status === 'UNDONE' || (log as { undo_status?: string | null }).undo_status === 'undone') {
      return {
        undoable: false,
        saveLogId,
        operationId: operation.id,
        reason: 'تم إلغاء هذا الحفظ مسبقاً.',
        blockers: ['already_undone'],
        rowCount: 0,
        shipmentCount: 0,
        createdShipmentCount: 0,
        movementCount: 0,
        transferCount: 0,
        rows: [],
      };
    }

    if (!['COMPLETED', 'PARTIAL'].includes(operation.status)) {
      return {
        undoable: false,
        saveLogId,
        operationId: operation.id,
        reason: 'لا يمكن إلغاء عملية حفظ غير مكتملة.',
        blockers: ['operation_not_completed'],
        rowCount: 0,
        shipmentCount: 0,
        createdShipmentCount: 0,
        movementCount: 0,
        transferCount: 0,
        rows: [],
      };
    }

    const opRows = await this.operations.listRows(operation.id);
    const blockers = await this.collectBlockers(
      scope,
      operation.id,
      opRows.map((r) => r.row_id),
      undefined,
      {
        ledgerDate: operation.ledger_date,
        branchId: operation.branch_id,
      },
    );

    const shipmentIds = opRows.map((r) => r.shipment_id).filter((id): id is string => Boolean(id));
    const createdCount = opRows.filter((r) => r.shipment_disposition === 'CREATED').length;

    const movementCount = shipmentIds.length
      ? Number(
          (
            await pool.query<{ count: string }>(
              `
              select count(*)::text as count
              from party_financial_movements
              where shipment_id = any($1::uuid[])
                and is_reversal = false
                and (
                  source_operation_id = $2::uuid
                  or source_operation_id is null
                )
              `,
              [shipmentIds, operation.id],
            )
          ).rows[0]?.count ?? 0,
        )
      : 0;

    const transferCount = shipmentIds.length
      ? Number(
          (
            await pool.query<{ count: string }>(
              `
              select count(*)::text as count
              from transfers
              where shipment_id = any($1::uuid[])
                and upper(coalesce(status, '')) <> 'CANCELLED'
              `,
              [shipmentIds],
            )
          ).rows[0]?.count ?? 0,
        )
      : 0;

    const receiptMap = await this.loadReceiptNos(opRows.map((r) => r.row_id));

    return {
      undoable: blockers.length === 0,
      saveLogId,
      operationId: operation.id,
      reason: blockers.length ? blockers[0] : undefined,
      blockers,
      rowCount: opRows.length,
      shipmentCount: shipmentIds.length,
      createdShipmentCount: createdCount,
      movementCount,
      transferCount,
      rows: opRows.map((row) => ({
        rowId: row.row_id,
        receiptNo: receiptMap.get(row.row_id) ?? null,
        beforeLedgerDate: row.before_ledger_date,
        afterLedgerDate: row.after_ledger_date,
        beforeRowNo: row.before_row_no,
        afterRowNo: row.after_row_no,
        shipmentDisposition: row.shipment_disposition,
      })),
    };
  }

  async undo(
    scope: DataScope,
    saveLogId: string,
    input: { reason?: string | null; userId?: string | null },
  ): Promise<{ saveLogId: string; operationId: string; restoredRows: number }> {
    if (!scope.companyId) throw new HttpError(400, 'Company scope is required.');

    const preview = await this.preview(scope, saveLogId);
    if (!preview.undoable || !preview.operationId) {
      throw new HttpError(409, preview.reason || 'لا يمكن إلغاء هذا الحفظ.');
    }

    const operation = await this.operations.getById(scope, preview.operationId);
    if (!operation) throw new HttpError(404, 'عملية الحفظ غير موجودة.');

    const opRows = await this.operations.listRows(operation.id);
    const client = await pool.connect();
    try {
      await client.query('begin');

      const lockedOp = await client.query<{ id: string; status: string }>(
        `
        select id, status
        from daily_ledger_dispatch_operations
        where id = $1::uuid and company_id = $2::uuid
        for update
        `,
        [operation.id, scope.companyId],
      );
      if (!lockedOp.rows[0]) throw new HttpError(404, 'عملية الحفظ غير موجودة.');
      if (lockedOp.rows[0].status === 'UNDONE') {
        throw new HttpError(409, 'تم إلغاء هذا الحفظ مسبقاً.');
      }

      const blockers = await this.collectBlockers(
        scope,
        operation.id,
        opRows.map((r) => r.row_id),
        client,
        {
          ledgerDate: operation.ledger_date,
          branchId: operation.branch_id,
        },
      );
      if (blockers.length) {
        throw new HttpError(409, blockers[0]);
      }

      const reason = input.reason?.trim() || 'إلغاء حفظ إرسالية من سجل الحفظ';
      const sessionsToReprint = new Set<string>();

      for (const opRow of opRows) {
        await client.query(`select id from daily_ledger_rows where id = $1::uuid for update`, [opRow.row_id]);

        if (opRow.shipment_id) {
          await client.query(`select id from shipments where id = $1::uuid for update`, [opRow.shipment_id]);

          const transfer = await client.query<{ id: string; status: string; source_operation_id: string | null }>(
            `
            select id, status, source_operation_id
            from transfers
            where shipment_id = $1::uuid
              and upper(coalesce(status, '')) <> 'CANCELLED'
              and (
                source_operation_id = $2::uuid
                or id = $3::uuid
                or ($4::boolean and source_operation_id is null)
              )
            for update
            `,
            [
              opRow.shipment_id,
              operation.id,
              opRow.linked_transfer_id,
              opRow.shipment_disposition === 'CREATED',
            ],
          );
          for (const t of transfer.rows) {
            const status = String(t.status || '').toUpperCase();
            if (status === 'COMPLETED') {
              throw new HttpError(409, 'لا يمكن الإلغاء: توجد حوالة مكتملة مرتبطة بإحدى الشحنات.');
            }
            await client.query(
              `
              update transfers
              set
                status = 'CANCELLED',
                cancelled_at = coalesce(cancelled_at, now()),
                cancellation_reason = $2,
                updated_at = now()
              where id = $1::uuid
              `,
              [t.id, reason],
            );
            await client.query(
              `
              update party_financial_movements
              set is_reversal = true, reverse_reason = $2
              where reference_type = 'TRANSFER'
                and reference_id = $1::uuid
                and is_reversal = false
              `,
              [t.id, reason],
            );
          }

          const createdByOp = opRow.shipment_disposition === 'CREATED';
          const financialByOp = Boolean(opRow.financial_posted_by_operation) || createdByOp;

          if (createdByOp || financialByOp) {
            await client.query(
              `
              update shipments
              set
                financial_status = case when $4::boolean then 'REVERSED' else financial_status end,
                financial_notes = case
                  when $4::boolean then coalesce(financial_notes, '') || ' | ' || $2::text
                  else financial_notes
                end,
                deleted_at = case
                  when $3::boolean then coalesce(deleted_at, now())
                  else deleted_at
                end,
                updated_at = now()
              where id = $1::uuid
              `,
              [opRow.shipment_id, reason, createdByOp, financialByOp],
            );
          }

          if (financialByOp) {
            await client.query(
              `
              update party_financial_movements
              set is_reversal = true, reverse_reason = $2
              where shipment_id = $1::uuid
                and movement_type in (
                  'shipment_charge', 'shipment_shipping_fee', 'sender_collection_trust',
                  'loading_dues', 'general_collection', 'shipment_hawala_trust', 'shipment_transfer_service_fee'
                )
                and is_reversal = false
                and (
                  source_operation_id = $3::uuid
                  or ($4::boolean and source_operation_id is null)
                )
              `,
              [opRow.shipment_id, reason, operation.id, createdByOp],
            );
          }
        }

        if (opRow.row_existed_before && opRow.before_session_id != null && opRow.before_row_no != null) {
          // Ensure target session is alive
          await client.query(
            `
            update daily_ledger_sessions
            set deleted_at = null, updated_at = now()
            where id = $1::uuid and deleted_at is not null
            `,
            [opRow.before_session_id],
          );

          const conflict = await client.query<{ id: string }>(
            `
            select id
            from daily_ledger_rows
            where session_id = $1::uuid
              and row_no = $2
              and deleted_at is null
              and id <> $3::uuid
            limit 1
            `,
            [opRow.before_session_id, opRow.before_row_no, opRow.row_id],
          );
          let restoreRowNo = opRow.before_row_no;
          if (conflict.rows[0]) {
            const next = await client.query<{ max: number | null }>(
              `select max(row_no) as max from daily_ledger_rows where session_id = $1::uuid and deleted_at is null`,
              [opRow.before_session_id],
            );
            restoreRowNo = Number(next.rows[0]?.max ?? 0) + 1;
          }

          await client.query(
            `
            update daily_ledger_rows
            set
              session_id = $2::uuid,
              row_no = $3,
              dispatch_id = $4,
              posted_shipment_id = $5,
              posted_at = case when $5::uuid is null then null else posted_at end,
              updated_at = now(),
              updated_by = $6
            where id = $1::uuid
            `,
            [
              opRow.row_id,
              opRow.before_session_id,
              restoreRowNo,
              opRow.before_dispatch_id,
              opRow.before_posted_shipment_id,
              input.userId ?? scope.userId ?? null,
            ],
          );
          sessionsToReprint.add(opRow.before_session_id);
          if (opRow.after_session_id) sessionsToReprint.add(opRow.after_session_id);
        } else {
          // New row created by this save: keep data but clear posting/dispatch so it becomes unsaved again
          await client.query(
            `
            update daily_ledger_rows
            set
              dispatch_id = null,
              posted_shipment_id = null,
              posted_at = null,
              updated_at = now(),
              updated_by = $2
            where id = $1::uuid
            `,
            [opRow.row_id, input.userId ?? scope.userId ?? null],
          );
          if (opRow.after_session_id) sessionsToReprint.add(opRow.after_session_id);
        }
      }

      for (const sessionId of sessionsToReprint) {
        await client.query(
          `
          update daily_ledger_sessions
          set reprint_required = true, reprint_reason = $2, updated_at = now()
          where id = $1::uuid and printed_at is not null and deleted_at is null
          `,
          [sessionId, reason],
        );
      }

      if (operation.dispatch_id) {
        const stillLinked = await client.query<{ count: string }>(
          `
          select count(*)::text as count
          from daily_ledger_rows
          where dispatch_id = $1::uuid and deleted_at is null
          `,
          [operation.dispatch_id],
        );
        if (Number(stillLinked.rows[0]?.count ?? 0) === 0) {
          await client.query(
            `
            update daily_ledger_dispatch_definitions
            set deleted_at = now(), updated_at = now(), updated_by = $2
            where id = $1::uuid and deleted_at is null
            `,
            [operation.dispatch_id, input.userId ?? scope.userId ?? null],
          );
        }
      }

      await this.operations.markUndone(client, scope, operation.id, operation.save_log_id ?? saveLogId, {
        userId: input.userId ?? scope.userId ?? null,
        reason,
      });

      await client.query('commit');
      return {
        saveLogId,
        operationId: operation.id,
        restoredRows: opRows.length,
      };
    } catch (error) {
      await client.query('rollback');
      throw error;
    } finally {
      client.release();
    }
  }

  private async loadReceiptNos(rowIds: string[]): Promise<Map<string, string | null>> {
    const map = new Map<string, string | null>();
    if (!rowIds.length) return map;
    const result = await pool.query<{ id: string; receipt_no: string | null }>(
      `select id, receipt_no from daily_ledger_rows where id = any($1::uuid[])`,
      [rowIds],
    );
    for (const row of result.rows) map.set(row.id, row.receipt_no);
    return map;
  }

  private async collectBlockers(
    scope: DataScope,
    operationId: string,
    rowIds: string[],
    client: { query: typeof pool.query } = pool,
    periodHint?: { ledgerDate: string; branchId: string },
  ): Promise<string[]> {
    if (!rowIds.length) return ['لا توجد أسطر مرتبطة بعملية الحفظ.'];

    const blockers: string[] = [];

    if (scope.companyId && periodHint?.ledgerDate) {
      const closed = await client.query<{ ok: number }>(
        `
        select 1 as ok
        from accounting_period_closures
        where company_id = $1::uuid
          and period_start <= $2::date
          and period_end >= $2::date
          and ($3::uuid is null or branch_id is null or branch_id = $3::uuid)
        limit 1
        `,
        [scope.companyId, periodHint.ledgerDate.slice(0, 10), periodHint.branchId ?? null],
      );
      if (closed.rows[0]) {
        blockers.push('لا يمكن الإلغاء: الفترة المحاسبية لتاريخ الحفظ مغلقة.');
      }
    }

    const loaded = await client.query<{ receipt_no: string | null }>(
      `
      select receipt_no
      from daily_ledger_rows
      where id = any($1::uuid[])
        and deleted_at is null
        and loaded_at is not null
      limit 3
      `,
      [rowIds],
    );
    if (loaded.rows.length) {
      blockers.push(
        `لا يمكن الإلغاء: توجد أسطر محمّلة على بيان (مثال إيصال ${loaded.rows[0].receipt_no ?? '—'}).`,
      );
    }

    const changed = await client.query<{ receipt_no: string | null }>(
      `
      select r.receipt_no
      from daily_ledger_dispatch_operation_rows o
      join daily_ledger_rows r on r.id = o.row_id
      where o.operation_id = $1::uuid
        and r.deleted_at is null
        and o.after_updated_at is not null
        and date_trunc('milliseconds', r.updated_at) > date_trunc('milliseconds', o.after_updated_at)
        and (
          r.session_id is distinct from o.after_session_id
          or r.row_no is distinct from o.after_row_no
          or r.dispatch_id is distinct from o.after_dispatch_id
          or r.posted_shipment_id is distinct from o.after_posted_shipment_id
        )
      limit 3
      `,
      [operationId],
    );
    if (changed.rows.length) {
      blockers.push(
        `لا يمكن الإلغاء: تم تعديل/نقل أسطر بعد الحفظ (مثال إيصال ${changed.rows[0].receipt_no ?? '—'}).`,
      );
    }

    const deliveries = await client.query<{ count: string }>(
      `
      select count(*)::text as count
      from deliveries d
      join daily_ledger_dispatch_operation_rows o on o.shipment_id = d.shipment_id
      where o.operation_id = $1::uuid
        and d.deleted_at is null
      `,
      [operationId],
    ).catch(() => ({ rows: [{ count: '0' }] }));
    if (Number(deliveries.rows[0]?.count ?? 0) > 0) {
      blockers.push('لا يمكن الإلغاء: توجد شحنات مُسلَّمة مرتبطة بهذا الحفظ.');
    }

    const vouchers = await client.query<{ count: string }>(
      `
      select count(*)::text as count
      from receipt_vouchers rv
      join daily_ledger_dispatch_operation_rows o on o.shipment_id = rv.shipment_id
      where o.operation_id = $1::uuid
        and lower(coalesce(rv.status, '')) not in ('cancelled', 'canceled')
      `,
      [operationId],
    ).catch(() => ({ rows: [{ count: '0' }] }));
    if (Number(vouchers.rows[0]?.count ?? 0) > 0) {
      blockers.push('لا يمكن الإلغاء: توجد سندات قبض مؤكدة على شحنات هذا الحفظ.');
    }

    const payments = await client.query<{ count: string }>(
      `
      select count(*)::text as count
      from payment_vouchers pv
      join daily_ledger_dispatch_operation_rows o on o.shipment_id = pv.shipment_id
      where o.operation_id = $1::uuid
        and lower(coalesce(pv.status, '')) not in ('cancelled', 'canceled')
      `,
      [operationId],
    ).catch(() => ({ rows: [{ count: '0' }] }));
    if (Number(payments.rows[0]?.count ?? 0) > 0) {
      blockers.push('لا يمكن الإلغاء: توجد سندات دفع مؤكدة على شحنات هذا الحفظ.');
    }

    const completedTransfers = await client.query<{ count: string }>(
      `
      select count(*)::text as count
      from transfers t
      join daily_ledger_dispatch_operation_rows o on o.shipment_id = t.shipment_id
      where o.operation_id = $1::uuid
        and upper(coalesce(t.status, '')) = 'COMPLETED'
      `,
      [operationId],
    );
    if (Number(completedTransfers.rows[0]?.count ?? 0) > 0) {
      blockers.push('لا يمكن الإلغاء: توجد حوالات مكتملة مرتبطة بهذا الحفظ.');
    }

    void scope;
    return blockers;
  }
}
