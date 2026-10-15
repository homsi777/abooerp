import { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { formatCurrency, type CurrencyCode } from '../../lib/currency/currency';
import { formatWesternNumber } from '../../lib/format/westernDigits';
import { phase3FinanceGateway, type BackendCashboxRecord } from '../../lib/api/phase3FinanceGateway';
import { phase15Gateway } from '../../lib/api/phase15Gateway';
import { httpClient } from '../../lib/api/httpClient';
import { useToast } from '../../components/Toast';
import { useAuth } from '../../context/AuthProvider';
import { downloadCsv } from '../../lib/export/csvDownload';
import { exportPdfTable } from '../../lib/export/pdfExport';

const TYPE_LABEL: Record<string, string> = {
  COMPANY: 'صندوق الشركة',
  BRANCH: 'صندوق الفرع',
  AGENT: 'صندوق الوكيل',
};

const TYPE_ICON: Record<string, string> = {
  COMPANY: '🏛️',
  BRANCH: '🏢',
  AGENT: '🧑‍💼',
};

const TYPE_STYLE: Record<string, { accent: string; chipBg: string; chipText: string }> = {
  COMPANY: { accent: '#7c3aed', chipBg: '#f3e8ff', chipText: '#6b21a8' },
  BRANCH: { accent: '#4f46e5', chipBg: '#e0e7ff', chipText: '#3730a3' },
  AGENT: { accent: '#0d9488', chipBg: '#ccfbf1', chipText: '#0f766e' },
};

type BranchOpt = { id: string; name: string };
type AgentOpt = { id: string; name: string };

export default function FinanceCashBoxes() {
  const navigate = useNavigate();
  const { showToast } = useToast();
  const { user, hasPermission } = useAuth();
  const canManage = hasPermission('finance.cashboxes.manage');
  const isAgent = user?.userType === 'agent';

  const [rows, setRows] = useState<BackendCashboxRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState(false);
  const [branches, setBranches] = useState<BranchOpt[]>([]);
  const [agents, setAgents] = useState<AgentOpt[]>([]);
  const [filtersOpen, setFiltersOpen] = useState(false);

  const [search, setSearch] = useState('');
  const [appliedSearch, setAppliedSearch] = useState('');
  const [typeFilter, setTypeFilter] = useState<string>('');
  const [branchFilter, setBranchFilter] = useState('');
  const [agentFilter, setAgentFilter] = useState('');
  const [currencyFilter, setCurrencyFilter] = useState('');
  const [activeFilter, setActiveFilter] = useState<string>('');

  const [showForm, setShowForm] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState({
    code: '',
    name: '',
    type: 'COMPANY' as 'COMPANY' | 'BRANCH' | 'AGENT',
    currencyCode: 'USD' as CurrencyCode,
    branchId: '',
    agentId: '',
    openingBalance: 0,
    isActive: true,
    notes: '',
  });

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const q: Record<string, string | undefined> = {};
      if (appliedSearch.trim()) q.search = appliedSearch.trim();
      if (typeFilter) q.type = typeFilter;
      if (branchFilter) q.branchId = branchFilter;
      if (agentFilter) q.agentId = agentFilter;
      if (currencyFilter) q.currencyCode = currencyFilter;
      if (activeFilter === 'true' || activeFilter === 'false') q.isActive = activeFilter;

      const data = await phase3FinanceGateway.cashbox.listMaster(q);
      setRows(data);
    } catch {
      showToast('تعذر تحميل الصناديق', 'error');
    } finally {
      setLoading(false);
    }
  }, [showToast, appliedSearch, typeFilter, branchFilter, agentFilter, currencyFilter, activeFilter]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    if (isAgent) return;
    const loadRefs = async () => {
      try {
        const [br, ag] = await Promise.all([
          phase15Gateway.branches.getAll(),
          httpClient.get<Array<{ id: string; name: string }>>('/agents'),
        ]);
        setBranches(br.map((b) => ({ id: String(b.id), name: b.name })));
        setAgents(ag.map((a) => ({ id: a.id, name: a.name })));
      } catch {
        /* optional filters */
      }
    };
    void loadRefs();
  }, [isAgent]);

  const filteredStatic = useMemo(() => rows, [rows]);

  const summary = useMemo(() => {
    const active = filteredStatic.filter((r) => r.is_active);
    const byCurrency = new Map<string, number>();
    for (const r of active) {
      const cur = r.currency_code;
      byCurrency.set(cur, (byCurrency.get(cur) ?? 0) + Number(r.current_balance));
    }
    return {
      total: filteredStatic.length,
      activeCount: active.length,
      inactiveCount: filteredStatic.length - active.length,
      byCurrency: Array.from(byCurrency.entries()),
    };
  }, [filteredStatic]);

  const resetForm = () => {
    setEditingId(null);
    setForm({
      code: '',
      name: '',
      type: 'COMPANY',
      currencyCode: 'USD',
      branchId: '',
      agentId: '',
      openingBalance: 0,
      isActive: true,
      notes: '',
    });
  };

  const runSync = async () => {
    setSyncing(true);
    try {
      const stats = await phase3FinanceGateway.cashbox.sync();
      showToast(
        `مزامنة: ${stats.created} صندوق جديد، ${stats.reassigned} نقل، ${stats.linked} ربط، ${stats.balancesReconciled} رصيد`,
        'success',
      );
      await load();
    } catch {
      showToast('تعذر مزامنة الصناديق', 'error');
    } finally {
      setSyncing(false);
    }
  };

  const openAdd = () => {
    resetForm();
    setShowForm(true);
  };

  const openEdit = (r: BackendCashboxRecord) => {
    setEditingId(r.id);
    setForm({
      code: r.code,
      name: r.name,
      type: r.type,
      currencyCode: r.currency_code as CurrencyCode,
      branchId: r.branch_id ?? '',
      agentId: r.agent_id ?? '',
      openingBalance: Number(r.opening_balance),
      isActive: r.is_active,
      notes: r.notes ?? '',
    });
    setShowForm(true);
  };

  const handleSaveCashbox = async () => {
    if (!form.code.trim() || !form.name.trim()) {
      showToast('الكود والاسم مطلوبان', 'error');
      return;
    }
    if (form.type === 'AGENT' && !form.agentId) {
      showToast('صندوق الوكيل يتطلب اختيار الوكيل', 'error');
      return;
    }
    if (form.type === 'BRANCH' && !form.branchId) {
      showToast('صندوق الفرع يتطلب اختيار الفرع', 'error');
      return;
    }
    try {
      const payload = {
        code: form.code.trim(),
        name: form.name.trim(),
        type: form.type,
        currencyCode: form.currencyCode,
        branchId: form.type === 'COMPANY' ? undefined : form.branchId || undefined,
        agentId: form.type === 'AGENT' ? form.agentId : undefined,
        openingBalance: form.openingBalance,
        isActive: form.isActive,
        notes: form.notes || undefined,
      };
      if (editingId) {
        await phase3FinanceGateway.cashbox.update(editingId, payload);
        showToast('تم تحديث الصندوق', 'success');
      } else {
        await phase3FinanceGateway.cashbox.create(payload);
        showToast('تم إنشاء الصندوق', 'success');
      }
      setShowForm(false);
      resetForm();
      await load();
    } catch (e) {
      showToast(e instanceof Error ? e.message : 'تعذر حفظ الصندوق', 'error');
    }
  };

  const toggleActive = async (r: BackendCashboxRecord) => {
    if (!canManage) return;
    try {
      await phase3FinanceGateway.cashbox.update(r.id, { isActive: !r.is_active });
      showToast(r.is_active ? 'تم تعطيل الصندوق' : 'تم تفعيل الصندوق', 'success');
      await load();
    } catch {
      showToast('تعذر تحديث الحالة', 'error');
    }
  };

  const exportCsv = () => {
    downloadCsv(
      `cashboxes-${Date.now()}.csv`,
      ['code', 'name', 'type', 'parent', 'branch', 'agent', 'currency', 'opening', 'current', 'active'],
      filteredStatic.map((r) => [
        r.code,
        r.name,
        TYPE_LABEL[r.type] ?? r.type,
        r.parent_cashbox_name ?? '',
        r.branch_name ?? '',
        r.agent_name ?? '',
        r.currency_code,
        r.opening_balance,
        r.current_balance,
        r.is_active ? 'نعم' : 'لا',
      ]),
    );
    showToast('تم تصدير CSV', 'success');
  };

  const exportPdf = async () => {
    const subtitleParts: string[] = [];
    if (appliedSearch.trim()) subtitleParts.push(`بحث: ${appliedSearch.trim()}`);
    if (typeFilter) subtitleParts.push(`النوع: ${TYPE_LABEL[typeFilter] ?? typeFilter}`);
    if (branchFilter) subtitleParts.push(`الفرع: ${branches.find((b) => b.id === branchFilter)?.name ?? branchFilter}`);
    if (agentFilter) subtitleParts.push(`الوكيل: ${agents.find((a) => a.id === agentFilter)?.name ?? agentFilter}`);
    if (currencyFilter) subtitleParts.push(`العملة: ${currencyFilter}`);
    if (activeFilter) subtitleParts.push(`الحالة: ${activeFilter === 'true' ? 'نشط' : 'موقوف'}`);
    const subtitle = subtitleParts.length ? subtitleParts.join(' | ') : undefined;

    const result = await exportPdfTable({
      title: 'الصناديق',
      subtitle,
      defaultFileName: `cashboxes-${new Date().toISOString().split('T')[0]}.pdf`,
      headers: ['الكود', 'الاسم', 'النوع', 'الأب', 'الفرع', 'الوكيل', 'العملة', 'افتتاحي', 'حالي', 'نشط'],
      rows: filteredStatic.map((r) => [
        r.code,
        r.name,
        TYPE_LABEL[r.type] ?? r.type,
        r.parent_cashbox_name ?? '',
        r.branch_name ?? '',
        r.agent_name ?? '',
        r.currency_code,
        formatCurrency(Number(r.opening_balance), r.currency_code as CurrencyCode),
        formatCurrency(Number(r.current_balance), r.currency_code as CurrencyCode),
        r.is_active ? 'نعم' : 'لا',
      ]),
    });

    if (result.saved) showToast('تم حفظ ملف PDF', 'success');
    else if (result.message !== 'cancelled') showToast('تعذر إنشاء PDF', 'error');
  };

  const emptyMessage = isAgent
    ? 'لا يوجد صندوق مرتبط بهذا الوكيل حالياً. يرجى مراجعة المدير العام.'
    : 'لا توجد صناديق بعد. ابدأ بإضافة صندوق جديد.';

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '20px', paddingBottom: '24px' }}>
      {/* ───────── Header ───────── */}
      <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'flex-start', justifyContent: 'space-between', gap: '12px' }}>
        <div>
          <h1 style={{ fontSize: '22px', fontWeight: 800, color: '#111827', margin: '0 0 4px' }}>💵 الصناديق</h1>
          <p style={{ fontSize: '13px', color: '#6b7280', margin: 0, maxWidth: '560px', lineHeight: 1.6 }}>
            النموذج المعتمد: الصندوق العام، وصندوق لكل وكيل، وصندوق واحد لفرع حلب الرئيسي — جميعها مرتبطة بالصندوق العام.
          </p>
        </div>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px' }}>
          {canManage && !isAgent && (
            <button type="button" className="toolbar-btn" onClick={() => void runSync()} disabled={syncing}>
              {syncing ? '⏳ مزامنة...' : '🔄 مزامنة وربط'}
            </button>
          )}
          {canManage && !isAgent && (
            <button type="button" className="toolbar-btn primary" onClick={openAdd}>
              ＋ إضافة صندوق
            </button>
          )}
          <button type="button" className="toolbar-btn" onClick={() => void load()}>
            تحديث
          </button>
          <button type="button" className="toolbar-btn" onClick={exportCsv}>
            CSV
          </button>
          <button type="button" className="toolbar-btn" onClick={() => void exportPdf()}>
            PDF
          </button>
          <button type="button" className="toolbar-btn" onClick={() => window.print()}>
            طباعة
          </button>
        </div>
      </div>

      {/* ───────── Summary strip ───────── */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: '12px' }}>
        <div style={summaryCardStyle('#4f46e5')}>
          <div style={summaryLabelStyle}>إجمالي الصناديق</div>
          <div style={summaryValueStyle('#312e81')}>{formatWesternNumber(summary.total)}</div>
        </div>
        <div style={summaryCardStyle('#16a34a')}>
          <div style={summaryLabelStyle}>نشطة</div>
          <div style={summaryValueStyle('#166534')}>{formatWesternNumber(summary.activeCount)}</div>
        </div>
        <div style={summaryCardStyle('#9ca3af')}>
          <div style={summaryLabelStyle}>موقوفة</div>
          <div style={summaryValueStyle('#374151')}>{formatWesternNumber(summary.inactiveCount)}</div>
        </div>
        {summary.byCurrency.map(([cur, total]) => (
          <div key={cur} style={summaryCardStyle(total >= 0 ? '#16a34a' : '#dc2626')}>
            <div style={summaryLabelStyle}>إجمالي الرصيد ({cur})</div>
            <div style={summaryValueStyle(total >= 0 ? '#166534' : '#991b1b')}>
              {formatCurrency(total, cur as CurrencyCode)}
            </div>
          </div>
        ))}
      </div>

      {/* ───────── Filters (collapsible) ───────── */}
      <div className="card">
        <button
          type="button"
          onClick={() => setFiltersOpen((v) => !v)}
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            width: '100%',
            background: 'none',
            border: 'none',
            cursor: 'pointer',
            padding: 0,
            fontSize: '14px',
            fontWeight: 700,
            color: '#374151',
          }}
        >
          <span>🔍 بحث وتصفية</span>
          <span style={{ color: '#9ca3af', fontSize: '12px' }}>{filtersOpen ? 'إخفاء ▲' : 'إظهار ▼'}</span>
        </button>
        {filtersOpen && (
          <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-6 gap-3" style={{ marginTop: '14px' }}>
            <input
              className="form-input"
              placeholder="بحث عام (كود / اسم)..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
            {!isAgent && (
              <select className="form-select" value={typeFilter} onChange={(e) => setTypeFilter(e.target.value)}>
                <option value="">نوع الصندوق — الكل</option>
                <option value="COMPANY">صندوق الشركة</option>
                <option value="BRANCH">صندوق الفرع</option>
                <option value="AGENT">صندوق الوكيل</option>
              </select>
            )}
            {!isAgent && (
              <select className="form-select" value={branchFilter} onChange={(e) => setBranchFilter(e.target.value)}>
                <option value="">الفرع — الكل</option>
                {branches.map((b) => (
                  <option key={b.id} value={b.id}>
                    {b.name}
                  </option>
                ))}
              </select>
            )}
            {!isAgent && (
              <select className="form-select" value={agentFilter} onChange={(e) => setAgentFilter(e.target.value)}>
                <option value="">الوكيل — الكل</option>
                {agents.map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.name}
                  </option>
                ))}
              </select>
            )}
            <select className="form-select" value={currencyFilter} onChange={(e) => setCurrencyFilter(e.target.value)}>
              <option value="">العملة — الكل</option>
              <option value="USD">USD</option>
              <option value="SYP">SYP</option>
              <option value="TRY">TRY</option>
            </select>
            <select className="form-select" value={activeFilter} onChange={(e) => setActiveFilter(e.target.value)}>
              <option value="">الحالة — الكل</option>
              <option value="true">نشط</option>
              <option value="false">موقوف</option>
            </select>
            <div className="flex gap-2 items-center">
              <button
                type="button"
                className="toolbar-btn primary text-sm"
                onClick={() => setAppliedSearch(search.trim())}
              >
                تطبيق
              </button>
              <button
                type="button"
                className="toolbar-btn text-sm"
                onClick={() => {
                  setSearch('');
                  setAppliedSearch('');
                  setTypeFilter('');
                  setBranchFilter('');
                  setAgentFilter('');
                  setCurrencyFilter('');
                  setActiveFilter('');
                }}
              >
                إعادة ضبط
              </button>
            </div>
          </div>
        )}
      </div>

      {/* ───────── Add/Edit form ───────── */}
      {showForm && canManage && !isAgent && (
        <div className="card print:hidden">
          <div className="card-header">{editingId ? 'تعديل صندوق' : 'صندوق جديد'}</div>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <div className="form-group">
              <label className="form-label">كود الصندوق</label>
              <input className="form-input w-full" value={form.code} onChange={(e) => setForm({ ...form, code: e.target.value })} />
            </div>
            <div className="form-group">
              <label className="form-label">اسم الصندوق</label>
              <input className="form-input w-full" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
            </div>
            <div className="form-group">
              <label className="form-label">نوع الصندوق</label>
              <select
                className="form-select w-full"
                value={form.type}
                onChange={(e) =>
                  setForm({ ...form, type: e.target.value as typeof form.type, branchId: '', agentId: '' })
                }
              >
                <option value="COMPANY">صندوق الشركة</option>
                <option value="BRANCH">صندوق الفرع</option>
                <option value="AGENT">صندوق الوكيل</option>
              </select>
            </div>
            <div className="form-group">
              <label className="form-label">العملة</label>
              <select
                className="form-select w-full"
                value={form.currencyCode}
                onChange={(e) => setForm({ ...form, currencyCode: e.target.value as CurrencyCode })}
              >
                <option value="USD">USD</option>
                <option value="SYP">SYP</option>
                <option value="TRY">TRY</option>
              </select>
            </div>
            {form.type === 'BRANCH' && (
              <div className="form-group">
                <label className="form-label">الفرع</label>
                <select
                  className="form-select w-full"
                  value={form.branchId}
                  onChange={(e) => setForm({ ...form, branchId: e.target.value })}
                >
                  <option value="">—</option>
                  {branches.map((b) => (
                    <option key={b.id} value={b.id}>
                      {b.name}
                    </option>
                  ))}
                </select>
              </div>
            )}
            {form.type === 'AGENT' && (
              <div className="form-group">
                <label className="form-label">الوكيل</label>
                <select
                  className="form-select w-full"
                  value={form.agentId}
                  onChange={(e) => setForm({ ...form, agentId: e.target.value })}
                >
                  <option value="">—</option>
                  {agents.map((a) => (
                    <option key={a.id} value={a.id}>
                      {a.name}
                    </option>
                  ))}
                </select>
              </div>
            )}
            <div className="form-group">
              <label className="form-label">الرصيد الافتتاحي</label>
              <input
                type="number"
                step="0.01"
                className="form-input w-full"
                value={form.openingBalance}
                onChange={(e) => setForm({ ...form, openingBalance: Number(e.target.value) })}
              />
            </div>
            <div className="form-group flex items-end gap-2">
              <label className="flex items-center gap-2 cursor-pointer">
                <input
                  type="checkbox"
                  checked={form.isActive}
                  onChange={(e) => setForm({ ...form, isActive: e.target.checked })}
                />
                نشط
              </label>
            </div>
            <div className="form-group md:col-span-2">
              <label className="form-label">ملاحظات</label>
              <input className="form-input w-full" value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} />
            </div>
          </div>
          <div className="flex gap-2 mt-3">
            <button type="button" className="toolbar-btn primary" onClick={() => void handleSaveCashbox()}>
              حفظ
            </button>
            <button
              type="button"
              className="toolbar-btn"
              onClick={() => {
                setShowForm(false);
                resetForm();
              }}
            >
              إلغاء
            </button>
          </div>
        </div>
      )}

      {/* ───────── Cards grid ───────── */}
      {loading ? (
        <div style={{ padding: '48px', textAlign: 'center', color: '#9ca3af' }}>جاري التحميل...</div>
      ) : filteredStatic.length === 0 ? (
        <div style={{ padding: '48px', textAlign: 'center', color: '#6b7280' }}>{emptyMessage}</div>
      ) : (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(300px, 1fr))', gap: '16px' }}>
          {filteredStatic.map((r) => {
            const style = TYPE_STYLE[r.type] ?? TYPE_STYLE.COMPANY;
            const balance = Number(r.current_balance);
            const balanceColor = !r.is_active ? '#9ca3af' : balance >= 0 ? '#166534' : '#991b1b';

            return (
              <div
                key={r.id}
                style={{
                  background: '#fff',
                  borderRadius: '16px',
                  border: '1px solid #e5e7eb',
                  borderInlineStart: `5px solid ${r.is_active ? style.accent : '#d1d5db'}`,
                  boxShadow: '0 1px 3px rgba(15,23,42,0.06)',
                  padding: '18px',
                  display: 'flex',
                  flexDirection: 'column',
                  gap: '12px',
                  opacity: r.is_active ? 1 : 0.72,
                  transition: 'transform 0.15s ease, box-shadow 0.15s ease',
                }}
                onMouseEnter={(e) => {
                  e.currentTarget.style.transform = 'translateY(-2px)';
                  e.currentTarget.style.boxShadow = '0 8px 20px rgba(15,23,42,0.1)';
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.transform = 'none';
                  e.currentTarget.style.boxShadow = '0 1px 3px rgba(15,23,42,0.06)';
                }}
              >
                {/* top row */}
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                  <span
                    style={{
                      display: 'inline-flex',
                      alignItems: 'center',
                      gap: '6px',
                      fontSize: '12px',
                      fontWeight: 700,
                      padding: '3px 10px',
                      borderRadius: '999px',
                      background: style.chipBg,
                      color: style.chipText,
                    }}
                  >
                    {TYPE_ICON[r.type] ?? '💵'} {TYPE_LABEL[r.type] ?? r.type}
                  </span>
                  <span
                    style={{
                      display: 'inline-flex',
                      alignItems: 'center',
                      gap: '5px',
                      fontSize: '11.5px',
                      fontWeight: 700,
                      color: r.is_active ? '#166534' : '#6b7280',
                    }}
                  >
                    <span
                      style={{
                        width: '7px',
                        height: '7px',
                        borderRadius: '50%',
                        background: r.is_active ? '#22c55e' : '#9ca3af',
                        display: 'inline-block',
                      }}
                    />
                    {r.is_active ? 'نشط' : 'موقوف'}
                  </span>
                </div>

                {/* name + code */}
                <div>
                  <div style={{ fontSize: '16.5px', fontWeight: 800, color: '#111827' }}>{r.name}</div>
                  <div style={{ fontSize: '11.5px', color: '#9ca3af', fontFamily: 'monospace', marginTop: '2px' }}>
                    {r.code}
                  </div>
                </div>

                {/* balance */}
                <div
                  style={{
                    background: '#f9fafb',
                    borderRadius: '10px',
                    padding: '10px 14px',
                    display: 'flex',
                    alignItems: 'baseline',
                    justifyContent: 'space-between',
                  }}
                >
                  <span style={{ fontSize: '11.5px', color: '#6b7280', fontWeight: 600 }}>الرصيد الحالي</span>
                  <span style={{ fontSize: '19px', fontWeight: 800, color: balanceColor }}>
                    {formatCurrency(balance, r.currency_code as CurrencyCode)}
                  </span>
                </div>

                {/* mini stats */}
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px', fontSize: '12px' }}>
                  <MiniStat label="افتتاحي" value={formatCurrency(Number(r.opening_balance), r.currency_code as CurrencyCode)} />
                  <MiniStat label="حركات نقدية" value={formatWesternNumber(Number(r.transaction_count ?? 0))} />
                  {r.type === 'AGENT' && r.agent_operational_net_usd != null && (
                    <MiniStat label="ذمة تشغيلية" value={formatCurrency(Number(r.agent_operational_net_usd), 'USD')} />
                  )}
                  {r.type === 'AGENT' && r.agent_shipment_count != null && (
                    <MiniStat label="شحنات" value={formatWesternNumber(Number(r.agent_shipment_count))} />
                  )}
                </div>

                {/* relations */}
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px', fontSize: '11.5px', color: '#4b5563' }}>
                  {r.branch_name && <Tag>🏢 {r.branch_name}</Tag>}
                  {r.agent_name && (
                    <Tag>
                      🧑‍💼 {r.agent_name}
                      {r.agent_governorate ? ` — ${r.agent_governorate}` : ''}
                    </Tag>
                  )}
                  {r.parent_cashbox_name && <Tag>⬆ {r.parent_cashbox_name}</Tag>}
                </div>

                <div style={{ fontSize: '11px', color: '#9ca3af' }}>آخر تحديث: {r.updated_at?.split('T')[0] ?? '—'}</div>

                {/* actions */}
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px', marginTop: 'auto', paddingTop: '6px', borderTop: '1px solid #f1f5f9' }}>
                  <button type="button" className="toolbar-btn text-xs py-1" onClick={() => navigate(`/finance/cashboxes/${r.id}/movements`)}>
                    كشف
                  </button>
                  <button
                    type="button"
                    className="toolbar-btn text-xs py-1"
                    onClick={() => navigate(`/finance/vouchers?cashboxId=${encodeURIComponent(r.id)}`)}
                  >
                    سند قبض
                  </button>
                  <button
                    type="button"
                    className="toolbar-btn text-xs py-1"
                    onClick={() => navigate(`/finance/vouchers?cashboxId=${encodeURIComponent(r.id)}&kind=payment`)}
                  >
                    سند دفع
                  </button>
                  {canManage && !isAgent && (
                    <>
                      <button type="button" className="toolbar-btn text-xs py-1" onClick={() => openEdit(r)}>
                        تعديل
                      </button>
                      <button type="button" className="toolbar-btn text-xs py-1" onClick={() => void toggleActive(r)}>
                        {r.is_active ? 'تعطيل' : 'تفعيل'}
                      </button>
                    </>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

function MiniStat({ label, value }: { label: string; value: string }) {
  return (
    <div style={{ background: '#f9fafb', borderRadius: '8px', padding: '6px 10px' }}>
      <div style={{ color: '#9ca3af', fontSize: '10.5px', fontWeight: 600 }}>{label}</div>
      <div style={{ color: '#1f2937', fontWeight: 700, marginTop: '2px' }}>{value}</div>
    </div>
  );
}

function Tag({ children }: { children: React.ReactNode }) {
  return (
    <span
      style={{
        background: '#f3f4f6',
        borderRadius: '999px',
        padding: '3px 9px',
        display: 'inline-flex',
        alignItems: 'center',
      }}
    >
      {children}
    </span>
  );
}

function summaryCardStyle(accent: string): React.CSSProperties {
  return {
    background: '#fff',
    border: '1px solid #e5e7eb',
    borderInlineStart: `4px solid ${accent}`,
    borderRadius: '12px',
    padding: '12px 16px',
  };
}

const summaryLabelStyle: React.CSSProperties = { fontSize: '11.5px', color: '#6b7280', fontWeight: 600, marginBottom: '4px' };

function summaryValueStyle(color: string): React.CSSProperties {
  return { fontSize: '18px', fontWeight: 800, color };
}
