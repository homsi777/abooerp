import { useEffect, useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { httpClient } from '../../lib/api/httpClient';
import { phase3FinanceGateway } from '../../lib/api/phase3FinanceGateway';
import { useToast } from '../../components/Toast';
import AgentStatementReconciliationPanel from '../../components/agents/AgentStatementReconciliationPanel';
import BilateralReconciliationDetailColumns from '../../components/finance/BilateralReconciliationDetailColumns';
import FinanceExportToolbar from '../../components/finance/FinanceExportToolbar';
import { formatFinanceAmount, financeCurrencyDisplay } from '../../lib/finance/financeArabicLabels';
import { formatWesternDate, formatWesternDateTime } from '../../lib/format/westernDigits';
import { buildBilateralReconciliationPrintHtml } from '../../lib/export/financialStatementPrint';
import { parseDecimalAmount } from '../../lib/currency/currency';

const REPORT_CURRENCY = 'USD';

type BilateralItem = {
  itemType: string;
  description: string;
  companyAmount: number;
  agentAmount: number | null;
  difference: number | null;
  status: string;
  notes?: string | null;
  sortOrder: number;
};

type PreviewData = {
  agent: { id: string; name: string; code?: string };
  periodFrom: string;
  periodTo: string;
  currencyCode: string;
  previousBalance: number;
  periodMovement: number;
  currentBalance: number;
  periodStartLabel?: string;
  items: BilateralItem[];
  summary?: { allMatched: boolean; unmatchedItems: number };
  companyPackage?: any;
  lastApproved?: { period_to?: string; current_balance?: number } | null;
  status?: string;
  readOnly?: boolean;
};

type TabId = 'reconciliation' | 'discrepancies' | 'history';

function toDateInputValue(iso?: string) {
  if (!iso) return '';
  return iso.slice(0, 10);
}

function toPeriodIso(date: string, endOfDay = false) {
  if (!date) return undefined;
  return endOfDay ? `${date}T23:59:59.999Z` : `${date}T00:00:00.000Z`;
}

function itemStatusLabel(status: string) {
  if (status === 'matched') return 'متطابق';
  if (status === 'disputed') return 'نزاع';
  return 'غير متطابق';
}

function reconciliationStatusLabel(status: string) {
  const map: Record<string, string> = {
    draft: 'مسودة',
    pending: 'قيد المراجعة',
    approved: 'معتمد',
    disputed: 'متنازع عليه',
  };
  return map[status] ?? status;
}

function isCountItem(item: BilateralItem) {
  return item.itemType === 'count' || item.description.startsWith('عدد ');
}

function formatItemValue(item: BilateralItem, value: number | null, money: (v: unknown) => string) {
  if (value == null) return '—';
  if (isCountItem(item)) return String(Math.round(value));
  return money(value);
}

function balanceToneClass(value: number) {
  if (value > 0.01) return 'text-red-700';
  if (value < -0.01) return 'text-green-700';
  return 'text-gray-800';
}

function balanceDirectionLabel(value: number) {
  if (value > 0.01) return 'الوكيل مدين للشركة';
  if (value < -0.01) return 'الشركة مدينة للوكيل';
  return 'متوازن';
}

function normalizePreviewItems(items: any[]): BilateralItem[] {
  return (items ?? []).map((item, index) => ({
    itemType: String(item.itemType ?? item.item_type ?? ''),
    description: String(item.description ?? ''),
    companyAmount: Number(item.companyAmount ?? item.company_amount ?? 0),
    agentAmount: item.agentAmount === undefined
      ? (item.agent_amount == null ? null : Number(item.agent_amount))
      : (item.agentAmount == null ? null : Number(item.agentAmount)),
    difference: item.difference == null ? null : Number(item.difference),
    status: String(item.status ?? 'unmatched'),
    notes: item.notes ?? null,
    sortOrder: Number(item.sortOrder ?? item.sort_order ?? index),
  }));
}

function applyRecordToState(data: any, setters: {
  setPreview: (v: PreviewData) => void;
  setItems: (v: BilateralItem[]) => void;
  setNotes: (v: string) => void;
  setAgentNotes: (v: string) => void;
  setDateFrom: (v: string) => void;
  setDateTo: (v: string) => void;
  setDraftId: (v: string | undefined) => void;
  setRecordStatus: (v: string) => void;
}) {
  const normalized: PreviewData = {
    agent: { id: data.agent_id, name: data.agent_name, code: data.agent_code },
    periodFrom: data.period_from,
    periodTo: data.period_to,
    currencyCode: data.currency_code || REPORT_CURRENCY,
    previousBalance: Number(data.previous_balance ?? 0),
    periodMovement: Number(data.period_movement ?? 0),
    currentBalance: Number(data.current_balance ?? 0),
    periodStartLabel: data.periodStartLabel,
    items: normalizePreviewItems(data.items),
    status: data.status,
    readOnly: data.readOnly ?? data.status === 'approved',
    companyPackage: data.companyPackage,
  };
  setters.setPreview(normalized);
  setters.setItems(normalized.items);
  setters.setNotes(String(data.notes ?? ''));
  setters.setAgentNotes(String(data.agent_notes ?? ''));
  setters.setDateFrom(toDateInputValue(data.period_from));
  setters.setDateTo(toDateInputValue(data.period_to));
  setters.setDraftId(data.id);
  setters.setRecordStatus(String(data.status ?? 'draft'));
}

export default function BilateralReconciliation() {
  const [searchParams] = useSearchParams();
  const { showToast } = useToast();
  const [activeTab, setActiveTab] = useState<TabId>('reconciliation');
  const [agents, setAgents] = useState<Array<{ id: string; name: string; governorate?: string }>>([]);
  const [agentId, setAgentId] = useState(searchParams.get('agentId') || '');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [preview, setPreview] = useState<PreviewData | null>(null);
  const [items, setItems] = useState<BilateralItem[]>([]);
  const [notes, setNotes] = useState('');
  const [agentNotes, setAgentNotes] = useState('');
  const [draftId, setDraftId] = useState<string | undefined>();
  const [recordStatus, setRecordStatus] = useState('draft');
  const [history, setHistory] = useState<any[]>([]);
  const [discrepancies, setDiscrepancies] = useState<any[]>([]);
  const [balanceHistory, setBalanceHistory] = useState<any[]>([]);
  const [forceApproveOpen, setForceApproveOpen] = useState(false);
  const [forceNote, setForceNote] = useState('');
  const [disputeOpen, setDisputeOpen] = useState(false);
  const [disputeNote, setDisputeNote] = useState('');

  const readOnly = preview?.readOnly ?? recordStatus === 'approved';

  const detailPackage = preview?.companyPackage ?? null;

  useEffect(() => {
    void httpClient
      .get<Array<{ id: string; name: string; governorate?: string }>>('/agents?includeInactive=false')
      .then(setAgents)
      .catch(() => setAgents([]));
  }, []);

  const money = (value: unknown) => formatFinanceAmount(value, REPORT_CURRENCY);

  const loadHistory = async (selectedAgentId: string) => {
    try {
      const rows = await phase3FinanceGateway.accounting.bilateralReconciliation.list(selectedAgentId);
      setHistory(Array.isArray(rows) ? rows : []);
    } catch {
      setHistory([]);
    }
  };

  const loadReports = async (selectedAgentId: string) => {
    try {
      const [disc, hist] = await Promise.all([
        phase3FinanceGateway.accounting.bilateralReconciliation.discrepancyReport(selectedAgentId, REPORT_CURRENCY),
        phase3FinanceGateway.accounting.bilateralReconciliation.balanceHistoryReport(selectedAgentId, REPORT_CURRENCY),
      ]);
      setDiscrepancies(Array.isArray(disc) ? disc : []);
      setBalanceHistory(Array.isArray(hist) ? hist : []);
    } catch {
      setDiscrepancies([]);
      setBalanceHistory([]);
    }
  };

  const loadPreview = async (options?: { keepDraftId?: boolean }) => {
    if (!agentId) {
      showToast('اختر الوكيل أولاً', 'error');
      return;
    }
    setLoading(true);
    try {
      const data = await phase3FinanceGateway.accounting.bilateralReconciliation.preview({
        agentId,
        fromAt: toPeriodIso(dateFrom),
        toAt: toPeriodIso(dateTo, true),
        currencyCode: REPORT_CURRENCY,
      }) as PreviewData;
      setPreview({ ...data, readOnly: false, status: 'draft' });
      setItems(normalizePreviewItems(data.items));
      if (!dateFrom) setDateFrom(toDateInputValue(data.periodFrom));
      if (!dateTo) setDateTo(toDateInputValue(data.periodTo));
      if (!options?.keepDraftId) setDraftId(undefined);
      setRecordStatus('draft');
      setNotes('');
      setAgentNotes('');
      await Promise.all([loadHistory(agentId), loadReports(agentId)]);
    } catch (e) {
      showToast(e instanceof Error ? e.message : 'تعذر تحميل المطابقة الثنائية', 'error');
      setPreview(null);
      setItems([]);
    } finally {
      setLoading(false);
    }
  };

  const openSavedRecord = async (id: string) => {
    setLoading(true);
    try {
      const data = await phase3FinanceGateway.accounting.bilateralReconciliation.get(id);
      applyRecordToState(data, {
        setPreview,
        setItems,
        setNotes,
        setAgentNotes,
        setDateFrom,
        setDateTo,
        setDraftId,
        setRecordStatus,
      });
      setActiveTab('reconciliation');
      if (data.agent_id) setAgentId(String(data.agent_id));
    } catch (e) {
      showToast(e instanceof Error ? e.message : 'تعذر فتح المطابقة المحفوظة', 'error');
    } finally {
      setLoading(false);
    }
  };

  const updateAgentAmount = (index: number, raw: string) => {
    if (readOnly) return;
    const trimmed = raw.trim();
    const agentAmount = trimmed === '' ? null : parseDecimalAmount(raw);
    setItems((prev) =>
      prev.map((item, i) => {
        if (i !== index) return item;
        if (agentAmount == null) {
          return { ...item, agentAmount: null, difference: null, status: 'unmatched' };
        }
        const difference = Math.round((agentAmount - item.companyAmount) * 100) / 100;
        const status = Math.abs(difference) <= 0.01 ? 'matched' : 'unmatched';
        return { ...item, agentAmount, difference, status };
      }),
    );
  };

  const derived = useMemo(() => {
    const balanceItem = items.find((item) => item.itemType === 'balance');
    const periodMovement = Number(balanceItem?.companyAmount ?? preview?.periodMovement ?? 0);
    const previousBalance = Number(preview?.previousBalance ?? 0);
    const endingAgent = balanceItem?.agentAmount ?? null;
    const periodNet = endingAgent != null ? endingAgent : periodMovement;
    const currentBalance = previousBalance + periodNet;
    const unmatched = items.filter((item) => item.status !== 'matched').length;
    return {
      previousBalance,
      periodMovement,
      currentBalance,
      allMatched: unmatched === 0,
      unmatched,
    };
  }, [items, preview?.periodMovement, preview?.previousBalance]);

  const buildPayload = (extra?: { forceApprove?: boolean; forceNote?: string }) => {
    if (!preview) throw new Error('لا توجد بيانات مطابقة.');
    return {
      id: draftId,
      agentId,
      periodFrom: toPeriodIso(dateFrom) ?? preview.periodFrom,
      periodTo: toPeriodIso(dateTo, true) ?? preview.periodTo,
      currencyCode: REPORT_CURRENCY,
      previousBalance: derived.previousBalance,
      periodMovement: derived.periodMovement,
      currentBalance: derived.currentBalance,
      notes: notes.trim() || undefined,
      agentNotes: agentNotes.trim() || undefined,
      forceApprove: extra?.forceApprove,
      forceNote: extra?.forceNote,
      items: items.map((item, index) => ({
        itemType: item.itemType,
        description: item.description,
        companyAmount: item.companyAmount,
        agentAmount: item.agentAmount,
        notes: item.notes,
        sortOrder: index,
      })),
    };
  };

  const saveDraft = async () => {
    if (!preview || readOnly) return;
    setSaving(true);
    try {
      const saved = await phase3FinanceGateway.accounting.bilateralReconciliation.saveDraft(buildPayload()) as any;
      setDraftId(saved.id);
      setRecordStatus(String(saved.status ?? 'draft'));
      showToast('تم حفظ مسودة المطابقة.', 'success');
      await loadHistory(agentId);
    } catch (e) {
      showToast(e instanceof Error ? e.message : 'تعذر حفظ المسودة.', 'error');
    } finally {
      setSaving(false);
    }
  };

  const approve = async (force = false, note = '') => {
    if (!preview || readOnly) return;
    setSaving(true);
    try {
      const saved = await phase3FinanceGateway.accounting.bilateralReconciliation.approve(
        buildPayload({ forceApprove: force, forceNote: note }),
      ) as any;
      setDraftId(saved.id);
      setRecordStatus('approved');
      setPreview((prev) => (prev ? { ...prev, readOnly: true, status: 'approved' } : prev));
      showToast(force ? 'تم الاعتماد القسري وحفظ الذمة.' : 'تم اعتماد المطابقة وحفظ الذمة.', 'success');
      await Promise.all([loadHistory(agentId), loadReports(agentId)]);
      setForceApproveOpen(false);
      setForceNote('');
    } catch (e) {
      const message = e instanceof Error ? e.message : 'تعذر اعتماد المطابقة.';
      if (!force && message.includes('لا يمكن الاعتماد')) {
        setForceApproveOpen(true);
      } else {
        showToast(message, 'error');
      }
    } finally {
      setSaving(false);
    }
  };

  const sendToAgent = async () => {
    if (!draftId || readOnly) {
      showToast('احفظ المسودة أولاً قبل الإرسال للوكيل.', 'error');
      return;
    }
    setSaving(true);
    try {
      await phase3FinanceGateway.accounting.bilateralReconciliation.sendToAgent(draftId, {
        agentNotes: agentNotes.trim() || undefined,
      });
      setRecordStatus('pending');
      showToast('تم إرسال المطابقة للمراجعة (قيد المراجعة).', 'success');
      await loadHistory(agentId);
    } catch (e) {
      showToast(e instanceof Error ? e.message : 'تعذر إرسال المطابقة.', 'error');
    } finally {
      setSaving(false);
    }
  };

  const submitDispute = async () => {
    if (!draftId || !disputeNote.trim()) {
      showToast('احفظ المسودة وأدخل ملاحظة الاعتراض.', 'error');
      return;
    }
    setSaving(true);
    try {
      await phase3FinanceGateway.accounting.bilateralReconciliation.dispute(draftId, {
        disputeNote: disputeNote.trim(),
      });
      setRecordStatus('disputed');
      showToast('تم تسجيل الاعتراض.', 'success');
      setDisputeOpen(false);
      await loadHistory(agentId);
    } catch (e) {
      showToast(e instanceof Error ? e.message : 'تعذر تسجيل الاعتراض.', 'error');
    } finally {
      setSaving(false);
    }
  };

  const printData = preview
    ? {
        agent: preview.agent,
        periodFrom: toPeriodIso(dateFrom) ?? preview.periodFrom,
        periodTo: toPeriodIso(dateTo, true) ?? preview.periodTo,
        currencyCode: REPORT_CURRENCY,
        previousBalance: derived.previousBalance,
        periodMovement: derived.periodMovement,
        currentBalance: derived.currentBalance,
        status: recordStatus,
        notes,
        agentNotes,
        items: items.map((item) => ({
          description: item.description,
          company_amount: item.companyAmount,
          agent_amount: item.agentAmount,
          difference: item.difference,
          status: item.status,
          item_type: item.itemType,
        })),
      }
    : null;

  return (
    <div className="h-full flex flex-col gap-3">
      <div>
        <h2 className="text-xl font-bold">مطابقة ثنائية — وكيل ↔ فرع رئيسي</h2>
        <p className="text-sm text-gray-600">
          مقارنة أرقام الشركة مع أرقام الوكيل، تدقيق الفروقات، ثم اعتماد الذمة وحفظ تاريخ المطابقة.
        </p>
        <p className="text-xs text-gray-500 mt-1">
          للكشف التشغيلي فقط استخدم{' '}
          <Link className="text-primary-700 underline" to="/finance/statements/reconciliation/agent-branch">
            كشف وكيل ↔ فرع
          </Link>{' '}
          ضمن مركز الكشوف.
        </p>
      </div>

      <div className="flex flex-wrap gap-2 border-b pb-2">
        {([
          ['reconciliation', 'المطابقة'],
          ['discrepancies', 'تقرير الفروقات'],
          ['history', 'سجل الذمم'],
        ] as Array<[TabId, string]>).map(([id, label]) => (
          <button
            key={id}
            type="button"
            className={`toolbar-btn ${activeTab === id ? 'primary' : ''}`}
            onClick={() => {
              setActiveTab(id);
              if (agentId) void loadReports(agentId);
            }}
          >
            {label}
          </button>
        ))}
      </div>

      {activeTab === 'reconciliation' && (
        <>
          <div className="card p-2 flex flex-col gap-2">
            <div className="grid grid-cols-2 md:grid-cols-5 gap-2 items-center">
              <select className="form-select" value={agentId} onChange={(e) => setAgentId(e.target.value)} disabled={readOnly}>
                <option value="">اختر الوكيل</option>
                {agents.map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.name}{a.governorate ? ` — ${a.governorate}` : ''}
                  </option>
                ))}
              </select>
              <input type="date" className="form-input" value={dateFrom} onChange={(e) => setDateFrom(e.target.value)} disabled={readOnly} />
              <input type="date" className="form-input" value={dateTo} onChange={(e) => setDateTo(e.target.value)} disabled={readOnly} />
              <div className="text-sm text-gray-600 px-2">العملة: {financeCurrencyDisplay(REPORT_CURRENCY)}</div>
              <button type="button" className="toolbar-btn primary" disabled={loading} onClick={() => void loadPreview({ keepDraftId: Boolean(draftId) })}>
                {loading ? 'جاري التحميل...' : 'تحميل معاينة جديدة'}
              </button>
            </div>
            <FinanceExportToolbar
              disabled={!printData}
              csvFileName={`bilateral-reconciliation-${agentId || 'agent'}-${new Date().toISOString().split('T')[0]}.csv`}
              csvHeaders={['البند', 'مبلغ الشركة', 'مبلغ الوكيل', 'الفرق', 'الحالة']}
              csvRows={items.map((item) => [
                item.description,
                isCountItem(item) ? item.companyAmount : item.companyAmount,
                item.agentAmount ?? '',
                item.difference ?? '',
                itemStatusLabel(item.status),
              ])}
              pdfTitle="مطابقة ثنائية — وكيل ↔ فرع رئيسي"
              pdfFileName={`bilateral-reconciliation-${new Date().toISOString().split('T')[0]}.pdf`}
              documentType="bilateral_reconciliation"
              onBuildPrintHtml={() => buildBilateralReconciliationPrintHtml(printData ?? {})}
            />
          </div>

          {preview && (
            <>
              <div className="text-sm text-gray-700 bg-gray-50 border rounded px-3 py-2">
                {preview.periodStartLabel ?? 'تبدأ من اليوم التالي لآخر مطابقة معتمدة'}
                {draftId ? ` — الحالة: ${reconciliationStatusLabel(recordStatus)}` : ''}
              </div>

              <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                <div className="stat-card">
                  <div className="stat-value text-sm">{formatWesternDate(preview.lastApproved?.period_to ?? preview.periodFrom)}</div>
                  <div className="stat-label">مرجع بداية الفترة</div>
                </div>
                <div className="stat-card">
                  <div className={`stat-value ${balanceToneClass(derived.previousBalance)}`}>{money(derived.previousBalance)}</div>
                  <div className="stat-label">الذمة السابقة</div>
                </div>
                <div className="stat-card">
                  <div className={`stat-value ${balanceToneClass(derived.periodMovement)}`}>{money(derived.periodMovement)}</div>
                  <div className="stat-label">حركات الفترة</div>
                </div>
                <div className="stat-card ring-2 ring-primary-500/30">
                  <div className={`stat-value font-bold ${balanceToneClass(derived.currentBalance)}`}>{money(derived.currentBalance)}</div>
                  <div className="stat-label">الذمة الحالية — {balanceDirectionLabel(derived.currentBalance)}</div>
                </div>
              </div>

              <div className="text-sm text-gray-700">
                {money(derived.previousBalance)} + {money(derived.periodMovement)} = {money(derived.currentBalance)}
              </div>

              <div className={`rounded-lg border px-4 py-3 ${derived.allMatched ? 'border-green-300 bg-green-50 text-green-900' : 'border-amber-300 bg-amber-50 text-amber-900'}`}>
                <div className="font-bold">
                  {readOnly
                    ? 'عرض للقراءة فقط — مطابقة معتمدة'
                    : derived.allMatched
                      ? '✓ جميع البنود متطابقة — جاهز للاعتماد'
                      : '⚠ أدخل أرقام الوكيل أو سجّل الفروقات قبل الاعتماد'}
                </div>
              </div>

              <div className="card p-0 overflow-x-auto">
                <table className="data-table text-sm">
                  <thead>
                    <tr>
                      <th>البند</th>
                      <th>مبلغ الشركة (الفرع) — USD ($)</th>
                      <th>مبلغ الوكيل — USD ($)</th>
                      <th>الفرق — USD ($)</th>
                      <th>الحالة</th>
                    </tr>
                  </thead>
                  <tbody>
                    {items.map((item, index) => (
                      <tr key={`${item.itemType}-${item.description}`} className={item.status === 'matched' ? '' : 'bg-amber-50'}>
                        <td>{item.description}</td>
                        <td>{formatItemValue(item, item.companyAmount, money)}</td>
                        <td>
                          {readOnly ? (
                            formatItemValue(item, item.agentAmount, money)
                          ) : (
                            <input
                              type="number"
                              step={isCountItem(item) ? '1' : '0.01'}
                              className="form-input w-32"
                              value={item.agentAmount ?? ''}
                              placeholder="أدخل رقم الوكيل"
                              onChange={(e) => updateAgentAmount(index, e.target.value)}
                            />
                          )}
                        </td>
                        <td>{formatItemValue(item, item.difference, money)}</td>
                        <td>{itemStatusLabel(item.status)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                <div className="form-group">
                  <label className="form-label">ملاحظات الفرع الرئيسي</label>
                  <textarea className="form-input w-full" rows={3} value={notes} onChange={(e) => setNotes(e.target.value)} disabled={readOnly} />
                </div>
                <div className="form-group">
                  <label className="form-label">ملاحظات / إقرار الوكيل</label>
                  <textarea className="form-input w-full" rows={3} value={agentNotes} onChange={(e) => setAgentNotes(e.target.value)} disabled={readOnly} />
                </div>
              </div>

              {!readOnly && (
                <div className="flex flex-wrap gap-2 items-center">
                  <button type="button" className="toolbar-btn" disabled={saving} onClick={() => void saveDraft()}>
                    {saving ? 'جاري الحفظ...' : 'حفظ مسودة'}
                  </button>
                  <button type="button" className="toolbar-btn primary" disabled={saving} onClick={() => void approve()}>
                    {saving ? 'جاري الاعتماد...' : 'اعتماد المطابقة وحفظ الذمة'}
                  </button>
                  <button type="button" className="toolbar-btn" disabled={saving || !draftId} onClick={() => void sendToAgent()}>
                    إرسال للوكيل
                  </button>
                  <button type="button" className="toolbar-btn" disabled={saving || !draftId} onClick={() => setDisputeOpen(true)}>
                    تسجيل اعتراض
                  </button>
                </div>
              )}

              {detailPackage ? (
                <div className="space-y-4 border-t border-gray-200 pt-4 mt-2">
                  {!readOnly ? (
                    <AgentStatementReconciliationPanel
                      statementData={detailPackage}
                      reconciliationSaving={saving}
                      onSaveReconciliation={async () => showToast('استخدم زر اعتماد المطابقة في الأعلى بعد المراجعة.', 'info')}
                      onRefresh={() => loadPreview({ keepDraftId: true })}
                      returnPath="/finance/bilateral-reconciliation"
                      currencyCode={REPORT_CURRENCY}
                      hideSaveReconciliation
                    />
                  ) : null}
                  <BilateralReconciliationDetailColumns
                    data={detailPackage}
                    money={money}
                    periodBalance={{
                      previousBalance: derived.previousBalance,
                      periodMovement: derived.periodMovement,
                      currentBalance: derived.currentBalance,
                    }}
                  />
                </div>
              ) : null}

              {history.length > 0 ? (
                <div className="card p-3">
                  <h3 className="font-semibold mb-2">سجل المطابقات — اضغط لفتح</h3>
                  <div className="overflow-x-auto">
                    <table className="data-table text-sm">
                      <thead>
                        <tr>
                          <th>الفترة</th>
                          <th>الحالة</th>
                          <th>الذمة السابقة</th>
                          <th>حركات</th>
                          <th>الذمة الحالية</th>
                          <th>تاريخ الاعتماد</th>
                        </tr>
                      </thead>
                      <tbody>
                        {history.map((row) => (
                          <tr
                            key={row.id}
                            className="cursor-pointer hover:bg-primary-50"
                            onClick={() => void openSavedRecord(row.id)}
                          >
                            <td>{formatWesternDate(row.period_from)} — {formatWesternDate(row.period_to)}</td>
                            <td>{reconciliationStatusLabel(row.status)}</td>
                            <td className={balanceToneClass(Number(row.previous_balance))}>{money(row.previous_balance)}</td>
                            <td className={balanceToneClass(Number(row.period_movement))}>{money(row.period_movement)}</td>
                            <td className={balanceToneClass(Number(row.current_balance))}>{money(row.current_balance)}</td>
                            <td>{row.approved_at ? formatWesternDateTime(row.approved_at) : '—'}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              ) : null}
            </>
          )}

          {!loading && !preview && (
            <p className="text-gray-500 text-sm">اختر وكيلاً واضغط «تحميل معاينة جديدة» لبدء المقارنة الثنائية.</p>
          )}
        </>
      )}

      {activeTab === 'discrepancies' && (
        <div className="card p-3 overflow-x-auto">
          <h3 className="font-semibold mb-2">تقرير الفروقات</h3>
          {!agentId ? <p className="text-sm text-gray-500">اختر وكيلاً من تبويب المطابقة أولاً.</p> : null}
          {agentId && discrepancies.length === 0 ? <p className="text-sm text-gray-500">لا توجد فروقات مسجّلة.</p> : null}
          {discrepancies.length > 0 ? (
            <table className="data-table text-sm">
              <thead>
                <tr>
                  <th>الفترة</th>
                  <th>البند</th>
                  <th>الشركة</th>
                  <th>الوكيل</th>
                  <th>الفرق</th>
                  <th>حالة المطابقة</th>
                </tr>
              </thead>
              <tbody>
                {discrepancies.map((row) => (
                  <tr key={`${row.reconciliation_id}-${row.item_id}`}>
                    <td>{formatWesternDate(row.period_from)} — {formatWesternDate(row.period_to)}</td>
                    <td>{row.description}</td>
                    <td>{money(row.company_amount)}</td>
                    <td>{row.agent_amount == null ? '—' : money(row.agent_amount)}</td>
                    <td className={balanceToneClass(Number(row.difference))}>{money(row.difference)}</td>
                    <td>{reconciliationStatusLabel(row.status)} / {itemStatusLabel(row.item_status)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : null}
        </div>
      )}

      {activeTab === 'history' && (
        <div className="card p-3 overflow-x-auto">
          <h3 className="font-semibold mb-2">تقرير الذمم التاريخي (معتمد فقط)</h3>
          {!agentId ? <p className="text-sm text-gray-500">اختر وكيلاً من تبويب المطابقة أولاً.</p> : null}
          {balanceHistory.length > 0 ? (
            <>
              <FinanceExportToolbar
                disabled={balanceHistory.length === 0}
                csvFileName={`bilateral-balance-history-${agentId}.csv`}
                csvHeaders={['من', 'إلى', 'ذمة البداية', 'حركات', 'ذمة النهاية', 'الحالة']}
                csvRows={balanceHistory.map((row) => [
                  row.period_from,
                  row.period_to,
                  row.previous_balance,
                  row.period_movement,
                  row.current_balance,
                  reconciliationStatusLabel(row.status),
                ])}
                pdfTitle="سجل الذمم — مطابقة ثنائية"
                pdfFileName={`bilateral-balance-history-${new Date().toISOString().split('T')[0]}.pdf`}
                documentType="bilateral_balance_history"
                onBuildPrintHtml={() => `<html><body dir="rtl"><h1>سجل الذمم</h1>${balanceHistory.map((r) => `<p>${formatWesternDate(r.period_from)} - ${formatWesternDate(r.period_to)}: ${r.previous_balance} + ${r.period_movement} = ${r.current_balance}</p>`).join('')}</body></html>`}
              />
              <table className="data-table text-sm mt-2">
                <thead>
                  <tr>
                    <th>الفترة</th>
                    <th>ذمة البداية</th>
                    <th>حركات</th>
                    <th>ذمة النهاية</th>
                    <th>الحالة</th>
                  </tr>
                </thead>
                <tbody>
                  {balanceHistory.map((row) => (
                    <tr key={row.id}>
                      <td>{formatWesternDate(row.period_from)} — {formatWesternDate(row.period_to)}</td>
                      <td className={balanceToneClass(Number(row.previous_balance))}>{money(row.previous_balance)}</td>
                      <td className={balanceToneClass(Number(row.period_movement))}>{money(row.period_movement)}</td>
                      <td className={balanceToneClass(Number(row.current_balance))}>{money(row.current_balance)}</td>
                      <td>{reconciliationStatusLabel(row.status)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </>
          ) : (
            <p className="text-sm text-gray-500">لا توجد مطابقات معتمدة بعد.</p>
          )}
        </div>
      )}

      {forceApproveOpen ? (
        <div className="fixed inset-0 z-[70] flex items-center justify-center bg-black/40 p-4">
          <div className="bg-white rounded-lg shadow-xl w-full max-w-md p-4 space-y-3">
            <h4 className="font-bold">اعتماد قسري مع فروقات</h4>
            <p className="text-sm text-gray-600">يوجد بنود غير متطابقة. أدخل ملاحظة تبرير الاعتماد القسري.</p>
            <textarea className="form-input w-full" rows={3} value={forceNote} onChange={(e) => setForceNote(e.target.value)} />
            <div className="flex gap-2">
              <button type="button" className="toolbar-btn primary flex-1" disabled={saving} onClick={() => void approve(true, forceNote)}>
                تأكيد الاعتماد القسري
              </button>
              <button type="button" className="toolbar-btn flex-1" onClick={() => setForceApproveOpen(false)}>إلغاء</button>
            </div>
          </div>
        </div>
      ) : null}

      {disputeOpen ? (
        <div className="fixed inset-0 z-[70] flex items-center justify-center bg-black/40 p-4">
          <div className="bg-white rounded-lg shadow-xl w-full max-w-md p-4 space-y-3">
            <h4 className="font-bold">تسجيل اعتراض</h4>
            <textarea className="form-input w-full" rows={3} value={disputeNote} onChange={(e) => setDisputeNote(e.target.value)} placeholder="سبب الاعتراض..." />
            <div className="flex gap-2">
              <button type="button" className="toolbar-btn primary flex-1" disabled={saving} onClick={() => void submitDispute()}>
                حفظ الاعتراض
              </button>
              <button type="button" className="toolbar-btn flex-1" onClick={() => setDisputeOpen(false)}>إلغاء</button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
