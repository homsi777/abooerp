import { httpClient } from './httpClient';

export interface Transfer {
  id: string;
  company_id: string;
  branch_id?: string;
  agent_id?: string;
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
  }
};
