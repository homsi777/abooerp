import { httpClient } from '../api/httpClient';
import { resolveLedgerBranchId } from './dailyLedgerQueryParams';
import type { RemoteDailyLedgerRow } from './dailyLedgerTypes';

export type LedgerGlobalSearchFilters = {
  branchId?: string;
  allBranches?: boolean;
  includeLoaded?: boolean;
  receiptNo?: string;
  parcelType?: string;
  senderName?: string;
  receiverName?: string;
  /** بحث عام — يُستخدم إذا لم تُملأ الحقول التكتيكية */
  q?: string;
  limit?: number;
  offset?: number;
};

export type LedgerGlobalSearchInput = {
  receiptNo?: string;
  parcelType?: string;
  senderName?: string;
  receiverName?: string;
};

export function hasLedgerGlobalSearchCriteria(input: LedgerGlobalSearchInput): boolean {
  return [input.receiptNo, input.parcelType, input.senderName, input.receiverName].some(
    (value) => String(value ?? '').trim().length >= 2,
  );
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

  if (filters.receiptNo?.trim()) params.set('receiptNo', filters.receiptNo.trim());
  if (filters.parcelType?.trim()) params.set('parcelType', filters.parcelType.trim());
  if (filters.senderName?.trim()) params.set('senderName', filters.senderName.trim());
  if (filters.receiverName?.trim()) params.set('receiverName', filters.receiverName.trim());
  if (filters.q?.trim()) params.set('q', filters.q.trim());

  return httpClient.get<RemoteDailyLedgerRow[]>(`/daily-ledger/rows?${params.toString()}`);
}
