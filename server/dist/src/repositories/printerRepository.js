import { pool } from '../db/pool.js';
export class PrinterRepository {
    async branchBelongsToCompany(branchId, companyId) {
        const result = await pool.query(`
      select 1
      from branches
      where id = $1 and company_id = $2
      limit 1
      `, [branchId, companyId]);
        return (result.rowCount ?? 0) > 0;
    }
    async listPrinters(companyId, branchId, includeInactive = false) {
        const result = await pool.query(`
      select
        id, company_id, branch_id, code, name, printer_type, connection_type, target,
        is_default, is_active, metadata, created_at::text, updated_at::text
      from printers
      where company_id = $1
        and ($2::uuid is null or branch_id = $2::uuid or branch_id is null)
        and ($3::boolean = true or is_active = true)
      order by
        case when branch_id is null then 1 else 0 end asc,
        is_default desc,
        created_at desc
      `, [companyId, branchId ?? null, includeInactive]);
        return result.rows;
    }
    async getPrinterById(id, companyId) {
        const result = await pool.query(`
      select
        id, company_id, branch_id, code, name, printer_type, connection_type, target,
        is_default, is_active, metadata, created_at::text, updated_at::text
      from printers
      where id = $1 and company_id = $2
      limit 1
      `, [id, companyId]);
        return result.rows[0] ?? null;
    }
    async createPrinter(companyId, data) {
        const result = await pool.query(`
      insert into printers(
        company_id, branch_id, code, name, printer_type, connection_type, target, is_default, is_active, metadata
      )
      values($1, $2, $3, $4, $5, $6, $7, coalesce($8, false), coalesce($9, true), coalesce($10::jsonb, '{}'::jsonb))
      returning
        id, company_id, branch_id, code, name, printer_type, connection_type, target,
        is_default, is_active, metadata, created_at::text, updated_at::text
      `, [
            companyId,
            data.branch_id ?? null,
            data.code,
            data.name,
            data.printer_type,
            data.connection_type,
            data.target,
            data.is_default ?? false,
            data.is_active ?? true,
            JSON.stringify(data.metadata ?? {}),
        ]);
        return result.rows[0];
    }
    async updatePrinter(id, companyId, data) {
        const result = await pool.query(`
      update printers
      set
        branch_id = case when $11::boolean = true then null else coalesce($3::uuid, branch_id) end,
        code = coalesce($4, code),
        name = coalesce($5, name),
        printer_type = coalesce($6, printer_type),
        connection_type = coalesce($7, connection_type),
        target = coalesce($8, target),
        is_default = coalesce($9, is_default),
        is_active = coalesce($10, is_active),
        metadata = coalesce($12::jsonb, metadata),
        updated_at = now()
      where id = $1 and company_id = $2
      returning
        id, company_id, branch_id, code, name, printer_type, connection_type, target,
        is_default, is_active, metadata, created_at::text, updated_at::text
      `, [
            id,
            companyId,
            data.branch_id ?? null,
            data.code ?? null,
            data.name ?? null,
            data.printer_type ?? null,
            data.connection_type ?? null,
            data.target ?? null,
            data.is_default,
            data.is_active,
            data.branch_id === null,
            data.metadata ? JSON.stringify(data.metadata) : null,
        ]);
        return result.rows[0] ?? null;
    }
    async deactivatePrinter(id, companyId) {
        const result = await pool.query(`
      update printers
      set is_active = false, is_default = false, updated_at = now()
      where id = $1 and company_id = $2 and is_active = true
      `, [id, companyId]);
        return (result.rowCount ?? 0) > 0;
    }
    async setDefaultPrinter(id, companyId, branchId) {
        const client = await pool.connect();
        try {
            await client.query('begin');
            const target = await client.query(`
        select
          id, company_id, branch_id, code, name, printer_type, connection_type, target,
          is_default, is_active, metadata, created_at::text, updated_at::text
        from printers
        where id = $1 and company_id = $2 and is_active = true
        limit 1
        `, [id, companyId]);
            const row = target.rows[0];
            if (!row) {
                await client.query('rollback');
                return null;
            }
            const scopeBranchId = branchId ?? row.branch_id ?? null;
            await client.query(`
        update printers
        set is_default = false, updated_at = now()
        where company_id = $1
          and coalesce(branch_id, '00000000-0000-0000-0000-000000000000'::uuid)
            = coalesce($2::uuid, '00000000-0000-0000-0000-000000000000'::uuid)
        `, [companyId, scopeBranchId]);
            const updated = await client.query(`
        update printers
        set is_default = true, updated_at = now()
        where id = $1 and company_id = $2
        returning
          id, company_id, branch_id, code, name, printer_type, connection_type, target,
          is_default, is_active, metadata, created_at::text, updated_at::text
        `, [id, companyId]);
            await client.query('commit');
            return updated.rows[0] ?? null;
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
