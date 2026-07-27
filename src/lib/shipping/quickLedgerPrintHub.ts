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

function normalizeDriverBackendId(value: string | null | undefined): string {
  return String(value ?? '').trim().toLowerCase();
}

export type PrintHubDriverSelection = {
  backendId?: string | null;
  name?: string;
  code?: string;
  vehicleIdsForDriver?: ReadonlySet<string>;
};

export function rowMatchesHubDriver(
  row: RemoteDailyLedgerRow,
  driver: PrintHubDriverSelection | null | undefined,
): boolean {
  if (!driver) return true;

  const backendId = normalizeDriverBackendId(driver.backendId);
  if (
    remoteRowMatchesDriver(row, {
      driverBackendId: backendId || undefined,
      driverName: driver.name,
      vehicleIdsForDriver: driver.vehicleIdsForDriver,
    })
  ) {
    return true;
  }

  const rowLabel = normalizeLabel(row.driver_label).toLowerCase();
  const driverName = normalizeLabel(driver.name).toLowerCase();
  const driverCode = normalizeLabel(driver.code).toLowerCase();

  if (driverName && rowLabel) {
    if (rowLabel === driverName || rowLabel.includes(driverName) || driverName.includes(rowLabel)) {
      return true;
    }
    if (driverCode && rowLabel.includes(driverCode)) {
      return true;
    }
    if (driverCode && driverName && rowLabel.includes(`${driverCode} — ${driverName}`)) {
      return true;
    }
    if (driverCode && driverName && rowLabel.includes(`${driverName} — ${driverCode}`)) {
      return true;
    }
  }

  if (driverCode && rowLabel.includes(driverCode)) {
    return true;
  }

  return false;
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
    const key = backendId ? `id:${normalizeDriverBackendId(backendId)}` : `label:${label}`;
    const existing = grouped.get(key) ?? {
      key,
      backendId: backendId ? normalizeDriverBackendId(backendId) : null,
      label,
      rowsCount: 0,
    };
    existing.rowsCount += 1;
    grouped.set(key, existing);
  }
  return [...grouped.values()].sort((a, b) => a.label.localeCompare(b.label, 'ar'));
}

/** قائمة السائقين من الكتالوج مع عدد الأسطر المطابقة فعلياً */
export function buildCatalogDriverOptions(
  catalogDrivers: Array<{ id: number; name: string; code?: string }>,
  rows: RemoteDailyLedgerRow[],
  resolveBackendId: (driverId: number) => string | null | undefined,
  resolveVehicleIdsForDriver?: (backendId: string) => ReadonlySet<string> | undefined,
): PrintHubDriverOption[] {
  const options: PrintHubDriverOption[] = catalogDrivers
    .map((driver) => {
      const backendId = normalizeDriverBackendId(resolveBackendId(driver.id));
      const key = backendId ? `id:${backendId}` : `label:${normalizeLabel(driver.name)}`;
      const label = driver.code ? `${driver.code} — ${driver.name}` : driver.name;
      const selection: PrintHubDriverSelection = {
        backendId: backendId || null,
        name: driver.name,
        code: driver.code,
        vehicleIdsForDriver: backendId ? resolveVehicleIdsForDriver?.(backendId) : undefined,
      };
      const rowsCount = rows.filter((row) => rowMatchesHubDriver(row, selection)).length;
      return {
        key,
        backendId: backendId || null,
        label,
        rowsCount,
      };
    })
    .sort((a, b) => a.label.localeCompare(b.label, 'ar'));

  const rowOnlyDrivers = buildDriverOptions(rows).filter(
    (item) => !options.some((option) => option.key === item.key),
  );

  return [...options, ...rowOnlyDrivers].sort((a, b) => a.label.localeCompare(b.label, 'ar'));
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
    if (driverKey.startsWith('id:')) {
      return normalizeDriverBackendId(row.driver_id) === normalizeDriverBackendId(driverKey.slice(3));
    }
    const label = normalizeLabel(row.driver_label) || 'بدون سائق';
    return `label:${label}` === driverKey;
  });
}

export type PrintHubFilterInput = {
  searchQuery?: string;
  agents?: Array<{ id: number; code: string; name: string; governorate?: string; city?: string; area?: string }>;
  driverKey?: string;
  driverSelection?: PrintHubDriverSelection | null;
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

  const driverSelection =
    options.driverSelection ??
    (options.driverBackendId || options.driverName || options.driverKey
      ? {
          backendId: options.driverBackendId ?? null,
          name: options.driverName,
          vehicleIdsForDriver: options.vehicleIdsForDriver,
        }
      : options.driverKey && options.driverKey !== ALL_DRIVERS_PRINT_KEY
        ? options.driverKey.startsWith('id:')
          ? { backendId: options.driverKey.slice(3) }
          : options.driverKey.startsWith('label:')
            ? { name: options.driverKey.slice(6) }
            : null
        : null);

  if (driverSelection) {
    filtered = filtered.filter((row) => rowMatchesHubDriver(row, driverSelection));
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
