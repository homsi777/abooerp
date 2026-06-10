import { httpClient } from '../api/httpClient';
import { buildDailyLedgerQueryParams } from './dailyLedgerQueryParams';
import {
  dedupeDailyLedgerRowsById,
  filterPrintableDailyLedgerRows,
  sortDailyLedgerRows,
} from './dailyLedgerPrintable';
import type { DailyLedgerQueryScope, RemoteDailyLedgerRow } from './dailyLedgerTypes';

export { buildDailyLedgerQueryParams, dailyLedgerScopeKey, scopeFromTrip } from './dailyLedgerQueryParams';

export const DAILY_LEDGER_FETCH_PAGE_SIZE = 500;

export type FetchDailyLedgerOptions = {
  /** فلترة الأسطر الفارغة بعد الجلب — الافتراضي true */
  printableOnly?: boolean;
};

export async function fetchDailyLedgerRowsPage(
  scope: DailyLedgerQueryScope,
  offset: number,
  limit = DAILY_LEDGER_FETCH_PAGE_SIZE,
  options: FetchDailyLedgerOptions = {},
): Promise<RemoteDailyLedgerRow[]> {
  const params = buildDailyLedgerQueryParams(scope);
  params.set('limit', String(limit));
  params.set('offset', String(offset));
  const url = `/daily-ledger/rows?${params.toString()}`;
  const batch = await httpClient.get<RemoteDailyLedgerRow[]>(url);
  if (options.printableOnly === false) return batch;
  return filterPrintableDailyLedgerRows(batch);
}

export async function fetchAllDailyLedgerRows(
  scope: DailyLedgerQueryScope,
  options: FetchDailyLedgerOptions = {},
): Promise<RemoteDailyLedgerRow[]> {
  const printableOnly = options.printableOnly !== false;
  const all: RemoteDailyLedgerRow[] = [];
  let offset = 0;

  while (offset <= 50000) {
    const batch = await fetchDailyLedgerRowsPage(scope, offset, DAILY_LEDGER_FETCH_PAGE_SIZE, {
      ...options,
      printableOnly: false,
    });
    if (!batch.length) break;
    all.push(...batch);
    if (batch.length < DAILY_LEDGER_FETCH_PAGE_SIZE) break;
    offset += DAILY_LEDGER_FETCH_PAGE_SIZE;
  }

  const deduped = dedupeDailyLedgerRowsById(all);
  return printableOnly ? filterPrintableDailyLedgerRows(deduped) : sortDailyLedgerRows(deduped);
}
