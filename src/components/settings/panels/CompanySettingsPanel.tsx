import { useEffect, useState } from 'react';
import { useToast } from '../../../components/Toast';
import { httpClient } from '../../../lib/api/httpClient';
import LogoUploadField from './LogoUploadField';

type CompanyRow = {
  name: string;
  phone: string | null;
  address: string | null;
  logo_data_url: string | null;
};

export default function CompanySettingsPanel() {
  const { showToast } = useToast();
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [companyInfo, setCompanyInfo] = useState({
    name: '',
    phone: '',
    address: '',
    logoDataUrl: '',
  });

  useEffect(() => {
    void (async () => {
      setLoading(true);
      try {
        const row = await httpClient.get<CompanyRow>('/company');
        setCompanyInfo({
          name: row.name ?? '',
          phone: row.phone ?? '',
          address: row.address ?? '',
          logoDataUrl: row.logo_data_url ?? '',
        });
      } catch (e) {
        showToast(e instanceof Error ? e.message : 'تعذر تحميل بيانات الشركة', 'error');
      } finally {
        setLoading(false);
      }
    })();
  }, [showToast]);

  const handleSave = async () => {
    setSaving(true);
    try {
      const row = await httpClient.put<CompanyRow>('/company', {
        name: companyInfo.name,
        phone: companyInfo.phone || null,
        address: companyInfo.address || null,
        logo_data_url: companyInfo.logoDataUrl || null,
      });
      setCompanyInfo({
        name: row.name ?? '',
        phone: row.phone ?? '',
        address: row.address ?? '',
        logoDataUrl: row.logo_data_url ?? '',
      });
      showToast('تم حفظ معلومات الشركة', 'success');
    } catch (e) {
      showToast(e instanceof Error ? e.message : 'تعذر الحفظ', 'error');
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <div className="card p-4">
        <span className="text-gray-500">جاري التحميل...</span>
      </div>
    );
  }

  return (
    <div className="card">
      <div className="card-header">معلومات الشركة</div>
      <div className="grid grid-cols-2 gap-4">
        <div className="form-group">
          <label className="form-label">اسم الشركة</label>
          <input
            type="text"
            className="form-input w-full"
            value={companyInfo.name}
            onChange={(e) => setCompanyInfo({ ...companyInfo, name: e.target.value })}
          />
        </div>
        <div className="form-group">
          <label className="form-label">الهاتف</label>
          <input
            type="text"
            className="form-input w-full"
            value={companyInfo.phone}
            onChange={(e) => setCompanyInfo({ ...companyInfo, phone: e.target.value })}
          />
        </div>
        <div className="form-group" style={{ gridColumn: 'span 2' }}>
          <label className="form-label">العنوان</label>
          <input
            type="text"
            className="form-input w-full"
            value={companyInfo.address}
            onChange={(e) => setCompanyInfo({ ...companyInfo, address: e.target.value })}
          />
        </div>
        <div className="form-group" style={{ gridColumn: 'span 2' }}>
          <LogoUploadField
            value={companyInfo.logoDataUrl}
            onChange={(logoDataUrl) => setCompanyInfo({ ...companyInfo, logoDataUrl })}
          />
        </div>
      </div>
      <div className="mt-4">
        <button type="button" onClick={() => void handleSave()} className="toolbar-btn primary" disabled={saving}>
          {saving ? 'جاري الحفظ...' : 'حفظ'}
        </button>
      </div>
    </div>
  );
}
