import { pool } from '../db/pool.js';
// ── Repository ────────────────────────────────────────────────────────────────
export class TelegramSettingsRepository {
    // ── Activation settings ─────────────────────────────────────────────────────
    async getActivationSettings(companyId) {
        const result = await pool.query(`select * from telegram_activation_settings where company_id = $1 limit 1`, [companyId]);
        return result.rows[0] ?? null;
    }
    async upsertActivationSettings(companyId, data) {
        const result = await pool.query(`
      insert into telegram_activation_settings
        (company_id, bot_token, chat_id, bot_username, is_enabled)
      values ($1, $2, $3, $4, $5)
      on conflict (company_id) do update set
        bot_token    = excluded.bot_token,
        chat_id      = excluded.chat_id,
        bot_username = excluded.bot_username,
        is_enabled   = excluded.is_enabled,
        updated_at   = now()
      returning *
      `, [
            companyId,
            data.botToken,
            data.chatId,
            data.botUsername ?? null,
            data.isEnabled ?? true,
        ]);
        return result.rows[0];
    }
    // ── Agent bots ──────────────────────────────────────────────────────────────
    async listAgentBots(companyId) {
        const result = await pool.query(`
      select atb.*, a.name as agent_name
      from agent_telegram_bots atb
      left join agents a on a.id = atb.agent_id
      where atb.company_id = $1
      order by atb.created_at desc
      `, [companyId]);
        return result.rows;
    }
    async getAgentBotById(companyId, id) {
        const result = await pool.query(`select atb.*, a.name as agent_name
       from agent_telegram_bots atb
       left join agents a on a.id = atb.agent_id
       where atb.id = $1 and atb.company_id = $2`, [id, companyId]);
        return result.rows[0] ?? null;
    }
    async createAgentBot(companyId, data) {
        const result = await pool.query(`
      insert into agent_telegram_bots
        (company_id, agent_id, bot_token, chat_id, bot_username, is_enabled, notes)
      values ($1, $2, $3, $4, $5, $6, $7)
      returning *
      `, [
            companyId,
            data.agentId,
            data.botToken,
            data.chatId,
            data.botUsername ?? null,
            data.isEnabled ?? true,
            data.notes ?? null,
        ]);
        return result.rows[0];
    }
    async updateAgentBot(companyId, id, data) {
        const fields = [];
        const values = [id, companyId];
        let i = 3;
        if (data.botToken !== undefined) {
            fields.push(`bot_token = $${i++}`);
            values.push(data.botToken);
        }
        if (data.chatId !== undefined) {
            fields.push(`chat_id = $${i++}`);
            values.push(data.chatId);
        }
        if (data.botUsername !== undefined) {
            fields.push(`bot_username = $${i++}`);
            values.push(data.botUsername);
        }
        if (data.isEnabled !== undefined) {
            fields.push(`is_enabled = $${i++}`);
            values.push(data.isEnabled);
        }
        if (data.notes !== undefined) {
            fields.push(`notes = $${i++}`);
            values.push(data.notes);
        }
        if (data.agentId !== undefined) {
            fields.push(`agent_id = $${i++}`);
            values.push(data.agentId);
        }
        if (!fields.length)
            return this.getAgentBotById(companyId, id);
        fields.push(`updated_at = now()`);
        const result = await pool.query(`update agent_telegram_bots set ${fields.join(', ')}
       where id = $1 and company_id = $2 returning *`, values);
        return result.rows[0] ?? null;
    }
    async disableAgentBot(companyId, id) {
        const result = await pool.query(`update agent_telegram_bots set is_enabled = false, updated_at = now()
       where id = $1 and company_id = $2 returning *`, [id, companyId]);
        return result.rows[0] ?? null;
    }
    async deleteAgentBot(companyId, id) {
        const result = await pool.query(`delete from agent_telegram_bots where id = $1 and company_id = $2`, [id, companyId]);
        return (result.rowCount ?? 0) > 0;
    }
    async getEnabledAgentBots(companyId, agentId) {
        const result = await pool.query(`select * from agent_telegram_bots
       where company_id = $1 and agent_id = $2 and is_enabled = true`, [companyId, agentId]);
        return result.rows;
    }
    async markAgentBotTested(companyId, id) {
        await pool.query(`update agent_telegram_bots set last_test_at = now() where id = $1 and company_id = $2`, [id, companyId]);
    }
    // ── Diagnostics ─────────────────────────────────────────────────────────────
    async getDiagnostics(companyId) {
        const [activationResult, botsResult] = await Promise.all([
            pool.query(`select count(*) as cnt from telegram_activation_settings where company_id = $1`, [companyId]),
            pool.query(`select count(*) as total,
                count(*) filter (where is_enabled) as enabled
         from agent_telegram_bots where company_id = $1`, [companyId]),
        ]);
        return {
            activationConfigured: parseInt(activationResult.rows[0]?.cnt ?? '0') > 0,
            agentBotsCount: parseInt(botsResult.rows[0]?.total ?? '0'),
            enabledAgentBotsCount: parseInt(botsResult.rows[0]?.enabled ?? '0'),
        };
    }
}
