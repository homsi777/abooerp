import { pool } from '../db/pool.js';
export class ReferenceRepository {
    config;
    constructor(config) {
        this.config = config;
    }
    async list() {
        const result = await pool.query(`select * from ${this.config.table} order by created_at desc`);
        return result.rows;
    }
    async getById(id) {
        const result = await pool.query(`select * from ${this.config.table} where id = $1`, [id]);
        return result.rows[0] ?? null;
    }
    async create(payload) {
        const fields = this.config.createFields;
        const placeholders = fields.map((_, index) => `$${index + 1}`);
        const values = fields.map((field) => payload[field]);
        const result = await pool.query(`insert into ${this.config.table} (${fields.join(', ')}) values (${placeholders.join(', ')}) returning *`, values);
        return result.rows[0];
    }
    async update(id, payload) {
        const fields = this.config.updateFields.filter((field) => field in payload);
        if (!fields.length) {
            return this.getById(id);
        }
        const assignments = fields.map((field, index) => `${field} = $${index + 2}`);
        const values = fields.map((field) => payload[field]);
        const result = await pool.query(`update ${this.config.table}
       set ${assignments.join(', ')}, updated_at = now()
       where id = $1
       returning *`, [id, ...values]);
        return result.rows[0] ?? null;
    }
    async remove(id) {
        const result = await pool.query(`delete from ${this.config.table} where id = $1 returning id`, [id]);
        return Boolean(result.rowCount);
    }
}
