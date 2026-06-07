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
  agentId: string | null;
  agentName: string | null;
  driverId: string | null;
  driverLabel: string | null;
  vehicleLabel: string | null;
  tripNo: string | null;
  operationalCenter: string;
  centerReceived: boolean;
  centerReceivedAt: string | null;
  centerReceiptName: string | null;
  fromQuickLedger: boolean;
  isPosted?: boolean;
  lineLabel?: string | null;
  agentCommissionBase?: number;
  agentCommissionPercentage?: number | null;
  agentCommissionAmount?: number;
  commissionIssue?: 'none' | 'missing_agent' | 'missing_rate';
};

export type VehicleTripReportMeta = {
  totalRows: number;
  postedRows: number;
  ledgerOnlyRows: number;
};

export const centersGateway = {
  listProvincialInbound: async (filters: {
    center?: string;
    dateFrom?: string;
    dateTo?: string;
    receiptStatus?: 'all' | 'pending' | 'received';
    driverId?: string;
  }): Promise<ProvincialInboundRow[]> => {
    const q = new URLSearchParams();
    if (filters.center) q.set('center', filters.center);
    if (filters.dateFrom) q.set('dateFrom', filters.dateFrom);
    if (filters.dateTo) q.set('dateTo', filters.dateTo);
    if (filters.receiptStatus) q.set('receiptStatus', filters.receiptStatus);
    if (filters.driverId) q.set('driverId', filters.driverId);
    const suffix = q.toString() ? `?${q.toString()}` : '';
    const data = await httpClient.get<{ rows: ProvincialInboundRow[] }>(`/center-receipts/provincial-inbound${suffix}`);
    return data.rows ?? [];
  },

  getVehicleTripReport: async (filters: {
    driverId: string;
    date: string;
  }): Promise<{ rows: ProvincialInboundRow[]; meta: VehicleTripReportMeta }> => {
    const q = new URLSearchParams({
      driverId: filters.driverId,
      date: filters.date,
    });
    const data = await httpClient.get<{ rows: ProvincialInboundRow[]; meta: VehicleTripReportMeta }>(
      `/center-receipts/vehicle-trip-report?${q.toString()}`,
    );
    return {
      rows: data.rows ?? [],
      meta: data.meta ?? { totalRows: 0, postedRows: 0, ledgerOnlyRows: 0 },
    };
  },
};
