import type { DailyLedgerQueryScope } from './dailyLedgerTypes';

export function dailyLedgerScopeKey(scope: { branchId: string; ledgerDate: string; lineLabel: string }): string {
  return `${scope.branchId}|${scope.ledgerDate}|${scope.lineLabel}`;
}

/** بناء معاملات API موحّدة للشاشة والطباعة والتصدير */
export function buildDailyLedgerQueryParams(scope: DailyLedgerQueryScope): URLSearchParams {
  const params = new URLSearchParams();
  params.set('branchId', scope.branchId);
  params.set('includeLoaded', scope.includeLoaded ? 'true' : 'false');

  const useRange = Boolean(scope.dateFrom && scope.dateTo);
  if (useRange) {
    params.set('dateFrom', scope.dateFrom!);
    params.set('dateTo', scope.dateTo!);
  } else if (scope.ledgerDate) {
    params.set('ledgerDate', scope.ledgerDate);
  }

  if (!scope.allLines && scope.lineLabel) {
    params.set('lineLabel', scope.lineLabel);
  }

  return params;
}

export function scopeFromTrip(
  branchId: string,
  ledgerDate: string,
  lineLabel: string,
  includeLoaded: boolean,
  overrides: Partial<Pick<DailyLedgerQueryScope, 'dateFrom' | 'dateTo' | 'allLines'>> = {},
): DailyLedgerQueryScope {
  return {
    branchId,
    ledgerDate,
    lineLabel,
    includeLoaded,
    ...overrides,
  };
}
