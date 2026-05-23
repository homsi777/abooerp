import { useState, useEffect } from 'react';
import { phase15Gateway } from '../lib/api/phase15Gateway';
import { Vehicle } from '../types';
import { useToast } from '../components/Toast';

export default function Vehicles() {
  const [vehicles, setVehicles] = useState<Vehicle[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedVehicle, setSelectedVehicle] = useState<Vehicle | null>(null);
  const [isEditing, setIsEditing] = useState(false);
  const { showToast } = useToast();

  const [formData, setFormData] = useState<Partial<Vehicle>>({
    plateNumber: '', type: '', model: '', capacity: 0, isActive: true, notes: ''
  });

  useEffect(() => { loadVehicles(); }, []);

  const loadVehicles = async () => {
    setLoading(true);
    try {
      const data = await phase15Gateway.vehicles.getAll();
      setVehicles(data);
    } finally { setLoading(false); }
  };

  const handleNew = () => {
    setSelectedVehicle(null);
    setFormData({ plateNumber: '', type: '', model: '', capacity: 0, isActive: true, notes: '' });
    setIsEditing(true);
  };

  const handleEdit = (vehicle: Vehicle) => {
    setSelectedVehicle(vehicle);
    setFormData(vehicle);
    setIsEditing(true);
  };

  const handleSave = async () => {
    try {
      if (selectedVehicle) {
        await phase15Gateway.vehicles.update(selectedVehicle.id, formData);
        showToast('تم التحديث بنجاح', 'success');
      } else {
        await phase15Gateway.vehicles.create(formData);
        showToast('تم الإضافة بنجاح', 'success');
      }
      await loadVehicles();
      setIsEditing(false);
    } catch {
      showToast('حدث خطأ', 'error');
    }
  };

  return (
    <div className="h-full flex flex-col">
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-xl font-bold">المركبات</h2>
      </div>

      <div className="flex-1 flex gap-4 overflow-hidden">
        <div className="flex-1 card overflow-auto">
          <div className="toolbar mb-2">
            <button onClick={handleNew} className="toolbar-btn primary">+ جديد</button>
            <button onClick={loadVehicles} className="toolbar-btn">تحميل</button>
            <button onClick={() => window.print()} className="toolbar-btn">طباعة</button>
          </div>
          
          <table className="data-grid">
            <thead>
              <tr>
                <th>اللوحة</th>
                <th>النوع</th>
                <th>الموديل</th>
                <th>السعة (كغ)</th>
                <th>الحالة</th>
                <th>ملاحظات</th>
              </tr>
            </thead>
            <tbody>
              {vehicles.map((vehicle) => (
                <tr key={vehicle.id} className={selectedVehicle?.id === vehicle.id ? 'selected' : ''} onClick={() => handleEdit(vehicle)}>
                  <td>{vehicle.plateNumber}</td>
                  <td>{vehicle.type}</td>
                  <td>{vehicle.model}</td>
                  <td className="text-left">{vehicle.capacity.toLocaleString()}</td>
                  <td><span className={`status-badge ${vehicle.isActive ? 'bg-green-100 text-green-800' : 'bg-red-100 text-red-800'}`}>{vehicle.isActive ? 'نشط' : 'صيانة'}</span></td>
                  <td>{vehicle.notes}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {isEditing && (
          <div className="w-80 card overflow-auto">
            <div className="card-header">{selectedVehicle ? 'تعديل مركبة' : 'مركبة جديدة'}</div>
            <div className="space-y-3">
              <div className="form-group">
                <label className="form-label">رقم اللوحة</label>
                <input type="text" className="form-input w-full" value={formData.plateNumber || ''} onChange={(e) => setFormData({...formData, plateNumber: e.target.value})} />
              </div>
              <div className="form-group">
                <label className="form-label">النوع</label>
                <select className="form-select w-full" value={formData.type || ''} onChange={(e) => setFormData({...formData, type: e.target.value})}>
                  <option value="">اختر...</option>
                  <option value="شاحنة كبيرة">شاحنة كبيرة</option>
                  <option value="شاحنة متوسطة">شاحنة متوسطة</option>
                  <option value="شاحنة صغيرة">شاحنة صغيرة</option>
                  <option value="فان">فان</option>
                </select>
              </div>
              <div className="form-group">
                <label className="form-label">الموديل</label>
                <input type="text" className="form-input w-full" value={formData.model || ''} onChange={(e) => setFormData({...formData, model: e.target.value})} />
              </div>
              <div className="form-group">
                <label className="form-label">السعة (كغ)</label>
                <input type="number" className="form-input w-full" value={formData.capacity || 0} onChange={(e) => setFormData({...formData, capacity: Number(e.target.value)})} />
              </div>
              <div className="form-group">
                <label className="form-label">ملاحظات</label>
                <textarea className="form-input w-full" rows={2} value={formData.notes || ''} onChange={(e) => setFormData({...formData, notes: e.target.value})} />
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
