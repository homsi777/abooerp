import { useEffect, useMemo, useState } from 'react';
import { useToast } from '../../components/Toast';
import { httpClient } from '../../lib/api/httpClient';

type BranchRecord = {
  id: string;
  code: string;
  name: string;
  is_active: boolean;
};

type RoleRecord = {
  id: string;
  code: string;
  name: string;
};

type UserRecord = {
  id: string;
  username: string;
  full_name: string;
  email: string | null;
  phone: string | null;
  role_id: string;
  role_code: string;
  role_name: string;
  status: 'active' | 'inactive' | 'locked';
  is_active: boolean;
  branch_ids: string[];
};

type UserForm = {
  username: string;
  full_name: string;
  email: string;
  phone: string;
  role_id: string;
  password: string;
  status: 'active' | 'inactive' | 'locked';
  is_active: boolean;
  branch_ids: string[];
};

const initialForm: UserForm = {
  username: '',
  full_name: '',
  email: '',
  phone: '',
  role_id: '',
  password: '',
  status: 'active',
  is_active: true,
  branch_ids: [],
};

export default function UsersSettingsPage() {
  const { showToast } = useToast();
  const [users, setUsers] = useState<UserRecord[]>([]);
  const [roles, setRoles] = useState<RoleRecord[]>([]);
  const [branches, setBranches] = useState<BranchRecord[]>([]);
  const [selected, setSelected] = useState<UserRecord | null>(null);
  const [form, setForm] = useState<UserForm>(initialForm);
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);

  const branchLabelById = useMemo(
    () => new Map(branches.map((branch) => [branch.id, `${branch.code} - ${branch.name}`])),
    [branches],
  );

  const filteredUsers = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return users;
    return users.filter(
      (item) =>
        item.username.toLowerCase().includes(q) ||
        item.full_name.toLowerCase().includes(q) ||
        item.role_name.toLowerCase().includes(q),
    );
  }, [users, search]);

  const load = async () => {
    setLoading(true);
    try {
      const [usersData, rolesResponse, branchesData] = await Promise.all([
        httpClient.get<UserRecord[]>('/users'),
        httpClient.get<{ roles: RoleRecord[]; permissionCodes: string[] }>('/roles'),
        httpClient.get<BranchRecord[]>('/branches?includeInactive=true'),
      ]);
      setUsers(usersData);
      setRoles(rolesResponse.roles);
      setBranches(branchesData);
    } catch (error) {
      showToast(error instanceof Error ? error.message : 'تعذر تحميل المستخدمين', 'error');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void load();
  }, []);

  const startCreate = () => {
    setSelected(null);
    setForm({ ...initialForm, role_id: roles[0]?.id ?? '' });
  };

  const startEdit = (user: UserRecord) => {
    setSelected(user);
    setForm({
      username: user.username,
      full_name: user.full_name,
      email: user.email ?? '',
      phone: user.phone ?? '',
      role_id: user.role_id,
      password: '',
      status: user.status,
      is_active: user.is_active,
      branch_ids: user.branch_ids,
    });
  };

  const toggleBranch = (branchId: string) => {
    setForm((prev) => {
      const exists = prev.branch_ids.includes(branchId);
      return {
        ...prev,
        branch_ids: exists ? prev.branch_ids.filter((id) => id !== branchId) : [...prev.branch_ids, branchId],
      };
    });
  };

  const save = async () => {
    if (!form.username.trim() || !form.full_name.trim() || !form.role_id) {
      showToast('الاسم واسم المستخدم والدور مطلوبة', 'error');
      return;
    }
    if (!selected && !form.password.trim()) {
      showToast('كلمة المرور مطلوبة عند إنشاء المستخدم', 'error');
      return;
    }
    setSaving(true);
    try {
      if (selected) {
        await httpClient.put<UserRecord>(`/users/${selected.id}`, {
          username: form.username,
          full_name: form.full_name,
          email: form.email || null,
          phone: form.phone || null,
          role_id: form.role_id,
          password: form.password || undefined,
          status: form.status,
          is_active: form.is_active,
        });
        await httpClient.post<UserRecord>(`/users/${selected.id}/branches`, { branchIds: form.branch_ids });
        showToast('تم تحديث المستخدم', 'success');
      } else {
        const created = await httpClient.post<UserRecord>('/users', {
          username: form.username,
          full_name: form.full_name,
          email: form.email || undefined,
          phone: form.phone || undefined,
          role_id: form.role_id,
          password: form.password,
          status: form.status,
          is_active: form.is_active,
          branch_ids: form.branch_ids,
        });
        if (form.branch_ids.length > 0) {
          await httpClient.post<UserRecord>(`/users/${created.id}/branches`, { branchIds: form.branch_ids });
        }
        showToast('تم إنشاء المستخدم', 'success');
      }
      await load();
      startCreate();
    } catch (error) {
      showToast(error instanceof Error ? error.message : 'تعذر حفظ المستخدم', 'error');
    } finally {
      setSaving(false);
    }
  };

  const deactivate = async () => {
    if (!selected) return;
    setSaving(true);
    try {
      await httpClient.delete(`/users/${selected.id}`);
      showToast('تم تعطيل المستخدم', 'success');
      await load();
      startCreate();
    } catch (error) {
      showToast(error instanceof Error ? error.message : 'تعذر تعطيل المستخدم', 'error');
    } finally {
      setSaving(false);
    }
  };

  const resetPassword = async () => {
    if (!selected) return;
    setSaving(true);
    try {
      await httpClient.put<UserRecord>(`/users/${selected.id}`, { password: '123456' });
      showToast('تمت إعادة ضبط كلمة المرور إلى 123456', 'info');
    } catch (error) {
      showToast(error instanceof Error ? error.message : 'تعذر إعادة ضبط كلمة المرور', 'error');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="card">
      <div className="card-header">إدارة المستخدمين</div>
      <div className="flex gap-2 mb-3">
        <input className="form-input" placeholder="بحث بالمستخدمين" value={search} onChange={(e) => setSearch(e.target.value)} />
        <button className="toolbar-btn primary" onClick={startCreate}>+ مستخدم جديد</button>
        <button className="toolbar-btn" onClick={() => void load()} disabled={loading}>تحديث</button>
      </div>

      <table className="data-grid">
        <thead>
          <tr>
            <th>اسم المستخدم</th>
            <th>الاسم</th>
            <th>الدور</th>
            <th>الفروع</th>
            <th>الحالة</th>
          </tr>
        </thead>
        <tbody>
          {filteredUsers.map((user) => (
            <tr key={user.id} className={selected?.id === user.id ? 'selected' : ''} onClick={() => startEdit(user)}>
              <td>{user.username}</td>
              <td>{user.full_name}</td>
              <td>{user.role_name}</td>
              <td>
                {user.branch_ids.length > 0
                  ? user.branch_ids.map((id) => branchLabelById.get(id) ?? id.slice(0, 8)).join('، ')
                  : '-'}
              </td>
              <td>{user.is_active ? 'نشط' : 'غير نشط'}</td>
            </tr>
          ))}
        </tbody>
      </table>

      <div className="grid grid-cols-2 gap-3 mt-4">
        <div className="form-group">
          <label className="form-label">اسم المستخدم</label>
          <input className="form-input w-full" value={form.username} onChange={(e) => setForm((p) => ({ ...p, username: e.target.value }))} />
        </div>
        <div className="form-group">
          <label className="form-label">الاسم الكامل</label>
          <input className="form-input w-full" value={form.full_name} onChange={(e) => setForm((p) => ({ ...p, full_name: e.target.value }))} />
        </div>
        <div className="form-group">
          <label className="form-label">البريد الإلكتروني</label>
          <input className="form-input w-full" value={form.email} onChange={(e) => setForm((p) => ({ ...p, email: e.target.value }))} />
        </div>
        <div className="form-group">
          <label className="form-label">الهاتف</label>
          <input className="form-input w-full" value={form.phone} onChange={(e) => setForm((p) => ({ ...p, phone: e.target.value }))} />
        </div>
        <div className="form-group">
          <label className="form-label">الدور</label>
          <select className="form-select w-full" value={form.role_id} onChange={(e) => setForm((p) => ({ ...p, role_id: e.target.value }))}>
            <option value="">اختر دورًا</option>
            {roles.map((role) => (
              <option key={role.id} value={role.id}>
                {role.name} ({role.code})
              </option>
            ))}
          </select>
        </div>
        <div className="form-group">
          <label className="form-label">{selected ? 'كلمة مرور جديدة (اختياري)' : 'كلمة المرور'}</label>
          <input
            type="password"
            className="form-input w-full"
            value={form.password}
            onChange={(e) => setForm((p) => ({ ...p, password: e.target.value }))}
          />
        </div>
      </div>

      <div className="mt-4">
        <div className="form-label mb-2">تعيين الفروع</div>
        <div className="grid grid-cols-2 gap-2">
          {branches.filter((branch) => branch.is_active).map((branch) => (
            <label key={branch.id} className="flex items-center gap-2 text-sm">
              <input type="checkbox" checked={form.branch_ids.includes(branch.id)} onChange={() => toggleBranch(branch.id)} />
              {branch.code} - {branch.name}
            </label>
          ))}
        </div>
      </div>

      <div className="flex gap-3 mt-4">
        <label className="flex items-center gap-2">
          <input
            type="checkbox"
            checked={form.is_active}
            onChange={(e) =>
              setForm((p) => ({
                ...p,
                is_active: e.target.checked,
                status: e.target.checked ? 'active' : 'inactive',
              }))
            }
          />
          المستخدم نشط
        </label>
      </div>

      <div className="flex gap-2 mt-3">
        <button className="toolbar-btn primary" onClick={() => void save()} disabled={saving}>
          {selected ? 'حفظ التعديل' : 'إضافة المستخدم'}
        </button>
        {selected && (
          <>
            <button className="toolbar-btn" onClick={() => void resetPassword()} disabled={saving}>
              إعادة ضبط كلمة المرور
            </button>
            <button className="toolbar-btn danger" onClick={() => void deactivate()} disabled={saving}>
              تعطيل المستخدم
            </button>
          </>
        )}
      </div>
    </div>
  );
}
