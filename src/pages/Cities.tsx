import { useState, useEffect } from 'react';
import type { City } from '../types';
import { useToast } from '../components/Toast';
import { phase15Gateway } from '../lib/api/phase15Gateway';

export default function Cities() {
  const [cities, setCities] = useState<City[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedCity, setSelectedCity] = useState<City | null>(null);
  const [isEditing, setIsEditing] = useState(false);
  const [searchTerm, setSearchTerm] = useState('');
  const { showToast } = useToast();

  const [formData, setFormData] = useState<Partial<City>>({
    code: '',
    name: '',
    region: '',
    hasBranch: false,
  });

  useEffect(() => { loadCities(); }, []);

  const loadCities = async () => {
    setLoading(true);
    try {
      const data = await phase15Gateway.cities.getAll();
      setCities(data);
    } finally {
      setLoading(false);
    }
  };

  const handleNew = () => {
    setSelectedCity(null);
    setFormData({ code: '', name: '', region: '', hasBranch: false });
    setIsEditing(true);
  };

  const handleEdit = (city: City) => {
    setSelectedCity(city);
    setFormData(city);
    setIsEditing(true);
  };

  const filteredCities = cities.filter(c => c.name.includes(searchTerm) || c.code.includes(searchTerm));

  const handleSave = async () => {
    try {
      if (selectedCity) {
        await phase15Gateway.cities.update(selectedCity.id, formData);
        showToast('تم تحديث المدينة بنجاح', 'success');
      } else {
        await phase15Gateway.cities.create(formData);
        showToast('تمت إضافة المدينة بنجاح', 'success');
      }
      setIsEditing(false);
      await loadCities();
    } catch {
      showToast('تعذر حفظ بيانات المدينة', 'error');
    }
  };

  const handleDelete = async () => {
    if (!selectedCity) return;
    try {
      await phase15Gateway.cities.delete(selectedCity.id);
      showToast('تم حذف المدينة بنجاح', 'success');
      setSelectedCity(null);
      setIsEditing(false);
      await loadCities();
    } catch {
      showToast('تعذر حذف المدينة', 'error');
    }
  };

  return (
    <div className="h-full flex flex-col">
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-xl font-bold">البلدان / المدن</h2>
        <input type="text" placeholder="بحث..." className="form-input" value={searchTerm} onChange={(e) => setSearchTerm(e.target.value)} />
      </div>

      <div className="flex-1 flex gap-4 overflow-hidden">
        <div className="flex-1 card overflow-auto">
          <div className="toolbar mb-2">
            <button onClick={handleNew} className="toolbar-btn primary">+ جديد</button>
            <button onClick={loadCities} className="toolbar-btn">تحميل</button>
          </div>
          
          <table className="data-grid">
            <thead>
              <tr>
                <th>الكود</th>
                <th>الاسم</th>
                <th>المنطقة</th>
                <th>يوجد فرع</th>
              </tr>
            </thead>
            <tbody>
              {filteredCities.map((city) => (
                <tr key={city.id} className={selectedCity?.id === city.id ? 'selected' : ''} onClick={() => handleEdit(city)}>
                  <td>{city.code}</td>
                  <td>{city.name}</td>
                  <td>{city.region}</td>
                  <td>{city.hasBranch ? 'نعم' : 'لا'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {isEditing && (
          <div className="w-72 card">
            <div className="card-header">{selectedCity ? 'تعديل' : 'إضافة جديد'}</div>
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
                <label className="form-label">المنطقة</label>
                <input type="text" className="form-input w-full" value={formData.region || ''} onChange={(e) => setFormData({...formData, region: e.target.value})} />
              </div>
              <div className="form-group">
                <label className="flex items-center gap-2">
                  <input type="checkbox" checked={formData.hasBranch || false} onChange={(e) => setFormData({...formData, hasBranch: e.target.checked})} />
                  يوجد فرع
                </label>
              </div>
              <div className="flex gap-2 pt-2">
                <button onClick={handleSave} className="toolbar-btn primary flex-1">حفظ</button>
                <button onClick={() => setIsEditing(false)} className="toolbar-btn flex-1">إلغاء</button>
              </div>
              {selectedCity && (
                <button onClick={handleDelete} className="toolbar-btn w-full bg-red-100 text-red-700 hover:bg-red-200">
                  حذف
                </button>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
