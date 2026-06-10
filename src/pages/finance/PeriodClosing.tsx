import { useCallback, useEffect, useState } from 'react';
import { phase3FinanceGateway } from '../../lib/api/phase3FinanceGateway';
import { phase15Gateway } from '../../lib/api/phase15Gateway';
import { useToast } from '../../components/Toast';
import FinanceExportToolbar from '../../components/finance/FinanceExportToolbar';
import { buildTrialBalancePrintHtml, buildBalanceSheetPrintHtml } from '../../lib/export/financialStatementPrint';

export default function PeriodClosing() {
  const { showToast } = useToast();
  const [loading, setLoading] = useState(true);
  const [closing, setClosing] = useState(false);
  const [closures, setClosures] = useState<any[]>([]);
  const [branches, setBranches] = useState<Array<{ id: number; name: string }>>([]);
  const [form, setForm] = useState({
    periodStart: '',
    periodEnd: '',
    branchId: '',
    currencyCode: 'USD',
    notes: '',
  });

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [rows, branchRows] = await Promise.all([
        phase3FinanceGateway.accounting.listPeriodClosures(50),
        phase15Gateway.branches.getAll().catch(() => []),
      ]);
      setClosures(rows);
      setBranches(branchRows.map((b) => ({ id: b.id, name: b.name })));
    } catch {
      showToast('تعذر تحميل سجل الإقفالات', 'error');
    } finally {
      setLoading(false);
    }
  }, [showToast]);

  useEffect(() => {
    void load();
  }, [load]);

  const closePeriod = async () => {
    if (!form.periodStart || !form.periodEnd) {
      showToast('حدد بداية ونهاية الفترة', 'error');
      return;
    }
    setClosing(true);
    try {
      await phase3FinanceGateway.accounting.closePeriod({
        periodStart: form.periodStart,
        periodEnd: form.periodEnd,
        branchId: form.branchId || null,
        currencyCode: form.currencyCode,
        notes: form.notes || undefined,
      });
      showToast('تم إقفال الفترة وحفظ لقطة الميزان والمركز المالي', 'success');
      await load();
    } catch (e) {
      showToast(e instanceof Error ? e.message : 'تعذر إقفال الفترة', 'error');
    } finally {
      setClosing(false);
    }
  };

  const exportClosure = (row: any) => {
    const snapshot = row.snapshot ?? {};
    const trial = snapshot.trialBalance;
    const balance = snapshot.balanceSheet;
    if (!trial) {
      showToast('لا لقطة ميزان في هذا الإقفال', 'error');
      return;
    }
    const html = `${buildTrialBalancePrintHtml(trial)}${balance ? buildBalanceSheetPrintHtml(balance) : ''}`;
    return html;
  };

  return (
    <div className="h-full flex flex-col gap-3">
      <div>
        <h2 className="text-xl font-bold">إقفال الفترات المحاسبية</h2>
        <p className="text-sm text-gray-600">يحفظ لقطة ميزان مراجعة وقائمة مركز مالي للفترة — مرجع للمحاسب والتدقيق.</p>
      </div>

      <div className="card p-3 grid grid-cols-2 md:grid-cols-6 gap-2">
        <input type="date" className="form-input" value={form.periodStart} onChange={(e) => setForm((p) => ({ ...p, periodStart: e.target.value }))} />
        <input type="date" className="form-input" value={form.periodEnd} onChange={(e) => setForm((p) => ({ ...p, periodEnd: e.target.value }))} />
        <select className="form-select" value={form.branchId} onChange={(e) => setForm((p) => ({ ...p, branchId: e.target.value }))}>
          <option value="">الشركة (كل الفروع)</option>
          {branches.map((b) => <option key={b.id} value={String(b.id)}>{b.name}</option>)}
        </select>
        <select className="form-select" value={form.currencyCode} onChange={(e) => setForm((p) => ({ ...p, currencyCode: e.target.value }))}>
          <option value="USD">USD</option><option value="SYP">SYP</option><option value="TRY">TRY</option>
        </select>
        <input className="form-input" placeholder="ملاحظات" value={form.notes} onChange={(e) => setForm((p) => ({ ...p, notes: e.target.value }))} />
        <button type="button" className="toolbar-btn primary" disabled={closing} onClick={() => void closePeriod()}>
          {closing ? 'جاري الإقفال...' : 'إقفال الفترة'}
        </button>
      </div>

      <div className="card overflow-auto flex-1">
        {loading ? <p className="p-4 text-gray-500">جاري التحميل...</p> : null}
        <table className="data-grid">
          <thead>
            <tr>
              <th>من</th><th>إلى</th><th>الفرع</th><th>العملة</th><th>تاريخ الإقفال</th><th>المحاسب</th><th>ملاحظات</th><th>تصدير</th>
            </tr>
          </thead>
          <tbody>
            {closures.map((row) => (
              <tr key={row.id}>
                <td>{row.period_start}</td>
                <td>{row.period_end}</td>
                <td>{row.branch_name ?? 'الشركة'}</td>
                <td>{row.currency_code}</td>
                <td>{row.closed_at ? new Date(row.closed_at).toLocaleString('ar-SY') : '—'}</td>
                <td>{row.closed_by_username ?? '—'}</td>
                <td>{row.notes ?? '—'}</td>
                <td>
                  {row.snapshot?.trialBalance ? (
                    <FinanceExportToolbar
                      csvFileName={`closure-${row.period_start}-${row.period_end}.csv`}
                      csvHeaders={['الكود', 'الحساب', 'مدين', 'دائن']}
                      csvRows={(row.snapshot.trialBalance.rows ?? []).map((r: any) => [r.accountCode, r.accountName, r.debit, r.credit])}
                      pdfTitle={`إقفال ${row.period_start} — ${row.period_end}`}
                      pdfFileName={`closure-${row.period_start}.pdf`}
                      documentType="period_closure"
                      onBuildPrintHtml={() => exportClosure(row) ?? ''}
                      className="flex gap-1"
                    />
                  ) : '—'}
                </td>
              </tr>
            ))}
            {!loading && closures.length === 0 && <tr><td colSpan={8} className="text-center p-6 text-gray-500">لا إقفالات محفوظة بعد.</td></tr>}
          </tbody>
        </table>
      </div>
    </div>
  );
}
