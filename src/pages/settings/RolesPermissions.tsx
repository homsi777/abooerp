import { useEffect, useMemo, useState } from 'react';
import { useToast } from '../../components/Toast';
import { httpClient } from '../../lib/api/httpClient';

type RoleRecord = {
  id: string;
  code: string;
  name: string;
  description: string | null;
  is_system: boolean;
  is_active: boolean;
  permissions: string[];
};

type RolesResponse = {
  roles: RoleRecord[];
  permissionCodes: string[];
};

type RoleForm = {
  code: string;
  name: string;
  description: string;
  is_active: boolean;
  permissions: string[];
};

const initialForm: RoleForm = {
  code: '',
  name: '',
  description: '',
  is_active: true,
  permissions: [],
};

export default function RolesPermissionsSettingsPage() {
  const { showToast } = useToast();
  const [roles, setRoles] = useState<RoleRecord[]>([]);
  const [permissionCodes, setPermissionCodes] = useState<string[]>([]);
  const [selected, setSelected] = useState<RoleRecord | null>(null);
  const [form, setForm] = useState<RoleForm>(initialForm);
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);

  const filteredRoles = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return roles;
    return roles.filter((role) => role.code.toLowerCase().includes(q) || role.name.toLowerCase().includes(q));
  }, [roles, search]);

  const load = async () => {
    setLoading(true);
    try {
      const payload = await httpClient.get<RolesResponse>('/roles');
      setRoles(payload.roles);
      setPermissionCodes(payload.permissionCodes);
    } catch (error) {
      showToast(error instanceof Error ? error.message : 'تعذر تحميل الأدوار', 'error');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void load();
  }, []);

  const startCreate = () => {
    setSelected(null);
    setForm(initialForm);
  };

  const startEdit = (role: RoleRecord) => {
    setSelected(role);
    setForm({
      code: role.code,
      name: role.name,
      description: role.description ?? '',
      is_active: role.is_active,
      permissions: [...role.permissions],
    });
  };

  const togglePermission = (permissionCode: string) => {
    setForm((prev) => {
      const exists = prev.permissions.includes(permissionCode);
      return {
        ...prev,
        permissions: exists ? prev.permissions.filter((code) => code !== permissionCode) : [...prev.permissions, permissionCode],
      };
    });
  };

  const save = async () => {
    if (!form.code.trim() || !form.name.trim()) {
      showToast('الكود والاسم مطلوبان', 'error');
      return;
    }
    setSaving(true);
    try {
      let roleId = selected?.id;
      if (selected) {
        await httpClient.put<RoleRecord>(`/roles/${selected.id}`, {
          code: form.code,
          name: form.name,
          description: form.description || null,
          is_active: form.is_active,
        });
      } else {
        const created = await httpClient.post<RoleRecord>('/roles', {
          code: form.code,
          name: form.name,
          description: form.description || undefined,
        });
        roleId = created.id;
      }

      if (roleId) {
        await httpClient.post<RoleRecord>(`/roles/${roleId}/permissions`, { permissionCodes: form.permissions });
      }
      showToast(selected ? 'تم تحديث الدور' : 'تم إنشاء الدور', 'success');
      await load();
      startCreate();
    } catch (error) {
      showToast(error instanceof Error ? error.message : 'تعذر حفظ الدور', 'error');
    } finally {
      setSaving(false);
    }
  };

  const remove = async () => {
    if (!selected) return;
    setSaving(true);
    try {
      await httpClient.delete(`/roles/${selected.id}`);
      showToast('تم حذف الدور', 'success');
      await load();
      startCreate();
    } catch (error) {
      showToast(error instanceof Error ? error.message : 'تعذر حذف الدور', 'error');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="card">
      <div className="card-header">إدارة الأدوار والصلاحيات</div>
      <div className="flex gap-2 mb-3">
        <input className="form-input" placeholder="بحث بالأدوار" value={search} onChange={(e) => setSearch(e.target.value)} />
        <button className="toolbar-btn primary" onClick={startCreate}>+ دور جديد</button>
        <button className="toolbar-btn" onClick={() => void load()} disabled={loading}>تحديث</button>
      </div>

      <table className="data-grid">
        <thead>
          <tr>
            <th>الكود</th>
            <th>الاسم</th>
            <th>النظام</th>
            <th>نشط</th>
            <th>عدد الصلاحيات</th>
          </tr>
        </thead>
        <tbody>
          {filteredRoles.map((role) => (
            <tr key={role.id} className={selected?.id === role.id ? 'selected' : ''} onClick={() => startEdit(role)}>
              <td>{role.code}</td>
              <td>{role.name}</td>
              <td>{role.is_system ? 'System' : 'Custom'}</td>
              <td>{role.is_active ? 'نعم' : 'لا'}</td>
              <td>{role.permissions.length}</td>
            </tr>
          ))}
        </tbody>
      </table>

      <div className="grid grid-cols-2 gap-3 mt-4">
        <div className="form-group">
          <label className="form-label">الكود</label>
          <input
            className="form-input w-full"
            value={form.code}
            disabled={Boolean(selected?.is_system)}
            onChange={(e) => setForm((p) => ({ ...p, code: e.target.value }))}
          />
        </div>
        <div className="form-group">
          <label className="form-label">الاسم</label>
          <input
            className="form-input w-full"
            value={form.name}
            disabled={Boolean(selected?.is_system)}
            onChange={(e) => setForm((p) => ({ ...p, name: e.target.value }))}
          />
        </div>
        <div className="form-group col-span-2">
          <label className="form-label">الوصف</label>
          <input
            className="form-input w-full"
            value={form.description}
            disabled={Boolean(selected?.is_system)}
            onChange={(e) => setForm((p) => ({ ...p, description: e.target.value }))}
          />
        </div>
      </div>

      <div className="mt-4">
        <div className="form-label mb-2">مصفوفة الصلاحيات</div>
        <div className="grid grid-cols-2 gap-2">
          {permissionCodes.map((permissionCode) => (
            <label key={permissionCode} className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={form.permissions.includes(permissionCode)}
                onChange={() => togglePermission(permissionCode)}
              />
              {permissionCode}
            </label>
          ))}
        </div>
      </div>

      <div className="flex gap-3 mt-4">
        <label className="flex items-center gap-2">
          <input
            type="checkbox"
            checked={form.is_active}
            onChange={(e) => setForm((p) => ({ ...p, is_active: e.target.checked }))}
          />
          الدور نشط
        </label>
      </div>

      <div className="flex gap-2 mt-3">
        <button className="toolbar-btn primary" onClick={() => void save()} disabled={saving}>
          {selected ? 'حفظ التعديل' : 'إضافة الدور'}
        </button>
        {selected && !selected.is_system && (
          <button className="toolbar-btn danger" onClick={() => void remove()} disabled={saving}>
            حذف الدور
          </button>
        )}
      </div>
    </div>
  );
}
