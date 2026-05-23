import { pool } from '../db/pool.js';
import { withDbRetry } from '../utils/transaction.js';
export class ExchangeRateRepository {
    async getLatestRate(currencyId, companyId) {
        const result = await pool.query(`
      select
        er.id,
        er.currency_id,
        c.code as currency_code,
        c.name as currency_name,
        er.company_id,
        er.rate,
        er.effective_date::text,
        er.created_at::text
      from exchange_rates er
      join currencies c on c.id = er.currency_id
      where er.currency_id = $1
        and er.company_id = $2
      order by er.effective_date desc, er.created_at desc
      limit 1
      `, [currencyId, companyId]);
        return result.rows[0] ?? null;
    }
    async getLatestRateByCode(currencyCode, companyId) {
        const result = await pool.query(`
      select
        er.id,
        er.currency_id,
        c.code as currency_code,
        c.name as currency_name,
        er.company_id,
        er.rate,
        er.effective_date::text,
        er.created_at::text
      from exchange_rates er
      join currencies c on c.id = er.currency_id
      where c.code = upper($1)
        and c.company_id = $2
        and er.company_id = $2
      order by er.effective_date desc, er.created_at desc
      limit 1
      `, [currencyCode, companyId]);
        return result.rows[0] ?? null;
    }
    async getRateByDateByCode(currencyCode, date, companyId) {
        const result = await pool.query(`
      select
        er.id,
        er.currency_id,
        c.code as currency_code,
        c.name as currency_name,
        er.company_id,
        er.rate,
        er.effective_date::text,
        er.created_at::text
      from exchange_rates er
      join currencies c on c.id = er.currency_id
      where c.code = upper($1)
        and c.company_id = $2
        and er.company_id = $2
        and er.effective_date <= $3::date
      order by er.effective_date desc, er.created_at desc
      limit 1
      `, [currencyCode, companyId, date]);
        return result.rows[0] ?? null;
    }
    async getRateByDate(currencyId, date, companyId) {
        const result = await pool.query(`
      select
        er.id,
        er.currency_id,
        c.code as currency_code,
        c.name as currency_name,
        er.company_id,
        er.rate,
        er.effective_date::text,
        er.created_at::text
      from exchange_rates er
      join currencies c on c.id = er.currency_id
      where er.currency_id = $1
        and er.company_id = $2
        and er.effective_date <= $3::date
      order by er.effective_date desc, er.created_at desc
      limit 1
      `, [currencyId, companyId, date]);
        return result.rows[0] ?? null;
    }
    async setExchangeRate(currencyId, rate, effectiveDate, companyId) {
        return withDbRetry(async () => {
            const result = await pool.query(`
        insert into exchange_rates(currency_id, company_id, rate, effective_date)
        values ($1, $2, $3, $4::date)
        on conflict (currency_id, effective_date, company_id)
        do update set
          rate = excluded.rate,
          updated_at = now()
        returning id, currency_id, company_id, rate, effective_date::text, created_at::text
        `, [currencyId, companyId, rate, effectiveDate]);
            const withCurrency = await pool.query(`
        select
          er.id,
          er.currency_id,
          c.code as currency_code,
          c.name as currency_name,
          er.company_id,
          er.rate,
          er.effective_date::text,
          er.created_at::text
        from exchange_rates er
        join currencies c on c.id = er.currency_id
        where er.id = $1
        `, [result.rows[0].id]);
            return withCurrency.rows[0];
        });
    }
    async listExchangeRates(companyId, currencyId) {
        const result = await pool.query(`
      select
        er.id,
        er.currency_id,
        c.code as currency_code,
        c.name as currency_name,
        er.company_id,
        er.rate,
        er.effective_date::text,
        er.created_at::text
      from exchange_rates er
      join currencies c on c.id = er.currency_id
      where er.company_id = $1
        and ($2::uuid is null or er.currency_id = $2::uuid)
      order by er.effective_date desc, c.code asc
      `, [companyId, currencyId ?? null]);
        return result.rows;
    }
}
