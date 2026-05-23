import { Router } from 'express';
import { pool } from '../db/pool.js';
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

export function createShippingPrintPlanRouter(service: ShippingLabelSettingsService) {
  const router = Router();
  const auditService = new AuditService();

  /**
   * GET /api/v1/shipping-labels/print-plan/:shipmentId
   *
   * Resolves the full print plan for a shipment label:
   *  1. Loads the shipment to extract company_id and branch_id
   *  2. Walks the printer_routes fallback chain (branch → company default)
   *  3. Persists a shipment_labels record as 'queued'
   *  4. Returns resolved printer details + label template settings + copies
   */
  router.get(
    '/shipping-labels/print-plan/:shipmentId',
    requirePermissions(['settings.shippingLabel.read']),
    asyncHandler(async (req, res) => {
      const companyId = requireCompanyId(req);
      const shipmentId = String(req.params.shipmentId);

      const shipmentResult = await pool.query<{ branch_id: string | null; company_id: string; shipment_no: string }>(
        `
        select branch_id, company_id, shipment_no
        from shipments
        where id = $1
          and company_id = $2
          and deleted_at is null
        limit 1
        `,
        [shipmentId, companyId],
      );

      const shipment = shipmentResult.rows[0];
      if (!shipment) {
        throw new HttpError(404, 'Shipment not found or not accessible in this company scope.');
      }

      const branchId: string | null = shipment.branch_id ?? null;

      const plan = await service.getPrintPlan(companyId, branchId);

      const resolvedPrinterId: string | null = plan.printerRoute?.printer_id ?? null;
      const copies: number = plan.printerRoute?.copies ?? 1;
      const templateId: string | null = (plan.settings as any)?.template_id ?? null;

      // Persist label record immediately as 'queued'
      const labelInsert = await pool.query<{ id: string }>(
        `
        insert into shipment_labels(
          shipment_id, printer_id, template_id, copies, print_status, company_id
        ) values($1, $2, $3, $4, 'queued', $5)
        returning id
        `,
        [shipmentId, resolvedPrinterId, templateId, copies, companyId],
      );
      const labelId = labelInsert.rows[0]?.id ?? null;

      const response = {
        labelId,
        shipmentId,
        shipmentNo: shipment.shipment_no,
        resolvedPrinterId,
        printerName: plan.printerRoute?.printer_name ?? null,
        printerTarget: plan.printerRoute?.target ?? null,
        printerType: plan.printerRoute?.printer_type ?? null,
        connectionType: plan.printerRoute?.connection_type ?? null,
        copies,
        routeScope: plan.printerRoute?.route_scope ?? null,
        templateSettings: plan.settings,
        printerResolved: Boolean(plan.printerRoute),
        fallbackUsed: plan.printerRoute?.route_scope === 'company',
      };

      auditService.logAsync({
        req,
        action: 'SHIPMENT_LABEL_PRINTED',
        entityType: 'shipment',
        entityId: shipmentId,
        metadata: {
          labelId,
          shipmentNo: shipment.shipment_no,
          branchId,
          resolvedPrinterId,
          copies,
          templateId,
          routeScope: response.routeScope,
          printerResolved: response.printerResolved,
        },
      });

      res.json({ success: true, data: response });
    }),
  );

  return router;
}
