import type { PaymentVoucher, ReceiptVoucher } from '../../types';
import { httpClient } from './httpClient';

type BackendVoucher = {
  id: string;
  voucher_no: string;
  branch_id?: string | null;
  agent_id?: string | null;
  shipment_id?: string | null;
  delivery_id?: string | null;
  customer_id?: string | null;
  sender_receiver_id?: string | null;
  cashbox_id?: string | null;
  cashbox_name?: string | null;
  cashbox_code?: string | null;
  /** From server join: customer name or sender/receiver name */
  party_display_name?: string | null;
  status: 'draft' | 'confirmed' | 'cancelled';
  notes?: string | null;
  original_amount: number;
  original_currency: 'USD' | 'SYP' | 'TRY';
  exchange_rate_to_usd: number;
  base_amount_usd: number;
  created_at: string;
};

export type BackendCashboxRecord = {
  id: string;
  company_id: string;
  branch_id?: string | null;
  agent_id?: string | null;
  code: string;
  name: string;
  type: 'COMPANY' | 'BRANCH' | 'AGENT';
  currency_code: string;
  opening_balance: number;
  current_balance: number;
  is_active: boolean;
  notes?: string | null;
  created_at: string;
  updated_at: string;
  branch_name?: string | null;
  agent_name?: string | null;
  parent_cashbox_id?: string | null;
  parent_cashbox_name?: string | null;
  parent_cashbox_code?: string | null;
};

export type BackendCashboxMovementRow = BackendCashboxTransaction & {
  cashbox_id?: string | null;
  created_by_username?: string | null;
};

type BackendCashboxTransaction = {
  id: string;
  transaction_type: 'inflow' | 'outflow';
  source_voucher_type: 'receipt' | 'payment';
  source_voucher_id: string;
  branch_id?: string | null;
  agent_id?: string | null;
  cashbox_id?: string | null;
  notes?: string | null;
  original_amount: number;
  original_currency: 'USD' | 'SYP' | 'TRY';
  base_amount_usd: number;
  created_at: string;
};

type BackendPartyMovement = {
  id: string;
  party_type: 'customer' | 'sender_receiver' | 'agent';
  party_id: string;
  movement_type: 'voucher_receipt' | 'voucher_payment';
  voucher_type: 'receipt' | 'payment';
  voucher_id: string;
  direction: 'debit' | 'credit' | 'inflow' | 'outflow';
  original_amount: number;
  original_currency: 'USD' | 'SYP' | 'TRY';
  base_amount_usd: number;
  is_reversal?: boolean;
  signed_base_amount_usd?: number;
  created_at: string;
};

type BackendPartyStatementSummary = {
  opening_balance_usd: number;
  period_inflow_usd: number;
  period_outflow_usd: number;
  closing_balance_usd: number;
};

type BackendPartyLedgerResponse = {
  page: number;
  pageSize: number;
  total: number;
  rows: BackendPartyMovement[];
};

type BackendPartyCurrencySummaryRow = {
  original_currency: 'USD' | 'SYP' | 'TRY';
  entries_count: number;
  inflow_original_amount: number;
  outflow_original_amount: number;
  net_original_amount: number;
  inflow_base_usd: number;
  outflow_base_usd: number;
  net_base_usd: number;
};

type BackendPartyStatementPackage = {
  summary: BackendPartyStatementSummary;
  currencySummary: BackendPartyCurrencySummaryRow[];
  ledger: BackendPartyLedgerResponse;
};

type BackendPartyStatementComparison = {
  currentPeriod: {
    fromAt: string;
    toAt: string;
    summary: BackendPartyStatementSummary;
  };
  previousPeriod: {
    fromAt: string;
    toAt: string;
    summary: BackendPartyStatementSummary;
  };
  delta: {
    closing_balance_usd: number;
    current_closing_balance_usd: number;
    previous_closing_balance_usd: number;
  };
};

type BackendPartyAnalyticsSnapshot = {
  kpis: {
    entries_count: number;
    parties_count: number;
    inflow_base_usd: number;
    outflow_base_usd: number;
    net_base_usd: number;
  };
  topParties: Array<{
    party_type: 'customer' | 'sender_receiver' | 'agent';
    party_id: string;
    entries_count: number;
    inflow_base_usd: number;
    outflow_base_usd: number;
    net_base_usd: number;
    party_name?: string | null;
  }>;
  trend: Array<{
    day: string;
    inflow_base_usd: number;
    outflow_base_usd: number;
    net_base_usd: number;
  }>;
};

type BackendPartyDashboardPackage = {
  tabs: {
    statement: boolean;
    analytics: boolean;
    comparison: boolean;
  };
  statement: BackendPartyStatementPackage | null;
  analytics: BackendPartyAnalyticsSnapshot | null;
  comparison: BackendPartyStatementComparison | null;
};

type BackendDashboardCacheMetrics = {
  ttlMs: number;
  cacheEntries: number;
  inFlightEntries: number;
  counters: {
    hits: number;
    misses: number;
    inFlightHits: number;
    sets: number;
    invalidations: number;
    evictions: number;
  };
};

type BackendDashboardCacheResetResult = {
  resetCache: boolean;
  resetMetrics: boolean;
  confirm: boolean;
  before: BackendDashboardCacheMetrics;
  after: BackendDashboardCacheMetrics;
};

type BackendDashboardCacheResetAudit = {
  total: number;
  entries: Array<{
    at: string;
    userId?: string;
    scope: {
      branchId?: string;
      agentId?: string;
    };
    resetCache: boolean;
    resetMetrics: boolean;
    confirm: boolean;
    outcome: 'success' | 'blocked';
    reason?: string;
  }>;
};

type BackendDebitCreditSummaryRow = {
  party_type: 'customer' | 'sender_receiver' | 'agent';
  party_id: string;
  party_code: string;
  party_name: string;
  branch_name: string | null;
  currency_code: 'USD' | 'SYP' | 'TRY' | string;
  total_debit: number;
  total_credit: number;
  balance: number;
  last_movement_at: string | null;
  movement_count: number;
};

type BackendDebitCreditSummaryResponse = {
  page: number;
  pageSize: number;
  total: number;
  rows: BackendDebitCreditSummaryRow[];
};

type BackendAccountStatementRow = {
  id: string;
  date: string;
  party_type: 'customer' | 'sender_receiver' | 'agent';
  party_id: string;
  party_name: string;
  reference_type: string;
  reference_no: string | null;
  shipment_no: string | null;
  description: string | null;
  debit: number;
  credit: number;
  currency_code: 'USD' | 'SYP' | 'TRY' | string;
  payment_method: string | null;
  branch_name: string | null;
  username: string | null;
  notes: string | null;
};

type BackendAccountStatementResponse = {
  page: number;
  pageSize: number;
  total: number;
  rows: BackendAccountStatementRow[];
};

const stringIdToNumber = new Map<string, number>();
const numberToStringId = new Map<number, string>();
let nextSyntheticId = 200000;

function syntheticId(id: string): number {
  const existing = stringIdToNumber.get(id);
  if (existing) return existing;
  nextSyntheticId += 1;
  stringIdToNumber.set(id, nextSyntheticId);
  numberToStringId.set(nextSyntheticId, id);
  return nextSyntheticId;
}

function backendVoucherIdFromSyntheticId(id: number): string | null {
  return numberToStringId.get(id) ?? null;
}

function partyFallbackLabel(row: BackendVoucher): string {
  if (row.party_display_name?.trim()) {
    return row.party_display_name.trim();
  }
  if (row.sender_receiver_id) {
    return `طرف ${row.sender_receiver_id.slice(0, 8)}…`;
  }
  if (row.customer_id) {
    return `عميل ${row.customer_id.slice(0, 8)}…`;
  }
  if (row.agent_id) {
    return `وكيل ${row.agent_id.slice(0, 8)}…`;
  }
  return 'غير محدد';
}

function toReceiptVoucher(row: BackendVoucher): ReceiptVoucher {
  return {
    id: syntheticId(row.id),
    voucherNo: row.voucher_no,
    date: row.created_at.split('T')[0],
    customerId: 0,
    customerName: partyFallbackLabel(row),
    customerBackendId: row.customer_id ?? null,
    agentBackendId: row.agent_id ?? null,
    amount: Number(row.original_amount),
    currency: row.original_currency,
    exchangeRateToUsd: Number(row.exchange_rate_to_usd),
    amountUsd: Number(row.base_amount_usd),
    paymentMethod: 'cash',
    description: row.notes || '',
    createdBy: row.status,
    cashboxId: row.cashbox_id ?? undefined,
    cashboxName: row.cashbox_name || row.cashbox_code || undefined,
  };
}

function toPaymentVoucher(row: BackendVoucher): PaymentVoucher {
  return {
    id: syntheticId(row.id),
    voucherNo: row.voucher_no,
    date: row.created_at.split('T')[0],
    vendorId: 0,
    vendorName: partyFallbackLabel(row),
    customerBackendId: row.customer_id ?? null,
    agentBackendId: row.agent_id ?? null,
    amount: Number(row.original_amount),
    currency: row.original_currency,
    exchangeRateToUsd: Number(row.exchange_rate_to_usd),
    amountUsd: Number(row.base_amount_usd),
    paymentMethod: 'cash',
    description: row.notes || '',
    createdBy: row.status,
    cashboxId: row.cashbox_id ?? undefined,
    cashboxName: row.cashbox_name || row.cashbox_code || undefined,
  };
}

export const phase3FinanceGateway = {
  receiptVouchers: {
    getAll: async (): Promise<ReceiptVoucher[]> => {
      const rows = await httpClient.get<BackendVoucher[]>('/receipt-vouchers');
      return rows.map(toReceiptVoucher);
    },
    getByDeliveryId: async (deliveryBackendId: string): Promise<ReceiptVoucher | null> => {
      const rows = await httpClient.get<BackendVoucher[]>(`/receipt-vouchers?deliveryId=${deliveryBackendId}`);
      return rows[0] ? toReceiptVoucher(rows[0]) : null;
    },
    create: async (payload: any): Promise<ReceiptVoucher> => {
      const row = await httpClient.post<BackendVoucher>('/receipt-vouchers', payload);
      return toReceiptVoucher(row);
    },
    update: async (id: string, payload: any): Promise<ReceiptVoucher> => {
      const row = await httpClient.put<BackendVoucher>(`/receipt-vouchers/${id}`, payload);
      return toReceiptVoucher(row);
    },
    autoGenerateFromDelivery: async (deliveryBackendId: string) => {
      return httpClient.post<{ created: boolean; voucher: BackendVoucher }>(
        `/receipt-vouchers/auto-generate-from-delivery/${deliveryBackendId}`,
        {},
      );
    },
    getBackendIdFromSynthetic: (id: number): string | null => backendVoucherIdFromSyntheticId(id),
  },
  paymentVouchers: {
    getAll: async (): Promise<PaymentVoucher[]> => {
      const rows = await httpClient.get<BackendVoucher[]>('/payment-vouchers');
      return rows.map(toPaymentVoucher);
    },
    create: async (payload: any): Promise<PaymentVoucher> => {
      const row = await httpClient.post<BackendVoucher>('/payment-vouchers', payload);
      return toPaymentVoucher(row);
    },
    update: async (id: string, payload: any): Promise<PaymentVoucher> => {
      const row = await httpClient.put<BackendVoucher>(`/payment-vouchers/${id}`, payload);
      return toPaymentVoucher(row);
    },
    getBackendIdFromSynthetic: (id: number): string | null => backendVoucherIdFromSyntheticId(id),
  },
  cashbox: {
    getTransactions: async (): Promise<BackendCashboxTransaction[]> => {
      return httpClient.get<BackendCashboxTransaction[]>('/cashbox-transactions');
    },
    listMaster: async (query?: Record<string, string | undefined>): Promise<BackendCashboxRecord[]> => {
      const qs = new URLSearchParams();
      if (query) {
        for (const [k, v] of Object.entries(query)) {
          if (v != null && v !== '') qs.set(k, v);
        }
      }
      const s = qs.toString();
      return httpClient.get<BackendCashboxRecord[]>(`/cashboxes${s ? `?${s}` : ''}`);
    },
    getOne: async (id: string): Promise<BackendCashboxRecord> => {
      return httpClient.get<BackendCashboxRecord>(`/cashboxes/${id}`);
    },
    create: async (payload: Record<string, unknown>): Promise<BackendCashboxRecord> => {
      return httpClient.post<BackendCashboxRecord>('/cashboxes', payload);
    },
    update: async (id: string, payload: Record<string, unknown>): Promise<BackendCashboxRecord> => {
      return httpClient.put<BackendCashboxRecord>(`/cashboxes/${id}`, payload);
    },
    getMovements: async (cashboxId: string): Promise<BackendCashboxMovementRow[]> => {
      return httpClient.get<BackendCashboxMovementRow[]>(`/cashboxes/${cashboxId}/movements`);
    },
  },
  movements: {
    getAll: async (): Promise<BackendPartyMovement[]> => {
      return httpClient.get<BackendPartyMovement[]>('/party-financial-movements');
    },
  },
  debitCredit: {
    getSummary: async (filters: {
      partyType?: 'customer' | 'sender_receiver' | 'agent';
      partyId?: string;
      branchId?: string;
      currencyCode?: string;
      dateFrom?: string;
      dateTo?: string;
      balanceDirection?: 'debit' | 'credit' | 'balanced';
      search?: string;
      page?: number;
      pageSize?: number;
      /** When true, show sender_receiver operational parties in addition to agents/customers */
      includeOperationalParties?: boolean;
    }) => {
      const query = new URLSearchParams();
      if (filters.partyType) query.set('partyType', filters.partyType);
      if (filters.partyId) query.set('partyId', filters.partyId);
      if (filters.branchId) query.set('branchId', filters.branchId);
      if (filters.currencyCode) query.set('currencyCode', filters.currencyCode);
      if (filters.dateFrom) query.set('dateFrom', filters.dateFrom);
      if (filters.dateTo) query.set('dateTo', filters.dateTo);
      if (filters.balanceDirection) query.set('balanceDirection', filters.balanceDirection);
      if (filters.search) query.set('search', filters.search);
      if (typeof filters.page === 'number') query.set('page', String(filters.page));
      if (typeof filters.pageSize === 'number') query.set('pageSize', String(filters.pageSize));
      if (filters.includeOperationalParties) query.set('includeOperationalParties', 'true');
      const suffix = query.toString() ? `?${query.toString()}` : '';
      const payload = await httpClient.get<BackendDebitCreditSummaryResponse>(`/debit-credit-summary${suffix}`);
      return {
        ...payload,
        rows: payload.rows.map((row) => ({
          partyType: row.party_type,
          partyId: row.party_id,
          partyCode: row.party_code || '-',
          partyName: row.party_name || '-',
          branchName: row.branch_name || '-',
          currencyCode: row.currency_code || '-',
          totalDebit: Number(row.total_debit || 0),
          totalCredit: Number(row.total_credit || 0),
          balance: Number(row.balance || 0),
          balanceDirection:
            Number(row.total_debit || 0) > Number(row.total_credit || 0)
              ? 'مدين لنا'
              : Number(row.total_credit || 0) > Number(row.total_debit || 0)
                ? 'دائن علينا'
                : 'متوازن',
          lastMovementAt: row.last_movement_at,
          movementCount: Number(row.movement_count || 0),
        })),
      };
    },
  },
  accountStatement: {
    getDetailed: async (filters: {
      partyType?: 'customer' | 'sender_receiver' | 'agent';
      partyId?: string;
      branchId?: string;
      currencyCode?: string;
      dateFrom?: string;
      dateTo?: string;
      referenceType?: 'shipment' | 'receipt' | 'payment' | 'expense' | 'settlement';
      search?: string;
      page?: number;
      pageSize?: number;
    }) => {
      const query = new URLSearchParams();
      if (filters.partyType) query.set('partyType', filters.partyType);
      if (filters.partyId) query.set('partyId', filters.partyId);
      if (filters.branchId) query.set('branchId', filters.branchId);
      if (filters.currencyCode) query.set('currencyCode', filters.currencyCode);
      if (filters.dateFrom) query.set('dateFrom', filters.dateFrom);
      if (filters.dateTo) query.set('dateTo', filters.dateTo);
      if (filters.referenceType) query.set('referenceType', filters.referenceType);
      if (filters.search) query.set('search', filters.search);
      if (typeof filters.page === 'number') query.set('page', String(filters.page));
      if (typeof filters.pageSize === 'number') query.set('pageSize', String(filters.pageSize));
      const suffix = query.toString() ? `?${query.toString()}` : '';
      const payload = await httpClient.get<BackendAccountStatementResponse>(`/account-statement${suffix}`);
      let running = 0;
      const rows = payload.rows.map((row) => {
        const debit = Number(row.debit || 0);
        const credit = Number(row.credit || 0);
        running += debit - credit;
        return {
          id: row.id,
          date: row.date,
          partyType: row.party_type,
          partyName: row.party_name || '-',
          referenceType: row.reference_type || '-',
          referenceNo: row.reference_no || '-',
          shipmentNo: row.shipment_no || '-',
          description: row.description || '-',
          debit,
          credit,
          runningBalance: running,
          currencyCode: row.currency_code || '-',
          paymentMethod: row.payment_method || '-',
          branchName: row.branch_name || '-',
          username: row.username || '-',
          notes: row.notes || '-',
        };
      });
      return { ...payload, rows };
    },
  },
  statements: {
    getSummary: async (params: {
      partyType?: 'customer' | 'sender_receiver' | 'agent';
      partyId?: string;
      fromAt?: string;
      toAt?: string;
      includeReversals?: boolean;
    }): Promise<BackendPartyStatementSummary | null> => {
      const query = new URLSearchParams();
      if (params.partyType) query.set('partyType', params.partyType);
      if (params.partyId) query.set('partyId', params.partyId);
      if (params.fromAt) query.set('fromAt', params.fromAt);
      if (params.toAt) query.set('toAt', params.toAt);
      if (typeof params.includeReversals === 'boolean') query.set('includeReversals', String(params.includeReversals));
      const suffix = query.toString() ? `?${query.toString()}` : '';
      return httpClient.get<BackendPartyStatementSummary>(`/party-statements/summary${suffix}`);
    },
    getEntries: async (params: {
      partyType?: 'customer' | 'sender_receiver' | 'agent';
      partyId?: string;
      fromAt?: string;
      toAt?: string;
      includeReversals?: boolean;
    }): Promise<BackendPartyMovement[]> => {
      const query = new URLSearchParams();
      if (params.partyType) query.set('partyType', params.partyType);
      if (params.partyId) query.set('partyId', params.partyId);
      if (params.fromAt) query.set('fromAt', params.fromAt);
      if (params.toAt) query.set('toAt', params.toAt);
      if (typeof params.includeReversals === 'boolean') query.set('includeReversals', String(params.includeReversals));
      const suffix = query.toString() ? `?${query.toString()}` : '';
      return httpClient.get<BackendPartyMovement[]>(`/party-statements/entries${suffix}`);
    },
    getLedger: async (params: {
      partyType?: 'customer' | 'sender_receiver' | 'agent';
      partyId?: string;
      fromAt?: string;
      toAt?: string;
      includeReversals?: boolean;
      page?: number;
      pageSize?: number;
    }): Promise<BackendPartyLedgerResponse | null> => {
      const query = new URLSearchParams();
      if (params.partyType) query.set('partyType', params.partyType);
      if (params.partyId) query.set('partyId', params.partyId);
      if (params.fromAt) query.set('fromAt', params.fromAt);
      if (params.toAt) query.set('toAt', params.toAt);
      if (typeof params.includeReversals === 'boolean') query.set('includeReversals', String(params.includeReversals));
      if (typeof params.page === 'number') query.set('page', String(params.page));
      if (typeof params.pageSize === 'number') query.set('pageSize', String(params.pageSize));
      const suffix = query.toString() ? `?${query.toString()}` : '';
      return httpClient.get<BackendPartyLedgerResponse>(`/party-statements/ledger${suffix}`);
    },
    getCurrencySummary: async (params: {
      partyType?: 'customer' | 'sender_receiver' | 'agent';
      partyId?: string;
      fromAt?: string;
      toAt?: string;
      includeReversals?: boolean;
    }): Promise<BackendPartyCurrencySummaryRow[]> => {
      const query = new URLSearchParams();
      if (params.partyType) query.set('partyType', params.partyType);
      if (params.partyId) query.set('partyId', params.partyId);
      if (params.fromAt) query.set('fromAt', params.fromAt);
      if (params.toAt) query.set('toAt', params.toAt);
      if (typeof params.includeReversals === 'boolean') query.set('includeReversals', String(params.includeReversals));
      const suffix = query.toString() ? `?${query.toString()}` : '';
      return httpClient.get<BackendPartyCurrencySummaryRow[]>(`/party-statements/currency-summary${suffix}`);
    },
    getPackage: async (params: {
      partyType?: 'customer' | 'sender_receiver' | 'agent';
      partyId?: string;
      fromAt?: string;
      toAt?: string;
      includeReversals?: boolean;
      page?: number;
      pageSize?: number;
    }): Promise<BackendPartyStatementPackage | null> => {
      const query = new URLSearchParams();
      if (params.partyType) query.set('partyType', params.partyType);
      if (params.partyId) query.set('partyId', params.partyId);
      if (params.fromAt) query.set('fromAt', params.fromAt);
      if (params.toAt) query.set('toAt', params.toAt);
      if (typeof params.includeReversals === 'boolean') query.set('includeReversals', String(params.includeReversals));
      if (typeof params.page === 'number') query.set('page', String(params.page));
      if (typeof params.pageSize === 'number') query.set('pageSize', String(params.pageSize));
      const suffix = query.toString() ? `?${query.toString()}` : '';
      return httpClient.get<BackendPartyStatementPackage>(`/party-statements/package${suffix}`);
    },
    comparePeriods: async (params: {
      partyType?: 'customer' | 'sender_receiver' | 'agent';
      partyId?: string;
      fromAt: string;
      toAt: string;
      includeReversals?: boolean;
    }): Promise<BackendPartyStatementComparison | null> => {
      const query = new URLSearchParams();
      if (params.partyType) query.set('partyType', params.partyType);
      if (params.partyId) query.set('partyId', params.partyId);
      query.set('fromAt', params.fromAt);
      query.set('toAt', params.toAt);
      if (typeof params.includeReversals === 'boolean') query.set('includeReversals', String(params.includeReversals));
      const suffix = `?${query.toString()}`;
      return httpClient.get<BackendPartyStatementComparison>(`/party-statements/compare${suffix}`);
    },
    getAnalyticsSnapshot: async (params: {
      partyType?: 'customer' | 'sender_receiver' | 'agent';
      partyId?: string;
      fromAt?: string;
      toAt?: string;
      includeReversals?: boolean;
      topN?: number;
    }): Promise<BackendPartyAnalyticsSnapshot | null> => {
      const query = new URLSearchParams();
      if (params.partyType) query.set('partyType', params.partyType);
      if (params.partyId) query.set('partyId', params.partyId);
      if (params.fromAt) query.set('fromAt', params.fromAt);
      if (params.toAt) query.set('toAt', params.toAt);
      if (typeof params.includeReversals === 'boolean') query.set('includeReversals', String(params.includeReversals));
      if (typeof params.topN === 'number') query.set('topN', String(params.topN));
      const suffix = query.toString() ? `?${query.toString()}` : '';
      return httpClient.get<BackendPartyAnalyticsSnapshot>(`/party-statements/analytics${suffix}`);
    },
    getDashboardPackage: async (params: {
      partyType?: 'customer' | 'sender_receiver' | 'agent';
      partyId?: string;
      fromAt?: string;
      toAt?: string;
      includeReversals?: boolean;
      page?: number;
      pageSize?: number;
      topN?: number;
      tabs?: Array<'statement' | 'comparison' | 'analytics'>;
      comparisonFromAt?: string;
      comparisonToAt?: string;
    }): Promise<BackendPartyDashboardPackage | null> => {
      const query = new URLSearchParams();
      if (params.partyType) query.set('partyType', params.partyType);
      if (params.partyId) query.set('partyId', params.partyId);
      if (params.fromAt) query.set('fromAt', params.fromAt);
      if (params.toAt) query.set('toAt', params.toAt);
      if (typeof params.includeReversals === 'boolean') query.set('includeReversals', String(params.includeReversals));
      if (typeof params.page === 'number') query.set('page', String(params.page));
      if (typeof params.pageSize === 'number') query.set('pageSize', String(params.pageSize));
      if (typeof params.topN === 'number') query.set('topN', String(params.topN));
      if (params.tabs?.length) query.set('tabs', params.tabs.join(','));
      if (params.comparisonFromAt) query.set('comparisonFromAt', params.comparisonFromAt);
      if (params.comparisonToAt) query.set('comparisonToAt', params.comparisonToAt);
      const suffix = query.toString() ? `?${query.toString()}` : '';
      return httpClient.get<BackendPartyDashboardPackage>(`/party-statements/dashboard-package${suffix}`);
    },
    getDashboardCacheMetrics: async (): Promise<BackendDashboardCacheMetrics | null> => {
      return httpClient.get<BackendDashboardCacheMetrics>('/party-statements/dashboard-cache-metrics');
    },
    resetDashboardCache: async (payload?: { resetCache?: boolean; resetMetrics?: boolean; confirm?: boolean }): Promise<BackendDashboardCacheResetResult | null> => {
      return httpClient.post<BackendDashboardCacheResetResult>('/party-statements/dashboard-cache-reset', payload || {});
    },
    getDashboardCacheResetAudit: async (limit = 20): Promise<BackendDashboardCacheResetAudit | null> => {
      return httpClient.get<BackendDashboardCacheResetAudit>(`/party-statements/dashboard-cache-reset-audit?limit=${limit}`);
    },
  },

  agentCodStatement: {
    getStatement: async (filters: {
      agentId?: string;
      branchId?: string;
      dateFrom?: string;
      dateTo?: string;
      shipmentStatus?: string;
      collectionStatus?: string;
      currencyCode?: string;
      senderName?: string;
      receiverName?: string;
      shipmentNo?: string;
      search?: string;
      page?: number;
      pageSize?: number;
    }): Promise<{
      rows: AgentCodRow[];
      summary: AgentCodSummary[];
      page: number;
      pageSize: number;
      total: number;
    }> => {
      const q = new URLSearchParams();
      if (filters.agentId) q.set('agentId', filters.agentId);
      if (filters.branchId) q.set('branchId', filters.branchId);
      if (filters.dateFrom) q.set('dateFrom', filters.dateFrom);
      if (filters.dateTo) q.set('dateTo', filters.dateTo);
      if (filters.shipmentStatus) q.set('shipmentStatus', filters.shipmentStatus);
      if (filters.collectionStatus) q.set('collectionStatus', filters.collectionStatus);
      if (filters.currencyCode) q.set('currencyCode', filters.currencyCode);
      if (filters.senderName) q.set('senderName', filters.senderName);
      if (filters.receiverName) q.set('receiverName', filters.receiverName);
      if (filters.shipmentNo) q.set('shipmentNo', filters.shipmentNo);
      if (filters.search) q.set('search', filters.search);
      if (typeof filters.page === 'number') q.set('page', String(filters.page));
      if (typeof filters.pageSize === 'number') q.set('pageSize', String(filters.pageSize));
      const suffix = q.toString() ? `?${q.toString()}` : '';
      return httpClient.get(`/agent-cod-statement${suffix}`);
    },
  },

  deliveryReports: {
    pendingTransfers: async (filters: {
      dateFrom?: string;
      dateTo?: string;
      branchId?: string;
      agentId?: string;
    }): Promise<{ rows: DeliveryPendingTransferRow[] }> => {
      const q = new URLSearchParams();
      if (filters.dateFrom) q.set('dateFrom', filters.dateFrom);
      if (filters.dateTo) q.set('dateTo', filters.dateTo);
      if (filters.branchId) q.set('branchId', filters.branchId);
      if (filters.agentId) q.set('agentId', filters.agentId);
      const suffix = q.toString() ? `?${q.toString()}` : '';
      return httpClient.get(`/delivery-reports/pending-transfers${suffix}`);
    },
    transferProfit: async (filters: {
      dateFrom?: string;
      dateTo?: string;
      branchId?: string;
      cashboxId?: string;
      status?: string;
    }): Promise<{ rows: DeliveryTransferProfitRow[]; summary: DeliveryTransferProfitSummary }> => {
      const q = new URLSearchParams();
      if (filters.dateFrom) q.set('dateFrom', filters.dateFrom);
      if (filters.dateTo) q.set('dateTo', filters.dateTo);
      if (filters.branchId) q.set('branchId', filters.branchId);
      if (filters.cashboxId) q.set('cashboxId', filters.cashboxId);
      if (filters.status) q.set('status', filters.status);
      const suffix = q.toString() ? `?${q.toString()}` : '';
      return httpClient.get(`/delivery-reports/transfer-profit${suffix}`);
    },
    legacyAdditionalCharges: async (filters: {
      dateFrom?: string;
      dateTo?: string;
      branchId?: string;
      status?: string;
    }): Promise<{ rows: DeliveryLegacyAdditionalChargesRow[] }> => {
      const q = new URLSearchParams();
      if (filters.dateFrom) q.set('dateFrom', filters.dateFrom);
      if (filters.dateTo) q.set('dateTo', filters.dateTo);
      if (filters.branchId) q.set('branchId', filters.branchId);
      if (filters.status) q.set('status', filters.status);
      const suffix = q.toString() ? `?${q.toString()}` : '';
      return httpClient.get(`/delivery-reports/legacy-additional-charges${suffix}`);
    },
    agentCommissionReview: async (filters: {
      dateFrom?: string;
      dateTo?: string;
      branchId?: string;
      agentId?: string;
      status?: string;
    }): Promise<{ rows: DeliveryAgentCommissionReviewRow[] }> => {
      const q = new URLSearchParams();
      if (filters.dateFrom) q.set('dateFrom', filters.dateFrom);
      if (filters.dateTo) q.set('dateTo', filters.dateTo);
      if (filters.branchId) q.set('branchId', filters.branchId);
      if (filters.agentId) q.set('agentId', filters.agentId);
      if (filters.status) q.set('status', filters.status);
      const suffix = q.toString() ? `?${q.toString()}` : '';
      return httpClient.get(`/delivery-reports/agent-commission-review${suffix}`);
    },
  },
};

export type AgentCodRow = {
  shipmentId: string;
  shipmentNo: string;
  shipmentDate: string;
  agentId: string | null;
  agentName: string;
  branchId: string | null;
  branchName: string;
  senderName: string;
  receiverName: string;
  destination: string;
  shipmentStatus: string;
  currencyCode: string;
  shippingFeeAmount: number;
  senderCollectionAmount: number;
  loadingDuesAmount: number;
  prepaidAmount: number;
  totalDueOnDelivery: number;
  collectedAmount: number;
  remainingToCollect: number;
  paidToSenderAmount: number;
  remainingToSender: number;
  collectionCashboxName: string;
  lastReceiptVoucherNo: string;
  notes: string;
  financialStatus: string | null;
  paymentStatus: string | null;
  freightPaymentType: 'PREPAID' | 'COLLECTION';
  agentCommissionPercentageSnapshot: number;
  agentCommissionAmount: number;
  agentOwesCompany: number;
  companyOwesAgent: number;
  transferServiceFee: number;
  transferServiceFeeCurrency: string;
};

export type AgentCodSummary = {
  currencyCode: string;
  totalShippingFees: number;
  totalSenderCollections: number;
  totalDueOnDelivery: number;
  totalCollected: number;
  totalRemainingToCollect: number;
  totalPaidToSenders: number;
  totalRemainingToSenders: number;
  totalAgentCommission: number;
  totalAgentOwesCompany: number;
  totalCompanyOwesAgent: number;
  shipmentCount: number;
};

export type DeliveryPendingTransferRow = {
  id: string;
  created_at: string;
  status: string;
  shipment_no: string | null;
  branch_name: string | null;
  agent_name: string | null;
  sender_name: string;
  receiver_name: string;
  transfer_service_fee: number;
  transfer_service_fee_currency: string;
};

export type DeliveryTransferProfitRow = {
  report_date: string;
  id: string;
  shipment_no: string | null;
  transfer_service_fee: number;
  transfer_service_fee_currency: string;
  company_transfer_profit: number;
  company_transfer_profit_currency: string;
  cashbox_name: string | null;
  receipt_voucher_no: string | null;
  status: string;
};

export type DeliveryTransferProfitSummary = {
  totalTransferServiceFees: number;
  completedCount: number;
  cancelledCount: number;
  pendingCount: number;
};

export type DeliveryLegacyAdditionalChargesRow = {
  shipment_id: string;
  shipment_no: string;
  created_at: string;
  sender_name: string | null;
  receiver_name: string | null;
  additional_charges: number;
  transfer_service_fee: number;
  status: string;
};

export type DeliveryAgentCommissionReviewRow = {
  shipment_id: string;
  shipment_no: string;
  created_at: string;
  agent_name: string;
  freight_charge: number;
  commission_percentage_snapshot: number;
  commission_amount_snapshot: number;
  expected_commission_amount: number;
  base_type: string;
  status: string;
};
