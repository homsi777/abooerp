import { Router } from 'express';
import { z } from 'zod';
import { requirePermissions } from '../middleware/authorization.js';
import { asyncHandler } from '../utils/http.js';
import { HttpError } from '../utils/errors.js';
import { AuditService } from '../services/auditService.js';
import { requireIdempotencyKey } from '../middleware/idempotency.js';
function requireCompanyId(req) {
    const companyId = req.requestUserContext?.companyId;
    if (!companyId)
        throw new HttpError(403, 'Company scope is required.');
    return companyId;
}
function parseBoolFlag(value) {
    if (typeof value !== 'string')
        return false;
    return value === '1' || value.toLowerCase() === 'true';
}
const printerCreateSchema = z.object({
    branch_id: z.union([z.string().uuid(), z.null()]).optional(),
    code: z.string().min(1),
    name: z.string().min(1),
    printer_type: z.enum(['thermal', 'label', 'a4', 'kitchen', 'receipt']),
    connection_type: z.enum(['local', 'network', 'usb', 'windows']),
    target: z.string().min(1),
    is_default: z.boolean().optional(),
    is_active: z.boolean().optional(),
    metadata: z.record(z.string(), z.unknown()).optional(),
});
const printerUpdateSchema = printerCreateSchema.partial();
const routeCreateSchema = z.object({
    branch_id: z.union([z.string().uuid(), z.null()]).optional(),
    document_type: z.enum([
        'receipt_voucher',
        'payment_voucher',
        'shipment_label',
        'shipment_receipt',
        'manifest',
        'delivery_note',
        'a4_report',
        'kitchen_ticket',
    ]),
    printer_id: z.string().uuid(),
    copies: z.number().int().min(1).max(10).optional(),
    is_default: z.boolean().optional(),
    is_active: z.boolean().optional(),
    metadata: z.record(z.string(), z.unknown()).optional(),
});
const routeUpdateSchema = routeCreateSchema.partial();
export function createPrinterRouter(printerService) {
    const router = Router();
    const auditService = new AuditService();
    router.get('/printers', requirePermissions(['settings.printers.read']), asyncHandler(async (req, res) => {
        const companyId = requireCompanyId(req);
        const branchId = typeof req.query.branchId === 'string' ? req.query.branchId : undefined;
        const includeInactive = parseBoolFlag(req.query.includeInactive);
        const data = await printerService.listPrinters(companyId, branchId, includeInactive);
        res.json({ success: true, data });
    }));
    router.post('/printers', requirePermissions(['settings.printers.write']), requireIdempotencyKey('printers.create'), asyncHandler(async (req, res) => {
        const companyId = requireCompanyId(req);
        const payload = printerCreateSchema.parse(req.body);
        const data = await printerService.createPrinter(companyId, payload);
        auditService.logAsync({
            req,
            action: 'PRINTER_CREATED',
            entityType: 'printer',
            entityId: data.id,
            metadata: { code: data.code, branchId: data.branch_id, printerType: data.printer_type },
        });
        res.status(201).json({ success: true, data });
    }));
    router.put('/printers/:id', requirePermissions(['settings.printers.write']), requireIdempotencyKey('printers.update'), asyncHandler(async (req, res) => {
        const companyId = requireCompanyId(req);
        const payload = printerUpdateSchema.parse(req.body);
        const data = await printerService.updatePrinter(String(req.params.id), companyId, payload);
        if (!data) {
            res.status(404).json({ success: false, error: 'Printer not found.' });
            return;
        }
        auditService.logAsync({
            req,
            action: 'PRINTER_UPDATED',
            entityType: 'printer',
            entityId: data.id,
            metadata: { changedFields: Object.keys(payload) },
        });
        res.json({ success: true, data });
    }));
    router.delete('/printers/:id', requirePermissions(['settings.printers.write']), asyncHandler(async (req, res) => {
        const companyId = requireCompanyId(req);
        const removed = await printerService.deactivatePrinter(String(req.params.id), companyId);
        if (!removed) {
            res.status(404).json({ success: false, error: 'Printer not found.' });
            return;
        }
        auditService.logAsync({
            req,
            action: 'PRINTER_DEACTIVATED',
            entityType: 'printer',
            entityId: String(req.params.id),
        });
        res.json({ success: true });
    }));
    router.get('/printer-routes', requirePermissions(['settings.printers.read']), asyncHandler(async (req, res) => {
        const companyId = requireCompanyId(req);
        const branchId = typeof req.query.branchId === 'string' ? req.query.branchId : undefined;
        const includeInactive = parseBoolFlag(req.query.includeInactive);
        const data = await printerService.listPrinterRoutes(companyId, branchId, includeInactive);
        res.json({ success: true, data });
    }));
    router.post('/printer-routes', requirePermissions(['settings.printers.write']), requireIdempotencyKey('printer-routes.create'), asyncHandler(async (req, res) => {
        const companyId = requireCompanyId(req);
        const payload = routeCreateSchema.parse(req.body);
        const data = await printerService.createPrinterRoute(companyId, payload);
        auditService.logAsync({
            req,
            action: 'PRINTER_ROUTE_CREATED',
            entityType: 'printer_route',
            entityId: data.id,
            metadata: { documentType: data.document_type, printerId: data.printer_id, branchId: data.branch_id },
        });
        res.status(201).json({ success: true, data });
    }));
    router.put('/printer-routes/:id', requirePermissions(['settings.printers.write']), requireIdempotencyKey('printer-routes.update'), asyncHandler(async (req, res) => {
        const companyId = requireCompanyId(req);
        const payload = routeUpdateSchema.parse(req.body);
        const data = await printerService.updatePrinterRoute(String(req.params.id), companyId, payload);
        if (!data) {
            res.status(404).json({ success: false, error: 'Printer route not found.' });
            return;
        }
        auditService.logAsync({
            req,
            action: 'PRINTER_ROUTE_UPDATED',
            entityType: 'printer_route',
            entityId: data.id,
            metadata: { changedFields: Object.keys(payload) },
        });
        res.json({ success: true, data });
    }));
    router.delete('/printer-routes/:id', requirePermissions(['settings.printers.write']), asyncHandler(async (req, res) => {
        const companyId = requireCompanyId(req);
        const removed = await printerService.deactivatePrinterRoute(String(req.params.id), companyId);
        if (!removed) {
            res.status(404).json({ success: false, error: 'Printer route not found.' });
            return;
        }
        auditService.logAsync({
            req,
            action: 'PRINTER_ROUTE_DEACTIVATED',
            entityType: 'printer_route',
            entityId: String(req.params.id),
        });
        res.json({ success: true });
    }));
    router.get('/printer-routes/resolve', requirePermissions(['settings.printers.read']), asyncHandler(async (req, res) => {
        try {
            const companyId = requireCompanyId(req);
            const documentType = String(req.query.documentType ?? '');
            if (!documentType)
                throw new HttpError(400, 'documentType query is required.');
            const scopedBranchId = req.requestUserContext?.activeBranchId;
            const branchId = typeof req.query.branchId === 'string' ? req.query.branchId : scopedBranchId ?? null;
            const data = await printerService.resolveDocumentPrinter(companyId, branchId, documentType);
            if (!data) {
                res.status(404).json({ success: false, error: 'No active printer route resolved for requested document type.' });
                return;
            }
            auditService.logAsync({
                req,
                action: 'PRINTER_ROUTE_RESOLVED',
                entityType: 'printer_route',
                entityId: data.id,
                metadata: { documentType, routeScope: data.route_scope, printerId: data.printer_id, branchId },
            });
            res.json({ success: true, data });
        }
        catch (error) {
            auditService.logAsync({
                req,
                action: 'ROUTE_RESOLUTION_FAILED',
                entityType: 'printer_route',
                metadata: {
                    reason: error?.message ?? 'unknown',
                    documentType: String(req.query.documentType ?? ''),
                },
            });
            throw error;
        }
    }));
    return router;
}
