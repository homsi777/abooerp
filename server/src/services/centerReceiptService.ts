import type { CenterReceiptCreateInput, CenterReceiptRepository } from '../repositories/centerReceiptRepository.js';
import { HttpError } from '../utils/errors.js';
import type { DataScope } from '../utils/scope.js';

export class CenterReceiptService {
  constructor(private readonly repository: CenterReceiptRepository) {}

  list(scope?: DataScope) {
    return this.repository.list(scope);
  }

  async create(input: CenterReceiptCreateInput, scope?: DataScope) {
    if (scope?.branchId && input.branchId && input.branchId !== scope.branchId) {
      throw new HttpError(403, 'Cannot receive shipment outside scoped branch.');
    }
    if (scope?.agentId && input.agentId && input.agentId !== scope.agentId) {
      throw new HttpError(403, 'Cannot receive shipment outside scoped agent.');
    }

    return this.repository.create({
      ...input,
      companyId: input.companyId ?? scope?.companyId,
    });
  }
}
