/**
 * Pure next-account-code suggestion formula (Chart of Accounts hierarchy —
 * Section 4.4 of the redesign task). Separated from
 * FinanceRepository.suggestNextAccountCode so the formula itself can be
 * selftested without a database connection.
 */
export function computeNextAccountCode(parentCode: number, childCodes: number[], existingCodes: Set<string>): string {
  const step = parentCode % 1000 === 0 ? 100 : parentCode % 100 === 0 ? 10 : 1;
  let next = childCodes.length === 0 ? parentCode + step : Math.max(...childCodes) + step;
  while (existingCodes.has(String(next))) {
    next += step;
  }
  return String(next);
}
