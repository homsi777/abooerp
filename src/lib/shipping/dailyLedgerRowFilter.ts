import { compareDailyLedgerRowsChronological, filterPrintableDailyLedgerRows } from './dailyLedgerPrintable';
import type { RemoteDailyLedgerRow } from './dailyLedgerTypes';

export type LedgerAgentSearchHint = {
  id: number | string;
  code: string;
  name: string;
  governorate?: string | null;
  city?: string | null;
  area?: string | null;
};

export type LedgerLocalSearchRow = {
  receiptNo: string;
  origin: string;
  destination: string;
  parcelType: string;
  sender: string;
  receiver: string;
  notes: string;
  agentName?: string;
  agentId?: number;
};

export type LedgerPrintScope = 'driver' | 'date' | 'agent' | 'session';

export type LedgerDriverMatchFilters = {
  driverBackendId?: string;
  driverName?: string;
  /** مركبات مرتبطة بالسائق (UUID lowercase) */
  vehicleIdsForDriver?: ReadonlySet<string>;
  /** إرساليات بلا سائق/مركبة — تُنسب للسائق المختار (مع البحث النشط فقط) */
  assignOrphanRowsToSelectedDriver?: boolean;
};

export type PrepareLedgerOutputOptions = {
  printScope: LedgerPrintScope;
  searchQuery?: string;
  agents?: LedgerAgentSearchHint[];
  activeSessionId?: string | null;
  destinationFilter?: string;
  driverBackendId?: string;
  driverName?: string;
  vehicleIdsForDriver?: ReadonlySet<string>;
  assignOrphanRowsToSelectedDriver?: boolean;
};

function normalizeLedgerUuid(value: string | null | undefined): string {
  return String(value ?? '').trim().toLowerCase();
}

export function normalizeLedgerSearchText(value: string | null | undefined): string {
  return String(value ?? '').trim().replace(/\s+/g, ' ').toLowerCase();
}

export function matchesLedgerSearch(
  searchQuery: string,
  fields: Array<string | number | null | undefined>,
): boolean {
  const q = normalizeLedgerSearchText(searchQuery);
  if (!q) return true;
  return fields.some((field) => normalizeLedgerSearchText(String(field ?? '')).includes(q));
}

function agentFieldValues(agent: LedgerAgentSearchHint): string[] {
  return [agent.name, agent.code, agent.governorate, agent.city, agent.area].map((value) => String(value ?? ''));
}

function agentMatchesSearchQuery(agent: LedgerAgentSearchHint, query: string): boolean {
  return agentFieldValues(agent).some((field) => matchesLedgerSearch(query, [field]));
}

function destinationRelatesToAgent(destination: string, agent: LedgerAgentSearchHint): boolean {
  const dest = normalizeLedgerSearchText(destination);
  if (!dest) return false;
  return agentFieldValues(agent).some((field) => {
    const normalized = normalizeLedgerSearchText(field);
    if (!normalized) return false;
    return dest.includes(normalized) || normalized.includes(dest);
  });
}

/** حقول البحث لسطر محلي — نفس منطق الشاشة + توسيع الوكيل من الكتalog */
export function ledgerLocalSearchFields(
  row: LedgerLocalSearchRow,
  agents: LedgerAgentSearchHint[] = [],
): string[] {
  const fields = [
    row.receiptNo,
    row.origin,
    row.destination,
    row.parcelType,
    row.sender,
    row.receiver,
    row.notes,
    row.agentName ?? '',
    String(row.agentId ?? ''),
  ];
  for (const agent of agents) {
    if (destinationRelatesToAgent(row.destination, agent)) {
      fields.push(...agentFieldValues(agent));
    }
  }
  return fields;
}

/** حقول البحث لسطر الخادم — موحّدة مع الشاشة والطباعة */
export function ledgerRemoteSearchFields(
  row: RemoteDailyLedgerRow,
  agents: LedgerAgentSearchHint[] = [],
): string[] {
  const fields = [
    row.receipt_no ?? '',
    row.origin_label ?? '',
    row.line_label ?? '',
    row.destination ?? '',
    row.parcel_type ?? '',
    row.sender_name ?? '',
    row.receiver_name ?? '',
    row.notes ?? '',
    row.driver_label ?? '',
    row.vehicle_label ?? '',
  ];
  for (const agent of agents) {
    if (destinationRelatesToAgent(row.destination ?? '', agent)) {
      fields.push(...agentFieldValues(agent));
    }
  }
  return fields;
}

export function rowMatchesRemoteSearch(
  row: RemoteDailyLedgerRow,
  searchQuery: string,
  agents: LedgerAgentSearchHint[] = [],
): boolean {
  if (!normalizeLedgerSearchText(searchQuery)) return true;
  if (matchesLedgerSearch(searchQuery, ledgerRemoteSearchFields(row, agents))) return true;
  for (const agent of agents) {
    if (!agentMatchesSearchQuery(agent, searchQuery)) continue;
    if (destinationRelatesToAgent(row.destination ?? '', agent)) return true;
  }
  return false;
}

export function rowMatchesLocalSearch(
  row: LedgerLocalSearchRow,
  searchQuery: string,
  agents: LedgerAgentSearchHint[] = [],
): boolean {
  if (!normalizeLedgerSearchText(searchQuery)) return true;
  return matchesLedgerSearch(searchQuery, ledgerLocalSearchFields(row, agents));
}

export function filterRemoteRowsBySearch(
  rows: RemoteDailyLedgerRow[],
  searchQuery: string,
  agents: LedgerAgentSearchHint[] = [],
): RemoteDailyLedgerRow[] {
  if (!normalizeLedgerSearchText(searchQuery)) return rows;
  return rows.filter((row) => rowMatchesRemoteSearch(row, searchQuery, agents));
}

export function filterLocalRowsBySearch<T extends LedgerLocalSearchRow>(
  rows: T[],
  searchQuery: string,
  agents: LedgerAgentSearchHint[] = [],
): T[] {
  if (!normalizeLedgerSearchText(searchQuery)) return rows;
  return rows.filter((row) => rowMatchesLocalSearch(row, searchQuery, agents));
}

export function remoteRowMatchesDriver(
  remote: RemoteDailyLedgerRow,
  filters: LedgerDriverMatchFilters,
): boolean {
  if (!filters.driverBackendId && !filters.driverName && !filters.vehicleIdsForDriver?.size) return true;

  const targetDriverId = normalizeLedgerUuid(filters.driverBackendId);
  const rowDriverId = normalizeLedgerUuid(remote.driver_id);
  if (targetDriverId && rowDriverId && rowDriverId === targetDriverId) return true;

  const rowVehicleId = normalizeLedgerUuid(remote.vehicle_id);
  if (rowVehicleId && filters.vehicleIdsForDriver?.has(rowVehicleId)) return true;

  if (filters.driverName) {
    const driverLabel = normalizeLedgerSearchText(remote.driver_label ?? '');
    if (driverLabel) {
      const driverName = normalizeLedgerSearchText(filters.driverName);
      if (driverLabel === driverName || driverLabel.includes(driverName) || driverName.includes(driverLabel)) {
        return true;
      }
    }
  }

  if (
    filters.assignOrphanRowsToSelectedDriver &&
    targetDriverId &&
    !rowDriverId &&
    !normalizeLedgerSearchText(remote.driver_label ?? '') &&
    !rowVehicleId
  ) {
    return true;
  }

  return false;
}

export function filterRemoteRowsByPrintScope(
  rows: RemoteDailyLedgerRow[],
  scope: LedgerPrintScope,
  options: {
    driverBackendId?: string;
    driverName?: string;
    vehicleIdsForDriver?: ReadonlySet<string>;
    assignOrphanRowsToSelectedDriver?: boolean;
    destinationFilter?: string;
    activeSessionId?: string | null;
  },
): RemoteDailyLedgerRow[] {
  if (scope === 'driver') {
    return rows.filter((row) =>
      remoteRowMatchesDriver(row, {
        driverBackendId: options.driverBackendId,
        driverName: options.driverName,
        vehicleIdsForDriver: options.vehicleIdsForDriver,
        assignOrphanRowsToSelectedDriver: options.assignOrphanRowsToSelectedDriver,
      }),
    );
  }
  if (scope === 'agent') {
    const destinationFilter = normalizeLedgerSearchText(options.destinationFilter ?? '');
    if (!destinationFilter) return [];
    return rows.filter((row) =>
      normalizeLedgerSearchText(row.destination ?? '').includes(destinationFilter),
    );
  }
  if (scope === 'session') {
    if (!options.activeSessionId) return [];
    return rows.filter((row) => row.session_id === options.activeSessionId);
  }
  return rows;
}

/** ترتيب زمني تباعاً — بدون تجميع حسب السائق */
export function sortRemoteRowsChronological(rows: RemoteDailyLedgerRow[]): RemoteDailyLedgerRow[] {
  return [...rows].sort(compareDailyLedgerRowsChronological);
}

/** مسار موحّد: نطاق الطباعة → البحث النشط → ترتيب تباعاً */
export function prepareLedgerOutputRows(
  rows: RemoteDailyLedgerRow[],
  options: PrepareLedgerOutputOptions,
): RemoteDailyLedgerRow[] {
  const printable = filterPrintableDailyLedgerRows(rows);
  const scoped = filterRemoteRowsByPrintScope(printable, options.printScope, {
    driverBackendId: options.driverBackendId,
    driverName: options.driverName,
    vehicleIdsForDriver: options.vehicleIdsForDriver,
    assignOrphanRowsToSelectedDriver: options.assignOrphanRowsToSelectedDriver,
    destinationFilter: options.destinationFilter,
    activeSessionId: options.activeSessionId,
  });
  const searched = filterRemoteRowsBySearch(scoped, options.searchQuery ?? '', options.agents ?? []);
  return sortRemoteRowsChronological(searched);
}

/** وجهات فريدة من مجموعة أسطر — للتصدير PDF */
export function uniqueDestinationsFromRows(rows: RemoteDailyLedgerRow[]): string[] {
  return [...new Set(rows.map((row) => String(row.destination ?? '').trim()).filter(Boolean))].sort((a, b) =>
    a.localeCompare(b, 'ar'),
  );
}

function normalizeLedgerYmd(value: string | null | undefined): string {
  const raw = String(value ?? '').trim();
  if (!raw) return '';
  return raw.split('T')[0] ?? raw;
}

/** تاريخ/فترة التوثيق من أسطر الدفتر المطبوعة — لا من تاريخ اليوم أو نافذة الطباعة */
export function resolveDocumentationLedgerDates(
  rows: RemoteDailyLedgerRow[],
  fallback: { dateFrom: string; dateTo: string; screenDate?: string },
): { ledgerDate: string; ledgerDateTo: string | null } {
  const rowDates = [...new Set(rows.map((row) => normalizeLedgerYmd(row.ledger_date)).filter(Boolean))].sort();
  if (rowDates.length) {
    const min = rowDates[0];
    const max = rowDates[rowDates.length - 1];
    return {
      ledgerDate: min,
      ledgerDateTo: min !== max ? max : null,
    };
  }

  const dateFrom = normalizeLedgerYmd(fallback.dateFrom) || normalizeLedgerYmd(fallback.screenDate);
  const dateTo = normalizeLedgerYmd(fallback.dateTo) || dateFrom;
  if (!dateFrom) {
    return { ledgerDate: normalizeLedgerYmd(fallback.screenDate) || new Date().toISOString().split('T')[0], ledgerDateTo: null };
  }
  return {
    ledgerDate: dateFrom,
    ledgerDateTo: dateFrom !== dateTo ? dateTo : null,
  };
}
