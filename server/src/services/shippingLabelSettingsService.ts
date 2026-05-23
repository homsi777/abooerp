import { z } from 'zod';
import { ShippingLabelSettingsRepository } from '../repositories/shippingLabelSettingsRepository.js';
import { PrinterService } from './printerService.js';

const fieldIdSchema = z.enum([
  'receiverName',
  'receiverPhone',
  'senderName',
  'senderPhone',
  'shipmentNo',
  'trackingNo',
  'destination',
  'branch',
  'goodsDescription',
  'piecesCount',
  'notes',
  'date',
  'companyName',
  'companyLogo',
]);

const fieldSchema = z.object({
  id: fieldIdSchema,
  label: z.string().min(1).max(120),
  enabled: z.boolean(),
  order: z.number().int().min(1).max(100),
});

const layoutSchema = z.object({
  labelSize: z.enum(['A6', '100x150', '80x50']),
  showBorder: z.boolean(),
  boldImportantFields: z.boolean(),
  largeTrackingNumber: z.boolean(),
  barcodeEnabled: z.boolean(),
  logoEnabled: z.boolean(),
  textAlign: z.enum(['right', 'center', 'left']),
  spacingDensity: z.enum(['compact', 'normal']),
});

const payloadSchema = z.object({
  fields: z.array(fieldSchema).min(1),
  layout: layoutSchema,
});

const defaultConfig = {
  fields: [
    { id: 'receiverName', label: 'اسم المستلم', enabled: true, order: 1 },
    { id: 'receiverPhone', label: 'هاتف المستلم', enabled: true, order: 2 },
    { id: 'senderName', label: 'اسم المرسل', enabled: true, order: 3 },
    { id: 'senderPhone', label: 'هاتف المرسل', enabled: false, order: 4 },
    { id: 'shipmentNo', label: 'رقم الشحنة', enabled: true, order: 5 },
    { id: 'trackingNo', label: 'رقم التتبع / باركود', enabled: true, order: 6 },
    { id: 'destination', label: 'المدينة / الوجهة', enabled: true, order: 7 },
    { id: 'branch', label: 'الفرع', enabled: true, order: 8 },
    { id: 'goodsDescription', label: 'وصف البضاعة', enabled: true, order: 9 },
    { id: 'piecesCount', label: 'عدد القطع', enabled: true, order: 10 },
    { id: 'notes', label: 'الملاحظات', enabled: false, order: 11 },
    { id: 'date', label: 'التاريخ', enabled: true, order: 12 },
    { id: 'companyName', label: 'اسم الشركة', enabled: true, order: 13 },
    { id: 'companyLogo', label: 'شعار الشركة', enabled: true, order: 14 },
  ],
  layout: {
    labelSize: 'A6',
    showBorder: true,
    boldImportantFields: true,
    largeTrackingNumber: true,
    barcodeEnabled: true,
    logoEnabled: true,
    textAlign: 'right',
    spacingDensity: 'normal',
  },
} as const;

export class ShippingLabelSettingsService {
  constructor(
    private readonly repository = new ShippingLabelSettingsRepository(),
    private readonly printerService = new PrinterService()
  ) {}

  async get(companyId: string) {
    const row = await this.repository.getByCompany(companyId);
    if (!row) return defaultConfig;
    const merged = {
      ...defaultConfig,
      ...(row.config ?? {}),
      fields: Array.isArray((row.config as any)?.fields) ? (row.config as any).fields : defaultConfig.fields,
      layout: {
        ...defaultConfig.layout,
        ...((row.config as any)?.layout ?? {}),
      },
    };
    return payloadSchema.parse(merged);
  }

  async update(companyId: string, payload: unknown, userId: string | null) {
    const parsed = payloadSchema.parse(payload);
    const row = await this.repository.upsert(companyId, parsed, userId);
    return payloadSchema.parse(row.config);
  }

  async getPrintPlan(companyId: string, branchId: string | null) {
    const [settings, resolvedRoute] = await Promise.all([
      this.get(companyId),
      this.printerService.resolveDocumentPrinter(companyId, branchId, 'shipment_label'),
    ]);
    return {
      settings,
      printerRoute: resolvedRoute,
    };
  }
}
