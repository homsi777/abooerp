import { useEffect, useMemo, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { httpClient } from '../../lib/api/httpClient';

type AgentRecord = {
  id: string;
  code: string;
  name: string;
  phone?: string | null;
  governorate?: string | null;
  branch_id?: string | null;
  is_active: boolean;
};

type ShipmentRow = {
  id: string;
  shipment_no: string;
  destination_city?: string | null;
  status: string;
  created_at: string;
  agent_id?: string | null;
};

export default function AgentProfile() {
  const { id = '' } = useParams();
  const navigate = useNavigate();
  const [agent, setAgent] = useState<AgentRecord | null>(null);
  const [shipments, setShipments] = useState<ShipmentRow[]>([]);
  const [statement, setStatement] = useState<null | { kind: 'financial' | 'account'; title: string; data: any }>(null);
  const [statementLoading, setStatementLoading] = useState(false);
  const [reconciliationSaving, setReconciliationSaving] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    const run = async () => {
      setLoading(true);
      setError('');
      try {
        const [agentsRows, shipmentRows] = await Promise.all([
          httpClient.get<AgentRecord[]>('/agents?includeInactive=true'),
          httpClient.get<ShipmentRow[]>('/shipments'),
        ]);
        const found = agentsRows.find((row) => row.id === id) || null;
        setAgent(found);
        setShipments(shipmentRows.filter((row) => row.agent_id === id));
      } catch (loadError) {
        setError(loadError instanceof Error ? loadError.message : 'تعذر تحميل ملف الوكيل.');
      } finally {
        setLoading(false);
      }
    };
    void run();
  }, [id]);

  const shipmentPreview = useMemo(() => shipments.slice(0, 10), [shipments]);

  const openStatement = async (kind: 'financial' | 'account') => {
    if (!agent) return;
    setStatementLoading(true);
    setError('');
    try {
      const endpoint = kind === 'financial' ? 'financial-statement' : 'account-statement';
      const data = await httpClient.get<any>(`/agents/${agent.id}/${endpoint}`);
      setStatement({
        kind,
        title: kind === 'financial' ? `كشف مالي للوكيل - ${agent.name}` : `كشف حساب شامل للوكيل - ${agent.name}`,
        data,
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'تعذر تحميل كشف الوكيل.');
    } finally {
      setStatementLoading(false);
    }
  };

  const refreshStatement = async () => {
    if (!statement) return;
    const endpoint = statement.kind === 'financial' ? 'financial-statement' : 'account-statement';
    const data = await httpClient.get<any>(`/agents/${statement.data.agent.id}/${endpoint}`);
    setStatement({ ...statement, data });
  };

  const saveReconciliation = async () => {
    if (!statement) return;
    const balanceAmount = statement.kind === 'financial'
      ? Number(statement.data.summary.sinceLastReconciliation?.netAgentDue ?? statement.data.summary.netAgentDue ?? 0)
      : Number(statement.data.summary.sinceLastReconciliation?.netAgentDue ?? statement.data.summary.netAgentDue ?? 0);
    setReconciliationSaving(true);
    setError('');
    try {
      await httpClient.post(`/agents/${statement.data.agent.id}/reconciliations`, {
        balanceAmount,
        currencyCode: 'USD',
        notes: 'مطابقة حساب وكيل من ملف الوكيل',
      });
      await refreshStatement();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'تعذر حفظ مطابقة الوكيل.');
    } finally {
      setReconciliationSaving(false);
    }
  };

  const money = (value: unknown, currency = 'USD') => `${Number(value || 0).toLocaleString('ar-SY', { maximumFractionDigits: 2 })} ${currency}`;
  const dateText = (value: unknown) => value ? new Date(String(value)).toLocaleString('ar-SY') : 'لا توجد مطابقة محفوظة';
  const sourceLabel = (value: string) => ({
    shipment_commission: 'عمولة شحنة',
    transfer: 'حوالة',
    receipt_voucher: 'سند قبض',
    payment_voucher: 'سند دفع',
    cashbox_transaction: 'حركة صندوق',
  }[value] ?? value);

  if (!loading && !agent) {
    return <div className="card text-sm text-red-700">الوكيل غير موجود أو ليس ضمن نطاق الشركة.</div>;
  }

  return (
    <div className="h-full flex flex-col gap-3">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-xl font-bold">ملف الوكيل</h2>
          <p className="text-sm text-gray-600">عرض بيانات الوكيل وربطها بالشحنات والمالية</p>
        </div>
        <button type="button" className="toolbar-btn" onClick={() => navigate('/agents')}>عودة</button>
      </div>

      {error ? <div className="card text-sm text-red-700">{error}</div> : null}

      <section className="card">
        <div className="grid grid-cols-4 gap-3">
          <div><strong>الكود:</strong> {agent?.code || '-'}</div>
          <div><strong>الاسم:</strong> {agent?.name || '-'}</div>
          <div><strong>الهاتف:</strong> {agent?.phone || '-'}</div>
          <div><strong>المدينة/المنطقة:</strong> {agent?.governorate || '-'}</div>
          <div><strong>الحالة:</strong> {agent?.is_active ? 'نشط' : 'معلق'}</div>
          <div><strong>عدد الشحنات الحالية:</strong> {shipments.length}</div>
        </div>
        <div className="flex gap-2 mt-3">
          <button type="button" className="toolbar-btn" onClick={() => void openStatement('financial')}>كشف مالي للوكيل</button>
          <button type="button" className="toolbar-btn" onClick={() => void openStatement('account')}>كشف حساب شامل للوكيل</button>
          <button type="button" className="toolbar-btn" onClick={() => navigate(`/finance/debit-credit?partyType=agent`)}>فتح الدائن والمدين</button>
        </div>
      </section>

      <section className="card flex-1 overflow-auto">
        <h3 className="font-semibold mb-2">شحنات الوكيل (أحدث 10)</h3>
        <table className="data-grid">
          <thead>
            <tr>
              <th>#</th>
              <th>رقم الشحنة</th>
              <th>الوجهة</th>
              <th>الحالة</th>
              <th>التاريخ</th>
            </tr>
          </thead>
          <tbody>
            {shipmentPreview.map((row, index) => (
              <tr key={row.id}>
                <td>{index + 1}</td>
                <td>{row.shipment_no}</td>
                <td>{row.destination_city || '-'}</td>
                <td>{row.status}</td>
                <td>{new Date(row.created_at).toLocaleString('ar-SY')}</td>
              </tr>
            ))}
            {!loading && shipmentPreview.length === 0 ? (
              <tr>
                <td colSpan={5} className="text-center p-6 text-gray-500">لا توجد شحنات مرتبطة بهذا الوكيل حالياً.</td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </section>
      {statementLoading ? <div className="fixed inset-0 z-50 grid place-items-center bg-black/30 text-white">جاري تحميل الكشف...</div> : null}
      {statement ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <div className="bg-white rounded-lg shadow-xl w-full max-w-6xl max-h-[90vh] overflow-auto">
            <div className="flex items-center justify-between border-b p-4">
              <h3 className="font-bold text-lg">{statement.title}</h3>
              <button type="button" className="toolbar-btn" onClick={() => setStatement(null)}>إغلاق</button>
            </div>
            <div className="p-4 space-y-4">
              <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
                <div className="stat-card"><div className="stat-value text-sm">{dateText(statement.data.generatedAt)}</div><div className="stat-label">تاريخ استخراج الكشف</div></div>
                <div className="stat-card"><div className="stat-value text-sm">{dateText(statement.data.lastReconciliation?.reconciled_at)}</div><div className="stat-label">تاريخ آخر مطابقة</div></div>
                <div className="stat-card"><div className="stat-value">{money(statement.data.lastReconciliation?.balance_amount, statement.data.lastReconciliation?.currency_code || 'USD')}</div><div className="stat-label">رصيد آخر مطابقة</div></div>
                <div className="stat-card flex flex-col justify-center gap-2">
                  <button type="button" className="toolbar-btn success" disabled={reconciliationSaving} onClick={() => void saveReconciliation()}>
                    {reconciliationSaving ? 'جاري الحفظ...' : 'حفظ مطابقة حتى الآن'}
                  </button>
                </div>
              </div>
              {statement.kind === 'financial' ? (
                <>
                  <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                    <div className="stat-card"><div className="stat-value">{statement.data.summary.shipmentsCount}</div><div className="stat-label">شحنات</div></div>
                    <div className="stat-card"><div className="stat-value">{statement.data.summary.transfersCount}</div><div className="stat-label">حوالات</div></div>
                    <div className="stat-card"><div className="stat-value">{money(statement.data.summary.totalShipmentCommission)}</div><div className="stat-label">عمولة الشحن</div></div>
                    <div className="stat-card"><div className="stat-value">{money(statement.data.summary.totalAgentCommission)}</div><div className="stat-label">إجمالي العمولة</div></div>
                  </div>
                  <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                    <div className="stat-card"><div className="stat-value">{Number(statement.data.agent.commission_percentage || 0)}%</div><div className="stat-label">نسبة عمولة الوكيل الحالية</div></div>
                    <div className="stat-card"><div className="stat-value">{money(statement.data.summary.sinceLastReconciliation?.totalAgentCommission)}</div><div className="stat-label">عمولة بعد آخر مطابقة</div></div>
                    <div className="stat-card"><div className="stat-value">{money(statement.data.summary.sinceLastReconciliation?.paidToAgent)}</div><div className="stat-label">مدفوع للوكيل بعد المطابقة</div></div>
                    <div className="stat-card"><div className="stat-value font-bold">{money(statement.data.summary.sinceLastReconciliation?.netAgentDue)}</div><div className="stat-label">مستحق للوكيل حتى الآن</div></div>
                  </div>
                  <table className="data-grid text-sm">
                    <thead><tr><th>التاريخ</th><th>النوع</th><th>المرجع</th><th>البيان</th><th>المبلغ</th><th>العمولة</th><th>الحالة</th></tr></thead>
                    <tbody>
                      {statement.data.shipments.map((s: any) => <tr key={`s-${s.id}`}><td>{String(s.created_at).split('T')[0]}</td><td>شحنة</td><td>{s.shipment_no}</td><td>{s.sender_name ?? '-'} / {s.receiver_name ?? '-'}</td><td>{money(s.freight_charge, s.original_currency)}</td><td>{money(s.agent_commission_amount_snapshot, s.original_currency)}</td><td>{s.status}</td></tr>)}
                      {statement.data.transfers.map((t: any) => <tr key={`t-${t.id}`}><td>{String(t.transfer_date || t.created_at).split('T')[0]}</td><td>حوالة</td><td>{t.shipment_no ?? '-'}</td><td>{t.sender_name} / {t.receiver_name}</td><td>{money(t.amount, t.currency)}</td><td>{money(t.agent_commission, t.agent_commission_currency)}</td><td>{t.status}</td></tr>)}
                      {statement.data.vouchers.map((v: any) => <tr key={`v-${v.id}`}><td>{String(v.created_at).split('T')[0]}</td><td>{v.voucher_kind === 'receipt' ? 'سند قبض' : 'سند دفع'}</td><td>{v.voucher_no}</td><td>{v.notes ?? '-'}</td><td>{money(v.original_amount, v.original_currency)}</td><td>-</td><td>{v.status}</td></tr>)}
                    </tbody>
                  </table>
                </>
              ) : (
                <>
                  <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                    <div className="stat-card"><div className="stat-value">{statement.data.summary.rowsCount}</div><div className="stat-label">حركة</div></div>
                    <div className="stat-card"><div className="stat-value text-green-700">{money(statement.data.summary.totalDebit)}</div><div className="stat-label">مدين</div></div>
                    <div className="stat-card"><div className="stat-value text-red-700">{money(statement.data.summary.totalCredit)}</div><div className="stat-label">دائن</div></div>
                    <div className="stat-card"><div className="stat-value font-bold">{money(statement.data.summary.netAgentDue)}</div><div className="stat-label">مستحق للوكيل</div></div>
                  </div>
                  <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                    <div className="stat-card"><div className="stat-value">{statement.data.summary.sinceLastReconciliation?.rowsCount ?? 0}</div><div className="stat-label">حركات بعد آخر مطابقة</div></div>
                    <div className="stat-card"><div className="stat-value text-green-700">{money(statement.data.summary.sinceLastReconciliation?.totalDebit)}</div><div className="stat-label">مدين بعد المطابقة</div></div>
                    <div className="stat-card"><div className="stat-value text-red-700">{money(statement.data.summary.sinceLastReconciliation?.totalCredit)}</div><div className="stat-label">دائن بعد المطابقة</div></div>
                    <div className="stat-card"><div className="stat-value font-bold">{money(statement.data.summary.sinceLastReconciliation?.netAgentDue)}</div><div className="stat-label">مستحق بعد آخر مطابقة</div></div>
                  </div>
                  <table className="data-grid text-sm">
                    <thead><tr><th>التاريخ</th><th>المصدر</th><th>المرجع</th><th>البيان</th><th>مدين</th><th>دائن</th><th>العملة</th><th>الحالة</th></tr></thead>
                    <tbody>
                      {statement.data.rows.map((r: any) => <tr key={`${r.source_type}-${r.source_id}-${r.at}`}><td>{String(r.at).split('T')[0]}</td><td>{sourceLabel(r.source_type)}</td><td>{r.reference_no ?? '-'}</td><td>{r.description ?? '-'}</td><td>{Number(r.debit || 0).toLocaleString()}</td><td>{Number(r.credit || 0).toLocaleString()}</td><td>{r.currency_code}</td><td>{r.status}</td></tr>)}
                    </tbody>
                  </table>
                </>
              )}
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
