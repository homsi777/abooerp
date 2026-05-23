import { useState, useEffect } from 'react';
import { phase15Gateway } from '../lib/api/phase15Gateway';
import { Customer } from '../types';
import { useToast } from '../components/Toast';

export default function SendersReceivers() {
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedCustomer, setSelectedCustomer] = useState<Customer | null>(null);
  const [isEditing, setIsEditing] = useState(false);
  const [searchTerm, setSearchTerm] = useState('');
  const [filterType, setFilterType] = useState<'all' | 'sender' | 'receiver'>('all');
  const { showToast } = useToast();

  const [formData, setFormData] = useState<Partial<Customer>>({
    code: '',
    name: '',
    phone: '',
    address: '',
    customerType: 'both',
    notes: '',
  });

  useEffect(() => {
    loadCustomers();
  }, []);

  const loadCustomers = async () => {
    setLoading(true);
    try {
      const data = await phase15Gateway.sendersReceivers.getAll();
      setCustomers(data);
    } finally {
      setLoading(false);
    }
  };

  const handleNew = () => {
    setSelectedCustomer(null);
    setFormData({
      code: '',
      name: '',
      phone: '',
      address: '',
      customerType: 'both',
      notes: '',
    });
    setIsEditing(true);
  };

  const handleEdit = (customer: Customer) => {
    setSelectedCustomer(customer);
    setFormData(customer);
    setIsEditing(true);
  };

  const handleSave = async () => {
    try {
      if (selectedCustomer) {
        await phase15Gateway.sendersReceivers.update(selectedCustomer.id, formData);
        showToast('تم التحديث بنجاح', 'success');
      } else {
        await phase15Gateway.sendersReceivers.create(formData);
        showToast('تم الإضافة بنجاح', 'success');
      }
      await loadCustomers();
      setIsEditing(false);
    } catch {
      showToast('حدث خطأ', 'error');
    }
  };

  const filteredCustomers = customers.filter(c => {
    const matchesSearch = c.name.includes(searchTerm) || c.code.includes(searchTerm);
    if (filterType === 'all') return matchesSearch;
    return matchesSearch && (c.customerType === filterType || c.customerType === 'both');
  });

  return (
    <div className="h-full flex flex-col">
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-xl font-bold">الأطراف والعملاء</h2>
        <div className="flex items-center gap-2">
          <select
            className="form-select"
            value={filterType}
            onChange={(e) => setFilterType(e.target.value as any)}
          >
            <option value="all">الكل</option>
            <option value="sender">مرسلين</option>
            <option value="receiver">مستلمين</option>
          </select>
          <input
            type="text"
            placeholder="بحث..."
            className="form-input"
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
          />
        </div>
      </div>

      <div className="flex-1 flex gap-4 overflow-hidden">
        <div className="flex-1 card overflow-auto">
          <div className="toolbar mb-2">
            <button onClick={handleNew} className="toolbar-btn primary">+ جديد</button>
            <button onClick={loadCustomers} className="toolbar-btn">تحميل</button>
            <button onClick={() => window.print()} className="toolbar-btn">طباعة</button>
          </div>
          
          <table className="data-grid">
            <thead>
              <tr>
                <th>الكود</th>
                <th>الاسم</th>
                <th>الهاتف</th>
                <th>العنوان</th>
                <th>النوع</th>
              </tr>
            </thead>
            <tbody>
              {filteredCustomers.map((customer) => (
                <tr
                  key={customer.id}
                  className={selectedCustomer?.id === customer.id ? 'selected' : ''}
                  onClick={() => handleEdit(customer)}
                >
                  <td>{customer.code}</td>
                  <td>{customer.name}</td>
                  <td>{customer.phone}</td>
                  <td>{customer.address}</td>
                  <td>
                    {customer.customerType === 'sender' && 'مرسل'}
                    {customer.customerType === 'receiver' && 'مستلم'}
                    {customer.customerType === 'both' && 'مرسل ومستلم'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {isEditing && (
          <div className="w-80 card overflow-auto">
            <div className="card-header">
              {selectedCustomer ? 'تعديل' : 'إضافة جديد'}
            </div>
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
                <label className="form-label">العنوان</label>
                <input type="text" className="form-input w-full" value={formData.address || ''} onChange={(e) => setFormData({...formData, address: e.target.value})} />
              </div>
              <div className="form-group">
                <label className="form-label">النوع</label>
                <select className="form-select w-full" value={formData.customerType || 'both'} onChange={(e) => setFormData({...formData, customerType: e.target.value as any})}>
                  <option value="both">مرسل ومستلم</option>
                  <option value="sender">مرسل فقط</option>
                  <option value="receiver">مستلم فقط</option>
                </select>
              </div>
              <div className="form-group">
                <label className="form-label">ملاحظات</label>
                <textarea className="form-input w-full" rows={3} value={formData.notes || ''} onChange={(e) => setFormData({...formData, notes: e.target.value})} />
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
