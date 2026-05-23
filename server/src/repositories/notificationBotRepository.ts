import { pool } from '../db/pool.js';

export interface NotificationBot {
  id: string;
  company_id: string;
  name: string;
  bot_token: string;
  is_active: boolean;
  is_default: boolean;
  notes: string | null;
  last_test_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface CreateNotificationBotInput {
  company_id: string;
  name: string;
  bot_token: string;
  is_active?: boolean;
  is_default?: boolean;
  notes?: string | null;
}

export class NotificationBotRepository {
  async list(companyId: string): Promise<NotificationBot[]> {
    const result = await pool.query<NotificationBot>(
      `select * from telegram_notification_bots
       where company_id = $1
       order by is_default desc, created_at asc`,
      [companyId],
    );
    return result.rows;
  }

  async getById(id: string, companyId: string): Promise<NotificationBot | null> {
    const result = await pool.query<NotificationBot>(
      `select * from telegram_notification_bots where id = $1 and company_id = $2`,
      [id, companyId],
    );
    return result.rows[0] ?? null;
  }

  async getDefault(companyId: string): Promise<NotificationBot | null> {
    const result = await pool.query<NotificationBot>(
      `select * from telegram_notification_bots
       where company_id = $1 and is_default = true and is_active = true
       limit 1`,
      [companyId],
    );
    return result.rows[0] ?? null;
  }

  async getFirstActive(companyId: string): Promise<NotificationBot | null> {
    const result = await pool.query<NotificationBot>(
      `select * from telegram_notification_bots
       where company_id = $1 and is_active = true
       order by is_default desc, created_at asc
       limit 1`,
      [companyId],
    );
    return result.rows[0] ?? null;
  }

  async create(input: CreateNotificationBotInput): Promise<NotificationBot> {
    const client = await pool.connect();
    try {
      await client.query('begin');

      // إذا كان is_default = true، نسحب الافتراضية من الباقي أولاً
      if (input.is_default) {
        await client.query(
          `update telegram_notification_bots set is_default = false where company_id = $1`,
          [input.company_id],
        );
      }

      const result = await client.query<NotificationBot>(
        `insert into telegram_notification_bots
           (company_id, name, bot_token, is_active, is_default, notes)
         values ($1, $2, $3, $4, $5, $6)
         returning *`,
        [
          input.company_id,
          input.name.trim(),
          input.bot_token.trim(),
          input.is_active ?? true,
          input.is_default ?? false,
          input.notes ?? null,
        ],
      );

      await client.query('commit');
      return result.rows[0];
    } catch (e) {
      await client.query('rollback');
      throw e;
    } finally {
      client.release();
    }
  }

  async update(
    id: string,
    companyId: string,
    input: Partial<Omit<CreateNotificationBotInput, 'company_id'>>,
  ): Promise<NotificationBot | null> {
    const client = await pool.connect();
    try {
      await client.query('begin');

      if (input.is_default) {
        await client.query(
          `update telegram_notification_bots set is_default = false
           where company_id = $1 and id <> $2`,
          [companyId, id],
        );
      }

      const fields: string[] = [];
      const values: unknown[] = [];
      let idx = 1;

      if (input.name     !== undefined) { fields.push(`name = $${idx++}`);       values.push(input.name.trim()); }
      if (input.bot_token !== undefined) { fields.push(`bot_token = $${idx++}`);  values.push(input.bot_token.trim()); }
      if (input.is_active !== undefined) { fields.push(`is_active = $${idx++}`);  values.push(input.is_active); }
      if (input.is_default !== undefined){ fields.push(`is_default = $${idx++}`); values.push(input.is_default); }
      if (input.notes    !== undefined) { fields.push(`notes = $${idx++}`);       values.push(input.notes ?? null); }

      if (fields.length === 0) {
        await client.query('rollback');
        return this.getById(id, companyId);
      }

      fields.push(`updated_at = now()`);
      values.push(id, companyId);

      const result = await client.query<NotificationBot>(
        `update telegram_notification_bots
         set ${fields.join(', ')}
         where id = $${idx++} and company_id = $${idx}
         returning *`,
        values,
      );

      await client.query('commit');
      return result.rows[0] ?? null;
    } catch (e) {
      await client.query('rollback');
      throw e;
    } finally {
      client.release();
    }
  }

  async delete(id: string, companyId: string): Promise<boolean> {
    const result = await pool.query(
      `delete from telegram_notification_bots where id = $1 and company_id = $2`,
      [id, companyId],
    );
    return (result.rowCount ?? 0) > 0;
  }

  async updateTestAt(id: string): Promise<void> {
    await pool.query(
      `update telegram_notification_bots set last_test_at = now(), updated_at = now() where id = $1`,
      [id],
    );
  }

  /** كم عدد البوتات المفعّلة لهذه الشركة */
  async countActive(companyId: string): Promise<number> {
    const r = await pool.query<{ n: string }>(
      `select count(*)::text as n from telegram_notification_bots where company_id = $1 and is_active = true`,
      [companyId],
    );
    return parseInt(r.rows[0]?.n ?? '0', 10);
  }
}
