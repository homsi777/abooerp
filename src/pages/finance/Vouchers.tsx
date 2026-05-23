import { useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { convertToUsd, formatCurrency, getExchangeRatesToUsd, getRateToUsd, parseDecimalAmount, type CurrencyCode } from '../../lib/currency/currency';
import { phase3FinanceGateway, type BackendCashboxRecord } from '../../lib/api/phase3FinanceGateway';
import { useToast } from '../../components/Toast';
import { useAuth } from '../../context/AuthProvider';
import SmartPartyInput from '../../components/SmartPartyInput';
import type { PaymentVoucher, ReceiptVoucher } from '../../types';
import { downloadCsv } from '../../lib/export/csvDownload';
import { exportPdfTable } from '../../lib/export/pdfExport';

interface Voucher {
  id: number;
  kind: 'receipt' | 'payment';
  voucherNo: string;
  voucherType: string;
  date: string;
  relatedParty: string;
  customerId?: string | null;
  agentId?: string | null;
  amount: number;
  currency: CurrencyCode;
  amountUsd: number;
  cashBox: string;
  cashboxId?: string;
  description: string;
  refNo: string;
  status: string;
}

const voucherTypes = ['سند قبض', 'سند دفع', 'تحويل', 'تسوية'];

const statusColors: Record<string, string> = {
  'مؤكد': 'bg-green-100 text-green-800',
  'معلق': 'bg-yellow-100 text-yellow-800',
  'مرفوض': 'bg-red-100 text-red-800',
  draft: 'bg-yellow-100 text-yellow-800',
  confirmed: 'bg-green-100 text-green-800',
  cancelled: 'bg-red-100 text-red-800',
};

function voucherStatusLabel(s: string): string {
  if (s === 'draft') return 'مسودة';
  if (s === 'confirmed') return 'مؤكد';
  if (s === 'cancelled') return 'ملغى';
  return s;
}

function mapReceipt(r: ReceiptVoucher, rates: ReturnType<typeof getExchangeRatesToUsd>): Voucher {
  const currency = (r.currency || 'USD') as CurrencyCode;
  return {
    id: r.id,
    kind: 'receipt',
    voucherNo: r.voucherNo,
    voucherType: 'سند قبض',
    date: r.date,
    relatedParty: r.customerName || 'غير محدد',
    customerId: r.customerBackendId ?? null,
    agentId: r.agentBackendId ?? null,
    amount: r.amount,
    currency,
    amountUsd: r.amountUsd ?? convertToUsd(r.amount, currency, rates),
    cashBox: r.cashboxName || '—',
    cashboxId: r.cashboxId,
    description: r.description || '',
    refNo: '',
    status: r.createdBy,
  };
}

function mapPayment(p: PaymentVoucher, rates: ReturnType<typeof getExchangeRatesToUsd>): Voucher {
  const currency = (p.currency || 'USD') as CurrencyCode;
  return {
    id: p.id,
    kind: 'payment',
    voucherNo: p.voucherNo,
    voucherType: 'سند دفع',
    date: p.date,
    relatedParty: p.vendorName || 'غير محدد',
    customerId: p.customerBackendId ?? null,
    agentId: p.agentBackendId ?? null,
    amount: p.amount,
    currency,
    amountUsd: p.amountUsd ?? convertToUsd(p.amount, currency, rates),
    cashBox: p.cashboxName || '—',
    cashboxId: p.cashboxId,
    description: p.description || '',
    refNo: '',
    status: p.createdBy,
  };
}

export default function FinanceVouchers() {
  const rates = getExchangeRatesToUsd();
  const { showToast } = useToast();
  const { user, hasPermission } = useAuth();
  const [searchParams] = useSearchParams();
  const isAgent = user?.userType === 'agent';
  const canUpdateVoucher = hasPermission('finance.vouchers.update') || hasPermission('finance.vouchers.write');

  const [vouchers, setVouchers] = useState<Voucher[]>([]);
  const [cashboxes, setCashboxes] = useState<BackendCashboxRecord[]>([]);
  const [searchTerm, setSearchTerm] = useState('');
  const [typeFilter, setTypeFilter] = useState('');
  const [showForm, setShowForm] = useState(false);
  const [editingVoucher, setEditingVoucher] = useState<Voucher | null>(null);
  const [formData, setFormData] = useState({
    voucherNo: '',
    voucherType: 'سند قبض',
    date: new Date().toISOString().split('T')[0],
    relatedParty: '',
    customerId: null as string | null,
    agentId: null as string | null,
    amount: 0,
    currency: 'USD' as CurrencyCode,
    cashboxId: '' as string,
    description: '',
    refNo: '',
    status: 'draft' as 'draft' | 'confirmed' | 'cancelled',
  });

  const cashboxesForCurrency = useMemo(
    () => cashboxes.filter((c) => c.is_active && c.currency_code === formData.currency),
    [cashboxes, formData.currency],
  );

  const agentNameById = useMemo(() => {
    const m = new Map<string, string>();
    for (const c of cashboxes) {
      if (!c.is_active) continue;
      if (c.agent_id && c.agent_name && !m.has(c.agent_id)) {
        m.set(c.agent_id, c.agent_name);
      }
    }
    return m;
  }, [cashboxes]);

  const displayRelatedParty = (voucher: Voucher) => {
    if (voucher.customerId) return voucher.relatedParty;
    if (voucher.agentId) {
      const label = agentNameById.get(voucher.agentId);
      if (label) return label;
    }
    return voucher.relatedParty;
  };

  const loadVouchers = async () => {
    const results = await Promise.allSettled([
      phase3FinanceGateway.receiptVouchers.getAll(),
      phase3FinanceGateway.paymentVouchers.getAll(),
    ]);
    const receipts = results[0].status === 'fulfilled' ? results[0].value : [];
    const payments = results[1].status === 'fulfilled' ? results[1].value : [];
    const mapped: Voucher[] = [
      ...receipts.map((r) => mapReceipt(r, rates)),
      ...payments.map((p) => mapPayment(p, rates)),
    ].sort((a, b) => (a.date < b.date ? 1 : -1));
    setVouchers(mapped);
  };

  const loadCashboxes = async () => {
    try {
      const rows = await phase3FinanceGateway.cashbox.listMaster();
      setCashboxes(rows);
      if (rows.length === 0 && isAgent) {
        showToast('لا يوجد صندوق مرتبط بهذا الوكيل. يرجى مراجعة المدير العام.', 'error');
      }
    } catch {
      showToast('تعذر تحميل الصناديق', 'error');
    }
  };

  useEffect(() => {
    loadVouchers().catch(() => showToast('تعذر تحميل السندات', 'error'));
    void loadCashboxes();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- mount load only
  }, []);

  useEffect(() => {
    const preCashbox = searchParams.get('cashboxId');
    const kind = searchParams.get('kind');
    const newKind = searchParams.get('new');
    const voucherTypeFromLink =
      kind === 'payment' || newKind === 'payment'
        ? 'سند دفع'
        : kind === 'receipt' || newKind === 'receipt'
          ? 'سند قبض'
          : null;
    if (preCashbox || voucherTypeFromLink) {
      setFormData((prev) => ({
        ...prev,
        ...(preCashbox ? { cashboxId: preCashbox } : {}),
        ...(voucherTypeFromLink ? { voucherType: voucherTypeFromLink } : {}),
      }));
      setShowForm(true);
    }
  }, [searchParams]);

  useEffect(() => {
    if (cashboxesForCurrency.length !== 1 || formData.cashboxId) return;
    if (formData.agentId) return;
    setFormData((prev) => ({ ...prev, cashboxId: cashboxesForCurrency[0].id }));
  }, [cashboxesForCurrency, formData.cashboxId]);

  useEffect(() => {
    if (!formData.agentId) return;
    const match = cashboxes.find(
      (c) => c.is_active && c.agent_id === formData.agentId && c.currency_code === formData.currency,
    );
    if (!match) return;
    if (formData.cashboxId === match.id) return;
    setFormData((prev) => (prev.agentId === formData.agentId ? { ...prev, cashboxId: match.id } : prev));
  }, [cashboxes, formData.agentId, formData.cashboxId, formData.currency]);

  const totalReceipt = useMemo(
    () => vouchers.filter((v) => v.kind === 'receipt').reduce((sum, v) => sum + v.amountUsd, 0),
    [vouchers],
  );
  const totalPayment = useMemo(
    () => vouchers.filter((v) => v.kind === 'payment').reduce((sum, v) => sum + v.amountUsd, 0),
    [vouchers],
  );
  const pendingCount = useMemo(() => vouchers.filter((v) => v.status === 'draft').length, [vouchers]);
  const totalNet = useMemo(() => totalReceipt - totalPayment, [totalPayment, totalReceipt]);

  const filteredVouchers = vouchers.filter((v) => {
    if (searchTerm && !v.voucherNo.includes(searchTerm) && !v.relatedParty.includes(searchTerm)) return false;
    if (typeFilter && v.voucherType !== typeFilter) return false;
    return true;
  });

  const exportCsv = () => {
    downloadCsv(
      `finance-vouchers-${new Date().toISOString().split('T')[0]}.csv`,
      ['رقم السند', 'النوع', 'التاريخ', 'الجهة', 'المبلغ', 'العملة', 'المبلغ USD', 'الصندوق', 'الوصف', 'المرجع', 'الحالة'],
      filteredVouchers.map((v) => [
        v.voucherNo,
        v.voucherType,
        v.date,
        displayRelatedParty(v),
        v.amount,
        v.currency,
        v.amountUsd || convertToUsd(v.amount, v.currency, rates),
        v.cashBox,
        v.description,
        v.refNo || '',
        voucherStatusLabel(v.status),
      ]),
    );
    showToast('تم تنزيل الملف', 'success');
  };

  const exportPdf = async () => {
    const subtitleParts: string[] = [];
    if (typeFilter) subtitleParts.push(`النوع: ${typeFilter}`);
    if (searchTerm.trim()) subtitleParts.push(`بحث: ${searchTerm.trim()}`);
    const subtitle = subtitleParts.length ? subtitleParts.join(' | ') : undefined;

    const result = await exportPdfTable({
      title: 'السندات',
      subtitle,
      defaultFileName: `finance-vouchers-${new Date().toISOString().split('T')[0]}.pdf`,
      headers: ['رقم السند', 'النوع', 'التاريخ', 'الجهة', 'المبلغ الأصلي', 'USD', 'الصندوق', 'الوصف', 'المرجع', 'الحالة'],
      rows: filteredVouchers.map((v) => [
        v.voucherNo,
        v.voucherType,
        v.date,
        displayRelatedParty(v),
        formatCurrency(v.amount, v.currency),
        formatCurrency(v.amountUsd || convertToUsd(v.amount, v.currency, rates), 'USD'),
        v.cashBox,
        v.description,
        v.refNo || '-',
        voucherStatusLabel(v.status),
      ]),
    });

    if (result.saved) showToast('تم حفظ ملف PDF', 'success');
    else if (result.message !== 'cancelled') showToast('تعذر إنشاء PDF', 'error');
  };

  const resetForm = () => {
    setFormData({
      voucherNo: '',
      voucherType: 'سند قبض',
      date: new Date().toISOString().split('T')[0],
      relatedParty: '',
      customerId: null,
      agentId: null,
      amount: 0,
      currency: 'USD',
      cashboxId: '',
      description: '',
      refNo: '',
      status: 'draft',
    });
    setEditingVoucher(null);
  };

  const handleEdit = (voucher: Voucher) => {
    if (isAgent || !canUpdateVoucher) return;
    setEditingVoucher(voucher);
    setFormData({
      voucherNo: voucher.voucherNo,
      voucherType: voucher.voucherType,
      date: voucher.date,
      relatedParty: displayRelatedParty(voucher),
      customerId: voucher.customerId ?? null,
      agentId: voucher.agentId ?? null,
      amount: voucher.amount,
      currency: voucher.currency,
      cashboxId: voucher.cashboxId ?? '',
      description: voucher.description,
      refNo: voucher.refNo,
      status: (voucher.status as 'draft' | 'confirmed' | 'cancelled') || 'draft',
    });
    setShowForm(true);
  };

  const handleSave = async () => {
    try {
      if (!formData.customerId && !formData.agentId) {
        showToast('يجب اختيار الجهة المعنية (عميل أو وكيل) من القائمة.', 'error');
        return;
      }
      if (formData.status === 'confirmed' && !formData.cashboxId) {
        showToast('يجب اختيار صندوق لتأكيد السند.', 'error');
        return;
      }

      const voucherNo =
        formData.voucherNo ||
        (formData.voucherType === 'سند قبض' ? `RV-${Date.now()}` : `PV-${Date.now()}`);

      const payload: Record<string, unknown> = {
        voucherNo,
        originalAmount: formData.amount,
        originalCurrency: formData.currency,
        exchangeRateToUsd: getRateToUsd(formData.currency, rates),
        customerId: formData.customerId || undefined,
        agentId: formData.agentId || undefined,
        notes: String(formData.description || '').trim(),
        status: formData.status,
        cashboxId: formData.cashboxId || undefined,
      };

      if (formData.voucherType === 'سند قبض') {
        if (editingVoucher) {
          const backendId = phase3FinanceGateway.receiptVouchers.getBackendIdFromSynthetic(editingVoucher.id);
          if (!backendId) throw new Error('Missing backend mapping for receipt voucher update');
          await phase3FinanceGateway.receiptVouchers.update(backendId, payload);
        } else {
          await phase3FinanceGateway.receiptVouchers.create(payload);
        }
      } else {
        if (editingVoucher) {
          const backendId = phase3FinanceGateway.paymentVouchers.getBackendIdFromSynthetic(editingVoucher.id);
          if (!backendId) throw new Error('Missing backend mapping for payment voucher update');
          await phase3FinanceGateway.paymentVouchers.update(backendId, payload);
        } else {
          await phase3FinanceGateway.paymentVouchers.create(payload);
        }
      }

      showToast('تم حفظ السند بنجاح', 'success');
      setShowForm(false);
      resetForm();
      await loadVouchers();
    } catch (e) {
      showToast(e instanceof Error ? e.message : 'تعذر حفظ السند', 'error');
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-xl font-bold">السندات المالية</h2>
        <div className="flex gap-2">
          <button type="button" onClick={() => setShowForm(!showForm)} className="toolbar-btn primary">
            + سند جديد
          </button>
          <button type="button" className="toolbar-btn">
            طباعة
          </button>
        </div>
      </div>

      <div className="grid grid-cols-4 gap-4">
        <div className="stat-card">
          <div className="stat-value">{formatCurrency(totalReceipt, 'USD')}</div>
          <div className="stat-label">سندات القبض (USD)</div>
        </div>
        <div className="stat-card">
          <div className="stat-value">{formatCurrency(totalPayment, 'USD')}</div>
          <div className="stat-label">سندات الدفع (USD)</div>
        </div>
        <div className="stat-card">
          <div className="stat-value">{pendingCount}</div>
          <div className="stat-label">مسودة</div>
        </div>
        <div className="stat-card">
          <div className="stat-value">{formatCurrency(totalNet, 'USD')}</div>
          <div className="stat-label">المجموع النهائي (صافي)</div>
        </div>
      </div>

      {showForm && (
        <div className="card">
          <div className="card-header">سند جديد</div>
          <div className="grid grid-cols-4 gap-4">
            <div className="form-group">
              <label className="form-label">نوع السند</label>
              <select
                className="form-select w-full"
                value={formData.voucherType}
                onChange={(e) => setFormData({ ...formData, voucherType: e.target.value })}
              >
                {voucherTypes
                  .filter((type) => type === 'سند قبض' || type === 'سند دفع')
                  .map((t) => (
                    <option key={t} value={t}>
                      {t}
                    </option>
                  ))}
              </select>
            </div>
            <div className="form-group">
              <label className="form-label">التاريخ</label>
              <input
                type="date"
                className="form-input w-full"
                value={formData.date}
                onChange={(e) => setFormData({ ...formData, date: e.target.value })}
              />
            </div>
            <div className="form-group">
              <label className="form-label">الجهة المعنية</label>
              <SmartPartyInput
                value={formData.relatedParty}
                onChange={(value) => setFormData((prev) => ({ ...prev, relatedParty: value, customerId: null, agentId: null }))}
                onSelect={(p) => {
                  if (p.source_table === 'customers') {
                    setFormData((prev) => ({ ...prev, relatedParty: p.name, customerId: p.id, agentId: null }));
                    return;
                  }
                  if (p.source_table === 'agents') {
                    const sameCurrency = cashboxes.find(
                      (c) => c.is_active && c.agent_id === p.id && c.currency_code === formData.currency,
                    );
                    const any = cashboxes.find((c) => c.is_active && c.agent_id === p.id);
                    setFormData((prev) => ({
                      ...prev,
                      relatedParty: p.name,
                      customerId: null,
                      agentId: p.id,
                      cashboxId: (sameCurrency ?? any)?.id ?? '',
                      ...(sameCurrency
                        ? {}
                        : any
                          ? { currency: any.currency_code as CurrencyCode }
                          : {}),
                    }));
                  }
                }}
                includeAgents
                allowQuickContacts={false}
                allowAddNew={false}
                placeholder="ابحث عن عميل أو وكيل..."
              />
            </div>
            <div className="form-group">
              <label className="form-label">المبلغ</label>
              <input
                type="number"
                step="0.01"
                className="form-input w-full"
                value={formData.amount}
                onChange={(e) => setFormData({ ...formData, amount: parseDecimalAmount(e.target.value) })}
              />
            </div>
            <div className="form-group">
              <label className="form-label">العملة</label>
              <select
                className="form-select w-full"
                value={formData.currency}
                onChange={(e) => setFormData({ ...formData, currency: e.target.value as CurrencyCode, cashboxId: '' })}
              >
                <option value="USD">USD</option>
                <option value="SYP">SYP</option>
                <option value="TRY">TRY</option>
              </select>
            </div>
            <div className="form-group md:col-span-2">
              <label className="form-label">الصندوق</label>
              <select
                className="form-select w-full"
                value={formData.cashboxId}
                onChange={(e) => setFormData({ ...formData, cashboxId: e.target.value })}
              >
                <option value="">— اختر صندوقاً —</option>
                {cashboxesForCurrency.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.code} — {c.name}
                  </option>
                ))}
              </select>
              {cashboxesForCurrency.length === 0 && (
                <p className="text-xs text-amber-700 mt-1">لا يوجد صندوق بهذه العملة ضمن النطاق المسموح.</p>
              )}
            </div>
            <div className="form-group">
              <label className="form-label">رقم المرجع</label>
              <input
                type="text"
                className="form-input w-full"
                value={formData.refNo}
                onChange={(e) => setFormData({ ...formData, refNo: e.target.value })}
                placeholder="اختياري"
              />
            </div>
            <div className="form-group col-span-2">
              <label className="form-label">الوصف</label>
              <textarea
                className="form-input w-full"
                rows={2}
                value={formData.description}
                onChange={(e) => setFormData({ ...formData, description: e.target.value })}
              />
            </div>
            <div className="form-group">
              <label className="form-label">الحالة</label>
              <select
                className="form-select w-full"
                value={formData.status}
                onChange={(e) => setFormData({ ...formData, status: e.target.value as 'draft' | 'confirmed' | 'cancelled' })}
              >
                <option value="draft">مسودة</option>
                <option value="confirmed">مؤكد</option>
                <option value="cancelled">ملغي</option>
              </select>
            </div>
            <div className="form-group">
              <label className="form-label">المكافئ بالدولار</label>
              <input
                type="text"
                className="form-input w-full bg-gray-100"
                value={formatCurrency(convertToUsd(formData.amount, formData.currency, rates), 'USD')}
                readOnly
              />
            </div>
          </div>
          <div className="flex gap-2 mt-4">
            <button type="button" onClick={() => void handleSave()} className="toolbar-btn primary">
              حفظ
            </button>
            <button
              type="button"
              onClick={() => {
                setShowForm(false);
                resetForm();
              }}
              className="toolbar-btn"
            >
              إلغاء
            </button>
          </div>
        </div>
      )}

      <div className="card">
        <div className="flex flex-wrap gap-2 items-center">
          <input
            type="text"
            placeholder="بحث برقم السند أو الجهة..."
            className="form-input flex-1 min-w-[240px]"
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
          />
          <select className="form-select" value={typeFilter} onChange={(e) => setTypeFilter(e.target.value)}>
            <option value="">كل الأنواع</option>
            {voucherTypes
              .filter((type) => type === 'سند قبض' || type === 'سند دفع')
              .map((t) => (
                <option key={t} value={t}>
                  {t}
                </option>
              ))}
          </select>
          <button type="button" className="toolbar-btn" onClick={exportCsv}>
            تصدير Excel (CSV)
          </button>
          <button type="button" className="toolbar-btn" onClick={() => void exportPdf()}>
            تصدير PDF
          </button>
        </div>
      </div>

      <div className="card overflow-auto">
        <table className="data-grid">
          <thead>
            <tr>
              <th>رقم السند</th>
              <th>النوع</th>
              <th>التاريخ</th>
              <th>الجهة</th>
              <th>المبلغ الأصلي</th>
              <th>المبلغ USD</th>
              <th>الصندوق</th>
              <th>الوصف</th>
              <th>المرجع</th>
              <th>الحالة</th>
              {!isAgent && canUpdateVoucher && <th>إجراء</th>}
            </tr>
          </thead>
          <tbody>
            {filteredVouchers.map((voucher) => (
              <tr
                key={`${voucher.kind}-${voucher.id}`}
                className={
                  voucher.kind === 'receipt'
                    ? 'bg-green-50 hover:bg-green-100/60'
                    : voucher.kind === 'payment'
                      ? 'bg-red-50 hover:bg-red-100/60'
                      : undefined
                }
              >
                <td>{voucher.voucherNo}</td>
                <td>{voucher.voucherType}</td>
                <td>{voucher.date}</td>
                <td>{displayRelatedParty(voucher)}</td>
                <td className="text-left">{formatCurrency(voucher.amount, voucher.currency)}</td>
                <td className="text-left">
                  {formatCurrency(voucher.amountUsd || convertToUsd(voucher.amount, voucher.currency, rates), 'USD')}
                </td>
                <td>{voucher.cashBox}</td>
                <td>{voucher.description}</td>
                <td>{voucher.refNo || '-'}</td>
                <td>
                  <span className={`status-badge ${statusColors[voucher.status] ?? 'bg-gray-100 text-gray-800'}`}>
                    {voucherStatusLabel(voucher.status)}
                  </span>
                </td>
                {!isAgent && canUpdateVoucher && (
                  <td>
                    <button type="button" className="toolbar-btn" onClick={() => handleEdit(voucher)}>
                      تعديل
                    </button>
                  </td>
                )}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
