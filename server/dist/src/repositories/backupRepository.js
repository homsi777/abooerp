import { pool } from '../db/pool.js';
export class BackupRepository {
    async createRestoreExecutionToken(companyId, backupId, tokenHash, expiresAtIso, createdBy) {
        const result = await pool.query(`
      insert into restore_execution_tokens(company_id, backup_id, token_hash, expires_at, created_by)
      values($1, $2, $3, $4::timestamptz, $5)
      returning id, expires_at::text
      `, [companyId, backupId, tokenHash, expiresAtIso, createdBy]);
        return result.rows[0];
    }
    async consumeRestoreExecutionToken(companyId, backupId, tokenHash) {
        const result = await pool.query(`
      update restore_execution_tokens
      set used_at = now()
      where company_id = $1
        and backup_id = $2
        and token_hash = $3
        and used_at is null
        and expires_at > now()
      `, [companyId, backupId, tokenHash]);
        return (result.rowCount ?? 0) > 0;
    }
    async cleanupExpiredRestoreExecutionTokens(companyId) {
        await pool.query(`
      delete from restore_execution_tokens
      where company_id = $1
        and (expires_at <= now() or used_at is not null)
      `, [companyId]);
    }
    async listBackups(companyId, includeFailed = true) {
        const result = await pool.query(`
      select
        id, company_id, branch_id, backup_code, backup_type, scope, status, file_name, file_path,
        size_bytes, checksum_sha256, is_stub, error_message, created_by, restored_by, restored_at::text,
        metadata, created_at::text, updated_at::text
      from backup_records
      where company_id = $1
        and ($2::boolean = true or status <> 'failed')
      order by created_at desc
      `, [companyId, includeFailed]);
        return result.rows;
    }
    async getBackupById(id, companyId) {
        const result = await pool.query(`
      select
        id, company_id, branch_id, backup_code, backup_type, scope, status, file_name, file_path,
        size_bytes, checksum_sha256, is_stub, error_message, created_by, restored_by, restored_at::text,
        metadata, created_at::text, updated_at::text
      from backup_records
      where id = $1 and company_id = $2
      limit 1
      `, [id, companyId]);
        return result.rows[0] ?? null;
    }
    async createBackup(companyId, input) {
        const result = await pool.query(`
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
      `, [
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
        ]);
        return result.rows[0];
    }
    async updateBackup(id, companyId, input) {
        const result = await pool.query(`
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
      `, [
            id,
            companyId,
            input.status ?? null,
            input.size_bytes ?? null,
            input.checksum_sha256 ?? null,
            input.is_stub ?? null,
            input.error_message ?? null,
            input.metadata ? JSON.stringify(input.metadata) : null,
        ]);
        return result.rows[0] ?? null;
    }
    async markRestored(id, companyId, restoredBy, metadata) {
        const result = await pool.query(`
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
      `, [id, companyId, restoredBy, metadata ? JSON.stringify(metadata) : null]);
        return result.rows[0] ?? null;
    }
    async getLatestBackup(companyId) {
        const result = await pool.query(`
      select
        id, company_id, branch_id, backup_code, backup_type, scope, status, file_name, file_path,
        size_bytes, checksum_sha256, is_stub, error_message, created_by, restored_by, restored_at::text,
        metadata, created_at::text, updated_at::text
      from backup_records
      where company_id = $1
      order by created_at desc
      limit 1
      `, [companyId]);
        return result.rows[0] ?? null;
    }
}
