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
