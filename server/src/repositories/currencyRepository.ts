import { pool } from '../db/pool.js';

export interface CurrencyRecord {
  id: string;
  code: string;
  name: string;
  symbol: string | null;
  is_base: boolean;
  is_active: boolean;
  company_id: string;
  created_at: string;
  updated_at: string;
}

export interface CreateCurrencyInput {
  code: string;
  name: string;
  symbol?: string;
  is_active?: boolean;
}

export interface UpdateCurrencyInput {
  code?: string;
  name?: string;
  symbol?: string | null;
  is_active?: boolean;
}

export class CurrencyRepository {
  async listCurrencies(companyId: string): Promise<CurrencyRecord[]> {
    const result = await pool.query<CurrencyRecord>(
      `
      select id, code, name, symbol, is_base, is_active, company_id, created_at::text, updated_at::text
      from currencies
      where company_id = $1
      order by is_base desc, code asc
      `,
      [companyId],
    );
    return result.rows;
  }

  async getCurrencyByCode(code: string, companyId: string): Promise<CurrencyRecord | null> {
    const result = await pool.query<CurrencyRecord>(
      `
      select id, code, name, symbol, is_base, is_active, company_id, created_at::text, updated_at::text
      from currencies
      where company_id = $1 and code = $2
      limit 1
      `,
      [companyId, code.toUpperCase()],
    );
    return result.rows[0] ?? null;
  }

  async getCurrencyById(id: string, companyId: string): Promise<CurrencyRecord | null> {
    const result = await pool.query<CurrencyRecord>(
      `
      select id, code, name, symbol, is_base, is_active, company_id, created_at::text, updated_at::text
      from currencies
      where company_id = $1 and id = $2
      limit 1
      `,
      [companyId, id],
    );
    return result.rows[0] ?? null;
  }

  async createCurrency(companyId: string, data: CreateCurrencyInput): Promise<CurrencyRecord> {
    const result = await pool.query<CurrencyRecord>(
      `
      insert into currencies(code, name, symbol, is_base, is_active, company_id)
      values (upper($1), $2, $3, false, coalesce($4, true), $5)
      returning id, code, name, symbol, is_base, is_active, company_id, created_at::text, updated_at::text
      `,
      [data.code, data.name, data.symbol ?? null, data.is_active ?? true, companyId],
    );
    return result.rows[0];
  }

  async updateCurrency(id: string, companyId: string, data: UpdateCurrencyInput): Promise<CurrencyRecord | null> {
    const result = await pool.query<CurrencyRecord>(
      `
      update currencies
      set
        code = coalesce(upper($3), code),
        name = coalesce($4, name),
        symbol = case when $5::text = '__NULL__' then null else coalesce($5, symbol) end,
        is_active = coalesce($6, is_active),
        updated_at = now()
      where id = $1
        and company_id = $2
      returning id, code, name, symbol, is_base, is_active, company_id, created_at::text, updated_at::text
      `,
      [id, companyId, data.code ?? null, data.name ?? null, typeof data.symbol === 'undefined' ? null : data.symbol ?? '__NULL__', data.is_active],
    );
    return result.rows[0] ?? null;
  }

  async deactivateCurrency(id: string, companyId: string): Promise<boolean> {
    const result = await pool.query(
      `
      update currencies
      set is_active = false, updated_at = now()
      where id = $1
        and company_id = $2
        and is_base = false
        and is_active = true
      `,
      [id, companyId],
    );
    return (result.rowCount ?? 0) > 0;
  }

  async setBaseCurrency(id: string, companyId: string): Promise<CurrencyRecord | null> {
    const client = await pool.connect();
    try {
      await client.query('begin');
      const target = await client.query<CurrencyRecord>(
        `
        select id, code, name, symbol, is_base, is_active, company_id, created_at::text, updated_at::text
        from currencies
        where id = $1
          and company_id = $2
        limit 1
        `,
        [id, companyId],
      );
      if (!target.rowCount) {
        await client.query('rollback');
        return null;
      }

      await client.query(
        `
        update currencies
        set is_base = false, updated_at = now()
        where company_id = $1
        `,
        [companyId],
      );

      const updated = await client.query<CurrencyRecord>(
        `
        update currencies
        set is_base = true, is_active = true, updated_at = now()
        where id = $1
          and company_id = $2
        returning id, code, name, symbol, is_base, is_active, company_id, created_at::text, updated_at::text
        `,
        [id, companyId],
      );

      await client.query('commit');
      return updated.rows[0] ?? null;
    } catch (error) {
      await client.query('rollback');
      throw error;
    } finally {
      client.release();
    }
  }
}
