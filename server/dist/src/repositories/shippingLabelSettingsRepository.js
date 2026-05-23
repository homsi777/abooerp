import { pool } from '../db/pool.js';
export class ShippingLabelSettingsRepository {
    async getByCompany(companyId) {
        const result = await pool.query(`
      select id, company_id, config, updated_by, created_at::text, updated_at::text
      from shipping_label_settings
      where company_id = $1
      limit 1
      `, [companyId]);
        return result.rows[0] ?? null;
    }
    async upsert(companyId, config, updatedBy) {
        const result = await pool.query(`
      insert into shipping_label_settings(company_id, config, updated_by)
      values($1, $2::jsonb, $3)
      on conflict (company_id) do update
      set config = excluded.config, updated_by = excluded.updated_by, updated_at = now()
      returning id, company_id, config, updated_by, created_at::text, updated_at::text
      `, [companyId, JSON.stringify(config), updatedBy]);
        return result.rows[0];
    }
}
