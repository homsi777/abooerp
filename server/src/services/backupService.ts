import { createHash, randomBytes } from 'node:crypto';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { z } from 'zod';
import { env } from '../config/env.js';
import { HttpError } from '../utils/errors.js';
import { BackupRepository, type BackupRecord } from '../repositories/backupRepository.js';
import { SystemSettingsService } from './systemSettingsService.js';
import { pool } from '../db/pool.js';

const backupTypeSchema = z.enum(['manual', 'scheduled', 'before_update']);

const createBackupSchema = z.object({
  backupType: backupTypeSchema.default('manual'),
  scope: z.string().trim().min(1).max(120).default('company'),
  branchId: z.string().uuid().optional(),
  notes: z.string().max(1000).optional(),
});

const restoreBackupSchema = z.object({
  confirmBackupCode: z.string().min(3),
  dryRun: z.boolean().default(true),
  executionToken: z.string().min(12).optional(),
});

export interface RestoreBlocker {
  code:
    | 'maintenance_mode_required'
    | 'active_sessions_detected'
    | 'open_operations_detected'
    | 'environment_mismatch'
    | 'active_db_writes_detected'
    | 'pool_write_mode_detected'
    | 'execution_token_required'
    | 'invalid_execution_token'
    | 'stub_backup_execution_blocked';
  message: string;
  details?: Record<string, unknown>;
}

export interface RestoreReadinessStatus {
  ready: boolean;
  blockers: RestoreBlocker[];
  stats: {
    activeSessions: number;
    openFinancialOps: number;
    openInventoryOps: number;
    activeDbWriteTransactions: number;
    poolBusyCount: number;
  };
  environmentSnapshot: {
    companyId: string;
    runtimeEnvironment: string;
    databaseName: string;
    maintenanceMode: boolean;
  };
}

export class RestoreBlockedError extends HttpError {
  constructor(
    message: string,
    public readonly blockers: RestoreBlocker[],
  ) {
    super(409, message);
  }
}

function execCommand(command: string, args: string[], extraEnv?: Record<string, string>) {
  return new Promise<{ ok: boolean; stdout: string; stderr: string; errorCode?: number }>((resolve) => {
    const child = spawn(command, args, {
      env: {
        ...process.env,
        ...extraEnv,
      },
      windowsHide: true,
    });

    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (chunk) => {
      stdout += String(chunk);
    });
    child.stderr.on('data', (chunk) => {
      stderr += String(chunk);
    });

    let settled = false;
    const complete = (payload: { ok: boolean; stdout: string; stderr: string; errorCode?: number }) => {
      if (settled) return;
      settled = true;
      resolve(payload);
    };

    child.on('error', () => {
      complete({ ok: false, stdout, stderr: `${stderr}\n${command} not available in PATH.`.trim(), errorCode: -1 });
    });

    child.on('close', (code) => {
      complete({ ok: code === 0, stdout, stderr, errorCode: code ?? undefined });
    });
  });
}

async function sha256File(filePath: string): Promise<string> {
  const data = await fs.readFile(filePath);
  return createHash('sha256').update(data).digest('hex');
}

export class BackupService {
  private readonly backupsRoot = path.resolve(process.cwd(), 'server', 'backups');

  constructor(
    private readonly repository = new BackupRepository(),
    private readonly settingsService = new SystemSettingsService()
  ) {}

  private async ensureBackupDirectory(companyId: string) {
    const directory = path.join(this.backupsRoot, companyId);
    await fs.mkdir(directory, { recursive: true });
    return directory;
  }

  private getConnectionEnv() {
    return {
      PGHOST: env.PGHOST,
      PGPORT: String(env.PGPORT),
      PGDATABASE: env.PGDATABASE,
      PGUSER: env.PGUSER,
      PGPASSWORD: env.PGPASSWORD,
    };
  }

  private async createStubBackup(filePath: string, metadata: Record<string, unknown>) {
    await fs.writeFile(filePath, JSON.stringify(metadata, null, 2), 'utf8');
  }

  private hashExecutionToken(token: string): string {
    return createHash('sha256').update(token).digest('hex');
  }

  private async buildEnvironmentSnapshot(companyId: string) {
    const runtimeConfig = await this.settingsService.getRuntimeConfig(companyId);
    return {
      companyId,
      runtimeEnvironment: String(runtimeConfig.environment),
      databaseName: env.PGDATABASE,
      maintenanceMode: Boolean((runtimeConfig as any).maintenanceMode),
    };
  }

  private async countActiveSessions(companyId: string): Promise<number> {
    const result = await pool.query<{ count: string }>(
      `
      select count(*)::text as count
      from auth_sessions s
      join users u on u.id = s.user_id
      where u.company_id = $1
        and s.revoked_at is null
        and s.expires_at > now()
      `,
      [companyId]
    );
    return Number(result.rows[0]?.count ?? 0);
  }

  private async countOpenFinancialOps(companyId: string): Promise<number> {
    const result = await pool.query<{ count: string }>(
      `
      with company_branches as (
        select id from branches where company_id = $1
      )
      select (
        (select count(*) from receipt_vouchers rv where rv.status = 'draft' and rv.branch_id in (select id from company_branches))
        +
        (select count(*) from payment_vouchers pv where pv.status = 'draft' and pv.branch_id in (select id from company_branches))
      )::text as count
      `,
      [companyId]
    );
    return Number(result.rows[0]?.count ?? 0);
  }

  private async countOpenInventoryOps(companyId: string): Promise<number> {
    const result = await pool.query<{ count: string }>(
      `
      with company_branches as (
        select id from branches where company_id = $1
      )
      select (
        (select count(*) from shipments s where s.branch_id in (select id from company_branches) and s.status in ('created', 'in_transit', 'manifested'))
        +
        (select count(*) from manifests m where m.branch_id in (select id from company_branches) and m.status in ('created', 'dispatched'))
        +
        (select count(*) from deliveries d where d.branch_id in (select id from company_branches) and d.status = 'pending')
      )::text as count
      `,
      [companyId]
    );
    return Number(result.rows[0]?.count ?? 0);
  }

  private async countActiveDbWrites(): Promise<number> {
    const result = await pool.query<{ count: string }>(
      `
      select count(*)::text as count
      from pg_stat_activity
      where datname = current_database()
        and pid <> pg_backend_pid()
        and state = 'active'
        and query ~* '\\m(insert|update|delete|alter|create|drop|truncate|grant|revoke)\\M'
      `
    );
    return Number(result.rows[0]?.count ?? 0);
  }

  async getRestoreReadiness(companyId: string, backupRecord?: BackupRecord | null): Promise<RestoreReadinessStatus> {
    const [environmentSnapshot, activeSessions, openFinancialOps, openInventoryOps, activeDbWriteTransactions] =
      await Promise.all([
        this.buildEnvironmentSnapshot(companyId),
        this.countActiveSessions(companyId),
        this.countOpenFinancialOps(companyId),
        this.countOpenInventoryOps(companyId),
        this.countActiveDbWrites(),
      ]);
    const poolBusyCount = Math.max(pool.totalCount - pool.idleCount, 0);
    const blockers: RestoreBlocker[] = [];

    if (!environmentSnapshot.maintenanceMode) {
      blockers.push({
        code: 'maintenance_mode_required',
        message: 'Real restore execution requires runtime maintenance mode.',
      });
    }
    if (activeSessions > 0) {
      blockers.push({
        code: 'active_sessions_detected',
        message: 'Active user sessions detected. Revoke sessions before restore.',
        details: { activeSessions },
      });
    }
    if (openFinancialOps + openInventoryOps > 0) {
      blockers.push({
        code: 'open_operations_detected',
        message: 'Open financial/inventory operations detected. Close in-progress activity first.',
        details: { openFinancialOps, openInventoryOps },
      });
    }
    if (activeDbWriteTransactions > 0) {
      blockers.push({
        code: 'active_db_writes_detected',
        message: 'Database has active write transactions.',
        details: { activeDbWriteTransactions },
      });
    }
    if (poolBusyCount > 1) {
      blockers.push({
        code: 'pool_write_mode_detected',
        message: 'Application connection pool is busy with active work.',
        details: { poolBusyCount },
      });
    }

    if (backupRecord) {
      const backupSnapshot = (backupRecord.metadata?.environmentSnapshot ?? {}) as Record<string, unknown>;
      const backupCompanyId = String(backupSnapshot.companyId ?? '');
      const backupEnvironment = String(backupSnapshot.runtimeEnvironment ?? '');
      if (
        (backupCompanyId && backupCompanyId !== environmentSnapshot.companyId) ||
        (backupEnvironment && backupEnvironment !== environmentSnapshot.runtimeEnvironment)
      ) {
        blockers.push({
          code: 'environment_mismatch',
          message: 'Backup metadata does not match current company/environment runtime.',
          details: {
            backupCompanyId,
            backupEnvironment,
            targetCompanyId: environmentSnapshot.companyId,
            targetEnvironment: environmentSnapshot.runtimeEnvironment,
          },
        });
      }
    }

    return {
      ready: blockers.length === 0,
      blockers,
      stats: {
        activeSessions,
        openFinancialOps,
        openInventoryOps,
        activeDbWriteTransactions,
        poolBusyCount,
      },
      environmentSnapshot,
    };
  }

  async issueRestoreExecutionToken(companyId: string, backupId: string, createdBy: string | null): Promise<{ token: string; expiresAt: string }> {
    const backup = await this.repository.getBackupById(backupId, companyId);
    if (!backup) throw new HttpError(404, 'Backup not found.');
    await this.repository.cleanupExpiredRestoreExecutionTokens(companyId);
    const token = randomBytes(24).toString('hex');
    const tokenHash = this.hashExecutionToken(token);
    const expires = new Date(Date.now() + 10 * 60 * 1000);
    const created = await this.repository.createRestoreExecutionToken(
      companyId,
      backupId,
      tokenHash,
      expires.toISOString(),
      createdBy
    );
    return { token, expiresAt: created.expires_at };
  }

  async listBackups(companyId: string, includeFailed = true) {
    return this.repository.listBackups(companyId, includeFailed);
  }

  async getBackupById(id: string, companyId: string) {
    return this.repository.getBackupById(id, companyId);
  }

  async createBackup(companyId: string, userId: string | null, payload: unknown): Promise<BackupRecord> {
    const input = createBackupSchema.parse(payload);
    const directory = await this.ensureBackupDirectory(companyId);
    const stamp = new Date().toISOString().replace(/[-:.TZ]/g, '').slice(0, 14);
    const backupCode = `BKP-${stamp}-${Math.floor(1000 + Math.random() * 9000)}`;
    const fileName = `${backupCode}.dump`;
    const filePath = path.join(directory, fileName);

    const environmentSnapshot = await this.buildEnvironmentSnapshot(companyId);
    const created = await this.repository.createBackup(companyId, {
      branch_id: input.branchId ?? null,
      backup_code: backupCode,
      backup_type: input.backupType,
      scope: input.scope,
      status: 'creating',
      file_name: fileName,
      file_path: filePath,
      created_by: userId,
      metadata: {
        notes: input.notes ?? null,
        environmentSnapshot,
      },
    });

    const pgDumpResult = await execCommand(
      process.platform === 'win32' ? 'pg_dump.exe' : 'pg_dump',
      ['--format=custom', '--file', filePath, env.PGDATABASE],
      this.getConnectionEnv()
    );

    if (!pgDumpResult.ok) {
      await this.createStubBackup(filePath, {
        backupCode,
        generatedAt: new Date().toISOString(),
        companyId,
        mode: 'stub',
        reason: pgDumpResult.stderr || 'pg_dump unavailable',
        environmentSnapshot,
      });
    }

    const stat = await fs.stat(filePath);
    const checksum = await sha256File(filePath);

    const updated = await this.repository.updateBackup(created.id, companyId, {
      status: 'ready',
      size_bytes: Number(stat.size),
      checksum_sha256: checksum,
      is_stub: !pgDumpResult.ok,
      error_message: pgDumpResult.ok ? null : `pg_dump unavailable, fallback stub generated`,
      metadata: {
        ...(created.metadata ?? {}),
        commandResult: pgDumpResult.ok ? 'pg_dump' : 'stub',
      },
    });

    if (!updated) {
      throw new HttpError(500, 'Failed to finalize backup record.');
    }
    return updated;
  }

  async verifyBackup(companyId: string, backupId: string): Promise<BackupRecord> {
    const record = await this.repository.getBackupById(backupId, companyId);
    if (!record) throw new HttpError(404, 'Backup not found.');

    const fileExists = await fs
      .access(record.file_path)
      .then(() => true)
      .catch(() => false);

    if (!fileExists) {
      const failed = await this.repository.updateBackup(record.id, companyId, {
        status: 'failed',
        error_message: 'Backup file not found on disk.',
      });
      throw new HttpError(400, failed?.error_message ?? 'Backup file not found.');
    }

    const stat = await fs.stat(record.file_path);
    const checksum = await sha256File(record.file_path);
    if (record.checksum_sha256 && record.checksum_sha256 !== checksum) {
      const failed = await this.repository.updateBackup(record.id, companyId, {
        status: 'failed',
        error_message: 'Checksum mismatch detected.',
      });
      throw new HttpError(400, failed?.error_message ?? 'Checksum mismatch.');
    }

    const updated = await this.repository.updateBackup(record.id, companyId, {
      status: 'ready',
      size_bytes: Number(stat.size),
      checksum_sha256: checksum,
      error_message: null,
    });
    if (!updated) throw new HttpError(500, 'Failed to update backup verification state.');
    return updated;
  }

  async restoreBackup(companyId: string, backupId: string, userId: string | null, payload: unknown) {
    const input = restoreBackupSchema.parse(payload);
    const record = await this.repository.getBackupById(backupId, companyId);
    if (!record) throw new HttpError(404, 'Backup not found.');
    if (record.status === 'creating' || record.status === 'restoring') {
      throw new HttpError(409, 'Backup is busy and cannot be restored right now.');
    }
    if (record.backup_code !== input.confirmBackupCode) {
      throw new HttpError(400, 'Restore confirmation code does not match backup code.');
    }

    await this.verifyBackup(companyId, backupId);
    const readiness = await this.getRestoreReadiness(companyId, record);

    if (!input.dryRun && record.is_stub) {
      throw new RestoreBlockedError('Real restore execution is blocked for stub backups.', [
        {
          code: 'stub_backup_execution_blocked',
          message: 'This backup was generated in stub mode and cannot run pg_restore.',
        },
      ]);
    }

    if (!input.dryRun && !readiness.ready) {
      throw new RestoreBlockedError('Restore execution is blocked by safety controls.', readiness.blockers);
    }

    if (!input.dryRun) {
      if (!input.executionToken) {
        throw new RestoreBlockedError('Restore execution token is required.', [
          {
            code: 'execution_token_required',
            message: 'Execution restore token is required for real restore execution.',
          },
        ]);
      }
      const consumed = await this.repository.consumeRestoreExecutionToken(
        companyId,
        record.id,
        this.hashExecutionToken(input.executionToken)
      );
      if (!consumed) {
        throw new RestoreBlockedError('Restore execution token is invalid or expired.', [
          {
            code: 'invalid_execution_token',
            message: 'Execution restore token is invalid, expired, or already used.',
          },
        ]);
      }
    }

    if (!input.dryRun && !record.is_stub) {
      await this.repository.updateBackup(record.id, companyId, { status: 'restoring', error_message: null });
      const restoreResult = await execCommand(
        process.platform === 'win32' ? 'pg_restore.exe' : 'pg_restore',
        ['--clean', '--if-exists', '--no-owner', '--dbname', env.PGDATABASE, record.file_path],
        this.getConnectionEnv()
      );

      if (!restoreResult.ok) {
        await this.repository.updateBackup(record.id, companyId, {
          status: 'failed',
          error_message: restoreResult.stderr || 'pg_restore failed',
        });
        throw new HttpError(500, 'Restore execution failed.');
      }
    }

    const restored = await this.repository.markRestored(record.id, companyId, userId, {
      ...(record.metadata ?? {}),
      restoreMode: input.dryRun ? 'dry-run' : record.is_stub ? 'stub-replay' : 'pg_restore',
      restoreEnvironmentSnapshot: readiness.environmentSnapshot,
    });
    if (!restored) throw new HttpError(500, 'Failed to finalize restore metadata.');
    return {
      restored,
      readiness,
      restoreMode: input.dryRun ? 'dry-run' : record.is_stub ? 'stub-replay' : 'pg_restore',
    };
  }

  async getBackupPolicy(companyId: string) {
    const all = await this.settingsService.listSettings(companyId);
    return {
      autoEnabled: Boolean(all['backup.autoEnabled']),
      intervalHours: Number(all['backup.intervalHours']),
      retentionDays: Number(all['backup.retentionDays']),
      verifyAfterCreate: Boolean(all['backup.verifyAfterCreate']),
    };
  }

  async updateBackupPolicy(companyId: string, payload: unknown) {
    const schema = z.object({
      autoEnabled: z.boolean(),
      intervalHours: z.number().int().min(1).max(168),
      retentionDays: z.number().int().min(1).max(365),
      verifyAfterCreate: z.boolean(),
    });
    const input = schema.parse(payload);
    await this.settingsService.setSetting(companyId, 'backup.autoEnabled', input.autoEnabled);
    await this.settingsService.setSetting(companyId, 'backup.intervalHours', input.intervalHours);
    await this.settingsService.setSetting(companyId, 'backup.retentionDays', input.retentionDays);
    await this.settingsService.setSetting(companyId, 'backup.verifyAfterCreate', input.verifyAfterCreate);
    return this.getBackupPolicy(companyId);
  }

  async getDiagnostics(companyId: string) {
    const latest = await this.repository.getLatestBackup(companyId);
    const policy = await this.getBackupPolicy(companyId);
    const directory = await this.ensureBackupDirectory(companyId);
    const toolCheck = await execCommand(process.platform === 'win32' ? 'pg_dump.exe' : 'pg_dump', ['--version']);

    const readiness = await this.getRestoreReadiness(companyId, latest);
    return {
      latestBackupAt: latest?.created_at ?? null,
      latestBackupStatus: latest?.status ?? 'none',
      latestBackupCode: latest?.backup_code ?? null,
      backupDirectory: directory,
      pgDumpAvailable: toolCheck.ok,
      retentionDays: policy.retentionDays,
      autoEnabled: policy.autoEnabled,
      restoreReadiness: readiness,
    };
  }
}
