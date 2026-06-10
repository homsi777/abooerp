import { getBackendIdFromSynthetic } from '../api/syntheticEntityId';
import type { DailyLedgerQueryScope } from './dailyLedgerTypes';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/** يحوّل معرّف الفرع (UUID أو رقم اصطناعي) إلى UUID الخادم */
export function resolveLedgerBranchId(branchId: string): string {
  const trimmed = String(branchId ?? '').trim();
  if (!trimmed) return trimmed;
  if (UUID_RE.test(trimmed)) return trimmed;
  const synthetic = Number(trimmed);
  if (Number.isFinite(synthetic)) {
    return getBackendIdFromSynthetic(synthetic) ?? trimmed;
  }
  return trimmed;
}

export function dailyLedgerScopeKey(scope: { branchId: string; ledgerDate: string; lineLabel: string }): string {
  return `${scope.branchId}|${scope.ledgerDate}|${scope.lineLabel}`;
}

/** بناء معاملات API موحّدة للشاشة والطباعة والتصدير */
export function buildDailyLedgerQueryParams(scope: DailyLedgerQueryScope): URLSearchParams {
  const params = new URLSearchParams();
  if (scope.allBranches) {
    params.set('allBranches', 'true');
  } else if (scope.branchId) {
    params.set('branchId', resolveLedgerBranchId(scope.branchId));
  }
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
  overrides: Partial<Pick<DailyLedgerQueryScope, 'dateFrom' | 'dateTo' | 'allLines' | 'allBranches'>> = {},
): DailyLedgerQueryScope {
  return {
    branchId,
    ledgerDate,
    lineLabel,
    includeLoaded,
    ...overrides,
  };
}

export type LedgerRowsFetchOptions = {
  managerViewAllBranches?: boolean;
  allLines?: boolean;
  dateFrom?: string;
  dateTo?: string;
};

/** نطاق جلب موحّد للشاشة والطباعة وتصدير PDF */
export function buildLedgerRowsQueryScope(
  branchId: string,
  ledgerDate: string,
  lineLabel: string,
  includeLoaded: boolean,
  options: LedgerRowsFetchOptions = {},
): DailyLedgerQueryScope {
  const allBranches = Boolean(options.managerViewAllBranches);
  const allLines = options.allLines ?? allBranches;
  return scopeFromTrip(branchId, ledgerDate, lineLabel, includeLoaded, {
    allLines,
    ...(allBranches ? { allBranches: true } : {}),
    ...(options.dateFrom && options.dateTo
      ? { dateFrom: options.dateFrom, dateTo: options.dateTo }
      : {}),
  });
}
