import { useState } from 'react';
import { phase3FinanceGateway } from '../../lib/api/phase3FinanceGateway';
import { phase15Gateway } from '../../lib/api/phase15Gateway';
import { useToast } from '../../components/Toast';
import FinanceExportToolbar from '../../components/finance/FinanceExportToolbar';
import { buildBalanceSheetPrintHtml } from '../../lib/export/financialStatementPrint';

export default function BalanceSheet() {
  const { showToast } = useToast();
  const [loading, setLoading] = useState(false);
  const [data, setData] = useState<any>(null);
  const [branches, setBranches] = useState<Array<{ id: number; name: string }>>([]);
  const [filters, setFilters] = useState({ dateFrom: '', dateTo: '', branchId: '', currencyCode: 'USD' });

  const load = async () => {
    setLoading(true);
    try {
      const [report, branchRows] = await Promise.all([
        phase3FinanceGateway.accounting.balanceSheet({
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
      showToast(e instanceof Error ? e.message : 'تعذر تحميل قائمة المركز المالي', 'error');
      setData(null);
    } finally {
      setLoading(false);
    }
  };

  const sections = data?.sections ?? [];
  const summary = data?.summary ?? {};

  const csvRows: string[][] = [];
  sections.forEach((section: any) => {
    (section.lines ?? []).forEach((line: any) => {
      csvRows.push([section.label, line.label, String(line.amount ?? 0)]);
    });
    csvRows.push([section.label, 'إجمالي', String(section.total ?? 0)]);
  });

  return (
    <div className="h-full flex flex-col gap-3">
      <div>
        <h2 className="text-xl font-bold">قائمة المركز المالي</h2>
        <p className="text-sm text-gray-600">أصول (صناديق)، خصوم (ذمم)، ونتيجة الفترة — تشغيلية موثوقة من السيرفر.</p>
      </div>

      <div className="card p-2 grid grid-cols-2 md:grid-cols-6 gap-2">
        <input type="date" className="form-input" value={filters.dateFrom} onChange={(e) => setFilters((p) => ({ ...p, dateFrom: e.target.value }))} />
        <input type="date" className="form-input" value={filters.dateTo} onChange={(e) => setFilters((p) => ({ ...p, dateTo: e.target.value }))} />
        <select className="form-select" value={filters.branchId} onChange={(e) => setFilters((p) => ({ ...p, branchId: e.target.value }))}>
          <option value="">كل الفروع</option>
          {branches.map((b) => <option key={b.id} value={String(b.id)}>{b.name}</option>)}
        </select>
        <select className="form-select" value={filters.currencyCode} onChange={(e) => setFilters((p) => ({ ...p, currencyCode: e.target.value }))}>
          <option value="USD">USD</option><option value="SYP">SYP</option><option value="TRY">TRY</option>
        </select>
        <button type="button" className="toolbar-btn primary" onClick={() => void load()}>تطبيق</button>
        <FinanceExportToolbar
          disabled={loading || sections.length === 0}
          csvFileName={`balance-sheet-${new Date().toISOString().split('T')[0]}.csv`}
          csvHeaders={['القسم', 'البند', 'المبلغ']}
          csvRows={csvRows}
          pdfTitle="قائمة المركز المالي"
          pdfFileName={`balance-sheet-${new Date().toISOString().split('T')[0]}.pdf`}
          documentType="balance_sheet"
          onBuildPrintHtml={() => buildBalanceSheetPrintHtml(data)}
          landscape={false}
        />
      </div>

      {summary.totalAssets !== undefined && (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <div className="stat-card"><div className="stat-value">{Number(summary.totalAssets).toLocaleString()}</div><div className="stat-label">الأصول</div></div>
          <div className="stat-card"><div className="stat-value">{Number(summary.totalLiabilities).toLocaleString()}</div><div className="stat-label">الخصوم</div></div>
          <div className="stat-card"><div className="stat-value">{Number(summary.totalEquity).toLocaleString()}</div><div className="stat-label">حقوق الملكية / النتيجة</div></div>
          <div className="stat-card"><div className="stat-value">{summary.balanced ? 'متوازن' : 'فارق'}</div><div className="stat-label">التوازن</div></div>
        </div>
      )}

      <div className="grid md:grid-cols-3 gap-3 flex-1 min-h-0">
        {sections.map((section: any) => (
          <div key={section.id} className="card overflow-auto">
            <h3 className="font-bold mb-2">{section.label}</h3>
            <table className="data-grid text-sm">
              <thead><tr><th>البند</th><th className="text-left">المبلغ</th></tr></thead>
              <tbody>
                {(section.lines ?? []).map((line: any, idx: number) => (
                  <tr key={`${section.id}-${idx}`}><td>{line.label}</td><td className="text-left">{Number(line.amount).toLocaleString()}</td></tr>
                ))}
              </tbody>
              <tfoot><tr><td>الإجمالي</td><td className="text-left">{Number(section.total).toLocaleString()}</td></tr></tfoot>
            </table>
          </div>
        ))}
      </div>
    </div>
  );
}
