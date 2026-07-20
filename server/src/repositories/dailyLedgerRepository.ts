import type { PoolClient } from 'pg';
import { pool } from '../db/pool.js';
import { resolveDriverIdByLabel } from '../utils/dailyLedgerDriverMatch.js';
import { HttpError } from '../utils/errors.js';
import type { DataScope } from '../utils/scope.js';
import { appendAgentPrintDocumentScope } from '../utils/agentDocumentationScope.js';
import { resolveFleetFromDispatchDefinition } from './dailyLedgerDispatchRepository.js';

function normalizeLedgerReceiptNo(value: string | null | undefined): string {
  return String(value ?? '').trim().replace(/\s+/g, ' ');
}

/** التحصيل (COD) والدفع المسبق حصريان — لا يجوز إدخالهما معاً في نفس السطر. */
function exclusiveCollectPrepaidAmounts(collect?: number, prepaid?: number) {
  const collectAmountUsd = Math.round(Number(collect ?? 0) * 100) / 100;
  const prepaidAmountUsd = Math.round(Number(prepaid ?? 0) * 100) / 100;
  if (collectAmountUsd > 0 && prepaidAmountUsd > 0) {
    return { collectAmountUsd, prepaidAmountUsd: 0 };
  }
  return { collectAmountUsd, prepaidAmountUsd };
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
  // Lock the session so concurrent inserts cannot allocate the same row_no.
  await client.query(`select id from daily_ledger_sessions where id = $1::uuid for update`, [sessionId]);
  const result = await client.query<{ max_no: number | null }>(
    `select max(row_no) as max_no from daily_ledger_rows where session_id = $1::uuid and deleted_at is null`,
    [sessionId],
  );
  return (Number(result.rows[0]?.max_no) || 0) + 1;
}

/** يستخرج نطاق الجلسة الفعلي من السطر المحفوظ — لا يعتمد على بيانات الواجهة */
async function resolveRowSessionScopeForUpsert(
  client: PoolClient,
  companyId: string,
  rowId: string,
): Promise<{ branchId: string; ledgerDate: string; lineLabel: string } | null> {
  const result = await client.query<{
    branch_id: string;
    ledger_date: string;
    line_label: string;
  }>(
    `
    select
      s.branch_id,
      s.ledger_date::text as ledger_date,
      s.line_label
    from daily_ledger_rows r
    join daily_ledger_sessions s on s.id = r.session_id
    join branches b on b.id = s.branch_id
    where r.id = $1::uuid
      and r.deleted_at is null
      and s.deleted_at is null
      and b.company_id = $2::uuid
    limit 1
    `,
    [rowId, companyId],
  );
  const hit = result.rows[0];
  if (!hit?.branch_id || !hit.ledger_date) return null;
  return {
    branchId: hit.branch_id,
    ledgerDate: hit.ledger_date,
    lineLabel: hit.line_label ?? '',
  };
}

/** ينقل السطر إلى جلسة السائق/التاريخ المطلوب إذا اختلفت عن الجلسة الحالية */
async function migrateRowToDriverSessionIfNeeded(
  client: PoolClient,
  scope: DataScope,
  rowId: string,
  input: DailyLedgerUpsertInput,
  resolvedDriverId: string | null,
  resolvedDriverLabel: string | null,
): Promise<void> {
  const current = await client.query<{ session_id: string }>(
    `
    select r.session_id
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

  const targetSession = await ensureDriverSession(
    client,
    scope,
    input,
    resolvedDriverId,
    resolvedDriverLabel,
  );
  if (targetSession.id === current.rows[0].session_id) return;

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
  dispatch_id: string | null;
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
  dispatch_no?: number | null;
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
  receiptNo?: string;
  parcelType?: string;
  senderName?: string;
  receiverName?: string;
  limit: number;
  offset: number;
}

export type DailyLedgerPrintDocumentRowSnapshot = {
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
  sessionId: string | null;
};

export type DailyLedgerPrintDocumentInput = {
  branchId?: string | null;
  ledgerDate: string;
  ledgerDateTo?: string | null;
  lineLabel?: string | null;
  originLabel?: string | null;
  driverId?: string | null;
  driverLabel?: string | null;
  destinationLabel?: string | null;
  searchQuery?: string | null;
  printType?: string;
  printScope?: string | null;
  title?: string | null;
  rowCount?: number;
  piecesCount?: number;
  weightKg?: number;
  collectTotalUsd?: number;
  prepaidTotalUsd?: number;
  hawalaTotalUsd?: number;
  transferFeeTotalUsd?: number;
  rowsSnapshot?: DailyLedgerPrintDocumentRowSnapshot[];
};

export type DailyLedgerPrintDocument = DailyLedgerPrintDocumentInput & {
  id: string;
  company_id: string;
  rows_snapshot: DailyLedgerPrintDocumentRowSnapshot[];
  printed_by: string | null;
  printed_at: string;
  created_at: string;
  branch_name?: string | null;
  printed_by_name?: string | null;
  printed_by_username?: string | null;
};

export type DailyLedgerPrintDocumentSummary = {
  id: string;
  branch_id: string | null;
  branch_name: string | null;
  ledger_date: string;
  ledger_date_to: string | null;
  line_label: string | null;
  driver_id: string | null;
  driver_label: string | null;
  destination_label: string | null;
  search_query: string | null;
  print_type: string;
  print_scope: string | null;
  title: string | null;
  row_count: number;
  pieces_count: number;
  weight_kg: string;
  collect_total_usd: string;
  prepaid_total_usd: string;
  hawala_total_usd: string;
  transfer_fee_total_usd: string;
  printed_at: string;
  printed_by_name: string | null;
  printed_by_username: string | null;
};

export type DailyLedgerPrintDocumentListFilters = {
  branchId?: string;
  dateFrom?: string;
  dateTo?: string;
  driverId?: string;
  destination?: string;
  searchQuery?: string;
  limit?: number;
  offset?: number;
};

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
  /** تعريف الإرسالية (النظام الجديد) — يُستخرج منه السائق/المركبة عند الحفظ */
  dispatchId?: string | null;
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
      const raw = filters.q.trim();
      const tokens = raw.split(/\s+/).filter(Boolean);
      if (tokens.length <= 1) {
        const q = `%${raw}%`;
        values.push(q);
        const qp = `$${values.length}`;
        conditions.push(
          `(
            coalesce(r.receipt_no,'') ilike ${qp}
            or coalesce(r.destination,'') ilike ${qp}
            or coalesce(r.parcel_type,'') ilike ${qp}
            or coalesce(r.sender_name,'') ilike ${qp}
            or coalesce(r.receiver_name,'') ilike ${qp}
            or coalesce(r.notes,'') ilike ${qp}
          )`,
        );
      } else {
        const tokenClauses: string[] = [];
        for (const token of tokens) {
          values.push(`%${token}%`);
          const qp = `$${values.length}`;
          tokenClauses.push(
            `(
              coalesce(r.receipt_no,'') ilike ${qp}
              or coalesce(r.destination,'') ilike ${qp}
              or coalesce(r.parcel_type,'') ilike ${qp}
              or coalesce(r.sender_name,'') ilike ${qp}
              or coalesce(r.receiver_name,'') ilike ${qp}
              or coalesce(r.notes,'') ilike ${qp}
            )`,
          );
        }
        conditions.push(`(${tokenClauses.join(' and ')})`);
      }
    }
    if (filters.receiptNo?.trim()) {
      values.push(`%${filters.receiptNo.trim()}%`);
      conditions.push(`coalesce(r.receipt_no,'') ilike $${values.length}`);
    }
    if (filters.parcelType?.trim()) {
      values.push(`%${filters.parcelType.trim()}%`);
      conditions.push(`coalesce(r.parcel_type,'') ilike $${values.length}`);
    }
    if (filters.senderName?.trim()) {
      values.push(`%${filters.senderName.trim()}%`);
      conditions.push(`coalesce(r.sender_name,'') ilike $${values.length}`);
    }
    if (filters.receiverName?.trim()) {
      values.push(`%${filters.receiverName.trim()}%`);
      conditions.push(`coalesce(r.receiver_name,'') ilike $${values.length}`);
    }

    values.push(filters.limit);
    const limitParam = `$${values.length}`;
    values.push(filters.offset);
    const offsetParam = `$${values.length}`;

    const result = await pool.query<DailyLedgerRowWithSession>(
      `
      select
        r.id,
        r.session_id,
        r.row_no,
        r.receipt_no,
        r.destination,
        r.parcel_type,
        r.parcel_count,
        r.weight_kg,
        r.sender_name,
        r.receiver_name,
        r.collect_amount_usd,
        r.prepaid_amount_usd,
        r.hawala_amount_usd,
        r.fees_amount_usd,
        r.transfer_service_fee_usd,
        r.notes,
        r.posted_shipment_id,
        r.posted_at,
        r.loaded_manifest_id,
        r.loaded_at,
        r.dispatch_id,
        r.created_by,
        r.updated_by,
        r.created_at,
        r.updated_at,
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
        s.reprint_reason as session_reprint_reason,
        d.dispatch_no
      from daily_ledger_rows r
      join daily_ledger_sessions s on s.id = r.session_id
      left join daily_ledger_dispatch_definitions d
        on d.id = r.dispatch_id and d.deleted_at is null
      where ${conditions.join(' and ')}
      order by s.ledger_date desc, s.created_at desc, r.row_no asc
      limit ${limitParam}
      offset ${offsetParam}
      `,
      values,
    );
    return result.rows;
  }

  async listDuplicateReceiptGroups(
    scope: DataScope,
    filters: {
      branchId?: string;
      dateFrom?: string;
      dateTo?: string;
      createdByUserId?: string;
      /** نفس اليوم+الخط فقط | كل التكرارات عبر التواريخ | كلاهما */
      scopeMode?: 'same_day' | 'cross_date' | 'all';
      limit?: number;
    },
  ): Promise<{
    groups: Array<{
      kind: 'same_day_line' | 'cross_date';
      receipt_no: string;
      count: number;
      hawala_sum: string;
      transfer_fee_sum: string;
      collect_sum: string;
      prepaid_sum: string;
      rows: Array<{
        id: string;
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
        loaded_at: string | null;
        created_at: string;
        branch_id: string;
        branch_name: string | null;
        ledger_date: string;
        line_label: string;
        driver_label: string | null;
        dispatch_no: number | null;
      }>;
    }>;
    summary: {
      sameDayGroups: number;
      crossDateGroups: number;
      totalDuplicateRows: number;
    };
  }> {
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
    if (filters.dateFrom) {
      values.push(filters.dateFrom);
      conditions.push(`s.ledger_date >= $${values.length}::date`);
    }
    if (filters.dateTo) {
      values.push(filters.dateTo);
      conditions.push(`s.ledger_date <= $${values.length}::date`);
    }
    if (filters.createdByUserId) {
      values.push(filters.createdByUserId);
      conditions.push(`r.created_by = $${values.length}::uuid`);
    }
    conditions.push(`coalesce(nullif(trim(r.receipt_no), ''), '') <> ''`);

    const limit = Math.min(Math.max(filters.limit ?? 200, 1), 500);
    const scopeMode = filters.scopeMode ?? 'all';
    values.push(scopeMode);
    const scopeModeParam = `$${values.length}`;
    values.push(limit);
    const limitParam = `$${values.length}`;
    const whereSql = conditions.join(' and ');

    const result = await pool.query<{
      kind: 'same_day_line' | 'cross_date';
      receipt_no: string;
      count: number;
      hawala_sum: string;
      transfer_fee_sum: string;
      collect_sum: string;
      prepaid_sum: string;
      rows_json: unknown;
    }>(
      `
      with filtered as (
        select
          r.id,
          r.row_no,
          r.receipt_no,
          r.destination,
          r.parcel_type,
          r.parcel_count,
          r.weight_kg::text as weight_kg,
          r.sender_name,
          r.receiver_name,
          r.collect_amount_usd::text as collect_amount_usd,
          r.prepaid_amount_usd::text as prepaid_amount_usd,
          r.hawala_amount_usd::text as hawala_amount_usd,
          r.fees_amount_usd::text as fees_amount_usd,
          r.transfer_service_fee_usd::text as transfer_service_fee_usd,
          r.notes,
          r.posted_shipment_id,
          r.loaded_at,
          r.created_at,
          s.branch_id,
          b.name as branch_name,
          s.ledger_date::text as ledger_date,
          s.line_label,
          s.driver_label,
          d.dispatch_no,
          lower(trim(r.receipt_no)) as receipt_key
        from daily_ledger_rows r
        join daily_ledger_sessions s on s.id = r.session_id
        join branches b on b.id = s.branch_id
        left join daily_ledger_dispatch_definitions d
          on d.id = r.dispatch_id and d.deleted_at is null
        where ${whereSql}
      ),
      same_day_keys as (
        select receipt_key, ledger_date, line_label, branch_id
        from filtered
        group by receipt_key, ledger_date, line_label, branch_id
        having count(*) > 1
      ),
      cross_date_keys as (
        select receipt_key
        from filtered
        group by receipt_key
        having count(distinct ledger_date) > 1
      ),
      same_day_groups as (
        select
          'same_day_line'::text as kind,
          f.receipt_key as receipt_no,
          count(*)::int as count,
          coalesce(sum(f.hawala_amount_usd::numeric), 0)::text as hawala_sum,
          coalesce(sum(f.transfer_service_fee_usd::numeric), 0)::text as transfer_fee_sum,
          coalesce(sum(f.collect_amount_usd::numeric + f.fees_amount_usd::numeric), 0)::text as collect_sum,
          coalesce(sum(f.prepaid_amount_usd::numeric), 0)::text as prepaid_sum,
          jsonb_agg(
            jsonb_build_object(
              'id', f.id,
              'row_no', f.row_no,
              'receipt_no', f.receipt_no,
              'destination', f.destination,
              'parcel_type', f.parcel_type,
              'parcel_count', f.parcel_count,
              'weight_kg', f.weight_kg,
              'sender_name', f.sender_name,
              'receiver_name', f.receiver_name,
              'collect_amount_usd', f.collect_amount_usd,
              'prepaid_amount_usd', f.prepaid_amount_usd,
              'hawala_amount_usd', f.hawala_amount_usd,
              'fees_amount_usd', f.fees_amount_usd,
              'transfer_service_fee_usd', f.transfer_service_fee_usd,
              'notes', f.notes,
              'posted_shipment_id', f.posted_shipment_id,
              'loaded_at', f.loaded_at,
              'created_at', f.created_at,
              'branch_id', f.branch_id,
              'branch_name', f.branch_name,
              'ledger_date', f.ledger_date,
              'line_label', f.line_label,
              'driver_label', f.driver_label,
              'dispatch_no', f.dispatch_no
            )
            order by f.ledger_date desc, f.row_no asc
          ) as rows_json
        from filtered f
        join same_day_keys k
          on k.receipt_key = f.receipt_key
         and k.ledger_date = f.ledger_date
         and k.line_label = f.line_label
         and k.branch_id = f.branch_id
        group by f.receipt_key, f.ledger_date, f.line_label, f.branch_id
      ),
      cross_date_groups as (
        select
          'cross_date'::text as kind,
          f.receipt_key as receipt_no,
          count(*)::int as count,
          coalesce(sum(f.hawala_amount_usd::numeric), 0)::text as hawala_sum,
          coalesce(sum(f.transfer_service_fee_usd::numeric), 0)::text as transfer_fee_sum,
          coalesce(sum(f.collect_amount_usd::numeric + f.fees_amount_usd::numeric), 0)::text as collect_sum,
          coalesce(sum(f.prepaid_amount_usd::numeric), 0)::text as prepaid_sum,
          jsonb_agg(
            jsonb_build_object(
              'id', f.id,
              'row_no', f.row_no,
              'receipt_no', f.receipt_no,
              'destination', f.destination,
              'parcel_type', f.parcel_type,
              'parcel_count', f.parcel_count,
              'weight_kg', f.weight_kg,
              'sender_name', f.sender_name,
              'receiver_name', f.receiver_name,
              'collect_amount_usd', f.collect_amount_usd,
              'prepaid_amount_usd', f.prepaid_amount_usd,
              'hawala_amount_usd', f.hawala_amount_usd,
              'fees_amount_usd', f.fees_amount_usd,
              'transfer_service_fee_usd', f.transfer_service_fee_usd,
              'notes', f.notes,
              'posted_shipment_id', f.posted_shipment_id,
              'loaded_at', f.loaded_at,
              'created_at', f.created_at,
              'branch_id', f.branch_id,
              'branch_name', f.branch_name,
              'ledger_date', f.ledger_date,
              'line_label', f.line_label,
              'driver_label', f.driver_label,
              'dispatch_no', f.dispatch_no
            )
            order by f.ledger_date desc, f.row_no asc
          ) as rows_json
        from filtered f
        join cross_date_keys k on k.receipt_key = f.receipt_key
        where not exists (
          select 1 from same_day_keys sdk
          where sdk.receipt_key = f.receipt_key
        )
        group by f.receipt_key
      ),
      combined as (
        select * from same_day_groups
        union all
        select * from cross_date_groups
      )
      select *
      from combined
      where (
        ${scopeModeParam} = 'all'
        or (${scopeModeParam} = 'same_day' and kind = 'same_day_line')
        or (${scopeModeParam} = 'cross_date' and kind = 'cross_date')
      )
      order by
        case when kind = 'same_day_line' then 0 else 1 end,
        count desc,
        receipt_no asc
      limit ${limitParam}
      `,
      values,
    );

    const groups = result.rows.map((row) => ({
      kind: row.kind,
      receipt_no: row.receipt_no,
      count: Number(row.count),
      hawala_sum: String(row.hawala_sum ?? '0'),
      transfer_fee_sum: String(row.transfer_fee_sum ?? '0'),
      collect_sum: String(row.collect_sum ?? '0'),
      prepaid_sum: String(row.prepaid_sum ?? '0'),
      rows: (Array.isArray(row.rows_json) ? row.rows_json : []) as Array<{
        id: string;
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
        loaded_at: string | null;
        created_at: string;
        branch_id: string;
        branch_name: string | null;
        ledger_date: string;
        line_label: string;
        driver_label: string | null;
        dispatch_no: number | null;
      }>,
    }));

    return {
      groups,
      summary: {
        sameDayGroups: groups.filter((g) => g.kind === 'same_day_line').length,
        crossDateGroups: groups.filter((g) => g.kind === 'cross_date').length,
        totalDuplicateRows: groups.reduce((sum, g) => sum + g.count, 0),
      },
    };
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
    const amounts = exclusiveCollectPrepaidAmounts(input.collectAmountUsd, input.prepaidAmountUsd);
    input = {
      ...input,
      collectAmountUsd: amounts.collectAmountUsd,
      prepaidAmountUsd: amounts.prepaidAmountUsd,
    };
    const client = await pool.connect();
    try {
      await client.query('begin');

      const requestedScope = {
        branchId: input.branchId,
        ledgerDate: input.ledgerDate,
        lineLabel: input.lineLabel,
      };

      let effectiveRowId = input.rowId ?? null;
      if (!effectiveRowId) {
        effectiveRowId = await resolveExistingLedgerRowIdByReceipt(
          client,
          scope.companyId,
          requestedScope,
          input.receiptNo,
        );
      }

      if (effectiveRowId) {
        const sessionScope = await resolveRowSessionScopeForUpsert(
          client,
          scope.companyId,
          effectiveRowId,
        );
        if (!sessionScope) {
          throw new HttpError(404, 'سطر الدفتر غير موجود أو لا ينتمي لشركتك.');
        }
        const scopeMatchesRequest =
          sessionScope.ledgerDate === requestedScope.ledgerDate &&
          sessionScope.lineLabel === requestedScope.lineLabel &&
          sessionScope.branchId === requestedScope.branchId;
        if (scopeMatchesRequest) {
          input = {
            ...input,
            branchId: sessionScope.branchId,
            ledgerDate: sessionScope.ledgerDate,
            lineLabel: sessionScope.lineLabel,
          };
        }
      }

      if (input.dispatchId) {
        const fleet = await resolveFleetFromDispatchDefinition(
          client,
          scope.companyId,
          input.dispatchId,
          requestedScope,
        );
        input = {
          ...input,
          branchId: fleet.branchId,
          ledgerDate: fleet.ledgerDate,
          lineLabel: fleet.lineLabel,
          driverId: fleet.driverId ?? input.driverId ?? null,
          vehicleId: fleet.vehicleId ?? input.vehicleId ?? null,
          driverLabel: fleet.driverLabel ?? input.driverLabel ?? null,
          vehicleLabel: fleet.vehicleLabel ?? input.vehicleLabel ?? null,
          tripNo: fleet.tripNo ?? input.tripNo ?? null,
        };
      }

      const ledgerScope = {
        branchId: input.branchId,
        ledgerDate: input.ledgerDate,
        lineLabel: input.lineLabel,
      };

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
            dispatch_id = $16,
            updated_by = $17,
            updated_at = now()
          from daily_ledger_sessions s
          join branches b on b.id = s.branch_id
          where r.id = $1
            and r.session_id = s.id
            and r.deleted_at is null
            and s.deleted_at is null
            and b.company_id = $2
            and s.branch_id = $18
            and r.loaded_at is null
            and ($19::uuid is null or r.created_by = $19::uuid)
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
            s.vehicle_id,
            (
              select d.dispatch_no
              from daily_ledger_dispatch_definitions d
              where d.id = r.dispatch_id and d.deleted_at is null
              limit 1
            ) as dispatch_no
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
            input.dispatchId ?? null,
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
      // New rows always get a server-allocated row_no. Never ON CONFLICT DO UPDATE on
      // (session_id, row_no) — that silently overwrote a previous receipt (e.g. 9572 → 12883).
      const allocatedRowNo = await nextRowNoForSession(client, sessionId);

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
          dispatch_id,
          created_by,
          updated_by
        )
        values($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$17)
        returning
          daily_ledger_rows.*,
          $18::uuid as branch_id,
          $19::date as ledger_date,
          $20::text as line_label,
          $21::text as origin_label,
          $22::text as trip_no,
          $23::text as vehicle_label,
          $24::text as driver_label,
          $25::uuid as driver_id,
          $26::uuid as vehicle_id,
          (
            select d.dispatch_no
            from daily_ledger_dispatch_definitions d
            where d.id = daily_ledger_rows.dispatch_id and d.deleted_at is null
            limit 1
          ) as dispatch_no
        `,
        [
          sessionId,
          allocatedRowNo,
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
          input.dispatchId ?? null,
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
        ],
      );

      if (!row.rows.length) {
        throw new HttpError(500, 'تعذر إنشاء سطر الدفتر.');
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

  async fetchRowAuditSnapshots(scope: DataScope, rowIds: string[]): Promise<DailyLedgerRowWithSession[]> {
    if (!scope.companyId || !rowIds.length) return [];
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
      join branches b on b.id = s.branch_id
      where b.company_id = $1
        and r.id = any($2::uuid[])
        and r.deleted_at is null
        and s.deleted_at is null
      `,
      [scope.companyId, rowIds],
    );
    return result.rows;
  }

  async createPrintDocument(
    scope: DataScope,
    input: DailyLedgerPrintDocumentInput,
  ): Promise<DailyLedgerPrintDocument> {
    if (!scope.companyId) throw new HttpError(400, 'Company scope is required.');
    const result = await pool.query<DailyLedgerPrintDocument>(
      `
      insert into daily_ledger_print_documents(
        company_id, branch_id, ledger_date, ledger_date_to, line_label, origin_label,
        driver_id, driver_label, destination_label, search_query,
        print_type, print_scope, title,
        row_count, pieces_count, weight_kg,
        collect_total_usd, prepaid_total_usd, hawala_total_usd, transfer_fee_total_usd,
        rows_snapshot, printed_by
      )
      values($1,$2,$3::date,$4::date,$5,$6,$7::uuid,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21::jsonb,$22::uuid)
      returning *
      `,
      [
        scope.companyId,
        input.branchId ?? null,
        input.ledgerDate,
        input.ledgerDateTo ?? null,
        input.lineLabel ?? null,
        input.originLabel ?? null,
        input.driverId ?? null,
        input.driverLabel ?? null,
        input.destinationLabel ?? null,
        input.searchQuery ?? null,
        input.printType ?? 'shipments',
        input.printScope ?? null,
        input.title ?? null,
        input.rowCount ?? 0,
        input.piecesCount ?? 0,
        input.weightKg ?? 0,
        input.collectTotalUsd ?? 0,
        input.prepaidTotalUsd ?? 0,
        input.hawalaTotalUsd ?? 0,
        input.transferFeeTotalUsd ?? 0,
        JSON.stringify(input.rowsSnapshot ?? []),
        scope.userId ?? null,
      ],
    );
    return result.rows[0];
  }

  async listPrintDocuments(
    scope: DataScope,
    filters: DailyLedgerPrintDocumentListFilters,
  ): Promise<DailyLedgerPrintDocumentSummary[]> {
    if (!scope.companyId) throw new HttpError(400, 'Company scope is required.');
    const conditions = ['d.company_id = $1'];
    const values: unknown[] = [scope.companyId];
    if (filters.branchId) {
      values.push(filters.branchId);
      conditions.push(`d.branch_id = $${values.length}::uuid`);
    }
    if (filters.dateFrom) {
      values.push(filters.dateFrom);
      conditions.push(`d.ledger_date >= $${values.length}::date`);
    }
    if (filters.dateTo) {
      values.push(filters.dateTo);
      conditions.push(`d.ledger_date <= $${values.length}::date`);
    }
    if (filters.driverId) {
      values.push(filters.driverId);
      conditions.push(`d.driver_id = $${values.length}::uuid`);
    }
    if (filters.destination?.trim()) {
      values.push(`%${filters.destination.trim()}%`);
      conditions.push(`coalesce(d.destination_label, '') ilike $${values.length}`);
    }
    if (filters.searchQuery?.trim()) {
      values.push(`%${filters.searchQuery.trim()}%`);
      const qp = `$${values.length}`;
      conditions.push(`(
        coalesce(d.search_query, '') ilike ${qp}
        or coalesce(d.destination_label, '') ilike ${qp}
        or coalesce(d.driver_label, '') ilike ${qp}
        or coalesce(d.title, '') ilike ${qp}
      )`);
    }
    values.push(filters.limit ?? 100);
    const limitParam = `$${values.length}`;
    values.push(filters.offset ?? 0);
    const offsetParam = `$${values.length}`;

    const result = await pool.query<DailyLedgerPrintDocumentSummary>(
      `
      select
        d.id,
        d.branch_id,
        b.name as branch_name,
        d.ledger_date::text as ledger_date,
        d.ledger_date_to::text as ledger_date_to,
        d.line_label,
        d.driver_id,
        d.driver_label,
        d.destination_label,
        d.search_query,
        d.print_type,
        d.print_scope,
        d.title,
        d.row_count,
        d.pieces_count,
        d.weight_kg,
        d.collect_total_usd,
        d.prepaid_total_usd,
        d.hawala_total_usd,
        d.transfer_fee_total_usd,
        d.printed_at,
        u.full_name as printed_by_name,
        u.username as printed_by_username
      from daily_ledger_print_documents d
      left join branches b on b.id = d.branch_id
      left join users u on u.id = d.printed_by
      where ${conditions.join(' and ')}
      order by d.printed_at desc, d.ledger_date desc
      limit ${limitParam}
      offset ${offsetParam}
      `,
      values,
    );
    return result.rows;
  }

  async getPrintDocument(scope: DataScope, documentId: string): Promise<DailyLedgerPrintDocument | null> {
    if (!scope.companyId) throw new HttpError(400, 'Company scope is required.');
    const result = await pool.query<DailyLedgerPrintDocument>(
      `
      select
        d.id,
        d.company_id,
        d.branch_id,
        d.ledger_date::text as ledger_date,
        d.ledger_date_to::text as ledger_date_to,
        d.line_label,
        d.origin_label,
        d.driver_id,
        d.driver_label,
        d.destination_label,
        d.search_query,
        d.print_type,
        d.print_scope,
        d.title,
        d.row_count,
        d.pieces_count,
        d.weight_kg,
        d.collect_total_usd,
        d.prepaid_total_usd,
        d.hawala_total_usd,
        d.transfer_fee_total_usd,
        d.rows_snapshot,
        d.printed_by,
        d.printed_at,
        d.created_at,
        b.name as branch_name,
        u.full_name as printed_by_name,
        u.username as printed_by_username
      from daily_ledger_print_documents d
      left join branches b on b.id = d.branch_id
      left join users u on u.id = d.printed_by
      where d.id = $1::uuid and d.company_id = $2::uuid
      limit 1
      `,
      [documentId, scope.companyId],
    );
    return result.rows[0] ?? null;
  }

  async deletePrintDocument(scope: DataScope, documentId: string): Promise<boolean> {
    if (!scope.companyId) throw new HttpError(400, 'Company scope is required.');
    const result = await pool.query<{ id: string }>(
      `
      delete from daily_ledger_print_documents
      where id = $1::uuid and company_id = $2::uuid
      returning id
      `,
      [documentId, scope.companyId],
    );
    return result.rows.length > 0;
  }

  async listAgentPrintDocuments(
    scope: DataScope,
    filters: DailyLedgerPrintDocumentListFilters,
    destinationHints: string[],
  ): Promise<DailyLedgerPrintDocumentSummary[]> {
    if (!scope.companyId) throw new HttpError(400, 'Company scope is required.');
    const conditions = ['d.company_id = $1'];
    const values: unknown[] = [scope.companyId];
    appendAgentPrintDocumentScope(conditions, values, destinationHints);
    if (filters.dateFrom) {
      values.push(filters.dateFrom);
      conditions.push(`d.ledger_date >= $${values.length}::date`);
    }
    if (filters.dateTo) {
      values.push(filters.dateTo);
      conditions.push(`d.ledger_date <= $${values.length}::date`);
    }
    if (filters.searchQuery?.trim()) {
      values.push(`%${filters.searchQuery.trim()}%`);
      const qp = `$${values.length}`;
      conditions.push(`(
        coalesce(d.search_query, '') ilike ${qp}
        or coalesce(d.destination_label, '') ilike ${qp}
        or coalesce(d.driver_label, '') ilike ${qp}
        or coalesce(d.title, '') ilike ${qp}
      )`);
    }
    values.push(filters.limit ?? 100);
    const limitParam = `$${values.length}`;
    values.push(filters.offset ?? 0);
    const offsetParam = `$${values.length}`;

    const result = await pool.query<DailyLedgerPrintDocumentSummary>(
      `
      select
        d.id,
        d.branch_id,
        b.name as branch_name,
        d.ledger_date::text as ledger_date,
        d.ledger_date_to::text as ledger_date_to,
        d.line_label,
        d.driver_id,
        d.driver_label,
        d.destination_label,
        d.search_query,
        d.print_type,
        d.print_scope,
        d.title,
        d.row_count,
        d.pieces_count,
        d.weight_kg,
        d.collect_total_usd,
        d.prepaid_total_usd,
        d.hawala_total_usd,
        d.transfer_fee_total_usd,
        d.printed_at,
        u.full_name as printed_by_name,
        u.username as printed_by_username
      from daily_ledger_print_documents d
      left join branches b on b.id = d.branch_id
      left join users u on u.id = d.printed_by
      where ${conditions.join(' and ')}
      order by d.ledger_date desc, d.printed_at desc
      limit ${limitParam}
      offset ${offsetParam}
      `,
      values,
    );
    return result.rows;
  }
}
