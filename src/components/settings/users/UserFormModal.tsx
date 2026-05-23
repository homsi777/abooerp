import { useEffect, useState } from 'react';
import {
  AGENT_OFFICE_OPTIONS,
  BRANCH_OPTIONS,
  type AdminUser,
  type UserStatus,
  type UserType,
} from '../../../lib/settings/usersSettingsStore';
import {
  USER_ROLE_LABELS,
  createRolePermissions,
  type UserRole,
} from '../../../lib/settings/usersPermissions';
import UserPermissionsEditor from './UserPermissionsEditor';

export interface UserFormValues {
  fullName: string;
  username: string;
  password: string;
  confirmPassword: string;
  phone: string;
  email: string;
  role: UserRole;
  userType: UserType;
  status: UserStatus;
  defaultBranch: string;
  linkedAgentOffice: string;
  notes: string;
  permissions: ReturnType<typeof createRolePermissions>;
}

interface UserFormModalProps {
  open: boolean;
  mode: 'create' | 'edit';
  initialUser?: AdminUser | null;
  onClose: () => void;
  onSubmit: (values: UserFormValues) => void;
}

function buildInitialValues(initialUser?: AdminUser | null): UserFormValues {
  const role = initialUser?.role || 'operator';
  return {
    fullName: initialUser?.fullName || '',
    username: initialUser?.username || '',
    password: initialUser?.password || '',
    confirmPassword: initialUser?.password || '',
    phone: initialUser?.phone || '',
    email: initialUser?.email || '',
    role,
    userType: initialUser?.userType || 'local',
    status: initialUser?.status || 'active',
    defaultBranch: initialUser?.defaultBranch || BRANCH_OPTIONS[0],
    linkedAgentOffice: initialUser?.linkedAgentOffice || AGENT_OFFICE_OPTIONS[0],
    notes: initialUser?.notes || '',
    permissions: initialUser?.permissions || createRolePermissions(role),
  };
}

export default function UserFormModal({ open, mode, initialUser, onClose, onSubmit }: UserFormModalProps) {
  const [values, setValues] = useState<UserFormValues>(buildInitialValues(initialUser));
  const [error, setError] = useState('');

  useEffect(() => {
    if (open) {
      setValues(buildInitialValues(initialUser));
      setError('');
    }
  }, [open, initialUser]);

  if (!open) return null;

  const roleOptions = Object.keys(USER_ROLE_LABELS) as UserRole[];

  const handleRoleChange = (role: UserRole) => {
    setValues((prev) => ({
      ...prev,
      role,
      permissions: role === 'custom' ? prev.permissions : createRolePermissions(role),
    }));
  };

  const submit = () => {
    if (!values.fullName.trim() || !values.username.trim() || !values.phone.trim()) {
      setError('يرجى تعبئة الحقول الأساسية');
      return;
    }
    if (!values.password.trim()) {
      setError('كلمة المرور مطلوبة');
      return;
    }
    if (values.password !== values.confirmPassword) {
      setError('تأكيد كلمة المرور غير مطابق');
      return;
    }
    if (values.userType === 'local' && !values.defaultBranch) {
      setError('يرجى تحديد الفرع للمستخدم المحلي');
      return;
    }
    if (values.userType === 'remote_agent' && !values.linkedAgentOffice) {
      setError('يرجى تحديد الوكيل/المكتب البعيد');
      return;
    }
    setError('');
    onSubmit(values);
  };

  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        background: 'rgba(0,0,0,0.35)',
        zIndex: 120,
        display: 'flex',
        justifyContent: 'center',
        alignItems: 'center',
      }}
    >
      <div className="card" style={{ width: '90vw', maxWidth: 1200, maxHeight: '90vh', overflow: 'auto' }}>
        <div className="card-header">{mode === 'create' ? 'إضافة مستخدم' : 'تعديل المستخدم'}</div>
        <div className="grid grid-cols-4 gap-3">
          <div className="form-group"><label className="form-label">الاسم الكامل</label><input className="form-input w-full" value={values.fullName} onChange={(e) => setValues({ ...values, fullName: e.target.value })} /></div>
          <div className="form-group"><label className="form-label">اسم المستخدم</label><input className="form-input w-full" value={values.username} onChange={(e) => setValues({ ...values, username: e.target.value })} /></div>
          <div className="form-group"><label className="form-label">كلمة المرور</label><input type="password" className="form-input w-full" value={values.password} onChange={(e) => setValues({ ...values, password: e.target.value })} /></div>
          <div className="form-group"><label className="form-label">تأكيد كلمة المرور</label><input type="password" className="form-input w-full" value={values.confirmPassword} onChange={(e) => setValues({ ...values, confirmPassword: e.target.value })} /></div>
          <div className="form-group"><label className="form-label">الهاتف</label><input className="form-input w-full" value={values.phone} onChange={(e) => setValues({ ...values, phone: e.target.value })} /></div>
          <div className="form-group"><label className="form-label">البريد الإلكتروني</label><input className="form-input w-full" value={values.email} onChange={(e) => setValues({ ...values, email: e.target.value })} /></div>
          <div className="form-group">
            <label className="form-label">الدور</label>
            <select className="form-select w-full" value={values.role} onChange={(e) => handleRoleChange(e.target.value as UserRole)}>
              {roleOptions.map((role) => (
                <option value={role} key={role}>{USER_ROLE_LABELS[role]}</option>
              ))}
            </select>
          </div>
          <div className="form-group">
            <label className="form-label">نوع المستخدم</label>
            <select className="form-select w-full" value={values.userType} onChange={(e) => setValues({ ...values, userType: e.target.value as UserType })}>
              <option value="local">مستخدم محلي</option>
              <option value="remote_agent">وكيل بعيد / سحابي</option>
            </select>
          </div>
          <div className="form-group">
            <label className="form-label">الحالة</label>
            <select className="form-select w-full" value={values.status} onChange={(e) => setValues({ ...values, status: e.target.value as UserStatus })}>
              <option value="active">نشط</option>
              <option value="inactive">غير نشط</option>
              <option value="suspended">موقوف</option>
            </select>
          </div>
          {values.userType === 'local' ? (
            <div className="form-group">
              <label className="form-label">الفرع الافتراضي</label>
              <select className="form-select w-full" value={values.defaultBranch} onChange={(e) => setValues({ ...values, defaultBranch: e.target.value })}>
                {BRANCH_OPTIONS.map((branch) => <option key={branch} value={branch}>{branch}</option>)}
              </select>
            </div>
          ) : (
            <div className="form-group">
              <label className="form-label">الوكيل/المكتب البعيد</label>
              <select className="form-select w-full" value={values.linkedAgentOffice} onChange={(e) => setValues({ ...values, linkedAgentOffice: e.target.value })}>
                {AGENT_OFFICE_OPTIONS.map((agent) => <option key={agent} value={agent}>{agent}</option>)}
              </select>
            </div>
          )}
          <div className="form-group" style={{ gridColumn: 'span 2' }}>
            <label className="form-label">ملاحظات</label>
            <input className="form-input w-full" value={values.notes} onChange={(e) => setValues({ ...values, notes: e.target.value })} />
          </div>
        </div>

        <div className="mt-4">
          <div className="card-header" style={{ marginBottom: 8 }}>محرر الصلاحيات</div>
          <UserPermissionsEditor value={values.permissions} onChange={(permissions) => setValues({ ...values, permissions })} compact />
        </div>

        {error && <div className="text-sm text-red-600 mt-3">{error}</div>}

        <div className="flex gap-2 mt-4">
          <button className="toolbar-btn primary" onClick={submit}>{mode === 'create' ? 'حفظ المستخدم' : 'حفظ التعديلات'}</button>
          <button className="toolbar-btn" onClick={onClose}>إلغاء</button>
        </div>
      </div>
    </div>
  );
}
