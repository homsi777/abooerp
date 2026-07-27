import { useEffect, useMemo, useState } from 'react';
import { httpClient } from '../../../lib/api/httpClient';
import { phase3FinanceGateway } from '../../../lib/api/phase3FinanceGateway';
import { phase15Gateway, getBackendIdFromSynthetic } from '../../../lib/api/phase15Gateway';
import { useToast } from '../../../components/Toast';
import FinanceExportToolbar from '../../../components/finance/FinanceExportToolbar';
import { formatWesternNumber } from '../../../lib/format/westernDigits';
import { DEFAULT_STATEMENT_DATE_FROM, StatementDateRangeBar, StatementSummaryGrid, todayIsoDate } from './statementShared';

type VoucherRow = {
  id: string;
  voucher_no: string;
  status: string;
  created_at: string;
  original_amount: number;
  original_currency: string;
  party_display_name?: string | null;
  cashbox_name?: string | null;
  branch_name?: string | null;
  notes?: string | null;
};

export default function VoucherStatementPage({ voucherType }: { voucherType: 'receipt' | 'payment' }) {
  const { showToast } = useToast();
  const [dateFrom, setDateFrom] = useState(DEFAULT_STATEMENT_DATE_FROM);
  const [dateTo, setDateTo] = useState(todayIsoDate());
  const [branchId, setBranchId] = useState('');
  const [agentId, setAgentId] = useState('');
  const [cashboxId, setCashboxId] = useState('');
  const [status, setStatus] = useState('confirmed');
  const [loading, setLoading] = useState(false);
  const [report, setReport] = useState<{
    summary: { count: number; byCurrency: Array<{ currency: string; count: number; total: number }> };
    rows: VoucherRow[];
  } | null>(null);

  const [branches, setBranches] = useState<Array<{ id: string; name: string }>>([]);
  const [agents, setAgents] = useState<Array<{ id: string; name: string }>>([]);
  const [cashboxes, setCashboxes] = useState<Array<{ id: string; name: string }>>([]);

  useEffect(() => {
    void Promise.all([
      phase15Gateway.branches.getAll(),
      httpClient.get<Array<{ id: string; name: string }>>('/agents?includeInactive=false'),
      phase3FinanceGateway.cashbox.listMaster(),
    ]).then(([branchRows, agentRows, cbRows]) => {
      setBranches(branchRows.map((b) => ({ id: getBackendIdFromSynthetic(b.id) || String(b.id), name: b.name })));
      setAgents(agentRows);
      setCashboxes(cbRows.map((cb) => ({ id: cb.id, name: cb.name || cb.code || cb.id })));
    }).catch(() => {});
  }, []);

  const title = voucherType === 'receipt' ? 'كشف سندات قبض' : 'كشف سندات دفع';

  const load = async () => {
    setLoading(true);
    try {
      const data = await phase3FinanceGateway.financeStatements.voucherReport(voucherType, {
        dateFrom,
        dateTo,
        branchId: branchId || undefined,
        agentId: agentId || undefined,
        cashboxId: cashboxId || undefined,
        status: status || undefined,
      });
      setReport(data);
    } catch (e) {
      showToast(e instanceof Error ? e.message : `تعذر تحميل ${title}`, 'error');
      setReport(null);
    } finally {
      setLoading(false);
    }
  };

  const csvRows = useMemo(
    () =>
      (report?.rows ?? []).map((r) => ({
        الرقم: r.voucher_no,
        التاريخ: r.created_at?.slice(0, 10),
        الطرف: r.party_display_name ?? '',
        الصندوق: r.cashbox_name ?? '',
        الفرع: r.branch_name ?? '',
        المبلغ: r.original_amount,
        العملة: r.original_currency,
        الحالة: r.status,
        البيان: r.notes ?? '',
      })),
    [report?.rows],
  );

  return (
    <div className="space-y-3">
      <h3 className="text-lg font-bold">{title}</h3>

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
            <label className="text-sm">
              <span className="block text-gray-600 mb-1">الفرع</span>
              <select className="form-select" value={branchId} onChange={(e) => setBranchId(e.target.value)}>
                <option value="">الكل</option>
                {branches.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
              </select>
            </label>
            <label className="text-sm">
              <span className="block text-gray-600 mb-1">الوكيل</span>
              <select className="form-select" value={agentId} onChange={(e) => setAgentId(e.target.value)}>
                <option value="">الكل</option>
                {agents.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
              </select>
            </label>
            <label className="text-sm">
              <span className="block text-gray-600 mb-1">الصندوق</span>
              <select className="form-select" value={cashboxId} onChange={(e) => setCashboxId(e.target.value)}>
                <option value="">الكل</option>
                {cashboxes.map((cb) => <option key={cb.id} value={cb.id}>{cb.name}</option>)}
              </select>
            </label>
            <label className="text-sm">
              <span className="block text-gray-600 mb-1">الحالة</span>
              <select className="form-select" value={status} onChange={(e) => setStatus(e.target.value)}>
                <option value="">الكل</option>
                <option value="confirmed">مؤكد</option>
                <option value="draft">مسودة</option>
              </select>
            </label>
            <FinanceExportToolbar disabled={!csvRows.length} csvFilename={`${voucherType}-vouchers-${dateFrom}.csv`} csvRows={csvRows} />
          </>
        }
      />

      {report && (
        <StatementSummaryGrid
          items={[
            { label: 'عدد السندات', value: String(report.summary.count) },
            ...report.summary.byCurrency.map((s) => ({
              label: `إجمالي ${s.currency}`,
              value: formatWesternNumber(s.total, { minimumFractionDigits: 2 }) + ` ${s.currency}`,
            })),
          ]}
        />
      )}

      <div className="card overflow-auto">
        <table className="data-table w-full text-sm">
          <thead>
            <tr>
              <th>الرقم</th>
              <th>التاريخ</th>
              <th>الطرف</th>
              <th>الصندوق</th>
              <th>المبلغ</th>
              <th>الحالة</th>
              <th>البيان</th>
            </tr>
          </thead>
          <tbody>
            {(report?.rows ?? []).map((r) => (
              <tr key={r.id}>
                <td>{r.voucher_no}</td>
                <td>{r.created_at?.slice(0, 10)}</td>
                <td>{r.party_display_name ?? '—'}</td>
                <td>{r.cashbox_name ?? '—'}</td>
                <td>{formatWesternNumber(Number(r.original_amount), { minimumFractionDigits: 2 })} {r.original_currency}</td>
                <td>{r.status}</td>
                <td>{r.notes ?? '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
