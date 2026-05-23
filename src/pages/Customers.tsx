import { useState, useEffect } from 'react';
import { phase15Gateway } from '../lib/api/phase15Gateway';
import { Customer } from '../types';
import { useToast } from '../components/Toast';

export default function Customers() {
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedCustomer, setSelectedCustomer] = useState<Customer | null>(null);
  const [isEditing, setIsEditing] = useState(false);
  const [searchTerm, setSearchTerm] = useState('');
  const { showToast } = useToast();

  const [formData, setFormData] = useState<Partial<Customer>>({
    code: '',
    name: '',
    phone: '',
    address: '',
    customerType: 'both',
    balance: 0,
    creditLimit: 0,
    notes: '',
  });

  useEffect(() => {
    loadCustomers();
  }, []);

  const loadCustomers = async () => {
    setLoading(true);
    try {
      const data = await phase15Gateway.customers.getAll();
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
      balance: 0,
      creditLimit: 0,
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
        await phase15Gateway.customers.update(selectedCustomer.id, formData);
        showToast('تم تحديث العميل بنجاح', 'success');
      } else {
        await phase15Gateway.customers.create(formData);
        showToast('تم إضافة العميل بنجاح', 'success');
      }
      await loadCustomers();
      setIsEditing(false);
    } catch {
      showToast('حدث خطأ أثناء الحفظ', 'error');
    }
  };

  const handleDelete = async (customer: Customer) => {
    if (confirm(`هل أنت متأكد من حذف العميل "${customer.name}"؟`)) {
      try {
        await phase15Gateway.customers.delete(customer.id);
        showToast('تم حذف العميل بنجاح', 'success');
        await loadCustomers();
      } catch {
        showToast('حدث خطأ أثناء الحذف', 'error');
      }
    }
  };

  const filteredCustomers = customers.filter(c =>
    c.name.includes(searchTerm) ||
    c.code.includes(searchTerm) ||
    c.phone.includes(searchTerm)
  );

  const customerTypeLabels = {
    sender: 'مرسل',
    receiver: 'مستلم',
    both: 'مرسل ومreceiver',
  };

  return (
    <div className="h-full flex flex-col">
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-xl font-bold">العملاء</h2>
        <div className="flex items-center gap-2">
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
        {/* Customers Grid */}
        <div className="flex-1 card overflow-auto">
          <div className="toolbar mb-2">
            <button onClick={handleNew} className="toolbar-btn primary">+ جديد</button>
            <button onClick={loadCustomers} className="toolbar-btn">تحميل</button>
            <button onClick={() => window.print()} className="toolbar-btn">🖨️ طباعة</button>
          </div>
          
          <table className="data-grid">
            <thead>
              <tr>
                <th>الكود</th>
                <th>الاسم</th>
                <th>الهاتف</th>
                <th>النوع</th>
                <th>الرصيد</th>
                <th>الحد الائتماني</th>
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
                  <td>{customerTypeLabels[customer.customerType]}</td>
                  <td className="text-left">{customer.balance.toLocaleString()}</td>
                  <td className="text-left">{customer.creditLimit.toLocaleString()}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {/* Edit Form */}
        {isEditing && (
          <div className="w-80 card overflow-auto">
            <div className="card-header">
              {selectedCustomer ? 'تعديل عميل' : 'عميل جديد'}
            </div>
            <div className="space-y-3">
              <div className="form-group">
                <label className="form-label">الكود</label>
                <input
                  type="text"
                  className="form-input w-full"
                  value={formData.code || ''}
                  onChange={(e) => setFormData({ ...formData, code: e.target.value })}
                  disabled={!!selectedCustomer}
                />
              </div>
              <div className="form-group">
                <label className="form-label">الاسم</label>
                <input
                  type="text"
                  className="form-input w-full"
                  value={formData.name || ''}
                  onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                />
              </div>
              <div className="form-group">
                <label className="form-label">الهاتف</label>
                <input
                  type="text"
                  className="form-input w-full"
                  value={formData.phone || ''}
                  onChange={(e) => setFormData({ ...formData, phone: e.target.value })}
                />
              </div>
              <div className="form-group">
                <label className="form-label">العنوان</label>
                <input
                  type="text"
                  className="form-input w-full"
                  value={formData.address || ''}
                  onChange={(e) => setFormData({ ...formData, address: e.target.value })}
                />
              </div>
              <div className="form-group">
                <label className="form-label">النوع</label>
                <select
                  className="form-select w-full"
                  value={formData.customerType || 'both'}
                  onChange={(e) => setFormData({ ...formData, customerType: e.target.value as any })}
                >
                  <option value="both">مرسل ومستلم</option>
                  <option value="sender">مرسل فقط</option>
                  <option value="receiver">مستلم فقط</option>
                </select>
              </div>
              <div className="form-group">
                <label className="form-label">الحد الائتماني</label>
                <input
                  type="number"
                  className="form-input w-full"
                  value={formData.creditLimit || 0}
                  onChange={(e) => setFormData({ ...formData, creditLimit: Number(e.target.value) })}
                />
              </div>
              <div className="form-group">
                <label className="form-label">ملاحظات</label>
                <textarea
                  className="form-input w-full"
                  rows={3}
                  value={formData.notes || ''}
                  onChange={(e) => setFormData({ ...formData, notes: e.target.value })}
                />
              </div>
              <div className="flex gap-2 pt-2">
                <button onClick={handleSave} className="toolbar-btn primary flex-1">حفظ</button>
                <button onClick={() => setIsEditing(false)} className="toolbar-btn flex-1">إلغاء</button>
                {selectedCustomer && (
                  <button
                    onClick={() => handleDelete(selectedCustomer)}
                    className="toolbar-btn danger"
                  >
                    حذف
                  </button>
                )}
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
