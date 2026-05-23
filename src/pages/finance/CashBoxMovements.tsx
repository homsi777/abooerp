import { useEffect, useMemo, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { formatCurrency, type CurrencyCode } from '../../lib/currency/currency';
import { phase3FinanceGateway, type BackendCashboxMovementRow } from '../../lib/api/phase3FinanceGateway';
import { useToast } from '../../components/Toast';
import { downloadCsv } from '../../lib/export/csvDownload';
import { exportPdfTable } from '../../lib/export/pdfExport';

export default function CashBoxMovements() {
  const { id } = useParams<{ id: string }>();
  const { showToast } = useToast();
  const [cashboxName, setCashboxName] = useState('');
  const [currency, setCurrency] = useState<CurrencyCode>('USD');
  const [opening, setOpening] = useState(0);
  const [rows, setRows] = useState<BackendCashboxMovementRow[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!id) return;
    const run = async () => {
      setLoading(true);
      try {
        const [cb, movements] = await Promise.all([
          phase3FinanceGateway.cashbox.getOne(id),
          phase3FinanceGateway.cashbox.getMovements(id),
        ]);
        setCashboxName(cb.name);
        setCurrency(cb.currency_code as CurrencyCode);
        setOpening(Number(cb.opening_balance));
        setRows(movements);
      } catch {
        showToast('تعذر تحميل حركات الصندوق', 'error');
      } finally {
        setLoading(false);
      }
    };
    void run();
  }, [id, showToast]);

  const withRunning = useMemo(() => {
    let running = opening;
    return rows.map((r) => {
      const amt = Number(r.original_amount);
      const delta = r.transaction_type === 'inflow' ? amt : -amt;
      running += delta;
      return { ...r, running_after: running, inflow: r.transaction_type === 'inflow' ? amt : 0, outflow: r.transaction_type === 'outflow' ? amt : 0 };
    });
  }, [rows, opening]);

  const exportCsv = () => {
    downloadCsv(
      `cashbox-movements-${id}-${new Date().toISOString().split('T')[0]}.csv`,
      ['#', 'التاريخ', 'نوع الحركة', 'مرجع', 'البيان', 'وارد', 'صادر', 'الرصيد بعد', 'العملة', 'المستخدم'],
      withRunning.map((r, i) => [
        i + 1,
        r.created_at.split('T')[0],
        r.transaction_type === 'inflow' ? 'وارد' : 'صادر',
        `${r.source_voucher_type} / ${r.source_voucher_id.slice(0, 8)}…`,
        r.notes || '',
        r.inflow || '',
        r.outflow || '',
        r.running_after,
        r.original_currency,
        r.created_by_username ?? '',
      ]),
    );
    showToast('تم تنزيل الملف', 'success');
  };

  const exportPdf = async () => {
    const result = await exportPdfTable({
      title: 'حركات الصندوق',
      subtitle: `${cashboxName || '—'} · ${currency} · رصيد افتتاحي: ${formatCurrency(opening, currency)}`,
      defaultFileName: `cashbox-movements-${id}-${new Date().toISOString().split('T')[0]}.pdf`,
      headers: ['#', 'التاريخ', 'نوع الحركة', 'مرجع', 'البيان', 'وارد', 'صادر', 'الرصيد بعد', 'العملة', 'المستخدم'],
      rows: withRunning.map((r, i) => [
        i + 1,
        r.created_at.split('T')[0],
        r.transaction_type === 'inflow' ? 'وارد' : 'صادر',
        `${r.source_voucher_type} / ${r.source_voucher_id.slice(0, 8)}…`,
        r.notes || '—',
        r.inflow ? formatCurrency(r.inflow, currency) : '—',
        r.outflow ? formatCurrency(r.outflow, currency) : '—',
        formatCurrency(r.running_after, currency),
        r.original_currency,
        r.created_by_username ?? '—',
      ]),
    });

    if (result.saved) showToast('تم حفظ ملف PDF', 'success');
    else if (result.message !== 'cancelled') showToast('تعذر إنشاء PDF', 'error');
  };

  if (!id) {
    return <div className="p-4">معرف الصندوق غير صالح</div>;
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h2 className="text-xl font-bold">حركات الصندوق</h2>
          <p className="text-sm text-gray-600 mt-1">
            {cashboxName || '—'} · {currency} · رصيد افتتاحي معروض: {formatCurrency(opening, currency)}
          </p>
        </div>
        <div className="flex gap-2">
          <Link to="/finance/cashboxes" className="toolbar-btn">
            ← الصناديق
          </Link>
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

      <p className="text-xs text-gray-500 max-w-3xl">
        عمود «الرصيد بعد» محسوب من الرصيد الافتتاحي + تراكم وارد/صادر بعملة الصندوق. الحركات القديمة بلا ربط صندوق قد لا تظهر هنا.
      </p>

      <div className="card overflow-auto">
        {loading ? (
          <div className="p-6 text-center">جاري التحميل...</div>
        ) : (
          <table className="data-grid">
            <thead>
              <tr>
                <th>#</th>
                <th>التاريخ</th>
                <th>نوع الحركة</th>
                <th>مرجع</th>
                <th>البيان</th>
                <th>وارد</th>
                <th>صادر</th>
                <th>الرصيد بعد</th>
                <th>العملة</th>
                <th>المستخدم</th>
              </tr>
            </thead>
            <tbody>
              {withRunning.map((r, i) => (
                <tr key={r.id}>
                  <td>{i + 1}</td>
                  <td>{r.created_at.split('T')[0]}</td>
                  <td>{r.transaction_type === 'inflow' ? 'وارد' : 'صادر'}</td>
                  <td>
                    {r.source_voucher_type} / {r.source_voucher_id.slice(0, 8)}…
                  </td>
                  <td>{r.notes || '—'}</td>
                  <td className="text-left">{r.inflow ? formatCurrency(r.inflow, currency) : '—'}</td>
                  <td className="text-left">{r.outflow ? formatCurrency(r.outflow, currency) : '—'}</td>
                  <td className="text-left font-medium">{formatCurrency(r.running_after, currency)}</td>
                  <td>{r.original_currency}</td>
                  <td>{r.created_by_username ?? '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
