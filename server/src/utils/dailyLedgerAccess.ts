/** أدوار ترى كل إدخالات دفتر الشحن (كل الموظفين) ضمن نطاق الفرع */
const DAILY_LEDGER_MANAGER_VIEW_ROLES = new Set(['general_manager', 'branch_manager', 'manager']);

export function canViewAllDailyLedgerEntries(roleCode: string, userType: string): boolean {
  const role = String(roleCode ?? '').toLowerCase();
  if (role === 'admin' || userType === 'admin') return true;
  return DAILY_LEDGER_MANAGER_VIEW_ROLES.has(role);
}

/** عند المدير: undefined (كل الأسطر). عند مدخل البيانات: معرّف المستخدم الحالي فقط */
export function dailyLedgerOwnerUserId(
  roleCode: string,
  userType: string,
  userId: string | undefined,
): string | undefined {
  if (canViewAllDailyLedgerEntries(roleCode, userType)) return undefined;
  if (String(roleCode ?? '').toLowerCase() === 'data_entry' && userId) return userId;
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
