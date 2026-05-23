import { pool } from '../db/pool.js';

export interface BackupRecord {
  id: string;
  company_id: string;
  branch_id: string | null;
  backup_code: string;
  backup_type: 'manual' | 'scheduled' | 'before_update';
  scope: string;
  status: 'creating' | 'ready' | 'verifying' | 'failed' | 'restoring' | 'restored';
  file_name: string;
  file_path: string;
  size_bytes: number;
  checksum_sha256: string | null;
  is_stub: boolean;
  error_message: string | null;
  created_by: string | null;
  restored_by: string | null;
  restored_at: string | null;
  metadata: Record<string, unknown>;
  created_at: string;
  updated_at: string;
}

export interface CreateBackupRecordInput {
  branch_id?: string | null;
  backup_code: string;
  backup_type: BackupRecord['backup_type'];
  scope: string;
  status?: BackupRecord['status'];
  file_name: string;
  file_path: string;
  size_bytes?: number;
  checksum_sha256?: string | null;
  is_stub?: boolean;
  error_message?: string | null;
  created_by?: string | null;
  metadata?: Record<string, unknown>;
}

export interface UpdateBackupRecordInput {
  status?: BackupRecord['status'];
  size_bytes?: number;
  checksum_sha256?: string | null;
  is_stub?: boolean;
  error_message?: string | null;
  metadata?: Record<string, unknown>;
}

export class BackupRepository {
  async createRestoreExecutionToken(
    companyId: string,
    backupId: string,
    tokenHash: string,
    expiresAtIso: string,
    createdBy: string | null
  ): Promise<{ id: string; expires_at: string }> {
    const result = await pool.query<{ id: string; expires_at: string }>(
      `
      insert into restore_execution_tokens(company_id, backup_id, token_hash, expires_at, created_by)
      values($1, $2, $3, $4::timestamptz, $5)
      returning id, expires_at::text
      `,
      [companyId, backupId, tokenHash, expiresAtIso, createdBy]
    );
    return result.rows[0];
  }

  async consumeRestoreExecutionToken(companyId: string, backupId: string, tokenHash: string): Promise<boolean> {
    const result = await pool.query(
      `
      update restore_execution_tokens
      set used_at = now()
      where company_id = $1
        and backup_id = $2
        and token_hash = $3
        and used_at is null
        and expires_at > now()
      `,
      [companyId, backupId, tokenHash]
    );
    return (result.rowCount ?? 0) > 0;
  }

  async cleanupExpiredRestoreExecutionTokens(companyId: string): Promise<void> {
    await pool.query(
      `
      delete from restore_execution_tokens
      where company_id = $1
        and (expires_at <= now() or used_at is not null)
      `,
      [companyId]
    );
  }

  async listBackups(companyId: string, includeFailed = true): Promise<BackupRecord[]> {
    const result = await pool.query<BackupRecord>(
      `
      select
        id, company_id, branch_id, backup_code, backup_type, scope, status, file_name, file_path,
        size_bytes, checksum_sha256, is_stub, error_message, created_by, restored_by, restored_at::text,
        metadata, created_at::text, updated_at::text
      from backup_records
      where company_id = $1
        and ($2::boolean = true or status <> 'failed')
      order by created_at desc
      `,
      [companyId, includeFailed]
    );
    return result.rows;
  }

  async getBackupById(id: string, companyId: string): Promise<BackupRecord | null> {
    const result = await pool.query<BackupRecord>(
      `
      select
        id, company_id, branch_id, backup_code, backup_type, scope, status, file_name, file_path,
        size_bytes, checksum_sha256, is_stub, error_message, created_by, restored_by, restored_at::text,
        metadata, created_at::text, updated_at::text
      from backup_records
      where id = $1 and company_id = $2
      limit 1
      `,
      [id, companyId]
    );
    return result.rows[0] ?? null;
  }

  async createBackup(companyId: string, input: CreateBackupRecordInput): Promise<BackupRecord> {
    const result = await pool.query<BackupRecord>(
      `
      insert into backup_records(
        company_id, branch_id, backup_code, backup_type, scope, status, file_name, file_path,
        size_bytes, checksum_sha256, is_stub, error_message, created_by, metadata
      )
      values(
        $1, $2, $3, $4, $5, coalesce($6, 'creating'), $7, $8, coalesce($9, 0), $10, coalesce($11, false), $12, $13, coalesce($14::jsonb, '{}'::jsonb)
      )
      returning
        id, company_id, branch_id, backup_code, backup_type, scope, status, file_name, file_path,
        size_bytes, checksum_sha256, is_stub, error_message, created_by, restored_by, restored_at::text,
        metadata, created_at::text, updated_at::text
      `,
      [
        companyId,
        input.branch_id ?? null,
        input.backup_code,
        input.backup_type,
        input.scope,
        input.status ?? 'creating',
        input.file_name,
        input.file_path,
        input.size_bytes ?? 0,
        input.checksum_sha256 ?? null,
        input.is_stub ?? false,
        input.error_message ?? null,
        input.created_by ?? null,
        JSON.stringify(input.metadata ?? {}),
      ]
    );
    return result.rows[0];
  }

  async updateBackup(id: string, companyId: string, input: UpdateBackupRecordInput): Promise<BackupRecord | null> {
    const result = await pool.query<BackupRecord>(
      `
      update backup_records
      set
        status = coalesce($3, status),
        size_bytes = coalesce($4, size_bytes),
        checksum_sha256 = coalesce($5, checksum_sha256),
        is_stub = coalesce($6, is_stub),
        error_message = $7,
        metadata = coalesce($8::jsonb, metadata),
        updated_at = now()
      where id = $1 and company_id = $2
      returning
        id, company_id, branch_id, backup_code, backup_type, scope, status, file_name, file_path,
        size_bytes, checksum_sha256, is_stub, error_message, created_by, restored_by, restored_at::text,
        metadata, created_at::text, updated_at::text
      `,
      [
        id,
        companyId,
        input.status ?? null,
        input.size_bytes ?? null,
        input.checksum_sha256 ?? null,
        input.is_stub ?? null,
        input.error_message ?? null,
        input.metadata ? JSON.stringify(input.metadata) : null,
      ]
    );
    return result.rows[0] ?? null;
  }

  async markRestored(id: string, companyId: string, restoredBy: string | null, metadata?: Record<string, unknown>): Promise<BackupRecord | null> {
    const result = await pool.query<BackupRecord>(
      `
      update backup_records
      set
        status = 'restored',
        restored_by = $3,
        restored_at = now(),
        metadata = coalesce($4::jsonb, metadata),
        updated_at = now()
      where id = $1 and company_id = $2
      returning
        id, company_id, branch_id, backup_code, backup_type, scope, status, file_name, file_path,
        size_bytes, checksum_sha256, is_stub, error_message, created_by, restored_by, restored_at::text,
        metadata, created_at::text, updated_at::text
      `,
      [id, companyId, restoredBy, metadata ? JSON.stringify(metadata) : null]
    );
    return result.rows[0] ?? null;
  }

  async getLatestBackup(companyId: string): Promise<BackupRecord | null> {
    const result = await pool.query<BackupRecord>(
      `
      select
        id, company_id, branch_id, backup_code, backup_type, scope, status, file_name, file_path,
        size_bytes, checksum_sha256, is_stub, error_message, created_by, restored_by, restored_at::text,
        metadata, created_at::text, updated_at::text
      from backup_records
      where company_id = $1
      order by created_at desc
      limit 1
      `,
      [companyId]
    );
    return result.rows[0] ?? null;
  }
}
