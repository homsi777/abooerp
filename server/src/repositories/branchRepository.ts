import { pool } from '../db/pool.js';

export interface BranchRecord {
  id: string;
  code: string;
  name: string;
  city: string | null;
  address: string | null;
  phone: string | null;
  company_id: string;
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

export interface CreateBranchInput {
  code: string;
  name: string;
  city?: string;
  address?: string;
  phone?: string;
  is_active?: boolean;
}

export interface UpdateBranchInput {
  code?: string;
  name?: string;
  city?: string;
  address?: string;
  phone?: string;
  is_active?: boolean;
}

export class BranchRepository {
  async listBranches(companyId: string, includeInactive = false): Promise<BranchRecord[]> {
    const result = await pool.query<BranchRecord>(
      `
      select id, code, name, city, address, phone, company_id, is_active, created_at::text, updated_at::text
      from branches
      where company_id = $1
        and ($2::boolean = true or is_active = true)
      order by created_at desc
      `,
      [companyId, includeInactive],
    );
    return result.rows;
  }

  async getBranchById(branchId: string, companyId: string): Promise<BranchRecord | null> {
    const result = await pool.query<BranchRecord>(
      `
      select id, code, name, city, address, phone, company_id, is_active, created_at::text, updated_at::text
      from branches
      where id = $1 and company_id = $2
      limit 1
      `,
      [branchId, companyId],
    );
    return result.rows[0] ?? null;
  }

  async createBranch(companyId: string, data: CreateBranchInput): Promise<BranchRecord> {
    const result = await pool.query<BranchRecord>(
      `
      insert into branches(code, name, city, address, phone, company_id, is_active)
      values ($1, $2, $3, $4, $5, $6, coalesce($7, true))
      returning id, code, name, city, address, phone, company_id, is_active, created_at::text, updated_at::text
      `,
      [data.code, data.name, data.city ?? null, data.address ?? null, data.phone ?? null, companyId, data.is_active ?? true],
    );
    return result.rows[0];
  }

  async updateBranch(branchId: string, companyId: string, data: UpdateBranchInput): Promise<BranchRecord | null> {
    const result = await pool.query<BranchRecord>(
      `
      update branches
      set
        code = coalesce($3, code),
        name = coalesce($4, name),
        city = coalesce($5, city),
        address = coalesce($6, address),
        phone = coalesce($7, phone),
        is_active = coalesce($8, is_active),
        updated_at = now()
      where id = $1 and company_id = $2
      returning id, code, name, city, address, phone, company_id, is_active, created_at::text, updated_at::text
      `,
      [branchId, companyId, data.code ?? null, data.name ?? null, data.city ?? null, data.address ?? null, data.phone ?? null, data.is_active],
    );
    return result.rows[0] ?? null;
  }

  async deactivateBranch(branchId: string, companyId: string): Promise<boolean> {
    const result = await pool.query(
      `
      update branches
      set is_active = false, updated_at = now()
      where id = $1 and company_id = $2 and is_active = true
      `,
      [branchId, companyId],
    );
    return (result.rowCount ?? 0) > 0;
  }
}
