import { httpClient } from '../api/httpClient';

export type DailyLedgerDispatchDefinition = {
  id: string;
  company_id: string;
  branch_id: string;
  ledger_date: string;
  line_label: string;
  dispatch_no: number;
  driver_id: string | null;
  vehicle_id: string | null;
  driver_label: string | null;
  vehicle_label: string | null;
  trip_no: string | null;
  notes: string | null;
  rows_count?: number;
};

export type DailyLedgerDispatchScope = {
  branchId: string;
  ledgerDate: string;
  lineLabel: string;
};

export const dailyLedgerDispatchGateway = {
  list: async (scope: DailyLedgerDispatchScope & { suggestNext?: boolean }) => {
    const params = new URLSearchParams({
      branchId: scope.branchId,
      ledgerDate: scope.ledgerDate,
      lineLabel: scope.lineLabel,
    });
    if (scope.suggestNext) params.set('suggestNext', 'true');
    const response = await httpClient.get<{
      definitions: DailyLedgerDispatchDefinition[];
      nextDispatchNo?: number;
    }>(`/daily-ledger/dispatch-definitions?${params.toString()}`);
    return {
      definitions: response.definitions ?? [],
      nextDispatchNo: response.nextDispatchNo,
    };
  },

  create: async (input: DailyLedgerDispatchScope & {
    dispatchNo: number;
    driverId?: string | null;
    vehicleId?: string | null;
    driverLabel?: string | null;
    vehicleLabel?: string | null;
    tripNo?: string | null;
    notes?: string | null;
  }) => {
    return httpClient.post<DailyLedgerDispatchDefinition>('/daily-ledger/dispatch-definitions', input);
  },

  update: async (
    id: string,
    input: {
      driverId?: string | null;
      vehicleId?: string | null;
      driverLabel?: string | null;
      vehicleLabel?: string | null;
      tripNo?: string | null;
      notes?: string | null;
    },
  ) => {
    return httpClient.patch<DailyLedgerDispatchDefinition>(`/daily-ledger/dispatch-definitions/${id}`, input);
  },

  remove: async (id: string) => {
    await httpClient.delete(`/daily-ledger/dispatch-definitions/${id}`);
  },
};
