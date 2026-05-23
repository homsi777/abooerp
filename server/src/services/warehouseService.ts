import type { WarehouseRepository, WarehouseInput } from '../repositories/warehouseRepository.js';
import { HttpError } from '../utils/errors.js';
import type { DataScope } from '../utils/scope.js';

export class WarehouseService {
  constructor(private readonly repository: WarehouseRepository) {}

  list(scope?: DataScope) {
    return this.repository.list(scope);
  }

  async getById(id: string, scope?: DataScope) {
    const warehouse = await this.repository.getById(id, scope);
    if (!warehouse) throw new HttpError(404, 'Warehouse not found.');
    return warehouse;
  }

  async create(input: WarehouseInput, scope?: DataScope) {
    const payload: WarehouseInput = {
      ...input,
      companyId: input.companyId ?? scope?.companyId!,
    };
    try {
      return await this.repository.create(payload);
    } catch (err: any) {
      if (err?.code === '23505') {
        throw new HttpError(409, `Warehouse code '${input.code}' already exists in this company.`);
      }
      throw err;
    }
  }

  async update(id: string, input: Partial<WarehouseInput>, scope?: DataScope) {
    const updated = await this.repository.update(id, input, scope);
    if (!updated) throw new HttpError(404, 'Warehouse not found.');
    return updated;
  }

  async remove(id: string, scope?: DataScope) {
    const deleted = await this.repository.remove(id, scope);
    if (!deleted) throw new HttpError(404, 'Warehouse not found.');
    return { deleted: true };
  }
}
