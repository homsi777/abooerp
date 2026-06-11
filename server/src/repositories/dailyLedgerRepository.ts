import type { PoolClient } from 'pg';
import { pool } from '../db/pool.js';
import { resolveDriverIdByLabel } from '../utils/dailyLedgerDriverMatch.js';
import { HttpError } from '../utils/errors.js';
import type { DataScope } from '../utils/scope.js';

function normalizeLedgerReceiptNo(value: string | null | undefined): string {
  return String(value ?? '').trim().replace(/\s+/g, ' ');
}

/** يعلّم الجلسة بأنها تحتاج إعادة طباعة إذا كانت قد طُبعت مسبقاً (تعديل/إضافة بعد الطباعة) */
async function markSessionReprintIfPrinted(
  client: PoolClient,
  sessionId: string | null | undefined,
  reason: string,
): Promise<void> {
  if (!sessionId) return;
  await client.query(
    `
    update daily_ledger_sessions
    set reprint_required = true, reprint_reason = $2, updated_at = now()
    where id = $1::uuid and printed_at is not null and reprint_required = false and deleted_at is null
    `,
    [sessionId, reason],
  );
}

async function assertUniqueLedgerReceiptNo(
  client: PoolClient,
  companyId: string,
  receiptNo: string | null | undefined,
  scope: { branchId: string; ledgerDate: string; lineLabel: string },
  excludeRowId?: string | null,
): Promise<void> {
  const normalized = normalizeLedgerReceiptNo(receiptNo);
  if (!normalized) return;

  const ledgerDup = await client.query<{
    row_no: number;
    ledger_date: string;
    line_label: string;
    posted: boolean;
  }>(
    `
    select
      r.row_no,
      s.ledger_date::text as ledger_date,
      s.line_label,
      (r.posted_shipment_id is not null) as posted
    from daily_ledger_rows r
    join daily_ledger_sessions s on s.id = r.session_id
    where s.company_id = $1::uuid
      and s.deleted_at is null
      and r.deleted_at is null
      and s.branch_id = $2::uuid
      and s.ledger_date = $3::date
      and s.line_label = $4
      and lower(trim(r.receipt_no)) = lower($5)
      and ($6::uuid is null or r.id <> $6::uuid)
    order by (r.posted_shipment_id is not null) desc, r.row_no asc
    limit 1
    `,
    [companyId, scope.branchId, scope.ledgerDate, scope.lineLabel, normalized, excludeRowId ?? null],
  );
  if (ledgerDup.rows.length) {
    const hit = ledgerDup.rows[0];
    const where = hit.posted ? 'محفوظ مسبقاً في هذا الدفتر' : 'في هذا الدفتر';
    throw new HttpError(
      409,
      `رقم الإيصال مكرر ${where} (${hit.ledger_date} — ${hit.line_label} — سطر ${hit.row_no}): ${normalized}`,
    );
  }
}

async function resolveExistingLedgerRowIdByReceipt(
  client: PoolClient,
  companyId: string,
  scope: { branchId: string; ledgerDate: string; lineLabel: string },
  receiptNo: string | null | undefined,
): Promise<string | null> {
  const normalized = normalizeLedgerReceiptNo(receiptNo);
  if (!normalized) return null;

  const existing = await client.query<{ id: string }>(
    `
    select r.id
    from daily_ledger_rows r
    join daily_ledger_sessions s on s.id = r.session_id
    where s.company_id = $1::uuid
      and s.deleted_at is null
      and r.deleted_at is null
      and s.branch_id = $2::uuid
      and s.ledger_date = $3::date
      and s.line_label = $4
      and lower(trim(r.receipt_no)) = lower($5)
    order by r.updated_at desc, r.row_no asc
    limit 1
    `,
    [companyId, scope.branchId, scope.ledgerDate, scope.lineLabel, normalized],
  );
  return existing.rows[0]?.id ?? null;
}

async function resolveDriverLabel(
  client: PoolClient,
  resolvedDriverId: string | null,
  driverLabel: string | null | undefined,
): Promise<string | null> {
  const trimmed = String(driverLabel ?? '').trim().replace(/\s+/g, ' ');
  if (trimmed) return trimmed;
  if (!resolvedDriverId) return null;
  const result = await client.query<{ full_name: string }>(
    `select full_name from drivers where id = $1::uuid limit 1`,
    [resolvedDriverId],
  );
  const name = String(result.rows[0]?.full_name ?? '').trim().replace(/\s+/g, ' ');
  return name || null;
}

async function ensureDriverSession(
  client: PoolClient,
  scope: DataScope,
  input: DailyLedgerUpsertInput,
  resolvedDriverId: string | null,
  resolvedDriverLabel: string | null,
): Promise<DailyLedgerSession> {
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
      resolvedDriverLabel,
      resolvedDriverId,
      input.vehicleId ?? null,
      input.userId ?? scope.userId ?? null,
    ],
  );
  return session.rows[0];
}

async function nextRowNoForSession(client: PoolClient, sessionId: string): Promise<number> {
  const result = await client.query<{ max_no: number | null }>(
    `select max(row_no) as max_no from daily_ledger_rows where session_id = $1::uuid and deleted_at is null`,
    [sessionId],
  );
  return (Number(result.rows[0]?.max_no) || 0) + 1;
}

/** ينقل السطر إلى جلسة السائق إذا كان محفوظاً في جلسة «بدون سائق» أو سائق مختلف */
async function migrateRowToDriverSessionIfNeeded(
  client: PoolClient,
  scope: DataScope,
  rowId: string,
  input: DailyLedgerUpsertInput,
  resolvedDriverId: string | null,
  resolvedDriverLabel: string | null,
): Promise<void> {
  if (!resolvedDriverId) return;

  const current = await client.query<{ session_id: string; driver_id: string | null }>(
    `
    select r.session_id, s.driver_id
    from daily_ledger_rows r
    join daily_ledger_sessions s on s.id = r.session_id
    join branches b on b.id = s.branch_id
    where r.id = $1::uuid
      and r.deleted_at is null
      and s.deleted_at is null
      and b.company_id = $2::uuid
    `,
    [rowId, scope.companyId],
  );
  if (!current.rows.length) return;

  const { session_id: currentSessionId, driver_id: currentDriverId } = current.rows[0];
  if (currentDriverId === resolvedDriverId) return;

  const targetSession = await ensureDriverSession(
    client,
    scope,
    input,
    resolvedDriverId,
    resolvedDriverLabel,
  );
  if (targetSession.id === currentSessionId) return;

  const nextRowNo = await nextRowNoForSession(client, targetSession.id);
  await client.query(
    `
    update daily_ledger_rows
    set session_id = $2::uuid, row_no = $3, updated_at = now()
    where id = $1::uuid
    `,
    [rowId, targetSession.id, nextRowNo],
  );
}

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
  session_id: string;
  branch_id: string;
  ledger_date: string;
  line_label: string;
  origin_label: string;
  trip_no: string | null;
  vehicle_label: string | null;
  driver_label: string | null;
  driver_id: string | null;
  vehicle_id: string | null;
  session_printed_at: string | null;
  session_reprint_required: boolean | null;
  session_reprint_reason: string | null;
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
  /** عند مدخل البيانات: يُقيّد العرض بأسطر هذا المستخدم فقط */
  createdByUserId?: string;
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
  /** عند مدخل البيانات: يُسمح بتعديل أسطر هذا المستخدم فقط */
  restrictToCreatedByUserId?: string;
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
    if (filters.createdByUserId) {
      values.push(filters.createdByUserId);
      conditions.push(`r.created_by = $${values.length}::uuid`);
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
        s.vehicle_id,
        s.printed_at as session_printed_at,
        s.reprint_required as session_reprint_required,
        s.reprint_reason as session_reprint_reason
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

  /** الجلسات المخصّصة لأسطر معيّنة (تُستخدم لتعليم إعادة الطباعة عند النقل) */
  async getSessionIdsForRows(companyId: string, rowIds: string[]): Promise<string[]> {
    if (!rowIds.length) return [];
    const result = await pool.query<{ session_id: string }>(
      `
      select distinct r.session_id
      from daily_ledger_rows r
      join daily_ledger_sessions s on s.id = r.session_id
      where r.id = any($1::uuid[]) and s.company_id = $2::uuid and s.deleted_at is null
      `,
      [rowIds, companyId],
    );
    return result.rows.map((row) => row.session_id);
  }

  /** يسجّل حدث طباعة لجلسة ويحدّث حقول الطباعة ويمسح علامة "أعد الطباعة" */
  async recordSessionPrint(
    scope: DataScope,
    input: {
      sessionId: string;
      printType?: string;
      printScope?: string;
      rowCount?: number;
      piecesCount?: number;
      weightKg?: number;
    },
  ): Promise<void> {
    if (!scope.companyId) throw new HttpError(400, 'Company scope is required.');
    const client = await pool.connect();
    try {
      await client.query('begin');
      const session = await client.query<{ id: string }>(
        `select id from daily_ledger_sessions where id = $1::uuid and company_id = $2::uuid and deleted_at is null for update`,
        [input.sessionId, scope.companyId],
      );
      if (!session.rowCount) {
        await client.query('rollback');
        return;
      }
      await client.query(
        `
        update daily_ledger_sessions
        set
          printed_at = coalesce(printed_at, now()),
          last_printed_at = now(),
          printed_by = coalesce($2::uuid, printed_by),
          print_count = print_count + 1,
          reprint_required = false,
          reprint_reason = null,
          updated_at = now()
        where id = $1::uuid
        `,
        [input.sessionId, scope.userId ?? null],
      );
      await client.query(
        `
        insert into daily_ledger_print_events(
          company_id, session_id, print_type, print_scope,
          row_count, pieces_count, weight_kg, printed_by
        )
        values($1,$2,$3,$4,$5,$6,$7,$8)
        `,
        [
          scope.companyId,
          input.sessionId,
          input.printType ?? 'session',
          input.printScope ?? null,
          input.rowCount ?? 0,
          input.piecesCount ?? 0,
          input.weightKg ?? 0,
          scope.userId ?? null,
        ],
      );
      await client.query('commit');
    } catch (error) {
      await client.query('rollback');
      throw error;
    } finally {
      client.release();
    }
  }

  async upsertRow(scope: DataScope, input: DailyLedgerUpsertInput): Promise<DailyLedgerRowWithSession> {
    if (!scope.companyId) {
      throw new Error('Company scope is required.');
    }
    const client = await pool.connect();
    try {
      await client.query('begin');

      const ledgerScope = {
        branchId: input.branchId,
        ledgerDate: input.ledgerDate,
        lineLabel: input.lineLabel,
      };

      let effectiveRowId = input.rowId ?? null;
      if (!effectiveRowId) {
        effectiveRowId = await resolveExistingLedgerRowIdByReceipt(
          client,
          scope.companyId,
          ledgerScope,
          input.receiptNo,
        );
      }

      await assertUniqueLedgerReceiptNo(
        client,
        scope.companyId,
        input.receiptNo,
        ledgerScope,
        effectiveRowId,
      );

      if (effectiveRowId) {
        const resolvedDriverId =
          input.driverId ?? (await resolveDriverIdByLabel(client, input.driverLabel));
        const resolvedDriverLabel = await resolveDriverLabel(
          client,
          resolvedDriverId,
          input.driverLabel,
        );
        await migrateRowToDriverSessionIfNeeded(
          client,
          scope,
          effectiveRowId,
          input,
          resolvedDriverId,
          resolvedDriverLabel,
        );

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
            and ($18::uuid is null or r.created_by = $18::uuid)
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
            effectiveRowId,
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
            input.restrictToCreatedByUserId ?? null,
          ],
        );
        if (!updated.rows.length) {
          throw new HttpError(
            409,
            input.restrictToCreatedByUserId
              ? 'تعذر تحديث السطر — لا يمكنك تعديل إدخال موظف آخر.'
              : 'تعذر تحديث السطر — ربما تم تحميله على بيان أو لا ينتمي للفرع المحدد.',
          );
        }
        await markSessionReprintIfPrinted(client, updated.rows[0].session_id, 'تعديل سطر بعد الطباعة');
        await client.query('commit');
        return updated.rows[0];
      }

      const resolvedDriverId =
        input.driverId ?? (await resolveDriverIdByLabel(client, input.driverLabel));
      const resolvedDriverLabel = await resolveDriverLabel(
        client,
        resolvedDriverId,
        input.driverLabel,
      );

      const session = await ensureDriverSession(
        client,
        scope,
        input,
        resolvedDriverId,
        resolvedDriverLabel,
      );

      const sessionId = session.id;

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
        where $26::uuid is null or daily_ledger_rows.created_by = $26::uuid
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
          session.branch_id,
          session.ledger_date,
          session.line_label,
          session.origin_label,
          session.trip_no,
          session.vehicle_label,
          session.driver_label,
          session.driver_id,
          session.vehicle_id,
          input.restrictToCreatedByUserId ?? null,
        ],
      );

      if (!row.rows.length && input.restrictToCreatedByUserId) {
        throw new HttpError(409, 'تعذر حفظ السطر — رقم السطر محجوز بإدخال موظف آخر.');
      }

      await markSessionReprintIfPrinted(client, sessionId, 'إضافة/تعديل سطر بعد الطباعة');
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

  /**
   * يحلّ إرسالية (جلسة سائق/مركبة): ينقل الأسطر إلى جلسة «بدون سائق» ويُخفِي الجلسة من القائمة.
   * لا يحذف بيانات الأسطر (إيصال، مبالغ، …).
   */
  async cancelSession(
    scope: DataScope,
    input: { sessionId: string; userId?: string; createdByUserId?: string },
    allowedBranchIds: string[],
  ): Promise<{ movedRowsCount: number; poolSessionId: string }> {
    if (!scope.companyId) {
      throw new Error('Company scope is required.');
    }

    const client = await pool.connect();
    try {
      await client.query('begin');

      const sessionResult = await client.query<DailyLedgerSession>(
        `
        select s.*
        from daily_ledger_sessions s
        where s.id = $1::uuid
          and s.company_id = $2::uuid
          and s.deleted_at is null
        for update
        `,
        [input.sessionId, scope.companyId],
      );
      const session = sessionResult.rows[0];
      if (!session) {
        throw new HttpError(404, 'الإرسالية غير موجودة أو محذوفة مسبقاً.');
      }

      if (
        allowedBranchIds.length &&
        !allowedBranchIds.includes(session.branch_id)
      ) {
        throw new HttpError(403, 'لا يمكن إلغاء إرسالية خارج نطاق الفروع المسموح.');
      }

      if (!session.driver_id && !session.vehicle_id) {
        throw new HttpError(409, 'لا يمكن إلغاء جلسة «الكل» — اختر إرسالية محددة (سائق/مركبة).');
      }

      const rowsResult = await client.query<{ id: string; row_no: number; receipt_no: string | null; loaded_at: string | null; created_by: string | null }>(
        `
        select r.id, r.row_no, r.receipt_no, r.loaded_at, r.created_by
        from daily_ledger_rows r
        where r.session_id = $1::uuid
          and r.deleted_at is null
        order by r.row_no asc
        for update
        `,
        [input.sessionId],
      );
      const rows = rowsResult.rows;

      if (rows.some((row) => row.loaded_at)) {
        throw new HttpError(
          409,
          'لا يمكن إلغاء إرسالية تحتوي أسطراً محمّلة على بيان — أزل التحميل أولاً أو انقل الأسطر غير المحمّلة.',
        );
      }

      if (input.createdByUserId && rows.some((row) => row.created_by !== input.createdByUserId)) {
        throw new HttpError(409, 'لا يمكنك إلغاء إرسالية تحتوي إدخالات موظفين آخرين.');
      }

      const poolSession = await ensureDriverSession(
        client,
        scope,
        {
          branchId: session.branch_id,
          ledgerDate: session.ledger_date,
          lineLabel: session.line_label,
          originLabel: session.origin_label,
          tripNo: null,
          vehicleLabel: null,
          driverLabel: null,
          driverId: null,
          vehicleId: null,
          rowNo: 1,
          userId: input.userId ?? scope.userId,
        },
        null,
        null,
      );

      if (poolSession.id === session.id) {
        throw new HttpError(409, 'لا يمكن إلغاء هذه الإرسالية.');
      }

      let movedRowsCount = 0;
      if (rows.length) {
        const movingReceipts = rows
          .map((row) => normalizeLedgerReceiptNo(row.receipt_no))
          .filter((value) => value.length > 0);
        if (movingReceipts.length) {
          const dup = await client.query<{ receipt_no: string | null; row_no: number }>(
            `
            select r.receipt_no, r.row_no
            from daily_ledger_rows r
            where r.session_id = $1::uuid
              and r.deleted_at is null
              and r.id <> all($2::uuid[])
              and lower(trim(r.receipt_no)) = any($3::text[])
            limit 1
            `,
            [poolSession.id, rows.map((row) => row.id), movingReceipts.map((r) => r.toLowerCase())],
          );
          if (dup.rows[0]) {
            throw new HttpError(
              409,
              `تعارض أرقام إيصالات: «${dup.rows[0].receipt_no}» موجود في الدفتر الرئيسي (سطر ${dup.rows[0].row_no}) — عدّل أو احذف المكرر أولاً.`,
            );
          }
        }

        let nextRowNo = await nextRowNoForSession(client, poolSession.id);
        for (const row of rows) {
          await client.query(
            `
            update daily_ledger_rows
            set session_id = $2::uuid, row_no = $3, updated_by = $4, updated_at = now()
            where id = $1::uuid
            `,
            [row.id, poolSession.id, nextRowNo, input.userId ?? scope.userId ?? null],
          );
          nextRowNo += 1;
          movedRowsCount += 1;
        }
      }

      await client.query(
        `
        update daily_ledger_sessions
        set deleted_at = now(), updated_by = $2, updated_at = now()
        where id = $1::uuid
        `,
        [input.sessionId, input.userId ?? scope.userId ?? null],
      );

      await client.query('commit');
      return { movedRowsCount, poolSessionId: poolSession.id };
    } catch (error) {
      await client.query('rollback');
      throw error;
    } finally {
      client.release();
    }
  }

  async deleteRows(
    scope: DataScope,
    input: { rowIds: string[]; userId?: string; createdByUserId?: string },
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
        and ($5::uuid is null or r.created_by = $5::uuid)
      returning r.id
      `,
      [
        input.rowIds,
        input.userId ?? scope.userId ?? null,
        scope.companyId,
        allowedBranchIds ?? [],
        input.createdByUserId ?? null,
      ],
    );

    const deletedIds = result.rows.map((row) => row.id);
    const blockedIds = input.rowIds.filter((id) => !deletedIds.includes(id));
    return { deletedIds, blockedIds };
  }
}
