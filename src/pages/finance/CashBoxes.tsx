import { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { formatCurrency, type CurrencyCode } from '../../lib/currency/currency';
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
  const [branches, setBranches] = useState<BranchOpt[]>([]);
  const [agents, setAgents] = useState<AgentOpt[]>([]);

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
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h2 className="text-xl font-bold">الصناديق</h2>
          <p className="text-sm text-gray-600 mt-1">
            النموذج المعتمد: <strong>الصندوق العام</strong>، و<strong>صندوق لكل وكيل</strong>، و<strong>صندوق فرع حلب</strong> (BR-ALEPPO) فقط.
            صناديق الوكلاء وفرع حلب مرتبطة بالصندوق العام للتجميع والتقارير؛ الحركات تُسجّل في الصندوق الذي تختاره عند السند.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          {canManage && !isAgent && (
            <button type="button" className="toolbar-btn primary" onClick={openAdd}>
              إضافة صندوق
            </button>
          )}
          <button type="button" className="toolbar-btn" onClick={() => void load()}>
            تحديث
          </button>
          <button type="button" className="toolbar-btn" onClick={exportCsv}>
            تصدير CSV
          </button>
          <button type="button" className="toolbar-btn" onClick={() => void exportPdf()}>
            تصدير PDF
          </button>
          <button type="button" className="toolbar-btn" onClick={() => window.print()}>
            طباعة
          </button>
        </div>
      </div>

      <div className="card">
        <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-6 gap-3">
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
              onClick={() => {
                setAppliedSearch(search.trim());
              }}
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
      </div>

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

      <div className="card text-sm text-gray-700 leading-relaxed border border-indigo-100 bg-indigo-50/60">
        <strong className="text-indigo-900">ربط الصناديق بالصندوق العام:</strong>{' '}
        عند إنشاء وكيل جديد يُنشأ له صندوق USD تلقائياً ويُربَط بالصندوق العام.
        صندوق فرع إضافي مسموح فقط لفرع حلب الرئيسي. لعرض حركات الصندوق العام والفرعية استخدم «حركات» لكل صندوق.
      </div>

      <div className="card overflow-auto">
        {loading ? (
          <div className="p-6 text-center text-gray-500">جاري التحميل...</div>
        ) : filteredStatic.length === 0 ? (
          <div className="p-8 text-center text-gray-600">{emptyMessage}</div>
        ) : (
          <table className="data-grid">
            <thead>
              <tr>
                <th>#</th>
                <th>كود الصندوق</th>
                <th>اسم الصندوق</th>
                <th>نوع الصندوق</th>
                <th>التجميع (الأب)</th>
                <th>الفرع</th>
                <th>الوكيل</th>
                <th>العملة</th>
                <th>الرصيد الافتتاحي</th>
                <th>الرصيد الحالي</th>
                <th>الحالة</th>
                <th>آخر تحديث</th>
                <th>إجراءات</th>
              </tr>
            </thead>
            <tbody>
              {filteredStatic.map((r, idx) => (
                <tr key={r.id}>
                  <td>{idx + 1}</td>
                  <td>{r.code}</td>
                  <td>{r.name}</td>
                  <td>{TYPE_LABEL[r.type] ?? r.type}</td>
                  <td className="text-xs text-gray-700 max-w-[180px]">
                    {r.parent_cashbox_name ? (
                      <span title={r.parent_cashbox_code ?? ''}>{r.parent_cashbox_name}</span>
                    ) : (
                      '—'
                    )}
                  </td>
                  <td>{r.branch_name ?? '—'}</td>
                  <td>{r.agent_name ?? '—'}</td>
                  <td>{r.currency_code}</td>
                  <td className="text-left">{formatCurrency(Number(r.opening_balance), r.currency_code as CurrencyCode)}</td>
                  <td className="text-left">{formatCurrency(Number(r.current_balance), r.currency_code as CurrencyCode)}</td>
                  <td>
                    <span className={r.is_active ? 'status-badge bg-green-100 text-green-800' : 'status-badge bg-gray-100 text-gray-800'}>
                      {r.is_active ? 'نشط' : 'موقوف'}
                    </span>
                  </td>
                  <td>{r.updated_at?.split('T')[0] ?? '—'}</td>
                  <td>
                    <div className="flex flex-wrap gap-1">
                      <button type="button" className="toolbar-btn text-xs py-1" onClick={() => navigate(`/finance/cashboxes/${r.id}/movements`)}>
                        حركات
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
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
