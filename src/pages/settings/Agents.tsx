import { useEffect, useMemo, useState } from 'react';
import { useToast } from '../../components/Toast';
import { httpClient } from '../../lib/api/httpClient';

type BranchOption = {
  id: string;
  code: string;
  name: string;
  is_active: boolean;
};

type AgentRecord = {
  id: string;
  code: string;
  name: string;
  phone?: string | null;
  governorate?: string | null;
  branch_id?: string | null;
  telegram_chat_id?: string | null;
  is_active: boolean;
  commission_percentage?: number;
};

type AgentForm = {
  code: string;
  name: string;
  phone: string;
  governorate: string;
  branch_id: string;
  telegram_chat_id: string;
  is_active: boolean;
  commission_percentage: number;
};

const initialForm: AgentForm = {
  code: '',
  name: '',
  phone: '',
  governorate: '',
  branch_id: '',
  telegram_chat_id: '',
  is_active: true,
  commission_percentage: 0,
};

export default function AgentsSettingsPage() {
  const { showToast } = useToast();
  const [agents, setAgents] = useState<AgentRecord[]>([]);
  const [branches, setBranches] = useState<BranchOption[]>([]);
  const [selected, setSelected] = useState<AgentRecord | null>(null);
  const [form, setForm] = useState<AgentForm>(initialForm);
  const [search, setSearch] = useState('');
  const [includeInactive, setIncludeInactive] = useState(true);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);

  const branchLabelById = useMemo(
    () => new Map(branches.map((branch) => [branch.id, `${branch.code} - ${branch.name}`])),
    [branches],
  );

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return agents;
    return agents.filter((item) => item.code.toLowerCase().includes(q) || item.name.toLowerCase().includes(q));
  }, [agents, search]);

  const loadBranches = async () => {
    const data = await httpClient.get<BranchOption[]>('/branches?includeInactive=true');
    setBranches(data);
  };

  const loadAgents = async () => {
    const data = await httpClient.get<AgentRecord[]>(`/agents?includeInactive=${includeInactive ? 'true' : 'false'}`);
    setAgents(data);
  };

  const load = async () => {
    setLoading(true);
    try {
      await Promise.all([loadBranches(), loadAgents()]);
    } catch (error) {
      showToast(error instanceof Error ? error.message : 'تعذر تحميل الوكلاء', 'error');
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

  const startEdit = (agent: AgentRecord) => {
    setSelected(agent);
    setForm({
      code: agent.code,
      name: agent.name,
      phone: agent.phone ?? '',
      governorate: agent.governorate ?? '',
      branch_id: agent.branch_id ?? '',
      telegram_chat_id: agent.telegram_chat_id ?? '',
      is_active: agent.is_active,
      commission_percentage: agent.commission_percentage ?? 0,
    });
  };

  const save = async () => {
    if (!form.code.trim() || !form.name.trim()) {
      showToast('الكود والاسم مطلوبان', 'error');
      return;
    }
    if (!selected && !form.branch_id) {
      showToast('اختيار الفرع إلزامي عند إنشاء وكيل جديد', 'error');
      return;
    }
    setSaving(true);
    try {
      const payload = {
        code: form.code,
        name: form.name,
        phone: form.phone || undefined,
        governorate: form.governorate || undefined,
        branch_id: form.branch_id || undefined,
        telegram_chat_id: form.telegram_chat_id.trim() || null,
        commission_percentage: Number(form.commission_percentage || 0),
        is_active: form.is_active,
      };
      if (selected) {
        await httpClient.put<AgentRecord>(`/agents/${selected.id}`, payload);
        showToast('تم تحديث الوكيل', 'success');
      } else {
        await httpClient.post<AgentRecord>('/agents', {
          ...payload,
          branch_id: form.branch_id,
        });
        showToast('تمت إضافة الوكيل', 'success');
      }
      await loadAgents();
      startCreate();
    } catch (error) {
      showToast(error instanceof Error ? error.message : 'تعذر حفظ الوكيل', 'error');
    } finally {
      setSaving(false);
    }
  };

  const deactivate = async () => {
    if (!selected) return;
    setSaving(true);
    try {
      await httpClient.delete(`/agents/${selected.id}`);
      showToast('تم تعطيل الوكيل', 'success');
      await loadAgents();
      startCreate();
    } catch (error) {
      showToast(error instanceof Error ? error.message : 'تعذر تعطيل الوكيل', 'error');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="card">
      <div className="card-header">إدارة الوكلاء</div>
      <div className="grid grid-cols-4 gap-3 mb-3">
        <input className="form-input" placeholder="بحث بالكود/الاسم" value={search} onChange={(e) => setSearch(e.target.value)} />
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" checked={includeInactive} onChange={(e) => setIncludeInactive(e.target.checked)} />
          عرض غير النشطة
        </label>
      </div>
      <div className="flex gap-2 mb-3">
        <button className="toolbar-btn primary" onClick={startCreate}>+ وكيل جديد</button>
        <button className="toolbar-btn" onClick={() => void load()} disabled={loading}>تحديث</button>
      </div>
      <table className="data-grid">
        <thead>
          <tr>
            <th>الكود</th>
            <th>الاسم</th>
            <th>المحافظة</th>
            <th>الفرع</th>
            <th>🔔 تيليجرام</th>
            <th>الحالة</th>
          </tr>
        </thead>
        <tbody>
          {filtered.map((agent) => (
            <tr key={agent.id} className={selected?.id === agent.id ? 'selected' : ''} onClick={() => startEdit(agent)}>
              <td>{agent.code}</td>
              <td>{agent.name}</td>
              <td>{agent.governorate ?? '-'}</td>
              <td>{agent.branch_id ? branchLabelById.get(agent.branch_id) ?? agent.branch_id.slice(0, 8) : '-'}</td>
              <td style={{ fontSize: 12, color: agent.telegram_chat_id ? '#16a34a' : '#aaa' }}>
                {agent.telegram_chat_id ? '✓ ' + agent.telegram_chat_id : '—'}
              </td>
              <td>{agent.is_active ? 'نشط' : 'معلق'}</td>
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
          <label className="form-label">الهاتف</label>
          <input className="form-input w-full" value={form.phone} onChange={(e) => setForm((p) => ({ ...p, phone: e.target.value }))} />
        </div>
        <div className="form-group">
          <label className="form-label">المحافظة</label>
          <input className="form-input w-full" value={form.governorate} onChange={(e) => setForm((p) => ({ ...p, governorate: e.target.value }))} />
        </div>
        <div className="form-group col-span-2">
          <label className="form-label">الفرع</label>
          <select className="form-select w-full" value={form.branch_id} onChange={(e) => setForm((p) => ({ ...p, branch_id: e.target.value }))}>
            <option value="">بدون ربط فرع</option>
            {branches.filter((branch) => branch.is_active).map((branch) => (
              <option key={branch.id} value={branch.id}>
                {branch.code} - {branch.name}
              </option>
            ))}
          </select>
        </div>
        <div className="form-group col-span-2">
          <label className="form-label" style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <span style={{ fontSize: 16 }}>🔔</span>
            Telegram Chat ID للوكيل
          </label>
          <input
            className="form-input w-full"
            placeholder="مثال: 123456789 — يصل إليه إشعار عند كل شحنة"
            value={form.telegram_chat_id}
            onChange={(e) => setForm((p) => ({ ...p, telegram_chat_id: e.target.value }))}
            dir="ltr"
          />
          <p style={{ fontSize: 11, color: '#888', marginTop: 3 }}>
            Chat ID الشخصي للوكيل على تيليجرام — يُستخدم بوت التفعيل العام لإرسال إشعارات الشحن
          </p>
        </div>
        <div className="form-group col-span-2">
          <label className="form-label">نسبة العمولة (%)</label>
          <input 
            type="number" 
            step="0.01"
            className="form-input w-full" 
            placeholder="مثال: 5.00 للنسبة 5%"
            value={form.commission_percentage || ''} 
            onChange={(e) => setForm((p) => ({ ...p, commission_percentage: Number(e.target.value) || 0 }))} 
          />
        </div>
        <div className="form-group col-span-2">
          <label className="flex items-center gap-2">
            <input
              type="checkbox"
              checked={form.is_active}
              onChange={(e) => setForm((p) => ({ ...p, is_active: e.target.checked }))}
            />
            الوكيل نشط
          </label>
        </div>
      </div>

      <div className="flex gap-2 mt-3">
        <button className="toolbar-btn primary" onClick={() => void save()} disabled={saving}>{selected ? 'حفظ التعديل' : 'إضافة'}</button>
        {selected && (
          <button className="toolbar-btn danger" onClick={() => void deactivate()} disabled={saving}>
            تعطيل الوكيل
          </button>
        )}
      </div>
    </div>
  );
}
