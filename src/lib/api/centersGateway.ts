import { httpClient } from './httpClient';

export type ProvincialInboundRow = {
  shipmentId: string;
  shipmentNo: string;
  shipmentStatus: string;
  shipmentCreatedAt: string;
  ledgerDate: string | null;
  ledgerReceiptNo: string | null;
  ledgerDestination: string | null;
  parcelType: string | null;
  parcelCount: number | null;
  weightKg: number | null;
  senderName: string | null;
  receiverName: string | null;
  collectAmount: number;
  prepaidAmount: number;
  hawalaAmount: number;
  transferServiceFee: number;
  totalAmount: number;
  currencyCode: string;
  agentName: string | null;
  operationalCenter: string;
  centerReceived: boolean;
  centerReceivedAt: string | null;
  centerReceiptName: string | null;
  fromQuickLedger: boolean;
};

export const centersGateway = {
  listProvincialInbound: async (filters: {
    center?: string;
    dateFrom?: string;
    dateTo?: string;
    receiptStatus?: 'all' | 'pending' | 'received';
  }): Promise<ProvincialInboundRow[]> => {
    const q = new URLSearchParams();
    if (filters.center) q.set('center', filters.center);
    if (filters.dateFrom) q.set('dateFrom', filters.dateFrom);
    if (filters.dateTo) q.set('dateTo', filters.dateTo);
    if (filters.receiptStatus) q.set('receiptStatus', filters.receiptStatus);
    const suffix = q.toString() ? `?${q.toString()}` : '';
    const data = await httpClient.get<{ rows: ProvincialInboundRow[] }>(`/center-receipts/provincial-inbound${suffix}`);
    return data.rows ?? [];
  },
};
