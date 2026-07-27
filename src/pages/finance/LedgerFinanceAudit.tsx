import { useEffect, useState } from 'react';
import { phase3FinanceGateway } from '../../lib/api/phase3FinanceGateway';
import { useToast } from '../../components/Toast';
import FinanceExportToolbar from '../../components/finance/FinanceExportToolbar';
import { formatWesternNumber } from '../../lib/format/westernDigits';

type AuditDay = {
  ledgerDate: string;
  totalRows: number;
  postedRows: number;
  unpostedPostable: number;
  incompleteRows: number;
  collectUsd: number;
  prepaidUsd: number;
  hawalaUsd: number;
  transferFeeUsd: number;
  weightKg: number;
  collectMovements: number;
  hawalaMovements: number;
  feeMovements: number;
  issues: string[];
};

type AuditReport = {
  fromDate: string;
  generatedAt: string;
  grand: {
    totalRows: number;
    postedRows: number;
    unpostedPostable: number;
    incompleteRows: number;
    collect: number;
    prepaid: number;
    hawala: number;
    fee: number;
    weightKg: number;
  };
  issues: string[];
  days: AuditDay[];
  duplicateReceipts: Array<{
    ledgerDate: string;
    lineLabel: string;
    receiptNo: string;
    count: number;
    rowNos: number[];
  }>;
  unpostedPostableSample: Array<{
    ledgerDate: string;
    lineLabel: string;
    rowNo: number;
    receiptNo: string;
  }>;
};

const DEFAULT_FROM = '2026-06-01';

function fmt(n: number) {
  return formatWesternNumber(n, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

export default function LedgerFinanceAudit() {
  const { showToast } = useToast();
  const [fromDate, setFromDate] = useState(DEFAULT_FROM);
  const [loading, setLoading] = useState(false);
  const [data, setData] = useState<AuditReport | null>(null);

  const load = async () => {
    setLoading(true);
    try {
      const report = await phase3FinanceGateway.accounting.ledgerFinanceAudit({ fromDate });
      setData(report);
    } catch (e) {
      showToast(e instanceof Error ? e.message : 'تعذر تحميل تقرير التحقق', 'error');
      setData(null);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void load();
  }, []);

  const csvRows = data
    ? data.days.map((day) => ({
        التاريخ: day.ledgerDate,
        الأسطر: day.totalRows,
        'مُرحَّل': day.postedRows,
        'غير مُرحَّل': day.unpostedPostable,
        ناقص: day.incompleteRows,
        'تحصيل $': day.collectUsd,
        'دفع مسبق $': day.prepaidUsd,
        'حوالة $': day.hawalaUsd,
        'أجور حوالة $': day.transferFeeUsd,
        'الوزن كغ': day.weightKg,
        'ذمم تحصيل': day.collectMovements,
        'ذمم حوالة': day.hawalaMovements,
        'ذمم أجور': day.feeMovements,
        ملاحظات: day.issues.join(' | '),
      }))
    : [];

  return (
    <div className="h-full flex flex-col gap-3">
      <div>
        <h2 className="text-xl font-bold">تحقق الدفter ↔ الذمم</h2>
        <p className="text-sm text-gray-600">
          مقارنة يومية بين دفتر الشحن (تحصيل، مسبق، حوالة، أجور) وحركات ذمم الوكلاء من تاريخ البداية.
        </p>
      </div>

      <div className="card p-2 flex flex-wrap gap-2 items-center">
        <label className="text-sm text-gray-600">من تاريخ</label>
        <input
          type="date"
          className="form-input w-40"
          value={fromDate}
          onChange={(e) => setFromDate(e.target.value)}
        />
        <button type="button" className="toolbar-btn primary" disabled={loading} onClick={() => void load()}>
          {loading ? 'جاري التحميل…' : 'تحديث'}
        </button>
        <FinanceExportToolbar
          disabled={loading || !data}
          csvFilename={`ledger-audit-${fromDate}.csv`}
          csvRows={csvRows}
        />
      </div>

      {data && (
        <>
          <div className="card p-3 grid grid-cols-2 md:grid-cols-4 gap-3 text-sm">
            <div>
              <div className="text-gray-500">أسطر الدفter</div>
              <div className="font-bold">{data.grand.totalRows} ({data.grand.postedRows} مُرحَّل)</div>
            </div>
            <div>
              <div className="text-gray-500">تحصيل / مسبق</div>
              <div className="font-bold">${fmt(data.grand.collect)} / ${fmt(data.grand.prepaid)}</div>
            </div>
            <div>
              <div className="text-gray-500">حوالة / أجور</div>
              <div className="font-bold">${fmt(data.grand.hawala)} / ${fmt(data.grand.fee)}</div>
            </div>
            <div>
              <div className="text-gray-500">الوزن</div>
              <div className="font-bold">{fmt(data.grand.weightKg)} كغ</div>
            </div>
          </div>

          {data.issues.length > 0 ? (
            <div className="card p-3 border-amber-300 bg-amber-50">
              <div className="font-bold text-amber-900 mb-2">مشاكل ({data.issues.length})</div>
              <ul className="text-sm text-amber-900 list-disc pr-5 space-y-1">
                {data.issues.map((issue) => (
                  <li key={issue}>{issue}</li>
                ))}
              </ul>
            </div>
          ) : (
            <div className="card p-3 border-green-300 bg-green-50 text-green-900 text-sm">
              ✓ لا توجد مشاكل حرجة — الدفter والذمم متطابقان للفترة المحددة.
            </div>
          )}

          <div className="card overflow-auto flex-1">
            <table className="data-table w-full text-sm">
              <thead>
                <tr>
                  <th>التاريخ</th>
                  <th>أسطر</th>
                  <th>مُرحَّل</th>
                  <th>متبقي</th>
                  <th>تحصيل</th>
                  <th>مسبق</th>
                  <th>حوالة</th>
                  <th>أجور</th>
                  <th>كغ</th>
                  <th>ذمم تحصيل</th>
                  <th>ذمم حوالة</th>
                  <th>ملاحظة</th>
                </tr>
              </thead>
              <tbody>
                {data.days.map((day) => (
                  <tr key={day.ledgerDate} className={day.issues.length ? 'bg-amber-50' : ''}>
                    <td>{day.ledgerDate}</td>
                    <td>{day.totalRows}</td>
                    <td>{day.postedRows}</td>
                    <td>{day.unpostedPostable}</td>
                    <td>${fmt(day.collectUsd)}</td>
                    <td>${fmt(day.prepaidUsd)}</td>
                    <td>${fmt(day.hawalaUsd)}</td>
                    <td>${fmt(day.transferFeeUsd)}</td>
                    <td>{fmt(day.weightKg)}</td>
                    <td>${fmt(day.collectMovements)}</td>
                    <td>${fmt(day.hawalaMovements)}</td>
                    <td className="text-xs text-amber-800">{day.issues.join(' · ')}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {data.duplicateReceipts.length > 0 && (
            <div className="card p-3">
              <h3 className="font-bold mb-2">إيصالات مكررة</h3>
              <table className="data-table w-full text-sm">
                <thead>
                  <tr>
                    <th>التاريخ</th>
                    <th>الخط</th>
                    <th>الإيصال</th>
                    <th>الأسطر</th>
                  </tr>
                </thead>
                <tbody>
                  {data.duplicateReceipts.map((row) => (
                    <tr key={`${row.ledgerDate}-${row.lineLabel}-${row.receiptNo}`}>
                      <td>{row.ledgerDate}</td>
                      <td>{row.lineLabel}</td>
                      <td>{row.receiptNo}</td>
                      <td>{row.rowNos.join(', ')}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}
    </div>
  );
}
