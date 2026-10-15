import { httpClient } from '../api/httpClient';
import { normalizeRemoteDailyLedgerRows } from './dailyLedgerPrintable';
import { resolveLedgerBranchId } from './dailyLedgerQueryParams';
import type { RemoteDailyLedgerRow } from './dailyLedgerTypes';

export type LedgerGlobalSearchFilters = {
  branchId?: string;
  allBranches?: boolean;
  includeLoaded?: boolean;
  /** بحث موحّد — مرسل، مستلم، إيصال/إشعار، نوع بضاعة */
  q?: string;
  receiptNo?: string;
  parcelType?: string;
  senderName?: string;
  receiverName?: string;
  /** نطاق تاريخ اختياري — yyyy-mm-dd، يُضيَّق به البحث بغض النظر عن نوعه */
  dateFrom?: string;
  dateTo?: string;
  limit?: number;
  offset?: number;
};

export type LedgerGlobalSearchInput = {
  q?: string;
  receiptNo?: string;
  parcelType?: string;
  senderName?: string;
  receiverName?: string;
  dateFrom?: string;
  dateTo?: string;
};

const MIN_QUERY_LEN = 1;

export function hasLedgerGlobalSearchCriteria(input: LedgerGlobalSearchInput): boolean {
  const unified = String(input.q ?? '').trim();
  if (unified.length >= MIN_QUERY_LEN) return true;
  if (input.dateFrom?.trim() || input.dateTo?.trim()) return true;
  return [input.receiptNo, input.parcelType, input.senderName, input.receiverName].some(
    (value) => String(value ?? '').trim().length >= MIN_QUERY_LEN,
  );
}

function dateRangeLabel(input: LedgerGlobalSearchInput): string {
  const from = input.dateFrom?.trim();
  const to = input.dateTo?.trim();
  if (from && to) return from === to ? `بتاريخ ${from}` : `من ${from} إلى ${to}`;
  if (from) return `من ${from}`;
  if (to) return `حتى ${to}`;
  return '';
}

export function ledgerGlobalSearchCriteriaLabel(input: LedgerGlobalSearchInput): string {
  const range = dateRangeLabel(input);
  const unified = String(input.q ?? '').trim();
  if (unified) return range ? `${unified} · ${range}` : unified;
  const parts = [
    input.receiptNo?.trim() ? `إيصال: ${input.receiptNo.trim()}` : '',
    input.parcelType?.trim() ? `نوع: ${input.parcelType.trim()}` : '',
    input.senderName?.trim() ? `مرسل: ${input.senderName.trim()}` : '',
    input.receiverName?.trim() ? `مستلم: ${input.receiverName.trim()}` : '',
    range,
  ].filter(Boolean);
  return parts.join(' · ') || '—';
}

export async function searchLedgerRowsGlobally(
  filters: LedgerGlobalSearchFilters,
): Promise<RemoteDailyLedgerRow[]> {
  const params = new URLSearchParams();
  if (filters.allBranches) {
    params.set('allBranches', 'true');
  } else if (filters.branchId) {
    params.set('branchId', resolveLedgerBranchId(filters.branchId));
  }
  params.set('includeLoaded', filters.includeLoaded ? 'true' : 'false');
  params.set('onlyWithData', 'true');
  params.set('limit', String(filters.limit ?? 200));
  params.set('offset', String(filters.offset ?? 0));

  const unified = filters.q?.trim();
  if (unified) {
    params.set('q', unified);
  } else {
    if (filters.receiptNo?.trim()) params.set('receiptNo', filters.receiptNo.trim());
    if (filters.parcelType?.trim()) params.set('parcelType', filters.parcelType.trim());
    if (filters.senderName?.trim()) params.set('senderName', filters.senderName.trim());
    if (filters.receiverName?.trim()) params.set('receiverName', filters.receiverName.trim());
  }
  // نطاق التاريخ يُضيّق أي نوع بحث آخر — وليس بديلاً عنه
  if (filters.dateFrom?.trim()) params.set('dateFrom', filters.dateFrom.trim());
  if (filters.dateTo?.trim()) params.set('dateTo', filters.dateTo.trim());

  return normalizeRemoteDailyLedgerRows(
    await httpClient.get<RemoteDailyLedgerRow[]>(`/daily-ledger/rows?${params.toString()}`),
  );
}
