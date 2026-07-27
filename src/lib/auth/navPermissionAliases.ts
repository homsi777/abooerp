/** Nav visibility: one menu permission may match several stored role codes (same as backend requireAnyPermissions). */
export const NAV_PERMISSION_ALIASES: Record<string, string[]> = {
  'finance.read': [
    'finance.read',
    'finance.write',
    'finance.view',
    'finance.debit_credit.view',
    'finance.account_statement.view',
  ],
  'finance.cashboxes.view': ['finance.cashboxes.view', 'finance.cashbox.read'],
  'finance.vouchers.view': ['finance.vouchers.view', 'finance.vouchers.read'],
};

export function resolveNavPermissionCodes(permission?: string, permissionsAny?: string[]): string[] {
  if (permissionsAny?.length) return permissionsAny;
  if (!permission) return [];
  return NAV_PERMISSION_ALIASES[permission] ?? [permission];
}

export function hasAnyNavPermission(
  userPermissions: string[] | undefined,
  permission?: string,
  permissionsAny?: string[],
): boolean {
  const required = resolveNavPermissionCodes(permission, permissionsAny);
  if (!required.length) return true;
  if (!userPermissions?.length) return false;
  const set = new Set(userPermissions);
  return required.some((code) => set.has(code));
}
