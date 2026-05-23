import { useState, useEffect } from 'react';
import { phase3FinanceGateway } from '../lib/api/phase3FinanceGateway';
import type { PaymentVoucher } from '../types';
import { useToast } from '../components/Toast';
import { convertToUsd, formatCurrency, getExchangeRatesToUsd, parseDecimalAmount, type CurrencyCode } from '../lib/currency/currency';

export default function PaymentVoucher() {
  const [vouchers, setVouchers] = useState<PaymentVoucher[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedVoucher, setSelectedVoucher] = useState<PaymentVoucher | null>(null);
  const [isEditing, setIsEditing] = useState(false);
  const { showToast } = useToast();

  const rates = getExchangeRatesToUsd();
  const [formData, setFormData] = useState<Partial<PaymentVoucher>>({
    voucherNo: '', date: new Date().toISOString().split('T')[0], vendorId: 0, vendorName: '', amount: 0, currency: 'USD', paymentMethod: 'cash', bankName: '', chequeNo: '', description: ''
  });

  useEffect(() => { loadData(); }, []);

  const loadData = async () => {
    setLoading(true);
    try {
      const vouchersData = await phase3FinanceGateway.paymentVouchers.getAll();
      setVouchers(vouchersData);
    } finally { setLoading(false); }
  };

  const handleNew = () => {
    setSelectedVoucher(null);
    setFormData({ voucherNo: '', date: new Date().toISOString().split('T')[0], vendorId: 0, vendorName: '', amount: 0, paymentMethod: 'cash', bankName: '', chequeNo: '', description: '' });
    setIsEditing(true);
  };

  const handleEdit = (voucher: PaymentVoucher) => {
    setSelectedVoucher(voucher);
    setFormData(voucher);
    setIsEditing(true);
  };

  const handleSave = async () => {
    try {
      await phase3FinanceGateway.paymentVouchers.create({
        voucherNo: formData.voucherNo || `PV-FE-${Date.now()}`,
        status: 'draft',
        notes: formData.description || '',
        originalAmount: formData.amount || 0,
        originalCurrency: formData.currency || 'USD',
        exchangeRateToUsd: formData.exchangeRateToUsd || 1,
      });
      showToast('تم حفظ سند الدفع بنجاح', 'success');
      await loadData();
      setIsEditing(false);
    } catch { showToast('حدث خطأ', 'error'); }
  };

  const paymentLabels: Record<string, string> = { cash: 'نقدي', cheque: 'شيك', transfer: 'تحويل' };
  const equivalentUsd = convertToUsd(formData.amount || 0, (formData.currency || 'USD') as CurrencyCode, rates);

  const vendors = [
    { id: 1, name: 'محطة الوقود المركزية' },
    { id: 2, name: 'شركة غاز' },
    { id: 3, name: 'مركز الصيانة' },
  ];

  return (
    <div className="h-full flex flex-col">
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-xl font-bold">سندات الدفع</h2>
        <button onClick={loadData} className="toolbar-btn">تحميل</button>
      </div>

      <div className="flex-1 flex gap-4 overflow-hidden">
        <div className="flex-1 card overflow-auto">
          <div className="toolbar mb-2">
            <button onClick={handleNew} className="toolbar-btn primary">+ جديد</button>
            <button onClick={() => window.print()} className="toolbar-btn">طباعة</button>
          </div>
          <table className="data-grid">
            <thead>
              <tr>
                <th>رقم السند</th>
                <th>التاريخ</th>
                <th>المورد</th>
                <th>المبلغ الأصلي</th>
                <th>المبلغ USD</th>
                <th>طريقة الدفع</th>
                <th>الوصف</th>
              </tr>
            </thead>
            <tbody>
              {vouchers.map((v) => (
                <tr key={v.id} className={selectedVoucher?.id === v.id ? 'selected' : ''} onClick={() => handleEdit(v)}>
                  <td>{v.voucherNo}</td>
                  <td>{v.date}</td>
                  <td>{v.vendorName}</td>
                  <td className="text-left">{formatCurrency(v.amount, (v.currency || 'USD') as CurrencyCode)}</td>
                  <td className="text-left">{formatCurrency(v.amountUsd || convertToUsd(v.amount, (v.currency || 'USD') as CurrencyCode, rates), 'USD')}</td>
                  <td>{paymentLabels[v.paymentMethod]}</td>
                  <td>{v.description}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {isEditing && (
          <div className="w-96 card overflow-auto">
            <div className="card-header">{selectedVoucher ? 'تعديل سند دفع' : 'سند دفع جديد'}</div>
            <div className="space-y-3">
              <div className="form-group">
                <label className="form-label">التاريخ</label>
                <input type="date" className="form-input w-full" value={formData.date || ''} onChange={(e) => setFormData({...formData, date: e.target.value})} />
              </div>
              <div className="form-group">
                <label className="form-label">المورد</label>
                <select className="form-select w-full" value={formData.vendorId || ''} onChange={(e) => {
                  const vendor = vendors.find(v => v.id === Number(e.target.value));
                  setFormData({...formData, vendorId: Number(e.target.value), vendorName: vendor?.name || ''});
                }}>
                  <option value="">اختر...</option>
                  {vendors.map(v => <option key={v.id} value={v.id}>{v.name}</option>)}
                </select>
              </div>
              <div className="form-group">
                <label className="form-label">المبلغ</label>
                <input type="number" step="0.01" className="form-input w-full" value={formData.amount || 0} onChange={(e) => setFormData({...formData, amount: parseDecimalAmount(e.target.value)})} />
              </div>
              <div className="form-group">
                <label className="form-label">العملة</label>
                <select className="form-select w-full" value={formData.currency || 'USD'} onChange={(e) => setFormData({...formData, currency: e.target.value as CurrencyCode})}>
                  <option value="USD">USD</option>
                  <option value="SYP">SYP</option>
                  <option value="TRY">TRY</option>
                </select>
              </div>
              <div className="form-group">
                <label className="form-label">المكافئ بالدولار</label>
                <input type="text" className="form-input w-full bg-gray-100" value={formatCurrency(equivalentUsd, 'USD')} readOnly />
              </div>
              <div className="form-group">
                <label className="form-label">طريقة الدفع</label>
                <select className="form-select w-full" value={formData.paymentMethod || 'cash'} onChange={(e) => setFormData({...formData, paymentMethod: e.target.value as any})}>
                  <option value="cash">نقدي</option>
                  <option value="cheque">شيك</option>
                  <option value="transfer">تحويل</option>
                </select>
              </div>
              <div className="form-group">
                <label className="form-label">اسم البنك</label>
                <input type="text" className="form-input w-full" value={formData.bankName || ''} onChange={(e) => setFormData({...formData, bankName: e.target.value})} />
              </div>
              <div className="form-group">
                <label className="form-label">رقم الشيك</label>
                <input type="text" className="form-input w-full" value={formData.chequeNo || ''} onChange={(e) => setFormData({...formData, chequeNo: e.target.value})} />
              </div>
              <div className="form-group">
                <label className="form-label">الوصف</label>
                <textarea className="form-input w-full" rows={2} value={formData.description || ''} onChange={(e) => setFormData({...formData, description: e.target.value})} />
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
