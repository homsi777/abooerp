import { pool } from '../db/pool.js';

export type BilateralReconciliationStatus = 'draft' | 'pending' | 'approved' | 'disputed';
export type BilateralItemStatus = 'matched' | 'unmatched' | 'disputed';

export interface BilateralReconciliationItemInput {
  itemType: string;
  description: string;
  companyAmount: number;
  agentAmount: number | null;
  difference: number | null;
  status: BilateralItemStatus;
  notes?: string | null;
  sortOrder: number;
}

export interface SaveBilateralReconciliationInput {
  agentId: string;
  periodFrom: string;
  periodTo: string;
  currencyCode: string;
  status: BilateralReconciliationStatus;
  previousBalance: number;
  periodMovement: number;
  currentBalance: number;
  notes?: string | null;
  agentNotes?: string | null;
  forceApproveNote?: string | null;
  disputeNote?: string | null;
  items: BilateralReconciliationItemInput[];
  createdByUserId?: string | null;
  approvedByUserId?: string | null;
  approvedAt?: string | null;
}

export class BilateralReconciliationRepository {
  async getLastApproved(companyId: string, agentId: string, currencyCode = 'USD') {
    const result = await pool.query(
      `
      select
        id,
        period_from::text as period_from,
        period_to::text as period_to,
        currency_code,
        status,
        previous_balance,
        period_movement,
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
      `,
      [companyId, agentId, currencyCode],
    );
    return result.rows[0] ?? null;
  }

  async listByAgent(companyId: string, agentId: string, limit = 50) {
    const result = await pool.query(
      `
      select
        br.id,
        br.agent_id,
        a.name as agent_name,
        br.period_from::text as period_from,
        br.period_to::text as period_to,
        br.currency_code,
        br.status,
        br.previous_balance,
        br.period_movement,
        br.current_balance,
        br.notes,
        br.agent_notes,
        br.force_approve_note,
        br.dispute_note,
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
      `,
      [companyId, agentId, limit],
    );
    return result.rows;
  }

  async listApprovedHistory(companyId: string, agentId: string, currencyCode = 'USD') {
    const result = await pool.query(
      `
      select
        br.id,
        br.period_from::text as period_from,
        br.period_to::text as period_to,
        br.status,
        br.previous_balance,
        br.period_movement,
        br.current_balance,
        br.approved_at::text as approved_at
      from bilateral_reconciliations br
      where br.company_id = $1
        and br.agent_id = $2
        and br.currency_code = $3
        and br.status = 'approved'
      order by br.period_to asc, br.approved_at asc nulls last
      `,
      [companyId, agentId, currencyCode],
    );
    return result.rows;
  }

  async listDiscrepancies(companyId: string, agentId: string, currencyCode = 'USD') {
    const result = await pool.query(
      `
      select
        br.id as reconciliation_id,
        br.period_from::text as period_from,
        br.period_to::text as period_to,
        br.status,
        bri.id as item_id,
        bri.item_type,
        bri.description,
        bri.company_amount,
        bri.agent_amount,
        bri.difference,
        bri.status as item_status,
        bri.notes as item_notes
      from bilateral_reconciliations br
      join bilateral_reconciliation_items bri on bri.reconciliation_id = br.id
      where br.company_id = $1
        and br.agent_id = $2
        and br.currency_code = $3
        and abs(coalesce(bri.difference, 0)) > 0.01
      order by br.period_to desc, bri.sort_order asc
      `,
      [companyId, agentId, currencyCode],
    );
    return result.rows;
  }

  async getById(companyId: string, id: string) {
    const header = await pool.query(
      `
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
        br.period_movement,
        br.current_balance,
        br.notes,
        br.agent_notes,
        br.force_approve_note,
        br.dispute_note,
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
      `,
      [companyId, id],
    );
    const row = header.rows[0];
    if (!row) return null;

    const items = await pool.query(
      `
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
      `,
      [id],
    );

    return { ...row, items: items.rows };
  }

  async updateStatus(
    companyId: string,
    id: string,
    status: BilateralReconciliationStatus,
    extra?: { disputeNote?: string | null; agentNotes?: string | null },
  ) {
    const result = await pool.query(
      `
      update bilateral_reconciliations
      set
        status = $3,
        dispute_note = coalesce($4, dispute_note),
        agent_notes = coalesce($5, agent_notes),
        updated_at = now()
      where company_id = $1
        and id = $2
      returning id
      `,
      [companyId, id, status, extra?.disputeNote ?? null, extra?.agentNotes ?? null],
    );
    if (!result.rows[0]) return null;
    return this.getById(companyId, id);
  }

  async saveGeneratedDocument(input: {
    companyId: string;
    documentType: string;
    reconciliationId: string;
    htmlContent: string;
    createdByUserId?: string | null;
    metadata?: Record<string, unknown>;
  }) {
    const result = await pool.query(
      `
      insert into generated_documents(
        company_id,
        document_type,
        reconciliation_id,
        html_content,
        created_by_user_id,
        metadata
      )
      values ($1, $2, $3, $4, $5, $6::jsonb)
      returning id, generated_at::text as generated_at
      `,
      [
        input.companyId,
        input.documentType,
        input.reconciliationId,
        input.htmlContent,
        input.createdByUserId ?? null,
        JSON.stringify(input.metadata ?? {}),
      ],
    );
    return result.rows[0];
  }

  private async insertItems(client: any, reconciliationId: string, items: BilateralReconciliationItemInput[]) {
    for (const item of items) {
      await client.query(
        `
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
        `,
        [
          reconciliationId,
          item.itemType,
          item.description,
          item.companyAmount,
          item.agentAmount,
          item.difference,
          item.status,
          item.notes?.trim() || null,
          item.sortOrder,
        ],
      );
    }
  }

  async create(companyId: string, input: SaveBilateralReconciliationInput) {
    const client = await pool.connect();
    try {
      await client.query('begin');
      const header = await client.query(
        `
        insert into bilateral_reconciliations(
          company_id,
          agent_id,
          period_from,
          period_to,
          currency_code,
          status,
          previous_balance,
          period_movement,
          current_balance,
          notes,
          agent_notes,
          force_approve_note,
          dispute_note,
          approved_at,
          approved_by_user_id,
          created_by_user_id
        )
        values ($1, $2, $3::timestamptz, $4::timestamptz, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14::timestamptz, $15, $16)
        returning id
        `,
        [
          companyId,
          input.agentId,
          input.periodFrom,
          input.periodTo,
          input.currencyCode,
          input.status,
          input.previousBalance,
          input.periodMovement,
          input.currentBalance,
          input.notes?.trim() || null,
          input.agentNotes?.trim() || null,
          input.forceApproveNote?.trim() || null,
          input.disputeNote?.trim() || null,
          input.approvedAt ?? null,
          input.approvedByUserId ?? null,
          input.createdByUserId ?? null,
        ],
      );
      const reconciliationId = header.rows[0].id as string;
      await this.insertItems(client, reconciliationId, input.items);
      await client.query('commit');
      return this.getById(companyId, reconciliationId);
    } catch (error) {
      await client.query('rollback');
      throw error;
    } finally {
      client.release();
    }
  }

  async update(companyId: string, id: string, input: SaveBilateralReconciliationInput) {
    const client = await pool.connect();
    try {
      await client.query('begin');
      const updated = await client.query(
        `
        update bilateral_reconciliations
        set
          period_from = $3::timestamptz,
          period_to = $4::timestamptz,
          currency_code = $5,
          status = $6,
          previous_balance = $7,
          period_movement = $8,
          current_balance = $9,
          notes = $10,
          agent_notes = $11,
          force_approve_note = $12,
          dispute_note = $13,
          approved_at = $14::timestamptz,
          approved_by_user_id = $15,
          updated_at = now()
        where company_id = $1
          and id = $2
        returning id
        `,
        [
          companyId,
          id,
          input.periodFrom,
          input.periodTo,
          input.currencyCode,
          input.status,
          input.previousBalance,
          input.periodMovement,
          input.currentBalance,
          input.notes?.trim() || null,
          input.agentNotes?.trim() || null,
          input.forceApproveNote?.trim() || null,
          input.disputeNote?.trim() || null,
          input.approvedAt ?? null,
          input.approvedByUserId ?? null,
        ],
      );
      if (!updated.rows[0]) {
        await client.query('rollback');
        return null;
      }

      await client.query('delete from bilateral_reconciliation_items where reconciliation_id = $1', [id]);
      await this.insertItems(client, id, input.items);
      await client.query('commit');
      return this.getById(companyId, id);
    } catch (error) {
      await client.query('rollback');
      throw error;
    } finally {
      client.release();
    }
  }
}
