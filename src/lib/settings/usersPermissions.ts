export type PermissionAction = 'view' | 'create' | 'edit' | 'delete' | 'print' | 'export' | 'approve';

export interface PermissionGroupDefinition {
  id: string;
  label: string;
  actions: PermissionAction[];
}

export type UserPermissionMatrix = Record<string, Record<PermissionAction, boolean>>;

export const PERMISSION_GROUPS: PermissionGroupDefinition[] = [
  { id: 'dashboard', label: 'Dashboard', actions: ['view'] },
  { id: 'shipments', label: 'Shipments', actions: ['view', 'create', 'edit', 'delete', 'print', 'export', 'approve'] },
  { id: 'delivery', label: 'Delivery', actions: ['view', 'create', 'edit', 'print', 'export', 'approve'] },
  { id: 'customers', label: 'Customers', actions: ['view', 'create', 'edit', 'delete', 'export'] },
  { id: 'senders_receivers', label: 'Senders/Receivers', actions: ['view', 'create', 'edit', 'delete'] },
  { id: 'vehicles_drivers', label: 'Vehicles/Drivers', actions: ['view', 'create', 'edit', 'delete', 'print'] },
  { id: 'finance', label: 'Finance', actions: ['view', 'create', 'edit', 'delete', 'approve', 'export'] },
  { id: 'vouchers', label: 'Vouchers', actions: ['view', 'create', 'edit', 'delete', 'print', 'approve'] },
  { id: 'reports', label: 'Reports', actions: ['view', 'print', 'export'] },
  { id: 'settings', label: 'Settings', actions: ['view', 'edit'] },
  { id: 'users_permissions', label: 'Users & Permissions', actions: ['view', 'create', 'edit', 'delete', 'approve'] },
  { id: 'printing', label: 'Printing', actions: ['view', 'print'] },
  { id: 'branches_agents', label: 'Branches/Agents', actions: ['view', 'create', 'edit', 'delete'] },
  { id: 'backup_restore', label: 'Backup/Restore', actions: ['view', 'create', 'approve'] },
  { id: 'exchange_rates', label: 'Exchange Rates', actions: ['view', 'edit', 'approve'] },
  { id: 'terminology', label: 'Terminology', actions: ['view', 'edit'] },
];

function createEmptyMatrix(): UserPermissionMatrix {
  return PERMISSION_GROUPS.reduce((acc, group) => {
    acc[group.id] = group.actions.reduce((a, action) => {
      a[action] = false;
      return a;
    }, {} as Record<PermissionAction, boolean>);
    return acc;
  }, {} as UserPermissionMatrix);
}

function allowAll(matrix: UserPermissionMatrix): UserPermissionMatrix {
  const clone: UserPermissionMatrix = structuredClone(matrix);
  PERMISSION_GROUPS.forEach((group) => {
    group.actions.forEach((action) => {
      clone[group.id][action] = true;
    });
  });
  return clone;
}

function allowViewOnly(matrix: UserPermissionMatrix): UserPermissionMatrix {
  const clone: UserPermissionMatrix = structuredClone(matrix);
  PERMISSION_GROUPS.forEach((group) => {
    group.actions.forEach((action) => {
      clone[group.id][action] = action === 'view';
    });
  });
  return clone;
}

function allowOperational(matrix: UserPermissionMatrix): UserPermissionMatrix {
  const clone = allowViewOnly(matrix);
  ['shipments', 'delivery', 'customers', 'senders_receivers', 'printing'].forEach((groupId) => {
    if (!clone[groupId]) return;
    ['create', 'edit', 'print'].forEach((action) => {
      const typedAction = action as PermissionAction;
      if (typedAction in clone[groupId]) clone[groupId][typedAction] = true;
    });
  });
  return clone;
}

function allowFinance(matrix: UserPermissionMatrix): UserPermissionMatrix {
  const clone = allowViewOnly(matrix);
  ['finance', 'vouchers', 'reports', 'exchange_rates', 'printing'].forEach((groupId) => {
    if (!clone[groupId]) return;
    ['create', 'edit', 'print', 'export'].forEach((action) => {
      const typedAction = action as PermissionAction;
      if (typedAction in clone[groupId]) clone[groupId][typedAction] = true;
    });
  });
  return clone;
}

export type UserRole =
  | 'system_admin'
  | 'accountant'
  | 'entry_clerk'
  | 'delivery_officer'
  | 'operator'
  | 'viewer'
  | 'agent'
  | 'custom';

export const USER_ROLE_LABELS: Record<UserRole, string> = {
  system_admin: 'مدير النظام',
  accountant: 'محاسب',
  entry_clerk: 'موظف إدخال',
  delivery_officer: 'موظف تسليم',
  operator: 'مشغل',
  viewer: 'مراقب',
  agent: 'وكيل',
  custom: 'مخصص',
};

export function createRolePermissions(role: UserRole): UserPermissionMatrix {
  const empty = createEmptyMatrix();
  if (role === 'system_admin') return allowAll(empty);
  if (role === 'accountant') return allowFinance(empty);
  if (role === 'entry_clerk' || role === 'delivery_officer' || role === 'operator') return allowOperational(empty);
  if (role === 'viewer') return allowViewOnly(empty);
  if (role === 'agent') {
    const agent = allowViewOnly(empty);
    ['shipments', 'delivery', 'reports', 'printing'].forEach((groupId) => {
      if (!agent[groupId]) return;
      ['create', 'print'].forEach((action) => {
        const typedAction = action as PermissionAction;
        if (typedAction in agent[groupId]) agent[groupId][typedAction] = true;
      });
    });
    return agent;
  }
  return empty;
}

export function countEnabledPermissions(matrix: UserPermissionMatrix): number {
  return PERMISSION_GROUPS.reduce((sum, group) => {
    const count = group.actions.filter((action) => matrix[group.id]?.[action]).length;
    return sum + count;
  }, 0);
}
