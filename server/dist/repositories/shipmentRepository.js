import { pool } from '../db/pool.js';
export class ShipmentRepository {
    async list(scope) {
        const conditions = [];
        const values = [];
        if (scope?.branchId) {
            values.push(scope.branchId);
            conditions.push(`branch_id = $${values.length}`);
        }
        if (scope?.agentId) {
            values.push(scope.agentId);
            conditions.push(`agent_id = $${values.length}`);
        }
        const whereClause = conditions.length ? `where ${conditions.join(' and ')}` : '';
        const result = await pool.query(`select * from shipments ${whereClause} order by created_at desc`, values);
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
        const result = await pool.query(`select * from shipments where ${conditions.join(' and ')}`, values);
        return result.rows[0] ?? null;
    }
    async create(input) {
        const result = await pool.query(`
      insert into shipments(
        shipment_no, reference_no, customer_id, sender_id, receiver_id, branch_id, agent_id,
        origin_city, destination_city, description, pieces_count, weight_kg, status,
        original_amount, original_currency, exchange_rate_to_usd, base_amount_usd, created_by
      )
      values(
        $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18
      )
      returning *
      `, [
            input.shipmentNo,
            input.referenceNo ?? null,
            input.customerId ?? null,
            input.senderId,
            input.receiverId,
            input.branchId,
            input.agentId ?? null,
            input.originCity ?? null,
            input.destinationCity,
            input.description ?? null,
            input.piecesCount,
            input.weightKg ?? null,
            input.status,
            input.originalAmount,
            input.originalCurrency,
            input.exchangeRateToUsd,
            input.baseAmountUsd,
            input.createdBy ?? null,
        ]);
        await pool.query(`insert into shipment_status_history(shipment_id, status, note, changed_by) values($1, $2, $3, $4)`, [result.rows[0].id, input.status, 'Shipment created', input.createdBy ?? null]);
        return result.rows[0];
    }
    async update(id, payload) {
        const client = await pool.connect();
        try {
            await client.query('begin');
            const previous = await client.query('select status from shipments where id = $1', [id]);
            if (!previous.rowCount) {
                await client.query('rollback');
                return null;
            }
            const previousStatus = previous.rows[0].status;
            const expectsUpdatedAt = Boolean(payload.expectedUpdatedAt);
            const result = await client.query(`
        update shipments
        set
          reference_no = coalesce($2, reference_no),
          customer_id = coalesce($3, customer_id),
          sender_id = coalesce($4, sender_id),
          receiver_id = coalesce($5, receiver_id),
          branch_id = coalesce($6, branch_id),
          agent_id = coalesce($7, agent_id),
          origin_city = coalesce($8, origin_city),
          destination_city = coalesce($9, destination_city),
          description = coalesce($10, description),
          pieces_count = coalesce($11, pieces_count),
          weight_kg = coalesce($12, weight_kg),
          status = coalesce($13, status),
          original_amount = coalesce($14, original_amount),
          original_currency = coalesce($15, original_currency),
          exchange_rate_to_usd = coalesce($16, exchange_rate_to_usd),
          base_amount_usd = coalesce($17, base_amount_usd),
          updated_by = coalesce($18, updated_by),
          updated_at = now()
        where id = $1
          and (
            $19::boolean = false
            or date_trunc('milliseconds', updated_at) = date_trunc('milliseconds', $20::timestamptz)
          )
        returning *
        `, [
                id,
                payload.referenceNo ?? null,
                payload.customerId ?? null,
                payload.senderId ?? null,
                payload.receiverId ?? null,
                payload.branchId ?? null,
                payload.agentId ?? null,
                payload.originCity ?? null,
                payload.destinationCity ?? null,
                payload.description ?? null,
                payload.piecesCount ?? null,
                payload.weightKg ?? null,
                payload.status ?? null,
                payload.originalAmount ?? null,
                payload.originalCurrency ?? null,
                payload.exchangeRateToUsd ?? null,
                payload.baseAmountUsd ?? null,
                payload.createdBy ?? null,
                expectsUpdatedAt,
                payload.expectedUpdatedAt ?? null,
            ]);
            const updated = result.rows[0] ?? null;
            if (!updated) {
                await client.query('rollback');
                return null;
            }
            const nextStatus = updated.status;
            if (previousStatus !== nextStatus) {
                await client.query(`
          insert into shipment_status_history(shipment_id, status, note, changed_by)
          values($1, $2, $3, $4)
          `, [id, nextStatus, `Status changed from ${previousStatus} to ${nextStatus}`, payload.createdBy ?? null]);
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
        const result = await pool.query('delete from shipments where id = $1 returning id', [id]);
        return Boolean(result.rowCount);
    }
}
