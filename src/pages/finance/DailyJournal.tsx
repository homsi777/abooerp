import { useCallback, useEffect, useMemo, useState } from 'react';
import { formatCurrency, type CurrencyCode } from '../../lib/currency/currency';
import { phase3FinanceGateway } from '../../lib/api/phase3FinanceGateway';
import { useToast } from '../../components/Toast';
import { downloadCsv } from '../../lib/export/csvDownload';
import { exportPdfTable } from '../../lib/export/pdfExport';

type CtxRow = {
  id: string;
  at: string;
  kind: 'inflow' | 'outflow';
  ref: string;
  orig: number;
  cur: CurrencyCode;
  usd: number;
  notes: string;
};

function mapCashbox(
  t: Awaited<ReturnType<typeof phase3FinanceGateway.cashbox.getTransactions>>[0],
): CtxRow {
  const d = t.created_at;
  const isIn = t.transaction_type === 'inflow';
  return {
    id: t.id,
    at: d,
    kind: isIn ? 'inflow' : 'outflow',
    ref: t.source_voucher_id ? t.source_voucher_id.slice(0, 8) : '—',
    orig: Number(t.original_amount),
    cur: t.original_currency,
    usd: Number(t.base_amount_usd),
    notes: t.notes || '',
  };
}

export default function FinanceDailyJournal() {
  const { showToast } = useToast();
  const [rows, setRows] = useState<CtxRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [q, setQ] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const txs = await phase3FinanceGateway.cashbox.getTransactions();
      setRows(txs.map(mapCashbox).sort((a, b) => a.at.localeCompare(b.at)));
    } catch (e) {
      showToast(e instanceof Error ? e.message : 'تعذر تحميل حركات الصندوق', 'error');
      setRows([]);
    } finally {
      setLoading(false);
    }
  }, [showToast]);

  useEffect(() => {
    void load();
  }, [load]);

  const filtered = useMemo(() => {
    if (!q.trim()) return rows;
    const s = q.toLowerCase();
    return rows.filter((r) => r.notes.toLowerCase().includes(s) || r.id.toLowerCase().includes(s) || r.ref.includes(s));
  }, [q, rows]);

  const totalIn = useMemo(
    () => filtered.filter((r) => r.kind === 'inflow').reduce((a, r) => a + r.usd, 0),
    [filtered],
  );
  const totalOut = useMemo(
    () => filtered.filter((r) => r.kind === 'outflow').reduce((a, r) => a + r.usd, 0),
    [filtered],
  );

  const exportCsv = () => {
    downloadCsv(
      `daily-journal-${new Date().toISOString().split('T')[0]}.csv`,
      ['الوقت', 'النوع', 'مرجع سند', 'المبلغ الأصلي', 'العملة', 'USD', 'ملاحظات'],
      filtered.map((r) => [
        new Date(r.at).toLocaleString(),
        r.kind === 'inflow' ? 'وارد' : 'صادر',
        r.ref,
        r.orig,
        r.cur,
        r.usd,
        r.notes,
      ]),
    );
    showToast('تم تنزيل الملف', 'success');
  };

  const exportPdf = async () => {
    const result = await exportPdfTable({
      title: 'دفتر اليومية (حركات صندوق نقدي)',
      subtitle: q.trim() ? `بحث: ${q.trim()}` : undefined,
      defaultFileName: `daily-journal-${new Date().toISOString().split('T')[0]}.pdf`,
      headers: ['الوقت', 'النوع', 'مرجع سند', 'المبلغ الأصلي', 'USD', 'ملاحظات'],
      rows: filtered.map((r) => [
        new Date(r.at).toLocaleString(),
        r.kind === 'inflow' ? 'وارد' : 'صادر',
        r.ref,
        formatCurrency(r.orig, r.cur),
        formatCurrency(r.usd, 'USD'),
        r.notes,
      ]),
    });

    if (result.saved) showToast('تم حفظ ملف PDF', 'success');
    else if (result.message !== 'cancelled') showToast('تعذر إنشاء PDF', 'error');
  };

  if (loading) {
    return <div className="p-4 text-gray-500">جاري تحميل حركات الصندوق من السيرفر...</div>;
  }

  return (
    <div className="space-y-4">
      <h2 className="text-xl font-bold">دفتر اليومية (حركات صندوق نقدي)</h2>
      <p className="text-sm text-gray-600 max-w-2xl">حركات الصندوق تُجلب مباشرة من السيرفر — لا توجد بيانات تجريبية.</p>

      <div className="grid grid-cols-3 gap-4 max-w-2xl">
        <div className="stat-card">
          <div className="stat-value" style={{ color: '#16a34d' }}>{formatCurrency(totalIn, 'USD')}</div>
          <div className="stat-label">وارد (تقديري بالدولار)</div>
        </div>
        <div className="stat-card">
          <div className="stat-value" style={{ color: '#dc2626' }}>{formatCurrency(totalOut, 'USD')}</div>
          <div className="stat-label">صادر (تقديري بالدولار)</div>
        </div>
        <div className="stat-card">
          <div className="stat-value">{formatCurrency(totalIn - totalOut, 'USD')}</div>
          <div className="stat-label">صافي (بالدولار)</div>
        </div>
      </div>

      <div className="card flex gap-2">
        <input className="form-input flex-1 max-w-md" placeholder="بحث في الملاحظات أو المعرف..." value={q} onChange={(e) => setQ(e.target.value)} />
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

      <div className="card overflow-auto">
        <table className="data-grid text-sm">
          <thead>
            <tr>
              <th>الوقت</th>
              <th>النوع</th>
              <th>مرجع سند</th>
              <th>مبلغ</th>
              <th>USD</th>
              <th>ملاحظات</th>
            </tr>
          </thead>
          <tbody>
            {filtered.map((r) => (
              <tr key={r.id}>
                <td>{new Date(r.at).toLocaleString()}</td>
                <td>{r.kind === 'inflow' ? 'وارد' : 'صادر'}</td>
                <td>{r.ref}</td>
                <td className="text-left">{formatCurrency(r.orig, r.cur)}</td>
                <td className="text-left">{formatCurrency(r.usd, 'USD')}</td>
                <td>{r.notes}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {filtered.length === 0 && <p className="p-4 text-gray-500">لا حركات</p>}
      </div>
    </div>
  );
}
