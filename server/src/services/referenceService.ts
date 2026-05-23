import type { ReferenceRepository } from '../repositories/referenceRepository.js';
import type { DataScope } from '../utils/scope.js';

export class ReferenceService {
  constructor(private readonly repository: ReferenceRepository) {}

  list() {
    return this.repository.list();
  }

  listScoped(scope?: DataScope, companyId?: string) {
    return this.repository.listScoped(scope, companyId);
  }

  getById(id: string) {
    return this.repository.getById(id);
  }

  getByIdScoped(id: string, scope?: DataScope, companyId?: string) {
    return this.repository.getByIdScoped(id, scope, companyId);
  }

  create(payload: Record<string, unknown>) {
    return this.repository.create(payload);
  }

  update(id: string, payload: Record<string, unknown>) {
    return this.repository.update(id, payload);
  }

  remove(id: string) {
    return this.repository.remove(id);
  }
}
