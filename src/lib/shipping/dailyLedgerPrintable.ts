import { parseUsd, parseWeightKg } from './ledgerTariffPricing';
import type { RemoteDailyLedgerRow } from './dailyLedgerTypes';

/** هل السطر يحتوي بيانات فعلية (ليس صف إدخال فارغاً) — يُستخدم للشاشة والطباعة والتصدير */
export function isRemoteDailyLedgerRowPrintable(remote: RemoteDailyLedgerRow): boolean {
  return Boolean(
    remote.receipt_no?.trim() ||
      remote.destination?.trim() ||
      remote.sender_name?.trim() ||
      remote.receiver_name?.trim() ||
      remote.parcel_type?.trim() ||
      (remote.parcel_count != null && Number(remote.parcel_count) > 0) ||
      (remote.weight_kg != null && Number(remote.weight_kg) > 0) ||
      parseUsd(String(remote.collect_amount_usd ?? '')) > 0 ||
      parseUsd(String(remote.prepaid_amount_usd ?? '')) > 0 ||
      parseUsd(String(remote.hawala_amount_usd ?? '')) > 0 ||
      parseUsd(String(remote.transfer_service_fee_usd ?? '')) > 0 ||
      parseUsd(String(remote.fees_amount_usd ?? '')) > 0,
  );
}

export function filterPrintableDailyLedgerRows(rows: RemoteDailyLedgerRow[]): RemoteDailyLedgerRow[] {
  return rows.filter(isRemoteDailyLedgerRowPrintable);
}

export function dedupeDailyLedgerRowsById(rows: RemoteDailyLedgerRow[]): RemoteDailyLedgerRow[] {
  const byId = new Map<string, RemoteDailyLedgerRow>();
  for (const row of rows) {
    if (isRemoteDailyLedgerRowPrintable(row)) {
      byId.set(row.id, row);
    }
  }
  return [...byId.values()];
}

/** ترتيب عرض الدفتر: الأقدم أولاً والأحدث (سطر الإدخال الجديد) في الأسفل */
export function compareDailyLedgerRowsChronological(
  a: RemoteDailyLedgerRow,
  b: RemoteDailyLedgerRow,
): number {
  const dateCmp = String(a.ledger_date ?? '').localeCompare(String(b.ledger_date ?? ''));
  if (dateCmp !== 0) return dateCmp;
  const createdCmp = String(a.created_at ?? '').localeCompare(String(b.created_at ?? ''));
  if (createdCmp !== 0) return createdCmp;
  const sessionCmp = String(a.session_id ?? '').localeCompare(String(b.session_id ?? ''));
  if (sessionCmp !== 0) return sessionCmp;
  return a.row_no - b.row_no;
}

export function sortDailyLedgerRows(rows: RemoteDailyLedgerRow[]): RemoteDailyLedgerRow[] {
  return [...rows].sort(compareDailyLedgerRowsChronological);
}

export function remoteRowCollectionUsd(row: RemoteDailyLedgerRow): number {
  return parseUsd(String(row.collect_amount_usd ?? '')) + parseUsd(String(row.fees_amount_usd ?? ''));
}

export function remoteCollectAmountLabel(
  row: Pick<RemoteDailyLedgerRow, 'collect_amount_usd' | 'fees_amount_usd'>,
): string {
  const total = remoteRowCollectionUsd(row as RemoteDailyLedgerRow);
  return total > 0 ? String(total) : '';
}

export function remoteRowWeightKg(row: RemoteDailyLedgerRow): number {
  return parseWeightKg(row.weight_kg ?? '') ?? 0;
}

function readRowField(raw: Record<string, unknown>, snake: string, camel: string): unknown {
  if (raw[snake] !== undefined && raw[snake] !== null) return raw[snake];
  if (raw[camel] !== undefined && raw[camel] !== null) return raw[camel];
  return undefined;
}

function readRowString(raw: Record<string, unknown>, snake: string, camel: string, fallback = ''): string {
  const value = readRowField(raw, snake, camel);
  return value == null ? fallback : String(value);
}

function readRowNullableString(raw: Record<string, unknown>, snake: string, camel: string): string | null {
  const value = readRowString(raw, snake, camel, '').trim();
  return value || null;
}

/** توحيد صف الدفتر من API — snake_case أو camelCase */
export function normalizeRemoteDailyLedgerRow(raw: unknown): RemoteDailyLedgerRow {
  const row = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  const parcelCountRaw = readRowField(row, 'parcel_count', 'parcelCount');
  const parcelCount =
    parcelCountRaw == null || parcelCountRaw === ''
      ? null
      : Number(parcelCountRaw);
  const dispatchNoRaw = readRowField(row, 'dispatch_no', 'dispatchNo');

  return {
    id: readRowString(row, 'id', 'id'),
    row_no: Number(readRowField(row, 'row_no', 'rowNo') ?? 0),
    receipt_no: readRowNullableString(row, 'receipt_no', 'receiptNo'),
    destination: readRowString(row, 'destination', 'destination'),
    parcel_type: readRowString(row, 'parcel_type', 'parcelType'),
    parcel_count: Number.isFinite(parcelCount) ? parcelCount : null,
    weight_kg: readRowNullableString(row, 'weight_kg', 'weightKg'),
    sender_name: readRowString(row, 'sender_name', 'senderName'),
    receiver_name: readRowString(row, 'receiver_name', 'receiverName'),
    collect_amount_usd: readRowString(row, 'collect_amount_usd', 'collectAmountUsd', '0'),
    prepaid_amount_usd: readRowString(row, 'prepaid_amount_usd', 'prepaidAmountUsd', '0'),
    hawala_amount_usd: readRowString(row, 'hawala_amount_usd', 'hawalaAmountUsd', '0'),
    fees_amount_usd: readRowString(row, 'fees_amount_usd', 'feesAmountUsd', '0'),
    transfer_service_fee_usd: readRowString(row, 'transfer_service_fee_usd', 'transferServiceFeeUsd', '0'),
    notes: readRowNullableString(row, 'notes', 'notes'),
    posted_shipment_id: readRowNullableString(row, 'posted_shipment_id', 'postedShipmentId'),
    posted_at: readRowNullableString(row, 'posted_at', 'postedAt'),
    loaded_manifest_id: readRowNullableString(row, 'loaded_manifest_id', 'loadedManifestId'),
    loaded_at: readRowNullableString(row, 'loaded_at', 'loadedAt'),
    created_at: readRowString(row, 'created_at', 'createdAt'),
    updated_at: readRowString(row, 'updated_at', 'updatedAt'),
    branch_id: readRowString(row, 'branch_id', 'branchId'),
    ledger_date: readRowString(row, 'ledger_date', 'ledgerDate'),
    line_label: readRowString(row, 'line_label', 'lineLabel'),
    origin_label: readRowString(row, 'origin_label', 'originLabel'),
    trip_no: readRowNullableString(row, 'trip_no', 'tripNo'),
    vehicle_label: readRowNullableString(row, 'vehicle_label', 'vehicleLabel'),
    driver_label: readRowNullableString(row, 'driver_label', 'driverLabel'),
    driver_id: readRowNullableString(row, 'driver_id', 'driverId'),
    vehicle_id: readRowNullableString(row, 'vehicle_id', 'vehicleId'),
    session_id: readRowNullableString(row, 'session_id', 'sessionId'),
    session_printed_at: readRowNullableString(row, 'session_printed_at', 'sessionPrintedAt'),
    session_reprint_required:
      readRowField(row, 'session_reprint_required', 'sessionReprintRequired') as boolean | null | undefined ?? null,
    session_reprint_reason: readRowNullableString(row, 'session_reprint_reason', 'sessionReprintReason'),
    dispatch_id: readRowNullableString(row, 'dispatch_id', 'dispatchId'),
    dispatch_no:
      dispatchNoRaw == null || dispatchNoRaw === ''
        ? null
        : Number(dispatchNoRaw),
  };
}

export function normalizeRemoteDailyLedgerRows(rows: unknown): RemoteDailyLedgerRow[] {
  if (!Array.isArray(rows)) return [];
  return rows.map(normalizeRemoteDailyLedgerRow);
}
