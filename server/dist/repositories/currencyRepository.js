import { pool } from '../db/pool.js';
export class CurrencyRepository {
    async listCurrencies(companyId) {
        const result = await pool.query(`
      select id, code, name, symbol, is_base, is_active, company_id, created_at::text, updated_at::text
      from currencies
      where company_id = $1
      order by is_base desc, code asc
      `, [companyId]);
        return result.rows;
    }
    async getCurrencyByCode(code, companyId) {
        const result = await pool.query(`
      select id, code, name, symbol, is_base, is_active, company_id, created_at::text, updated_at::text
      from currencies
      where company_id = $1 and code = $2
      limit 1
      `, [companyId, code.toUpperCase()]);
        return result.rows[0] ?? null;
    }
    async getCurrencyById(id, companyId) {
        const result = await pool.query(`
      select id, code, name, symbol, is_base, is_active, company_id, created_at::text, updated_at::text
      from currencies
      where company_id = $1 and id = $2
      limit 1
      `, [companyId, id]);
        return result.rows[0] ?? null;
    }
    async createCurrency(companyId, data) {
        const result = await pool.query(`
      insert into currencies(code, name, symbol, is_base, is_active, company_id)
      values (upper($1), $2, $3, false, coalesce($4, true), $5)
      returning id, code, name, symbol, is_base, is_active, company_id, created_at::text, updated_at::text
      `, [data.code, data.name, data.symbol ?? null, data.is_active ?? true, companyId]);
        return result.rows[0];
    }
    async updateCurrency(id, companyId, data) {
        const result = await pool.query(`
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
      `, [id, companyId, data.code ?? null, data.name ?? null, typeof data.symbol === 'undefined' ? null : data.symbol ?? '__NULL__', data.is_active]);
        return result.rows[0] ?? null;
    }
    async deactivateCurrency(id, companyId) {
        const result = await pool.query(`
      update currencies
      set is_active = false, updated_at = now()
      where id = $1
        and company_id = $2
        and is_base = false
        and is_active = true
      `, [id, companyId]);
        return (result.rowCount ?? 0) > 0;
    }
    async setBaseCurrency(id, companyId) {
        const client = await pool.connect();
        try {
            await client.query('begin');
            const target = await client.query(`
        select id, code, name, symbol, is_base, is_active, company_id, created_at::text, updated_at::text
        from currencies
        where id = $1
          and company_id = $2
        limit 1
        `, [id, companyId]);
            if (!target.rowCount) {
                await client.query('rollback');
                return null;
            }
            await client.query(`
        update currencies
        set is_base = false, updated_at = now()
        where company_id = $1
        `, [companyId]);
            const updated = await client.query(`
        update currencies
        set is_base = true, is_active = true, updated_at = now()
        where id = $1
          and company_id = $2
        returning id, code, name, symbol, is_base, is_active, company_id, created_at::text, updated_at::text
        `, [id, companyId]);
            await client.query('commit');
            return updated.rows[0] ?? null;
        }
        catch (error) {
            await client.query('rollback');
            throw error;
        }
        finally {
            client.release();
        }
    }
}
