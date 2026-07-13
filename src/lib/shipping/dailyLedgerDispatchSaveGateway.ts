import { httpClient } from '../api/httpClient';

export type DispatchSaveRowSnapshot = {
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
  dispatchNo: number | null;
  ledgerDate: string | null;
};

export type DispatchSaveLogSummary = {
  id: string;
  branch_id: string;
  branch_name: string | null;
  dispatch_id: string | null;
  dispatch_no: number | null;
  ledger_date: string;
  line_label: string;
  origin_label: string | null;
  driver_id: string | null;
  driver_label: string | null;
  vehicle_label: string | null;
  destination_label: string | null;
  save_mode: 'all' | 'custom';
  row_count: number;
  pieces_count: number;
  weight_kg: string;
  collect_total_usd: string;
  prepaid_total_usd: string;
  hawala_total_usd: string;
  transfer_fee_total_usd: string;
  posted_count: number;
  error_count: number;
  skipped_count: number;
  outcome: string | null;
  summary: string | null;
  saved_at: string;
  saved_by_name: string | null;
  saved_by_username: string | null;
  printed_at: string | null;
  print_count: number;
};

export type DispatchSaveLogDetail = DispatchSaveLogSummary & {
  vehicle_id: string | null;
  trip_no: string | null;
  receipt_nos: string[];
  row_ids: string[];
  rows_snapshot: DispatchSaveRowSnapshot[];
  print_document_id: string | null;
  notes: string | null;
};

export type DispatchSaveLogFilters = {
  branchId?: string;
  dateFrom?: string;
  dateTo?: string;
  driverId?: string;
  destination?: string;
  searchQuery?: string;
  saveMode?: 'all' | 'custom';
  limit?: number;
  offset?: number;
};

export type CreateDispatchSaveLogInput = {
  branchId: string;
  dispatchId?: string | null;
  dispatchNo?: number | null;
  ledgerDate: string;
  lineLabel: string;
  originLabel?: string | null;
  driverId?: string | null;
  vehicleId?: string | null;
  driverLabel?: string | null;
  vehicleLabel?: string | null;
  tripNo?: string | null;
  destinationLabel?: string | null;
  saveMode: 'all' | 'custom';
  rowCount?: number;
  piecesCount?: number;
  weightKg?: number;
  collectTotalUsd?: number;
  prepaidTotalUsd?: number;
  hawalaTotalUsd?: number;
  transferFeeTotalUsd?: number;
  postedCount?: number;
  errorCount?: number;
  skippedCount?: number;
  receiptNos?: string[];
  rowIds?: string[];
  rowsSnapshot?: DispatchSaveRowSnapshot[];
  outcome?: 'success' | 'partial' | 'failed' | null;
  summary?: string | null;
  notes?: string | null;
};

export async function listDispatchSaveLogs(filters: DispatchSaveLogFilters): Promise<DispatchSaveLogSummary[]> {
  const params = new URLSearchParams();
  if (filters.branchId) params.set('branchId', filters.branchId);
  if (filters.dateFrom) params.set('dateFrom', filters.dateFrom);
  if (filters.dateTo) params.set('dateTo', filters.dateTo);
  if (filters.driverId) params.set('driverId', filters.driverId);
  if (filters.destination) params.set('destination', filters.destination);
  if (filters.searchQuery) params.set('searchQuery', filters.searchQuery);
  if (filters.saveMode) params.set('saveMode', filters.saveMode);
  if (filters.limit) params.set('limit', String(filters.limit));
  if (filters.offset) params.set('offset', String(filters.offset));
  return httpClient.get<DispatchSaveLogSummary[]>(`/daily-ledger/dispatch-saves?${params.toString()}`);
}

export async function getDispatchSaveLog(id: string): Promise<DispatchSaveLogDetail> {
  return httpClient.get<DispatchSaveLogDetail>(`/daily-ledger/dispatch-saves/${id}`);
}

export async function createDispatchSaveLog(input: CreateDispatchSaveLogInput): Promise<DispatchSaveLogDetail> {
  return httpClient.post<DispatchSaveLogDetail>('/daily-ledger/dispatch-saves', input);
}

export async function markDispatchSavePrinted(
  id: string,
  input: { printDocumentId?: string | null } = {},
): Promise<DispatchSaveLogDetail> {
  return httpClient.post<DispatchSaveLogDetail>(`/daily-ledger/dispatch-saves/${id}/mark-printed`, input);
}

export function saveModeLabel(mode: 'all' | 'custom'): string {
  return mode === 'custom' ? 'حفظ مخصص' : 'حفظ الكل';
}

export function outcomeLabel(outcome: string | null | undefined): string {
  if (outcome === 'success') return 'ناجح';
  if (outcome === 'partial') return 'جزئي';
  if (outcome === 'failed') return 'فاشل';
  return '—';
}
