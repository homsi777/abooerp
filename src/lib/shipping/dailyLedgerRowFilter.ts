import { filterPrintableDailyLedgerRows } from './dailyLedgerPrintable';
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

export type PrepareLedgerOutputOptions = {
  printScope: LedgerPrintScope;
  searchQuery?: string;
  agents?: LedgerAgentSearchHint[];
  activeSessionId?: string | null;
  destinationFilter?: string;
  driverBackendId?: string;
  driverName?: string;
};

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
  filters: { driverBackendId?: string; driverName?: string },
): boolean {
  if (filters.driverBackendId && remote.driver_id === filters.driverBackendId) return true;
  const driverLabel = normalizeLedgerSearchText(remote.driver_label ?? '');
  if (!driverLabel) return false;
  if (!filters.driverName) return false;
  const driverName = normalizeLedgerSearchText(filters.driverName);
  return driverLabel === driverName || driverLabel.includes(driverName) || driverName.includes(driverLabel);
}

export function filterRemoteRowsByPrintScope(
  rows: RemoteDailyLedgerRow[],
  scope: LedgerPrintScope,
  options: {
    driverBackendId?: string;
    driverName?: string;
    destinationFilter?: string;
    activeSessionId?: string | null;
  },
): RemoteDailyLedgerRow[] {
  if (scope === 'driver') {
    return rows.filter((row) =>
      remoteRowMatchesDriver(row, { driverBackendId: options.driverBackendId, driverName: options.driverName }),
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
  return [...rows].sort((a, b) => {
    const dateCmp = String(a.ledger_date ?? '').localeCompare(String(b.ledger_date ?? ''));
    if (dateCmp !== 0) return dateCmp;
    const createdCmp = String(a.created_at ?? '').localeCompare(String(b.created_at ?? ''));
    if (createdCmp !== 0) return createdCmp;
    const sessionCmp = String(a.session_id ?? '').localeCompare(String(b.session_id ?? ''));
    if (sessionCmp !== 0) return sessionCmp;
    return a.row_no - b.row_no;
  });
}

/** مسار موحّد: نطاق الطباعة → البحث النشط → ترتيب تباعاً */
export function prepareLedgerOutputRows(
  rows: RemoteDailyLedgerRow[],
  options: PrepareLedgerOutputOptions,
): RemoteDailyLedgerRow[] {
  const printable = filterPrintableDailyLedgerRows(rows);
  const hasActiveSearch = Boolean(normalizeLedgerSearchText(options.searchQuery ?? ''));
  const scoped = hasActiveSearch
    ? printable
    : filterRemoteRowsByPrintScope(printable, options.printScope, {
        driverBackendId: options.driverBackendId,
        driverName: options.driverName,
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
