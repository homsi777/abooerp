import type { DataScope } from '../utils/scope.js';
import type { DailyLedgerRowListFilters, DailyLedgerUpsertInput } from '../repositories/dailyLedgerRepository.js';
import { DailyLedgerRepository } from '../repositories/dailyLedgerRepository.js';

export class DailyLedgerService {
  constructor(private repo: DailyLedgerRepository) {}

  listRows(scope: DataScope, filters: DailyLedgerRowListFilters) {
    return this.repo.listRows(scope, filters);
  }

  upsertRow(scope: DataScope, input: DailyLedgerUpsertInput) {
    return this.repo.upsertRow(scope, input);
  }

  markPosted(
    scope: DataScope,
    input: { rowId: string; shipmentId: string; expectedUpdatedAt?: string },
    allowedBranchIds: string[],
  ) {
    return this.repo.markPosted(scope, { ...input, userId: scope.userId }, allowedBranchIds);
  }

  markLoadedByShipmentIds(input: { manifestId: string; shipmentIds: string[] }) {
    return this.repo.markLoadedByShipmentIds(input);
  }
}
