import { pool } from '../db/pool.js';

export interface CompanyRecord {
  id: string;
  code: string;
  name: string;
  is_active: boolean;
  phone: string | null;
  address: string | null;
  logo_data_url: string | null;
  created_at: string;
  updated_at: string;
}

export class CompanyRepository {
  async getById(id: string): Promise<CompanyRecord | null> {
    const result = await pool.query<CompanyRecord>(`select * from companies where id = $1 limit 1`, [id]);
    return result.rows[0] ?? null;
  }

  async update(
    id: string,
    payload: Partial<Pick<CompanyRecord, 'name' | 'phone' | 'address' | 'logo_data_url'>>,
  ): Promise<CompanyRecord | null> {
    const existing = await this.getById(id);
    if (!existing) return null;
    const name = payload.name !== undefined ? payload.name : existing.name;
    const phone = payload.phone !== undefined ? payload.phone : existing.phone;
    const address = payload.address !== undefined ? payload.address : existing.address;
    const logo_data_url = payload.logo_data_url !== undefined ? payload.logo_data_url : existing.logo_data_url;
    const result = await pool.query<CompanyRecord>(
      `
      update companies
      set name = $2, phone = $3, address = $4, logo_data_url = $5, updated_at = now()
      where id = $1
      returning *
      `,
      [id, name, phone, address, logo_data_url],
    );
    return result.rows[0] ?? null;
  }
}
