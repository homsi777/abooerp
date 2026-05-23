export type ShippingLabelFieldId =
  | 'receiverName'
  | 'receiverPhone'
  | 'senderName'
  | 'senderPhone'
  | 'shipmentNo'
  | 'trackingNo'
  | 'destination'
  | 'branch'
  | 'goodsDescription'
  | 'piecesCount'
  | 'notes'
  | 'date'
  | 'companyName'
  | 'companyLogo';

export interface ShippingLabelFieldSetting {
  id: ShippingLabelFieldId;
  label: string;
  enabled: boolean;
  order: number;
}

export interface ShippingLabelLayoutSettings {
  labelSize: 'A6' | '100x150' | '80x50';
  showBorder: boolean;
  boldImportantFields: boolean;
  largeTrackingNumber: boolean;
  barcodeEnabled: boolean;
  logoEnabled: boolean;
  textAlign: 'right' | 'center' | 'left';
  spacingDensity: 'compact' | 'normal';
}

export interface ShippingLabelPrintSettings {
  fields: ShippingLabelFieldSetting[];
  layout: ShippingLabelLayoutSettings;
}

export const SHIPPING_LABEL_PRINT_STORAGE_KEY = 'settings-shipping-label-print';

export const DEFAULT_SHIPPING_LABEL_PRINT_SETTINGS: ShippingLabelPrintSettings = {
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
};

function cloneDefaults(): ShippingLabelPrintSettings {
  return {
    fields: DEFAULT_SHIPPING_LABEL_PRINT_SETTINGS.fields.map((field) => ({ ...field })),
    layout: { ...DEFAULT_SHIPPING_LABEL_PRINT_SETTINGS.layout },
  };
}

export function getShippingLabelPrintSettings(): ShippingLabelPrintSettings {
  if (typeof window === 'undefined') return cloneDefaults();
  try {
    const raw = window.localStorage.getItem(SHIPPING_LABEL_PRINT_STORAGE_KEY);
    if (!raw) return cloneDefaults();
    const parsed = JSON.parse(raw) as ShippingLabelPrintSettings;
    return {
      fields: parsed.fields ?? cloneDefaults().fields,
      layout: { ...cloneDefaults().layout, ...(parsed.layout || {}) },
    };
  } catch {
    return cloneDefaults();
  }
}

export function saveShippingLabelPrintSettings(settings: ShippingLabelPrintSettings): void {
  if (typeof window === 'undefined') return;
  window.localStorage.setItem(SHIPPING_LABEL_PRINT_STORAGE_KEY, JSON.stringify(settings));
}

export function resetShippingLabelPrintSettings(): ShippingLabelPrintSettings {
  const defaults = cloneDefaults();
  if (typeof window !== 'undefined') {
    window.localStorage.setItem(SHIPPING_LABEL_PRINT_STORAGE_KEY, JSON.stringify(defaults));
  }
  return defaults;
}
