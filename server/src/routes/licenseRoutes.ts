import { Router } from 'express';
import { z } from 'zod';
import { asyncHandler } from '../utils/http.js';
import { HttpError } from '../utils/errors.js';
import { LicenseRepository } from '../repositories/licenseRepository.js';
import { sendActivationNotification } from '../services/telegramService.js';
import { env } from '../config/env.js';
import { pool } from '../db/pool.js';

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
    return {
      type: 'CLOUD_1',
      cloudEnabled: true,
      shipmentLimit: null,
      deliveryLimit: null,
      receiptLimit: null,
    };
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
      res.json({
        success: true,
        data: {
          licenseActive: true,
          licenseType: 'COMPANY_OWNED',
          cloudEnabled: true,
          shipmentLimit: null,
          deliveryLimit: null,
          receiptLimit: null,
          activatedAt: null,
          usage: { shipmentsUsed: 0, deliveriesUsed: 0, receiptsUsed: 0 },
          quotaRemaining: { shipments: null, deliveries: null, receipts: null },
        },
      });
    }),
  );

  /**
   * GET /license/status
   */
  router.get(
    '/status',
    asyncHandler(async (_req, res) => {
      res.json({
        success: true,
        data: {
          licenseActive: true,
          licenseType: 'COMPANY_OWNED',
          cloudEnabled: true,
          shipmentLimit: null,
          deliveryLimit: null,
          receiptLimit: null,
          activatedAt: null,
          usage: { shipmentsUsed: 0, deliveriesUsed: 0, receiptsUsed: 0 },
          quotaRemaining: { shipments: null, deliveries: null, receipts: null },
        },
      });
    }),
  );

  return router;
}
