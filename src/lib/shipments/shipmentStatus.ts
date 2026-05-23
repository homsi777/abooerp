export const CANONICAL_SHIPMENT_STATUSES = [
  'DRAFT',
  'REGISTERED',
  'CONFIRMED',
  'READY_FOR_PICKUP',
  'HANDED_TO_DRIVER',
  'HANDED_TO_AGENT',
  'AGENT_RECEIVED',
  'IN_TRANSIT',
  'ARRIVED_AT_DESTINATION',
  'OUT_FOR_DELIVERY',
  'DELIVERED',
  'RETURN_REQUESTED',
  'RETURNED',
  'CANCELLED',
  'FINANCIALLY_CLOSED',
] as const;

export type CanonicalShipmentStatus = (typeof CANONICAL_SHIPMENT_STATUSES)[number];

type LegacyShipmentStatus =
  | 'created'
  | 'draft'
  | 'confirmed'
  | 'loaded'
  | 'manifested'
  | 'in_transit'
  | 'arrived'
  | 'ready_delivery'
  | 'delivered'
  | 'returned'
  | 'cancelled';

const LEGACY_TO_CANONICAL: Record<LegacyShipmentStatus, CanonicalShipmentStatus> = {
  created: 'REGISTERED',
  draft: 'DRAFT',
  confirmed: 'CONFIRMED',
  loaded: 'HANDED_TO_DRIVER',
  manifested: 'HANDED_TO_DRIVER',
  in_transit: 'IN_TRANSIT',
  arrived: 'ARRIVED_AT_DESTINATION',
  ready_delivery: 'OUT_FOR_DELIVERY',
  delivered: 'DELIVERED',
  returned: 'RETURNED',
  cancelled: 'CANCELLED',
};

export const SHIPMENT_STATUS_META: Record<
  CanonicalShipmentStatus,
  {
    labelAr: string;
    descriptionAr: string;
    colorClass: string;
    editable: boolean;
    allowsDelivery: boolean;
    allowsFinancialPosting: boolean;
    terminal: boolean;
    next: CanonicalShipmentStatus[];
  }
> = {
  DRAFT: { labelAr: 'مسودة', descriptionAr: 'شحنة قيد الإدخال', colorClass: 'bg-slate-100 text-slate-700', editable: true, allowsDelivery: false, allowsFinancialPosting: false, terminal: false, next: ['REGISTERED', 'CANCELLED'] },
  REGISTERED: { labelAr: 'مسجلة', descriptionAr: 'تم تسجيل الطلب', colorClass: 'bg-blue-100 text-blue-700', editable: true, allowsDelivery: false, allowsFinancialPosting: false, terminal: false, next: ['CONFIRMED', 'CANCELLED'] },
  CONFIRMED: { labelAr: 'مؤكدة', descriptionAr: 'تم اعتماد الشحنة', colorClass: 'bg-indigo-100 text-indigo-700', editable: false, allowsDelivery: false, allowsFinancialPosting: true, terminal: false, next: ['READY_FOR_PICKUP', 'HANDED_TO_DRIVER', 'HANDED_TO_AGENT', 'RETURN_REQUESTED', 'CANCELLED'] },
  READY_FOR_PICKUP: { labelAr: 'جاهزة للاستلام', descriptionAr: 'جاهزة للتسليم التشغيلي', colorClass: 'bg-cyan-100 text-cyan-700', editable: false, allowsDelivery: false, allowsFinancialPosting: true, terminal: false, next: ['HANDED_TO_DRIVER', 'HANDED_TO_AGENT', 'RETURN_REQUESTED', 'CANCELLED'] },
  HANDED_TO_DRIVER: { labelAr: 'سُلّمت للسائق', descriptionAr: 'تم تسليمها لسائق', colorClass: 'bg-violet-100 text-violet-700', editable: false, allowsDelivery: false, allowsFinancialPosting: true, terminal: false, next: ['IN_TRANSIT', 'ARRIVED_AT_DESTINATION', 'RETURN_REQUESTED'] },
  HANDED_TO_AGENT: { labelAr: 'سُلّمت للوكيل', descriptionAr: 'بانتظار تأكيد الوكيل', colorClass: 'bg-fuchsia-100 text-fuchsia-700', editable: false, allowsDelivery: false, allowsFinancialPosting: true, terminal: false, next: ['AGENT_RECEIVED', 'RETURN_REQUESTED'] },
  AGENT_RECEIVED: { labelAr: 'استلمها الوكيل', descriptionAr: 'الوكيل أكد الاستلام', colorClass: 'bg-purple-100 text-purple-700', editable: false, allowsDelivery: false, allowsFinancialPosting: true, terminal: false, next: ['IN_TRANSIT', 'ARRIVED_AT_DESTINATION', 'RETURN_REQUESTED'] },
  IN_TRANSIT: { labelAr: 'في الطريق', descriptionAr: 'الشحنة قيد النقل', colorClass: 'bg-amber-100 text-amber-700', editable: false, allowsDelivery: false, allowsFinancialPosting: true, terminal: false, next: ['ARRIVED_AT_DESTINATION', 'RETURN_REQUESTED'] },
  ARRIVED_AT_DESTINATION: { labelAr: 'وصلت للوجهة', descriptionAr: 'وصلت إلى مركز الوصول', colorClass: 'bg-emerald-100 text-emerald-700', editable: false, allowsDelivery: true, allowsFinancialPosting: true, terminal: false, next: ['OUT_FOR_DELIVERY', 'DELIVERED', 'RETURN_REQUESTED'] },
  OUT_FOR_DELIVERY: { labelAr: 'خارجة للتسليم', descriptionAr: 'خرجت للتسليم النهائي', colorClass: 'bg-sky-100 text-sky-700', editable: false, allowsDelivery: true, allowsFinancialPosting: true, terminal: false, next: ['DELIVERED', 'RETURN_REQUESTED'] },
  DELIVERED: { labelAr: 'تم التسليم', descriptionAr: 'تم تسليم الشحنة للعميل', colorClass: 'bg-green-100 text-green-700', editable: false, allowsDelivery: false, allowsFinancialPosting: true, terminal: false, next: ['FINANCIALLY_CLOSED', 'RETURN_REQUESTED'] },
  RETURN_REQUESTED: { labelAr: 'طلب إرجاع', descriptionAr: 'تم طلب إرجاع الشحنة', colorClass: 'bg-orange-100 text-orange-700', editable: false, allowsDelivery: false, allowsFinancialPosting: true, terminal: false, next: ['RETURNED'] },
  RETURNED: { labelAr: 'مرتجعة', descriptionAr: 'تمت إعادة الشحنة', colorClass: 'bg-rose-100 text-rose-700', editable: false, allowsDelivery: false, allowsFinancialPosting: true, terminal: false, next: ['FINANCIALLY_CLOSED'] },
  CANCELLED: { labelAr: 'ملغاة', descriptionAr: 'ألغيت قبل الإغلاق', colorClass: 'bg-red-100 text-red-700', editable: false, allowsDelivery: false, allowsFinancialPosting: false, terminal: true, next: [] },
  FINANCIALLY_CLOSED: { labelAr: 'مغلقة ماليا', descriptionAr: 'تم إغلاقها ماليا', colorClass: 'bg-neutral-900 text-white', editable: false, allowsDelivery: false, allowsFinancialPosting: false, terminal: true, next: [] },
};

function isCanonicalStatus(value: string): value is CanonicalShipmentStatus {
  return (CANONICAL_SHIPMENT_STATUSES as readonly string[]).includes(value);
}

function isLegacyStatus(value: string): value is LegacyShipmentStatus {
  return Object.prototype.hasOwnProperty.call(LEGACY_TO_CANONICAL, value);
}

export function normalizeShipmentStatus(value: string | null | undefined): CanonicalShipmentStatus | 'UNKNOWN' {
  if (!value) return 'UNKNOWN';
  const trimmed = String(value).trim();
  if (!trimmed) return 'UNKNOWN';
  if (isCanonicalStatus(trimmed)) return trimmed;
  const upper = trimmed.toUpperCase();
  if (isCanonicalStatus(upper)) return upper;
  const lower = trimmed.toLowerCase();
  if (isLegacyStatus(lower)) return LEGACY_TO_CANONICAL[lower];
  if (import.meta.env.DEV) {
    console.warn('[shipment-status] unknown status:', value);
  }
  return 'UNKNOWN';
}

export function shipmentStatusLabelAr(value: string | null | undefined): string {
  const normalized = normalizeShipmentStatus(value);
  if (normalized === 'UNKNOWN') return 'حالة غير معروفة';
  return SHIPMENT_STATUS_META[normalized].labelAr;
}

export function shipmentStatusColorClass(value: string | null | undefined): string {
  const normalized = normalizeShipmentStatus(value);
  if (normalized === 'UNKNOWN') return 'bg-gray-100 text-gray-700';
  return SHIPMENT_STATUS_META[normalized].colorClass;
}

