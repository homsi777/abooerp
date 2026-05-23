import { z } from 'zod';
import { HttpError } from '../utils/errors.js';
import { PrinterRepository, } from '../repositories/printerRepository.js';
import { PrinterRouteRepository, } from '../repositories/printerRouteRepository.js';
const printerTypeSchema = z.enum(['thermal', 'label', 'a4', 'kitchen', 'receipt']);
const connectionTypeSchema = z.enum(['local', 'network', 'usb', 'windows']);
const documentTypeSchema = z.enum([
    'receipt_voucher',
    'payment_voucher',
    'shipment_label',
    'shipment_receipt',
    'manifest',
    'delivery_note',
    'a4_report',
    'kitchen_ticket',
]);
const printerCreateSchema = z.object({
    branch_id: z.union([z.string().uuid(), z.null()]).optional(),
    code: z.string().trim().min(1).max(80),
    name: z.string().trim().min(1).max(120),
    printer_type: printerTypeSchema,
    connection_type: connectionTypeSchema,
    target: z.string().trim().min(1).max(255),
    is_default: z.boolean().optional(),
    is_active: z.boolean().optional(),
    metadata: z.record(z.string(), z.unknown()).optional(),
});
const printerUpdateSchema = printerCreateSchema.partial();
const routeCreateSchema = z.object({
    branch_id: z.union([z.string().uuid(), z.null()]).optional(),
    document_type: documentTypeSchema,
    printer_id: z.string().uuid(),
    copies: z.number().int().min(1).max(10).optional(),
    is_default: z.boolean().optional(),
    is_active: z.boolean().optional(),
    metadata: z.record(z.string(), z.unknown()).optional(),
});
const routeUpdateSchema = routeCreateSchema.partial();
export class PrinterService {
    printerRepository;
    routeRepository;
    constructor(printerRepository = new PrinterRepository(), routeRepository = new PrinterRouteRepository()) {
        this.printerRepository = printerRepository;
        this.routeRepository = routeRepository;
    }
    async listPrinters(companyId, branchId, includeInactive = false) {
        return this.printerRepository.listPrinters(companyId, branchId, includeInactive);
    }
    async createPrinter(companyId, payload) {
        const data = printerCreateSchema.parse(payload);
        if (data.branch_id) {
            const branchExists = await this.printerRepository.branchBelongsToCompany(data.branch_id, companyId);
            if (!branchExists)
                throw new HttpError(403, 'Branch does not belong to your company scope.');
        }
        const created = await this.printerRepository.createPrinter(companyId, data);
        if (created.is_default) {
            const ensuredDefault = await this.printerRepository.setDefaultPrinter(created.id, companyId, created.branch_id);
            if (!ensuredDefault)
                throw new HttpError(404, 'Printer not found.');
            return ensuredDefault;
        }
        return created;
    }
    async updatePrinter(id, companyId, payload) {
        const data = printerUpdateSchema.parse(payload);
        if (data.branch_id) {
            const branchExists = await this.printerRepository.branchBelongsToCompany(data.branch_id, companyId);
            if (!branchExists)
                throw new HttpError(403, 'Branch does not belong to your company scope.');
        }
        const updated = await this.printerRepository.updatePrinter(id, companyId, data);
        if (!updated)
            return null;
        if (updated.is_default) {
            const ensuredDefault = await this.printerRepository.setDefaultPrinter(updated.id, companyId, updated.branch_id);
            return ensuredDefault ?? updated;
        }
        return updated;
    }
    async deactivatePrinter(id, companyId) {
        return this.printerRepository.deactivatePrinter(id, companyId);
    }
    async setDefaultPrinter(id, companyId, branchId) {
        if (branchId) {
            const branchExists = await this.printerRepository.branchBelongsToCompany(branchId, companyId);
            if (!branchExists)
                throw new HttpError(403, 'Branch does not belong to your company scope.');
        }
        return this.printerRepository.setDefaultPrinter(id, companyId, branchId ?? null);
    }
    async listPrinterRoutes(companyId, branchId, includeInactive = false) {
        return this.routeRepository.listPrinterRoutes(companyId, branchId, includeInactive);
    }
    async createPrinterRoute(companyId, payload) {
        const data = routeCreateSchema.parse(payload);
        if (data.branch_id) {
            const branchExists = await this.printerRepository.branchBelongsToCompany(data.branch_id, companyId);
            if (!branchExists)
                throw new HttpError(403, 'Branch does not belong to your company scope.');
        }
        const printer = await this.printerRepository.getPrinterById(data.printer_id, companyId);
        if (!printer || !printer.is_active)
            throw new HttpError(400, 'Route requires an active printer in company scope.');
        if (data.branch_id && printer.branch_id && printer.branch_id !== data.branch_id) {
            throw new HttpError(400, 'Branch route must reference a printer in same branch or company scope.');
        }
        if (data.is_default) {
            await this.routeRepository.clearDefaultRoute(companyId, data.branch_id ?? null, data.document_type);
        }
        return this.routeRepository.createPrinterRoute(companyId, data);
    }
    async updatePrinterRoute(id, companyId, payload) {
        const data = routeUpdateSchema.parse(payload);
        if (data.branch_id) {
            const branchExists = await this.printerRepository.branchBelongsToCompany(data.branch_id, companyId);
            if (!branchExists)
                throw new HttpError(403, 'Branch does not belong to your company scope.');
        }
        if (data.printer_id) {
            const printer = await this.printerRepository.getPrinterById(data.printer_id, companyId);
            if (!printer || !printer.is_active)
                throw new HttpError(400, 'Route requires an active printer in company scope.');
        }
        const current = await this.routeRepository.getPrinterRouteById(id, companyId);
        if (!current)
            return null;
        const finalDocumentType = data.document_type ?? current.document_type;
        const finalBranchId = data.branch_id === undefined ? current.branch_id : data.branch_id;
        if (data.is_default) {
            await this.routeRepository.clearDefaultRoute(companyId, finalBranchId ?? null, finalDocumentType);
        }
        return this.routeRepository.updatePrinterRoute(id, companyId, data);
    }
    async deactivatePrinterRoute(id, companyId) {
        return this.routeRepository.deactivatePrinterRoute(id, companyId);
    }
    async resolveDocumentPrinter(companyId, branchId, documentType) {
        const normalizedDocumentType = documentTypeSchema.parse(documentType);
        return this.routeRepository.resolvePrinterRoute(companyId, branchId, normalizedDocumentType);
    }
    async listEffectivePrinters(companyId, branchId) {
        return this.printerRepository.listPrinters(companyId, branchId ?? undefined, false);
    }
}
