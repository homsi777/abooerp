import { useCallback, useEffect, useState } from 'react';
import { phase3FinanceGateway, type BackendCashboxMovementRow, type BackendCashboxStatement } from '../../../lib/api/phase3FinanceGateway';
import { useToast } from '../../../components/Toast';
import FinanceExportToolbar from '../../../components/finance/FinanceExportToolbar';
import { formatCurrency, type CurrencyCode } from '../../../lib/currency/currency';
import { downloadCsv } from '../../../lib/export/csvDownload';
import { DEFAULT_STATEMENT_DATE_FROM, StatementDateRangeBar, StatementSummaryGrid, todayIsoDate } from './statementShared';

export default function CashboxStatementPage() {
  const { showToast } = useToast();
  const [cashboxes, setCashboxes] = useState<Array<{ id: string; name: string }>>([]);
  const [cashboxId, setCashboxId] = useState('');
  const [dateFrom, setDateFrom] = useState(DEFAULT_STATEMENT_DATE_FROM);
  const [dateTo, setDateTo] = useState(todayIsoDate());
  const [statement, setStatement] = useState<BackendCashboxStatement | null>(null);
  const [rows, setRows] = useState<BackendCashboxMovementRow[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    void phase3FinanceGateway.cashbox.listMaster().then((list) => {
      setCashboxes(list.map((cb) => ({ id: cb.id, name: cb.name || cb.code || cb.id })));
    }).catch(() => setCashboxes([]));
  }, []);

  const load = useCallback(async () => {
    if (!cashboxId) {
      showToast('اختر الصندوق أولاً', 'error');
      return;
    }
    setLoading(true);
    try {
      const payload = await phase3FinanceGateway.cashbox.getStatement(cashboxId, {
        dateFrom: `${dateFrom}T00:00:00.000Z`,
        dateTo: `${dateTo}T23:59:59.999Z`,
      });
      setStatement(payload);
      setRows(payload.rows);
    } catch (e) {
      showToast(e instanceof Error ? e.message : 'تعذر تحميل كشف الصندوق', 'error');
    } finally {
      setLoading(false);
    }
  }, [cashboxId, dateFrom, dateTo, showToast]);

  const currency = (statement?.cashbox.currency_code ?? 'USD') as CurrencyCode;
  const fmt = (n: number) => formatCurrency(n, currency);

  const csvRows = rows.map((r, i) => ({
    '#': i + 1,
    التاريخ: r.created_at.split('T')[0],
    النوع: r.transaction_type === 'inflow' ? 'وارد' : 'صادر',
    البيان: r.notes ?? '',
    وارد: r.debit_in || '',
    صادر: r.credit_out || '',
    الرصيد: r.running_balance ?? '',
  }));

  return (
    <div className="space-y-3">
      <h3 className="text-lg font-bold">كشف صندوق</h3>

      <StatementDateRangeBar
        dateFrom={dateFrom}
        dateTo={dateTo}
        onChange={(next) => {
          if (next.dateFrom !== undefined) setDateFrom(next.dateFrom);
          if (next.dateTo !== undefined) setDateTo(next.dateTo);
        }}
        onApply={() => void load()}
        loading={loading}
        extra={
          <>
            <label className="text-sm min-w-[12rem]">
              <span className="block text-gray-600 mb-1">الصندوق</span>
              <select className="form-select w-full" value={cashboxId} onChange={(e) => setCashboxId(e.target.value)}>
                <option value="">— اختر —</option>
                {cashboxes.map((cb) => (
                  <option key={cb.id} value={cb.id}>{cb.name}</option>
                ))}
              </select>
            </label>
            <FinanceExportToolbar disabled={!rows.length} csvFilename={`cashbox-${dateFrom}.csv`} csvRows={csvRows} />
          </>
        }
      />

      {statement && (
        <StatementSummaryGrid
          items={[
            { label: 'الصندوق', value: statement.cashbox.name },
            { label: 'رصيد افتتاحي', value: fmt(statement.summary.openingBalance) },
            { label: 'إجمالي وارد', value: fmt(statement.summary.totalIncoming) },
            { label: 'إجمالي صادر', value: fmt(statement.summary.totalOutgoing) },
            { label: 'رصيد ختامي', value: fmt(statement.summary.closingBalance), highlight: true },
          ]}
        />
      )}

      <div className="card overflow-auto">
        <table className="data-table w-full text-sm">
          <thead>
            <tr>
              <th>#</th>
              <th>التاريخ</th>
              <th>النوع</th>
              <th>البيان</th>
              <th>وارد</th>
              <th>صادر</th>
              <th>الرصيد</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r, i) => (
              <tr key={r.id}>
                <td>{i + 1}</td>
                <td>{r.created_at.split('T')[0]}</td>
                <td>{r.transaction_type === 'inflow' ? 'وارد' : 'صادر'}</td>
                <td>{r.notes || r.party_display_name || '—'}</td>
                <td>{r.debit_in ? fmt(Number(r.debit_in)) : '—'}</td>
                <td>{r.credit_out ? fmt(Number(r.credit_out)) : '—'}</td>
                <td>{r.running_balance != null ? fmt(Number(r.running_balance)) : '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
