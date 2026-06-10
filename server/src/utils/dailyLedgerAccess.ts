/** أدوار ترى كل إدخالات دفتر الشحن (كل الموظفين) ضمن نطاق الفرع */
const DAILY_LEDGER_MANAGER_VIEW_ROLES = new Set(['general_manager', 'branch_manager', 'manager']);

export const DAILY_LEDGER_VIEW_ALL_PERMISSION = 'daily_ledger.view_all_entries';

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
  if (role === 'data_entry' && userId) return userId;
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
