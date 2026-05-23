import { useState, useEffect } from 'react';
import { phase15Gateway } from '../lib/api/phase15Gateway';
import { Driver } from '../types';
import { useToast } from '../components/Toast';

export default function Drivers() {
  const [drivers, setDrivers] = useState<Driver[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedDriver, setSelectedDriver] = useState<Driver | null>(null);
  const [isEditing, setIsEditing] = useState(false);
  const { showToast } = useToast();

  const [formData, setFormData] = useState<Partial<Driver>>({
    code: '', name: '', phone: '', licenseNumber: '', licenseExpiry: '', address: '', isActive: true
  });

  useEffect(() => { loadDrivers(); }, []);

  const loadDrivers = async () => {
    setLoading(true);
    try {
      const data = await phase15Gateway.drivers.getAll();
      setDrivers(data);
    } finally { setLoading(false); }
  };

  const handleNew = () => {
    setSelectedDriver(null);
    setFormData({ code: '', name: '', phone: '', licenseNumber: '', licenseExpiry: '', address: '', isActive: true });
    setIsEditing(true);
  };

  const handleEdit = (driver: Driver) => {
    setSelectedDriver(driver);
    setFormData(driver);
    setIsEditing(true);
  };

  const handleSave = async () => {
    try {
      if (selectedDriver) {
        await phase15Gateway.drivers.update(selectedDriver.id, formData);
        showToast('تم التحديث بنجاح', 'success');
      } else {
        await phase15Gateway.drivers.create(formData);
        showToast('تم الإضافة بنجاح', 'success');
      }
      await loadDrivers();
      setIsEditing(false);
    } catch {
      showToast('حدث خطأ', 'error');
    }
  };

  return (
    <div className="h-full flex flex-col">
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-xl font-bold">السائقين</h2>
      </div>

      <div className="flex-1 flex gap-4 overflow-hidden">
        <div className="flex-1 card overflow-auto">
          <div className="toolbar mb-2">
            <button onClick={handleNew} className="toolbar-btn primary">+ جديد</button>
            <button onClick={loadDrivers} className="toolbar-btn">تحميل</button>
            <button onClick={() => window.print()} className="toolbar-btn">طباعة</button>
          </div>
          
          <table className="data-grid">
            <thead>
              <tr>
                <th>الكود</th>
                <th>الاسم</th>
                <th>الهاتف</th>
                <th>رخصة القيادة</th>
                <th>تاريخ الانتهاء</th>
                <th>الحالة</th>
              </tr>
            </thead>
            <tbody>
              {drivers.map((driver) => (
                <tr key={driver.id} className={selectedDriver?.id === driver.id ? 'selected' : ''} onClick={() => handleEdit(driver)}>
                  <td>{driver.code}</td>
                  <td>{driver.name}</td>
                  <td>{driver.phone}</td>
                  <td>{driver.licenseNumber}</td>
                  <td>{driver.licenseExpiry}</td>
                  <td><span className={`status-badge ${driver.isActive ? 'bg-green-100 text-green-800' : 'bg-red-100 text-red-800'}`}>{driver.isActive ? 'نشط' : 'غير نشط'}</span></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {isEditing && (
          <div className="w-80 card overflow-auto">
            <div className="card-header">{selectedDriver ? 'تعديل سائق' : 'سائق جديد'}</div>
            <div className="space-y-3">
              <div className="form-group">
                <label className="form-label">الكود</label>
                <input type="text" className="form-input w-full" value={formData.code || ''} onChange={(e) => setFormData({...formData, code: e.target.value})} />
              </div>
              <div className="form-group">
                <label className="form-label">الاسم</label>
                <input type="text" className="form-input w-full" value={formData.name || ''} onChange={(e) => setFormData({...formData, name: e.target.value})} />
              </div>
              <div className="form-group">
                <label className="form-label">الهاتف</label>
                <input type="text" className="form-input w-full" value={formData.phone || ''} onChange={(e) => setFormData({...formData, phone: e.target.value})} />
              </div>
              <div className="form-group">
                <label className="form-label">رقم الرخصة</label>
                <input type="text" className="form-input w-full" value={formData.licenseNumber || ''} onChange={(e) => setFormData({...formData, licenseNumber: e.target.value})} />
              </div>
              <div className="form-group">
                <label className="form-label">تاريخ انتهاء الرخصة</label>
                <input type="date" className="form-input w-full" value={formData.licenseExpiry || ''} onChange={(e) => setFormData({...formData, licenseExpiry: e.target.value})} />
              </div>
              <div className="form-group">
                <label className="form-label">العنوان</label>
                <input type="text" className="form-input w-full" value={formData.address || ''} onChange={(e) => setFormData({...formData, address: e.target.value})} />
              </div>
              <div className="form-group">
                <label className="flex items-center gap-2">
                  <input type="checkbox" checked={formData.isActive || false} onChange={(e) => setFormData({...formData, isActive: e.target.checked})} />
                  نشط
                </label>
              </div>
              <div className="flex gap-2 pt-2">
                <button onClick={handleSave} className="toolbar-btn primary flex-1">حفظ</button>
                <button onClick={() => setIsEditing(false)} className="toolbar-btn flex-1">إلغاء</button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
