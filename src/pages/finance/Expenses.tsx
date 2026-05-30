import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { convertToUsd, formatCurrency, getExchangeRatesToUsd, type CurrencyCode } from '../../lib/currency/currency';
import { phase3FinanceGateway, type BackendCashboxRecord } from '../../lib/api/phase3FinanceGateway';
import type { PaymentVoucher } from '../../types';
import { useToast } from '../../components/Toast';
import { downloadCsv } from '../../lib/export/csvDownload';
import { exportPdfTable } from '../../lib/export/pdfExport';

const statusStyle: Record<string, string> = {
  draft: 'bg-yellow-100 text-yellow-800',
  confirmed: 'bg-green-100 text-green-800',
  cancelled: 'bg-red-100 text-red-800',
};

const statusAr: Record<string, string> = {
  draft: 'مسودة',
  confirmed: 'مؤكد',
  cancelled: 'ملغى',
};

export default function FinanceExpenses() {
  const { showToast } = useToast();
  const rates = getExchangeRatesToUsd();
  const [vouchers, setVouchers] = useState<PaymentVoucher[]>([]);
  const [cashboxes, setCashboxes] = useState<BackendCashboxRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState('');
  const [showCreate, setShowCreate] = useState(false);
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState({
    date: new Date().toISOString().split('T')[0] ?? '',
    category: '',
    amount: 0,
    currency: 'USD' as CurrencyCode,
    cashboxId: '',
    description: '',
  });

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [list, cashboxRows] = await Promise.all([
        phase3FinanceGateway.paymentVouchers.getAll(),
        phase3FinanceGateway.cashbox.listMaster({ isActive: 'true' }),
      ]);
      setVouchers(list);
      setCashboxes(cashboxRows);
    } catch (e) {
      showToast(e instanceof Error ? e.message : 'تعذر تحميل المصاريف', 'error');
      setVouchers([]);
    } finally {
      setLoading(false);
    }
  }, [showToast]);

  useEffect(() => {
    void load();
  }, [load]);

  const ymd = (d: string) => d.split('T')[0] ?? d;

  const cashboxesForCurrency = useMemo(
    () => cashboxes.filter((c) => c.is_active && c.currency_code === form.currency),
    [cashboxes, form.currency],
  );

  const { todayTotal, monthTotal, draftCount, filtered } = useMemo(() => {
    const clock = new Date();
    const today = clock.toISOString().split('T')[0] ?? '';
    const m = String(clock.getMonth() + 1).padStart(2, '0');
    const y = String(clock.getFullYear());
    const q = searchTerm.trim().toLowerCase();

    let todayUsd = 0;
    let monthUsd = 0;
    let draft = 0;
    for (const v of vouchers) {
      const d = ymd(v.date);
      const cur = (v.currency ?? 'USD') as CurrencyCode;
      const usd = v.amountUsd ?? convertToUsd(v.amount, cur, rates);
      if (d === today) todayUsd += usd;
      if (d.startsWith(`${y}-${m}`)) monthUsd += usd;
      if (v.createdBy === 'draft') draft += 1;
    }

    const fil = vouchers.filter((e) => {
      if (!q) return true;
      return (
        e.voucherNo.toLowerCase().includes(q) ||
        e.vendorName.toLowerCase().includes(q) ||
        (e.description && e.description.toLowerCase().includes(q))
      );
    });
    return { todayTotal: todayUsd, monthTotal: monthUsd, draftCount: draft, filtered: fil };
  }, [vouchers, searchTerm, rates]);

  const resetForm = () => {
    setForm({
      date: new Date().toISOString().split('T')[0] ?? '',
      category: '',
      amount: 0,
      currency: 'USD',
      cashboxId: '',
      description: '',
    });
  };

  const createExpense = async () => {
    if (!form.category.trim()) {
      showToast('يجب إدخال نوع المصروف', 'error');
      return;
    }
    if (!form.amount || form.amount <= 0) {
      showToast('يجب إدخال مبلغ صحيح', 'error');
      return;
    }
    if (!form.cashboxId) {
      showToast('يجب اختيار صندوق للمصروف', 'error');
      return;
    }
    setSaving(true);
    try {
      const notes = [form.category.trim(), form.description.trim()].filter(Boolean).join(' - ');
      await phase3FinanceGateway.paymentVouchers.create({
        voucherNo: `EXP-${Date.now()}`,
        relatedEntityType: 'expense',
        status: 'confirmed',
        notes,
        originalAmount: form.amount,
        originalCurrency: form.currency,
        exchangeRateToUsd: rates[form.currency] ?? 1,
        createdAt: new Date(`${form.date}T12:00:00`).toISOString(),
        cashboxId: form.cashboxId,
      });
      showToast('تمت إضافة المصروف وربطه بسند دفع وحركة صندوق', 'success');
      setShowCreate(false);
      resetForm();
      await load();
    } catch (e) {
      showToast(e instanceof Error ? e.message : 'تعذر إضافة المصروف', 'error');
    } finally {
      setSaving(false);
    }
  };

  const exportCsv = () => {
    downloadCsv(
      `expenses-${new Date().toISOString().split('T')[0]}.csv`,
      ['رقم السند', 'التاريخ', 'المستفيد', 'المبلغ', 'العملة', 'USD', 'الطريقة', 'الحالة', 'الوصف'],
      filtered.map((v) => {
        const cur = (v.currency ?? 'USD') as CurrencyCode;
        const usd = v.amountUsd ?? convertToUsd(v.amount, cur, rates);
        const st = v.createdBy;
        return [
          v.voucherNo,
          v.date,
          v.vendorName,
          v.amount,
          cur,
          usd,
          v.paymentMethod === 'cheque' ? 'شيك' : v.paymentMethod === 'transfer' ? 'تحويل' : 'نقدي',
          statusAr[st] ?? st,
          v.description || '',
        ];
      }),
    );
    showToast('تم تنزيل الملف', 'success');
  };

  const exportPdf = async () => {
    const result = await exportPdfTable({
      title: 'المصاريف',
      subtitle: searchTerm.trim() ? `بحث: ${searchTerm.trim()}` : undefined,
      defaultFileName: `expenses-${new Date().toISOString().split('T')[0]}.pdf`,
      headers: ['رقم السند', 'التاريخ', 'المستفيد', 'المبلغ', 'USD', 'الطريقة', 'الحالة', 'الوصف'],
      rows: filtered.map((v) => {
        const cur = (v.currency ?? 'USD') as CurrencyCode;
        const usd = v.amountUsd ?? convertToUsd(v.amount, cur, rates);
        const st = v.createdBy;
        return [
          v.voucherNo,
          v.date,
          v.vendorName,
          formatCurrency(v.amount, cur),
          formatCurrency(usd, 'USD'),
          v.paymentMethod === 'cheque' ? 'شيك' : v.paymentMethod === 'transfer' ? 'تحويل' : 'نقدي',
          statusAr[st] ?? st,
          v.description || '-',
        ];
      }),
    });

    if (result.saved) showToast('تم حفظ ملف PDF', 'success');
    else if (result.message !== 'cancelled') showToast('تعذر إنشاء PDF', 'error');
  };

  if (loading) {
    return <div className="p-4 text-gray-500">جاري تحميل المصاريف...</div>;
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-xl font-bold">المصاريف</h2>
        <div className="flex flex-wrap gap-2">
          <button type="button" className="toolbar-btn primary" onClick={() => setShowCreate(true)}>إضافة مصروف</button>
          <Link to="/finance/vouchers" className="toolbar-btn">إدارة السندات</Link>
          <button type="button" className="toolbar-btn" onClick={() => void load()}>تحديث</button>
          <button type="button" className="toolbar-btn" onClick={exportCsv}>تصدير Excel (CSV)</button>
          <button type="button" className="toolbar-btn" onClick={() => void exportPdf()}>تصدير PDF</button>
          <button type="button" className="toolbar-btn" onClick={() => window.print()}>طباعة</button>
        </div>
      </div>

      <p className="text-sm text-gray-600 max-w-2xl">
        يتم تسجيل المصروف كسند دفع مؤكد مرتبط بصندوق، ويظهر أثره مباشرة في كشف الصندوق كحركة صادرة.
      </p>

      {showCreate && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <div className="bg-white rounded-lg shadow-xl w-full max-w-lg max-h-[90vh] overflow-auto">
            <div className="flex items-center justify-between p-4 border-b">
              <h3 className="font-bold text-lg">إضافة مصروف</h3>
              <button type="button" onClick={() => setShowCreate(false)} className="text-gray-400 hover:text-gray-600 text-xl leading-none">×</button>
            </div>
            <div className="p-4 space-y-3">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-sm font-medium mb-1">التاريخ</label>
                  <input type="date" className="form-input w-full" value={form.date} onChange={(e) => setForm((f) => ({ ...f, date: e.target.value }))} />
                </div>
                <div>
                  <label className="block text-sm font-medium mb-1">نوع المصروف *</label>
                  <input className="form-input w-full" value={form.category} onChange={(e) => setForm((f) => ({ ...f, category: e.target.value }))} placeholder="وقود، إيجار، صيانة..." />
                </div>
                <div>
                  <label className="block text-sm font-medium mb-1">المبلغ *</label>
                  <input type="number" min="0" step="0.01" className="form-input w-full" value={form.amount} onChange={(e) => setForm((f) => ({ ...f, amount: Number(e.target.value) || 0 }))} />
                </div>
                <div>
                  <label className="block text-sm font-medium mb-1">العملة</label>
                  <select className="form-input w-full" value={form.currency} onChange={(e) => setForm((f) => ({ ...f, currency: e.target.value as CurrencyCode, cashboxId: '' }))}>
                    <option value="USD">USD</option>
                    <option value="SYP">SYP</option>
                    <option value="TRY">TRY</option>
                  </select>
                </div>
                <div className="col-span-2">
                  <label className="block text-sm font-medium mb-1">الصندوق *</label>
                  <select className="form-input w-full" value={form.cashboxId} onChange={(e) => setForm((f) => ({ ...f, cashboxId: e.target.value }))}>
                    <option value="">اختر الصندوق</option>
                    {cashboxesForCurrency.map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.name} ({c.code}) - {formatCurrency(Number(c.current_balance), c.currency_code as CurrencyCode)}
                      </option>
                    ))}
                  </select>
                  {cashboxesForCurrency.length === 0 && <p className="text-xs text-red-600 mt-1">لا يوجد صندوق نشط بهذه العملة.</p>}
                </div>
                <div className="col-span-2">
                  <label className="block text-sm font-medium mb-1">البيان</label>
                  <textarea className="form-input w-full" rows={3} value={form.description} onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))} />
                </div>
              </div>
              <div className="bg-amber-50 text-amber-900 text-sm rounded p-3">
                عند الحفظ سيتم إنشاء سند دفع مؤكد وحركة صندوق صادرة مباشرة.
              </div>
              <div className="flex gap-2 justify-end">
                <button type="button" className="toolbar-btn" onClick={() => setShowCreate(false)}>إلغاء</button>
                <button type="button" className="toolbar-btn primary" onClick={() => void createExpense()} disabled={saving}>
                  {saving ? 'جار الحفظ...' : 'حفظ المصروف'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <div className="stat-card">
          <div className="stat-value">{formatCurrency(todayTotal, 'USD')}</div>
          <div className="stat-label">تقدير اليوم بالدولار</div>
        </div>
        <div className="stat-card">
          <div className="stat-value">{formatCurrency(monthTotal, 'USD')}</div>
          <div className="stat-label">تقدير الشهر بالدولار</div>
        </div>
        <div className="stat-card">
          <div className="stat-value">{draftCount}</div>
          <div className="stat-label">مسودات</div>
        </div>
        <div className="stat-card">
          <div className="stat-value">{vouchers.length}</div>
          <div className="stat-label">إجمالي السجلات</div>
        </div>
      </div>

      <div className="card">
        <input
          type="text"
          placeholder="بحث برقم السند، المستفيد، البيان..."
          className="form-input w-full"
          value={searchTerm}
          onChange={(e) => setSearchTerm(e.target.value)}
        />
      </div>

      <div className="card overflow-auto">
        <table className="data-grid text-sm">
          <thead>
            <tr>
              <th>رقم السند</th>
              <th>التاريخ</th>
              <th>المستفيد / الطرف</th>
              <th>الصندوق</th>
              <th>المبلغ</th>
              <th>USD</th>
              <th>الطريقة</th>
              <th>الحالة</th>
              <th>الوصف</th>
            </tr>
          </thead>
          <tbody>
            {filtered.map((v) => {
              const cur = (v.currency ?? 'USD') as CurrencyCode;
              const usd = v.amountUsd ?? convertToUsd(v.amount, cur, rates);
              const st = v.createdBy;
              return (
                <tr key={v.id}>
                  <td>{v.voucherNo}</td>
                  <td>{v.date}</td>
                  <td>{v.vendorName}</td>
                  <td>{v.cashboxName ?? '-'}</td>
                  <td className="text-left">{formatCurrency(v.amount, cur)}</td>
                  <td className="text-left">{formatCurrency(usd, 'USD')}</td>
                  <td>{v.paymentMethod === 'cheque' ? 'شيك' : v.paymentMethod === 'transfer' ? 'تحويل' : 'نقدي'}</td>
                  <td>
                    <span className={`status-badge ${statusStyle[st] ?? 'bg-gray-100'}`}>
                      {statusAr[st] ?? st}
                    </span>
                  </td>
                  <td>{v.description || '-'}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
        {filtered.length === 0 && <p className="p-4 text-gray-500">لا توجد سجلات</p>}
      </div>
    </div>
  );
}
