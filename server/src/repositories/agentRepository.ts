import { pool } from '../db/pool.js';

export interface AgentRecord {
  id: string;
  code: string;
  name: string;
  phone: string | null;
  governorate: string | null;
  city: string | null;
  area: string | null;
  address: string | null;
  notes: string | null;
  branch_id: string | null;
  telegram_chat_id: string | null;
  is_active: boolean;
  commission_percentage: number;
  created_at: string;
  updated_at: string;
}

export interface CreateAgentInput {
  code: string;
  name: string;
  phone?: string;
  governorate?: string;
  city?: string;
  area?: string;
  address?: string;
  notes?: string;
  branch_id: string;
  telegram_chat_id?: string | null;
  is_active?: boolean;
  commission_percentage?: number;
}

export interface UpdateAgentInput {
  code?: string;
  name?: string;
  phone?: string;
  governorate?: string;
  city?: string;
  area?: string;
  address?: string;
  notes?: string;
  branch_id?: string | null;
  telegram_chat_id?: string | null;
  is_active?: boolean;
  commission_percentage?: number;
}

export class AgentRepository {
  async listAgents(companyId: string, branchId?: string, includeInactive = false): Promise<AgentRecord[]> {
    const result = await pool.query<AgentRecord>(
      `
      select a.id, a.code, a.name, a.phone, a.governorate, a.city, a.area, a.address, a.notes, a.branch_id, a.telegram_chat_id, a.is_active, a.commission_percentage, a.created_at::text, a.updated_at::text
      from agents a
      join branches b on b.id = a.branch_id
      where b.company_id = $1
        and ($2::uuid is null or a.branch_id = $2::uuid)
        and ($3::boolean = true or a.is_active = true)
      order by a.created_at desc
      `,
      [companyId, branchId ?? null, includeInactive],
    );
    return result.rows;
  }

  async getAgentById(id: string, companyId: string): Promise<AgentRecord | null> {
    const result = await pool.query<AgentRecord>(
      `
      select a.id, a.code, a.name, a.phone, a.governorate, a.city, a.area, a.address, a.notes, a.branch_id, a.telegram_chat_id, a.is_active, a.commission_percentage, a.created_at::text, a.updated_at::text
      from agents a
      join branches b on b.id = a.branch_id
      where a.id = $1
        and b.company_id = $2
      limit 1
      `,
      [id, companyId],
    );
    return result.rows[0] ?? null;
  }

  async branchBelongsToCompany(branchId: string, companyId: string): Promise<boolean> {
    const result = await pool.query(
      `
      select 1
      from branches
      where id = $1 and company_id = $2
      limit 1
      `,
      [branchId, companyId],
    );
    return (result.rowCount ?? 0) > 0;
  }

  async createAgent(companyId: string, data: CreateAgentInput): Promise<AgentRecord> {
    const result = await pool.query<AgentRecord>(
      `
      insert into agents(code, name, phone, governorate, city, area, address, notes, branch_id, telegram_chat_id, is_active, commission_percentage)
      values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, coalesce($11, true), coalesce($12, 0))
      returning id, code, name, phone, governorate, city, area, address, notes, branch_id, telegram_chat_id, is_active, commission_percentage, created_at::text, updated_at::text
      `,
      [data.code, data.name, data.phone ?? null, data.governorate ?? null, data.city ?? null, data.area ?? null, data.address ?? null, data.notes ?? null, data.branch_id ?? null, data.telegram_chat_id ?? null, data.is_active ?? true, data.commission_percentage ?? 0],
    );
    return result.rows[0];
  }

  async updateAgent(id: string, companyId: string, data: UpdateAgentInput): Promise<AgentRecord | null> {
    const result = await pool.query<AgentRecord>(
      `
      update agents a
      set
        code        = coalesce($3, a.code),
        name        = coalesce($4, a.name),
        phone       = coalesce($5, a.phone),
        governorate = coalesce($6, a.governorate),
        city        = coalesce($7, a.city),
        area        = coalesce($8, a.area),
        address     = coalesce($9, a.address),
        notes       = coalesce($10, a.notes),
        branch_id   = case when $13::boolean = true then null else coalesce($11::uuid, a.branch_id) end,
        is_active   = coalesce($12, a.is_active),
        telegram_chat_id = case when $15::boolean = true then null else coalesce($14, a.telegram_chat_id) end,
        commission_percentage = coalesce($16, a.commission_percentage),
        updated_at  = now()
      where a.id = $1
        and exists(
          select 1
          from branches b
          where b.id = a.branch_id
            and b.company_id = $2
        )
      returning a.id, a.code, a.name, a.phone, a.governorate, a.city, a.area, a.address, a.notes, a.branch_id, a.telegram_chat_id, a.is_active, a.commission_percentage, a.created_at::text, a.updated_at::text
      `,
      [
        id,
        companyId,
        data.code ?? null,
        data.name ?? null,
        data.phone ?? null,
        data.governorate ?? null,
        data.city ?? null,
        data.area ?? null,
        data.address ?? null,
        data.notes ?? null,
        data.branch_id ?? null,
        data.is_active,
        data.branch_id === null,
        data.telegram_chat_id ?? null,
        data.telegram_chat_id === null,
        data.commission_percentage ?? null,
      ],
    );
    return result.rows[0] ?? null;
  }

  async deactivateAgent(id: string, companyId: string): Promise<boolean> {
    const result = await pool.query(
      `
      update agents a
      set is_active = false, updated_at = now()
      where a.id = $1
        and exists(
          select 1
          from branches b
          where b.id = a.branch_id
            and b.company_id = $2
        )
        and a.is_active = true
      `,
      [id, companyId],
    );
    return (result.rowCount ?? 0) > 0;
  }

  async lookupByDestination(companyId: string, destination: string, branchId?: string): Promise<AgentRecord[]> {
    const normalized = destination.trim().toLowerCase();
    const result = await pool.query<AgentRecord>(
      `
      select a.id, a.code, a.name, a.phone, a.governorate, a.city, a.area, a.address, a.notes, a.branch_id, a.telegram_chat_id, a.is_active, a.commission_percentage, a.created_at::text, a.updated_at::text
      from agents a
      join branches b on b.id = a.branch_id
      where b.company_id = $1
        and a.is_active = true
        and ($2::uuid is null or a.branch_id = $2::uuid)
        and (
          lower(coalesce(a.area, '')) = $3
          or lower(coalesce(a.city, '')) = $3
          or lower(coalesce(a.governorate, '')) = $3
        )
      order by a.created_at desc
      `,
      [companyId, branchId ?? null, normalized],
    );
    return result.rows;
  }
}
