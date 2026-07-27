import { httpClient } from '../api/httpClient';
import { resolveLedgerBranchId } from './dailyLedgerQueryParams';

export type DuplicateLedgerRowDetail = {
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
};

export type DuplicateReceiptGroup = {
  kind: 'same_day_line' | 'cross_date';
  receipt_no: string;
  count: number;
  hawala_sum: string;
  transfer_fee_sum: string;
  collect_sum: string;
  prepaid_sum: string;
  rows: DuplicateLedgerRowDetail[];
};

export type DuplicateReceiptsReport = {
  groups: DuplicateReceiptGroup[];
  summary: {
    sameDayGroups: number;
    crossDateGroups: number;
    totalDuplicateRows: number;
  };
};

export type DuplicateReceiptsFilters = {
  branchId?: string;
  allBranches?: boolean;
  dateFrom?: string;
  dateTo?: string;
  scopeMode?: 'same_day' | 'cross_date' | 'all';
  limit?: number;
};

export function duplicateKindLabel(kind: DuplicateReceiptGroup['kind']): string {
  return kind === 'same_day_line' ? 'نفس اليوم والخط' : 'عبر تواريخ مختلفة';
}

export async function fetchDuplicateReceipts(
  filters: DuplicateReceiptsFilters,
): Promise<DuplicateReceiptsReport> {
  const params = new URLSearchParams();
  if (filters.allBranches) {
    params.set('allBranches', 'true');
  } else if (filters.branchId) {
    params.set('branchId', resolveLedgerBranchId(filters.branchId));
  }
  if (filters.dateFrom) params.set('dateFrom', filters.dateFrom);
  if (filters.dateTo) params.set('dateTo', filters.dateTo);
  params.set('scopeMode', filters.scopeMode ?? 'all');
  params.set('limit', String(filters.limit ?? 200));

  return httpClient.get<DuplicateReceiptsReport>(
    `/daily-ledger/duplicate-receipts?${params.toString()}`,
  );
}
