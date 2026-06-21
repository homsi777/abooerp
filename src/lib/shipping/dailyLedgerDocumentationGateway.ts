import { httpClient } from '../api/httpClient';

export type PrintDocumentationRowSnapshot = {
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

export type PrintDocumentationSummary = {
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

export type PrintDocumentationDetail = PrintDocumentationSummary & {
  origin_label: string | null;
  rows_snapshot: PrintDocumentationRowSnapshot[];
};

export type PrintDocumentationFilters = {
  branchId?: string;
  dateFrom?: string;
  dateTo?: string;
  driverId?: string;
  destination?: string;
  searchQuery?: string;
  limit?: number;
  offset?: number;
};

export type SavePrintDocumentationInput = {
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
  rowsSnapshot?: PrintDocumentationRowSnapshot[];
};

export async function listPrintDocumentation(
  filters: PrintDocumentationFilters,
): Promise<PrintDocumentationSummary[]> {
  const params = new URLSearchParams();
  if (filters.branchId) params.set('branchId', filters.branchId);
  if (filters.dateFrom) params.set('dateFrom', filters.dateFrom);
  if (filters.dateTo) params.set('dateTo', filters.dateTo);
  if (filters.driverId) params.set('driverId', filters.driverId);
  if (filters.destination) params.set('destination', filters.destination);
  if (filters.searchQuery) params.set('searchQuery', filters.searchQuery);
  if (filters.limit) params.set('limit', String(filters.limit));
  if (filters.offset) params.set('offset', String(filters.offset));
  return httpClient.get<PrintDocumentationSummary[]>(`/daily-ledger/print/documents?${params.toString()}`);
}

export async function getPrintDocumentation(id: string): Promise<PrintDocumentationDetail> {
  return httpClient.get<PrintDocumentationDetail>(`/daily-ledger/print/documents/${id}`);
}

export async function savePrintDocumentation(input: SavePrintDocumentationInput): Promise<{ id: string }> {
  const created = await httpClient.post<{ id: string }>('/daily-ledger/print/document', input);
  return created;
}

export function printTypeLabel(value: string): string {
  if (value === 'receipts') return 'إيصالات';
  if (value === 'shipments') return 'دفتر شحن';
  if (value === 'destination_pdf') return 'PDF وجهة';
  return value;
}
