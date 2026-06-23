import { pool } from '../db/pool.js';
import type { DataScope } from '../utils/scope.js';

export interface AuditLogRecord {
  id: string;
  company_id: string;
  branch_id: string | null;
  user_id: string | null;
  action: string;
  entity_type: string;
  entity_id: string | null;
  metadata: Record<string, unknown>;
  ip_address: string | null;
  user_agent: string | null;
  created_at: string;
}

/** سجل أحداث موسّع للمدير: أسماء مستخدم/فرع/وكيل */
export interface AuditLogEnrichedRecord extends AuditLogRecord {
  actor_display_name: string | null;
  actor_username: string | null;
  actor_role_code: string | null;
  branch_name: string | null;
  agent_profile_name: string | null;
}

export interface AuditLogFilters {
  fromAt?: string;
  toAt?: string;
  userId?: string;
  entityType?: string;
  action?: string;
  branchId?: string;
  limit?: number;
}

export interface AuditActivityUserSummary {
  user_id: string | null;
  actor_display_name: string | null;
  actor_username: string | null;
  actor_role_code: string | null;
  actor_user_type: string | null;
  agent_profile_name: string | null;
  total_events: number;
  created_count: number;
  updated_count: number;
  deleted_count: number;
  ledger_row_events: number;
  shipment_events: number;
  finance_events: number;
  last_event_at: string | null;
}

export interface AuditLogContext {
  companyId: string;
  branchId?: string;
  userId?: string;
  ipAddress?: string;
  userAgent?: string;
}

export class AuditRepository {
  async logEvent(
    context: AuditLogContext,
    action: string,
    entityType: string,
    entityId?: string,
    metadata?: Record<string, unknown>,
  ): Promise<AuditLogRecord> {
    const result = await pool.query<AuditLogRecord>(
      `
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
      `,
      [
        context.companyId,
        context.branchId ?? null,
        context.userId ?? null,
        action,
        entityType,
        entityId ?? null,
        JSON.stringify(metadata ?? {}),
        context.ipAddress ?? null,
        context.userAgent ?? null,
      ],
    );
    return result.rows[0];
  }

  async listAuditLogs(companyId: string, filters?: AuditLogFilters, scope?: DataScope): Promise<AuditLogRecord[]> {
    const values: unknown[] = [companyId];
    const conditions: string[] = ['company_id = $1'];

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

    const result = await pool.query<AuditLogRecord>(
      `
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
      `,
      values,
    );
    return result.rows;
  }

  async listAuditLogsEnriched(
    companyId: string,
    filters?: AuditLogFilters,
    scope?: DataScope,
  ): Promise<AuditLogEnrichedRecord[]> {
    const values: unknown[] = [companyId];
    const conditions: string[] = ['al.company_id = $1'];

    if (scope?.branchId) {
      values.push(scope.branchId);
      conditions.push(`al.branch_id = $${values.length}`);
    }
    if (filters?.branchId) {
      values.push(filters.branchId);
      conditions.push(`al.branch_id = $${values.length}`);
    }
    if (filters?.userId) {
      values.push(filters.userId);
      conditions.push(`al.user_id = $${values.length}`);
    }
    if (filters?.entityType) {
      values.push(filters.entityType);
      conditions.push(`al.entity_type = $${values.length}`);
    }
    if (filters?.action) {
      values.push(filters.action);
      conditions.push(`al.action = $${values.length}`);
    }
    if (filters?.fromAt) {
      values.push(filters.fromAt);
      conditions.push(`al.created_at >= $${values.length}::timestamptz`);
    }
    if (filters?.toAt) {
      values.push(filters.toAt);
      conditions.push(`al.created_at <= $${values.length}::timestamptz`);
    }

    const limit = Math.min(500, Math.max(1, filters?.limit ?? 200));
    values.push(limit);

    const result = await pool.query<AuditLogEnrichedRecord>(
      `
      select
        al.id,
        al.company_id,
        al.branch_id,
        al.user_id,
        al.action,
        al.entity_type,
        al.entity_id,
        al.metadata,
        al.ip_address,
        al.user_agent,
        al.created_at::text as created_at,
        coalesce(nullif(trim(coalesce(u.full_name, '')), ''), u.username) as actor_display_name,
        u.username as actor_username,
        u.role as actor_role_code,
        b.name as branch_name,
        ag.name as agent_profile_name
      from audit_logs al
      left join users u on u.id = al.user_id
      left join branches b on b.id = al.branch_id
      left join agents ag on ag.id = u.agent_id
      where ${conditions.join(' and ')}
      order by al.created_at desc
      limit $${values.length}
      `,
      values,
    );
    return result.rows;
  }

  async getAuditLogEnrichedById(companyId: string, id: string, scope?: DataScope): Promise<AuditLogEnrichedRecord | null> {
    const values: unknown[] = [companyId, id];
    const conditions = ['al.company_id = $1', 'al.id = $2'];
    if (scope?.branchId) {
      values.push(scope.branchId);
      conditions.push(`al.branch_id = $${values.length}`);
    }
    const result = await pool.query<AuditLogEnrichedRecord>(
      `
      select
        al.id,
        al.company_id,
        al.branch_id,
        al.user_id,
        al.action,
        al.entity_type,
        al.entity_id,
        al.metadata,
        al.ip_address,
        al.user_agent,
        al.created_at::text as created_at,
        coalesce(nullif(trim(coalesce(u.full_name, '')), ''), u.username) as actor_display_name,
        u.username as actor_username,
        u.role as actor_role_code,
        b.name as branch_name,
        ag.name as agent_profile_name
      from audit_logs al
      left join users u on u.id = al.user_id
      left join branches b on b.id = al.branch_id
      left join agents ag on ag.id = u.agent_id
      where ${conditions.join(' and ')}
      limit 1
      `,
      values,
    );
    return result.rows[0] ?? null;
  }

  async listActivitySummaryByUser(
    companyId: string,
    filters?: AuditLogFilters,
    scope?: DataScope,
  ): Promise<AuditActivityUserSummary[]> {
    const values: unknown[] = [companyId];
    const conditions: string[] = ['al.company_id = $1'];

    if (scope?.branchId) {
      values.push(scope.branchId);
      conditions.push(`al.branch_id = $${values.length}`);
    }
    if (filters?.branchId) {
      values.push(filters.branchId);
      conditions.push(`al.branch_id = $${values.length}`);
    }
    if (filters?.userId) {
      values.push(filters.userId);
      conditions.push(`al.user_id = $${values.length}`);
    }
    if (filters?.entityType) {
      values.push(filters.entityType);
      conditions.push(`al.entity_type = $${values.length}`);
    }
    if (filters?.action) {
      values.push(filters.action);
      conditions.push(`al.action = $${values.length}`);
    }
    if (filters?.fromAt) {
      values.push(filters.fromAt);
      conditions.push(`al.created_at >= $${values.length}::timestamptz`);
    }
    if (filters?.toAt) {
      values.push(filters.toAt);
      conditions.push(`al.created_at <= $${values.length}::timestamptz`);
    }

    const result = await pool.query<AuditActivityUserSummary>(
      `
      select
        al.user_id,
        coalesce(nullif(trim(coalesce(u.full_name, '')), ''), u.username) as actor_display_name,
        u.username as actor_username,
        u.role as actor_role_code,
        u.user_type as actor_user_type,
        ag.name as agent_profile_name,
        count(*)::int as total_events,
        count(*) filter (where al.action ~ 'CREATED$')::int as created_count,
        count(*) filter (where al.action ~ 'UPDATED$')::int as updated_count,
        count(*) filter (where al.action ~ 'DELETED$')::int as deleted_count,
        count(*) filter (where al.entity_type = 'daily_ledger_row')::int as ledger_row_events,
        count(*) filter (where al.entity_type = 'shipment')::int as shipment_events,
        count(*) filter (where al.entity_type in ('voucher', 'cashbox', 'journal_entry'))::int as finance_events,
        max(al.created_at)::text as last_event_at
      from audit_logs al
      left join users u on u.id = al.user_id
      left join agents ag on ag.id = u.agent_id
      where ${conditions.join(' and ')}
      group by al.user_id, u.full_name, u.username, u.role, u.user_type, ag.name
      order by max(al.created_at) desc nulls last, actor_display_name asc nulls last
      `,
      values,
    );
    return result.rows;
  }

  async getAuditLogById(id: string): Promise<AuditLogRecord | null> {
    const result = await pool.query<AuditLogRecord>(
      `
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
      `,
      [id],
    );
    return result.rows[0] ?? null;
  }
}
