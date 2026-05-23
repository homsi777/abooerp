import { pool } from '../db/pool.js';
import { withDbRetry } from '../utils/transaction.js';
export class PrinterRouteRepository {
    async listPrinterRoutes(companyId, branchId, includeInactive = false) {
        const result = await pool.query(`
      select
        id, company_id, branch_id, document_type, printer_id, copies, is_default, is_active, metadata,
        created_at::text, updated_at::text
      from printer_routes
      where company_id = $1
        and ($2::uuid is null or branch_id = $2::uuid or branch_id is null)
        and ($3::boolean = true or is_active = true)
      order by
        document_type asc,
        case when branch_id is null then 1 else 0 end asc,
        is_default desc,
        created_at desc
      `, [companyId, branchId ?? null, includeInactive]);
        return result.rows;
    }
    async getPrinterRouteById(id, companyId) {
        const result = await pool.query(`
      select
        id, company_id, branch_id, document_type, printer_id, copies, is_default, is_active, metadata,
        created_at::text, updated_at::text
      from printer_routes
      where id = $1 and company_id = $2
      limit 1
      `, [id, companyId]);
        return result.rows[0] ?? null;
    }
    async createPrinterRoute(companyId, data) {
        const result = await pool.query(`
      insert into printer_routes(
        company_id, branch_id, document_type, printer_id, copies, is_default, is_active, metadata
      )
      values($1, $2, $3, $4, coalesce($5, 1), coalesce($6, false), coalesce($7, true), coalesce($8::jsonb, '{}'::jsonb))
      returning
        id, company_id, branch_id, document_type, printer_id, copies, is_default, is_active, metadata,
        created_at::text, updated_at::text
      `, [
            companyId,
            data.branch_id ?? null,
            data.document_type,
            data.printer_id,
            data.copies ?? 1,
            data.is_default ?? false,
            data.is_active ?? true,
            JSON.stringify(data.metadata ?? {}),
        ]);
        return result.rows[0];
    }
    async updatePrinterRoute(id, companyId, data) {
        const result = await pool.query(`
      update printer_routes
      set
        branch_id = case when $9::boolean = true then null else coalesce($3::uuid, branch_id) end,
        document_type = coalesce($4, document_type),
        printer_id = coalesce($5::uuid, printer_id),
        copies = coalesce($6, copies),
        is_default = coalesce($7, is_default),
        is_active = coalesce($8, is_active),
        metadata = coalesce($10::jsonb, metadata),
        updated_at = now()
      where id = $1 and company_id = $2
      returning
        id, company_id, branch_id, document_type, printer_id, copies, is_default, is_active, metadata,
        created_at::text, updated_at::text
      `, [
            id,
            companyId,
            data.branch_id ?? null,
            data.document_type ?? null,
            data.printer_id ?? null,
            data.copies ?? null,
            data.is_default,
            data.is_active,
            data.branch_id === null,
            data.metadata ? JSON.stringify(data.metadata) : null,
        ]);
        return result.rows[0] ?? null;
    }
    async deactivatePrinterRoute(id, companyId) {
        const result = await pool.query(`
      update printer_routes
      set is_active = false, is_default = false, updated_at = now()
      where id = $1 and company_id = $2 and is_active = true
      `, [id, companyId]);
        return (result.rowCount ?? 0) > 0;
    }
    async clearDefaultRoute(companyId, branchId, documentType) {
        await pool.query(`
      update printer_routes
      set is_default = false, updated_at = now()
      where company_id = $1
        and document_type = $2
        and coalesce(branch_id, '00000000-0000-0000-0000-000000000000'::uuid)
          = coalesce($3::uuid, '00000000-0000-0000-0000-000000000000'::uuid)
      `, [companyId, documentType, branchId]);
    }
    async resolvePrinterRoute(companyId, branchId, documentType) {
        return withDbRetry(async () => {
            const result = await pool.query(`
        select
          r.id, r.company_id, r.branch_id, r.document_type, r.printer_id, r.copies, r.is_default, r.is_active, r.metadata,
          r.created_at::text, r.updated_at::text,
          p.code as printer_code,
          p.name as printer_name,
          p.printer_type,
          p.connection_type,
          p.target,
          p.branch_id as printer_branch_id,
          case when r.branch_id is null then 'company' else 'branch' end as route_scope
        from printer_routes r
        join printers p on p.id = r.printer_id and p.company_id = r.company_id
        where r.company_id = $1
          and r.document_type = $2
          and r.is_active = true
          and p.is_active = true
          and (
            ($3::uuid is not null and r.branch_id = $3::uuid)
            or r.branch_id is null
          )
        order by
          case when r.branch_id = $3::uuid then 0 else 1 end asc,
          r.is_default desc,
          r.updated_at desc
        limit 1
        `, [companyId, documentType, branchId]);
            return result.rows[0] ?? null;
        });
    }
}
