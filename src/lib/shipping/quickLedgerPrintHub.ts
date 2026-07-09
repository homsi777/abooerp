import { filterPrintableDailyLedgerRows } from './dailyLedgerPrintable';
import {
  filterRemoteRowsBySearch,
  remoteRowMatchesDriver,
  sortRemoteRowsChronological,
} from './dailyLedgerRowFilter';
import type { DailyLedgerDispatchDefinition } from './dailyLedgerDispatchGateway';
import type { RemoteDailyLedgerRow } from './dailyLedgerTypes';

export type PrintHubMode = 'destination' | 'dispatch' | 'receipts';

export const ALL_DRIVERS_PRINT_KEY = '__ALL_DRIVERS__';

export type PrintHubDestinationSummary = {
  destination: string;
  rowsCount: number;
};

export type PrintHubDriverOption = {
  key: string;
  backendId: string | null;
  label: string;
  rowsCount: number;
};

export type PrintHubDispatchSummary = {
  id: string;
  dispatchNo: number;
  driverLabel: string;
  vehicleLabel: string;
  tripNo: string;
  rowsCount: number;
};

function normalizeLabel(value: string | null | undefined): string {
  return String(value ?? '').trim();
}

export function buildDestinationSummaries(rows: RemoteDailyLedgerRow[]): PrintHubDestinationSummary[] {
  const grouped = new Map<string, number>();
  for (const row of rows) {
    const destination = normalizeLabel(row.destination);
    if (!destination) continue;
    grouped.set(destination, (grouped.get(destination) ?? 0) + 1);
  }
  return [...grouped.entries()]
    .map(([destination, rowsCount]) => ({ destination, rowsCount }))
    .sort((a, b) => a.destination.localeCompare(b.destination, 'ar'));
}

export function buildDriverOptions(rows: RemoteDailyLedgerRow[]): PrintHubDriverOption[] {
  const grouped = new Map<string, PrintHubDriverOption>();
  for (const row of rows) {
    const backendId = row.driver_id ?? null;
    const label = normalizeLabel(row.driver_label) || 'بدون سائق';
    const key = backendId ? `id:${backendId}` : `label:${label}`;
    const existing = grouped.get(key) ?? { key, backendId, label, rowsCount: 0 };
    existing.rowsCount += 1;
    grouped.set(key, existing);
  }
  return [...grouped.values()].sort((a, b) => a.label.localeCompare(b.label, 'ar'));
}

export function buildDispatchSummaries(
  definitions: DailyLedgerDispatchDefinition[],
  rows: RemoteDailyLedgerRow[],
  branchId?: string | null,
): PrintHubDispatchSummary[] {
  const scoped = branchId
    ? definitions.filter((item) => item.branch_id === branchId)
    : definitions;
  const countByDispatch = new Map<string, number>();
  for (const row of rows) {
    if (!row.dispatch_id) continue;
    countByDispatch.set(row.dispatch_id, (countByDispatch.get(row.dispatch_id) ?? 0) + 1);
  }
  return [...scoped]
    .sort((a, b) => a.dispatch_no - b.dispatch_no)
    .map((definition) => ({
      id: definition.id,
      dispatchNo: definition.dispatch_no,
      driverLabel: normalizeLabel(definition.driver_label) || '—',
      vehicleLabel: normalizeLabel(definition.vehicle_label) || '—',
      tripNo: normalizeLabel(definition.trip_no),
      rowsCount: countByDispatch.get(definition.id) ?? definition.rows_count ?? 0,
    }));
}

export function filterRowsByDriverKey(
  rows: RemoteDailyLedgerRow[],
  driverKey: string,
): RemoteDailyLedgerRow[] {
  if (!driverKey || driverKey === ALL_DRIVERS_PRINT_KEY) return rows;
  return rows.filter((row) => {
    if (driverKey.startsWith('id:')) return `id:${row.driver_id ?? ''}` === driverKey;
    const label = normalizeLabel(row.driver_label) || 'بدون سائق';
    return `label:${label}` === driverKey;
  });
}

export type PrintHubFilterInput = {
  searchQuery?: string;
  agents?: Array<{ id: number; code: string; name: string; governorate?: string; city?: string; area?: string }>;
  driverKey?: string;
  selectedDestinations?: string[];
  selectedDispatchIds?: string[];
  sessionId?: string | null;
  driverBackendId?: string;
  driverName?: string;
  vehicleIdsForDriver?: ReadonlySet<string>;
};

export function filterRowsForPrintHub(
  rows: RemoteDailyLedgerRow[],
  options: PrintHubFilterInput,
): RemoteDailyLedgerRow[] {
  let filtered = filterPrintableDailyLedgerRows(rows);

  if (options.sessionId) {
    filtered = filtered.filter((row) => row.session_id === options.sessionId);
  }

  if (options.driverBackendId) {
    filtered = filtered.filter((row) =>
      remoteRowMatchesDriver(row, {
        driverBackendId: options.driverBackendId,
        driverName: options.driverName,
        vehicleIdsForDriver: options.vehicleIdsForDriver,
        assignOrphanRowsToSelectedDriver: Boolean(options.searchQuery?.trim()),
      }),
    );
  } else if (options.driverKey) {
    filtered = filterRowsByDriverKey(filtered, options.driverKey);
  }

  if (options.selectedDestinations?.length) {
    const selected = new Set(options.selectedDestinations.map((item) => normalizeLabel(item)));
    filtered = filtered.filter((row) => selected.has(normalizeLabel(row.destination)));
  }

  if (options.selectedDispatchIds?.length) {
    const selected = new Set(options.selectedDispatchIds);
    filtered = filtered.filter((row) => row.dispatch_id && selected.has(row.dispatch_id));
  }

  const searched = filterRemoteRowsBySearch(filtered, options.searchQuery ?? '', options.agents ?? []);
  return sortRemoteRowsChronological(searched);
}
