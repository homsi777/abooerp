import { useState } from 'react';
import { phase3FinanceGateway } from '../../../lib/api/phase3FinanceGateway';
import { useToast } from '../../../components/Toast';
import FinanceExportToolbar from '../../../components/finance/FinanceExportToolbar';
import { formatWesternNumber } from '../../../lib/format/westernDigits';
import { DEFAULT_STATEMENT_DATE_FROM, StatementDateRangeBar, StatementSummaryGrid, todayIsoDate } from './statementShared';

export default function DailyLedgerSummaryPage() {
  const { showToast } = useToast();
  const [dateFrom, setDateFrom] = useState(DEFAULT_STATEMENT_DATE_FROM);
  const [dateTo, setDateTo] = useState(todayIsoDate());
  const [loading, setLoading] = useState(false);
  const [data, setData] = useState<Awaited<ReturnType<typeof phase3FinanceGateway.financeStatements.dailyLedgerSummary>> | null>(null);

  const load = async () => {
    setLoading(true);
    try {
      const report = await phase3FinanceGateway.financeStatements.dailyLedgerSummary({ dateFrom, dateTo });
      setData(report);
    } catch (e) {
      showToast(e instanceof Error ? e.message : 'تعذر تحميل ملخص الدفتر', 'error');
      setData(null);
    } finally {
      setLoading(false);
    }
  };

  const fmt = (n: number) => formatWesternNumber(n, { minimumFractionDigits: 2 });

  const csvRows = (data?.days ?? []).map((d) => ({
    التاريخ: d.ledgerDate,
    الأسطر: d.totalRows,
    'مُرحَّل': d.postedRows,
    تحصيل: d.collectUsd,
    مسبق: d.prepaidUsd,
    حوالة: d.hawalaUsd,
    'أجور حوالة': d.transferFeeUsd,
    'الوزن كغ': d.weightKg,
  }));

  return (
    <div className="space-y-3">
      <h3 className="text-lg font-bold">ملخص يوم الدفتر</h3>
      <p className="text-sm text-gray-600">مجاميع دفتر الشحن اليومي: تحصيل، دفع مسبق، حوالة، أجور، وزن — حسب اليوم.</p>

      <StatementDateRangeBar
        dateFrom={dateFrom}
        dateTo={dateTo}
        onChange={(next) => {
          if (next.dateFrom !== undefined) setDateFrom(next.dateFrom);
          if (next.dateTo !== undefined) setDateTo(next.dateTo);
        }}
        onApply={() => void load()}
        loading={loading}
        extra={<FinanceExportToolbar disabled={!csvRows.length} csvFilename={`ledger-summary-${dateFrom}.csv`} csvRows={csvRows} />}
      />

      {data && (
        <>
          <StatementSummaryGrid
            items={[
              { label: 'أسطر الدفتر', value: `${data.grand.totalRows} (${data.grand.postedRows} مُرحَّل)` },
              { label: 'تحصيل', value: `$${fmt(data.grand.collect)}` },
              { label: 'دفع مسبق', value: `$${fmt(data.grand.prepaid)}` },
              { label: 'حوالة / أجور', value: `$${fmt(data.grand.hawala)} / $${fmt(data.grand.fee)}` },
              { label: 'الوزن', value: `${fmt(data.grand.weightKg)} كغ` },
            ]}
          />

          {data.issues.length > 0 && (
            <div className="card p-3 border-amber-300 bg-amber-50 text-sm text-amber-900">
              <div className="font-bold mb-1">ملاحظات</div>
              <ul className="list-disc pr-5">{data.issues.map((i) => <li key={i}>{i}</li>)}</ul>
            </div>
          )}

          <div className="card overflow-auto">
            <table className="data-table w-full text-sm">
              <thead>
                <tr>
                  <th>التاريخ</th>
                  <th>أسطر</th>
                  <th>مُرحَّل</th>
                  <th>تحصيل</th>
                  <th>مسبق</th>
                  <th>حوالة</th>
                  <th>أجور</th>
                  <th>كغ</th>
                </tr>
              </thead>
              <tbody>
                {data.days.map((d) => (
                  <tr key={d.ledgerDate}>
                    <td>{d.ledgerDate}</td>
                    <td>{d.totalRows}</td>
                    <td>{d.postedRows}</td>
                    <td>${fmt(d.collectUsd)}</td>
                    <td>${fmt(d.prepaidUsd)}</td>
                    <td>${fmt(d.hawalaUsd)}</td>
                    <td>${fmt(d.transferFeeUsd)}</td>
                    <td>{fmt(d.weightKg)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  );
}
