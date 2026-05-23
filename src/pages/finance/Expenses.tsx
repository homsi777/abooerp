import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { convertToUsd, formatCurrency, getExchangeRatesToUsd, type CurrencyCode } from '../../lib/currency/currency';
import { phase3FinanceGateway } from '../../lib/api/phase3FinanceGateway';
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
  const [loading, setLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const list = await phase3FinanceGateway.paymentVouchers.getAll();
      setVouchers(list);
    } catch (e) {
      showToast(e instanceof Error ? e.message : 'تعذر تحميل سندات الدفع', 'error');
      setVouchers([]);
    } finally {
      setLoading(false);
    }
  }, [showToast]);

  useEffect(() => {
    void load();
  }, [load]);

  const ymd = (d: string) => d.split('T')[0] ?? d;

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
      if (d === today) {
        const usd = v.amountUsd ?? convertToUsd(v.amount, (v.currency ?? 'USD') as CurrencyCode, rates);
        todayUsd += usd;
      }
      if (d.startsWith(`${y}-${m}`)) {
        const usd = v.amountUsd ?? convertToUsd(v.amount, (v.currency ?? 'USD') as CurrencyCode, rates);
        monthUsd += usd;
      }
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
      title: 'المصاريف (سندات دفع)',
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
          v.description || '—',
        ];
      }),
    });

    if (result.saved) showToast('تم حفظ ملف PDF', 'success');
    else if (result.message !== 'cancelled') showToast('تعذر إنشاء PDF', 'error');
  };

  if (loading) {
    return <div className="p-4 text-gray-500">جاري تحميل سندات الدفع...</div>;
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-xl font-bold">المصاريف (سندات دفع)</h2>
        <div className="flex flex-wrap gap-2">
          <Link to="/finance/vouchers" className="toolbar-btn primary">
            إدارة السندات
          </Link>
          <button type="button" className="toolbar-btn" onClick={() => void load()}>
            تحديث
          </button>
          <button type="button" className="toolbar-btn" onClick={exportCsv}>
            تصدير Excel (CSV)
          </button>
          <button type="button" className="toolbar-btn" onClick={() => void exportPdf()}>
            تصدير PDF
          </button>
          <button type="button" className="toolbar-btn" onClick={() => window.print()}>
            طباعة
          </button>
        </div>
      </div>

      <p className="text-sm text-gray-600 max-w-2xl">
        تُسجَّل المصاريف عبر <strong>سندات الدفع</strong> في النظام؛ هذه الصفحة تعرضها للاطلاع فقط (بلا بيانات تجريبية منفصلة).
      </p>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <div className="stat-card">
          <div className="stat-value">{formatCurrency(todayTotal, 'USD')}</div>
          <div className="stat-label">تقدير اليوم (سندات دفع — دولار)</div>
        </div>
        <div className="stat-card">
          <div className="stat-value">{formatCurrency(monthTotal, 'USD')}</div>
          <div className="stat-label">تقدير الشهر (بالدولار)</div>
        </div>
        <div className="stat-card">
          <div className="stat-value">{draftCount}</div>
          <div className="stat-label">مسودات (حالة)</div>
        </div>
        <div className="stat-card">
          <div className="stat-value">{vouchers.length}</div>
          <div className="stat-label">إجمالي السجلات</div>
        </div>
      </div>

      <div className="card">
        <input
          type="text"
          placeholder="بحث برقم السند، المستفيد، الملاحظات..."
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
                  <td className="text-left">{formatCurrency(v.amount, cur)}</td>
                  <td className="text-left">{formatCurrency(usd, 'USD')}</td>
                  <td>
                    {v.paymentMethod === 'cheque' ? 'شيك' : v.paymentMethod === 'transfer' ? 'تحويل' : 'نقدي'}
                  </td>
                  <td>
                    <span className={`status-badge ${statusStyle[st] ?? 'bg-gray-100'}`}>
                      {statusAr[st] ?? st}
                    </span>
                  </td>
                  <td>{v.description || '—'}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
        {filtered.length === 0 && <p className="p-4 text-gray-500">لا سجلات</p>}
      </div>
    </div>
  );
}
