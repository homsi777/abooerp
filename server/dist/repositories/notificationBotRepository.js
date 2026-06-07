import { pool } from '../db/pool.js';
export class NotificationBotRepository {
    async list(companyId) {
        const result = await pool.query(`select * from telegram_notification_bots
       where company_id = $1
       order by is_default desc, created_at asc`, [companyId]);
        return result.rows;
    }
    async getById(id, companyId) {
        const result = await pool.query(`select * from telegram_notification_bots where id = $1 and company_id = $2`, [id, companyId]);
        return result.rows[0] ?? null;
    }
    async getDefault(companyId) {
        const result = await pool.query(`select * from telegram_notification_bots
       where company_id = $1 and is_default = true and is_active = true
       limit 1`, [companyId]);
        return result.rows[0] ?? null;
    }
    async getFirstActive(companyId) {
        const result = await pool.query(`select * from telegram_notification_bots
       where company_id = $1 and is_active = true
       order by is_default desc, created_at asc
       limit 1`, [companyId]);
        return result.rows[0] ?? null;
    }
    async create(input) {
        const client = await pool.connect();
        try {
            await client.query('begin');
            // إذا كان is_default = true، نسحب الافتراضية من الباقي أولاً
            if (input.is_default) {
                await client.query(`update telegram_notification_bots set is_default = false where company_id = $1`, [input.company_id]);
            }
            const result = await client.query(`insert into telegram_notification_bots
           (company_id, name, bot_token, is_active, is_default, notes)
         values ($1, $2, $3, $4, $5, $6)
         returning *`, [
                input.company_id,
                input.name.trim(),
                input.bot_token.trim(),
                input.is_active ?? true,
                input.is_default ?? false,
                input.notes ?? null,
            ]);
            await client.query('commit');
            return result.rows[0];
        }
        catch (e) {
            await client.query('rollback');
            throw e;
        }
        finally {
            client.release();
        }
    }
    async update(id, companyId, input) {
        const client = await pool.connect();
        try {
            await client.query('begin');
            if (input.is_default) {
                await client.query(`update telegram_notification_bots set is_default = false
           where company_id = $1 and id <> $2`, [companyId, id]);
            }
            const fields = [];
            const values = [];
            let idx = 1;
            if (input.name !== undefined) {
                fields.push(`name = $${idx++}`);
                values.push(input.name.trim());
            }
            if (input.bot_token !== undefined) {
                fields.push(`bot_token = $${idx++}`);
                values.push(input.bot_token.trim());
            }
            if (input.is_active !== undefined) {
                fields.push(`is_active = $${idx++}`);
                values.push(input.is_active);
            }
            if (input.is_default !== undefined) {
                fields.push(`is_default = $${idx++}`);
                values.push(input.is_default);
            }
            if (input.notes !== undefined) {
                fields.push(`notes = $${idx++}`);
                values.push(input.notes ?? null);
            }
            if (fields.length === 0) {
                await client.query('rollback');
                return this.getById(id, companyId);
            }
            fields.push(`updated_at = now()`);
            values.push(id, companyId);
            const result = await client.query(`update telegram_notification_bots
         set ${fields.join(', ')}
         where id = $${idx++} and company_id = $${idx}
         returning *`, values);
            await client.query('commit');
            return result.rows[0] ?? null;
        }
        catch (e) {
            await client.query('rollback');
            throw e;
        }
        finally {
            client.release();
        }
    }
    async delete(id, companyId) {
        const result = await pool.query(`delete from telegram_notification_bots where id = $1 and company_id = $2`, [id, companyId]);
        return (result.rowCount ?? 0) > 0;
    }
    async updateTestAt(id) {
        await pool.query(`update telegram_notification_bots set last_test_at = now(), updated_at = now() where id = $1`, [id]);
    }
    /** كم عدد البوتات المفعّلة لهذه الشركة */
    async countActive(companyId) {
        const r = await pool.query(`select count(*)::text as n from telegram_notification_bots where company_id = $1 and is_active = true`, [companyId]);
        return parseInt(r.rows[0]?.n ?? '0', 10);
    }
}
