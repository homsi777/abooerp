import {
  createRolePermissions,
  type UserPermissionMatrix,
  type UserRole,
} from './usersPermissions';

export type UserType = 'local' | 'remote_agent';
export type UserStatus = 'active' | 'inactive' | 'suspended';

export interface AdminUser {
  id: string;
  fullName: string;
  username: string;
  password: string;
  phone: string;
  email?: string;
  role: UserRole;
  userType: UserType;
  status: UserStatus;
  defaultBranch?: string;
  linkedAgentOffice?: string;
  notes?: string;
  lastActivity: string;
  permissions: UserPermissionMatrix;
  archived?: boolean;
}

export const USERS_SETTINGS_STORAGE_KEY = 'settings-users-administration';

export const BRANCH_OPTIONS = ['الفرع الرئيسي - دمشق', 'فرع حلب', 'فرع حمص', 'فرع اللاذقية'];
export const AGENT_OFFICE_OPTIONS = ['وكيل حلب', 'وكيل إدلب', 'وكيل الساحل', 'وكيل دير الزور'];

const defaultUsers: AdminUser[] = [
  {
    id: 'usr-001',
    fullName: 'محمد عبد الهادي',
    username: 'admin.main',
    password: '123456',
    phone: '0933000001',
    email: 'admin@shahn.local',
    role: 'system_admin',
    userType: 'local',
    status: 'active',
    defaultBranch: 'الفرع الرئيسي - دمشق',
    lastActivity: '2026-04-22 10:15',
    notes: 'مسؤول النظام المركزي',
    permissions: createRolePermissions('system_admin'),
  },
  {
    id: 'usr-002',
    fullName: 'خالد أحمد',
    username: 'acc.damascus',
    password: '123456',
    phone: '0933000002',
    role: 'accountant',
    userType: 'local',
    status: 'active',
    defaultBranch: 'الفرع الرئيسي - دمشق',
    lastActivity: '2026-04-22 09:55',
    notes: 'محاسب الفرع الرئيسي',
    permissions: createRolePermissions('accountant'),
  },
  {
    id: 'usr-003',
    fullName: 'سالم علي',
    username: 'entry.homs',
    password: '123456',
    phone: '0933000003',
    role: 'entry_clerk',
    userType: 'local',
    status: 'active',
    defaultBranch: 'فرع حمص',
    lastActivity: '2026-04-22 09:10',
    notes: 'إدخال شحنات',
    permissions: createRolePermissions('entry_clerk'),
  },
  {
    id: 'usr-004',
    fullName: 'رامي ناصر',
    username: 'delivery.aleppo',
    password: '123456',
    phone: '0933000004',
    role: 'delivery_officer',
    userType: 'local',
    status: 'active',
    defaultBranch: 'فرع حلب',
    lastActivity: '2026-04-22 08:45',
    notes: 'مسؤول تسليم',
    permissions: createRolePermissions('delivery_officer'),
  },
  {
    id: 'usr-005',
    fullName: 'وكيل الساحل',
    username: 'agent.coast',
    password: '123456',
    phone: '0933000005',
    role: 'agent',
    userType: 'remote_agent',
    status: 'active',
    linkedAgentOffice: 'وكيل الساحل',
    lastActivity: '2026-04-21 22:10',
    notes: 'وكيل بعيد مرتبط سحابيًا',
    permissions: createRolePermissions('agent'),
  },
  {
    id: 'usr-006',
    fullName: 'نور حسام',
    username: 'viewer.audit',
    password: '123456',
    phone: '0933000006',
    role: 'viewer',
    userType: 'local',
    status: 'suspended',
    defaultBranch: 'الفرع الرئيسي - دمشق',
    lastActivity: '2026-04-18 14:00',
    notes: 'معلق بسبب مراجعة الصلاحيات',
    permissions: createRolePermissions('viewer'),
  },
];

function readJson<T>(key: string, fallback: T): T {
  if (typeof window === 'undefined') return fallback;
  try {
    const raw = window.localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : fallback;
  } catch {
    return fallback;
  }
}

export function getAdminUsers(): AdminUser[] {
  const users = readJson(USERS_SETTINGS_STORAGE_KEY, defaultUsers);
  return users.map((user) => ({
    ...user,
    permissions: user.permissions || createRolePermissions(user.role),
  }));
}

export function saveAdminUsers(users: AdminUser[]): void {
  if (typeof window === 'undefined') return;
  window.localStorage.setItem(USERS_SETTINGS_STORAGE_KEY, JSON.stringify(users));
}

export function generateUserId(): string {
  return `usr-${Date.now()}`;
}
