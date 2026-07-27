import { useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { convertToUsd, formatCurrency, getExchangeRatesToUsd, getRateToUsd, parseDecimalAmount, type CurrencyCode } from '../../lib/currency/currency';
import { phase3FinanceGateway, type BackendCashboxRecord } from '../../lib/api/phase3FinanceGateway';
import { useToast } from '../../components/Toast';
import { useAuth } from '../../context/AuthProvider';
import SmartPartyInput from '../../components/SmartPartyInput';
import VoucherExcelGrid from '../../components/finance/VoucherExcelGrid';
import VoucherRegisterPanel, { type RegisterFilters } from '../../components/finance/VoucherRegisterPanel';
import type { ReceiptVoucher, PaymentVoucher } from '../../types';
import { downloadCsv } from '../../lib/export/csvDownload';
import { exportPdfTable } from '../../lib/export/pdfExport';
import { type Voucher, voucherStatusColors, voucherStatusLabelAr } from './voucherTypes';

const voucherTypes = ['سند قبض', 'سند دفع', 'تحويل', 'تسوية'];
const statusColors = voucherStatusColors;
const voucherStatusLabel = voucherStatusLabelAr;

type VoucherViewMode = 'entry' | 'register';

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
    relatedEntityType: r.relatedEntityType ?? null,
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
    relatedEntityType: p.relatedEntityType ?? null,
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
  const todayIso = useMemo(() => new Date().toISOString().split('T')[0], []);
  const canBackdateVoucher = useMemo(() => {
    if (user?.userType === 'admin') return true;
    return hasPermission('finance.vouchers.backdate');
  }, [user?.userType, hasPermission]);

  const [vouchers, setVouchers] = useState<Voucher[]>([]);
  const [cashboxes, setCashboxes] = useState<BackendCashboxRecord[]>([]);
  const [viewMode, setViewMode] = useState<VoucherViewMode>('entry');
  const [registerFilters, setRegisterFilters] = useState<RegisterFilters>({
    searchTerm: '',
    typeFilter: '',
    statusFilter: '',
    dateFrom: '',
    dateTo: '',
  });
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
    transferCashboxId: '' as string,
    description: '',
    refNo: '',
    status: 'draft' as 'draft' | 'confirmed' | 'cancelled',
  });
  const canEditVoucherDate = canBackdateVoucher && (!editingVoucher || editingVoucher.status === 'draft');

  const cashboxesForCurrency = useMemo(
    () => cashboxes.filter((c) => c.is_active && c.currency_code === formData.currency),
    [cashboxes, formData.currency],
  );

  const targetCashboxesForCurrency = useMemo(
    () => cashboxesForCurrency.filter((c) => c.id !== formData.cashboxId),
    [cashboxesForCurrency, formData.cashboxId],
  );
  const isManualPartyDraft =
    !formData.customerId &&
    !formData.agentId &&
    formData.relatedParty.trim().length > 0;

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
    if (voucher.relatedEntityType === 'expense') return 'مصروف داخلي';
    if (voucher.relatedEntityType === 'cashbox_transfer') return 'مناقلة بين الصناديق';
    if (voucher.relatedEntityType === 'salary_record') return 'راتب موظف';
    if (voucher.relatedEntityType === 'manual_party') return voucher.relatedParty || 'جهة يدوية';
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
    const agentId = searchParams.get('agentId');
    const agentName = searchParams.get('agentName');
    const amount = searchParams.get('amount');
    const currency = searchParams.get('currency');
    const notes = searchParams.get('notes');
    const status = searchParams.get('status');
    const voucherTypeFromLink =
      kind === 'payment' || newKind === 'payment'
        ? 'سند دفع'
        : kind === 'receipt' || newKind === 'receipt'
          ? 'سند قبض'
          : null;
    if (preCashbox || voucherTypeFromLink || agentId || amount || notes) {
      setFormData((prev) => ({
        ...prev,
        ...(preCashbox ? { cashboxId: preCashbox } : {}),
        ...(voucherTypeFromLink ? { voucherType: voucherTypeFromLink } : {}),
        ...(agentId ? { agentId, customerId: null } : {}),
        ...(agentName ? { relatedParty: agentName } : {}),
        ...(amount ? { amount: parseDecimalAmount(amount) } : {}),
        ...(currency ? { currency: currency as CurrencyCode } : {}),
        ...(notes ? { description: notes } : {}),
        ...(status === 'confirmed' || status === 'draft' || status === 'cancelled' ? { status } : {}),
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
  const pendingAgentCount = useMemo(
    () => vouchers.filter((v) => v.status === 'draft' && (v.relatedEntityType === 'agent_remittance' || v.relatedEntityType === 'agent_receipt_from_branch')).length,
    [vouchers],
  );
  const pendingCount = useMemo(() => vouchers.filter((v) => v.status === 'draft').length, [vouchers]);
  const totalNet = useMemo(() => totalReceipt - totalPayment, [totalPayment, totalReceipt]);

  const filteredVouchers = useMemo(() => {
    return vouchers.filter((v) => {
      const { searchTerm, typeFilter, statusFilter, dateFrom, dateTo } = registerFilters;
      if (searchTerm && !v.voucherNo.includes(searchTerm) && !v.relatedParty.includes(searchTerm)) return false;
      if (typeFilter && v.voucherType !== typeFilter) return false;
      if (statusFilter && v.status !== statusFilter) return false;
      if (dateFrom && v.date < dateFrom) return false;
      if (dateTo && v.date > dateTo) return false;
      return true;
    });
  }, [vouchers, registerFilters]);

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
    if (registerFilters.typeFilter) subtitleParts.push(`النوع: ${registerFilters.typeFilter}`);
    if (registerFilters.statusFilter) subtitleParts.push(`الحالة: ${voucherStatusLabel(registerFilters.statusFilter)}`);
    if (registerFilters.searchTerm.trim()) subtitleParts.push(`بحث: ${registerFilters.searchTerm.trim()}`);
    if (registerFilters.dateFrom || registerFilters.dateTo) {
      subtitleParts.push(`التاريخ: ${registerFilters.dateFrom || '…'} → ${registerFilters.dateTo || '…'}`);
    }
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
      transferCashboxId: '',
      description: '',
      refNo: '',
      status: 'draft',
    });
    setEditingVoucher(null);
  };

  const handleEdit = (voucher: Voucher) => {
    if (isAgent || !canUpdateVoucher) return;
    setViewMode('entry');
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
      transferCashboxId: '',
      description: voucher.description,
      refNo: voucher.refNo,
      status: (voucher.status as 'draft' | 'confirmed' | 'cancelled') || 'draft',
    });
    setShowForm(true);
  };

  const handleSave = async () => {
    try {
      if (formData.date > todayIso) {
        showToast('لا يمكن إنشاء سند بتاريخ مستقبلي.', 'error');
        return;
      }
      if (formData.date !== todayIso && !canBackdateVoucher) {
        showToast('لا يمكن إنشاء أو تعديل سند بتاريخ سابق.', 'error');
        return;
      }
      if (editingVoucher && formData.date !== editingVoucher.date && editingVoucher.status !== 'draft') {
        showToast('لا يمكن تغيير تاريخ سند مؤكد أو ملغى.', 'error');
        return;
      }

      const manualPartyName = formData.relatedParty.trim();
      const isManualParty = !formData.transferCashboxId && !formData.customerId && !formData.agentId && manualPartyName.length > 0;
      if (!formData.transferCashboxId && !formData.customerId && !formData.agentId && !isManualParty) {
        showToast('يجب اختيار الجهة المعنية أو كتابة اسم الجهة يدوياً.', 'error');
        return;
      }
      if (formData.status === 'confirmed' && !formData.cashboxId) {
        showToast('يجب اختيار صندوق لتأكيد السند.', 'error');
        return;
      }
      if (formData.transferCashboxId) {
        if (formData.transferCashboxId === formData.cashboxId) {
          showToast('لا يمكن تحويل المبلغ إلى نفس صندوق المصدر.', 'error');
          return;
        }
        if (formData.status !== 'confirmed') {
          showToast('مناقلة الصناديق يجب أن تكون بسند مؤكد.', 'error');
          return;
        }
        if (editingVoucher) {
          showToast('لا يمكن تعديل سند موجود إلى مناقلة صندوق. أنشئ مناقلة جديدة.', 'error');
          return;
        }
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
        relatedEntityType: isManualParty ? 'manual_party' : undefined,
        notes: isManualParty
          ? [`جهة: ${manualPartyName}`, String(formData.description || '').trim()].filter(Boolean).join(' - ')
          : String(formData.description || '').trim(),
        status: formData.status,
        cashboxId: formData.cashboxId || undefined,
      };

      if (canBackdateVoucher && canEditVoucherDate && formData.date) {
        payload.createdAt = new Date(`${formData.date}T12:00:00`).toISOString();
      }

      if (formData.transferCashboxId) {
        const sourceCashbox = cashboxes.find((c) => c.id === formData.cashboxId);
        const targetCashbox = cashboxes.find((c) => c.id === formData.transferCashboxId);
        const transferNo = formData.voucherNo || `TR-${Date.now()}`;
        const notes =
          String(formData.description || '').trim() ||
          `مناقلة صندوق من ${sourceCashbox?.name ?? 'صندوق مصدر'} إلى ${targetCashbox?.name ?? 'صندوق نهائي'}`;
        await phase3FinanceGateway.paymentVouchers.create({
          ...payload,
          voucherNo: `${transferNo}-OUT`,
          relatedEntityType: 'cashbox_transfer',
          customerId: undefined,
          agentId: undefined,
          notes,
          cashboxId: formData.cashboxId,
        });
        await phase3FinanceGateway.receiptVouchers.create({
          ...payload,
          voucherNo: `${transferNo}-IN`,
          relatedEntityType: 'cashbox_transfer',
          customerId: undefined,
          agentId: undefined,
          notes,
          cashboxId: formData.transferCashboxId,
        });
      } else if (formData.voucherType === 'سند قبض') {
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
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-xl font-bold">السندات المالية</h2>
        <div className="voucher-view-tabs">
          <button
            type="button"
            className={`toolbar-btn${viewMode === 'entry' ? ' primary' : ''}`}
            onClick={() => setViewMode('entry')}
          >
            إدخال سريع
          </button>
          <button
            type="button"
            className={`toolbar-btn${viewMode === 'register' ? ' primary' : ''}`}
            onClick={() => setViewMode('register')}
          >
            سجل السندات
          </button>
        </div>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-5 gap-4">
        <div className="stat-card">
          <div className="stat-value">{formatCurrency(totalReceipt, 'USD')}</div>
          <div className="stat-label">سندات القبض (USD)</div>
        </div>
        <div className="stat-card">
          <div className="stat-value">{formatCurrency(totalPayment, 'USD')}</div>
          <div className="stat-label">سندات الدفع (USD)</div>
        </div>
        <div className="stat-card">
          <div className="stat-value">{pendingAgentCount}</div>
          <div className="stat-label">سندات وكيل بانتظار الاعتماد</div>
        </div>
        <div className="stat-card">
          <div className="stat-value">{pendingCount}</div>
          <div className="stat-label">مسودة (كل السندات)</div>
        </div>
        <div className="stat-card">
          <div className="stat-value">{formatCurrency(totalNet, 'USD')}</div>
          <div className="stat-label">المجموع النهائي (صافي)</div>
        </div>
      </div>

      {showForm && (
        <div className="card">
          <div className="card-header">{editingVoucher ? `تعديل ${editingVoucher.voucherNo}` : 'سند متقدم (مناقلة / تعديل)'}</div>
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
                min={canBackdateVoucher ? undefined : todayIso}
                max={todayIso}
                readOnly={!canEditVoucherDate}
                onChange={(e) => setFormData({ ...formData, date: e.target.value })}
              />
              {!canBackdateVoucher ? (
                <p className="text-xs text-gray-500 mt-1">التاريخ مقيد بيوم اليوم — يلزم صلاحية السندات بتاريخ سابق للتعديل.</p>
              ) : null}
            </div>
            <div className="form-group">
              <label className="form-label">الجهة المعنية</label>
              <SmartPartyInput
                value={formData.relatedParty}
                onChange={(value) => setFormData((prev) => ({ ...prev, relatedParty: value, customerId: null, agentId: null, transferCashboxId: '' }))}
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
                onChange={(e) => setFormData({ ...formData, currency: e.target.value as CurrencyCode, cashboxId: '', transferCashboxId: '' })}
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
                onChange={(e) => setFormData({ ...formData, cashboxId: e.target.value, transferCashboxId: formData.transferCashboxId === e.target.value ? '' : formData.transferCashboxId })}
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
              <label className="form-label">صندوق تحويل</label>
              <select
                className="form-select w-full"
                value={formData.transferCashboxId}
                onChange={(e) => setFormData({ ...formData, transferCashboxId: e.target.value })}
                disabled={!formData.cashboxId || isManualPartyDraft}
              >
                <option value="">— بدون مناقلة —</option>
                {targetCashboxesForCurrency.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.code} — {c.name}
                  </option>
                ))}
              </select>
              <p className="text-xs text-slate-600 mt-1">
                {isManualPartyDraft
                  ? 'عند كتابة جهة يدوية يكفي اختيار الصندوق النهائي للسند.'
                  : 'عند الاختيار سيتم إخراج المبلغ من الصندوق وتحويله للصندوق النهائي.'}
              </p>
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

      {viewMode === 'entry' ? (
        <VoucherExcelGrid
          cashboxes={cashboxes}
          canBackdate={canBackdateVoucher}
          canUpdate={canUpdateVoucher}
          todayIso={todayIso}
          onSaved={loadVouchers}
        />
      ) : (
        <VoucherRegisterPanel
          vouchers={filteredVouchers}
          filters={registerFilters}
          onFiltersChange={(patch) => setRegisterFilters((prev) => ({ ...prev, ...patch }))}
          displayRelatedParty={displayRelatedParty}
          voucherStatusLabel={voucherStatusLabel}
          statusColors={statusColors}
          isAgent={isAgent}
          canUpdateVoucher={canUpdateVoucher}
          onEdit={handleEdit}
          onExportCsv={exportCsv}
          onExportPdf={() => void exportPdf()}
        />
      )}

    </div>
  );
}
