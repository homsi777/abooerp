import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { httpClient } from '../../lib/api/httpClient';
import { phase3FinanceGateway } from '../../lib/api/phase3FinanceGateway';
import { normalizeShipmentStatus } from '../../lib/shipments/shipmentStatus';

type AgentRecord = {
  id: string;
  code: string;
  name: string;
  phone?: string | null;
  governorate?: string | null;
  city?: string | null;
  area?: string | null;
  address?: string | null;
  notes?: string | null;
  branch_id?: string | null;
  commission_percentage?: number | null;
  is_active: boolean;
};

type BranchRecord = { id: string; code?: string; name: string };
type ShipmentRow = { id: string; agent_id?: string | null; status: string };
type DebitCreditSummaryRow = { partyType: string; partyId: string; totalDebit: number; totalCredit: number; lastMovementAt: string | null };
type AgentStatementModal =
  | { kind: 'financial'; title: string; data: any }
  | { kind: 'account'; title: string; data: any };
type AgentForm = {
  id?: string;
  code: string;
  name: string;
  phone: string;
  governorate: string;
  city: string;
  area: string;
  branch_id: string;
  address: string;
  notes: string;
  commission_percentage: number;
  is_active: boolean;
};

const emptyForm: AgentForm = {
  code: '',
  name: '',
  phone: '',
  governorate: '',
  city: '',
  area: '',
  branch_id: '',
  address: '',
  notes: '',
  commission_percentage: 0,
  is_active: true,
};

export default function AgentsModule() {
  const navigate = useNavigate();
  const [agents, setAgents] = useState<AgentRecord[]>([]);
  const [branches, setBranches] = useState<BranchRecord[]>([]);
  const [shipments, setShipments] = useState<ShipmentRow[]>([]);
  const [balances, setBalances] = useState<Map<string, DebitCreditSummaryRow>>(new Map());
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [editing, setEditing] = useState<AgentForm | null>(null);
  const [statementModal, setStatementModal] = useState<AgentStatementModal | null>(null);
  const [statementLoading, setStatementLoading] = useState(false);
  const [reconciliationSaving, setReconciliationSaving] = useState(false);
  const [filters, setFilters] = useState({ search: '', branchId: '', status: '', city: '', onlyWithBalance: false });

  const load = async () => {
    setLoading(true);
    setError('');
    try {
      const [agentsRows, branchRows, shipmentRows, summary] = await Promise.all([
        httpClient.get<AgentRecord[]>('/agents?includeInactive=true'),
        httpClient.get<BranchRecord[]>('/branches?includeInactive=true'),
        httpClient.get<ShipmentRow[]>('/shipments'),
        phase3FinanceGateway.debitCredit.getSummary({ partyType: 'agent', pageSize: 1000 }).catch(() => ({ rows: [] as DebitCreditSummaryRow[] })),
      ]);
      setAgents(agentsRows);
      setBranches(branchRows);
      setShipments(shipmentRows);
      setBalances(new Map(summary.rows.map((row: any) => [row.partyId, row])));
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : 'تعذر تحميل بيانات الوكلاء.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void load();
  }, []);

  const branchById = useMemo(() => new Map(branches.map((row) => [row.id, row.name])), [branches]);

  const rows = useMemo(() => {
    const normalizedSearch = filters.search.trim().toLowerCase();
    return agents
      .filter((agent) => {
        if (filters.branchId && agent.branch_id !== filters.branchId) return false;
        if (filters.status === 'active' && !agent.is_active) return false;
        if (filters.status === 'inactive' && agent.is_active) return false;
        const destinationText = `${agent.governorate || ''} ${agent.city || ''} ${agent.area || ''}`.toLowerCase();
        if (filters.city && !destinationText.includes(filters.city.trim().toLowerCase())) return false;
        if (normalizedSearch) {
          const haystack = `${agent.code} ${agent.name} ${agent.phone || ''}`.toLowerCase();
          if (!haystack.includes(normalizedSearch)) return false;
        }
        const balanceRow = balances.get(agent.id);
        const balance = (balanceRow?.totalDebit || 0) - (balanceRow?.totalCredit || 0);
        return !filters.onlyWithBalance || balance !== 0;
      })
      .map((agent) => {
        const relatedShipments = shipments.filter((shipment) => shipment.agent_id === agent.id);
        const delivered = relatedShipments.filter((shipment) => normalizeShipmentStatus(shipment.status) === 'DELIVERED').length;
        const inTransit = relatedShipments.filter((shipment) => {
          const status = normalizeShipmentStatus(shipment.status);
          return status === 'IN_TRANSIT' || status === 'OUT_FOR_DELIVERY';
        }).length;
        const balanceRow = balances.get(agent.id);
        const balance = (balanceRow?.totalDebit || 0) - (balanceRow?.totalCredit || 0);
        return {
          ...agent,
          totalShipments: relatedShipments.length,
          inTransit,
          delivered,
          branchName: agent.branch_id ? branchById.get(agent.branch_id) || '-' : '-',
          balance,
          balanceDirection: balance > 0 ? 'مدين لنا' : balance < 0 ? 'دائن علينا' : 'متوازن',
          lastMovementAt: balanceRow?.lastMovementAt || null,
        };
      });
  }, [agents, balances, branchById, filters, shipments]);

  const beginEdit = (agent?: AgentRecord) => {
    setError('');
    setSuccess('');
    setEditing(agent ? {
      id: agent.id,
      code: agent.code,
      name: agent.name,
      phone: agent.phone || '',
      governorate: agent.governorate || '',
      city: agent.city || '',
      area: agent.area || '',
      branch_id: agent.branch_id || '',
      address: agent.address || '',
      notes: agent.notes || '',
      commission_percentage: Number(agent.commission_percentage ?? 0),
      is_active: agent.is_active,
    } : { ...emptyForm, code: `AG-${Date.now().toString().slice(-6)}` });
  };

  const saveAgent = async () => {
    if (!editing) return;
    if (!editing.code.trim() || !editing.name.trim() || !editing.branch_id) {
      setError('كود الوكيل واسم الوكيل والفرع المرتبط حقول مطلوبة.');
      return;
    }
    setSaving(true);
    setError('');
    try {
      const payload = {
        code: editing.code.trim(),
        name: editing.name.trim(),
        phone: editing.phone.trim() || undefined,
        governorate: editing.governorate.trim() || undefined,
        city: editing.city.trim() || undefined,
        area: editing.area.trim() || undefined,
        branch_id: editing.branch_id,
        address: editing.address.trim() || undefined,
        notes: editing.notes.trim() || undefined,
        commission_percentage: Number(editing.commission_percentage || 0),
        is_active: editing.is_active,
      };
      if (editing.id) {
        await httpClient.put(`/agents/${editing.id}`, payload);
        setSuccess('تم تحديث بيانات الوكيل بنجاح.');
      } else {
        await httpClient.post('/agents', payload);
        setSuccess('تمت إضافة الوكيل بنجاح.');
      }
      setEditing(null);
      await load();
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : 'تعذر حفظ بيانات الوكيل.');
    } finally {
      setSaving(false);
    }
  };

  const toggleAgent = async (agent: AgentRecord) => {
    setSaving(true);
    setError('');
    try {
      await httpClient.put(`/agents/${agent.id}`, { is_active: !agent.is_active });
      setSuccess(agent.is_active ? 'تم تعطيل الوكيل.' : 'تم تفعيل الوكيل.');
      await load();
    } catch (toggleError) {
      setError(toggleError instanceof Error ? toggleError.message : 'تعذر تغيير حالة الوكيل.');
    } finally {
      setSaving(false);
    }
  };

  const openAgentStatement = async (agent: AgentRecord, kind: 'financial' | 'account') => {
    setStatementLoading(true);
    setError('');
    try {
      const endpoint = kind === 'financial' ? 'financial-statement' : 'account-statement';
      const data = await httpClient.get<any>(`/agents/${agent.id}/${endpoint}`);
      setStatementModal({
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

  const refreshStatement = async (modal: AgentStatementModal) => {
    const endpoint = modal.kind === 'financial' ? 'financial-statement' : 'account-statement';
    const data = await httpClient.get<any>(`/agents/${modal.data.agent.id}/${endpoint}`);
    setStatementModal({ ...modal, data });
  };

  const saveAgentReconciliation = async () => {
    if (!statementModal) return;
    const balanceAmount = statementModal.kind === 'financial'
      ? Number(statementModal.data.summary.sinceLastReconciliation?.netAgentDue ?? statementModal.data.summary.netAgentDue ?? 0)
      : Number(statementModal.data.summary.sinceLastReconciliation?.netAgentDue ?? statementModal.data.summary.netAgentDue ?? 0);
    setReconciliationSaving(true);
    setError('');
    try {
      await httpClient.post(`/agents/${statementModal.data.agent.id}/reconciliations`, {
        balanceAmount,
        currencyCode: 'USD',
        notes: 'مطابقة حساب وكيل من شاشة الكشف',
      });
      await refreshStatement(statementModal);
      setSuccess('تم حفظ تاريخ آخر مطابقة للوكيل.');
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

  return (
    <div className="h-full flex flex-col">
      <div className="mb-3 flex items-start justify-between gap-3">
        <div>
          <h2 className="text-xl font-bold">الوكلاء</h2>
          <p className="text-sm text-gray-600">إدارة الوكلاء، ربطهم بالفروع والوجهات، ومتابعة حالتهم التشغيلية.</p>
        </div>
        <button type="button" className="toolbar-btn primary" onClick={() => beginEdit()}>إضافة وكيل</button>
      </div>

      {editing ? (
        <div className="card mb-3">
          <div className="card-header">{editing.id ? 'تعديل وكيل' : 'إضافة وكيل جديد'}</div>
          <div className="grid grid-cols-4 gap-3">
            <label className="form-group"><span className="form-label">كود الوكيل</span><input className="form-input" value={editing.code} onChange={(e) => setEditing({ ...editing, code: e.target.value })} /></label>
            <label className="form-group"><span className="form-label">اسم الوكيل</span><input className="form-input" value={editing.name} onChange={(e) => setEditing({ ...editing, name: e.target.value })} /></label>
            <label className="form-group"><span className="form-label">الهاتف</span><input className="form-input" value={editing.phone} onChange={(e) => setEditing({ ...editing, phone: e.target.value })} /></label>
            <label className="form-group"><span className="form-label">الفرع المرتبط</span><select className="form-select" value={editing.branch_id} onChange={(e) => setEditing({ ...editing, branch_id: e.target.value })}><option value="">اختر الفرع</option>{branches.filter((b: any) => b.is_active !== false).map((branch) => <option key={branch.id} value={branch.id}>{branch.name}</option>)}</select></label>
            <label className="form-group"><span className="form-label">المحافظة</span><input className="form-input" value={editing.governorate} onChange={(e) => setEditing({ ...editing, governorate: e.target.value })} /></label>
            <label className="form-group"><span className="form-label">المدينة</span><input className="form-input" value={editing.city} onChange={(e) => setEditing({ ...editing, city: e.target.value })} /></label>
            <label className="form-group"><span className="form-label">المنطقة</span><input className="form-input" value={editing.area} onChange={(e) => setEditing({ ...editing, area: e.target.value })} /></label>
            <label className="form-group"><span className="form-label">نسبة عمولة الوكيل (%)</span><input type="number" min="0" max="100" step="0.01" className="form-input" value={editing.commission_percentage ?? 0} onChange={(e) => setEditing({ ...editing, commission_percentage: Number(e.target.value) || 0 })} /></label>
            <label className="form-group"><span className="form-label">الحالة</span><select className="form-select" value={editing.is_active ? 'active' : 'inactive'} onChange={(e) => setEditing({ ...editing, is_active: e.target.value === 'active' })}><option value="active">نشط</option><option value="inactive">معطل</option></select></label>
            <label className="form-group col-span-2"><span className="form-label">العنوان</span><input className="form-input" value={editing.address} onChange={(e) => setEditing({ ...editing, address: e.target.value })} /></label>
            <label className="form-group col-span-2"><span className="form-label">ملاحظات</span><input className="form-input" value={editing.notes} onChange={(e) => setEditing({ ...editing, notes: e.target.value })} /></label>
          </div>
          <div className="mt-3 flex gap-2">
            <button type="button" className="toolbar-btn success" disabled={saving} onClick={() => void saveAgent()}>{saving ? 'جاري الحفظ...' : 'حفظ'}</button>
            <button type="button" className="toolbar-btn" onClick={() => setEditing(null)}>إلغاء</button>
          </div>
        </div>
      ) : null}

      <div className="card mb-3">
        <div className="grid grid-cols-7 gap-2">
          <input className="form-input" placeholder="بحث عام" value={filters.search} onChange={(event) => setFilters((prev) => ({ ...prev, search: event.target.value }))} />
          <select className="form-select" value={filters.branchId} onChange={(event) => setFilters((prev) => ({ ...prev, branchId: event.target.value }))}><option value="">الفرع</option>{branches.map((branch) => <option key={branch.id} value={branch.id}>{branch.name}</option>)}</select>
          <select className="form-select" value={filters.status} onChange={(event) => setFilters((prev) => ({ ...prev, status: event.target.value }))}><option value="">الحالة</option><option value="active">نشط</option><option value="inactive">معطل</option></select>
          <input className="form-input" placeholder="المدينة / المنطقة" value={filters.city} onChange={(event) => setFilters((prev) => ({ ...prev, city: event.target.value }))} />
          <label className="flex items-center gap-2 text-sm px-2"><input type="checkbox" checked={filters.onlyWithBalance} onChange={(event) => setFilters((prev) => ({ ...prev, onlyWithBalance: event.target.checked }))} />فقط أصحاب الرصيد</label>
          <button type="button" className="toolbar-btn primary" onClick={() => void load()}>تطبيق</button>
          <button type="button" className="toolbar-btn" onClick={() => setFilters({ search: '', branchId: '', status: '', city: '', onlyWithBalance: false })}>إعادة ضبط</button>
        </div>
      </div>

      <div className="card flex-1 overflow-auto">
        {error ? <div className="text-sm text-red-700 mb-2">{error}</div> : null}
        {success ? <div className="text-sm text-emerald-700 mb-2">{success}</div> : null}
        <table className="data-grid">
          <thead><tr><th>#</th><th>كود الوكيل</th><th>اسم الوكيل</th><th>الهاتف</th><th>الوجهة</th><th>الفرع</th><th>الحالة</th><th>الشحنات</th><th>قيد الطريق</th><th>مسلمة</th><th>الرصيد</th><th>اتجاه الرصيد</th><th>إجراءات</th></tr></thead>
          <tbody>
            {rows.map((row, index) => (
              <tr key={row.id}>
                <td>{index + 1}</td><td>{row.code}</td><td>{row.name}</td><td>{row.phone || '-'}</td><td>{[row.governorate, row.city, row.area].filter(Boolean).join(' / ') || '-'}</td><td>{row.branchName}</td><td>{row.is_active ? 'نشط' : 'معطل'}</td><td>{row.totalShipments}</td><td>{row.inTransit}</td><td>{row.delivered}</td><td>{row.balance.toLocaleString()}</td><td>{row.balanceDirection}</td>
                <td>
                  <div className="flex flex-wrap gap-2 text-xs">
                    <Link to={`/agents/${row.id}`}>ملف الوكيل</Link>
                    <button type="button" className="text-indigo-700" onClick={() => void openAgentStatement(row, 'financial')}>كشف مالي للوكيل</button>
                    <button type="button" className="text-indigo-700" onClick={() => void openAgentStatement(row, 'account')}>كشف حساب شامل</button>
                    <button type="button" className="text-indigo-700" onClick={() => beginEdit(row)}>تعديل</button>
                    <button type="button" className="text-amber-700" onClick={() => void toggleAgent(row)}>{row.is_active ? 'تعطيل' : 'تفعيل'}</button>
                  </div>
                </td>
              </tr>
            ))}
            {!loading && rows.length === 0 ? <tr><td colSpan={13} className="text-center p-6 text-gray-500">لا توجد بيانات بعد. ابدأ بإضافة وكيل جديد.</td></tr> : null}
          </tbody>
        </table>
      </div>
      {statementLoading ? <div className="fixed inset-0 z-50 grid place-items-center bg-black/30 text-white">جاري تحميل الكشف...</div> : null}
      {statementModal ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <div className="bg-white rounded-lg shadow-xl w-full max-w-6xl max-h-[90vh] overflow-auto">
            <div className="flex items-center justify-between border-b p-4">
              <h3 className="font-bold text-lg">{statementModal.title}</h3>
              <button type="button" className="toolbar-btn" onClick={() => setStatementModal(null)}>إغلاق</button>
            </div>
            <div className="p-4 space-y-4">
              <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
                <div className="stat-card"><div className="stat-value text-sm">{dateText(statementModal.data.generatedAt)}</div><div className="stat-label">تاريخ استخراج الكشف</div></div>
                <div className="stat-card"><div className="stat-value text-sm">{dateText(statementModal.data.lastReconciliation?.reconciled_at)}</div><div className="stat-label">تاريخ آخر مطابقة</div></div>
                <div className="stat-card"><div className="stat-value">{money(statementModal.data.lastReconciliation?.balance_amount, statementModal.data.lastReconciliation?.currency_code || 'USD')}</div><div className="stat-label">رصيد آخر مطابقة</div></div>
                <div className="stat-card flex flex-col justify-center gap-2">
                  <button type="button" className="toolbar-btn success" disabled={reconciliationSaving} onClick={() => void saveAgentReconciliation()}>
                    {reconciliationSaving ? 'جاري الحفظ...' : 'حفظ مطابقة حتى الآن'}
                  </button>
                </div>
              </div>
              {statementModal.kind === 'financial' ? (
                <>
                  <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
                    <div className="stat-card"><div className="stat-value">{statementModal.data.summary.shipmentsCount}</div><div className="stat-label">شحنات</div></div>
                    <div className="stat-card"><div className="stat-value">{statementModal.data.summary.transfersCount}</div><div className="stat-label">حوالات</div></div>
                    <div className="stat-card"><div className="stat-value">{money(statementModal.data.summary.totalShipmentCommission)}</div><div className="stat-label">عمولة الشحن</div></div>
                    <div className="stat-card"><div className="stat-value">{money(statementModal.data.summary.totalTransferCommission)}</div><div className="stat-label">عمولة الحوالات</div></div>
                    <div className="stat-card"><div className="stat-value">{money(statementModal.data.summary.netVoucherBalance)}</div><div className="stat-label">صافي السندات</div></div>
                  </div>
                  <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                    <div className="stat-card"><div className="stat-value">{Number(statementModal.data.agent.commission_percentage || 0)}%</div><div className="stat-label">نسبة عمولة الوكيل الحالية</div></div>
                    <div className="stat-card"><div className="stat-value">{money(statementModal.data.summary.sinceLastReconciliation?.totalAgentCommission)}</div><div className="stat-label">عمولة بعد آخر مطابقة</div></div>
                    <div className="stat-card"><div className="stat-value">{money(statementModal.data.summary.sinceLastReconciliation?.paidToAgent)}</div><div className="stat-label">مدفوع للوكيل بعد المطابقة</div></div>
                    <div className="stat-card"><div className="stat-value font-bold">{money(statementModal.data.summary.sinceLastReconciliation?.netAgentDue)}</div><div className="stat-label">مستحق للوكيل حتى الآن</div></div>
                  </div>
                  <section>
                    <h4 className="font-bold mb-2">تفاصيل عمولات الشحن</h4>
                    <table className="data-grid text-sm">
                      <thead><tr><th>التاريخ</th><th>رقم الشحنة</th><th>المرسل</th><th>المستلم</th><th>الوجهة</th><th>أجرة الشحن</th><th>النسبة</th><th>العمولة</th><th>الحالة</th></tr></thead>
                      <tbody>
                        {statementModal.data.shipments.map((s: any) => (
                          <tr key={s.id}><td>{String(s.created_at).split('T')[0]}</td><td>{s.shipment_no}</td><td>{s.sender_name ?? '-'}</td><td>{s.receiver_name ?? '-'}</td><td>{s.destination_city ?? '-'}</td><td>{money(s.freight_charge, s.original_currency)}</td><td>{Number(s.agent_commission_percentage_snapshot || 0)}%</td><td>{money(s.agent_commission_amount_snapshot, s.original_currency)}</td><td>{s.status}</td></tr>
                        ))}
                      </tbody>
                    </table>
                  </section>
                  <section>
                    <h4 className="font-bold mb-2">الحوالات والسندات المرتبطة</h4>
                    <table className="data-grid text-sm">
                      <thead><tr><th>النوع</th><th>التاريخ</th><th>المرجع</th><th>البيان</th><th>المبلغ</th><th>العمولة</th><th>الحالة</th></tr></thead>
                      <tbody>
                        {statementModal.data.transfers.map((t: any) => (
                          <tr key={`t-${t.id}`}><td>حوالة</td><td>{String(t.transfer_date || t.created_at).split('T')[0]}</td><td>{t.shipment_no ?? '-'}</td><td>{t.sender_name} / {t.receiver_name}</td><td>{money(t.amount, t.currency)}</td><td>{money(t.agent_commission, t.agent_commission_currency)}</td><td>{t.status}</td></tr>
                        ))}
                        {statementModal.data.vouchers.map((v: any) => (
                          <tr key={`v-${v.id}`}><td>{v.voucher_kind === 'receipt' ? 'سند قبض' : 'سند دفع'}</td><td>{String(v.created_at).split('T')[0]}</td><td>{v.voucher_no}</td><td>{v.notes ?? '-'}</td><td>{money(v.original_amount, v.original_currency)}</td><td>-</td><td>{v.status}</td></tr>
                        ))}
                      </tbody>
                    </table>
                  </section>
                </>
              ) : (
                <>
                  <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                    <div className="stat-card"><div className="stat-value">{statementModal.data.summary.rowsCount}</div><div className="stat-label">حركة</div></div>
                    <div className="stat-card"><div className="stat-value text-green-700">{money(statementModal.data.summary.totalDebit)}</div><div className="stat-label">مدين</div></div>
                    <div className="stat-card"><div className="stat-value text-red-700">{money(statementModal.data.summary.totalCredit)}</div><div className="stat-label">دائن</div></div>
                    <div className="stat-card"><div className="stat-value font-bold">{money(statementModal.data.summary.netAgentDue)}</div><div className="stat-label">مستحق للوكيل</div></div>
                  </div>
                  <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                    <div className="stat-card"><div className="stat-value">{statementModal.data.summary.sinceLastReconciliation?.rowsCount ?? 0}</div><div className="stat-label">حركات بعد آخر مطابقة</div></div>
                    <div className="stat-card"><div className="stat-value text-green-700">{money(statementModal.data.summary.sinceLastReconciliation?.totalDebit)}</div><div className="stat-label">مدين بعد المطابقة</div></div>
                    <div className="stat-card"><div className="stat-value text-red-700">{money(statementModal.data.summary.sinceLastReconciliation?.totalCredit)}</div><div className="stat-label">دائن بعد المطابقة</div></div>
                    <div className="stat-card"><div className="stat-value font-bold">{money(statementModal.data.summary.sinceLastReconciliation?.netAgentDue)}</div><div className="stat-label">مستحق بعد آخر مطابقة</div></div>
                  </div>
                  <table className="data-grid text-sm">
                    <thead><tr><th>التاريخ</th><th>المصدر</th><th>المرجع</th><th>البيان</th><th>الطرف</th><th>مدين</th><th>دائن</th><th>العملة</th><th>الحالة</th></tr></thead>
                    <tbody>
                      {statementModal.data.rows.map((r: any) => (
                        <tr key={`${r.source_type}-${r.source_id}-${r.at}`}><td>{String(r.at).split('T')[0]}</td><td>{sourceLabel(r.source_type)}</td><td>{r.reference_no ?? '-'}</td><td>{r.description ?? '-'}</td><td>{r.party_name ?? '-'}</td><td>{Number(r.debit || 0).toLocaleString()}</td><td>{Number(r.credit || 0).toLocaleString()}</td><td>{r.currency_code}</td><td>{r.status}</td></tr>
                      ))}
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
