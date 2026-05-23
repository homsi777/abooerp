import type { ItemRepository, ItemInput } from '../repositories/itemRepository.js';
import { HttpError } from '../utils/errors.js';
import type { DataScope } from '../utils/scope.js';

const ALLOWED_UNITS = ['piece', 'kg', 'g', 'liter', 'ml', 'meter', 'cm', 'box', 'pallet', 'set', 'other'];

export class ItemService {
  constructor(private readonly repository: ItemRepository) {}

  list(scope?: DataScope) {
    return this.repository.list(scope);
  }

  async getById(id: string, scope?: DataScope) {
    const item = await this.repository.getById(id, scope);
    if (!item) throw new HttpError(404, 'Item not found.');
    return item;
  }

  async create(input: ItemInput, scope?: DataScope) {
    const unit = input.unit ?? 'piece';
    if (!ALLOWED_UNITS.includes(unit)) {
      throw new HttpError(400, `Invalid unit '${unit}'. Allowed: ${ALLOWED_UNITS.join(', ')}.`);
    }
    const payload: ItemInput = {
      ...input,
      unit,
      companyId: input.companyId ?? scope?.companyId!,
    };
    try {
      return await this.repository.create(payload);
    } catch (err: any) {
      if (err?.code === '23505') {
        throw new HttpError(409, `Item code '${input.code}' already exists in this company.`);
      }
      throw err;
    }
  }

  async update(id: string, input: Partial<ItemInput>, scope?: DataScope) {
    if (input.unit && !ALLOWED_UNITS.includes(input.unit)) {
      throw new HttpError(400, `Invalid unit '${input.unit}'. Allowed: ${ALLOWED_UNITS.join(', ')}.`);
    }
    const updated = await this.repository.update(id, input, scope);
    if (!updated) throw new HttpError(404, 'Item not found.');
    return updated;
  }

  async remove(id: string, scope?: DataScope) {
    const deleted = await this.repository.remove(id, scope);
    if (!deleted) throw new HttpError(404, 'Item not found.');
    return { deleted: true };
  }
}
