import { formatWesternNumber } from '../format/westernDigits';

/** ترجمات واجهة قسم المالية — لا تعرض مفاتيح إنجليزية خام للمستخدم. */

export const FINANCE_PARTY_TYPE_AR: Record<string, string> = {
  agent: 'وكيل',
  customer: 'عميل',
  sender_receiver: 'مرسل/مستلم',
};

export const FINANCE_ACCOUNT_SECTION_AR: Record<string, string> = {
  asset: 'أصول',
  liability: 'خصوم',
  equity: 'حقوق ملكية',
  revenue: 'إيرادات',
  expense: 'مصاريف',
};

export const FINANCE_BALANCE_DIRECTION_AR: Record<string, string> = {
  debit: 'مدين لنا',
  credit: 'دائن علينا',
  balanced: 'متوازن',
};

export const FINANCE_VOUCHER_STATUS_AR: Record<string, string> = {
  draft: 'مسودة',
  confirmed: 'مؤكّد',
  cancelled: 'ملغى',
};

export const FINANCE_REFERENCE_TYPE_AR: Record<string, string> = {
  shipment: 'شحنة',
  receipt: 'سند قبض',
  payment: 'سند دفع',
  expense: 'مصروف',
  settlement: 'تسوية',
};

export const FINANCE_AGENT_ROLE_AR: Record<string, string> = {
  origin: 'مصدر (قبض)',
  destination: 'وجهة (دفع)',
  both: 'مصدر ووجهة',
  none: '—',
};

export const FINANCE_PAYMENT_METHOD_AR: Record<string, string> = {
  cash: 'نقد',
  transfer: 'تحويل بنكي',
  other: 'أخرى',
};

export const FINANCE_MOVEMENT_TYPE_AR: Record<string, string> = {
  shipment_commission: 'عمولة شحنة',
  transfer: 'حوالة',
  receipt_voucher: 'سند قبض',
  payment_voucher: 'سند دفع',
  voucher_receipt: 'سند قبض',
  voucher_payment: 'سند دفع',
  cashbox_transaction: 'حركة صندوق',
  shipment_charge: 'رسوم شحنة',
  shipment_shipping_fee: 'أجور شحن',
  sender_collection_trust: 'تحصيل لصالح المرسل',
  loading_dues: 'مستحقات تحميل',
  general_collection: 'تحصيل إضافي',
  shipment_hawala_trust: 'أصل حوالة (شحنة)',
  shipment_transfer_service_fee: 'أجرة حوالة (شحنة)',
  transfer_principal_collected: 'قبض أصل حوالة',
  transfer_service_fee_collected: 'قبض أجرة حوالة',
  transfer_principal_paid: 'دفع أصل حوالة للمستلم',
  transfer_agent_commission: 'عمولة حوالة',
  POSTED: 'مرحّل',
};

export const FINANCE_ACCOUNT_CODE_AR: Record<string, string> = {
  'LIAB-AGENTS': 'ذمم وكلاء (مجمّع)',
  'LIAB-CUSTOMERS': 'ذمم عملاء (مجمّع)',
  'REV-SHIPPING': 'إيرادات الشحن',
  'REV-TRANSFER-FEE': 'إيرادات أجور الحوالة',
  'EXP-AGENT-COMM': 'عمولات وكلاء (شحن)',
  'EXP-OPERATING': 'مصاريف تشغيلية',
};

export const FINANCE_CURRENCY_OPTIONS: Array<{ value: string; label: string; short: string }> = [
  { value: 'USD', label: 'دولار أمريكي', short: 'د.أ' },
  { value: 'SYP', label: 'ليرة سورية', short: 'ل.س' },
  { value: 'TRY', label: 'ليرة تركية', short: 'ل.ت' },
];

export const FINANCE_PROFIT_LOSS_SECTION_AR: Record<string, string> = {
  revenue: 'إيراد',
  shipping_revenue: 'إيراد شحن',
  transfer_fee_revenue: 'إيراد أجور حوالة',
  operating_expense: 'مصروف تشغيلي',
  agent_liability: 'ذمة وكيل',
  customer_liability: 'ذمة عميل',
  agent_commission: 'عمولة وكيل',
};

function normalizeKey(value: string): string {
  return String(value ?? '').trim().toLowerCase();
}

export function translateFinanceMap(map: Record<string, string>, value: unknown): string {
  const raw = String(value ?? '').trim();
  if (!raw) return '—';
  if (map[raw]) return map[raw];
  const lower = normalizeKey(raw);
  if (map[lower]) return map[lower];
  return raw;
}

export function financePartyTypeLabel(value: unknown): string {
  return translateFinanceMap(FINANCE_PARTY_TYPE_AR, value);
}

export function financeAccountSectionLabel(value: unknown): string {
  return translateFinanceMap(FINANCE_ACCOUNT_SECTION_AR, value);
}

export function financeBalanceDirectionLabel(value: unknown): string {
  return translateFinanceMap(FINANCE_BALANCE_DIRECTION_AR, value);
}

export function financeVoucherStatusLabel(value: unknown): string {
  return translateFinanceMap(FINANCE_VOUCHER_STATUS_AR, value);
}

export function financeReferenceTypeLabel(value: unknown): string {
  return translateFinanceMap(FINANCE_REFERENCE_TYPE_AR, value);
}

export function financeAgentRoleLabel(value: unknown): string {
  return translateFinanceMap(FINANCE_AGENT_ROLE_AR, value);
}

export function financePaymentMethodLabel(value: unknown): string {
  const raw = String(value ?? '').trim();
  if (!raw) return '—';
  return translateFinanceMap(FINANCE_PAYMENT_METHOD_AR, raw);
}

export function financeMovementTypeLabel(value: unknown): string {
  return translateFinanceMap(FINANCE_MOVEMENT_TYPE_AR, value);
}

export function financeAccountCodeLabel(code: unknown): string {
  const raw = String(code ?? '').trim();
  if (!raw) return '—';
  if (FINANCE_ACCOUNT_CODE_AR[raw]) return FINANCE_ACCOUNT_CODE_AR[raw];
  if (raw.startsWith('CB-')) return `صندوق: ${raw.slice(3)}`;
  return raw;
}

export function financeCurrencyLabel(code: unknown): string {
  const raw = String(code ?? '').trim().toUpperCase();
  const found = FINANCE_CURRENCY_OPTIONS.find((c) => c.value === raw);
  return found?.label ?? raw;
}

export function financeCurrencyShort(code: unknown): string {
  const raw = String(code ?? '').trim().toUpperCase();
  const found = FINANCE_CURRENCY_OPTIONS.find((c) => c.value === raw);
  return found?.short ?? raw;
}

export function formatFinanceAmount(value: unknown, currencyCode = 'USD'): string {
  return `${formatWesternNumber(value)} ${financeCurrencyShort(currencyCode)}`;
}
