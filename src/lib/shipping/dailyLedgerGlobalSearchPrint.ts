import { printLedgerStyleDocument } from '../export/ledgerStylePrint';
import {
  ledgerGlobalSearchCriteriaLabel,
  type LedgerGlobalSearchInput,
} from './dailyLedgerGlobalSearchGateway';
import type { RemoteDailyLedgerRow } from './dailyLedgerTypes';
import {
  buildQuickLedgerPrintHtml,
  remoteRowToPrint,
} from './quickLedgerShipmentPrint';

export function buildGlobalSearchResultsPrintHtml(options: {
  rows: RemoteDailyLedgerRow[];
  criteria: LedgerGlobalSearchInput;
  scopeLabel: string;
}): string {
  const printRows = options.rows.map(remoteRowToPrint);
  return buildQuickLedgerPrintHtml(printRows, {
    title: 'نتائج البحث الشامل — دفتر الشحن',
    destinationLabel: ledgerGlobalSearchCriteriaLabel(options.criteria),
    driverName: options.scopeLabel,
    entryColumnsOnly: true,
  });
}

export async function printGlobalSearchResults(options: {
  rows: RemoteDailyLedgerRow[];
  criteria: LedgerGlobalSearchInput;
  scopeLabel: string;
  branchNameById: Map<string, string>;
}): Promise<'queued' | 'browser' | 'error'> {
  const html = buildGlobalSearchResultsPrintHtml({
    rows: options.rows,
    criteria: options.criteria,
    scopeLabel: options.scopeLabel,
  });
  return printLedgerStyleDocument(html, 'quick_ledger_global_search');
}
