import { Pool, PoolClient } from 'pg';

export interface TransferPayload {
  company_id: string;
  branch_id?: string;
  agent_id?: string;
  origin_agent_id?: string;
  destination_agent_id?: string;
  destination_city?: string;
  shipment_id?: string;
  sender_name: string;
  receiver_name: string;
  amount: number;
  currency: string;
  main_amount: number;
  // Legacy field kept for compatibility with old callers.
  commission?: number;
  commission_currency?: string;
  commission_main?: number;
  // Explicit accounting fields.
  agent_commission?: number;
  agent_commission_currency?: string;
  agent_commission_main?: number;
  transfer_service_fee?: number;
  transfer_service_fee_currency?: string;
  transfer_service_fee_main?: number;
  company_transfer_profit?: number;
  company_transfer_profit_currency?: string;
  company_transfer_profit_main?: number;
  status: string;
  transfer_date?: Date;
  notes?: string;
  posted_cashbox_id?: string;
  receipt_voucher_id?: string;
  posted_at?: Date;
  posted_by_user_id?: string;
  collection_cashbox_id?: string;
  collection_receipt_voucher_id?: string;
  payout_cashbox_id?: string;
  payout_payment_voucher_id?: string;
  cancelled_at?: Date;
  cancelled_by_user_id?: string;
  cancellation_reason?: string;
}

export class TransfersRepository {
  constructor(private pool: Pool) {}

  async getById(id: string, company_id: string, client?: PoolClient) {
    const db = client || this.pool;
    const { rows } = await db.query(`select * from transfers where id = $1 and company_id = $2`, [id, company_id]);
    return rows[0] ?? null;
  }

  async lockById(id: string, company_id: string, client: PoolClient) {
    const { rows } = await client.query(
      `select * from transfers where id = $1 and company_id = $2 for update`,
      [id, company_id],
    );
    return rows[0] ?? null;
  }

  async create(payload: TransferPayload, client?: PoolClient) {
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

  async list(filters: { company_id: string; branch_id?: string; agent_id?: string; status?: string; search?: string }) {
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
    const values: any[] = [filters.company_id];
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

  async listForAgent(input: {
    companyId: string;
    agentId: string;
    status?: string;
    search?: string;
    limit: number;
    offset: number;
  }) {
    const values: unknown[] = [input.companyId, input.agentId];
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

    const countResult = await this.pool.query<{ count: string }>(
      `
      select count(*)::text as count
      from transfers t
      left join shipments s on s.id = t.shipment_id
      where ${conditions.join(' and ')}
      `,
      values,
    );

    values.push(input.limit);
    const limitParam = `$${values.length}`;
    values.push(input.offset);
    const offsetParam = `$${values.length}`;

    const result = await this.pool.query(
      `
      select
        t.*,
        s.shipment_no as linked_shipment_no,
        origin_agent.name as origin_agent_name,
        destination_agent.name as destination_agent_name
      from transfers t
      left join shipments s on s.id = t.shipment_id
      left join agents origin_agent on origin_agent.id = t.origin_agent_id
      left join agents destination_agent on destination_agent.id = t.destination_agent_id
      where ${conditions.join(' and ')}
      order by coalesce(t.transfer_date, t.created_at) desc, t.created_at desc, t.id desc
      limit ${limitParam}
      offset ${offsetParam}
      `,
      values,
    );

    return {
      items: result.rows,
      total: Number(countResult.rows[0]?.count ?? 0),
    };
  }

  async getByIdForAgent(id: string, companyId: string, agentId: string) {
    const result = await this.pool.query(
      `
      select
        t.*,
        s.shipment_no as linked_shipment_no,
        origin_agent.name as origin_agent_name,
        destination_agent.name as destination_agent_name
      from transfers t
      left join shipments s on s.id = t.shipment_id
      left join agents origin_agent on origin_agent.id = t.origin_agent_id
      left join agents destination_agent on destination_agent.id = t.destination_agent_id
      where t.id = $1
        and t.company_id = $2
        and (t.agent_id = $3 or t.origin_agent_id = $3 or t.destination_agent_id = $3)
      limit 1
      `,
      [id, companyId, agentId],
    );
    return result.rows[0] ?? null;
  }

  async updateStatus(id: string, company_id: string, status: string, client?: PoolClient) {
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

  async markCompleted(
    id: string,
    company_id: string,
    input: {
      receiptVoucherId?: string | null;
      postedCashboxId?: string | null;
      payoutPaymentVoucherId?: string | null;
      postedByUserId?: string | null;
    },
    client: PoolClient,
  ) {
    const { rows } = await client.query(
      `
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
      `,
      [id, company_id, input.receiptVoucherId ?? null, input.postedCashboxId ?? null, input.postedByUserId ?? null, input.payoutPaymentVoucherId ?? null],
    );
    return rows[0] ?? null;
  }

  async markCollected(
    id: string,
    companyId: string,
    input: { collectionCashboxId: string; collectionReceiptVoucherId: string },
    client: PoolClient,
  ) {
    const { rows } = await client.query(
      `
      update transfers
      set collection_cashbox_id = coalesce(collection_cashbox_id, $3),
          collection_receipt_voucher_id = coalesce(collection_receipt_voucher_id, $4),
          collected_at = coalesce(collected_at, now()),
          updated_at = now()
      where id = $1 and company_id = $2
      returning *
      `,
      [id, companyId, input.collectionCashboxId, input.collectionReceiptVoucherId],
    );
    return rows[0] ?? null;
  }

  async markCancelled(
    id: string,
    company_id: string,
    input: {
      cancelledByUserId?: string | null;
      cancellationReason?: string | null;
    },
    client: PoolClient,
  ) {
    const { rows } = await client.query(
      `
      update transfers
      set
        status = 'CANCELLED',
        cancelled_at = coalesce(cancelled_at, now()),
        cancelled_by_user_id = coalesce($3, cancelled_by_user_id),
        cancellation_reason = coalesce($4, cancellation_reason),
        updated_at = now()
      where id = $1 and company_id = $2
      returning *
      `,
      [id, company_id, input.cancelledByUserId ?? null, input.cancellationReason ?? null],
    );
    return rows[0] ?? null;
  }

  async delete(id: string, company_id: string, client?: PoolClient) {
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
