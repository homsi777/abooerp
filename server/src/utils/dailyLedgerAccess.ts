/** أدوار ترى كل إدخالات دفتر الشحن (كل الموظفين) — مثل المدير */
const DAILY_LEDGER_MANAGER_VIEW_ROLES = new Set([
  'general_manager',
  'branch_manager',
  'manager',
  'shipment_auditor',
]);

/** مدخل البيانات فقط: يرى إدخالاته ويُقفل فرعه */
export const DAILY_LEDGER_SCOPED_OPERATOR_ROLES = new Set(['data_entry']);

export const DAILY_LEDGER_VIEW_ALL_PERMISSION = 'daily_ledger.view_all_entries';
export const DAILY_LEDGER_EXPORT_PDF_PERMISSION = 'daily_ledger.export_pdf';
export const DAILY_LEDGER_CLOSE_SECTION_PERMISSION = 'daily_ledger.close_section';
export const DAILY_LEDGER_SAVE_LOG_PERMISSION = 'daily_ledger.save_log';
export const DAILY_LEDGER_VIEW_LOADED_PERMISSION = 'daily_ledger.view_loaded';
export const DAILY_LEDGER_DELETE_ROWS_PERMISSION = 'daily_ledger.delete_rows';
export const DAILY_LEDGER_POST_SHIPMENTS_PERMISSION = 'daily_ledger.post_shipments';
export const DAILY_LEDGER_TRANSFER_CREATE_PERMISSION = 'daily_ledger.transfer.create';
export const DAILY_LEDGER_CANCEL_SESSION_PERMISSION = 'daily_ledger.session.cancel';

export function isDailyLedgerScopedOperator(roleCode: string): boolean {
  return DAILY_LEDGER_SCOPED_OPERATOR_ROLES.has(String(roleCode ?? '').toLowerCase());
}

function isDailyLedgerManager(roleCode: string, userType: string): boolean {
  const role = String(roleCode ?? '').toLowerCase();
  return role === 'admin' || userType === 'admin' || DAILY_LEDGER_MANAGER_VIEW_ROLES.has(role);
}

export function canUseDailyLedgerAction(
  roleCode: string,
  userType: string,
  permissions: string[],
  permissionCode: string,
): boolean {
  if (isDailyLedgerManager(roleCode, userType)) return true;
  return permissions.includes(permissionCode);
}

export function canViewAllDailyLedgerEntries(
  roleCode: string,
  userType: string,
  permissions: string[] = [],
): boolean {
  const role = String(roleCode ?? '').toLowerCase();
  if (role === 'admin' || userType === 'admin') return true;
  if (DAILY_LEDGER_MANAGER_VIEW_ROLES.has(role)) return true;
  return permissions.includes(DAILY_LEDGER_VIEW_ALL_PERMISSION);
}

/** عند المدير: undefined (كل الأسطر). عند مدخل البيانات: معرّف المستخدم الحالي فقط */
export function dailyLedgerOwnerUserId(
  roleCode: string,
  userType: string,
  userId: string | undefined,
  permissions: string[] = [],
): string | undefined {
  const role = String(roleCode ?? '').toLowerCase();
  if (isDailyLedgerScopedOperator(role) && userId) return userId;
  if (canViewAllDailyLedgerEntries(roleCode, userType, permissions)) return undefined;
  return undefined;
}

/** أدوار يُمنح لها كل فروع الشركة عند غياب ربط user_branches */
export function shouldExpandCompanyBranches(roleCode: string, userType: string): boolean {
  const role = String(roleCode ?? '').toLowerCase();
  if (role === 'admin' || userType === 'admin') return true;
  return DAILY_LEDGER_MANAGER_VIEW_ROLES.has(role);
}

export function canAccessAnyCompanyBranch(roleCode: string, userType: string): boolean {
  return shouldExpandCompanyBranches(roleCode, userType);
}
