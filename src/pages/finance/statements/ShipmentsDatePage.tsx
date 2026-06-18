import { useEffect, useMemo, useState } from 'react';
import { httpClient } from '../../../lib/api/httpClient';
import { phase3FinanceGateway } from '../../../lib/api/phase3FinanceGateway';
import { phase15Gateway, getBackendIdFromSynthetic } from '../../../lib/api/phase15Gateway';
import { useToast } from '../../../components/Toast';
import FinanceExportToolbar from '../../../components/finance/FinanceExportToolbar';
import { formatWesternNumber } from '../../../lib/format/westernDigits';
import { DEFAULT_STATEMENT_DATE_FROM, StatementDateRangeBar, StatementSummaryGrid, todayIsoDate } from './statementShared';

export default function ShipmentsDatePage() {
  const { showToast } = useToast();
  const [dateFrom, setDateFrom] = useState(DEFAULT_STATEMENT_DATE_FROM);
  const [dateTo, setDateTo] = useState(todayIsoDate());
  const [branchId, setBranchId] = useState('');
  const [agentId, setAgentId] = useState('');
  const [loading, setLoading] = useState(false);
  const [data, setData] = useState<Awaited<ReturnType<typeof phase3FinanceGateway.financeStatements.shipmentsByDate>> | null>(null);
  const [branches, setBranches] = useState<Array<{ id: string; name: string }>>([]);
  const [agents, setAgents] = useState<Array<{ id: string; name: string }>>([]);

  useEffect(() => {
    void Promise.all([
      phase15Gateway.branches.getAll(),
      httpClient.get<Array<{ id: string; name: string }>>('/agents?includeInactive=false'),
    ]).then(([branchRows, agentRows]) => {
      setBranches(branchRows.map((b) => ({ id: getBackendIdFromSynthetic(b.id) || String(b.id), name: b.name })));
      setAgents(agentRows);
    }).catch(() => {});
  }, []);

  const load = async () => {
    setLoading(true);
    try {
      const report = await phase3FinanceGateway.financeStatements.shipmentsByDate({
        dateFrom,
        dateTo,
        branchId: branchId || undefined,
        agentId: agentId || undefined,
      });
      setData(report);
    } catch (e) {
      showToast(e instanceof Error ? e.message : 'تعذر تحميل كشف الشحنات', 'error');
      setData(null);
    } finally {
      setLoading(false);
    }
  };

  const fmt = (n: number) => formatWesternNumber(n, { minimumFractionDigits: 2 });

  const csvRows = useMemo(
    () =>
      (data?.rows ?? []).map((r: Record<string, unknown>) => ({
        التاريخ: r.shipment_date,
        الإيصال: r.shipment_no,
        الوكيل: r.agent_name,
        المرسل: r.sender_name,
        المستلم: r.receiver_name,
        الوجهة: r.destination,
        تحصيل: r.collect_amount,
        مسبق: r.prepaid_amount,
        حوالة: r.hawala_amount,
        'أجور حوالة': r.transfer_service_fee,
        عمولة: r.agent_commission,
        الوزن: r.weight_kg,
      })),
    [data?.rows],
  );

  return (
    <div className="space-y-3">
      <h3 className="text-lg font-bold">شحنات بالتاريخ</h3>

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
            <FinanceExportToolbar disabled={!csvRows.length} csvFilename={`shipments-${dateFrom}.csv`} csvRows={csvRows} />
          </>
        }
      />

      {data && (
        <>
          <StatementSummaryGrid
            items={[
              { label: 'عدد الشحنات', value: String(data.summary.count) },
              { label: 'تحصيل', value: `$${fmt(data.summary.collect)}` },
              { label: 'مسبق', value: `$${fmt(data.summary.prepaid)}` },
              { label: 'حوالة', value: `$${fmt(data.summary.hawala)}` },
              { label: 'أجور حوالة', value: `$${fmt(data.summary.transferFee)}` },
              { label: 'عمولة وكلاء', value: `$${fmt(data.summary.commission)}` },
            ]}
          />

          <div className="card overflow-auto max-h-[60vh]">
            <table className="data-table w-full text-sm">
              <thead>
                <tr>
                  <th>التاريخ</th>
                  <th>إيصال</th>
                  <th>وكيل</th>
                  <th>وجهة</th>
                  <th>تحصيل</th>
                  <th>مسبق</th>
                  <th>حوالة</th>
                  <th>أجور</th>
                </tr>
              </thead>
              <tbody>
                {(data.rows as Array<Record<string, unknown>>).map((r) => (
                  <tr key={String(r.id)}>
                    <td>{String(r.shipment_date)}</td>
                    <td>{String(r.shipment_no)}</td>
                    <td>{String(r.agent_name ?? '—')}</td>
                    <td>{String(r.destination ?? '—')}</td>
                    <td>${fmt(Number(r.collect_amount))}</td>
                    <td>${fmt(Number(r.prepaid_amount))}</td>
                    <td>${fmt(Number(r.hawala_amount))}</td>
                    <td>${fmt(Number(r.transfer_service_fee))}</td>
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
