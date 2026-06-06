import { httpClient } from './httpClient';

export type LoadableShipmentRow = {
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
  loadedManifestId: string | null;
  loadedManifestNo: string | null;
  loadedAt: string | null;
  fromQuickLedger: boolean;
  isLoaded: boolean;
};

export const manifestGateway = {
  listLoadableShipments: async (filters: {
    dateFrom?: string;
    dateTo?: string;
    destination?: string;
    loadStatus?: 'all' | 'pending' | 'loaded';
    manifestId?: string;
  }): Promise<LoadableShipmentRow[]> => {
    const q = new URLSearchParams();
    if (filters.dateFrom) q.set('dateFrom', filters.dateFrom);
    if (filters.dateTo) q.set('dateTo', filters.dateTo);
    if (filters.destination) q.set('destination', filters.destination);
    if (filters.loadStatus) q.set('loadStatus', filters.loadStatus);
    if (filters.manifestId) q.set('manifestId', filters.manifestId);
    const suffix = q.toString() ? `?${q.toString()}` : '';
    const data = await httpClient.get<{ rows: LoadableShipmentRow[] }>(`/manifests/loadable-shipments${suffix}`);
    return data.rows ?? [];
  },
};
