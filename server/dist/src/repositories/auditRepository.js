import { pool } from '../db/pool.js';
export class AuditRepository {
    async logEvent(context, action, entityType, entityId, metadata) {
        const result = await pool.query(`
      insert into audit_logs(
        company_id,
        branch_id,
        user_id,
        action,
        entity_type,
        entity_id,
        metadata,
        ip_address,
        user_agent
      )
      values ($1, $2, $3, $4, $5, $6, $7::jsonb, $8, $9)
      returning
        id,
        company_id,
        branch_id,
        user_id,
        action,
        entity_type,
        entity_id,
        metadata,
        ip_address,
        user_agent,
        created_at::text
      `, [
            context.companyId,
            context.branchId ?? null,
            context.userId ?? null,
            action,
            entityType,
            entityId ?? null,
            JSON.stringify(metadata ?? {}),
            context.ipAddress ?? null,
            context.userAgent ?? null,
        ]);
        return result.rows[0];
    }
    async listAuditLogs(companyId, filters, scope) {
        const values = [companyId];
        const conditions = ['company_id = $1'];
        if (scope?.branchId) {
            values.push(scope.branchId);
            conditions.push(`branch_id = $${values.length}`);
        }
        if (filters?.branchId) {
            values.push(filters.branchId);
            conditions.push(`branch_id = $${values.length}`);
        }
        if (filters?.userId) {
            values.push(filters.userId);
            conditions.push(`user_id = $${values.length}`);
        }
        if (filters?.entityType) {
            values.push(filters.entityType);
            conditions.push(`entity_type = $${values.length}`);
        }
        if (filters?.action) {
            values.push(filters.action);
            conditions.push(`action = $${values.length}`);
        }
        if (filters?.fromAt) {
            values.push(filters.fromAt);
            conditions.push(`created_at >= $${values.length}::timestamptz`);
        }
        if (filters?.toAt) {
            values.push(filters.toAt);
            conditions.push(`created_at <= $${values.length}::timestamptz`);
        }
        const limit = Math.min(500, Math.max(1, filters?.limit ?? 100));
        values.push(limit);
        const result = await pool.query(`
      select
        id,
        company_id,
        branch_id,
        user_id,
        action,
        entity_type,
        entity_id,
        metadata,
        ip_address,
        user_agent,
        created_at::text
      from audit_logs
      where ${conditions.join(' and ')}
      order by created_at desc
      limit $${values.length}
      `, values);
        return result.rows;
    }
    async getAuditLogById(id) {
        const result = await pool.query(`
      select
        id,
        company_id,
        branch_id,
        user_id,
        action,
        entity_type,
        entity_id,
        metadata,
        ip_address,
        user_agent,
        created_at::text
      from audit_logs
      where id = $1
      limit 1
      `, [id]);
        return result.rows[0] ?? null;
    }
}
