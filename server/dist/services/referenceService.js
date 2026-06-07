export class ReferenceService {
    repository;
    constructor(repository) {
        this.repository = repository;
    }
    list() {
        return this.repository.list();
    }
    listScoped(scope, companyId) {
        return this.repository.listScoped(scope, companyId);
    }
    getById(id) {
        return this.repository.getById(id);
    }
    getByIdScoped(id, scope, companyId) {
        return this.repository.getByIdScoped(id, scope, companyId);
    }
    create(payload) {
        return this.repository.create(payload);
    }
    update(id, payload) {
        return this.repository.update(id, payload);
    }
    remove(id) {
        return this.repository.remove(id);
    }
}
