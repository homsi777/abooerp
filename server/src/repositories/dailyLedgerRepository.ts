import { pool } from '../db/pool.js';
import { HttpError } from '../utils/errors.js';
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
  driver_id: string | null;
  vehicle_id: string | null;
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
  driver_id: string | null;
  vehicle_id: string | null;
};

export interface DailyLedgerRowListFilters {
  branchId?: string;
  ledgerDate?: string;
  dateFrom?: string;
  dateTo?: string;
  lineLabel?: string;
  driverId?: string;
  vehicleId?: string;
  includeLoaded?: boolean;
  onlyWithData?: boolean;
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
  driverId?: string | null;
  vehicleId?: string | null;
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
  /** عند التعديل: تحديث السطر الموجود مباشرة دون إنشاء جلسة/سطر جديد */
  rowId?: string;
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
    if (filters.ledgerDate && !filters.dateFrom && !filters.dateTo) {
      values.push(filters.ledgerDate);
      conditions.push(`s.ledger_date = $${values.length}::date`);
    }
    if (filters.dateFrom) {
      values.push(filters.dateFrom);
      conditions.push(`s.ledger_date >= $${values.length}::date`);
    }
    if (filters.dateTo) {
      values.push(filters.dateTo);
      conditions.push(`s.ledger_date <= $${values.length}::date`);
    }
    if (filters.lineLabel) {
      values.push(filters.lineLabel);
      conditions.push(`s.line_label = $${values.length}`);
    }
    if (filters.driverId) {
      values.push(filters.driverId);
      conditions.push(`s.driver_id = $${values.length}::uuid`);
    }
    if (filters.vehicleId) {
      values.push(filters.vehicleId);
      conditions.push(`s.vehicle_id = $${values.length}::uuid`);
    }
    if (!filters.includeLoaded) {
      conditions.push('r.loaded_at is null');
    }
    if (filters.onlyWithData) {
      conditions.push(`
        (
          coalesce(nullif(trim(r.receipt_no), ''), '') <> ''
          or coalesce(nullif(trim(r.destination), ''), '') <> ''
          or coalesce(nullif(trim(r.sender_name), ''), '') <> ''
          or coalesce(nullif(trim(r.receiver_name), ''), '') <> ''
          or coalesce(nullif(trim(r.parcel_type), ''), '') <> ''
          or coalesce(r.parcel_count, 0) > 0
          or coalesce(r.weight_kg::numeric, 0) > 0
          or coalesce(r.collect_amount_usd, 0) <> 0
          or coalesce(r.prepaid_amount_usd, 0) <> 0
          or coalesce(r.hawala_amount_usd, 0) <> 0
          or coalesce(r.transfer_service_fee_usd, 0) <> 0
          or coalesce(r.fees_amount_usd, 0) <> 0
          or coalesce(nullif(trim(r.notes), ''), '') <> ''
          or r.posted_shipment_id is not null
          or r.loaded_at is not null
        )
      `);
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
        s.driver_label,
        s.driver_id,
        s.vehicle_id
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

      if (input.rowId) {
        const updated = await client.query<DailyLedgerRowWithSession>(
          `
          update daily_ledger_rows r
          set
            receipt_no = $3,
            destination = $4,
            parcel_type = $5,
            parcel_count = $6,
            weight_kg = $7,
            sender_name = $8,
            receiver_name = $9,
            collect_amount_usd = $10,
            prepaid_amount_usd = $11,
            hawala_amount_usd = $12,
            fees_amount_usd = $13,
            transfer_service_fee_usd = $14,
            notes = $15,
            updated_by = $16,
            updated_at = now()
          from daily_ledger_sessions s
          join branches b on b.id = s.branch_id
          where r.id = $1
            and r.session_id = s.id
            and r.deleted_at is null
            and s.deleted_at is null
            and b.company_id = $2
            and s.branch_id = $17
            and r.loaded_at is null
          returning
            r.*,
            s.branch_id,
            s.ledger_date,
            s.line_label,
            s.origin_label,
            s.trip_no,
            s.vehicle_label,
            s.driver_label,
            s.driver_id,
            s.vehicle_id
          `,
          [
            input.rowId,
            scope.companyId,
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
            input.branchId,
          ],
        );
        if (!updated.rows.length) {
          throw new HttpError(
            409,
            'تعذر تحديث السطر — ربما تم تحميله على بيان أو لا ينتمي للفرع المحدد.',
          );
        }
        await client.query('commit');
        return updated.rows[0];
      }

      const session = await client.query<DailyLedgerSession>(
        `
        insert into daily_ledger_sessions(
          company_id, branch_id, ledger_date, line_label, origin_label,
          trip_no, vehicle_label, driver_label, driver_id, vehicle_id,
          created_by, updated_by
        )
        values($1,$2,$3::date,$4,$5,$6,$7,$8,$9,$10,$11,$11)
        on conflict (
          company_id,
          branch_id,
          ledger_date,
          line_label,
          (coalesce(driver_id, '00000000-0000-0000-0000-000000000000'::uuid))
        ) where deleted_at is null
        do update set
          origin_label = excluded.origin_label,
          trip_no = coalesce(excluded.trip_no, daily_ledger_sessions.trip_no),
          vehicle_label = coalesce(excluded.vehicle_label, daily_ledger_sessions.vehicle_label),
          driver_label = coalesce(excluded.driver_label, daily_ledger_sessions.driver_label),
          driver_id = coalesce(excluded.driver_id, daily_ledger_sessions.driver_id),
          vehicle_id = coalesce(excluded.vehicle_id, daily_ledger_sessions.vehicle_id),
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
          input.driverId ?? null,
          input.vehicleId ?? null,
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
          $23::text as driver_label,
          $24::uuid as driver_id,
          $25::uuid as vehicle_id
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
          session.rows[0].driver_id,
          session.rows[0].vehicle_id,
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

  async deleteRows(
    scope: DataScope,
    input: { rowIds: string[]; userId?: string },
    allowedBranchIds: string[],
  ): Promise<{ deletedIds: string[]; blockedIds: string[] }> {
    if (!scope.companyId) {
      throw new Error('Company scope is required.');
    }
    if (!input.rowIds.length) {
      return { deletedIds: [], blockedIds: [] };
    }

    const result = await pool.query<{ id: string }>(
      `
      update daily_ledger_rows r
      set
        deleted_at = now(),
        updated_by = $2,
        updated_at = now()
      from daily_ledger_sessions s
      join branches b on b.id = s.branch_id
      where r.id = any($1::uuid[])
        and r.session_id = s.id
        and r.deleted_at is null
        and s.deleted_at is null
        and b.company_id = $3
        and r.loaded_at is null
        and (
          coalesce(array_length($4::uuid[], 1), 0) = 0
          or s.branch_id = any($4::uuid[])
        )
      returning r.id
      `,
      [input.rowIds, input.userId ?? scope.userId ?? null, scope.companyId, allowedBranchIds ?? []],
    );

    const deletedIds = result.rows.map((row) => row.id);
    const blockedIds = input.rowIds.filter((id) => !deletedIds.includes(id));
    return { deletedIds, blockedIds };
  }
}
