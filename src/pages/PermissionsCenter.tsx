import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { httpClient } from '../lib/api/httpClient';

type UserType = 'admin' | 'employee' | 'agent' | 'accountant' | 'branch_supervisor' | 'delivery' | 'viewer';
type UserRow = {
  id: string;
  username: string;
  full_name: string;
  role_name: string;
  role_id: string;
  user_type: UserType;
  default_branch_id: string | null;
  branch_ids: string[];
  agent_name: string | null;
  agent_id: string | null;
  status: string;
  is_active?: boolean;
  last_login_at: string | null;
};
type RoleRow = { id: string; code: string; name: string; permissions: string[]; is_active: boolean };
type BranchRow = { id: string; name: string };
type AgentRow = { id: string; name: string; code: string; branch_id?: string | null; governorate?: string | null; city?: string | null; area?: string | null; is_active: boolean };
type PermissionRow = { code: string; name?: string; module?: string; action?: string };
type PermissionOverview = { users: number; roles: number; permissions: number; agents: number; branches: number };
type PermissionTemplate = {
  code: string;
  name: string;
  roleCode: string;
  userType: UserType;
  description: string;
  modules: string[];
  permissionCodes: string[];
};

type UserForm = {
  id?: string;
  username: string;
  full_name: string;
  password: string;
  role_id: string;
  user_type: UserType;
  agent_id: string;
  branch_ids: string[];
  status: 'active' | 'inactive' | 'locked';
};

const userTypeAr: Record<UserType, string> = {
  admin: 'مدير عام',
  employee: 'مدخل البيانات',
  agent: 'وكيل',
  accountant: 'محاسب',
  branch_supervisor: 'وكيل',
  delivery: 'مدخل البيانات',
  viewer: 'مشاهدة فقط',
};

const simplifiedUserTypeChoices: Array<{ value: UserType; label: string }> = [
  { value: 'admin', label: 'مدير عام' },
  { value: 'agent', label: 'وكيل' },
  { value: 'accountant', label: 'محاسب' },
  { value: 'employee', label: 'مدخل البيانات' },
  { value: 'viewer', label: 'مشاهدة فقط' },
];

const mainRoleCodes = new Set(['admin', 'agent_user', 'accountant', 'data_entry', 'viewer']);
const legacyRoleCodes = new Set(['general_manager', 'branch_manager', 'field_accountant']);

const categoryOrder = [
  'الشحنات',
  'الوكلاء',
  'الفروع',
  'المالية',
  'الدائن والمدين',
  'كشف الحساب',
  'التقارير',
  'الإعدادات',
  'المستخدمون والصلاحيات',
  'بوابة الوكيل',
  'الإدارة العليا',
  'أخرى',
];

const permissionArabicMeta: Record<string, { label: string; description: string; recommendedForAgent?: boolean }> = {
  'shipments.read': { label: 'عرض الشحنات', description: 'يسمح برؤية قوائم الشحنات ضمن نطاق المستخدم.', recommendedForAgent: true },
  'shipments.write': { label: 'إضافة وتعديل الشحنات', description: 'يسمح بإنشاء أو تعديل بيانات الشحنات.' },
  'shipments.create': { label: 'إنشاء شحنة', description: 'يسمح بإنشاء شحنة جديدة.' },
  'shipments.update': { label: 'تعديل شحنة', description: 'يسمح بتعديل بيانات الشحنة.' },
  'shipments.confirm': { label: 'تأكيد الشحنة', description: 'يسمح بتأكيد الشحنة ضمن دورة العمل.' },
  'shipments.cancel': { label: 'إلغاء الشحنة', description: 'يسمح بإلغاء الشحنة عند توفر شروط الإلغاء.' },
  'shipments.handover_agent': { label: 'تسليم الشحنة للوكيل', description: 'يسمح بتحويل الشحنة إلى الوكيل المسؤول.' },
  'shipments.agent_received': { label: 'تأكيد استلام الوكيل', description: 'يسمح بتسجيل أن الوكيل استلم الشحنة.', recommendedForAgent: true },
  'shipments.out_for_delivery': { label: 'خروج الشحنة للتسليم', description: 'يسمح بتغيير الحالة إلى خارجة للتسليم.', recommendedForAgent: true },
  'shipments.deliver': { label: 'تأكيد تسليم الشحنة', description: 'يسمح بتأكيد تسليم الشحنة للعميل.', recommendedForAgent: true },
  'shipments.return': { label: 'إرجاع الشحنة', description: 'يسمح بتسجيل إرجاع الشحنة.' },
  'manifests.read': { label: 'عرض منافيست الشحن', description: 'يسمح بعرض كشوف تحميل الشحنات.' },
  'manifests.write': { label: 'إدارة منافيست الشحن', description: 'يسمح بإنشاء وتعديل كشوف التحميل.' },
  'deliveries.read': { label: 'عرض التسليم', description: 'يسمح بعرض عمليات التسليم.' },
  'deliveries.write': { label: 'إدارة التسليم', description: 'يسمح بتعديل عمليات التسليم.' },

  'agent_portal.view': { label: 'دخول بوابة الوكيل', description: 'الصلاحية الأساسية التي تسمح للوكيل بفتح بوابة شحناته.', recommendedForAgent: true },
  'agent_portal.status_action': { label: 'تحديث حالات شحنات الوكيل', description: 'يسمح للوكيل بتنفيذ إجراءات الحالة المسموحة على شحناته فقط.', recommendedForAgent: true },

  'agents.view': { label: 'عرض الوكلاء', description: 'يسمح بعرض بيانات الوكلاء.' },
  'agents.manage': { label: 'إدارة الوكلاء', description: 'يسمح بإضافة وتعديل وتعطيل الوكلاء.' },
  'settings.agents.read': { label: 'عرض إدارة الوكلاء', description: 'يسمح بفتح شاشة الوكلاء.' },
  'settings.agents.write': { label: 'تعديل إدارة الوكلاء', description: 'يسمح بحفظ تغييرات الوكلاء.' },

  'branches.view': { label: 'عرض الفروع', description: 'يسمح بعرض بيانات الفروع.' },
  'branches.manage': { label: 'إدارة الفروع', description: 'يسمح بإضافة وتعديل وتعطيل الفروع.' },
  'settings.branches.read': { label: 'عرض إدارة الفروع', description: 'يسمح بفتح شاشة الفروع.' },
  'settings.branches.write': { label: 'تعديل إدارة الفروع', description: 'يسمح بحفظ تغييرات الفروع.' },

  'finance.read': { label: 'عرض المالية', description: 'يسمح بفتح الأقسام المالية العامة.' },
  'finance.vouchers.read': { label: 'عرض السندات', description: 'يسمح بعرض سندات القبض والدفع.' },
  'finance.vouchers.write': { label: 'إدارة السندات', description: 'يسمح بإنشاء وتعديل السندات.' },
  'finance.vouchers.manage': { label: 'إدارة السندات', description: 'يسمح بإدارة سندات القبض والدفع.' },
  'finance.cashbox.read': { label: 'عرض الصناديق (قديم)', description: 'قديم — يُفضَّل استخدام finance.cashboxes.view.' },
  'finance.cashbox.write': { label: 'إدارة الصناديق (قديم)', description: 'قديم — يُفضَّل استخدام finance.cashboxes.manage.' },
  'finance.cashboxes.view': { label: 'عرض تعريف الصناديق', description: 'عرض قائمة الصناديق ضمن النطاق المسموح.' },
  'finance.cashboxes.manage': { label: 'إدارة تعريف الصناديق', description: 'إنشاء وتعديل وتفعيل/تعطيل الصناديق.' },
  'finance.cashboxes.movements.view': { label: 'عرض حركات الصندوق', description: 'عرض حركات صندوق محدد ضمن النطاق.' },
  'finance.vouchers.create': { label: 'إنشاء السندات', description: 'إنشاء سندات قبض أو دفع جديدة.' },
  'finance.vouchers.view': { label: 'عرض السندات', description: 'عرض قائمة السندات وسندات القبض والدفع ضمن النطاق.' },
  'finance.vouchers.update': { label: 'تعديل السندات', description: 'تعديل أو تأكيد أو إلغاء السندات بعد الإنشاء.' },
  'finance.vouchers.delete': { label: 'حذف السندات', description: 'حذف السندات (إن كان مسموحاً في النظام).' },
  'finance.debit_credit.view': { label: 'عرض الدائن والمدين', description: 'يسمح بفتح مركز الدائن والمدين.' },
  'finance.account_statement.view': { label: 'عرض كشف الحساب', description: 'يسمح بفتح كشف الحساب التفصيلي.' },

  'reports.view': { label: 'عرض التقارير', description: 'يسمح بعرض التقارير.' },
  'settings.view': { label: 'عرض الإعدادات', description: 'يسمح بفتح الإعدادات العامة.' },
  'settings.users.read': { label: 'عرض المستخدمين', description: 'يسمح بعرض المستخدمين من الإعدادات القديمة.' },
  'settings.users.write': { label: 'إدارة المستخدمين', description: 'يسمح بإضافة وتعديل المستخدمين.' },
  'settings.roles.read': { label: 'عرض الأدوار', description: 'يسمح بعرض الأدوار.' },
  'settings.roles.write': { label: 'إدارة الأدوار', description: 'يسمح بتعديل الأدوار وصلاحياتها.' },
  'permissions.view': { label: 'عرض مركز الصلاحيات', description: 'يسمح بفتح مركز الصلاحيات.' },
  'permissions.manage': { label: 'إدارة مركز الصلاحيات', description: 'يسمح بتعديل أدوار وصلاحيات المستخدمين.' },
  'users.manage': { label: 'إدارة المستخدمين والصلاحيات', description: 'يسمح بإدارة المستخدمين ونطاقات وصولهم.' },
  'admin.events.read': {
    label: 'سجل الأحداث (المدير العام)',
    description: 'عرض سجل تفصيلي لجميع أحداث المستخدمين والوكلاء (شحن، مالية، تسجيل دخول، …) مع التاريخ والوقت والبيانات المرفقة.',
  },
};

const actionArabic: Record<string, string> = {
  read: 'عرض',
  write: 'إدارة',
  manage: 'إدارة كاملة',
  create: 'إنشاء',
  update: 'تعديل',
  delete: 'حذف',
};

const recommendedAgentPermissionCodes = [
  'agent_portal.view',
  'agent_portal.status_action',
  'shipments.read',
  'shipments.agent_received',
  'shipments.out_for_delivery',
  'shipments.deliver',
];

const roleTemplates: PermissionTemplate[] = [
  {
    code: 'admin',
    name: 'المدير العام',
    roleCode: 'admin',
    userType: 'admin',
    description: 'مالك النظام أو المدير الرئيسي. يرى ويدير كل وحدات الشركة.',
    modules: ['كل الوحدات', 'الشحنات', 'الوكلاء', 'الفروع', 'المالية', 'التقارير', 'المستخدمون والصلاحيات', 'الإعدادات'],
    permissionCodes: [],
  },
  {
    code: 'agent_user',
    name: 'الوكيل',
    roleCode: 'agent_user',
    userType: 'agent',
    description: 'بوابة الوكيل وشحناته فقط، مع إجراءات الحالة المسموحة ضمن نطاق الوكيل والوجهة.',
    modules: ['بوابة الوكيل', 'شحناتي'],
    permissionCodes: ['agent_portal.view','agent_portal.status_action','shipments.read','shipments.view','shipments.agent_received','shipments.mark_in_transit','shipments.mark_arrived','shipments.out_for_delivery','shipments.deliver'],
  },
  {
    code: 'data_entry',
    name: 'مدخل البيانات',
    roleCode: 'data_entry',
    userType: 'employee',
    description: 'إدخال وتعديل الشحنات ضمن الفروع المسموحة، مع الحوالات التشغيلية عند منح الصلاحية.',
    modules: ['دفتر الشحن اليومي', 'إدخال شحنة', 'قائمة الشحنات', 'الحوالات'],
    permissionCodes: [
      'shipments.read',
      'shipments.write',
      'shipments.view',
      'shipments.create',
      'shipments.update',
      'transfers.read',
      'transfers.write',
    ],
  },
  {
    code: 'accountant',
    name: 'المحاسب',
    roleCode: 'accountant',
    userType: 'accountant',
    description: 'المالية والسندات وكشف الحساب والدائن والمدين مع عرض الشحنات كمرجع.',
    modules: ['المالية', 'السندات', 'الصناديق', 'الدائن والمدين', 'كشف الحساب', 'التقارير المالية'],
    permissionCodes: ['finance.read','finance.write','finance.view','finance.vouchers.read','finance.vouchers.write','finance.vouchers.manage','finance.debit_credit.view','finance.account_statement.view','finance.cashbox.read','finance.cashbox.write','reports.view','shipments.read','shipments.view'],
  },
  {
    code: 'viewer',
    name: 'مشاهدة فقط',
    roleCode: 'viewer',
    userType: 'viewer',
    description: 'عرض محدود بدون أي إجراءات تعديل أو حفظ.',
    modules: ['قوائم مقروءة فقط'],
    permissionCodes: ['shipments.read','shipments.view'],
  },
];

const templateByUserType: Partial<Record<UserType, string>> = {
  admin: 'admin',
  branch_supervisor: 'agent_user',
  agent: 'agent_user',
  employee: 'data_entry',
  delivery: 'data_entry',
  accountant: 'accountant',
  viewer: 'viewer',
};

function permissionMeta(permission: PermissionRow | string) {
  const code = typeof permission === 'string' ? permission : permission.code;
  const row = typeof permission === 'string' ? undefined : permission;
  const known = permissionArabicMeta[code];
  if (known) return known;
  return {
    label: row?.name && !/^[A-Za-z0-9_.\-\s]+$/.test(row.name) ? row.name : arabicLabelFromCode(code),
    description: `صلاحية ضمن ${categoryForPermission(code)}. المفتاح التقني محفوظ للنظام: ${code}`,
  };
}

function arabicLabelFromCode(code: string) {
  const category = categoryForPermission(code);
  const action = code.endsWith('.read') || code.endsWith('.view') ? 'عرض'
    : code.endsWith('.write') || code.endsWith('.manage') ? 'إدارة'
      : code.endsWith('.create') ? 'إنشاء'
        : code.endsWith('.update') ? 'تعديل'
          : code.endsWith('.delete') ? 'حذف'
            : 'صلاحية';
  return `${action} ${category}`;
}

function categoryForPermission(code: string) {
  if (code.startsWith('shipments') || code.startsWith('manifests') || code.startsWith('deliveries')) return 'الشحنات';
  if (code.startsWith('agents') || code.includes('settings.agents')) return 'الوكلاء';
  if (code.startsWith('branches') || code.includes('settings.branches')) return 'الفروع';
  if (code.includes('debit_credit')) return 'الدائن والمدين';
  if (code.includes('account_statement')) return 'كشف الحساب';
  if (code.startsWith('finance')) return 'المالية';
  if (code.startsWith('reports')) return 'التقارير';
  if (code.startsWith('settings')) return 'الإعدادات';
  if (code.startsWith('users') || code.startsWith('permissions') || code.includes('settings.users') || code.includes('settings.roles')) return 'المستخدمون والصلاحيات';
  if (code.startsWith('agent_portal')) return 'بوابة الوكيل';
  if (code.startsWith('admin.')) return 'الإدارة العليا';
  return 'أخرى';
}

function emptyUserForm(defaultRoleId = ''): UserForm {
  return {
    username: '',
    full_name: '',
    password: '',
    role_id: defaultRoleId,
    user_type: 'employee',
    agent_id: '',
    branch_ids: [],
    status: 'active',
  };
}

export default function PermissionsCenter() {
  const navigate = useNavigate();
  const [tab, setTab] = useState<'users' | 'roles' | 'permissions' | 'templates' | 'scopes' | 'agents'>('users');
  const [users, setUsers] = useState<UserRow[]>([]);
  const [roles, setRoles] = useState<RoleRow[]>([]);
  const [permissionRows, setPermissionRows] = useState<PermissionRow[]>([]);
  const [permissionCodes, setPermissionCodes] = useState<string[]>([]);
  const [branches, setBranches] = useState<BranchRow[]>([]);
  const [agents, setAgents] = useState<AgentRow[]>([]);
  const [overview, setOverview] = useState<PermissionOverview | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [userForm, setUserForm] = useState<UserForm | null>(null);
  const [scopeUserId, setScopeUserId] = useState<string>('');
  const [selectedRoleId, setSelectedRoleId] = useState<string>('');
  const [selectedRolePermissions, setSelectedRolePermissions] = useState<Set<string>>(new Set());

  const load = async () => {
    setLoading(true);
    setError('');
    try {
      const [usersData, rolesData, branchesData, agentsData, overviewData, permissionsData] = await Promise.all([
        httpClient.get<UserRow[]>('/users'),
        httpClient.get<{ roles: RoleRow[]; permissionCodes: string[] }>('/roles'),
        httpClient.get<BranchRow[]>('/branches?includeInactive=true'),
        httpClient.get<AgentRow[]>('/agents?includeInactive=true'),
        httpClient.get<PermissionOverview>('/permissions/overview'),
        httpClient.get<PermissionRow[]>('/permissions').catch(() => []),
      ]);
      setUsers(usersData);
      setRoles(rolesData.roles);
      setPermissionCodes(permissionsData.length ? permissionsData.map((row) => row.code) : rolesData.permissionCodes);
      setPermissionRows(permissionsData);
      setBranches(branchesData);
      setAgents(agentsData);
      setOverview(overviewData);
      if (!selectedRoleId && rolesData.roles[0]) {
        setSelectedRoleId(rolesData.roles[0].id);
        setSelectedRolePermissions(new Set(rolesData.roles[0].permissions));
      }
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : 'تعذر تحميل بيانات مركز الصلاحيات.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void load();
  }, []);

  const branchNameById = useMemo(() => new Map(branches.map((b) => [b.id, b.name])), [branches]);
  const agentNameById = useMemo(() => new Map(agents.map((a) => [a.id, `${a.code} - ${a.name}`])), [agents]);
  const selectedRole = roles.find((role) => role.id === selectedRoleId) || null;
  const scopeUser = users.find((user) => user.id === scopeUserId) || null;
  const mainRoleOptions = useMemo(() => {
    const currentRoleId = userForm?.role_id || scopeUser?.role_id || '';
    return roles.filter((role) => mainRoleCodes.has(role.code) || role.id === currentRoleId);
  }, [roles, userForm?.role_id, scopeUser?.role_id]);
  const groupedPermissions = useMemo(() => {
    const rows = permissionCodes.map((code) => permissionRows.find((row) => row.code === code) || { code });
    const grouped = new Map<string, PermissionRow[]>();
    rows.forEach((row) => {
      const category = categoryForPermission(row.code);
      grouped.set(category, [...(grouped.get(category) || []), row]);
    });
    return categoryOrder.map((category) => [category, grouped.get(category) || []] as const).filter(([, items]) => items.length > 0);
  }, [permissionCodes, permissionRows]);
  const unlinkedAgentUsers = users.filter((user) => user.user_type === 'agent' && !user.agent_id);

  const startCreateUser = () => {
    setError('');
    setSuccess('');
    setUserForm(emptyUserForm(roles[0]?.id || ''));
    setTab('users');
  };

  const startEditUser = (user: UserRow) => {
    setError('');
    setSuccess('');
    setUserForm({
      id: user.id,
      username: user.username,
      full_name: user.full_name,
      password: '',
      role_id: user.role_id,
      user_type: user.user_type,
      agent_id: user.agent_id || '',
      branch_ids: user.branch_ids || [],
      status: user.status === 'inactive' || user.status === 'locked' ? user.status : 'active',
    });
    setTab('users');
  };

  const saveUser = async () => {
    if (!userForm) return;
    const username = userForm.username.trim();
    const fullName = userForm.full_name.trim();
    const password = userForm.password.trim();
    if (username.length < 3) {
      setError('اسم المستخدم يجب أن يكون 3 أحرف على الأقل.');
      return;
    }
    if (!fullName) {
      setError('الاسم الكامل مطلوب.');
      return;
    }
    if (!userForm.role_id) {
      setError('يجب اختيار دور للمستخدم. إذا لم تظهر الأدوار، حدّث الصفحة أو راجع إعدادات الأدوار.');
      return;
    }
    if (!userForm.id && password.length < 6) {
      setError('كلمة المرور مطلوبة عند إضافة مستخدم جديد ويجب أن تكون 6 أحرف على الأقل.');
      return;
    }
    if (userForm.id && password && password.length < 6) {
      setError('كلمة المرور الجديدة يجب أن تكون 6 أحرف على الأقل.');
      return;
    }
    if (userForm.user_type === 'agent' && !userForm.agent_id) {
      setError('هذا المستخدم من نوع وكيل لكنه غير مرتبط بأي وكيل.');
      return;
    }
    if (userForm.user_type !== 'admin' && userForm.branch_ids.length === 0) {
      setError('يجب تحديد فرع واحد على الأقل للمستخدم غير الإداري.');
      return;
    }

    setSaving(true);
    setError('');
    try {
      const payload: any = {
        username,
        full_name: fullName,
        role_id: userForm.role_id,
        user_type: userForm.user_type,
        agent_id: userForm.agent_id || null,
        status: userForm.status,
        is_active: userForm.status === 'active',
      };
      if (password) payload.password = password;
      if (userForm.id) {
        await httpClient.put(`/users/${userForm.id}`, payload);
        await httpClient.post(`/users/${userForm.id}/access-scope`, {
          role_id: userForm.role_id,
          user_type: userForm.user_type,
          agent_id: userForm.agent_id || null,
          branchIds: userForm.branch_ids,
        });
        setSuccess('تم تحديث المستخدم ونطاق الوصول بنجاح.');
      } else {
        await httpClient.post('/users', { ...payload, branch_ids: userForm.branch_ids });
        setSuccess('تمت إضافة المستخدم بنجاح.');
      }
      setUserForm(null);
      await load();
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : 'تعذر حفظ المستخدم.');
    } finally {
      setSaving(false);
    }
  };

  const toggleUser = async (user: UserRow) => {
    setSaving(true);
    setError('');
    try {
      const nextStatus = user.status === 'active' ? 'inactive' : 'active';
      await httpClient.put(`/users/${user.id}`, { status: nextStatus, is_active: nextStatus === 'active' });
      setSuccess(nextStatus === 'active' ? 'تم تفعيل المستخدم.' : 'تم تعطيل المستخدم.');
      await load();
    } catch (toggleError) {
      setError(toggleError instanceof Error ? toggleError.message : 'تعذر تغيير حالة المستخدم.');
    } finally {
      setSaving(false);
    }
  };

  const saveScope = async () => {
    if (!scopeUser) return;
    setSaving(true);
    setError('');
    try {
      await httpClient.post(`/users/${scopeUser.id}/access-scope`, {
        role_id: scopeUser.role_id,
        user_type: scopeUser.user_type,
        agent_id: scopeUser.agent_id,
        branchIds: scopeUser.branch_ids,
      });
      setSuccess('تم حفظ نطاق الوصول بنجاح.');
      await load();
    } catch (scopeError) {
      setError(scopeError instanceof Error ? scopeError.message : 'تعذر حفظ نطاق الوصول.');
    } finally {
      setSaving(false);
    }
  };

  const updateScopeDraft = (patch: Partial<UserRow>) => {
    if (!scopeUser) return;
    setUsers((prev) => prev.map((user) => user.id === scopeUser.id ? { ...user, ...patch } : user));
  };

  const chooseRole = (roleId: string) => {
    const role = roles.find((item) => item.id === roleId);
    setSelectedRoleId(roleId);
    setSelectedRolePermissions(new Set(role?.permissions || []));
  };

  const applyAgentPreset = () => {
    const available = new Set(permissionCodes);
    const next = new Set(selectedRolePermissions);
    recommendedAgentPermissionCodes.forEach((code) => {
      if (available.has(code)) next.add(code);
    });
    setSelectedRolePermissions(next);
    setSuccess('تم تحديد صلاحيات الوكيل الأساسية. راجعها ثم اضغط حفظ صلاحيات الدور.');
  };

  const findTemplateRole = (template: PermissionTemplate) => roles.find((role) => role.code === template.roleCode) || null;
  const selectedUserTemplate = userForm ? roleTemplates.find((template) => template.code === templateByUserType[userForm.user_type]) || null : null;

  const applyTemplateToRole = async (template: PermissionTemplate, explicitRoleId?: string) => {
    const targetRole = explicitRoleId ? roles.find((role) => role.id === explicitRoleId) || null : findTemplateRole(template);
    if (!targetRole) {
      setError(`لم يتم العثور على دور ${template.name}. شغّل التحديثات أو أنشئ الدور أولاً.`);
      return;
    }
    if (!window.confirm('سيتم تطبيق قالب الصلاحيات المناسب لهذا النوع. يمكنك التعديل عليه لاحقاً. هل تريد المتابعة؟')) return;
    const available = new Set(permissionCodes);
    const nextCodes = targetRole.code === 'admin'
      ? permissionCodes
      : template.permissionCodes.filter((code) => available.has(code));
    setSaving(true);
    setError('');
    try {
      await httpClient.post(`/roles/${targetRole.id}/permissions`, { permissionCodes: nextCodes });
      setSelectedRoleId(targetRole.id);
      setSelectedRolePermissions(new Set(nextCodes));
      setTab('roles');
      setSuccess(`تم تطبيق قالب ${template.name} على دور ${targetRole.name}. يمكنك تعديل الصلاحيات يدوياً ثم الحفظ عند الحاجة.`);
      await load();
    } catch (templateError) {
      setError(templateError instanceof Error ? templateError.message : 'تعذر تطبيق قالب الصلاحيات.');
    } finally {
      setSaving(false);
    }
  };

  const applyCurrentUserTemplate = async () => {
    if (!userForm || !selectedUserTemplate) return;
    const targetRole = findTemplateRole(selectedUserTemplate);
    if (targetRole) {
      setUserForm({ ...userForm, role_id: targetRole.id });
    }
    await applyTemplateToRole(selectedUserTemplate, targetRole?.id);
  };

  const changeUserType = (nextType: UserType) => {
    if (!userForm) return;
    const templateCode = templateByUserType[nextType];
    const template = roleTemplates.find((item) => item.code === templateCode);
    const suggestedRole = template ? roles.find((role) => role.code === template.roleCode) : null;
    setUserForm({
      ...userForm,
      user_type: nextType,
      role_id: suggestedRole?.id || userForm.role_id,
      agent_id: nextType === 'agent' ? userForm.agent_id : '',
    });
    if (template) {
      setSuccess(`تم اقتراح قالب ${template.name}. اضغط "تطبيق قالب الصلاحيات" لتحديث صلاحيات الدور بعد التأكيد.`);
    }
  };

  const saveRolePermissions = async () => {
    if (!selectedRole) return;
    if (selectedRole.code === 'admin' && !window.confirm('أنت تعدل صلاحيات المدير. هل تريد المتابعة؟')) return;
    if (selectedRole.code === 'admin' && selectedRolePermissions.size === 0) {
      setError('لا يمكن تفريغ صلاحيات دور المدير بالكامل.');
      return;
    }
    setSaving(true);
    setError('');
    try {
      await httpClient.post(`/roles/${selectedRole.id}/permissions`, { permissionCodes: [...selectedRolePermissions] });
      setSuccess('تم حفظ صلاحيات الدور بنجاح.');
      await load();
    } catch (roleError) {
      setError(roleError instanceof Error ? roleError.message : 'تعذر حفظ صلاحيات الدور.');
    } finally {
      setSaving(false);
    }
  };

  const branchCheckbox = (branch: BranchRow, values: string[], onChange: (next: string[]) => void) => (
    <label key={branch.id} className="flex items-center gap-2 text-sm">
      <input
        type="checkbox"
        checked={values.includes(branch.id)}
        onChange={(event) => onChange(event.target.checked ? [...values, branch.id] : values.filter((id) => id !== branch.id))}
      />
      {branch.name}
    </label>
  );

  return (
    <div className="h-full flex flex-col">
      <div className="mb-3 flex items-start justify-between gap-3">
        <div>
          <h2 className="text-xl font-bold">مركز الصلاحيات</h2>
          <p className="text-sm text-gray-600">إدارة الأدوار، صلاحيات المستخدمين، ونطاق وصول الوكلاء والفروع</p>
        </div>
        <button type="button" className="toolbar-btn primary" onClick={startCreateUser}>إضافة مستخدم</button>
      </div>

      <div className="permissions-command-bar">
        <div>
          <strong>مسار التجهيز التشغيلي</strong>
          <span>أنشئ الفرع، اربط الوكيل بالوجهة، ثم أنشئ مستخدم الوكيل وحدد نطاقه وصلاحياته.</span>
        </div>
        <div className="permissions-command-actions">
          <button type="button" className="toolbar-btn" onClick={() => navigate('/branches')}>إدارة الفروع</button>
          <button type="button" className="toolbar-btn" onClick={() => navigate('/agents')}>إدارة الوكلاء</button>
          <button type="button" className="toolbar-btn" onClick={() => navigate('/agent-portal')}>بوابة الوكيل</button>
        </div>
      </div>

      <div className="grid grid-cols-5 gap-2 mb-3">
        <div className="stat-card"><div className="stat-value">{overview?.users ?? '-'}</div><div className="stat-label">المستخدمون</div></div>
        <div className="stat-card"><div className="stat-value">{overview?.roles ?? '-'}</div><div className="stat-label">الأدوار</div></div>
        <div className="stat-card"><div className="stat-value">{overview?.permissions ?? '-'}</div><div className="stat-label">الصلاحيات</div></div>
        <div className="stat-card"><div className="stat-value">{overview?.agents ?? '-'}</div><div className="stat-label">الوكلاء</div></div>
        <div className="stat-card"><div className="stat-value">{overview?.branches ?? '-'}</div><div className="stat-label">الفروع</div></div>
      </div>

      <div className="card mb-3"><div className="flex gap-2">
        <button className={`toolbar-btn ${tab === 'users' ? 'primary' : ''}`} onClick={() => setTab('users')}>المستخدمون</button>
        <button className={`toolbar-btn ${tab === 'roles' ? 'primary' : ''}`} onClick={() => setTab('roles')}>الأدوار</button>
        <button className={`toolbar-btn ${tab === 'permissions' ? 'primary' : ''}`} onClick={() => setTab('permissions')}>الصلاحيات</button>
        <button className={`toolbar-btn ${tab === 'templates' ? 'primary' : ''}`} onClick={() => setTab('templates')}>قوالب الصلاحيات</button>
        <button className={`toolbar-btn ${tab === 'scopes' ? 'primary' : ''}`} onClick={() => setTab('scopes')}>نطاقات الوصول</button>
        <button className={`toolbar-btn ${tab === 'agents' ? 'primary' : ''}`} onClick={() => setTab('agents')}>وكلاء النظام</button>
      </div></div>

      <div className="card flex-1 overflow-auto">
        {error ? <div className="text-sm text-red-700 mb-2">{error}</div> : null}
        {success ? <div className="text-sm text-emerald-700 mb-2">{success}</div> : null}
        {loading ? <div className="p-4 text-sm text-gray-600">جاري التحميل...</div> : null}
        {!loading && unlinkedAgentUsers.length > 0 ? <div className="mb-3 rounded border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800">هذا المستخدم من نوع وكيل لكنه غير مرتبط بأي وكيل: {unlinkedAgentUsers.map((user) => user.username).join('، ')}</div> : null}

        {userForm && tab === 'users' ? (
          <div className="mb-4 rounded border border-slate-200 p-3">
            <div className="card-header">{userForm.id ? 'تعديل مستخدم' : 'إضافة مستخدم جديد'}</div>
            <div className="grid grid-cols-4 gap-3">
              <label className="form-group"><span className="form-label">اسم المستخدم</span><input className="form-input" value={userForm.username} onChange={(e) => setUserForm({ ...userForm, username: e.target.value })} /></label>
              <label className="form-group"><span className="form-label">الاسم الكامل</span><input className="form-input" value={userForm.full_name} onChange={(e) => setUserForm({ ...userForm, full_name: e.target.value })} /></label>
              <label className="form-group"><span className="form-label">{userForm.id ? 'كلمة مرور جديدة' : 'كلمة المرور'}</span><input type="password" className="form-input" value={userForm.password} onChange={(e) => setUserForm({ ...userForm, password: e.target.value })} /></label>
              <label className="form-group"><span className="form-label">الدور</span><select className="form-select" value={userForm.role_id} onChange={(e) => setUserForm({ ...userForm, role_id: e.target.value })}>{mainRoleOptions.map((role) => <option key={role.id} value={role.id}>{role.name} ({role.code}){legacyRoleCodes.has(role.code) ? ' - قديم' : ''}</option>)}</select></label>
              <label className="form-group"><span className="form-label">نوع الحساب</span><select className="form-select" value={userForm.user_type} onChange={(e) => changeUserType(e.target.value as UserType)}>{simplifiedUserTypeChoices.map((choice) => <option key={choice.value} value={choice.value}>{choice.label}</option>)}</select></label>
              <label className="form-group"><span className="form-label">الوكيل المرتبط</span><select className="form-select" disabled={userForm.user_type !== 'agent'} value={userForm.agent_id} onChange={(e) => setUserForm({ ...userForm, agent_id: e.target.value })}><option value="">اختر الوكيل</option>{agents.map((agent) => <option key={agent.id} value={agent.id}>{agent.code} - {agent.name}</option>)}</select></label>
              <label className="form-group"><span className="form-label">الحالة</span><select className="form-select" value={userForm.status} onChange={(e) => setUserForm({ ...userForm, status: e.target.value as UserForm['status'] })}><option value="active">نشط</option><option value="inactive">معطل</option><option value="locked">مقفل</option></select></label>
              <div className="form-group"><span className="form-label">الفروع المسموحة</span><div className="grid grid-cols-2 gap-1">{branches.map((branch) => branchCheckbox(branch, userForm.branch_ids, (next) => setUserForm({ ...userForm, branch_ids: next })))}</div></div>
            </div>
            {userForm.user_type === 'agent' && !userForm.agent_id ? <div className="mt-2 text-sm text-amber-700">هذا المستخدم من نوع وكيل لكنه غير مرتبط بأي وكيل.</div> : null}
            {selectedUserTemplate ? <div className="mt-2 rounded border border-blue-200 bg-blue-50 px-3 py-2 text-sm text-blue-900">القالب المقترح: {selectedUserTemplate.name} - {selectedUserTemplate.description}</div> : null}
            <div className="mt-3 flex gap-2"><button className="toolbar-btn success" disabled={saving} onClick={() => void saveUser()}>{saving ? 'جاري الحفظ...' : 'حفظ'}</button><button className="toolbar-btn" disabled={!selectedUserTemplate || saving} onClick={() => void applyCurrentUserTemplate()}>تطبيق قالب هذا النوع</button><button className="toolbar-btn" onClick={() => setUserForm(null)}>إلغاء</button></div>
          </div>
        ) : null}

        {tab === 'users' ? (
          <table className="data-grid"><thead><tr><th>#</th><th>اسم المستخدم</th><th>الاسم الكامل</th><th>الدور</th><th>النوع</th><th>الفرع الافتراضي</th><th>الفروع</th><th>الوكيل</th><th>الحالة</th><th>آخر دخول</th><th>إجراءات</th></tr></thead>
            <tbody>{users.map((u, idx) => <tr key={u.id}><td>{idx + 1}</td><td>{u.username}</td><td>{u.full_name}</td><td>{u.role_name}</td><td>{userTypeAr[u.user_type] || u.user_type}</td><td>{u.default_branch_id ? branchNameById.get(u.default_branch_id) || '-' : '-'}</td><td>{u.branch_ids.length}</td><td>{u.agent_name || '-'}</td><td>{u.status}</td><td>{u.last_login_at ? new Date(u.last_login_at).toLocaleString('ar-SY') : '-'}</td><td><div className="flex gap-2 text-xs"><button className="text-indigo-700" onClick={() => startEditUser(u)}>تعديل</button><button className="text-amber-700" onClick={() => void toggleUser(u)}>{u.status === 'active' ? 'تعطيل' : 'تفعيل'}</button><button className="text-indigo-700" onClick={() => { setScopeUserId(u.id); setTab('scopes'); }}>إدارة النطاق</button></div></td></tr>)}
            {!loading && users.length === 0 ? <tr><td colSpan={11} className="p-6 text-center text-gray-500">لا توجد بيانات بعد. ابدأ بإضافة مستخدم جديد.</td></tr> : null}</tbody></table>
        ) : null}

        {tab === 'roles' ? (
          <div className="permissions-two-col permissions-roles-editor">
            <div className="border border-slate-200 rounded">
              {roles.map((role) => <button key={role.id} type="button" className={`w-full text-right px-3 py-2 border-b ${selectedRoleId === role.id ? 'bg-indigo-50 text-indigo-700 font-semibold' : ''}`} onClick={() => chooseRole(role.id)}>{role.name}<div className="text-xs text-gray-500">{role.code} - {role.permissions.length} صلاحية</div></button>)}
            </div>
            <div>
              <div className="mb-3 flex items-center justify-between"><div><strong>{selectedRole?.name || 'اختر دوراً'}</strong><div className="text-xs text-gray-500">محرر صلاحيات الدور حسب الفئات</div></div><div className="flex gap-2"><button className="toolbar-btn" disabled={!selectedRole || saving} onClick={applyAgentPreset}>تطبيق صلاحيات الوكيل الأساسية</button><button className="toolbar-btn success" disabled={!selectedRole || saving} onClick={() => void saveRolePermissions()}>حفظ صلاحيات الدور</button></div></div>
              <div className="mb-3 rounded border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-900">
                صلاحيات الوكيل الأساسية عادةً هي: دخول بوابة الوكيل، عرض الشحنات، تأكيد استلام الوكيل، تحديث حالات شحنات الوكيل، وتأكيد التسليم حسب سياسة الشركة.
              </div>
              <div className="space-y-3">{groupedPermissions.map(([category, items]) => <div key={category} className="rounded border border-slate-200 p-3"><div className="mb-2 font-semibold">{category}</div><div className="permissions-matrix-grid">{items.map((permission) => { const meta = permissionMeta(permission); return <label key={permission.code} className={`permission-choice ${meta.recommendedForAgent ? 'recommended' : ''}`}><input type="checkbox" checked={selectedRolePermissions.has(permission.code)} onChange={(e) => { const next = new Set(selectedRolePermissions); if (e.target.checked) next.add(permission.code); else next.delete(permission.code); setSelectedRolePermissions(next); }} /><span><strong>{meta.label}</strong><small>{meta.description}</small><code>{permission.code}</code></span>{meta.recommendedForAgent ? <em>مناسب للوكيل</em> : null}</label>; })}</div></div>)}</div>
            </div>
          </div>
        ) : null}

        {tab === 'permissions' ? <table className="data-grid"><thead><tr><th>#</th><th>اسم الصلاحية</th><th>الوصف</th><th>الفئة</th><th>الإجراء</th><th>المفتاح التقني</th></tr></thead><tbody>{permissionCodes.map((code, idx) => { const row = permissionRows.find((item) => item.code === code); const meta = permissionMeta(row || code); return <tr key={code}><td>{idx + 1}</td><td>{meta.label}</td><td>{meta.description}</td><td>{categoryForPermission(code)}</td><td>{actionArabic[row?.action || ''] || row?.action || '-'}</td><td><code>{code}</code></td></tr>; })}</tbody></table> : null}

        {tab === 'templates' ? (
          <div className="permission-template-grid">
            {roleTemplates.map((template) => {
              const targetRole = findTemplateRole(template);
              const availableCount = template.roleCode === 'admin' ? permissionCodes.length : template.permissionCodes.filter((code) => permissionCodes.includes(code)).length;
              return (
                <div key={template.code} className="permission-template-card">
                  <div className="permission-template-head">
                    <div>
                      <strong>{template.name}</strong>
                      <span>{targetRole ? `الدور: ${targetRole.name}` : 'الدور غير موجود بعد'}</span>
                    </div>
                    <b>{availableCount}</b>
                  </div>
                  <p>{template.description}</p>
                  <div className="permission-template-modules">
                    {template.modules.map((module) => <span key={module}>{module}</span>)}
                  </div>
                  <button className="toolbar-btn primary" disabled={!targetRole || saving} onClick={() => void applyTemplateToRole(template)}>
                    تطبيق القالب
                  </button>
                </div>
              );
            })}
          </div>
        ) : null}

        {tab === 'scopes' ? (
          <div className="permissions-scope-layout">
            <div className="border border-slate-200 rounded max-h-[65vh] overflow-auto">{users.map((user) => <button key={user.id} className={`w-full text-right px-3 py-2 border-b ${scopeUserId === user.id ? 'bg-indigo-50 text-indigo-700 font-semibold' : ''}`} onClick={() => setScopeUserId(user.id)}>{user.username}<div className="text-xs text-gray-500">{user.role_name} - {user.agent_name || 'بدون وكيل'}</div></button>)}</div>
            {scopeUser ? <div className="rounded border border-slate-200 p-3"><div className="card-header">إدارة نطاق الوصول: {scopeUser.username}</div><div className="grid grid-cols-3 gap-3"><label className="form-group"><span className="form-label">نوع الحساب</span><select className="form-select" value={scopeUser.user_type} onChange={(e) => updateScopeDraft({ user_type: e.target.value as UserType })}>{simplifiedUserTypeChoices.map((choice) => <option key={choice.value} value={choice.value}>{choice.label}</option>)}</select></label><label className="form-group"><span className="form-label">الدور</span><select className="form-select" value={scopeUser.role_id} onChange={(e) => updateScopeDraft({ role_id: e.target.value, role_name: roles.find((role) => role.id === e.target.value)?.name || scopeUser.role_name } as any)}>{mainRoleOptions.map((role) => <option key={role.id} value={role.id}>{role.name}{legacyRoleCodes.has(role.code) ? ' - قديم' : ''}</option>)}</select></label><label className="form-group"><span className="form-label">الوكيل المرتبط</span><select className="form-select" value={scopeUser.agent_id || ''} onChange={(e) => updateScopeDraft({ agent_id: e.target.value || null, agent_name: agentNameById.get(e.target.value) || null } as any)}><option value="">بدون وكيل</option>{agents.map((agent) => <option key={agent.id} value={agent.id}>{agent.code} - {agent.name}</option>)}</select></label></div><div className="mt-3"><div className="form-label">الفروع المسموحة</div><div className="grid grid-cols-3 gap-2">{branches.map((branch) => branchCheckbox(branch, scopeUser.branch_ids || [], (next) => updateScopeDraft({ branch_ids: next, default_branch_id: next[0] || null })))}</div></div>{scopeUser.user_type === 'agent' && !scopeUser.agent_id ? <div className="mt-2 text-sm text-amber-700">هذا المستخدم من نوع وكيل لكنه غير مرتبط بأي وكيل.</div> : null}<div className="mt-3 text-sm text-gray-600">الملخص الحالي: {userTypeAr[scopeUser.user_type]} - {scopeUser.branch_ids.length} فرع - {scopeUser.agent_name || 'بدون وكيل'}</div><div className="mt-3"><button className="toolbar-btn success" disabled={saving} onClick={() => void saveScope()}>حفظ نطاق الوصول</button></div></div> : <div className="text-sm text-gray-500">اختر مستخدماً لإدارة نطاق وصوله.</div>}
          </div>
        ) : null}

        {tab === 'agents' ? <table className="data-grid"><thead><tr><th>#</th><th>كود الوكيل</th><th>اسم الوكيل</th><th>الفرع</th><th>المحافظة</th><th>المدينة</th><th>المنطقة</th><th>الحالة</th></tr></thead><tbody>{agents.map((a, idx) => <tr key={a.id}><td>{idx + 1}</td><td>{a.code}</td><td>{a.name}</td><td>{a.branch_id ? branchNameById.get(a.branch_id) || '-' : '-'}</td><td>{a.governorate || '-'}</td><td>{a.city || '-'}</td><td>{a.area || '-'}</td><td>{a.is_active ? 'نشط' : 'معطل'}</td></tr>)}</tbody></table> : null}
      </div>
    </div>
  );
}
