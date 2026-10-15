import { httpClient } from './httpClient';

export interface DriverAdvanceEntry {
  id: string;
  agent_id: string | null;
  agent_name: string | null;
  amount_usd: string;
  notes: string | null;
  created_at: string;
  payment_voucher_id: string | null;
}

export interface DriverAdvanceSummary {
  driverId: string;
  driverName: string;
  tripWageUsd: number;
  totalTaken: number;
  remainingForDriver: number;
  owedByDriver: number;
  entries: DriverAdvanceEntry[];
}

export const driverAdvancesGateway = {
  summary: (driverId: string): Promise<DriverAdvanceSummary> => httpClient.get(`/drivers/${driverId}/advances`),
  add: (driverId: string, input: { agentId?: string | null; amountUsd: number; notes?: string | null }): Promise<DriverAdvanceSummary> =>
    httpClient.post(`/drivers/${driverId}/advances`, input),
  remove: (driverId: string, advanceId: string): Promise<DriverAdvanceSummary> =>
    httpClient.delete(`/drivers/${driverId}/advances/${advanceId}`),
  settle: (driverId: string): Promise<DriverAdvanceSummary> => httpClient.post(`/drivers/${driverId}/advances/settle`, {}),
};
