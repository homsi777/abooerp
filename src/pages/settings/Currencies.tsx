import { useEffect, useMemo, useState } from 'react';
import { useToast } from '../../components/Toast';
import { httpClient } from '../../lib/api/httpClient';

type CurrencyRecord = {
  id: string;
  code: string;
  name: string;
  symbol: string | null;
  is_base: boolean;
  is_active: boolean;
  company_id: string;
};

type CurrencyForm = {
  code: string;
  name: string;
  symbol: string;
  is_active: boolean;
};

const initialForm: CurrencyForm = {
  code: '',
  name: '',
  symbol: '',
  is_active: true,
};

export default function CurrenciesSettingsPage() {
  const { showToast } = useToast();
  const [currencies, setCurrencies] = useState<CurrencyRecord[]>([]);
  const [selected, setSelected] = useState<CurrencyRecord | null>(null);
  const [form, setForm] = useState<CurrencyForm>(initialForm);
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return currencies;
    return currencies.filter((row) => row.code.toLowerCase().includes(q) || row.name.toLowerCase().includes(q));
  }, [currencies, search]);

  const load = async () => {
    setLoading(true);
    try {
      const data = await httpClient.get<CurrencyRecord[]>('/currencies');
      setCurrencies(data);
    } catch (error) {
      showToast(error instanceof Error ? error.message : 'تعذر تحميل العملات', 'error');
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

  const startEdit = (currency: CurrencyRecord) => {
    setSelected(currency);
    setForm({
      code: currency.code,
      name: currency.name,
      symbol: currency.symbol ?? '',
      is_active: currency.is_active,
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
        await httpClient.put<CurrencyRecord>(`/currencies/${selected.id}`, {
          code: form.code.toUpperCase(),
          name: form.name,
          symbol: form.symbol || null,
          is_active: form.is_active,
        });
        showToast('تم تحديث العملة', 'success');
      } else {
        await httpClient.post<CurrencyRecord>('/currencies', {
          code: form.code.toUpperCase(),
          name: form.name,
          symbol: form.symbol || undefined,
          is_active: form.is_active,
        });
        showToast('تمت إضافة العملة', 'success');
      }
      await load();
      startCreate();
    } catch (error) {
      showToast(error instanceof Error ? error.message : 'تعذر حفظ العملة', 'error');
    } finally {
      setSaving(false);
    }
  };

  const deactivate = async () => {
    if (!selected) return;
    setSaving(true);
    try {
      await httpClient.delete(`/currencies/${selected.id}`);
      showToast('تم تعطيل العملة', 'success');
      await load();
      startCreate();
    } catch (error) {
      showToast(error instanceof Error ? error.message : 'تعذر تعطيل العملة', 'error');
    } finally {
      setSaving(false);
    }
  };

  const setBase = async () => {
    if (!selected) return;
    setSaving(true);
    try {
      await httpClient.post<CurrencyRecord>(`/currencies/${selected.id}/set-base`, {});
      showToast('تم تعيين العملة الأساسية', 'success');
      await load();
    } catch (error) {
      showToast(error instanceof Error ? error.message : 'تعذر تعيين العملة الأساسية', 'error');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="card">
      <div className="card-header">إدارة العملات</div>
      <div className="flex gap-2 mb-3">
        <input className="form-input" placeholder="بحث بالعملة" value={search} onChange={(e) => setSearch(e.target.value)} />
        <button className="toolbar-btn primary" onClick={startCreate}>+ عملة جديدة</button>
        <button className="toolbar-btn" onClick={() => void load()} disabled={loading}>تحديث</button>
      </div>
      <table className="data-grid">
        <thead>
          <tr>
            <th>الكود</th>
            <th>الاسم</th>
            <th>الرمز</th>
            <th>أساسية</th>
            <th>الحالة</th>
          </tr>
        </thead>
        <tbody>
          {filtered.map((row) => (
            <tr key={row.id} className={selected?.id === row.id ? 'selected' : ''} onClick={() => startEdit(row)}>
              <td>{row.code}</td>
              <td>{row.name}</td>
              <td>{row.symbol ?? '-'}</td>
              <td>{row.is_base ? 'نعم' : 'لا'}</td>
              <td>{row.is_active ? 'نشط' : 'معلق'}</td>
            </tr>
          ))}
        </tbody>
      </table>

      <div className="grid grid-cols-2 gap-3 mt-4">
        <div className="form-group">
          <label className="form-label">الكود</label>
          <input className="form-input w-full" value={form.code} onChange={(e) => setForm((p) => ({ ...p, code: e.target.value.toUpperCase() }))} />
        </div>
        <div className="form-group">
          <label className="form-label">الاسم</label>
          <input className="form-input w-full" value={form.name} onChange={(e) => setForm((p) => ({ ...p, name: e.target.value }))} />
        </div>
        <div className="form-group">
          <label className="form-label">الرمز</label>
          <input className="form-input w-full" value={form.symbol} onChange={(e) => setForm((p) => ({ ...p, symbol: e.target.value }))} />
        </div>
        <div className="form-group">
          <label className="flex items-center gap-2">
            <input
              type="checkbox"
              checked={form.is_active}
              onChange={(e) => setForm((p) => ({ ...p, is_active: e.target.checked }))}
            />
            العملة نشطة
          </label>
        </div>
      </div>

      <div className="flex gap-2 mt-3">
        <button className="toolbar-btn primary" onClick={() => void save()} disabled={saving}>
          {selected ? 'حفظ التعديل' : 'إضافة العملة'}
        </button>
        {selected && !selected.is_base && (
          <>
            <button className="toolbar-btn" onClick={() => void setBase()} disabled={saving}>تعيين كأساس</button>
            <button className="toolbar-btn danger" onClick={() => void deactivate()} disabled={saving}>تعطيل</button>
          </>
        )}
      </div>
    </div>
  );
}
