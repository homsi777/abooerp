import { httpClient } from './httpClient';

export interface Transfer {
  id: string;
  company_id: string;
  branch_id?: string;
  agent_id?: string;
  origin_agent_id?: string;
  destination_agent_id?: string;
  destination_city?: string;
  origin_agent_name?: string;
  destination_agent_name?: string;
  collection_cashbox_id?: string;
  collection_receipt_voucher_id?: string;
  payout_cashbox_id?: string;
  payout_payment_voucher_id?: string;
  shipment_id?: string;
  shipment_no?: string;
  branch_name?: string;
  agent_name?: string;
  sender_name: string;
  receiver_name: string;
  sender_display_name?: string;
  receiver_display_name?: string;
  shipment_sender_name?: string;
  shipment_receiver_name?: string;
  amount: number;
  currency: string;
  main_amount: number;
  // Legacy columns
  commission: number;
  commission_currency: string;
  commission_main: number;
  // Explicit accounting columns
  agent_commission: number;
  agent_commission_currency: string;
  agent_commission_main: number;
  transfer_service_fee: number;
  transfer_service_fee_currency: string;
  transfer_service_fee_main: number;
  company_transfer_profit: number;
  company_transfer_profit_currency: string;
  company_transfer_profit_main: number;
  status: string;
  transfer_date: string;
  notes?: string;
  posted_cashbox_id?: string | null;
  receipt_voucher_id?: string | null;
  posted_at?: string | null;
  posted_by_user_id?: string | null;
  cancelled_at?: string | null;
  cancelled_by_user_id?: string | null;
  cancellation_reason?: string | null;
  receipt_voucher_no?: string | null;
  posted_cashbox_name?: string | null;
  created_at: string;
}

export interface CreateTransferPayload {
  sender_name: string;
  receiver_name: string;
  amount: number;
  currency: string;
  main_amount: number;
  commission?: number;
  commission_currency?: string;
  commission_main?: number;
  agent_commission: number;
  agent_commission_currency: string;
  agent_commission_main: number;
  transfer_service_fee: number;
  transfer_service_fee_currency: string;
  transfer_service_fee_main: number;
  company_transfer_profit: number;
  company_transfer_profit_currency: string;
  company_transfer_profit_main: number;
  status?: string;
  notes?: string;
  shipment_id?: string;
  origin_agent_id?: string;
  destination_agent_id?: string;
  destination_city?: string;
  collection_cashbox_id?: string;
}

export const transfersGateway = {
  async list(params?: { status?: string; search?: string }): Promise<Transfer[]> {
    const queryParams = new URLSearchParams();
    if (params?.status) queryParams.append('status', params.status);
    if (params?.search) queryParams.append('search', params.search);
    const queryString = queryParams.toString();
    
    const res = await httpClient.get<Transfer[]>(`/transfers${queryString ? `?${queryString}` : ''}`);
    return Array.isArray(res) ? res : [];
  },

  async create(payload: CreateTransferPayload): Promise<Transfer> {
    return httpClient.post<Transfer>('/transfers', payload);
  },

  async updateStatus(id: string, status: string): Promise<Transfer> {
    return httpClient.put<Transfer>(`/transfers/${id}/status`, { status });
  },

  async complete(id: string, payload: { cashboxId: string; voucherNo?: string }): Promise<Transfer> {
    return httpClient.post<Transfer>(`/transfers/${id}/complete`, payload);
  },

  async cancel(id: string, payload: { reason?: string }): Promise<Transfer> {
    return httpClient.post<Transfer>(`/transfers/${id}/cancel`, payload);
  },

  async delete(id: string): Promise<void> {
    await httpClient.delete(`/transfers/${id}`);
  },

  async getReport(filters: {
    dateFrom?: string;
    dateTo?: string;
    branchId?: string;
    status?: 'PENDING' | 'COMPLETED' | 'CANCELLED';
    originAgentId?: string;
    destinationAgentId?: string;
    destinationCity?: string;
  }): Promise<TransferReport> {
    const q = new URLSearchParams();
    if (filters.dateFrom) q.set('dateFrom', filters.dateFrom);
    if (filters.dateTo) q.set('dateTo', filters.dateTo);
    if (filters.branchId) q.set('branchId', filters.branchId);
    if (filters.status) q.set('status', filters.status);
    if (filters.originAgentId) q.set('originAgentId', filters.originAgentId);
    if (filters.destinationAgentId) q.set('destinationAgentId', filters.destinationAgentId);
    if (filters.destinationCity) q.set('destinationCity', filters.destinationCity);
    const suffix = q.toString() ? `?${q.toString()}` : '';
    return httpClient.get<TransferReport>(`/transfers/reports/statement${suffix}`);
  },
};

export type TransferReportRow = {
  id: string;
  report_date: string;
  created_at: string;
  transfer_date: string | null;
  status: string;
  sender_name: string;
  receiver_name: string;
  amount: number;
  currency: string;
  main_amount: number;
  transfer_service_fee: number;
  transfer_service_fee_currency: string;
  agent_commission: number;
  agent_commission_currency: string;
  destination_city: string | null;
  shipment_id: string | null;
  shipment_no: string | null;
  branch_name: string | null;
  origin_agent_id: string | null;
  origin_agent_name: string | null;
  origin_agent_city: string | null;
  destination_agent_id: string | null;
  destination_agent_name: string | null;
  destination_agent_city: string | null;
  destination_label: string | null;
  posted_at: string | null;
  cancelled_at: string | null;
  payout_cashbox_name: string | null;
  payout_voucher_no: string | null;
  collection_cashbox_name: string | null;
  collection_voucher_no: string | null;
  notes: string | null;
};

export type TransferReportSummaryRow = {
  total_count: number;
  pending_count: number;
  completed_count: number;
  cancelled_count: number;
  pending_amount: number;
  completed_amount: number;
  total_service_fees: number;
  currency: string;
};

export type TransferReportDestinationRow = {
  destination_agent_id: string;
  destination_label: string;
  destination_city: string | null;
  total_count: number;
  pending_count: number;
  completed_count: number;
  cancelled_count: number;
  pending_amount: number;
  completed_amount: number;
  total_amount: number;
  currency: string;
};

export type TransferReport = {
  rows: TransferReportRow[];
  summaryByCurrency: TransferReportSummaryRow[];
  byDestination: TransferReportDestinationRow[];
};

export function transferStatusLabel(status: string) {
  switch (String(status).toUpperCase()) {
    case 'PENDING':
      return 'لم تُسلّم بعد';
    case 'COMPLETED':
      return 'تم التسليم';
    case 'CANCELLED':
      return 'ملغاة';
    default:
      return status;
  }
}
