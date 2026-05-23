import { useEffect, useMemo, useState } from 'react';
import { useToast } from '../../components/Toast';
import { httpClient } from '../../lib/api/httpClient';

type BranchRecord = {
  id: string;
  code: string;
  name: string;
  city?: string | null;
  address?: string | null;
  phone?: string | null;
  company_id: string;
  is_active: boolean;
};

type BranchForm = {
  code: string;
  name: string;
  city: string;
  address: string;
  phone: string;
  is_active: boolean;
};

const initialForm: BranchForm = {
  code: '',
  name: '',
  city: '',
  address: '',
  phone: '',
  is_active: true,
};

export default function BranchesSettingsPage() {
  const { showToast } = useToast();
  const [items, setItems] = useState<BranchRecord[]>([]);
  const [selected, setSelected] = useState<BranchRecord | null>(null);
  const [form, setForm] = useState<BranchForm>(initialForm);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [includeInactive, setIncludeInactive] = useState(true);
  const [search, setSearch] = useState('');

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return items;
    return items.filter((item) => item.code.toLowerCase().includes(q) || item.name.toLowerCase().includes(q));
  }, [items, search]);

  const load = async () => {
    setLoading(true);
    try {
      const data = await httpClient.get<BranchRecord[]>(`/branches?includeInactive=${includeInactive ? 'true' : 'false'}`);
      setItems(data);
    } catch (error) {
      showToast(error instanceof Error ? error.message : 'تعذر تحميل الفروع', 'error');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void load();
  }, [includeInactive]);

  const startCreate = () => {
    setSelected(null);
    setForm(initialForm);
  };

  const startEdit = (branch: BranchRecord) => {
    setSelected(branch);
    setForm({
      code: branch.code,
      name: branch.name,
      city: branch.city ?? '',
      address: branch.address ?? '',
      phone: branch.phone ?? '',
      is_active: branch.is_active,
    });
  };

  const save = async () => {
    if (!form.code.trim() || !form.name.trim()) {
      showToast('الكود والاسم مطلوبان', 'error');
      return;
    }
    setSaving(true);
    try {
      if (selected) {
        await httpClient.put<BranchRecord>(`/branches/${selected.id}`, form);
        showToast('تم تحديث الفرع', 'success');
      } else {
        await httpClient.post<BranchRecord>('/branches', form);
        showToast('تمت إضافة الفرع', 'success');
      }
      await load();
      startCreate();
    } catch (error) {
      showToast(error instanceof Error ? error.message : 'تعذر حفظ بيانات الفرع', 'error');
    } finally {
      setSaving(false);
    }
  };

  const deactivate = async () => {
    if (!selected) return;
    setSaving(true);
    try {
      await httpClient.delete(`/branches/${selected.id}`);
      showToast('تم تعطيل الفرع', 'success');
      await load();
      startCreate();
    } catch (error) {
      showToast(error instanceof Error ? error.message : 'تعذر تعطيل الفرع', 'error');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="card">
      <div className="card-header">إدارة الفروع</div>
      <div className="grid grid-cols-4 gap-3 mb-3">
        <input className="form-input" placeholder="بحث بالكود/الاسم" value={search} onChange={(e) => setSearch(e.target.value)} />
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" checked={includeInactive} onChange={(e) => setIncludeInactive(e.target.checked)} />
          عرض غير النشطة
        </label>
      </div>
      <div className="flex gap-2 mb-3">
        <button className="toolbar-btn primary" onClick={startCreate}>+ فرع جديد</button>
        <button className="toolbar-btn" onClick={() => void load()} disabled={loading}>تحديث</button>
      </div>
      <table className="data-grid">
        <thead>
          <tr>
            <th>الكود</th>
            <th>الاسم</th>
            <th>المدينة</th>
            <th>الشركة</th>
            <th>الحالة</th>
          </tr>
        </thead>
        <tbody>
          {filtered.map((item) => (
            <tr key={item.id} className={selected?.id === item.id ? 'selected' : ''} onClick={() => startEdit(item)}>
              <td>{item.code}</td>
              <td>{item.name}</td>
              <td>{item.city ?? '-'}</td>
              <td>{item.company_id.slice(0, 8)}</td>
              <td>{item.is_active ? 'نشط' : 'معلق'}</td>
            </tr>
          ))}
        </tbody>
      </table>

      <div className="grid grid-cols-2 gap-3 mt-4">
        <div className="form-group">
          <label className="form-label">الكود</label>
          <input className="form-input w-full" value={form.code} onChange={(e) => setForm((p) => ({ ...p, code: e.target.value }))} />
        </div>
        <div className="form-group">
          <label className="form-label">الاسم</label>
          <input className="form-input w-full" value={form.name} onChange={(e) => setForm((p) => ({ ...p, name: e.target.value }))} />
        </div>
        <div className="form-group">
          <label className="form-label">المدينة</label>
          <input className="form-input w-full" value={form.city} onChange={(e) => setForm((p) => ({ ...p, city: e.target.value }))} />
        </div>
        <div className="form-group">
          <label className="form-label">الهاتف</label>
          <input className="form-input w-full" value={form.phone} onChange={(e) => setForm((p) => ({ ...p, phone: e.target.value }))} />
        </div>
        <div className="form-group col-span-2">
          <label className="form-label">العنوان</label>
          <input className="form-input w-full" value={form.address} onChange={(e) => setForm((p) => ({ ...p, address: e.target.value }))} />
        </div>
        <div className="form-group col-span-2">
          <label className="flex items-center gap-2">
            <input
              type="checkbox"
              checked={form.is_active}
              onChange={(e) => setForm((p) => ({ ...p, is_active: e.target.checked }))}
            />
            الفرع نشط
          </label>
        </div>
      </div>

      <div className="flex gap-2 mt-3">
        <button className="toolbar-btn primary" onClick={() => void save()} disabled={saving}>{selected ? 'حفظ التعديل' : 'إضافة'}</button>
        {selected && (
          <button className="toolbar-btn danger" onClick={() => void deactivate()} disabled={saving}>
            تعطيل الفرع
          </button>
        )}
      </div>
    </div>
  );
}
