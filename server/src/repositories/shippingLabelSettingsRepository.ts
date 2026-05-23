import { pool } from '../db/pool.js';

export interface ShippingLabelSettingsRow {
  id: string;
  company_id: string;
  config: Record<string, unknown>;
  updated_by: string | null;
  created_at: string;
  updated_at: string;
}

export class ShippingLabelSettingsRepository {
  async getByCompany(companyId: string): Promise<ShippingLabelSettingsRow | null> {
    const result = await pool.query<ShippingLabelSettingsRow>(
      `
      select id, company_id, config, updated_by, created_at::text, updated_at::text
      from shipping_label_settings
      where company_id = $1
      limit 1
      `,
      [companyId]
    );
    return result.rows[0] ?? null;
  }

  async upsert(companyId: string, config: Record<string, unknown>, updatedBy: string | null): Promise<ShippingLabelSettingsRow> {
    const result = await pool.query<ShippingLabelSettingsRow>(
      `
      insert into shipping_label_settings(company_id, config, updated_by)
      values($1, $2::jsonb, $3)
      on conflict (company_id) do update
      set config = excluded.config, updated_by = excluded.updated_by, updated_at = now()
      returning id, company_id, config, updated_by, created_at::text, updated_at::text
      `,
      [companyId, JSON.stringify(config), updatedBy]
    );
    return result.rows[0];
  }
}
