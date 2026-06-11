import { useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { httpClient } from '../../lib/api/httpClient';
import { phase3FinanceGateway } from '../../lib/api/phase3FinanceGateway';
import { useToast } from '../../components/Toast';
import AgentFinancialStatementContent from '../../components/agents/AgentFinancialStatementContent';
import AgentStatementReconciliationPanel from '../../components/agents/AgentStatementReconciliationPanel';
import {
  getAgentReconciliationMetrics,
  resolveStatementRowReconciliationClass,
} from '../../lib/agents/agentStatementReconciliation';
import FinanceExportToolbar from '../../components/finance/FinanceExportToolbar';
import { formatFinanceAmount } from '../../lib/finance/financeArabicLabels';
import { formatWesternDateTime } from '../../lib/format/westernDigits';
import { buildAgentSettlementPrintHtml } from '../../lib/export/financialStatementPrint';

export default function AgentSettlement() {
  const [searchParams] = useSearchParams();
  const { showToast } = useToast();
  const [agents, setAgents] = useState<Array<{ id: string; name: string }>>([]);
  const [agentId, setAgentId] = useState(searchParams.get('agentId') || '');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const [currencyCode, setCurrencyCode] = useState(searchParams.get('currencyCode') || 'USD');
  const [loading, setLoading] = useState(false);
  const [data, setData] = useState<any>(null);

  useEffect(() => {
    void httpClient.get<Array<{ id: string; name: string }>>('/agents?includeInactive=false')
      .then(setAgents)
      .catch(() => setAgents([]));
  }, []);

  const load = async () => {
    if (!agentId) {
      showToast('اختر الوكيل أولاً', 'error');
      return;
    }
    setLoading(true);
    try {
      const report = await phase3FinanceGateway.accounting.agentSettlement({
        agentId,
        fromAt: dateFrom ? `${dateFrom}T00:00:00.000Z` : undefined,
        toAt: dateTo ? `${dateTo}T23:59:59.999Z` : undefined,
        currencyCode: currencyCode || undefined,
      });
      setData(report);
    } catch (e) {
      showToast(e instanceof Error ? e.message : 'تعذر تحميل كشف التسوية', 'error');
      setData(null);
    } finally {
      setLoading(false);
    }
  };

  const money = (value: unknown, currency = currencyCode || 'USD') =>
    formatFinanceAmount(value, currency);

  const settlement = data?.settlement ?? {};
  const metrics = data ? getAgentReconciliationMetrics(data) : null;
  const rowClass = (row: any) =>
    resolveStatementRowReconciliationClass(row, data?.lastReconciliation?.reconciled_at, metrics?.isMatched ?? false);

  const csvRows = useMemo(() => {
    if (!data) return [];
    const shipRows = (data.shipments ?? []).map((s: any) => [
      formatWesternDateTime(s.created_at),
      s.shipment_no,
      s.destination_city ?? '',
      s.transfer_fee,
      s.hawala_amount,
      s.transfer_service_fee,
      s.agent_shipping_remittance_due ?? 0,
      s.agent_hawala_remittance_due ?? 0,
      s.agent_commission_amount_snapshot,
      s.agent_remittance_due ?? 0,
    ]);
    return shipRows;
  }, [data]);

  return (
    <div className="h-full flex flex-col gap-3">
      <div>
        <h2 className="text-xl font-bold">كشف تسوية الوكيل</h2>
        <p className="text-sm text-gray-600">
          مطابقة شحن + حوالات − عمولة الشحن (من العميل) − سندات — للإرسال الموثّق للوكيل.
        </p>
      </div>

      <div className="card p-2 grid grid-cols-2 md:grid-cols-6 gap-2 items-center">
        <select className="form-select" value={agentId} onChange={(e) => setAgentId(e.target.value)}>
          <option value="">اختر الوكيل</option>
          {agents.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
        </select>
        <input type="date" className="form-input" value={dateFrom} onChange={(e) => setDateFrom(e.target.value)} />
        <input type="date" className="form-input" value={dateTo} onChange={(e) => setDateTo(e.target.value)} />
        <select className="form-select" value={currencyCode} onChange={(e) => setCurrencyCode(e.target.value)}>
          <option value="USD">USD</option><option value="SYP">SYP</option><option value="TRY">TRY</option>
        </select>
        <button type="button" className="toolbar-btn primary" onClick={() => void load()}>تطبيق</button>
        <FinanceExportToolbar
          disabled={loading || !data}
          csvFileName={`agent-settlement-${agentId}-${new Date().toISOString().split('T')[0]}.csv`}
          csvHeaders={['التاريخ', 'الشحنة', 'الوجهة', 'تحصيل', 'حوالة', 'أجور حوالة', 'مطلوب شحن', 'مطلوب حوالة', 'عمولة', 'مطلوب إجمالي']}
          csvRows={csvRows}
          pdfTitle="كشف تسوية الوكيل"
          pdfFileName={`agent-settlement-${new Date().toISOString().split('T')[0]}.pdf`}
          documentType="agent_settlement"
          onBuildPrintHtml={() => buildAgentSettlementPrintHtml(data)}
        />
      </div>

      {data && (
        <>
          <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
            <div className="stat-card"><div className="stat-value">{money(settlement.shippingRemittanceDue)}</div><div className="stat-label">مطلوب شحن (بعد عمولة)</div></div>
            <div className="stat-card"><div className="stat-value">{money(settlement.hawalaRemittanceDue)}</div><div className="stat-label">مطلوب حوالات</div></div>
            <div className="stat-card"><div className="stat-value">{money(settlement.totalShippingCommission)}</div><div className="stat-label">عمولة شحن مستحقة</div></div>
            <div className="stat-card"><div className="stat-value">{money(settlement.confirmedReceipts)}</div><div className="stat-label">سندات قبض</div></div>
            <div className="stat-card"><div className="stat-value">{money(settlement.agentBalanceDue)}</div><div className="stat-label">ذمة على الوكيل</div></div>
          </div>
          <p className="text-xs text-gray-600">{data.summary?.commissionNote}</p>
          <AgentFinancialStatementContent data={data} money={money} rowReconciliationClass={rowClass} />
          <AgentStatementReconciliationPanel
            statementData={data}
            reconciliationSaving={false}
            onSaveReconciliation={async () => showToast('لحفظ مطابقة موقّعة استخدم ملف الوكيل أو سند قبض سريع أدناه', 'info')}
            returnPath="/finance/agent-settlement"
          />
        </>
      )}
      {loading && <p className="text-gray-500 text-sm">جاري التحميل...</p>}
      {!loading && !data && <p className="text-gray-500 text-sm">اختر وكيل واضغط تطبيق لعرض كشف التسوية.</p>}
    </div>
  );
}
