import { pool } from '../db/pool.js';
export class DeliveryRepository {
    async list(scope) {
        const values = [];
        const conditions = [];
        if (scope?.branchId) {
            values.push(scope.branchId);
            conditions.push(`branch_id = $${values.length}`);
        }
        if (scope?.agentId) {
            values.push(scope.agentId);
            conditions.push(`agent_id = $${values.length}`);
        }
        const whereClause = conditions.length ? `where ${conditions.join(' and ')}` : '';
        const result = await pool.query(`select * from deliveries ${whereClause} order by created_at desc`, values);
        return result.rows;
    }
    async getById(id, scope) {
        const values = [id];
        const conditions = ['id = $1'];
        if (scope?.branchId) {
            values.push(scope.branchId);
            conditions.push(`branch_id = $${values.length}`);
        }
        if (scope?.agentId) {
            values.push(scope.agentId);
            conditions.push(`agent_id = $${values.length}`);
        }
        const result = await pool.query(`select * from deliveries where ${conditions.join(' and ')}`, values);
        return result.rows[0] ?? null;
    }
    async create(input) {
        const client = await pool.connect();
        try {
            await client.query('begin');
            const result = await client.query(`
        insert into deliveries(
          delivery_no, shipment_id, branch_id, agent_id, operator_user_id, status, recipient_name,
          received_at, notes, original_amount, original_currency, exchange_rate_to_usd, base_amount_usd
        )
        values($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)
        returning *
        `, [
                input.deliveryNo,
                input.shipmentId,
                input.branchId ?? null,
                input.agentId ?? null,
                input.operatorUserId ?? null,
                input.status,
                input.recipientName ?? null,
                input.receivedAt ?? null,
                input.notes ?? null,
                input.originalAmount,
                input.originalCurrency,
                input.exchangeRateToUsd,
                input.baseAmountUsd,
            ]);
            if (input.status === 'delivered') {
                await client.query("update shipments set status = 'delivered', updated_at = now() where id = $1", [input.shipmentId]);
            }
            await client.query('commit');
            return result.rows[0];
        }
        catch (error) {
            await client.query('rollback');
            throw error;
        }
        finally {
            client.release();
        }
    }
    async update(id, input) {
        const client = await pool.connect();
        try {
            await client.query('begin');
            const result = await client.query(`
        update deliveries
        set
          branch_id = coalesce($2, branch_id),
          agent_id = coalesce($3, agent_id),
          operator_user_id = coalesce($4, operator_user_id),
          status = coalesce($5, status),
          recipient_name = coalesce($6, recipient_name),
          received_at = coalesce($7, received_at),
          notes = coalesce($8, notes),
          original_amount = coalesce($9, original_amount),
          original_currency = coalesce($10, original_currency),
          exchange_rate_to_usd = coalesce($11, exchange_rate_to_usd),
          base_amount_usd = coalesce($12, base_amount_usd),
          updated_at = now()
        where id = $1
        returning *
        `, [
                id,
                input.branchId ?? null,
                input.agentId ?? null,
                input.operatorUserId ?? null,
                input.status ?? null,
                input.recipientName ?? null,
                input.receivedAt ?? null,
                input.notes ?? null,
                input.originalAmount ?? null,
                input.originalCurrency ?? null,
                input.exchangeRateToUsd ?? null,
                input.baseAmountUsd ?? null,
            ]);
            const updated = result.rows[0] ?? null;
            if (!updated) {
                await client.query('rollback');
                return null;
            }
            if (updated.status === 'delivered') {
                await client.query("update shipments set status = 'delivered', updated_at = now() where id = $1", [updated.shipment_id]);
            }
            if (updated.status === 'returned') {
                await client.query("update shipments set status = 'cancelled', updated_at = now() where id = $1 and status <> 'delivered'", [
                    updated.shipment_id,
                ]);
            }
            await client.query('commit');
            return updated;
        }
        catch (error) {
            await client.query('rollback');
            throw error;
        }
        finally {
            client.release();
        }
    }
    async remove(id) {
        const result = await pool.query('delete from deliveries where id = $1 returning id', [id]);
        return Boolean(result.rowCount);
    }
}
