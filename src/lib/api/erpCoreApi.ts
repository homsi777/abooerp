import { httpClient } from './httpClient';

export interface CoreEntity {
  id: string;
  code: string;
  created_at: string;
  updated_at: string;
}

export interface ShipmentRecord {
  id: string;
  shipment_no: string;
  destination_city: string;
  status: 'created' | 'in_transit' | 'manifested' | 'delivered' | 'cancelled';
  original_amount: number;
  original_currency: 'USD' | 'SYP' | 'TRY';
  exchange_rate_to_usd: number;
  base_amount_usd: number;
}

export const erpCoreApi = {
  listCustomers: () => httpClient.get<CoreEntity[]>('/customers'),
  listDrivers: () => httpClient.get<CoreEntity[]>('/drivers'),
  listVehicles: () => httpClient.get<CoreEntity[]>('/vehicles'),
  listBranches: () => httpClient.get<CoreEntity[]>('/branches'),
  listAgents: () => httpClient.get<CoreEntity[]>('/agents'),
  listShipments: () => httpClient.get<ShipmentRecord[]>('/shipments'),
  listManifests: () => httpClient.get<Array<{ id: string; manifest_no: string; status: string }>>('/manifests'),
  listDeliveries: () => httpClient.get<Array<{ id: string; delivery_no: string; status: string }>>('/deliveries'),
};
