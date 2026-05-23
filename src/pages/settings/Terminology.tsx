import { useEffect, useState } from 'react';
import { useToast } from '../../components/Toast';
import { DEFAULT_TERMINOLOGY, TERMINOLOGY_GROUPS } from '../../lib/settings/terminologyCatalog';
import { httpClient } from '../../lib/api/httpClient';

export default function TerminologySettingsPage() {
  const { showToast } = useToast();
  const [terms, setTerms] = useState<Record<string, string>>({ ...DEFAULT_TERMINOLOGY });
  const [searchTerm, setSearchTerm] = useState('');
  const [saving, setSaving] = useState(false);
  const [loading, setLoading] = useState(false);

  const load = async () => {
    setLoading(true);
    try {
      const data = await httpClient.get<{ terms: Record<string, string> }>('/terminology-settings');
      setTerms({ ...DEFAULT_TERMINOLOGY, ...(data.terms ?? {}) });
    } catch (error) {
      showToast(error instanceof Error ? error.message : 'تعذر تحميل المصطلحات', 'error');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void load();
  }, []);

  const save = async () => {
    setSaving(true);
    try {
      const data = await httpClient.put<{ terms: Record<string, string> }>('/terminology-settings', { terms });
      setTerms({ ...DEFAULT_TERMINOLOGY, ...(data.terms ?? {}) });
      showToast('تم حفظ المصطلحات', 'success');
    } catch (error) {
      showToast(error instanceof Error ? error.message : 'تعذر حفظ المصطلحات', 'error');
    } finally {
      setSaving(false);
    }
  };

  const reset = () => {
    setTerms({ ...DEFAULT_TERMINOLOGY });
    showToast('تمت إعادة المصطلحات الافتراضية محليًا، اضغط حفظ للتطبيق', 'info');
  };

  return (
    <div className="space-y-4">
      <div className="card">
        <div className="card-header">تخصيص المصطلحات (Backend-driven)</div>
        <div className="grid grid-cols-3 gap-3">
          <div className="form-group" style={{ gridColumn: 'span 2' }}>
            <label className="form-label">بحث عن مصطلح</label>
            <input className="form-input w-full" placeholder="ابحث باسم المفتاح أو النص" value={searchTerm} onChange={(e) => setSearchTerm(e.target.value)} />
          </div>
        </div>
        <div className="flex gap-2 mt-2">
          <button type="button" onClick={() => void save()} className="toolbar-btn primary" disabled={saving}>
            {saving ? 'Saving...' : 'حفظ'}
          </button>
          <button type="button" onClick={reset} className="toolbar-btn">إعادة الافتراضي</button>
          <button type="button" onClick={() => void load()} className="toolbar-btn" disabled={loading}>تحديث</button>
        </div>
      </div>

      <div className="space-y-4">
        {TERMINOLOGY_GROUPS.map((group) => {
          const filteredFields = group.fields.filter((field) => {
            if (!searchTerm.trim()) return true;
            const q = searchTerm.trim();
            return field.label.includes(q) || field.key.includes(q) || group.label.includes(q);
          });
          if (filteredFields.length === 0) return null;

          return (
            <div className="card" key={group.id}>
              <div className="card-header">{group.label}</div>
              <div className="grid grid-cols-2 gap-3">
                {filteredFields.map((field) => (
                  <div className="form-group" key={field.key}>
                    <label className="form-label">
                      <span>{field.label}</span>
                      <span className="text-xs text-gray-400 ml-2">({field.key})</span>
                    </label>
                    <input className="form-input w-full" value={terms[field.key] ?? ''} onChange={(e) => setTerms((prev) => ({ ...prev, [field.key]: e.target.value }))} />
                  </div>
                ))}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
