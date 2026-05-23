import { Router } from 'express';
import { z } from 'zod';
import { requirePermissions } from '../middleware/authorization.js';
import { asyncHandler } from '../utils/http.js';
import { HttpError } from '../utils/errors.js';
import { ShippingLabelSettingsService } from '../services/shippingLabelSettingsService.js';
import { AuditService } from '../services/auditService.js';

function requireCompanyId(req: any): string {
  const companyId = req.requestUserContext?.companyId as string | undefined;
  if (!companyId) throw new HttpError(403, 'Company scope is required.');
  return companyId;
}

const payloadSchema = z.object({
  fields: z.array(
    z.object({
      id: z.string(),
      label: z.string(),
      enabled: z.boolean(),
      order: z.number().int(),
    })
  ),
  layout: z.object({
    labelSize: z.string(),
    showBorder: z.boolean(),
    boldImportantFields: z.boolean(),
    largeTrackingNumber: z.boolean(),
    barcodeEnabled: z.boolean(),
    logoEnabled: z.boolean(),
    textAlign: z.string(),
    spacingDensity: z.string(),
  }),
});

export function createShippingLabelSettingsRouter(service: ShippingLabelSettingsService) {
  const router = Router();
  const auditService = new AuditService();

  router.get(
    '/shipping-label-settings',
    requirePermissions(['settings.shippingLabel.read']),
    asyncHandler(async (req, res) => {
      const companyId = requireCompanyId(req);
      const data = await service.get(companyId);
      res.json({ success: true, data });
    })
  );

  router.put(
    '/shipping-label-settings',
    requirePermissions(['settings.shippingLabel.write']),
    asyncHandler(async (req, res) => {
      const companyId = requireCompanyId(req);
      const userId = (req as any).requestUserContext?.userId as string | undefined;
      const payload = payloadSchema.parse(req.body ?? {});
      const data = await service.update(companyId, payload, userId ?? null);
      auditService.logAsync({
        req,
        action: 'SHIPPING_LABEL_SETTINGS_UPDATED',
        entityType: 'shipping_label_settings',
        metadata: {
          fieldCount: data.fields.length,
          labelSize: data.layout.labelSize,
        },
      });
      res.json({ success: true, data });
    })
  );

  router.get(
    '/shipping-label-settings/print-plan',
    requirePermissions(['settings.shippingLabel.read']),
    asyncHandler(async (req, res) => {
      const companyId = requireCompanyId(req);
      const branchId = (req as any).requestUserContext?.activeBranchId ?? null;
      const data = await service.getPrintPlan(companyId, branchId);
      auditService.logAsync({
        req,
        action: 'SHIPPING_LABEL_PRINT_PLAN_RESOLVED',
        entityType: 'shipping_label_settings',
        metadata: {
          hasPrinterRoute: Boolean(data.printerRoute),
          branchId,
        },
      });
      res.json({ success: true, data });
    })
  );

  return router;
}
