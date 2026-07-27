export type ActivityRow = {
  id: string;
  company_id: string;
  branch_id: string | null;
  user_id: string | null;
  action: string;
  entity_type: string;
  entity_id: string | null;
  metadata: Record<string, unknown>;
  ip_address: string | null;
  user_agent: string | null;
  created_at: string;
  actor_display_name: string | null;
  actor_username: string | null;
  actor_role_code: string | null;
  branch_name: string | null;
  agent_profile_name: string | null;
};

export type ActivityUserSummary = {
  user_id: string | null;
  actor_display_name: string | null;
  actor_username: string | null;
  actor_role_code: string | null;
  actor_user_type: string | null;
  agent_profile_name: string | null;
  total_events: number;
  created_count: number;
  updated_count: number;
  deleted_count: number;
  ledger_row_events: number;
  shipment_events: number;
  finance_events: number;
  last_event_at: string | null;
};

export const ACTION_AR: Record<string, string> = {
  DAILY_LEDGER_ROW_CREATED: 'إدخال سطر دفتر شحن',
  DAILY_LEDGER_ROW_UPDATED: 'تعديل سطر دفتر شحن',
  DAILY_LEDGER_ROW_DELETED: 'حذف سطر دفتر شحن',
  SHIPMENT_CREATED: 'إنشاء شحنة',
  SHIPMENT_UPDATED: 'تعديل شحنة',
  SHIPMENT_DELETED: 'حذف شحنة',
  SHIPMENT_CONFIRMED: 'تأكيد شحنة',
  SHIPMENT_CREATE_FAILED: 'فشل إنشاء شحنة',
  SHIPMENT_UPDATE_FAILED: 'فشل تعديل شحنة',
  SHIPMENT_STOCK_RESERVED: 'حجز مخزون للشحنة',
  SHIPMENT_STOCK_RELEASED: 'إطلاق مخزون شحنة',
  SHIPMENT_FINANCIAL_REPOSTED: 'إعادة ترحيل مالي للشحنة',
  EMPLOYEE_CREATED: 'إضافة موظف',
  EMPLOYEE_UPDATED: 'تعديل موظف',
  EMPLOYEE_DELETED: 'حذف موظف',
  SALARY_CREATED: 'تسجيل راتب',
  SALARY_UPDATED: 'تعديل راتب',
  SALARY_DELETED: 'حذف سجل راتب',
  ADVANCE_CREATED: 'سلفة موظف',
  ADVANCE_UPDATED: 'تعديل سلفة',
  ADVANCE_DELETED: 'حذف سلفة',
  LOGIN_SUCCESS: 'تسجيل دخول ناجح',
  LOGIN_FAILED: 'فشل تسجيل دخول',
  LOGOUT: 'تسجيل خروج',
  PASSWORD_RESET: 'إعادة تعيين كلمة مرور',
  USER_CREATED: 'إنشاء مستخدم',
  USER_UPDATED: 'تعديل مستخدم',
  USER_DELETED: 'حذف مستخدم',
  FORBIDDEN_ACCESS: 'رفض صلاحية',
  BRANCH_CREATED: 'إنشاء فرع',
  BRANCH_UPDATED: 'تعديل فرع',
  BRANCH_DELETED: 'حذف فرع',
  VOUCHER_CREATED: 'إنشاء سند',
  VOUCHER_UPDATED: 'تعديل سند',
  VOUCHER_DELETED: 'حذف سند',
  VOUCHER_CONFIRMED: 'اعتماد سند',
  VOUCHER_CANCELLED: 'إلغاء سند',
  MANIFEST_CREATED: 'إنشاء كشف',
  MANIFEST_UPDATED: 'تعديل كشف',
  DELIVERY_CREATED: 'تسجيل تسليم',
  TRANSFER_CREATED: 'إنشاء تحويل',
  LEDGER_FINANCE_AUDIT_GENERATED: 'تقرير مطابقة دفتر/مالية',
  LEDGER_ACCESSED: 'عرض كشف حساب',
};

export const ENTITY_AR: Record<string, string> = {
  daily_ledger_row: 'دفتر الشحن اليومي',
  shipment: 'شحنة',
  employee: 'موظف',
  salary_record: 'سجل راتب',
  employee_advance: 'سلفة',
  user: 'مستخدم',
  branch: 'فرع',
  customer: 'عميل',
  voucher: 'سند مالي',
  cashbox: 'صندوق',
  journal_entry: 'قيد',
  auth: 'جلسة',
  manifest: 'كشف',
  delivery: 'تسليم',
  transfer: 'تحويل',
  agent: 'وكيل',
};

export const ROLE_AR: Record<string, string> = {
  admin: 'مدير نظام',
  general_manager: 'مدير عام',
  branch_manager: 'مدير فرع',
  manager: 'مدير',
  accountant: 'محاسب',
  data_entry: 'مدخل بيانات',
  agent_user: 'وكيل',
  shipment_auditor: 'مدقق شحن',
};

export const MODULE_OPTIONS = [
  { value: '', label: 'كل الأقسام' },
  { value: 'daily_ledger_row', label: 'دفتر الشحن اليومي' },
  { value: 'shipment', label: 'الشحنات' },
  { value: 'voucher', label: 'السندات المالية' },
  { value: 'cashbox', label: 'الصناديق' },
  { value: 'user', label: 'المستخدمون' },
  { value: 'employee', label: 'الموظفون' },
  { value: 'auth', label: 'الجلسات' },
] as const;

const FIELD_AR: Record<string, string> = {
  summary: 'الملخص',
  rowNo: 'رقم السطر',
  receiptNo: 'رقم الإيصال',
  ledgerDate: 'تاريخ الدفتر',
  lineLabel: 'الخط',
  originLabel: 'المصدر',
  destination: 'الجهة',
  parcelType: 'نوع الطرد',
  parcelCount: 'العدد',
  weightKg: 'الوزن (كغ)',
  senderName: 'المرسل',
  receiverName: 'المستلم',
  collectUsd: 'تحصيل $',
  prepaidUsd: 'دفع مسبق $',
  hawalaUsd: 'حوالة $',
  transferFeeUsd: 'أجور حوالة $',
  notes: 'ملاحظات',
  shipmentNo: 'رقم الشحنة',
  destinationCity: 'الوجهة',
  status: 'الحالة',
  newStatus: 'الحالة الجديدة',
  originalAmount: 'المبلغ',
  originalCurrency: 'العملة',
  changedFields: 'حقول معدّلة',
  updatedFields: 'حقول معدّلة',
  username: 'اسم المستخدم',
  reason: 'السبب',
  amount: 'المبلغ',
  period: 'الفترة',
  employeeId: 'معرّف موظف',
  before: 'قبل',
  after: 'بعد',
  changes: 'التغييرات',
};

export function fmtDateTime(iso: string): string {
  try {
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return iso;
    return d.toLocaleString('ar-SY', {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  } catch {
    return iso;
  }
}

export function actionLabel(action: string): string {
  return ACTION_AR[action] ?? action.replace(/_/g, ' ');
}

export function entityLabel(entity: string): string {
  return ENTITY_AR[entity] ?? entity;
}

export function roleLabel(role?: string | null, userType?: string | null): string {
  const code = (role || userType || '').toLowerCase();
  return ROLE_AR[code] ?? (code || '—');
}

export function actionTone(action: string): 'create' | 'update' | 'delete' | 'neutral' {
  if (action.endsWith('CREATED')) return 'create';
  if (action.endsWith('UPDATED')) return 'update';
  if (action.endsWith('DELETED')) return 'delete';
  return 'neutral';
}

function fieldLabel(key: string): string {
  return FIELD_AR[key] ?? key;
}

function displayValue(value: unknown): string {
  if (value == null || value === '') return '—';
  if (typeof value === 'object') return JSON.stringify(value, null, 0);
  return String(value);
}

export function summarizeActivity(row: ActivityRow): string {
  const m = row.metadata || {};
  if (typeof m.summary === 'string' && m.summary.trim()) return m.summary;
  const bits: string[] = [];
  const pick = (k: string) => {
    const v = m[k];
    if (v !== undefined && v !== null && String(v) !== '') bits.push(`${fieldLabel(k)}: ${displayValue(v)}`);
  };
  pick('receiptNo');
  pick('rowNo');
  pick('destination');
  pick('shipmentNo');
  pick('destinationCity');
  pick('senderName');
  pick('receiverName');
  pick('collectUsd');
  pick('prepaidUsd');
  if (bits.length) return bits.join(' · ');
  return '—';
}

export type ActivityDetailRow = { label: string; value: string };

export function buildActivityDetailRows(row: ActivityRow): ActivityDetailRow[] {
  const m = row.metadata || {};
  const rows: ActivityDetailRow[] = [];
  const skip = new Set(['before', 'after', 'changes', '__truncated']);

  for (const [key, value] of Object.entries(m)) {
    if (skip.has(key)) continue;
    if (value === undefined || value === null) continue;
    rows.push({ label: fieldLabel(key), value: displayValue(value) });
  }
  return rows;
}

export type ActivityChangeRow = { field: string; before: string; after: string };

export function buildActivityChangeRows(row: ActivityRow): ActivityChangeRow[] {
  const m = row.metadata || {};
  const changes = m.changes;
  if (changes && typeof changes === 'object' && !Array.isArray(changes)) {
    return Object.entries(changes as Record<string, { before?: unknown; after?: unknown }>).map(([field, pair]) => ({
      field: fieldLabel(field),
      before: displayValue(pair?.before),
      after: displayValue(pair?.after),
    }));
  }
  const before = m.before;
  const after = m.after;
  if (!before || !after || typeof before !== 'object' || typeof after !== 'object') return [];
  const keys = new Set([...Object.keys(before as object), ...Object.keys(after as object)]);
  const out: ActivityChangeRow[] = [];
  for (const key of keys) {
    const b = (before as Record<string, unknown>)[key];
    const a = (after as Record<string, unknown>)[key];
    if (String(b ?? '') === String(a ?? '')) continue;
    out.push({ field: fieldLabel(key), before: displayValue(b), after: displayValue(a) });
  }
  return out;
}

export function actorTitle(row: Pick<ActivityRow, 'actor_display_name' | 'actor_username' | 'user_id'>): string {
  return row.actor_display_name || row.actor_username || row.user_id || 'نظام / غير معروف';
}

export function actorSubtitle(
  row: Pick<ActivityRow, 'actor_username' | 'actor_display_name' | 'actor_role_code' | 'agent_profile_name'> & {
    actor_user_type?: string | null;
  },
): string {
  const parts: string[] = [];
  const role = roleLabel(row.actor_role_code, row.actor_user_type);
  if (role !== '—') parts.push(role);
  if (row.actor_username && row.actor_display_name !== row.actor_username) parts.push(`@${row.actor_username}`);
  if (row.agent_profile_name) parts.push(`وكيل: ${row.agent_profile_name}`);
  return parts.join(' · ') || '—';
}
