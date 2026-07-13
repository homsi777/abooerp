import { pool } from '../db/pool.js';
import { HttpError } from '../utils/errors.js';
import type { DataScope } from '../utils/scope.js';

export type DispatchSaveRowSnapshot = {
  rowId: string;
  rowNo: number;
  receiptNo: string | null;
  destination: string;
  parcelType: string;
  parcelCount: number | null;
  weightKg: string | null;
  senderName: string;
  receiverName: string;
  collectAmountUsd: string;
  prepaidAmountUsd: string;
  hawalaAmountUsd: string;
  transferServiceFeeUsd: string;
  notes: string | null;
  driverLabel: string | null;
  dispatchNo: number | null;
  ledgerDate: string | null;
};

export type DispatchSaveLogInput = {
  branchId: string;
  dispatchId?: string | null;
  dispatchNo?: number | null;
  ledgerDate: string;
  lineLabel: string;
  originLabel?: string | null;
  driverId?: string | null;
  vehicleId?: string | null;
  driverLabel?: string | null;
  vehicleLabel?: string | null;
  tripNo?: string | null;
  destinationLabel?: string | null;
  saveMode: 'all' | 'custom';
  rowCount?: number;
  piecesCount?: number;
  weightKg?: number;
  collectTotalUsd?: number;
  prepaidTotalUsd?: number;
  hawalaTotalUsd?: number;
  transferFeeTotalUsd?: number;
  postedCount?: number;
  errorCount?: number;
  skippedCount?: number;
  receiptNos?: string[];
  rowIds?: string[];
  rowsSnapshot?: DispatchSaveRowSnapshot[];
  outcome?: 'success' | 'partial' | 'failed' | null;
  summary?: string | null;
  notes?: string | null;
  userId?: string;
};

export type DispatchSaveLogRecord = DispatchSaveLogInput & {
  id: string;
  company_id: string;
  saved_at: string;
  saved_by: string | null;
  printed_at: string | null;
  print_document_id: string | null;
  print_count: number;
  created_at: string;
};

export type DispatchSaveLogSummary = {
  id: string;
  branch_id: string;
  branch_name: string | null;
  dispatch_id: string | null;
  dispatch_no: number | null;
  ledger_date: string;
  line_label: string;
  origin_label: string | null;
  driver_id: string | null;
  driver_label: string | null;
  vehicle_label: string | null;
  destination_label: string | null;
  save_mode: 'all' | 'custom';
  row_count: number;
  pieces_count: number;
  weight_kg: string;
  collect_total_usd: string;
  prepaid_total_usd: string;
  hawala_total_usd: string;
  transfer_fee_total_usd: string;
  posted_count: number;
  error_count: number;
  skipped_count: number;
  outcome: string | null;
  summary: string | null;
  saved_at: string;
  saved_by_name: string | null;
  saved_by_username: string | null;
  printed_at: string | null;
  print_count: number;
};

export type DispatchSaveLogListFilters = {
  branchId?: string;
  dateFrom?: string;
  dateTo?: string;
  driverId?: string;
  destination?: string;
  searchQuery?: string;
  saveMode?: 'all' | 'custom';
  limit?: number;
  offset?: number;
};

export class DailyLedgerDispatchSaveRepository {
  async create(scope: DataScope, input: DispatchSaveLogInput): Promise<DispatchSaveLogRecord> {
    if (!scope.companyId) throw new HttpError(400, 'Company scope is required.');

    const result = await pool.query<DispatchSaveLogRecord>(
      `
      insert into daily_ledger_dispatch_save_logs (
        company_id, branch_id, dispatch_id, dispatch_no, ledger_date, line_label, origin_label,
        driver_id, vehicle_id, driver_label, vehicle_label, trip_no, destination_label,
        save_mode, row_count, pieces_count, weight_kg,
        collect_total_usd, prepaid_total_usd, hawala_total_usd, transfer_fee_total_usd,
        posted_count, error_count, skipped_count, receipt_nos, row_ids, rows_snapshot,
        outcome, summary, saved_by, notes
      )
      values (
        $1, $2, $3, $4, $5::date, $6, $7,
        $8, $9, $10, $11, $12, $13,
        $14, $15, $16, $17,
        $18, $19, $20, $21,
        $22, $23, $24, $25, $26, $27::jsonb,
        $28, $29, $30, $31
      )
      returning *
      `,
      [
        scope.companyId,
        input.branchId,
        input.dispatchId ?? null,
        input.dispatchNo ?? null,
        input.ledgerDate,
        input.lineLabel,
        input.originLabel ?? null,
        input.driverId ?? null,
        input.vehicleId ?? null,
        input.driverLabel ?? null,
        input.vehicleLabel ?? null,
        input.tripNo ?? null,
        input.destinationLabel ?? null,
        input.saveMode,
        input.rowCount ?? 0,
        input.piecesCount ?? 0,
        input.weightKg ?? 0,
        input.collectTotalUsd ?? 0,
        input.prepaidTotalUsd ?? 0,
        input.hawalaTotalUsd ?? 0,
        input.transferFeeTotalUsd ?? 0,
        input.postedCount ?? 0,
        input.errorCount ?? 0,
        input.skippedCount ?? 0,
        input.receiptNos ?? [],
        input.rowIds ?? [],
        JSON.stringify(input.rowsSnapshot ?? []),
        input.outcome ?? null,
        input.summary ?? null,
        input.userId ?? scope.userId ?? null,
        input.notes ?? null,
      ],
    );
    return result.rows[0];
  }

  async list(scope: DataScope, filters: DispatchSaveLogListFilters): Promise<DispatchSaveLogSummary[]> {
    if (!scope.companyId) throw new HttpError(400, 'Company scope is required.');

    const conditions: string[] = ['l.company_id = $1'];
    const values: unknown[] = [scope.companyId];

    if (filters.branchId) {
      values.push(filters.branchId);
      conditions.push(`l.branch_id = $${values.length}::uuid`);
    }
    if (filters.dateFrom) {
      values.push(filters.dateFrom);
      conditions.push(`l.ledger_date >= $${values.length}::date`);
    }
    if (filters.dateTo) {
      values.push(filters.dateTo);
      conditions.push(`l.ledger_date <= $${values.length}::date`);
    }
    if (filters.driverId) {
      values.push(filters.driverId);
      conditions.push(`l.driver_id = $${values.length}::uuid`);
    }
    if (filters.saveMode) {
      values.push(filters.saveMode);
      conditions.push(`l.save_mode = $${values.length}`);
    }
    if (filters.destination?.trim()) {
      values.push(`%${filters.destination.trim()}%`);
      conditions.push(`coalesce(l.destination_label, '') ilike $${values.length}`);
    }
    if (filters.searchQuery?.trim()) {
      const q = `%${filters.searchQuery.trim()}%`;
      values.push(q);
      const qp = `$${values.length}`;
      conditions.push(
        `(
          coalesce(l.driver_label, '') ilike ${qp}
          or coalesce(l.destination_label, '') ilike ${qp}
          or coalesce(l.line_label, '') ilike ${qp}
          or coalesce(l.summary, '') ilike ${qp}
          or exists (
            select 1 from unnest(l.receipt_nos) rn where rn ilike ${qp}
          )
        )`,
      );
    }

    values.push(filters.limit ?? 200);
    const limitParam = `$${values.length}`;
    values.push(filters.offset ?? 0);
    const offsetParam = `$${values.length}`;

    const result = await pool.query<DispatchSaveLogSummary>(
      `
      select
        l.id,
        l.branch_id,
        b.name as branch_name,
        l.dispatch_id,
        l.dispatch_no,
        l.ledger_date::text as ledger_date,
        l.line_label,
        l.origin_label,
        l.driver_id,
        l.driver_label,
        l.vehicle_label,
        l.destination_label,
        l.save_mode,
        l.row_count,
        l.pieces_count,
        l.weight_kg::text as weight_kg,
        l.collect_total_usd::text as collect_total_usd,
        l.prepaid_total_usd::text as prepaid_total_usd,
        l.hawala_total_usd::text as hawala_total_usd,
        l.transfer_fee_total_usd::text as transfer_fee_total_usd,
        l.posted_count,
        l.error_count,
        l.skipped_count,
        l.outcome,
        l.summary,
        l.saved_at::text as saved_at,
        u.full_name as saved_by_name,
        u.username as saved_by_username,
        l.printed_at::text as printed_at,
        l.print_count
      from daily_ledger_dispatch_save_logs l
      left join branches b on b.id = l.branch_id
      left join users u on u.id = l.saved_by
      where ${conditions.join(' and ')}
      order by l.saved_at desc
      limit ${limitParam}
      offset ${offsetParam}
      `,
      values,
    );
    return result.rows;
  }

  async getById(scope: DataScope, id: string): Promise<DispatchSaveLogRecord | null> {
    if (!scope.companyId) throw new HttpError(400, 'Company scope is required.');
    const result = await pool.query<DispatchSaveLogRecord>(
      `
      select
        l.*,
        l.ledger_date::text as ledger_date,
        l.weight_kg::text as weight_kg,
        l.collect_total_usd::text as collect_total_usd,
        l.prepaid_total_usd::text as prepaid_total_usd,
        l.hawala_total_usd::text as hawala_total_usd,
        l.transfer_fee_total_usd::text as transfer_fee_total_usd,
        l.saved_at::text as saved_at,
        l.printed_at::text as printed_at,
        l.created_at::text as created_at,
        u.full_name as saved_by_name,
        u.username as saved_by_username,
        b.name as branch_name
      from daily_ledger_dispatch_save_logs l
      left join users u on u.id = l.saved_by
      left join branches b on b.id = l.branch_id
      where l.id = $1::uuid and l.company_id = $2::uuid
      limit 1
      `,
      [id, scope.companyId],
    );
    return result.rows[0] ?? null;
  }

  async markPrinted(
    scope: DataScope,
    id: string,
    input: { printDocumentId?: string | null },
  ): Promise<DispatchSaveLogRecord | null> {
    if (!scope.companyId) throw new HttpError(400, 'Company scope is required.');
    const result = await pool.query<DispatchSaveLogRecord>(
      `
      update daily_ledger_dispatch_save_logs
      set
        printed_at = coalesce(printed_at, now()),
        print_document_id = coalesce($3::uuid, print_document_id),
        print_count = print_count + 1
      where id = $1::uuid and company_id = $2::uuid
      returning *
      `,
      [id, scope.companyId, input.printDocumentId ?? null],
    );
    return result.rows[0] ?? null;
  }
}
