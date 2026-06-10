import { useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { httpClient } from '../../lib/api/httpClient';
import { phase3FinanceGateway } from '../../lib/api/phase3FinanceGateway';
import { useToast } from '../../components/Toast';
import FinanceExportToolbar from '../../components/finance/FinanceExportToolbar';
import { buildHawalaReconciliationPrintHtml } from '../../lib/export/financialStatementPrint';

const roleLabel: Record<string, string> = {
  origin: 'مصدر (قبض)',
  destination: 'وجهة (دفع)',
  both: 'مصدر ووجهة',
  none: '—',
};

export default function HawalaReconciliation() {
  const [searchParams] = useSearchParams();
  const { showToast } = useToast();
  const [agents, setAgents] = useState<Array<{ id: string; name: string }>>([]);
  const [agentId, setAgentId] = useState(searchParams.get('agentId') || '');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const [currencyCode, setCurrencyCode] = useState('USD');
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
      const report = await phase3FinanceGateway.accounting.hawalaReconciliation({
        agentId,
        fromAt: dateFrom ? `${dateFrom}T00:00:00.000Z` : undefined,
        toAt: dateTo ? `${dateTo}T23:59:59.999Z` : undefined,
        currencyCode: currencyCode || undefined,
      });
      setData(report);
    } catch (e) {
      showToast(e instanceof Error ? e.message : 'تعذر تحميل مطابقة الحوالات', 'error');
      setData(null);
    } finally {
      setLoading(false);
    }
  };

  const summary = data?.summary ?? {};
  const money = (v: unknown) => Number(v || 0).toLocaleString('en-US', { maximumFractionDigits: 2 });

  const csvRows = useMemo(() => {
    if (!data) return [];
    const ship = (data.shipments ?? []).map((s: any) => [
      'شحنة',
      s.shipment_no,
      s.destination_city ?? '',
      s.hawala_amount,
      s.transfer_service_fee,
      s.agent_hawala_remittance_due ?? 0,
      0,
    ]);
    const tr = (data.transfers ?? []).filter((t: any) => !t.shipment_id).map((t: any) => [
      'حوالة',
      String(t.id).slice(0, 8),
      t.destination_city ?? '',
      t.amount,
      t.transfer_service_fee,
      t.agent_remittance_due ?? 0,
      t.agent_commission ?? 0,
    ]);
    return [...ship, ...tr];
  }, [data]);

  return (
    <div className="h-full flex flex-col gap-3">
      <div>
        <h2 className="text-xl font-bold">كشف مطابقة الحوالات</h2>
        <p className="text-sm text-gray-600">ذمم الحوالات وأجورها مع الوكيل — بدون عمولة وكيل على الحوالة.</p>
      </div>

      <div className="card p-2 grid grid-cols-2 md:grid-cols-6 gap-2">
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
          csvFileName={`hawala-reconciliation-${new Date().toISOString().split('T')[0]}.csv`}
          csvHeaders={['النوع', 'المرجع', 'الوجهة', 'أصل/حوالة', 'أجرة', 'مطلوب', 'عمولة وكيل']}
          csvRows={csvRows}
          pdfTitle="كشف مطابقة الحوالات"
          pdfFileName={`hawala-reconciliation-${new Date().toISOString().split('T')[0]}.pdf`}
          documentType="hawala_reconciliation"
          onBuildPrintHtml={() => buildHawalaReconciliationPrintHtml(data)}
        />
      </div>

      {data && (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <div className="stat-card"><div className="stat-value">{money(summary.hawalaPrincipalOnShipments)}</div><div className="stat-label">حوالة على شحنات</div></div>
          <div className="stat-card"><div className="stat-value">{money(summary.hawalaFeesOnShipments)}</div><div className="stat-label">أجور على شحنات</div></div>
          <div className="stat-card"><div className="stat-value">{money(summary.standaloneRemittanceDue)}</div><div className="stat-label">حوالات مستقلة</div></div>
          <div className="stat-card"><div className="stat-value">{money(summary.totalHawalaRemittanceDue)}</div><div className="stat-label">إجمالي مطلوب حوالات</div></div>
        </div>
      )}

      <div className="card overflow-auto flex-1 space-y-4">
        {loading ? <p className="p-4 text-gray-500">جاري التحميل...</p> : null}
        {data && (
          <>
            <p className="text-xs text-amber-800 px-2">{summary.commissionNote}</p>
            <h3 className="font-bold px-2">شحنات بها حوالة</h3>
            <table className="data-grid text-sm">
              <thead>
                <tr>
                  <th>التاريخ</th><th>الشحنة</th><th>الوجهة</th>
                  <th className="text-left">حوالة</th><th className="text-left">أجور</th><th className="text-left">مطلوب</th>
                </tr>
              </thead>
              <tbody>
                {(data.shipments ?? []).map((s: any) => (
                  <tr key={s.id}>
                    <td>{new Date(s.created_at).toLocaleString('ar-SY')}</td>
                    <td>{s.shipment_no}</td>
                    <td>{s.destination_city ?? '—'}</td>
                    <td className="text-left">{money(s.hawala_amount)}</td>
                    <td className="text-left">{money(s.transfer_service_fee)}</td>
                    <td className="text-left">{money(s.agent_hawala_remittance_due)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            <h3 className="font-bold px-2">حوالات مستقلة</h3>
            <table className="data-grid text-sm">
              <thead>
                <tr>
                  <th>التاريخ</th><th>المرسل/المستلم</th><th>الدور</th>
                  <th className="text-left">أصل</th><th className="text-left">أجرة</th><th className="text-left">مطلوب</th><th>الحالة</th>
                </tr>
              </thead>
              <tbody>
                {(data.transfers ?? []).filter((t: any) => !t.shipment_id).map((t: any) => (
                  <tr key={t.id}>
                    <td>{new Date(t.transfer_date ?? t.created_at).toLocaleString('ar-SY')}</td>
                    <td>{t.sender_name} / {t.receiver_name}</td>
                    <td>{roleLabel[t.agent_role] ?? t.agent_role}</td>
                    <td className="text-left">{money(t.amount)}</td>
                    <td className="text-left">{money(t.transfer_service_fee)}</td>
                    <td className="text-left">{money(t.agent_remittance_due)}</td>
                    <td>{t.status}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </>
        )}
      </div>
    </div>
  );
}
