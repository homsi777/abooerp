import { useState, useEffect } from 'react';
import type { GoodsType } from '../types';
import { useToast } from '../components/Toast';
import { phase15Gateway } from '../lib/api/phase15Gateway';

export default function GoodsTypes() {
  const [goodsTypes, setGoodsTypes] = useState<GoodsType[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedType, setSelectedType] = useState<GoodsType | null>(null);
  const [isEditing, setIsEditing] = useState(false);
  const [formData, setFormData] = useState<Partial<GoodsType>>({ code: '', name: '', description: '' });
  const { showToast } = useToast();

  useEffect(() => { loadGoodsTypes(); }, []);

  const loadGoodsTypes = async () => {
    setLoading(true);
    try {
      const data = await phase15Gateway.goodsTypes.getAll();
      setGoodsTypes(data);
    } finally {
      setLoading(false);
    }
  };

  const handleNew = () => {
    setSelectedType(null);
    setFormData({ code: '', name: '', description: '' });
    setIsEditing(true);
  };

  const handleEdit = (type: GoodsType) => {
    setSelectedType(type);
    setFormData(type);
    setIsEditing(true);
  };

  const handleSave = async () => {
    try {
      if (selectedType) {
        await phase15Gateway.goodsTypes.update(selectedType.id, formData);
        showToast('تم تحديث نوع البضاعة', 'success');
      } else {
        await phase15Gateway.goodsTypes.create(formData);
        showToast('تمت إضافة نوع بضاعة جديد', 'success');
      }
      setIsEditing(false);
      await loadGoodsTypes();
    } catch {
      showToast('تعذر حفظ نوع البضاعة', 'error');
    }
  };

  const handleDelete = async () => {
    if (!selectedType) return;
    try {
      await phase15Gateway.goodsTypes.delete(selectedType.id);
      showToast('تم حذف نوع البضاعة', 'success');
      setSelectedType(null);
      setIsEditing(false);
      await loadGoodsTypes();
    } catch {
      showToast('تعذر حذف نوع البضاعة', 'error');
    }
  };

  return (
    <div className="h-full flex flex-col">
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-xl font-bold">أنواع البضائع</h2>
      </div>

      <div className="flex-1 flex gap-4 overflow-hidden">
        <div className="flex-1 card overflow-auto">
          <div className="toolbar mb-2">
            <button onClick={handleNew} className="toolbar-btn primary">+ جديد</button>
            <button onClick={loadGoodsTypes} className="toolbar-btn">تحميل</button>
          </div>
          
          <table className="data-grid">
            <thead>
              <tr>
                <th>الكود</th>
                <th>الاسم</th>
                <th>الوصف</th>
              </tr>
            </thead>
            <tbody>
              {goodsTypes.map((type) => (
                <tr key={type.id} className={selectedType?.id === type.id ? 'selected' : ''} onClick={() => handleEdit(type)}>
                  <td>{type.code}</td>
                  <td>{type.name}</td>
                  <td>{type.description}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {isEditing && (
          <div className="w-72 card">
            <div className="card-header">{selectedType ? 'تعديل' : 'إضافة جديد'}</div>
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
                <label className="form-label">الوصف</label>
                <textarea className="form-input w-full" rows={3} value={formData.description || ''} onChange={(e) => setFormData({...formData, description: e.target.value})} />
              </div>
              <div className="flex gap-2 pt-2">
                <button onClick={handleSave} className="toolbar-btn primary flex-1">حفظ</button>
                <button onClick={() => setIsEditing(false)} className="toolbar-btn flex-1">إلغاء</button>
              </div>
              {selectedType && (
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
