import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { Building2, Plus, RefreshCw, Search, UserCheck, X } from 'lucide-react';
import { useToast } from '../../components/Toast';
import { EscapeModalScrim } from '../../context/EscapeRegistryContext';
import { useAuth } from '../../context/AuthProvider';
import { customersGateway, type CustomerCreateInput, type CustomerRecord } from '../../lib/api/customersGateway';
import { phase15Gateway } from '../../lib/api/phase15Gateway';
import type { Branch } from '../../types';

// ── Helpers ───────────────────────────────────────────────────────────────────

function customerTypeLabel(t: string) {
  return t === 'COMPANY' ? 'شركة' : 'فرد';
}

function statusBadge(s: string) {
  return s === 'active'
    ? <span className="px-2 py-0.5 rounded-full text-xs bg-green-100 text-green-700">نشط</span>
    : <span className="px-2 py-0.5 rounded-full text-xs bg-gray-100 text-gray-500">متوقف</span>;
}

// ── Form component ────────────────────────────────────────────────────────────

type FormState = {
  name: string;
  phone: string;
  second_phone: string;
  company_name: string;
  customer_type: 'INDIVIDUAL' | 'COMPANY';
  is_account_customer: boolean;
  credit_limit: string;
  default_currency_code: string;
  city: string;
  area: string;
  address: string;
  tax_number: string;
  notes: string;
  branch_id: string;
  agent_id: string;
  status: 'active' | 'inactive';
};

const emptyForm = (): FormState => ({
  name: '', phone: '', second_phone: '', company_name: '',
  customer_type: 'INDIVIDUAL', is_account_customer: false,
  credit_limit: '0', default_currency_code: 'SYP',
  city: '', area: '', address: '', tax_number: '', notes: '',
  branch_id: '', agent_id: '', status: 'active',
});

function CustomerForm({
  initial,
  branches,
  onSave,
  onCancel,
  saving,
}: {
  initial?: CustomerRecord;
  branches: Branch[];
  onSave: (data: CustomerCreateInput) => Promise<void>;
  onCancel: () => void;
  saving: boolean;
}) {
  const [f, setF] = useState<FormState>(() => {
    if (!initial) return emptyForm();
    return {
      name: initial.name,
      phone: initial.phone ?? '',
      second_phone: initial.second_phone ?? '',
      company_name: initial.company_name ?? '',
      customer_type: initial.customer_type,
      is_account_customer: initial.is_account_customer,
      credit_limit: String(initial.credit_limit ?? 0),
      default_currency_code: initial.default_currency_code ?? 'SYP',
      city: initial.city ?? '',
      area: initial.area ?? '',
      address: initial.address ?? '',
      tax_number: initial.tax_number ?? '',
      notes: initial.notes ?? '',
      branch_id: initial.branch_id ?? '',
      agent_id: initial.agent_id ?? '',
      status: initial.status,
    };
  });

  const upd = (field: keyof FormState, value: string | boolean) =>
    setF((prev) => ({ ...prev, [field]: value }));

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    await onSave({
      name: f.name.trim(),
      phone: f.phone.trim() || undefined,
      second_phone: f.second_phone.trim() || undefined,
      company_name: f.company_name.trim() || undefined,
      customer_type: f.customer_type,
      is_account_customer: f.is_account_customer,
      credit_limit: parseFloat(f.credit_limit) || 0,
      default_currency_code: f.default_currency_code || 'SYP',
      city: f.city.trim() || undefined,
      area: f.area.trim() || undefined,
      address: f.address.trim() || undefined,
      tax_number: f.tax_number.trim() || undefined,
      notes: f.notes.trim() || undefined,
      branch_id: f.branch_id || undefined,
      agent_id: f.agent_id || undefined,
      status: f.status,
    });
  };

  return (
    <form onSubmit={(e) => void handleSubmit(e)} className="space-y-4" dir="rtl">
      <div className="grid grid-cols-2 gap-4">
        {/* اسم العميل */}
        <div className="col-span-2">
          <label className="block text-sm font-medium text-gray-700 mb-1">اسم العميل *</label>
          <input className="form-input w-full" value={f.name} onChange={(e) => upd('name', e.target.value)} required />
        </div>

        {/* نوع العميل */}
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">نوع العميل</label>
          <select className="form-input w-full" value={f.customer_type} onChange={(e) => upd('customer_type', e.target.value)}>
            <option value="INDIVIDUAL">فرد</option>
            <option value="COMPANY">شركة / مؤسسة</option>
          </select>
        </div>

        {/* اسم الشركة */}
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">اسم الشركة / المؤسسة</label>
          <input className="form-input w-full" value={f.company_name} onChange={(e) => upd('company_name', e.target.value)}
            disabled={f.customer_type !== 'COMPANY'} placeholder={f.customer_type === 'COMPANY' ? 'اسم الشركة' : '—'} />
        </div>

        {/* الهاتف */}
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">الهاتف</label>
          <input className="form-input w-full" value={f.phone} onChange={(e) => upd('phone', e.target.value)} dir="ltr" placeholder="09XXXXXXXX" />
        </div>
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">هاتف إضافي</label>
          <input className="form-input w-full" value={f.second_phone} onChange={(e) => upd('second_phone', e.target.value)} dir="ltr" />
        </div>

        {/* المحافظة / المنطقة */}
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">المحافظة / المدينة</label>
          <input className="form-input w-full" value={f.city} onChange={(e) => upd('city', e.target.value)} placeholder="حلب" />
        </div>
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">المنطقة</label>
          <input className="form-input w-full" value={f.area} onChange={(e) => upd('area', e.target.value)} />
        </div>

        {/* العنوان */}
        <div className="col-span-2">
          <label className="block text-sm font-medium text-gray-700 mb-1">العنوان التفصيلي</label>
          <input className="form-input w-full" value={f.address} onChange={(e) => upd('address', e.target.value)} />
        </div>

        {/* الفرع */}
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">الفرع</label>
          <select className="form-input w-full" value={f.branch_id} onChange={(e) => upd('branch_id', e.target.value)}>
            <option value="">— لا فرع —</option>
            {branches.map((b) => (
              <option key={b.id} value={b.id}>{b.name}</option>
            ))}
          </select>
        </div>

        {/* الرقم الضريبي */}
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">الرقم الضريبي</label>
          <input className="form-input w-full" value={f.tax_number} onChange={(e) => upd('tax_number', e.target.value)} dir="ltr" />
        </div>

        {/* عميل حسابي */}
        <div className="col-span-2 rounded-lg border border-amber-200 bg-amber-50 p-3">
          <label className="flex items-center gap-3 cursor-pointer select-none">
            <input
              type="checkbox"
              checked={f.is_account_customer}
              onChange={(e) => upd('is_account_customer', e.target.checked)}
              className="w-4 h-4 rounded border-gray-300"
            />
            <span className="font-semibold text-amber-800">عميل حسابي (يظهر في الذمم المالية)</span>
          </label>
          <p className="text-xs text-amber-700 mt-1 mr-7">
            العميل الحسابي يمكن ربطه بمسؤولية مالية للشحنات ويظهر في مركز الدائن والمدين عند اختياره صراحةً.
          </p>
        </div>

        {f.is_account_customer && (
          <>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">حد الائتمان</label>
              <input className="form-input w-full" type="number" min="0" value={f.credit_limit}
                onChange={(e) => upd('credit_limit', e.target.value)} dir="ltr" />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">العملة الافتراضية</label>
              <select className="form-input w-full" value={f.default_currency_code} onChange={(e) => upd('default_currency_code', e.target.value)}>
                <option value="SYP">ليرة سورية (SYP)</option>
                <option value="USD">دولار أمريكي (USD)</option>
                <option value="TRY">ليرة تركية (TRY)</option>
              </select>
            </div>
          </>
        )}

        {/* الحالة */}
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">الحالة</label>
          <select className="form-input w-full" value={f.status} onChange={(e) => upd('status', e.target.value as 'active' | 'inactive')}>
            <option value="active">نشط</option>
            <option value="inactive">متوقف</option>
          </select>
        </div>

        {/* ملاحظات */}
        <div className="col-span-2">
          <label className="block text-sm font-medium text-gray-700 mb-1">ملاحظات</label>
          <textarea className="form-input w-full resize-none" rows={2} value={f.notes} onChange={(e) => upd('notes', e.target.value)} />
        </div>
      </div>

      {/* Divider notice */}
      <div className="text-xs text-gray-500 bg-gray-50 rounded p-2">
        الزبون السريع يستخدم كمرسل/مستلم فقط. العميل الحسابي يمكن ربطه بالذمم المالية عند الحاجة.
      </div>

      <div className="flex gap-3 justify-end pt-2">
        <button type="button" className="btn btn-secondary" onClick={onCancel} disabled={saving}>
          إلغاء
        </button>
        <button type="submit" className="btn btn-primary" disabled={saving || !f.name.trim()}>
          {saving ? 'جاري الحفظ...' : initial ? 'حفظ التغييرات' : 'إضافة العميل'}
        </button>
      </div>
    </form>
  );
}

// ── Main module ───────────────────────────────────────────────────────────────

type Filters = {
  search: string;
  customer_type: '' | 'INDIVIDUAL' | 'COMPANY';
  is_account_customer: '' | 'true' | 'false';
  city: string;
  branch_id: string;
  status: '' | 'active' | 'inactive';
};

const defaultFilters = (): Filters => ({
  search: '', customer_type: '', is_account_customer: '',
  city: '', branch_id: '', status: '',
});

export default function CustomersModule() {
  const { user } = useAuth();
  const { showToast } = useToast();
  const isAdmin = user?.userType === 'admin' || user?.roleCode === 'admin';

  const [customers, setCustomers] = useState<CustomerRecord[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(false);
  const [filters, setFilters] = useState<Filters>(defaultFilters);
  const [branches, setBranches] = useState<Branch[]>([]);

  const [showForm, setShowForm] = useState(false);
  const [editingCustomer, setEditingCustomer] = useState<CustomerRecord | undefined>();
  const [saving, setSaving] = useState(false);

  const LIMIT = 50;
  const totalPages = Math.max(1, Math.ceil(total / LIMIT));

  const load = useCallback(
    async (currentPage = page) => {
      setLoading(true);
      try {
        const res = await customersGateway.list({
          search: filters.search || undefined,
          customer_type: filters.customer_type || undefined,
          is_account_customer:
            filters.is_account_customer === 'true'
              ? true
              : filters.is_account_customer === 'false'
              ? false
              : undefined,
          city: filters.city || undefined,
          branch_id: filters.branch_id || undefined,
          status: (filters.status as 'active' | 'inactive') || undefined,
          page: currentPage,
          limit: LIMIT,
        });
        const data = Array.isArray(res) ? res : (res as any).data ?? [];
        const tot = Array.isArray(res) ? data.length : (res as any).total ?? data.length;
        setCustomers(data);
        setTotal(tot);
      } catch (err) {
        showToast(err instanceof Error ? err.message : 'تعذر تحميل العملاء', 'error');
      } finally {
        setLoading(false);
      }
    },
    [filters, page, showToast],
  );

  useEffect(() => {
    void load(1);
    setPage(1);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    phase15Gateway.branches.getAll().then(setBranches).catch(() => {});
  }, []);

  const handleApply = () => {
    setPage(1);
    void load(1);
  };

  const handleReset = () => {
    setFilters(defaultFilters());
    setPage(1);
    void load(1);
  };

  const handleSave = async (data: CustomerCreateInput) => {
    setSaving(true);
    try {
      if (editingCustomer) {
        await customersGateway.update(editingCustomer.id, data);
        showToast('تم تحديث بيانات العميل', 'success');
      } else {
        await customersGateway.create(data);
        showToast('تم إضافة العميل بنجاح', 'success');
      }
      setShowForm(false);
      setEditingCustomer(undefined);
      void load(page);
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'تعذر حفظ العميل', 'error');
    } finally {
      setSaving(false);
    }
  };

  const handleToggleStatus = async (customer: CustomerRecord) => {
    try {
      await customersGateway.toggleStatus(customer.id);
      showToast(`تم ${customer.status === 'active' ? 'تعطيل' : 'تفعيل'} العميل`, 'success');
      void load(page);
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'تعذر تغيير الحالة', 'error');
    }
  };

  const exportCsv = () => {
    if (!customers.length) return;
    const headers = ['الكود', 'الاسم', 'النوع', 'الشركة', 'الهاتف', 'المدينة', 'الفرع', 'الوكيل', 'حسابي؟', 'حد الائتمان', 'العملة', 'الحالة'];
    const rows = customers.map((c) => [
      c.code, c.name, customerTypeLabel(c.customer_type),
      c.company_name ?? '', c.phone ?? '', c.city ?? '',
      c.branch_name ?? '', c.agent_name ?? '',
      c.is_account_customer ? 'نعم' : 'لا',
      c.credit_limit, c.default_currency_code, c.status === 'active' ? 'نشط' : 'متوقف',
    ]);
    const csv = [headers, ...rows].map((r) => r.map((v) => `"${String(v).replace(/"/g, '""')}"`).join(',')).join('\n');
    const blob = new Blob(['\uFEFF' + csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = 'customers.csv'; a.click();
    URL.revokeObjectURL(url);
  };

  const canManage = useMemo(
    () => isAdmin || user?.permissions?.includes('customers.manage') || false,
    [isAdmin, user],
  );

  return (
    <div className="page-container" dir="rtl">
      {/* ── Header ── */}
      <div className="page-header">
        <div>
          <h1 className="page-title">العملاء</h1>
          <p className="page-subtitle">إدارة العملاء الدائمين والعملاء الحسابيين المرتبطين بالشحنات والأرصدة</p>
        </div>
        <div className="flex gap-2">
          <button className="btn btn-secondary" onClick={() => void load(page)}>
            <RefreshCw size={15} />
            تحديث
          </button>
          <button className="btn btn-secondary" onClick={exportCsv} disabled={!customers.length}>
            تصدير CSV
          </button>
          {canManage && (
            <button
              className="btn btn-primary"
              onClick={() => { setEditingCustomer(undefined); setShowForm(true); }}
            >
              <Plus size={15} />
              إضافة عميل
            </button>
          )}
        </div>
      </div>

      {/* ── Filters ── */}
      <div className="card mb-4 p-4">
        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3">
          <div className="col-span-2 md:col-span-1">
            <label className="block text-xs text-gray-500 mb-1">بحث عام</label>
            <div className="relative">
              <Search size={13} className="absolute right-2 top-1/2 -translate-y-1/2 text-gray-400" />
              <input
                className="form-input w-full pr-7"
                placeholder="اسم، هاتف، كود..."
                value={filters.search}
                onChange={(e) => setFilters((p) => ({ ...p, search: e.target.value }))}
                onKeyDown={(e) => e.key === 'Enter' && handleApply()}
              />
            </div>
          </div>
          <div>
            <label className="block text-xs text-gray-500 mb-1">نوع العميل</label>
            <select className="form-input w-full" value={filters.customer_type}
              onChange={(e) => setFilters((p) => ({ ...p, customer_type: e.target.value as Filters['customer_type'] }))}>
              <option value="">الكل</option>
              <option value="INDIVIDUAL">فرد</option>
              <option value="COMPANY">شركة</option>
            </select>
          </div>
          <div>
            <label className="block text-xs text-gray-500 mb-1">نوع الحساب</label>
            <select className="form-input w-full" value={filters.is_account_customer}
              onChange={(e) => setFilters((p) => ({ ...p, is_account_customer: e.target.value as Filters['is_account_customer'] }))}>
              <option value="">الكل</option>
              <option value="false">عميل عادي</option>
              <option value="true">عميل حسابي</option>
            </select>
          </div>
          <div>
            <label className="block text-xs text-gray-500 mb-1">المحافظة / المدينة</label>
            <input className="form-input w-full" placeholder="حلب..." value={filters.city}
              onChange={(e) => setFilters((p) => ({ ...p, city: e.target.value }))} />
          </div>
          <div>
            <label className="block text-xs text-gray-500 mb-1">الفرع</label>
            <select className="form-input w-full" value={filters.branch_id}
              onChange={(e) => setFilters((p) => ({ ...p, branch_id: e.target.value }))}>
              <option value="">كل الفروع</option>
              {branches.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
            </select>
          </div>
          <div>
            <label className="block text-xs text-gray-500 mb-1">الحالة</label>
            <select className="form-input w-full" value={filters.status}
              onChange={(e) => setFilters((p) => ({ ...p, status: e.target.value as Filters['status'] }))}>
              <option value="">الكل</option>
              <option value="active">نشط</option>
              <option value="inactive">متوقف</option>
            </select>
          </div>
        </div>
        <div className="flex gap-2 mt-3">
          <button className="btn btn-primary" onClick={handleApply}>تطبيق</button>
          <button className="btn btn-secondary" onClick={handleReset}>إعادة ضبط</button>
        </div>
      </div>

      {/* ── Summary strip ── */}
      <div className="flex gap-4 mb-3 text-sm">
        <span className="text-gray-600">إجمالي: <strong>{total}</strong> عميل</span>
        <span className="text-blue-700">حسابيون: <strong>{customers.filter((c) => c.is_account_customer).length}</strong></span>
        <span className="text-gray-500">عاديون: <strong>{customers.filter((c) => !c.is_account_customer).length}</strong></span>
      </div>

      {/* ── Table ── */}
      <div className="card overflow-hidden">
        <div className="overflow-x-auto">
          <table className="data-table w-full text-sm">
            <thead>
              <tr>
                <th className="text-right">#</th>
                <th className="text-right">كود العميل</th>
                <th className="text-right">اسم العميل</th>
                <th className="text-right">النوع</th>
                <th className="text-right">الهاتف</th>
                <th className="text-right">المدينة</th>
                <th className="text-right">الفرع</th>
                <th className="text-right">حسابي؟</th>
                <th className="text-right">الحالة</th>
                <th className="text-right">إجراءات</th>
              </tr>
            </thead>
            <tbody>
              {loading && (
                <tr>
                  <td colSpan={10} className="text-center py-8 text-gray-500">جاري التحميل...</td>
                </tr>
              )}
              {!loading && customers.length === 0 && (
                <tr>
                  <td colSpan={10} className="text-center py-10 text-gray-400">
                    <Building2 size={32} className="mx-auto mb-2 opacity-30" />
                    <p>لا يوجد عملاء مسجلون</p>
                    {canManage && (
                      <button
                        className="mt-3 btn btn-primary"
                        onClick={() => { setEditingCustomer(undefined); setShowForm(true); }}
                      >
                        <Plus size={14} /> إضافة أول عميل
                      </button>
                    )}
                  </td>
                </tr>
              )}
              {!loading && customers.map((c, idx) => (
                <tr key={c.id} className={c.status === 'inactive' ? 'opacity-50' : ''}>
                  <td className="text-gray-400">{(page - 1) * LIMIT + idx + 1}</td>
                  <td className="font-mono text-xs text-gray-500">{c.code}</td>
                  <td>
                    <div className="font-medium text-gray-900">{c.name}</div>
                    {c.company_name && <div className="text-xs text-gray-500">{c.company_name}</div>}
                  </td>
                  <td>{customerTypeLabel(c.customer_type)}</td>
                  <td dir="ltr" className="text-sm">{c.phone ?? '—'}</td>
                  <td>{c.city ?? '—'}</td>
                  <td>{c.branch_name ?? '—'}</td>
                  <td>
                    {c.is_account_customer ? (
                      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs bg-emerald-100 text-emerald-700 font-semibold">
                        <UserCheck size={11} /> عميل حسابي
                      </span>
                    ) : (
                      <span className="text-xs text-gray-400">عادي</span>
                    )}
                  </td>
                  <td>{statusBadge(c.status)}</td>
                  <td>
                    <div className="flex gap-1">
                      <Link
                        to={`/customers/${c.id}`}
                        className="text-xs px-2 py-1 rounded bg-blue-50 text-blue-700 hover:bg-blue-100"
                      >
                        عرض
                      </Link>
                      {canManage && (
                        <>
                          <button
                            className="text-xs px-2 py-1 rounded bg-gray-50 text-gray-600 hover:bg-gray-100"
                            onClick={() => { setEditingCustomer(c); setShowForm(true); }}
                          >
                            تعديل
                          </button>
                          <button
                            className={`text-xs px-2 py-1 rounded ${c.status === 'active' ? 'bg-red-50 text-red-600 hover:bg-red-100' : 'bg-green-50 text-green-700 hover:bg-green-100'}`}
                            onClick={() => void handleToggleStatus(c)}
                          >
                            {c.status === 'active' ? 'تعطيل' : 'تفعيل'}
                          </button>
                        </>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {/* Pagination */}
        {totalPages > 1 && (
          <div className="flex items-center justify-between px-4 py-3 border-t border-gray-200">
            <span className="text-sm text-gray-500">صفحة {page} من {totalPages}</span>
            <div className="flex gap-2">
              <button className="btn btn-secondary text-xs" disabled={page <= 1}
                onClick={() => { const p = page - 1; setPage(p); void load(p); }}>
                السابق
              </button>
              <button className="btn btn-secondary text-xs" disabled={page >= totalPages}
                onClick={() => { const p = page + 1; setPage(p); void load(p); }}>
                التالي
              </button>
            </div>
          </div>
        )}
      </div>

      {/* ── Form modal ── */}
      {showForm && (
        <EscapeModalScrim
          dir="rtl"
          onClose={() => { setShowForm(false); setEditingCustomer(undefined); }}
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
        >
          <div className="bg-white rounded-xl shadow-2xl w-full max-w-2xl max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between p-5 border-b border-gray-200">
              <h2 className="text-lg font-bold text-gray-900">
                {editingCustomer ? 'تعديل بيانات العميل' : 'إضافة عميل جديد'}
              </h2>
              <button className="text-gray-400 hover:text-gray-600" onClick={() => { setShowForm(false); setEditingCustomer(undefined); }}>
                <X size={20} />
              </button>
            </div>
            <div className="p-5">
              <CustomerForm
                initial={editingCustomer}
                branches={branches}
                onSave={handleSave}
                onCancel={() => { setShowForm(false); setEditingCustomer(undefined); }}
                saving={saving}
              />
            </div>
          </div>
        </EscapeModalScrim>
      )}
    </div>
  );
}
