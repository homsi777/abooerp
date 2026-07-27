import { useCallback, useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import ReportControlBar from '../../../components/ReportControlBar';
import { formatCurrency, type CurrencyCode } from '../../../lib/currency/currency';
import { phase3FinanceGateway, type ProfitLossReport } from '../../../lib/api/phase3FinanceGateway';
import { phase15Gateway, getBackendIdFromSynthetic } from '../../../lib/api/phase15Gateway';
import { useToast } from '../../../components/Toast';
import { downloadCsv } from '../../../lib/export/csvDownload';
import { exportPdfTable } from '../../../lib/export/pdfExport';

const sectionLabels: Record<string, string> = {
  revenue: 'إيراد',
  direct_cost: 'تكلفة مباشرة',
  operating_expense: 'مصروف',
  agent_liability: 'ذمة وكيل',
  customer_liability: 'ذمة عميل',
};

export default function ProfitLossReport() {
  const { showToast } = useToast();
  const [dateFrom, setDateFrom] = useState(
    new Date(new Date().setDate(new Date().getDate() - 30)).toISOString().split('T')[0],
  );
  const [dateTo, setDateTo] = useState(new Date().toISOString().split('T')[0]);
  const [branchId, setBranchId] = useState('');
  const [currencyCode, setCurrencyCode] = useState('');
  const [branches, setBranches] = useState<Array<{ id: string; name: string }>>([]);
  const [report, setReport] = useState<ProfitLossReport | null>(null);
  const [loading, setLoading] = useState(false);
  const [hasAppliedFilters, setHasAppliedFilters] = useState(false);
  const initialLoad = useRef(false);

  useEffect(() => {
    phase15Gateway.branches.getAll().then((rows) => {
      setBranches(
        rows
          .map((b) => {
            const id = getBackendIdFromSynthetic(b.id);
            return id ? { id, name: b.name } : null;
          })
          .filter((row): row is { id: string; name: string } => Boolean(row)),
      );
    }).catch(() => setBranches([]));
  }, []);

  const loadReport = useCallback(async () => {
    setLoading(true);
    try {
      const fromAt = new Date(`${dateFrom}T00:00:00Z`).toISOString();
      const toAt = new Date(`${dateTo}T23:59:59Z`).toISOString();
      const data = await phase3FinanceGateway.profitLoss.getReport({
        fromAt,
        toAt,
        branchId: branchId || undefined,
        currencyCode: (currencyCode || undefined) as CurrencyCode | undefined,
      });
      setReport(data);
      setHasAppliedFilters(true);
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'تعذر تحميل تقرير الأرباح والخسائر', 'error');
    } finally {
      setLoading(false);
    }
  }, [branchId, currencyCode, dateFrom, dateTo, showToast]);

  useEffect(() => {
    if (initialLoad.current) return;
    initialLoad.current = true;
    void loadReport();
  }, [loadReport]);

  const allLines = report?.sections.flatMap((section) => section.lines) ?? [];
  const currency = (report?.summary.currencyCode ?? 'USD') as CurrencyCode;

  const exportCsv = () => {
    if (!report) return;
    downloadCsv(
      `profit-loss-${dateFrom}_${dateTo}.csv`,
      ['القسم', 'الفئة', 'التاريخ', 'المرجع', 'البيان', 'الطرف', 'المبلغ', 'العملة', 'USD', 'ملاحظات'],
      allLines.map((line) => [
        sectionLabels[line.section] ?? line.section,
        line.category,
        String(line.at).split('T')[0],
        line.referenceNo,
        line.description,
        line.partyName ?? '',
        line.amount,
        line.currencyCode,
        line.amountUsd,
        line.notes ?? '',
      ]),
    );
    showToast('تم تنزيل CSV', 'success');
  };

  const exportPdf = async () => {
    if (!report) return;
    const result = await exportPdfTable({
      title: 'تقرير الأرباح والخسائر',
      subtitle: `من ${dateFrom} إلى ${dateTo} | صافي الربح: ${formatCurrency(report.summary.netProfit, currency)}`,
      defaultFileName: `profit-loss-${dateFrom}_${dateTo}.pdf`,
      headers: ['القسم', 'التاريخ', 'المرجع', 'البيان', 'المبلغ', 'ملاحظات'],
      rows: allLines.map((line) => [
        line.category,
        String(line.at).split('T')[0],
        line.referenceNo,
        line.description,
        formatCurrency(line.amount, line.currencyCode as CurrencyCode),
        line.notes ?? '',
      ]),
    });
    if (result.saved) showToast('تم حفظ PDF', 'success');
  };

  return (
    <>
      <ReportControlBar
        onExecute={() => void loadReport()}
        actions={[
          { id: 'print', label: 'طباعة', onClick: () => window.print() },
          { id: 'csv', label: 'تصدير CSV', onClick: exportCsv },
          { id: 'pdf', label: 'تصدير PDF', onClick: () => void exportPdf() },
        ]}
        filters={
          <>
            <div className="form-group">
              <label className="form-label">من تاريخ</label>
              <input type="date" className="form-input" value={dateFrom} onChange={(e) => setDateFrom(e.target.value)} />
            </div>
            <div className="form-group">
              <label className="form-label">إلى تاريخ</label>
              <input type="date" className="form-input" value={dateTo} onChange={(e) => setDateTo(e.target.value)} />
            </div>
            <div className="form-group">
              <label className="form-label">الفرع</label>
              <select className="form-select min-w-[180px]" value={branchId} onChange={(e) => setBranchId(e.target.value)}>
                <option value="">كل الفروع</option>
                {branches.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
              </select>
            </div>
            <div className="form-group">
              <label className="form-label">العملة</label>
              <select className="form-select" value={currencyCode} onChange={(e) => setCurrencyCode(e.target.value)}>
                <option value="">كل العملات (ملخص USD)</option>
                <option value="USD">USD</option>
                <option value="SYP">SYP</option>
                <option value="TRY">TRY</option>
              </select>
            </div>
          </>
        }
      />

      {loading ? <div className="text-sm text-gray-500 mb-2">جاري التحميل…</div> : null}

      {hasAppliedFilters && report && !loading ? (
        <div className="space-y-4">
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <div className="stat-card"><div className="stat-value text-green-700">{formatCurrency(report.summary.totalRevenue, currency)}</div><div className="stat-label">إجمالي الإيرادات</div></div>
            <div className="stat-card"><div className="stat-value text-amber-700">{formatCurrency(report.summary.totalDirectCosts, currency)}</div><div className="stat-label">عمولات الوكلاء</div></div>
            <div className="stat-card"><div className="stat-value">{formatCurrency(report.summary.grossProfit, currency)}</div><div className="stat-label">مجمل الربح</div></div>
            <div className="stat-card"><div className="stat-value text-red-700">{formatCurrency(report.summary.totalOperatingExpenses, currency)}</div><div className="stat-label">مصاريف ورواتب</div></div>
          </div>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <div className="stat-card"><div className="stat-value font-bold">{formatCurrency(report.summary.netProfit, currency)}</div><div className="stat-label">صافي الربح / الخسارة</div></div>
            <div className="stat-card"><div className="stat-value text-red-700">{formatCurrency(report.summary.totalAgentLiabilities, currency)}</div><div className="stat-label">ذمم وكلاء متبقية</div></div>
            <div className="stat-card"><div className="stat-value text-amber-800">{formatCurrency(report.summary.totalCustomerLiabilities, currency)}</div><div className="stat-label">ذمم عملاء متبقية</div></div>
            <div className="stat-card flex flex-col justify-center gap-1 text-sm">
              <Link className="toolbar-btn text-xs" to="/finance/agent-cod-statement">كشوف COD</Link>
              <Link className="toolbar-btn text-xs" to="/finance/general-ledger">دفتر الأستاذ</Link>
            </div>
          </div>

          {report.sections.map((section) => (
            <section key={section.id} className="card overflow-auto">
              <div className="card-header flex justify-between items-center gap-3">
                <span>{section.label}</span>
                <span className="text-sm font-normal">
                  الإجمالي: <b>{formatCurrency(section.totalUsd || section.total, currency)}</b>
                </span>
              </div>
              {section.lines.length === 0 ? (
                <p className="p-4 text-gray-500 text-sm">لا توجد حركات في هذا القسم للفترة المحددة.</p>
              ) : (
                <table className="data-grid text-sm">
                  <thead>
                    <tr>
                      <th>التاريخ</th>
                      <th>المرجع</th>
                      <th>البيان</th>
                      <th>الطرف</th>
                      <th>المبلغ</th>
                      <th>ملاحظات</th>
                    </tr>
                  </thead>
                  <tbody>
                    {section.lines.map((line) => (
                      <tr
                        key={`${line.sourceType}-${line.sourceId}-${line.at}`}
                        className={
                          line.section === 'revenue'
                            ? 'bg-green-50'
                            : line.section === 'agent_liability' || line.section === 'customer_liability'
                              ? 'bg-red-50'
                              : 'bg-amber-50'
                        }
                      >
                        <td>{String(line.at).split('T')[0]}</td>
                        <td className="font-mono">{line.referenceNo}</td>
                        <td>{line.description}</td>
                        <td>{line.partyName ?? '—'}</td>
                        <td>{formatCurrency(line.amount, line.currencyCode as CurrencyCode)}</td>
                        <td className="text-gray-600">{line.notes ?? '—'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </section>
          ))}
        </div>
      ) : null}
    </>
  );
}
