import { HttpError } from '../utils/errors.js';
export class WarehouseService {
    repository;
    constructor(repository) {
        this.repository = repository;
    }
    list(scope) {
        return this.repository.list(scope);
    }
    async getById(id, scope) {
        const warehouse = await this.repository.getById(id, scope);
        if (!warehouse)
            throw new HttpError(404, 'Warehouse not found.');
        return warehouse;
    }
    async create(input, scope) {
        const payload = {
            ...input,
            companyId: input.companyId ?? scope?.companyId,
        };
        try {
            return await this.repository.create(payload);
        }
        catch (err) {
            if (err?.code === '23505') {
                throw new HttpError(409, `Warehouse code '${input.code}' already exists in this company.`);
            }
            throw err;
        }
    }
    async update(id, input, scope) {
        const updated = await this.repository.update(id, input, scope);
        if (!updated)
            throw new HttpError(404, 'Warehouse not found.');
        return updated;
    }
    async remove(id, scope) {
        const deleted = await this.repository.remove(id, scope);
        if (!deleted)
            throw new HttpError(404, 'Warehouse not found.');
        return { deleted: true };
    }
}
