import { pool } from '../db/pool.js';

export interface TerminologyRow {
  id: string;
  company_id: string;
  terms: Record<string, string>;
  updated_by: string | null;
  created_at: string;
  updated_at: string;
}

export class TerminologyRepository {
  async getByCompany(companyId: string): Promise<TerminologyRow | null> {
    const result = await pool.query<TerminologyRow>(
      `
      select id, company_id, terms, updated_by, created_at::text, updated_at::text
      from terminology_settings
      where company_id = $1
      limit 1
      `,
      [companyId]
    );
    return result.rows[0] ?? null;
  }

  async upsert(companyId: string, terms: Record<string, string>, updatedBy: string | null): Promise<TerminologyRow> {
    const result = await pool.query<TerminologyRow>(
      `
      insert into terminology_settings(company_id, terms, updated_by)
      values($1, $2::jsonb, $3)
      on conflict (company_id) do update
      set terms = excluded.terms, updated_by = excluded.updated_by, updated_at = now()
      returning id, company_id, terms, updated_by, created_at::text, updated_at::text
      `,
      [companyId, JSON.stringify(terms), updatedBy]
    );
    return result.rows[0];
  }
}
