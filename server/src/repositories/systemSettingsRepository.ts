import { pool } from '../db/pool.js';

export interface SystemSettingRecord {
  id: string;
  companyId: string;
  key: string;
  value: unknown;
  isEncrypted: boolean;
  createdAt: string;
  updatedAt: string;
}

export class SystemSettingsRepository {
  async getSetting(companyId: string, key: string): Promise<SystemSettingRecord | null> {
    const result = await pool.query(
      `
      select
        id,
        company_id as "companyId",
        key,
        value,
        is_encrypted as "isEncrypted",
        created_at as "createdAt",
        updated_at as "updatedAt"
      from system_settings
      where company_id = $1 and key = $2
      limit 1
      `,
      [companyId, key]
    );
    return result.rows[0] ?? null;
  }

  async setSetting(companyId: string, key: string, value: unknown, isEncrypted = false): Promise<SystemSettingRecord> {
    const result = await pool.query(
      `
      insert into system_settings(company_id, key, value, is_encrypted)
      values ($1, $2, $3::jsonb, $4)
      on conflict (company_id, key) do update
      set
        value = excluded.value,
        is_encrypted = excluded.is_encrypted,
        updated_at = now()
      returning
        id,
        company_id as "companyId",
        key,
        value,
        is_encrypted as "isEncrypted",
        created_at as "createdAt",
        updated_at as "updatedAt"
      `,
      [companyId, key, JSON.stringify(value), isEncrypted]
    );
    return result.rows[0] as SystemSettingRecord;
  }

  async deleteSetting(companyId: string, key: string): Promise<boolean> {
    const result = await pool.query(
      `
      delete from system_settings
      where company_id = $1 and key = $2
      `,
      [companyId, key]
    );
    return (result.rowCount ?? 0) > 0;
  }

  async listSettings(companyId: string): Promise<SystemSettingRecord[]> {
    const result = await pool.query(
      `
      select
        id,
        company_id as "companyId",
        key,
        value,
        is_encrypted as "isEncrypted",
        created_at as "createdAt",
        updated_at as "updatedAt"
      from system_settings
      where company_id = $1
      order by key asc
      `,
      [companyId]
    );
    return result.rows as SystemSettingRecord[];
  }
}
