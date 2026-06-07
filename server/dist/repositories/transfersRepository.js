export class TransfersRepository {
    pool;
    constructor(pool) {
        this.pool = pool;
    }
    async getById(id, company_id, client) {
        const db = client || this.pool;
        const { rows } = await db.query(`select * from transfers where id = $1 and company_id = $2`, [id, company_id]);
        return rows[0] ?? null;
    }
    async lockById(id, company_id, client) {
        const { rows } = await client.query(`select * from transfers where id = $1 and company_id = $2 for update`, [id, company_id]);
        return rows[0] ?? null;
    }
    async create(payload, client) {
        const db = client || this.pool;
        const query = `
      INSERT INTO transfers (
        company_id, branch_id, agent_id, origin_agent_id, destination_agent_id, destination_city, shipment_id,
        sender_name, receiver_name, amount, currency, main_amount,
        commission, commission_currency, commission_main,
        agent_commission, agent_commission_currency, agent_commission_main,
        transfer_service_fee, transfer_service_fee_currency, transfer_service_fee_main,
        company_transfer_profit, company_transfer_profit_currency, company_transfer_profit_main,
        status, notes, transfer_date,
        collection_cashbox_id, collection_receipt_voucher_id,
        payout_cashbox_id, payout_payment_voucher_id
      ) VALUES (
        $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12,
        $13, $14, $15,
        $16, $17, $18,
        $19, $20, $21,
        $22, $23, $24,
        $25, $26, COALESCE($27, NOW()),
        $28, $29, $30, $31
      ) RETURNING *;
    `;
        const agentCommission = Number(payload.agent_commission ?? payload.commission ?? 0);
        const agentCommissionCurrency = payload.agent_commission_currency ?? payload.commission_currency ?? payload.currency ?? 'USD';
        const agentCommissionMain = Number(payload.agent_commission_main ?? payload.commission_main ?? 0);
        const transferServiceFee = Number(payload.transfer_service_fee ?? 0);
        const transferServiceFeeCurrency = payload.transfer_service_fee_currency ?? payload.currency ?? 'USD';
        const transferServiceFeeMain = Number(payload.transfer_service_fee_main ?? 0);
        const companyTransferProfit = Number(payload.company_transfer_profit ?? transferServiceFee);
        const companyTransferProfitCurrency = payload.company_transfer_profit_currency ?? transferServiceFeeCurrency;
        const companyTransferProfitMain = Number(payload.company_transfer_profit_main ?? transferServiceFeeMain);
        const values = [
            payload.company_id, payload.branch_id || null, payload.agent_id || payload.destination_agent_id || null,
            payload.origin_agent_id || null, payload.destination_agent_id || payload.agent_id || null, payload.destination_city || null,
            payload.shipment_id || null,
            payload.sender_name, payload.receiver_name, payload.amount, payload.currency, payload.main_amount,
            // Legacy ambiguous columns are now mirrored from explicit agent commission fields.
            agentCommission, agentCommissionCurrency, agentCommissionMain,
            agentCommission, agentCommissionCurrency, agentCommissionMain,
            transferServiceFee, transferServiceFeeCurrency, transferServiceFeeMain,
            companyTransferProfit, companyTransferProfitCurrency, companyTransferProfitMain,
            payload.status || 'PENDING', payload.notes || null, payload.transfer_date || null,
            payload.collection_cashbox_id || null, payload.collection_receipt_voucher_id || null,
            payload.payout_cashbox_id || null, payload.payout_payment_voucher_id || null,
        ];
        const { rows } = await db.query(query, values);
        return rows[0];
    }
    async list(filters) {
        let query = `
      SELECT t.*, 
             s.shipment_no as shipment_no,
             b.name as branch_name,
             a.name as agent_name,
             origin_agent.name as origin_agent_name,
             destination_agent.name as destination_agent_name,
             rv.voucher_no as receipt_voucher_no,
             cb.name as posted_cashbox_name,
             shipment_sender.full_name as shipment_sender_name,
             shipment_receiver.full_name as shipment_receiver_name,
             CASE
               WHEN t.shipment_id IS NOT NULL THEN COALESCE(shipment_sender.full_name, t.sender_name)
               ELSE t.sender_name
             END as sender_display_name,
             CASE
               WHEN t.shipment_id IS NOT NULL THEN COALESCE(shipment_receiver.full_name, t.receiver_name)
               ELSE t.receiver_name
             END as receiver_display_name
      FROM transfers t
      LEFT JOIN shipments s ON t.shipment_id = s.id
      LEFT JOIN senders_receivers shipment_sender ON shipment_sender.id = s.sender_id
      LEFT JOIN senders_receivers shipment_receiver ON shipment_receiver.id = s.receiver_id
      LEFT JOIN branches b ON t.branch_id = b.id
      LEFT JOIN agents a ON t.agent_id = a.id
      LEFT JOIN agents origin_agent ON t.origin_agent_id = origin_agent.id
      LEFT JOIN agents destination_agent ON t.destination_agent_id = destination_agent.id
      LEFT JOIN receipt_vouchers rv ON rv.id = t.receipt_voucher_id
      LEFT JOIN cashboxes cb ON cb.id = t.posted_cashbox_id
      WHERE t.company_id = $1
    `;
        const values = [filters.company_id];
        let paramIndex = 2;
        if (filters.branch_id) {
            query += ` AND t.branch_id = $${paramIndex++}`;
            values.push(filters.branch_id);
        }
        if (filters.agent_id) {
            query += ` AND t.agent_id = $${paramIndex++}`;
            values.push(filters.agent_id);
        }
        if (filters.status) {
            query += ` AND t.status = $${paramIndex++}`;
            values.push(filters.status);
        }
        if (filters.search) {
            query += ` AND (
        t.sender_name ILIKE $${paramIndex}
        OR t.receiver_name ILIKE $${paramIndex}
        OR shipment_sender.full_name ILIKE $${paramIndex}
        OR shipment_receiver.full_name ILIKE $${paramIndex}
      )`;
            values.push(`%${filters.search}%`);
            paramIndex++;
        }
        query += ` ORDER BY t.created_at DESC LIMIT 500`;
        const { rows } = await this.pool.query(query, values);
        return rows;
    }
    async listForAgent(input) {
        const values = [input.companyId, input.agentId];
        const conditions = ['t.company_id = $1', '(t.agent_id = $2 or t.origin_agent_id = $2 or t.destination_agent_id = $2)'];
        if (input.status) {
            values.push(input.status);
            conditions.push(`upper(t.status) = upper($${values.length}::text)`);
        }
        if (input.search) {
            values.push(`%${input.search}%`);
            conditions.push(`(
        t.sender_name ilike $${values.length}
        or t.receiver_name ilike $${values.length}
        or coalesce(s.shipment_no, '') ilike $${values.length}
      )`);
        }
        if (input.type === 'independent') {
            conditions.push('t.shipment_id is null');
        }
        else if (input.type === 'shipment_linked') {
            conditions.push('t.shipment_id is not null');
        }
        const countResult = await this.pool.query(`
      select count(*)::text as count
      from transfers t
      left join shipments s on s.id = t.shipment_id
      where ${conditions.join(' and ')}
      `, values);
        values.push(input.limit);
        const limitParam = `$${values.length}`;
        values.push(input.offset);
        const offsetParam = `$${values.length}`;
        const result = await this.pool.query(`
      select
        t.*,
        s.shipment_no as linked_shipment_no,
        s.origin_city as linked_source_city,
        s.destination_city as linked_destination_city,
        s.financial_status as linked_shipment_financial_status,
        origin_agent.name as origin_agent_name,
        coalesce(origin_agent.area, origin_agent.city, origin_agent.governorate) as origin_agent_city,
        destination_agent.name as destination_agent_name,
        coalesce(destination_agent.area, destination_agent.city, destination_agent.governorate) as destination_agent_city
      from transfers t
      left join shipments s on s.id = t.shipment_id
      left join agents origin_agent on origin_agent.id = t.origin_agent_id
      left join agents destination_agent on destination_agent.id = t.destination_agent_id
      where ${conditions.join(' and ')}
      order by coalesce(t.transfer_date, t.created_at) desc, t.created_at desc, t.id desc
      limit ${limitParam}
      offset ${offsetParam}
      `, values);
        return {
            items: result.rows,
            total: Number(countResult.rows[0]?.count ?? 0),
        };
    }
    async getByIdForAgent(id, companyId, agentId) {
        const result = await this.pool.query(`
      select
        t.*,
        s.shipment_no as linked_shipment_no,
        s.origin_city as linked_source_city,
        s.destination_city as linked_destination_city,
        s.financial_status as linked_shipment_financial_status,
        origin_agent.name as origin_agent_name,
        coalesce(origin_agent.area, origin_agent.city, origin_agent.governorate) as origin_agent_city,
        destination_agent.name as destination_agent_name,
        coalesce(destination_agent.area, destination_agent.city, destination_agent.governorate) as destination_agent_city
      from transfers t
      left join shipments s on s.id = t.shipment_id
      left join agents origin_agent on origin_agent.id = t.origin_agent_id
      left join agents destination_agent on destination_agent.id = t.destination_agent_id
      where t.id = $1
        and t.company_id = $2
        and (t.agent_id = $3 or t.origin_agent_id = $3 or t.destination_agent_id = $3)
      limit 1
      `, [id, companyId, agentId]);
        return result.rows[0] ?? null;
    }
    async getByShipmentIdForAgent(shipmentId, companyId, agentId) {
        const result = await this.pool.query(`
      select
        t.*,
        s.shipment_no as linked_shipment_no,
        s.origin_city as linked_source_city,
        s.destination_city as linked_destination_city,
        s.financial_status as linked_shipment_financial_status,
        origin_agent.name as origin_agent_name,
        coalesce(origin_agent.area, origin_agent.city, origin_agent.governorate) as origin_agent_city,
        destination_agent.name as destination_agent_name,
        coalesce(destination_agent.area, destination_agent.city, destination_agent.governorate) as destination_agent_city
      from transfers t
      join shipments s on s.id = t.shipment_id
      left join agents origin_agent on origin_agent.id = t.origin_agent_id
      left join agents destination_agent on destination_agent.id = t.destination_agent_id
      where t.shipment_id = $1
        and t.company_id = $2
        and (t.agent_id = $3 or t.origin_agent_id = $3 or t.destination_agent_id = $3)
      order by t.created_at desc
      limit 1
      `, [shipmentId, companyId, agentId]);
        return result.rows[0] ?? null;
    }
    async updateStatus(id, company_id, status, client) {
        const db = client || this.pool;
        const query = `
      UPDATE transfers 
      SET status = $1, updated_at = NOW()
      WHERE id = $2 AND company_id = $3
      RETURNING *;
    `;
        const { rows } = await db.query(query, [status, id, company_id]);
        return rows[0];
    }
    async markCompleted(id, company_id, input, client) {
        const { rows } = await client.query(`
      update transfers
      set
        status = 'COMPLETED',
        receipt_voucher_id = coalesce($3, receipt_voucher_id),
        posted_cashbox_id = coalesce($4, posted_cashbox_id),
        posted_at = coalesce(posted_at, now()),
        posted_by_user_id = coalesce($5, posted_by_user_id),
        payout_cashbox_id = coalesce($4, payout_cashbox_id),
        payout_payment_voucher_id = coalesce($6, payout_payment_voucher_id),
        paid_out_at = coalesce(paid_out_at, now()),
        updated_at = now()
      where id = $1 and company_id = $2
      returning *
      `, [id, company_id, input.receiptVoucherId ?? null, input.postedCashboxId ?? null, input.postedByUserId ?? null, input.payoutPaymentVoucherId ?? null]);
        return rows[0] ?? null;
    }
    async markCollected(id, companyId, input, client) {
        const { rows } = await client.query(`
      update transfers
      set collection_cashbox_id = coalesce(collection_cashbox_id, $3),
          collection_receipt_voucher_id = coalesce(collection_receipt_voucher_id, $4),
          collected_at = coalesce(collected_at, now()),
          updated_at = now()
      where id = $1 and company_id = $2
      returning *
      `, [id, companyId, input.collectionCashboxId, input.collectionReceiptVoucherId]);
        return rows[0] ?? null;
    }
    async markCancelled(id, company_id, input, client) {
        const { rows } = await client.query(`
      update transfers
      set
        status = 'CANCELLED',
        cancelled_at = coalesce(cancelled_at, now()),
        cancelled_by_user_id = coalesce($3, cancelled_by_user_id),
        cancellation_reason = coalesce($4, cancellation_reason),
        updated_at = now()
      where id = $1 and company_id = $2
      returning *
      `, [id, company_id, input.cancelledByUserId ?? null, input.cancellationReason ?? null]);
        return rows[0] ?? null;
    }
    buildReportConditions(filters) {
        const values = [filters.company_id];
        const conditions = ['t.company_id = $1::uuid'];
        if (filters.branch_id) {
            values.push(filters.branch_id);
            conditions.push(`t.branch_id = $${values.length}::uuid`);
        }
        if (filters.agent_id) {
            values.push(filters.agent_id);
            conditions.push(`(
        t.agent_id = $${values.length}::uuid
        or t.origin_agent_id = $${values.length}::uuid
        or t.destination_agent_id = $${values.length}::uuid
      )`);
        }
        if (filters.status) {
            values.push(String(filters.status).toUpperCase());
            conditions.push(`upper(t.status) = $${values.length}`);
        }
        if (filters.originAgentId) {
            values.push(filters.originAgentId);
            conditions.push(`t.origin_agent_id = $${values.length}::uuid`);
        }
        if (filters.destinationAgentId) {
            values.push(filters.destinationAgentId);
            conditions.push(`t.destination_agent_id = $${values.length}::uuid`);
        }
        if (filters.destinationCity) {
            values.push(`%${filters.destinationCity}%`);
            conditions.push(`coalesce(t.destination_city, '') ilike $${values.length}`);
        }
        if (filters.dateFrom) {
            values.push(filters.dateFrom);
            conditions.push(`coalesce(t.transfer_date, t.created_at) >= $${values.length}::timestamptz`);
        }
        if (filters.dateTo) {
            values.push(filters.dateTo);
            conditions.push(`coalesce(t.transfer_date, t.created_at) <= $${values.length}::timestamptz`);
        }
        return { values, conditions };
    }
    async getReport(filters) {
        const { values, conditions } = this.buildReportConditions(filters);
        const whereClause = conditions.join(' and ');
        const detailResult = await this.pool.query(`
      select
        t.id,
        coalesce(t.transfer_date, t.created_at) as report_date,
        t.created_at,
        t.transfer_date,
        t.status,
        t.sender_name,
        t.receiver_name,
        t.amount,
        t.currency,
        t.main_amount,
        t.transfer_service_fee,
        t.transfer_service_fee_currency,
        t.agent_commission,
        t.agent_commission_currency,
        t.destination_city,
        t.shipment_id,
        s.shipment_no,
        b.name as branch_name,
        origin_agent.id as origin_agent_id,
        origin_agent.name as origin_agent_name,
        coalesce(origin_agent.area, origin_agent.city, origin_agent.governorate) as origin_agent_city,
        destination_agent.id as destination_agent_id,
        destination_agent.name as destination_agent_name,
        coalesce(destination_agent.area, destination_agent.city, destination_agent.governorate) as destination_agent_city,
        coalesce(t.destination_city, destination_agent.name, destination_agent.city) as destination_label,
        t.posted_at,
        t.cancelled_at,
        payout_cb.name as payout_cashbox_name,
        payout_pv.voucher_no as payout_voucher_no,
        collection_cb.name as collection_cashbox_name,
        collection_rv.voucher_no as collection_voucher_no,
        t.notes
      from transfers t
      left join shipments s on s.id = t.shipment_id
      left join branches b on b.id = t.branch_id
      left join agents origin_agent on origin_agent.id = t.origin_agent_id
      left join agents destination_agent on destination_agent.id = t.destination_agent_id
      left join cashboxes payout_cb on payout_cb.id = t.payout_cashbox_id
      left join payment_vouchers payout_pv on payout_pv.id = t.payout_payment_voucher_id
      left join cashboxes collection_cb on collection_cb.id = t.collection_cashbox_id
      left join receipt_vouchers collection_rv on collection_rv.id = t.collection_receipt_voucher_id
      where ${whereClause}
      order by coalesce(t.transfer_date, t.created_at) desc, t.created_at desc
      limit 5000
      `, values);
        const summaryResult = await this.pool.query(`
      select
        count(*)::int as total_count,
        count(*) filter (where upper(t.status) = 'PENDING')::int as pending_count,
        count(*) filter (where upper(t.status) = 'COMPLETED')::int as completed_count,
        count(*) filter (where upper(t.status) = 'CANCELLED')::int as cancelled_count,
        coalesce(sum(t.amount) filter (where upper(t.status) = 'PENDING'), 0) as pending_amount,
        coalesce(sum(t.amount) filter (where upper(t.status) = 'COMPLETED'), 0) as completed_amount,
        coalesce(sum(t.transfer_service_fee) filter (where upper(t.status) != 'CANCELLED'), 0) as total_service_fees,
        t.currency
      from transfers t
      left join agents destination_agent on destination_agent.id = t.destination_agent_id
      where ${whereClause}
      group by t.currency
      order by t.currency
      `, values);
        const destinationResult = await this.pool.query(`
      select
        coalesce(destination_agent.id::text, '') as destination_agent_id,
        coalesce(destination_agent.name, t.destination_city, 'غير محدد') as destination_label,
        coalesce(t.destination_city, destination_agent.city, destination_agent.area) as destination_city,
        count(*)::int as total_count,
        count(*) filter (where upper(t.status) = 'PENDING')::int as pending_count,
        count(*) filter (where upper(t.status) = 'COMPLETED')::int as completed_count,
        count(*) filter (where upper(t.status) = 'CANCELLED')::int as cancelled_count,
        coalesce(sum(t.amount) filter (where upper(t.status) = 'PENDING'), 0) as pending_amount,
        coalesce(sum(t.amount) filter (where upper(t.status) = 'COMPLETED'), 0) as completed_amount,
        coalesce(sum(t.amount) filter (where upper(t.status) != 'CANCELLED'), 0) as total_amount,
        t.currency
      from transfers t
      left join agents destination_agent on destination_agent.id = t.destination_agent_id
      where ${whereClause}
      group by
        destination_agent.id,
        destination_agent.name,
        destination_agent.city,
        destination_agent.area,
        t.destination_city,
        t.currency
      order by total_amount desc, destination_label asc
      `, values);
        return {
            rows: detailResult.rows,
            summaryByCurrency: summaryResult.rows,
            byDestination: destinationResult.rows,
        };
    }
    async delete(id, company_id, client) {
        const db = client || this.pool;
        const existing = await this.getById(id, company_id, client);
        if (existing) {
            const status = String(existing.status).toUpperCase();
            if (status === 'COMPLETED') {
                throw new Error('لا يمكن حذف حوالة مكتملة. قم بإلغائها بدلاً من ذلك.');
            }
            if (status === 'CANCELLED') {
                throw new Error('لا يمكن حذف حوالة ملغاة.');
            }
        }
        const query = `DELETE FROM transfers WHERE id = $1 AND company_id = $2 RETURNING *;`;
        const { rows } = await db.query(query, [id, company_id]);
        return rows[0];
    }
}
