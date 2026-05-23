import { Router } from 'express';
import { z } from 'zod';
import { requirePermissions } from '../middleware/authorization.js';
import { asyncHandler } from '../utils/http.js';
import { HttpError } from '../utils/errors.js';
import { SystemSettingsService } from '../services/systemSettingsService.js';
import { AuditService } from '../services/auditService.js';

function requireCompanyId(req: any): string {
  const companyId = req.requestUserContext?.companyId as string | undefined;
  if (!companyId) {
    throw new HttpError(403, 'Company scope is required.');
  }
  return companyId;
}

const updateSchema = z.object({
  value: z.unknown(),
  isEncrypted: z.boolean().optional(),
});

export function createSystemSettingsRouter(systemSettingsService: SystemSettingsService) {
  const router = Router();
  const auditService = new AuditService();

  router.get(
    '/',
    requirePermissions(['settings.system.read']),
    asyncHandler(async (req, res) => {
      const companyId = requireCompanyId(req);
      const data = await systemSettingsService.listSettings(companyId);
      res.json({ success: true, data: { settings: data } });
    })
  );

  router.get(
    '/:key',
    requirePermissions(['settings.system.read']),
    asyncHandler(async (req, res) => {
      const companyId = requireCompanyId(req);
      const key = String(req.params.key);
      const value = await systemSettingsService.getSetting(companyId, key);
      res.json({ success: true, data: { key, value } });
    })
  );

  router.put(
    '/:key',
    requirePermissions(['settings.system.write']),
    asyncHandler(async (req, res) => {
      const companyId = requireCompanyId(req);
      const key = String(req.params.key);
      const payload = updateSchema.parse(req.body);
      const updated = await systemSettingsService.setSetting(companyId, key, payload.value, payload.isEncrypted ?? false);
      auditService.logAsync({
        req,
        action: 'SYSTEM_SETTING_UPDATED',
        entityType: 'system_setting',
        entityId: updated.id,
        metadata: { key, isEncrypted: updated.isEncrypted },
      });
      res.json({ success: true, data: updated });
    })
  );

  router.delete(
    '/:key',
    requirePermissions(['settings.system.write']),
    asyncHandler(async (req, res) => {
      const companyId = requireCompanyId(req);
      const key = String(req.params.key);
      const removed = await systemSettingsService.deleteSetting(companyId, key);
      if (!removed) {
        res.status(404).json({ success: false, error: 'Setting not found.' });
        return;
      }
      auditService.logAsync({
        req,
        action: 'SYSTEM_SETTING_DELETED',
        entityType: 'system_setting',
        metadata: { key },
      });
      res.json({ success: true });
    })
  );

  return router;
}
