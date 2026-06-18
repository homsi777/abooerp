import { pool } from '../db/pool.js';
export class BilateralReconciliationRepository {
    async getLastApproved(companyId, agentId, currencyCode = 'USD') {
        const result = await pool.query(`
      select
        id,
        period_from::text as period_from,
        period_to::text as period_to,
        currency_code,
        status,
        previous_balance,
        current_balance,
        notes,
        agent_notes,
        approved_at::text as approved_at,
        created_at::text as created_at
      from bilateral_reconciliations
      where company_id = $1
        and agent_id = $2
        and currency_code = $3
        and status = 'approved'
      order by period_to desc, approved_at desc nulls last, created_at desc
      limit 1
      `, [companyId, agentId, currencyCode]);
        return result.rows[0] ?? null;
    }
    async listByAgent(companyId, agentId, limit = 20) {
        const result = await pool.query(`
      select
        br.id,
        br.agent_id,
        a.name as agent_name,
        br.period_from::text as period_from,
        br.period_to::text as period_to,
        br.currency_code,
        br.status,
        br.previous_balance,
        br.current_balance,
        br.notes,
        br.agent_notes,
        br.approved_at::text as approved_at,
        br.created_at::text as created_at,
        u.full_name as approved_by_name
      from bilateral_reconciliations br
      join agents a on a.id = br.agent_id
      left join users u on u.id = br.approved_by_user_id
      where br.company_id = $1
        and br.agent_id = $2
      order by br.period_to desc, br.created_at desc
      limit $3
      `, [companyId, agentId, limit]);
        return result.rows;
    }
    async getById(companyId, id) {
        const header = await pool.query(`
      select
        br.id,
        br.agent_id,
        a.name as agent_name,
        a.code as agent_code,
        br.period_from::text as period_from,
        br.period_to::text as period_to,
        br.currency_code,
        br.status,
        br.previous_balance,
        br.current_balance,
        br.notes,
        br.agent_notes,
        br.approved_at::text as approved_at,
        br.created_at::text as created_at,
        br.updated_at::text as updated_at,
        cu.full_name as created_by_name,
        au.full_name as approved_by_name
      from bilateral_reconciliations br
      join agents a on a.id = br.agent_id
      left join users cu on cu.id = br.created_by_user_id
      left join users au on au.id = br.approved_by_user_id
      where br.company_id = $1
        and br.id = $2
      `, [companyId, id]);
        const row = header.rows[0];
        if (!row)
            return null;
        const items = await pool.query(`
      select
        id,
        item_type,
        description,
        company_amount,
        agent_amount,
        difference,
        status,
        notes,
        sort_order
      from bilateral_reconciliation_items
      where reconciliation_id = $1
      order by sort_order asc
      `, [id]);
        return { ...row, items: items.rows };
    }
    async create(companyId, input) {
        const client = await pool.connect();
        try {
            await client.query('begin');
            const header = await client.query(`
        insert into bilateral_reconciliations(
          company_id,
          agent_id,
          period_from,
          period_to,
          currency_code,
          status,
          previous_balance,
          current_balance,
          notes,
          agent_notes,
          approved_at,
          approved_by_user_id,
          created_by_user_id
        )
        values ($1, $2, $3::timestamptz, $4::timestamptz, $5, $6, $7, $8, $9, $10, $11::timestamptz, $12, $13)
        returning id
        `, [
                companyId,
                input.agentId,
                input.periodFrom,
                input.periodTo,
                input.currencyCode,
                input.status,
                input.previousBalance,
                input.currentBalance,
                input.notes?.trim() || null,
                input.agentNotes?.trim() || null,
                input.approvedAt ?? null,
                input.approvedByUserId ?? null,
                input.createdByUserId ?? null,
            ]);
            const reconciliationId = header.rows[0].id;
            for (const item of input.items) {
                await client.query(`
          insert into bilateral_reconciliation_items(
            reconciliation_id,
            item_type,
            description,
            company_amount,
            agent_amount,
            difference,
            status,
            notes,
            sort_order
          )
          values ($1, $2, $3, $4, $5, $6, $7, $8, $9)
          `, [
                    reconciliationId,
                    item.itemType,
                    item.description,
                    item.companyAmount,
                    item.agentAmount,
                    item.difference,
                    item.status,
                    item.notes?.trim() || null,
                    item.sortOrder,
                ]);
            }
            await client.query('commit');
            return this.getById(companyId, reconciliationId);
        }
        catch (error) {
            await client.query('rollback');
            throw error;
        }
        finally {
            client.release();
        }
    }
    async update(companyId, id, input) {
        const client = await pool.connect();
        try {
            await client.query('begin');
            const updated = await client.query(`
        update bilateral_reconciliations
        set
          period_from = $3::timestamptz,
          period_to = $4::timestamptz,
          currency_code = $5,
          status = $6,
          previous_balance = $7,
          current_balance = $8,
          notes = $9,
          agent_notes = $10,
          approved_at = $11::timestamptz,
          approved_by_user_id = $12,
          updated_at = now()
        where company_id = $1
          and id = $2
        returning id
        `, [
                companyId,
                id,
                input.periodFrom,
                input.periodTo,
                input.currencyCode,
                input.status,
                input.previousBalance,
                input.currentBalance,
                input.notes?.trim() || null,
                input.agentNotes?.trim() || null,
                input.approvedAt ?? null,
                input.approvedByUserId ?? null,
            ]);
            if (!updated.rows[0]) {
                await client.query('rollback');
                return null;
            }
            await client.query('delete from bilateral_reconciliation_items where reconciliation_id = $1', [id]);
            for (const item of input.items) {
                await client.query(`
          insert into bilateral_reconciliation_items(
            reconciliation_id,
            item_type,
            description,
            company_amount,
            agent_amount,
            difference,
            status,
            notes,
            sort_order
          )
          values ($1, $2, $3, $4, $5, $6, $7, $8, $9)
          `, [
                    id,
                    item.itemType,
                    item.description,
                    item.companyAmount,
                    item.agentAmount,
                    item.difference,
                    item.status,
                    item.notes?.trim() || null,
                    item.sortOrder,
                ]);
            }
            await client.query('commit');
            return this.getById(companyId, id);
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
