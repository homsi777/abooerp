import { httpClient } from '../api/httpClient';
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
  limit?: number;
  offset?: number;
};

export type LedgerGlobalSearchInput = {
  q?: string;
  receiptNo?: string;
  parcelType?: string;
  senderName?: string;
  receiverName?: string;
};

const MIN_QUERY_LEN = 1;

export function hasLedgerGlobalSearchCriteria(input: LedgerGlobalSearchInput): boolean {
  const unified = String(input.q ?? '').trim();
  if (unified.length >= MIN_QUERY_LEN) return true;
  return [input.receiptNo, input.parcelType, input.senderName, input.receiverName].some(
    (value) => String(value ?? '').trim().length >= MIN_QUERY_LEN,
  );
}

export function ledgerGlobalSearchCriteriaLabel(input: LedgerGlobalSearchInput): string {
  const unified = String(input.q ?? '').trim();
  if (unified) return unified;
  const parts = [
    input.receiptNo?.trim() ? `إيصال: ${input.receiptNo.trim()}` : '',
    input.parcelType?.trim() ? `نوع: ${input.parcelType.trim()}` : '',
    input.senderName?.trim() ? `مرسل: ${input.senderName.trim()}` : '',
    input.receiverName?.trim() ? `مستلم: ${input.receiverName.trim()}` : '',
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

  return httpClient.get<RemoteDailyLedgerRow[]>(`/daily-ledger/rows?${params.toString()}`);
}
