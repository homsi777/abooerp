import { useEffect, useMemo, useState } from 'react';
import { useSearchParams, Link } from 'react-router-dom';
import { httpClient } from '../../lib/api/httpClient';
import { phase3FinanceGateway } from '../../lib/api/phase3FinanceGateway';
import { useToast } from '../../components/Toast';
import AgentFinancialStatementContent from '../../components/agents/AgentFinancialStatementContent';
import {
  getAgentReconciliationMetrics,
  resolveStatementRowReconciliationClass,
} from '../../lib/agents/agentStatementReconciliation';
import FinanceExportToolbar from '../../components/finance/FinanceExportToolbar';
import {
  financeAgentRoleLabel,
  formatFinanceAmount,
} from '../../lib/finance/financeArabicLabels';
import { formatWesternDate, formatWesternDateTime } from '../../lib/format/westernDigits';
import { buildAgentBranchReconciliationPrintHtml } from '../../lib/export/financialStatementPrint';

const hawalaRoleLabel: Record<string, string> = {
  origin: 'مصدر',
  destination: 'وجهة',
  both: 'مصدر ووجهة',
};

const REPORT_CURRENCY = 'USD';
const DEFAULT_DATE_FROM = '2026-06-01';

export default function AgentBranchReconciliation() {
  const [searchParams] = useSearchParams();
  const { showToast } = useToast();
  const [agents, setAgents] = useState<Array<{ id: string; name: string; governorate?: string }>>([]);
  const [agentId, setAgentId] = useState(searchParams.get('agentId') || '');
  const [dateFrom, setDateFrom] = useState(DEFAULT_DATE_FROM);
  const [dateTo, setDateTo] = useState('');
  const [loading, setLoading] = useState(false);
  const [data, setData] = useState<any>(null);

  useEffect(() => {
    void httpClient
      .get<Array<{ id: string; name: string; governorate?: string }>>('/agents?includeInactive=false')
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
      const report = await phase3FinanceGateway.accounting.agentBranchReconciliation({
        agentId,
        fromAt: dateFrom ? `${dateFrom}T00:00:00.000Z` : undefined,
        toAt: dateTo ? `${dateTo}T23:59:59.999Z` : undefined,
        currencyCode: REPORT_CURRENCY,
      });
      setData(report);
    } catch (e) {
      showToast(e instanceof Error ? e.message : 'تعذر تحميل مطابقة الوكيل والفرع الرئيسي', 'error');
      setData(null);
    } finally {
      setLoading(false);
    }
  };

  const money = (value: unknown) => formatFinanceAmount(value, REPORT_CURRENCY);

  const mainBranch = data?.mainBranch ?? {};
  const ledgerSummary = data?.accountStatement?.summary ?? {};
  const hawala = data?.hawalaSection ?? {};
  const hawalaSummary = hawala.summary ?? {};
  const metrics = data ? getAgentReconciliationMetrics(data) : null;
  const rowClass = (row: any) =>
    resolveStatementRowReconciliationClass(row, data?.lastReconciliation?.reconciled_at, metrics?.isMatched ?? false);

  const csvRows = useMemo(() => {
    if (!data) return [];
    const shipRows = (data.shipments ?? []).map((s: any) => [
      formatWesternDateTime(s.created_at),
      s.shipment_no,
      s.destination_city ?? '',
      s.prepaid_at_main_branch ?? 0,
      s.transfer_fee,
      s.hawala_amount,
      s.transfer_service_fee,
      s.agent_commission_amount_snapshot,
      s.agent_net_required_from_agent ?? 0,
    ]);
    const trRows = (hawala.transfers ?? [])
      .filter((t: any) => !t.shipment_id)
      .map((t: any) => [
        formatWesternDateTime(t.transfer_date ?? t.created_at),
        'حوالة',
        t.destination_city ?? '',
        0,
        0,
        t.amount,
        t.transfer_service_fee,
        0,
        t.agent_remittance_due ?? 0,
      ]);
    return [...shipRows, ...trRows];
  }, [data, hawala.transfers]);

  const reconciliationCards = [
    { label: 'مسبق في الفرع الرئيسي', value: mainBranch.prepaidRetainedAtMainBranch, hint: mainBranch.prepaidNote },
    { label: 'تحصيل مع الوكيل (COD)', value: mainBranch.collectionCollectedByAgent },
    { label: 'حوالات (أصل + أجور)', value: mainBranch.hawalaRemittanceTotal },
    { label: 'عمولة شحن مستحقة للوكيل', value: mainBranch.totalShippingCommissionDueToAgent },
    { label: 'عمولة على المسبق (في الفرع)', value: mainBranch.commissionOnPrepaidAtMainBranch },
    { label: 'صافي مطلوب من الوكيل', value: mainBranch.netRequiredFromAgentAfterCommission, highlight: true },
    { label: 'سندات قبض (توريد)', value: mainBranch.confirmedReceiptsFromAgent },
    { label: 'سندات دفع (عمولة)', value: mainBranch.confirmedPaymentsToAgent },
    { label: 'فارق المطابقة / ذمة الوكيل', value: mainBranch.reconciliationGap, highlight: true },
  ];

  return (
    <div className="h-full flex flex-col gap-3">
      <div>
        <h2 className="text-xl font-bold">كشف وكيل ↔ فرع رئيسي</h2>
        <p className="text-sm text-gray-600">
          تقرير تشغيلي للمراجعة والطباعة: شحن (مسبق في الفرع + تحصيل مع الوكيل) + حوالات − عمولة الشحن + سندات + حركات الذمة.
        </p>
        <p className="text-xs text-gray-500 mt-1">
          لاعتماد الذمة والمطابقة الرسمية بين الطرفين استخدم{' '}
          <Link className="text-primary-700 underline" to="/finance/bilateral-reconciliation">مطابقة ثنائية</Link>{' '}
          ضمن قسم المالية.
        </p>
        <p className="text-xs text-gray-500 mt-1">{mainBranch.voucherNote}</p>
      </div>

      <div className="card p-2 flex flex-col gap-2">
        <div className="grid grid-cols-2 md:grid-cols-5 gap-2 items-center">
          <select className="form-select" value={agentId} onChange={(e) => setAgentId(e.target.value)}>
            <option value="">اختر الوكيل / الوجهة</option>
            {agents.map((a) => (
              <option key={a.id} value={a.id}>
                {a.name}{a.governorate ? ` — ${a.governorate}` : ''}
              </option>
            ))}
          </select>
          <input type="date" className="form-input" value={dateFrom} onChange={(e) => setDateFrom(e.target.value)} title="من تاريخ" />
          <input type="date" className="form-input" value={dateTo} onChange={(e) => setDateTo(e.target.value)} title="إلى تاريخ" />
          <div className="text-sm text-gray-600 px-2">العملة: {REPORT_CURRENCY} (دولار)</div>
          <button type="button" className="toolbar-btn primary" onClick={() => void load()}>تطبيق</button>
        </div>
        <FinanceExportToolbar
          disabled={loading || !data}
          csvFileName={`agent-branch-reconciliation-${agentId}-${new Date().toISOString().split('T')[0]}.csv`}
          csvHeaders={['التاريخ', 'المرجع', 'الوجهة', 'مسبق فرع', 'تحصيل', 'حوالة', 'أجور', 'عمولة', 'صافي مطلوب']}
          csvRows={csvRows}
          pdfTitle="مطابقة الوكيل والفرع الرئيسي"
          pdfFileName={`agent-branch-reconciliation-${new Date().toISOString().split('T')[0]}.pdf`}
          documentType="agent_branch_reconciliation"
          onBuildPrintHtml={() => buildAgentBranchReconciliationPrintHtml(data)}
        />
      </div>

      {data && (
        <>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <div className="stat-card">
              <div className="stat-value">{money(ledgerSummary.totalDebit ?? data?.summary?.accountDebit ?? 0)}</div>
              <div className="stat-label">إجمالي مدين (على الوكيل)</div>
            </div>
            <div className="stat-card">
              <div className="stat-value">{money(ledgerSummary.totalCredit ?? 0)}</div>
              <div className="stat-label">إجمالي دائن (لصالح الوكيل / مسدّد)</div>
            </div>
            <div className="stat-card ring-2 ring-primary-500/30">
              <div className="stat-value">{money(ledgerSummary.agentBalanceDue ?? data?.summary?.agentBalanceDue ?? 0)}</div>
              <div className="stat-label">رصيد الذمة من دفتر الحركات</div>
            </div>
            <div className="stat-card">
              <div className="stat-value">{(data?.accountStatement?.rows ?? []).length}</div>
              <div className="stat-label">عدد حركات الذمة</div>
            </div>
          </div>

          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-3">
            {reconciliationCards.map((card) => (
              <div
                key={card.label}
                className={`stat-card ${card.highlight ? 'ring-2 ring-primary-500/30' : ''}`}
                title={card.hint ?? undefined}
              >
                <div className="stat-value">{money(card.value)}</div>
                <div className="stat-label">{card.label}</div>
              </div>
            ))}
          </div>
          <p className="text-xs text-gray-600">{mainBranch.commissionNote}</p>

          <div className="card p-3">
            <h3 className="font-semibold mb-2">تفصيل الحوالات (بدون عمولة وكيل)</h3>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-2 text-sm mb-3">
              <div>حوالة على شحنات: {money(hawalaSummary.hawalaPrincipalOnShipments)}</div>
              <div>أجور على شحنات: {money(hawalaSummary.hawalaFeesOnShipments)}</div>
              <div>حوالات مستقلة: {money(hawalaSummary.standaloneHawalaPrincipal)}</div>
              <div>إجمالي مطلوب حوالات: {money(hawalaSummary.totalHawalaRemittanceDue)}</div>
            </div>
            {(hawala.transfers ?? []).filter((t: any) => !t.shipment_id).length > 0 && (
              <div className="overflow-x-auto">
                <table className="data-table text-sm">
                  <thead>
                    <tr>
                      <th>التاريخ</th>
                      <th>المرسل/المستلم</th>
                      <th>الوجهة</th>
                      <th>الدور</th>
                      <th>أصل</th>
                      <th>أجرة</th>
                      <th>مطلوب</th>
                    </tr>
                  </thead>
                  <tbody>
                    {(hawala.transfers ?? [])
                      .filter((t: any) => !t.shipment_id)
                      .map((t: any) => (
                        <tr key={t.id}>
                          <td>{formatWesternDate(t.transfer_date ?? t.created_at)}</td>
                          <td>{t.sender_name} / {t.receiver_name}</td>
                          <td>{t.destination_city ?? '—'}</td>
                          <td>{hawalaRoleLabel[String(t.agent_role)] ?? t.agent_role}</td>
                          <td>{money(t.amount)}</td>
                          <td>{money(t.transfer_service_fee)}</td>
                          <td>{money(t.agent_remittance_due ?? 0)}</td>
                        </tr>
                      ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>

          <AgentFinancialStatementContent
            data={data}
            money={money}
            rowReconciliationClass={rowClass}
            reportCurrency={REPORT_CURRENCY}
            showLedgerMovements
          />
        </>
      )}
      {loading && <p className="text-gray-500 text-sm">جاري التحميل...</p>}
      {!loading && !data && (
        <p className="text-gray-500 text-sm">اختر وكيل (الرقة، الحسكة، القامشلي…) واضغط تطبيق.</p>
      )}
    </div>
  );
}
