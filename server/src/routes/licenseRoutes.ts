import { Router } from 'express';
import { z } from 'zod';
import { asyncHandler } from '../utils/http.js';
import { HttpError } from '../utils/errors.js';
import { LicenseRepository } from '../repositories/licenseRepository.js';
import { sendActivationNotification } from '../services/telegramService.js';

// ── License definition ────────────────────────────────────────────────────────
interface LicenseDef {
  type: string;
  cloudEnabled: boolean;
  shipmentLimit: number | null;
  deliveryLimit: number | null;
  receiptLimit: number | null;
}

/**
 * TEST1 is the universal trial key — intentionally public, no need to hide it.
 * Its value is its name: typing "TEST1" activates a 50-operation trial.
 */
const TEST1_DEF: LicenseDef = {
  type: 'TEST1',
  cloudEnabled: false,
  shipmentLimit: 50,
  deliveryLimit: 50,
  receiptLimit: 50,
};

/**
 * Real production keys are loaded from server/.env at runtime.
 * They never appear in source code.
 */
function resolveKeyDef(code: string): LicenseDef | null {
  if (code === 'TEST1') return TEST1_DEF;

  const localRaw = process.env.LICENSE_LOCAL_KEYS ?? '';
  const cloudRaw = process.env.LICENSE_CLOUD_KEYS ?? '';

  const localKeys = new Set(localRaw.split(',').map((k) => k.trim()).filter(Boolean));
  const cloudKeys = new Set(cloudRaw.split(',').map((k) => k.trim()).filter(Boolean));

  if (localKeys.has(code)) {
    return { type: 'LOCAL_1', cloudEnabled: false, shipmentLimit: null, deliveryLimit: null, receiptLimit: null };
  }
  if (cloudKeys.has(code)) {
    // CLOUD keys are stored but currently blocked — frontend should not send them
    return null;
  }
  return null;
}

const activateSchema = z.object({
  licenseCode: z.string()
    .trim()
    .toUpperCase()
    .refine(
      (code) => code === 'TEST1' || /^[A-Z0-9]{4}-[A-Z0-9]{4}-[A-Z0-9]{4}-[A-Z0-9]{4}$/.test(code),
      { message: 'كود التفعيل غير صالح' },
    ),
  machineId: z.string().optional(),
});

function buildQuotaRemaining(
  license: { shipmentLimit: number | null; deliveryLimit: number | null; receiptLimit: number | null },
  usage: { shipmentsUsed: number; deliveriesUsed: number; receiptsUsed: number },
) {
  return {
    shipments:  license.shipmentLimit  != null ? Math.max(0, license.shipmentLimit  - usage.shipmentsUsed)  : null,
    deliveries: license.deliveryLimit  != null ? Math.max(0, license.deliveryLimit  - usage.deliveriesUsed) : null,
    receipts:   license.receiptLimit   != null ? Math.max(0, license.receiptLimit   - usage.receiptsUsed)   : null,
  };
}

export function createLicenseRouter(repo: LicenseRepository) {
  const router = Router();

  /**
   * POST /license/activate
   * Accepts "TEST1" (plain trial key) or "XXXX-XXXX-XXXX-XXXX" (real key).
   * Works before login — falls back to the single company in pilot setups.
   */
  router.post(
    '/activate',
    asyncHandler(async (req, res) => {
      const { licenseCode, machineId } = activateSchema.parse(req.body);

      const def = resolveKeyDef(licenseCode);
      if (!def) throw new HttpError(400, 'INVALID_LICENSE_CODE');

      let companyId = (req as any).requestUserContext?.companyId as string | undefined;
      if (!companyId) companyId = (await repo.resolveDefaultCompanyId()) ?? undefined;
      if (!companyId) throw new HttpError(503, 'No company found in database');

      const record = await repo.activate({
        companyId,
        licenseCode,
        licenseType: def.type,
        machineId: machineId ?? null,
        cloudEnabled: def.cloudEnabled,
        shipmentLimit: def.shipmentLimit,
        deliveryLimit: def.deliveryLimit,
        receiptLimit: def.receiptLimit,
      });

      const usage = await repo.getUsage(companyId);

      // Fire activation Telegram notification (non-blocking, never fails the request)
      const deviceName = (req as any).requestUserContext?.deviceName as string | undefined;
      const ip = (req.headers['x-forwarded-for'] as string)?.split(',')[0]?.trim() ?? req.ip ?? undefined;
      void sendActivationNotification(companyId, {
        licenseType: record.licenseType,
        deviceName,
        ipAddress: ip,
        appVersion: '1.0.0',
      });

      res.json({
        success: true,
        data: {
          licenseType: record.licenseType,
          cloudEnabled: record.cloudEnabled,
          shipmentLimit: record.shipmentLimit,
          deliveryLimit: record.deliveryLimit,
          receiptLimit: record.receiptLimit,
          activatedAt: record.activatedAt,
          usage,
          quotaRemaining: buildQuotaRemaining(record, usage),
        },
      });
    }),
  );

  /**
   * GET /license/status
   */
  router.get(
    '/status',
    asyncHandler(async (req, res) => {
      let companyId = (req as any).requestUserContext?.companyId as string | undefined;
      if (!companyId) companyId = (await repo.resolveDefaultCompanyId()) ?? undefined;
      if (!companyId) {
        res.json({ success: true, data: { licenseActive: false } });
        return;
      }

      const license = await repo.findActiveByCompany(companyId);
      if (!license) {
        res.json({ success: true, data: { licenseActive: false } });
        return;
      }

      const usage = await repo.getUsage(companyId);
      res.json({
        success: true,
        data: {
          licenseActive: true,
          licenseType: license.licenseType,
          cloudEnabled: license.cloudEnabled,
          shipmentLimit: license.shipmentLimit,
          deliveryLimit: license.deliveryLimit,
          receiptLimit: license.receiptLimit,
          activatedAt: license.activatedAt,
          usage,
          quotaRemaining: buildQuotaRemaining(license, usage),
        },
      });
    }),
  );

  return router;
}
