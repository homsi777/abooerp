import { HttpError } from '../utils/errors.js';
const ALLOWED_UNITS = ['piece', 'kg', 'g', 'liter', 'ml', 'meter', 'cm', 'box', 'pallet', 'set', 'other'];
export class ItemService {
    repository;
    constructor(repository) {
        this.repository = repository;
    }
    list(scope) {
        return this.repository.list(scope);
    }
    async getById(id, scope) {
        const item = await this.repository.getById(id, scope);
        if (!item)
            throw new HttpError(404, 'Item not found.');
        return item;
    }
    async create(input, scope) {
        const unit = input.unit ?? 'piece';
        if (!ALLOWED_UNITS.includes(unit)) {
            throw new HttpError(400, `Invalid unit '${unit}'. Allowed: ${ALLOWED_UNITS.join(', ')}.`);
        }
        const payload = {
            ...input,
            unit,
            companyId: input.companyId ?? scope?.companyId,
        };
        try {
            return await this.repository.create(payload);
        }
        catch (err) {
            if (err?.code === '23505') {
                throw new HttpError(409, `Item code '${input.code}' already exists in this company.`);
            }
            throw err;
        }
    }
    async update(id, input, scope) {
        if (input.unit && !ALLOWED_UNITS.includes(input.unit)) {
            throw new HttpError(400, `Invalid unit '${input.unit}'. Allowed: ${ALLOWED_UNITS.join(', ')}.`);
        }
        const updated = await this.repository.update(id, input, scope);
        if (!updated)
            throw new HttpError(404, 'Item not found.');
        return updated;
    }
    async remove(id, scope) {
        const deleted = await this.repository.remove(id, scope);
        if (!deleted)
            throw new HttpError(404, 'Item not found.');
        return { deleted: true };
    }
}
