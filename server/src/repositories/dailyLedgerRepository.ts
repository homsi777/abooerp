import { pool } from '../db/pool.js';
import type { DataScope } from '../utils/scope.js';

export type DailyLedgerSession = {
  id: string;
  company_id: string;
  branch_id: string;
  ledger_date: string;
  line_label: string;
  origin_label: string;
  trip_no: string | null;
  vehicle_label: string | null;
  driver_label: string | null;
  created_by: string | null;
  updated_by: string | null;
  created_at: string;
  updated_at: string;
  deleted_at: string | null;
};

export type DailyLedgerRow = {
  id: string;
  session_id: string;
  row_no: number;
  receipt_no: string | null;
  destination: string;
  parcel_type: string;
  parcel_count: number | null;
  weight_kg: string | null;
  sender_name: string;
  receiver_name: string;
  collect_amount_usd: string;
  prepaid_amount_usd: string;
  hawala_amount_usd: string;
  fees_amount_usd: string;
  transfer_service_fee_usd: string;
  notes: string | null;
  posted_shipment_id: string | null;
  posted_at: string | null;
  loaded_manifest_id: string | null;
  loaded_at: string | null;
  created_by: string | null;
  updated_by: string | null;
  created_at: string;
  updated_at: string;
  deleted_at: string | null;
};

export type DailyLedgerRowWithSession = DailyLedgerRow & {
  branch_id: string;
  ledger_date: string;
  line_label: string;
  origin_label: string;
  trip_no: string | null;
  vehicle_label: string | null;
  driver_label: string | null;
};

export interface DailyLedgerRowListFilters {
  branchId?: string;
  ledgerDate?: string;
  lineLabel?: string;
  includeLoaded?: boolean;
  q?: string;
  limit: number;
  offset: number;
}

export interface DailyLedgerUpsertInput {
  branchId: string;
  ledgerDate: string;
  lineLabel: string;
  originLabel?: string;
  tripNo?: string | null;
  vehicleLabel?: string | null;
  driverLabel?: string | null;
  rowNo: number;
  receiptNo?: string | null;
  destination?: string;
  parcelType?: string;
  parcelCount?: number | null;
  weightKg?: number | null;
  senderName?: string;
  receiverName?: string;
  collectAmountUsd?: number;
  prepaidAmountUsd?: number;
  hawalaAmountUsd?: number;
  feesAmountUsd?: number;
  transferServiceFeeUsd?: number;
  notes?: string | null;
  userId?: string;
}

export class DailyLedgerRepository {
  async listRows(scope: DataScope, filters: DailyLedgerRowListFilters): Promise<DailyLedgerRowWithSession[]> {
    const conditions: string[] = ['r.deleted_at is null', 's.deleted_at is null'];
    const values: unknown[] = [];

    if (scope.companyId) {
      values.push(scope.companyId);
      conditions.push(`s.company_id = $${values.length}`);
    }
    if (filters.branchId) {
      values.push(filters.branchId);
      conditions.push(`s.branch_id = $${values.length}`);
    }
    if (filters.ledgerDate) {
      values.push(filters.ledgerDate);
      conditions.push(`s.ledger_date = $${values.length}::date`);
    }
    if (filters.lineLabel) {
      values.push(filters.lineLabel);
      conditions.push(`s.line_label = $${values.length}`);
    }
    if (!filters.includeLoaded) {
      conditions.push('r.loaded_at is null');
    }
    if (filters.q && filters.q.trim()) {
      const q = `%${filters.q.trim()}%`;
      values.push(q);
      const qp = `$${values.length}`;
      conditions.push(
        `(
          coalesce(r.receipt_no,'') ilike ${qp}
          or coalesce(r.destination,'') ilike ${qp}
          or coalesce(r.parcel_type,'') ilike ${qp}
          or coalesce(r.sender_name,'') ilike ${qp}
          or coalesce(r.receiver_name,'') ilike ${qp}
        )`,
      );
    }

    values.push(filters.limit);
    const limitParam = `$${values.length}`;
    values.push(filters.offset);
    const offsetParam = `$${values.length}`;

    const result = await pool.query<DailyLedgerRowWithSession>(
      `
      select
        r.*,
        s.branch_id,
        s.ledger_date,
        s.line_label,
        s.origin_label,
        s.trip_no,
        s.vehicle_label,
        s.driver_label
      from daily_ledger_rows r
      join daily_ledger_sessions s on s.id = r.session_id
      where ${conditions.join(' and ')}
      order by s.ledger_date desc, s.created_at desc, r.row_no asc
      limit ${limitParam}
      offset ${offsetParam}
      `,
      values,
    );
    return result.rows;
  }

  async upsertRow(scope: DataScope, input: DailyLedgerUpsertInput): Promise<DailyLedgerRowWithSession> {
    if (!scope.companyId) {
      throw new Error('Company scope is required.');
    }
    const client = await pool.connect();
    try {
      await client.query('begin');

      const session = await client.query<DailyLedgerSession>(
        `
        insert into daily_ledger_sessions(
          company_id, branch_id, ledger_date, line_label, origin_label,
          trip_no, vehicle_label, driver_label,
          created_by, updated_by
        )
        values($1,$2,$3::date,$4,$5,$6,$7,$8,$9,$9)
        on conflict (company_id, branch_id, ledger_date, line_label) where deleted_at is null
        do update set
          origin_label = excluded.origin_label,
          trip_no = coalesce(excluded.trip_no, daily_ledger_sessions.trip_no),
          vehicle_label = coalesce(excluded.vehicle_label, daily_ledger_sessions.vehicle_label),
          driver_label = coalesce(excluded.driver_label, daily_ledger_sessions.driver_label),
          updated_by = excluded.updated_by,
          updated_at = now()
        returning *
        `,
        [
          scope.companyId,
          input.branchId,
          input.ledgerDate,
          input.lineLabel,
          input.originLabel ?? '',
          input.tripNo ?? null,
          input.vehicleLabel ?? null,
          input.driverLabel ?? null,
          input.userId ?? scope.userId ?? null,
        ],
      );

      const sessionId = session.rows[0].id;

      const row = await client.query<DailyLedgerRowWithSession>(
        `
        insert into daily_ledger_rows(
          session_id,
          row_no,
          receipt_no,
          destination,
          parcel_type,
          parcel_count,
          weight_kg,
          sender_name,
          receiver_name,
          collect_amount_usd,
          prepaid_amount_usd,
          hawala_amount_usd,
          fees_amount_usd,
          transfer_service_fee_usd,
          notes,
          created_by,
          updated_by
        )
        values($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$16)
        on conflict (session_id, row_no) where deleted_at is null
        do update set
          receipt_no = excluded.receipt_no,
          destination = excluded.destination,
          parcel_type = excluded.parcel_type,
          parcel_count = excluded.parcel_count,
          weight_kg = excluded.weight_kg,
          sender_name = excluded.sender_name,
          receiver_name = excluded.receiver_name,
          collect_amount_usd = excluded.collect_amount_usd,
          prepaid_amount_usd = excluded.prepaid_amount_usd,
          hawala_amount_usd = excluded.hawala_amount_usd,
          fees_amount_usd = excluded.fees_amount_usd,
          transfer_service_fee_usd = excluded.transfer_service_fee_usd,
          notes = excluded.notes,
          updated_by = excluded.updated_by,
          updated_at = now()
        returning
          daily_ledger_rows.*,
          $17::uuid as branch_id,
          $18::date as ledger_date,
          $19::text as line_label,
          $20::text as origin_label,
          $21::text as trip_no,
          $22::text as vehicle_label,
          $23::text as driver_label
        `,
        [
          sessionId,
          input.rowNo,
          input.receiptNo ?? null,
          input.destination ?? '',
          input.parcelType ?? '',
          input.parcelCount ?? null,
          input.weightKg ?? null,
          input.senderName ?? '',
          input.receiverName ?? '',
          input.collectAmountUsd ?? 0,
          input.prepaidAmountUsd ?? 0,
          input.hawalaAmountUsd ?? 0,
          input.feesAmountUsd ?? 0,
          input.transferServiceFeeUsd ?? 0,
          input.notes ?? null,
          input.userId ?? scope.userId ?? null,
          session.rows[0].branch_id,
          session.rows[0].ledger_date,
          session.rows[0].line_label,
          session.rows[0].origin_label,
          session.rows[0].trip_no,
          session.rows[0].vehicle_label,
          session.rows[0].driver_label,
        ],
      );

      await client.query('commit');
      return row.rows[0];
    } catch (error) {
      await client.query('rollback');
      throw error;
    } finally {
      client.release();
    }
  }

  async markPosted(
    scope: DataScope,
    input: { rowId: string; shipmentId: string; userId?: string; expectedUpdatedAt?: string },
    allowedBranchIds: string[],
  ) {
    if (!scope.companyId) {
      throw new Error('Company scope is required.');
    }
    const expectsUpdatedAt = Boolean(input.expectedUpdatedAt);
    const result = await pool.query(
      `
      update daily_ledger_rows r
      set
        posted_shipment_id = $2,
        posted_at = now(),
        updated_by = $3,
        updated_at = now()
      from daily_ledger_sessions s
      where r.id = $1
        and r.session_id = s.id
        and r.deleted_at is null
        and s.deleted_at is null
        and s.company_id = $6::uuid
        and (
          coalesce(array_length($7::uuid[], 1), 0) = 0
          or s.branch_id = any($7::uuid[])
        )
        and (
          $4::boolean = false
          or date_trunc('milliseconds', r.updated_at) = date_trunc('milliseconds', $5::timestamptz)
        )
      returning r.id
      `,
      [
        input.rowId,
        input.shipmentId,
        input.userId ?? null,
        expectsUpdatedAt,
        input.expectedUpdatedAt ?? null,
        scope.companyId,
        allowedBranchIds ?? [],
      ],
    );
    return Boolean(result.rowCount);
  }

  async markLoadedByShipmentIds(input: { manifestId: string; shipmentIds: string[] }) {
    if (!input.shipmentIds.length) return 0;
    const result = await pool.query(
      `
      update daily_ledger_rows
      set
        loaded_manifest_id = $1,
        loaded_at = now(),
        updated_at = now()
      where deleted_at is null
        and posted_shipment_id = any($2::uuid[])
      `,
      [input.manifestId, input.shipmentIds],
    );
    return result.rowCount ?? 0;
  }
}
