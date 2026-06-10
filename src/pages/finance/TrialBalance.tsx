import { useState } from 'react';
import { phase3FinanceGateway } from '../../lib/api/phase3FinanceGateway';
import { phase15Gateway } from '../../lib/api/phase15Gateway';
import { useToast } from '../../components/Toast';
import FinanceExportToolbar from '../../components/finance/FinanceExportToolbar';
import { buildTrialBalancePrintHtml } from '../../lib/export/financialStatementPrint';

export default function TrialBalance() {
  const { showToast } = useToast();
  const [loading, setLoading] = useState(false);
  const [data, setData] = useState<any>(null);
  const [branches, setBranches] = useState<Array<{ id: number; name: string }>>([]);
  const [filters, setFilters] = useState({
    dateFrom: '',
    dateTo: '',
    branchId: '',
    currencyCode: 'USD',
  });

  const load = async () => {
    setLoading(true);
    try {
      const [report, branchRows] = await Promise.all([
        phase3FinanceGateway.accounting.trialBalance({
          fromAt: filters.dateFrom ? `${filters.dateFrom}T00:00:00.000Z` : undefined,
          toAt: filters.dateTo ? `${filters.dateTo}T23:59:59.999Z` : undefined,
          branchId: filters.branchId || undefined,
          currencyCode: filters.currencyCode || undefined,
        }),
        phase15Gateway.branches.getAll().catch(() => []),
      ]);
      setData(report);
      setBranches(branchRows.map((b) => ({ id: b.id, name: b.name })));
    } catch (e) {
      showToast(e instanceof Error ? e.message : 'تعذر تحميل ميزان المراجعة', 'error');
      setData(null);
    } finally {
      setLoading(false);
    }
  };

  const rows = data?.rows ?? [];
  const totals = data?.totals ?? {};

  return (
    <div className="h-full flex flex-col gap-3">
      <div>
        <h2 className="text-xl font-bold">ميزان المراجعة</h2>
        <p className="text-sm text-gray-600">تجميع تشغيلي من الصناديق، ذمم الأطراف، إيرادات الشحن، والمصاريف.</p>
      </div>

      <div className="card p-2 grid grid-cols-2 md:grid-cols-6 gap-2">
        <input type="date" className="form-input" value={filters.dateFrom} onChange={(e) => setFilters((p) => ({ ...p, dateFrom: e.target.value }))} />
        <input type="date" className="form-input" value={filters.dateTo} onChange={(e) => setFilters((p) => ({ ...p, dateTo: e.target.value }))} />
        <select className="form-select" value={filters.branchId} onChange={(e) => setFilters((p) => ({ ...p, branchId: e.target.value }))}>
          <option value="">كل الفروع</option>
          {branches.map((b) => <option key={b.id} value={String(b.id)}>{b.name}</option>)}
        </select>
        <select className="form-select" value={filters.currencyCode} onChange={(e) => setFilters((p) => ({ ...p, currencyCode: e.target.value }))}>
          <option value="USD">USD</option>
          <option value="SYP">SYP</option>
          <option value="TRY">TRY</option>
        </select>
        <button type="button" className="toolbar-btn primary" onClick={() => void load()}>تطبيق</button>
        <FinanceExportToolbar
          disabled={loading || rows.length === 0}
          csvFileName={`trial-balance-${new Date().toISOString().split('T')[0]}.csv`}
          csvHeaders={['الكود', 'الحساب', 'القسم', 'مدين', 'دائن', 'صافي']}
          csvRows={rows.map((r: any) => [
            r.accountCode,
            r.accountName,
            r.section,
            r.debit,
            r.credit,
            r.netDebit,
          ])}
          pdfTitle="ميزان المراجعة"
          pdfFileName={`trial-balance-${new Date().toISOString().split('T')[0]}.pdf`}
          documentType="trial_balance"
          onBuildPrintHtml={() => buildTrialBalancePrintHtml(data)}
          landscape
        />
      </div>

      {data?.notes?.length ? (
        <div className="text-xs text-gray-600 space-y-1">
          {(data.notes as string[]).map((note) => <p key={note}>{note}</p>)}
        </div>
      ) : null}

      <div className="card overflow-auto flex-1">
        {loading ? <p className="p-4 text-gray-500">جاري التحميل...</p> : null}
        <table className="data-grid">
          <thead>
            <tr>
              <th>الكود</th><th>الحساب</th><th>القسم</th>
              <th className="text-left">مدين</th><th className="text-left">دائن</th><th className="text-left">صافي</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row: any) => (
              <tr key={row.accountCode}>
                <td>{row.accountCode}</td>
                <td>{row.accountName}</td>
                <td>{row.section}</td>
                <td className="text-left">{Number(row.debit).toLocaleString()}</td>
                <td className="text-left">{Number(row.credit).toLocaleString()}</td>
                <td className="text-left">{Number(row.netDebit).toLocaleString()}</td>
              </tr>
            ))}
            {!loading && rows.length === 0 && <tr><td colSpan={6} className="text-center p-6 text-gray-500">لا بيانات — طبّق الفلاتر واضغط تطبيق.</td></tr>}
          </tbody>
          {rows.length > 0 && (
            <tfoot>
              <tr>
                <td colSpan={3}>الإجمالي</td>
                <td className="text-left">{Number(totals.totalDebit ?? 0).toLocaleString()}</td>
                <td className="text-left">{Number(totals.totalCredit ?? 0).toLocaleString()}</td>
                <td className="text-left">{Number(totals.difference ?? 0).toLocaleString()}</td>
              </tr>
            </tfoot>
          )}
        </table>
      </div>
    </div>
  );
}
