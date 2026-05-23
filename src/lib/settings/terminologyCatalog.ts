export interface TerminologyFieldDefinition {
  key: string;
  label: string;
  description?: string;
}

export interface TerminologyGroupDefinition {
  id: string;
  label: string;
  fields: TerminologyFieldDefinition[];
}

export const TERMINOLOGY_GROUPS: TerminologyGroupDefinition[] = [
  {
    id: 'core',
    label: 'المفاهيم الأساسية',
    fields: [
      { key: 'customer', label: 'العميل' },
      { key: 'agent', label: 'الوكيل' },
      { key: 'branch', label: 'الفرع' },
      { key: 'city', label: 'المدينة' },
      { key: 'governorate', label: 'المحافظة' },
    ],
  },
  {
    id: 'shipping',
    label: 'الشحن والعمليات',
    fields: [
      { key: 'shipment', label: 'الشحنة' },
      { key: 'manifest', label: 'بيان التحميل (Manifest)' },
      { key: 'delivery', label: 'التسليم' },
      { key: 'sender', label: 'المرسل' },
      { key: 'receiver', label: 'المستلم' },
      { key: 'goodsType', label: 'نوع البضاعة' },
      { key: 'piecesCount', label: 'عدد القطع' },
      { key: 'trackingNumber', label: 'رقم التتبع' },
      { key: 'shippingLabel', label: 'لصاقة الشحن' },
    ],
  },
  {
    id: 'transport',
    label: 'المركبات والموارد',
    fields: [
      { key: 'vehicle', label: 'المركبة' },
      { key: 'driver', label: 'السائق' },
      { key: 'trip', label: 'الرحلة' },
      { key: 'route', label: 'خط السير' },
      { key: 'load', label: 'التحميل' },
    ],
  },
  {
    id: 'finance',
    label: 'المالية والمحاسبة',
    fields: [
      { key: 'expense', label: 'المصروف' },
      { key: 'salary', label: 'الراتب' },
      { key: 'advance', label: 'السلفة' },
      { key: 'cashBox', label: 'الصندوق' },
      { key: 'voucher', label: 'السند' },
      { key: 'receiptVoucher', label: 'سند القبض' },
      { key: 'paymentVoucher', label: 'سند الدفع' },
      { key: 'dailyJournal', label: 'دفتر اليومية' },
      { key: 'record', label: 'القيد المحاسبي' },
      { key: 'commission', label: 'العمولة' },
      { key: 'settlement', label: 'التسوية' },
      { key: 'debit', label: 'مدين' },
      { key: 'credit', label: 'دائن' },
      { key: 'balance', label: 'الرصيد' },
    ],
  },
  {
    id: 'reports',
    label: 'التقارير والكشوفات',
    fields: [
      { key: 'report', label: 'التقرير' },
      { key: 'statement', label: 'كشف الحساب' },
      { key: 'summaryCard', label: 'بطاقة الملخص' },
      { key: 'kpi', label: 'مؤشر الأداء' },
      { key: 'printPreview', label: 'معاينة الطباعة' },
      { key: 'export', label: 'التصدير' },
      { key: 'filters', label: 'الفلاتر' },
    ],
  },
  {
    id: 'administration',
    label: 'الإدارة والصلاحيات',
    fields: [
      { key: 'user', label: 'المستخدم' },
      { key: 'role', label: 'الدور' },
      { key: 'permission', label: 'الصلاحية' },
      { key: 'activityLog', label: 'سجل النشاط' },
      { key: 'auditLog', label: 'سجل التدقيق' },
      { key: 'backup', label: 'النسخ الاحتياطي' },
      { key: 'restore', label: 'الاستعادة' },
      { key: 'settings', label: 'الإعدادات' },
    ],
  },
];

export const DEFAULT_TERMINOLOGY: Record<string, string> = TERMINOLOGY_GROUPS.reduce(
  (acc, group) => {
    group.fields.forEach((field) => {
      acc[field.key] = field.label;
    });
    return acc;
  },
  {} as Record<string, string>
);
