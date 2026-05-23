import { httpClient } from './httpClient';

// ── Types ─────────────────────────────────────────────────────────────────────

export type CustomerRecord = {
  id: string;
  code: string;
  name: string;
  phone?: string | null;
  second_phone?: string | null;
  company_name?: string | null;
  customer_type: 'INDIVIDUAL' | 'COMPANY';
  is_account_customer: boolean;
  credit_limit: number;
  default_currency_code: string;
  city?: string | null;
  area?: string | null;
  address?: string | null;
  tax_number?: string | null;
  notes?: string | null;
  branch_id?: string | null;
  branch_name?: string | null;
  agent_id?: string | null;
  agent_name?: string | null;
  company_id?: string | null;
  created_by_user_id?: string | null;
  status: 'active' | 'inactive';
  created_at: string;
  updated_at: string;
};

export type CustomerCreateInput = {
  name: string;
  phone?: string;
  second_phone?: string;
  company_name?: string;
  customer_type?: 'INDIVIDUAL' | 'COMPANY';
  is_account_customer?: boolean;
  credit_limit?: number;
  default_currency_code?: string;
  city?: string;
  area?: string;
  address?: string;
  tax_number?: string;
  notes?: string;
  branch_id?: string;
  agent_id?: string;
  status?: 'active' | 'inactive';
};

export type SmartPartyResult = {
  id: string;
  type: 'quick_contact' | 'customer' | 'account_customer';
  display_name: string;
  phone?: string | null;
  city?: string | null;
  badge_label: string;
  source_table: 'senders_receivers' | 'customers';
  is_account_customer?: boolean | null;
};

export type CustomerListResponse = {
  data: CustomerRecord[];
  total: number;
  page: number;
  limit: number;
};

export type CustomerFilters = {
  search?: string;
  customer_type?: 'INDIVIDUAL' | 'COMPANY' | '';
  is_account_customer?: boolean | '';
  city?: string;
  branch_id?: string;
  agent_id?: string;
  status?: 'active' | 'inactive' | '';
  page?: number;
  limit?: number;
};

// ── Gateway ───────────────────────────────────────────────────────────────────

function buildQuery(filters: CustomerFilters): string {
  const params = new URLSearchParams();
  if (filters.search) params.set('search', filters.search);
  if (filters.customer_type) params.set('customer_type', filters.customer_type);
  if (filters.is_account_customer !== undefined && filters.is_account_customer !== '')
    params.set('is_account_customer', String(filters.is_account_customer));
  if (filters.city) params.set('city', filters.city);
  if (filters.branch_id) params.set('branch_id', filters.branch_id);
  if (filters.agent_id) params.set('agent_id', filters.agent_id);
  if (filters.status) params.set('status', filters.status);
  if (filters.page) params.set('page', String(filters.page));
  if (filters.limit) params.set('limit', String(filters.limit));
  const qs = params.toString();
  return qs ? `?${qs}` : '';
}

export const customersGateway = {
  list: async (filters: CustomerFilters = {}): Promise<CustomerListResponse> => {
    const result = await httpClient.get<CustomerListResponse>(`/customers${buildQuery(filters)}`);
    return result as CustomerListResponse;
  },

  get: async (id: string): Promise<CustomerRecord> => {
    return httpClient.get<CustomerRecord>(`/customers/${id}`);
  },

  create: async (data: CustomerCreateInput): Promise<CustomerRecord> => {
    return httpClient.post<CustomerRecord>('/customers', data);
  },

  update: async (id: string, data: Partial<CustomerCreateInput>): Promise<CustomerRecord> => {
    return httpClient.put<CustomerRecord>(`/customers/${id}`, data);
  },

  toggleStatus: async (id: string): Promise<CustomerRecord> => {
    return httpClient.post<CustomerRecord>(`/customers/${id}/toggle-status`, {});
  },

  search: async (q: string): Promise<CustomerRecord[]> => {
    return httpClient.get<CustomerRecord[]>(`/customers/search?q=${encodeURIComponent(q)}`);
  },

  smartSearch: async (query: string): Promise<SmartPartyResult[]> => {
    return httpClient.get<SmartPartyResult[]>(`/parties/smart-search?query=${encodeURIComponent(query)}`);
  },
};
