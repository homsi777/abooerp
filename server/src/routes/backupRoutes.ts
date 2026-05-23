import { Router } from 'express';
import { z } from 'zod';
import { requirePermissions } from '../middleware/authorization.js';
import { asyncHandler } from '../utils/http.js';
import { HttpError } from '../utils/errors.js';
import { BackupService, RestoreBlockedError } from '../services/backupService.js';
import { AuditService } from '../services/auditService.js';
import { requireIdempotencyKey } from '../middleware/idempotency.js';

function requireCompanyId(req: any): string {
  const companyId = req.requestUserContext?.companyId as string | undefined;
  if (!companyId) throw new HttpError(403, 'Company scope is required.');
  return companyId;
}

const createBackupSchema = z.object({
  backupType: z.enum(['manual', 'scheduled', 'before_update']).optional(),
  scope: z.string().optional(),
  branchId: z.string().uuid().optional(),
  notes: z.string().max(1000).optional(),
});

const restoreSchema = z.object({
  confirmBackupCode: z.string().min(3),
  dryRun: z.boolean().optional(),
  executionToken: z.string().min(12).optional(),
});

const policySchema = z.object({
  autoEnabled: z.boolean(),
  intervalHours: z.number().int().min(1).max(168),
  retentionDays: z.number().int().min(1).max(365),
  verifyAfterCreate: z.boolean(),
});

function parseBoolFlag(value: unknown): boolean {
  if (typeof value !== 'string') return false;
  return value === '1' || value.toLowerCase() === 'true';
}

export function createBackupRouter(backupService: BackupService) {
  const router = Router();
  const auditService = new AuditService();

  router.get(
    '/backups',
    requirePermissions(['settings.backup.read']),
    asyncHandler(async (req, res) => {
      const companyId = requireCompanyId(req);
      const includeFailed = req.query.includeFailed === undefined ? true : parseBoolFlag(req.query.includeFailed);
      const data = await backupService.listBackups(companyId, includeFailed);
      res.json({ success: true, data });
    })
  );

  router.get(
    '/backups/:id',
    requirePermissions(['settings.backup.read']),
    asyncHandler(async (req, res) => {
      const companyId = requireCompanyId(req);
      const data = await backupService.getBackupById(String(req.params.id), companyId);
      if (!data) {
        res.status(404).json({ success: false, error: 'Backup not found.' });
        return;
      }
      res.json({ success: true, data });
    })
  );

  router.post(
    '/backups',
    requirePermissions(['settings.backup.write']),
    requireIdempotencyKey('backup.create'),
    asyncHandler(async (req, res) => {
      const companyId = requireCompanyId(req);
      const userId = (req as any).requestUserContext?.userId as string | undefined;
      const payload = createBackupSchema.parse(req.body ?? {});
      const data = await backupService.createBackup(companyId, userId ?? null, payload);
      auditService.logAsync({
        req,
        action: 'BACKUP_CREATED',
        entityType: 'backup',
        entityId: data.id,
        metadata: {
          backupCode: data.backup_code,
          status: data.status,
          isStub: data.is_stub,
        },
      });
      res.status(201).json({ success: true, data });
    })
  );

  router.post(
    '/backups/:id/verify',
    requirePermissions(['settings.backup.write']),
    requireIdempotencyKey('backup.verify'),
    asyncHandler(async (req, res) => {
      const companyId = requireCompanyId(req);
      const data = await backupService.verifyBackup(companyId, String(req.params.id));
      auditService.logAsync({
        req,
        action: 'BACKUP_VERIFIED',
        entityType: 'backup',
        entityId: data.id,
        metadata: {
          backupCode: data.backup_code,
          status: data.status,
        },
      });
      res.json({ success: true, data });
    })
  );

  router.post(
    '/backups/:id/restore-token',
    requirePermissions(['settings.backup.write']),
    requireIdempotencyKey('backup.restore-token'),
    asyncHandler(async (req, res) => {
      const companyId = requireCompanyId(req);
      const userId = (req as any).requestUserContext?.userId as string | undefined;
      const data = await backupService.issueRestoreExecutionToken(companyId, String(req.params.id), userId ?? null);
      auditService.logAsync({
        req,
        action: 'BACKUP_RESTORE_TOKEN_ISSUED',
        entityType: 'backup',
        entityId: String(req.params.id),
        metadata: {
          expiresAt: data.expiresAt,
        },
      });
      res.json({ success: true, data });
    })
  );

  router.get(
    '/backups/:id/restore-readiness',
    requirePermissions(['settings.backup.read']),
    asyncHandler(async (req, res) => {
      const companyId = requireCompanyId(req);
      const backup = await backupService.getBackupById(String(req.params.id), companyId);
      if (!backup) {
        res.status(404).json({ success: false, error: 'Backup not found.' });
        return;
      }
      const data = await backupService.getRestoreReadiness(companyId, backup);
      res.json({ success: true, data });
    })
  );

  router.post(
    '/backups/:id/restore',
    requirePermissions(['settings.backup.write']),
    requireIdempotencyKey('backup.restore'),
    asyncHandler(async (req, res) => {
      const companyId = requireCompanyId(req);
      const userId = (req as any).requestUserContext?.userId as string | undefined;
      const payload = restoreSchema.parse(req.body ?? {});
      try {
        const result = await backupService.restoreBackup(companyId, String(req.params.id), userId ?? null, payload);
        auditService.logAsync({
          req,
          action: payload.dryRun ?? true ? 'BACKUP_RESTORE_VALIDATED' : 'BACKUP_RESTORE_EXECUTED',
          entityType: 'backup',
          entityId: result.restored.id,
          metadata: {
            backupCode: result.restored.backup_code,
            dryRun: payload.dryRun ?? true,
            status: result.restored.status,
            restoreMode: result.restoreMode,
            environmentSnapshot: result.readiness.environmentSnapshot,
          },
        });
        res.json({ success: true, data: result });
      } catch (error) {
        if (error instanceof RestoreBlockedError) {
          auditService.logAsync({
            req,
            action: 'BACKUP_RESTORE_BLOCKED',
            entityType: 'backup',
            entityId: String(req.params.id),
            metadata: {
              dryRun: payload.dryRun ?? true,
              blockers: error.blockers,
            },
          });
          throw error;
        }
        throw error;
      }
    })
  );

  router.get(
    '/backup-policy',
    requirePermissions(['settings.backup.read']),
    asyncHandler(async (req, res) => {
      const companyId = requireCompanyId(req);
      const data = await backupService.getBackupPolicy(companyId);
      res.json({ success: true, data });
    })
  );

  router.put(
    '/backup-policy',
    requirePermissions(['settings.backup.write']),
    requireIdempotencyKey('backup.policy.update'),
    asyncHandler(async (req, res) => {
      const companyId = requireCompanyId(req);
      const payload = policySchema.parse(req.body ?? {});
      const data = await backupService.updateBackupPolicy(companyId, payload);
      auditService.logAsync({
        req,
        action: 'BACKUP_POLICY_UPDATED',
        entityType: 'backup_policy',
        metadata: payload,
      });
      res.json({ success: true, data });
    })
  );

  router.get(
    '/backup/diagnostics',
    requirePermissions(['settings.backup.read']),
    asyncHandler(async (req, res) => {
      const companyId = requireCompanyId(req);
      const data = await backupService.getDiagnostics(companyId);
      res.json({ success: true, data });
    })
  );

  return router;
}
