import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import ReportControlBar from '../../components/ReportControlBar';
import { phase3FinanceGateway, type MonthlyInventoryReport } from '../../lib/api/phase3FinanceGateway';
import { phase15Gateway, getBackendIdFromSynthetic } from '../../lib/api/phase15Gateway';
import { useToast } from '../../components/Toast';
import { formatWesternNumber } from '../../lib/format/westernDigits';
import { downloadCsv } from '../../lib/export/csvDownload';

function monthStartIso(): string {
  const clock = new Date();
  const month = String(clock.getMonth() + 1).padStart(2, '0');
  return `${clock.getFullYear()}-${month}-01`;
}

function todayIso(): string {
  return new Date().toISOString().slice(0, 10) ?? '';
}

function fmtMoney(value: number): string {
  return formatWesternNumber(value, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

type ColumnKey =
  | 'collect'
  | 'prepaid'
  | 'hawala'
  | 'transferFees'
  | 'internalExpenses'
  | 'externalExpenses';

const COLUMNS: Array<{ key: ColumnKey; label: string }> = [
  { key: 'collect', label: 'التحصيل' },
  { key: 'prepaid', label: 'دفع مسبق' },
  { key: 'hawala', label: 'حوالات' },
  { key: 'transferFees', label: 'أجور حوالات' },
  { key: 'internalExpenses', label: 'مصاريف داخلية' },
  { key: 'externalExpenses', label: 'مصاريف خارجية' },
];

function ColumnTotalCard({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border border-slate-200 bg-slate-50 px-2 py-1.5 text-center min-w-[7.5rem]">
      <div className="text-[11px] text-slate-500 leading-tight">{label}</div>
      <div className="text-sm font-bold text-slate-900 mt-0.5 tabular-nums">{value}</div>
    </div>
  );
}

export default function MonthlyInventoryReportPage() {
  const { showToast } = useToast();
  const [dateFrom, setDateFrom] = useState(monthStartIso);
  const [dateTo, setDateTo] = useState(todayIso);
  const [branchId, setBranchId] = useState('');
  const [branches, setBranches] = useState<Array<{ id: string; name: string }>>([]);
  const [report, setReport] = useState<MonthlyInventoryReport | null>(null);
  const [loading, setLoading] = useState(false);
  const [searchTerm, setSearchTerm] = useState('');
  const initialLoad = useRef(false);

  useEffect(() => {
    phase15Gateway.branches.getAll().then((rows) => {
      setBranches(
        rows
          .map((branch) => {
            const id = getBackendIdFromSynthetic(branch.id);
            return id ? { id, name: branch.name } : null;
          })
          .filter((row): row is { id: string; name: string } => Boolean(row)),
      );
    }).catch(() => setBranches([]));
  }, []);

  const loadReport = useCallback(async () => {
    setLoading(true);
    try {
      const data = await phase3FinanceGateway.monthlyInventory.getReport({
        dateFrom,
        dateTo,
        branchId: branchId || undefined,
      });
      setReport(data);
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'تعذر تحميل الجرد الشهري', 'error');
      setReport(null);
    } finally {
      setLoading(false);
    }
  }, [branchId, dateFrom, dateTo, showToast]);

  useEffect(() => {
    if (initialLoad.current) return;
    initialLoad.current = true;
    void loadReport();
  }, [loadReport]);

  const filteredRows = useMemo(() => {
    const rows = report?.rows ?? [];
    const term = searchTerm.trim().toLowerCase();
    if (!term) return rows;
    return rows.filter((row) =>
      row.partyName.toLowerCase().includes(term)
      || (row.branchName ?? '').toLowerCase().includes(term),
    );
  }, [report?.rows, searchTerm]);

  const csvRows = filteredRows.map((row) => ({
    الجهة: row.partyName,
    الفرع: row.branchName ?? '',
    التحصيل: row.collect,
    'دفع مسبق': row.prepaid,
    حوالات: row.hawala,
    'أجور حوالات': row.transferFees,
    'مصاريف داخلية': row.internalExpenses,
    'مصاريف خارجية': row.externalExpenses,
    شحنات: row.shipmentCount,
    'حوالات مستقلة': row.transferCount,
  }));

  const exportCsv = () => {
    if (!csvRows.length) return;
    downloadCsv(
      `monthly-inventory-${dateFrom}_${dateTo}.csv`,
      ['الجهة', 'الفرع', 'التحصيل', 'دفع مسبق', 'حوالات', 'أجور حوالات', 'مصاريف داخلية', 'مصاريف خارجية', 'شحنات', 'حوالات مستقلة'],
      csvRows.map((row) => [
        row.الجهة,
        row.الفرع,
        row.التحصيل,
        row['دفع مسبق'],
        row.حوالات,
        row['أجور حوالات'],
        row['مصاريف داخلية'],
        row['مصاريف خارجية'],
        row.شحنات,
        row['حوالات مستقلة'],
      ]),
    );
    showToast('تم تنزيل CSV', 'success');
  };

  return (
    <div className="h-full flex flex-col min-h-0 gap-4">
      <div>
        <h2 className="text-xl font-bold">الجرد الشهري</h2>
        <p className="text-sm text-gray-600 mt-1">
          ملخص الحركات المالية حسب الجهة (الوكيل) ضمن الفترة المحددة: تحصيل، دفع مسبق، حوالات، أجور، ومصاريف.
        </p>
      </div>

      <ReportControlBar
        onExecute={() => void loadReport()}
        executeLabel="عرض الجرد"
        actions={[
          { id: 'print', label: 'طباعة', onClick: () => window.print() },
          { id: 'csv', label: 'تصدير CSV', onClick: exportCsv },
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
                {branches.map((branch) => (
                  <option key={branch.id} value={branch.id}>{branch.name}</option>
                ))}
              </select>
            </div>
            <div className="form-group">
              <label className="form-label">بحث الجهة</label>
              <input
                type="text"
                className="form-input min-w-[12rem]"
                placeholder="اسم وكيل أو فرع..."
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
              />
            </div>
          </>
        }
      />

      {loading && (
        <div className="card p-6 text-center text-gray-500">جاري تحميل الجرد الشهري...</div>
      )}

      {!loading && report && (
        <div className="card flex-1 min-h-0 overflow-auto">
          <table className="data-grid w-full min-w-[72rem]">
            <thead>
              <tr className="bg-white">
                <th className="align-bottom bg-white sticky top-0 z-20" />
                {COLUMNS.map((column) => (
                  <th key={column.key} className="align-bottom bg-white sticky top-0 z-20 px-2">
                    <div className="flex justify-center pb-2">
                      <ColumnTotalCard
                        label={`مجموع ${column.label}`}
                        value={`$${fmtMoney(report.totals[column.key])}`}
                      />
                    </div>
                  </th>
                ))}
              </tr>
              <tr>
                <th className="sticky top-[4.5rem] z-10 bg-slate-100">الجهة</th>
                {COLUMNS.map((column) => (
                  <th key={column.key} className="sticky top-[4.5rem] z-10 bg-slate-100 text-center">
                    {column.label}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {filteredRows.map((row) => (
                <tr key={row.partyId ?? `unassigned-${row.partyName}`}>
                  <td>
                    <div className="font-medium">{row.partyName}</div>
                    {row.branchName && <div className="text-xs text-gray-500">{row.branchName}</div>}
                    {(row.shipmentCount > 0 || row.transferCount > 0) && (
                      <div className="text-[11px] text-gray-400 mt-0.5">
                        {row.shipmentCount > 0 ? `${row.shipmentCount} شحنة` : ''}
                        {row.shipmentCount > 0 && row.transferCount > 0 ? ' · ' : ''}
                        {row.transferCount > 0 ? `${row.transferCount} حوالة مستقلة` : ''}
                      </div>
                    )}
                  </td>
                  {COLUMNS.map((column) => (
                    <td key={column.key} className="text-center tabular-nums">
                      {row[column.key] > 0 ? `$${fmtMoney(row[column.key])}` : '—'}
                    </td>
                  ))}
                </tr>
              ))}
              {filteredRows.length === 0 && (
                <tr>
                  <td colSpan={7} className="text-center py-10 text-gray-500">
                    لا توجد حركات في الفترة المحددة
                  </td>
                </tr>
              )}
            </tbody>
            {filteredRows.length > 0 && (
              <tfoot>
                <tr className="font-bold bg-slate-50">
                  <td>الإجمالي</td>
                  {COLUMNS.map((column) => (
                    <td key={column.key} className="text-center tabular-nums">
                      ${fmtMoney(report.totals[column.key])}
                    </td>
                  ))}
                </tr>
              </tfoot>
            )}
          </table>
        </div>
      )}
    </div>
  );
}
