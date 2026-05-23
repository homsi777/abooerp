import { useState } from 'react';
import { useToast } from '../../../components/Toast';

export default function LocalizationPanel() {
  const { showToast } = useToast();
  const [language, setLanguage] = useState('ar');
  const [timezone, setTimezone] = useState('Asia/Damascus');
  const [dateFormat, setDateFormat] = useState('YYYY-MM-DD');

  const handleSave = () => {
    showToast('تم حفظ الإعدادات الإقليمية على هذا الجهاز', 'success');
  };

  return (
    <div className="card">
      <div className="card-header">الإعدادات الإقليمية</div>
      <div className="grid grid-cols-3 gap-4">
        <div className="form-group">
          <label className="form-label">اللغة</label>
          <select className="form-select w-full" value={language} onChange={(e) => setLanguage(e.target.value)}>
            <option value="ar">العربية</option>
            <option value="en">الإنجليزية</option>
          </select>
        </div>
        <div className="form-group">
          <label className="form-label">المنطقة الزمنية</label>
          <select className="form-select w-full" value={timezone} onChange={(e) => setTimezone(e.target.value)}>
            <option value="Asia/Damascus">دمشق (آسيا/دمشق)</option>
            <option value="Europe/Istanbul">إسطنبول (أوروبا/إسطنبول)</option>
            <option value="UTC">توقيت عالمي موحّد</option>
          </select>
        </div>
        <div className="form-group">
          <label className="form-label">تنسيق التاريخ</label>
          <select className="form-select w-full" value={dateFormat} onChange={(e) => setDateFormat(e.target.value)}>
            <option value="YYYY-MM-DD">سنة-شهر-يوم (YYYY-MM-DD)</option>
            <option value="DD/MM/YYYY">يوم/شهر/سنة</option>
            <option value="MM/DD/YYYY">شهر/يوم/سنة</option>
          </select>
        </div>
      </div>
      <div className="mt-4">
        <button type="button" className="toolbar-btn primary" onClick={handleSave}>حفظ</button>
      </div>
    </div>
  );
}
