import { httpClient } from './httpClient';

export interface DriverAdvanceEntry {
  id: string;
  agent_id: string | null;
  agent_name: string | null;
  amount_usd: string;
  notes: string | null;
  trip_date: string | null;
  received_date: string | null;
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

export interface DriverReportEntry {
  id: string;
  driver_id: string;
  driver_name: string;
  trip_wage_usd: string | null;
  agent_id: string | null;
  agent_name: string | null;
  amount_usd: string;
  notes: string | null;
  trip_date: string | null;
  received_date: string | null;
  created_at: string;
  payment_voucher_id: string | null;
  settled_at: string | null;
}

export interface DriverReportFilters {
  driverId?: string;
  fromDate?: string;
  toDate?: string;
}

export const driverAdvancesGateway = {
  summary: (driverId: string): Promise<DriverAdvanceSummary> => httpClient.get(`/drivers/${driverId}/advances`),
  add: (
    driverId: string,
    input: {
      agentId?: string | null;
      amountUsd: number;
      notes?: string | null;
      tripDate?: string | null;
      receivedDate?: string | null;
    },
  ): Promise<DriverAdvanceSummary> => httpClient.post(`/drivers/${driverId}/advances`, input),
  remove: (driverId: string, advanceId: string): Promise<DriverAdvanceSummary> =>
    httpClient.delete(`/drivers/${driverId}/advances/${advanceId}`),
  settle: (driverId: string): Promise<DriverAdvanceSummary> => httpClient.post(`/drivers/${driverId}/advances/settle`, {}),
  report: (filters: DriverReportFilters): Promise<{ entries: DriverReportEntry[] }> => {
    const params = new URLSearchParams();
    if (filters.driverId) params.set('driverId', filters.driverId);
    if (filters.fromDate) params.set('fromDate', filters.fromDate);
    if (filters.toDate) params.set('toDate', filters.toDate);
    const query = params.toString();
    return httpClient.get(`/drivers/report${query ? `?${query}` : ''}`);
  },
};
