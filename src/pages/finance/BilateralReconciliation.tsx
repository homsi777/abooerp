import { useEffect, useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { httpClient } from '../../lib/api/httpClient';
import { phase3FinanceGateway } from '../../lib/api/phase3FinanceGateway';
import { useToast } from '../../components/Toast';
import AgentStatementReconciliationPanel from '../../components/agents/AgentStatementReconciliationPanel';
import FinanceExportToolbar from '../../components/finance/FinanceExportToolbar';
import { formatFinanceAmount } from '../../lib/finance/financeArabicLabels';
import { formatWesternDate, formatWesternDateTime } from '../../lib/format/westernDigits';
import { buildBilateralReconciliationPrintHtml } from '../../lib/export/financialStatementPrint';
import { parseDecimalAmount } from '../../lib/currency/currency';

const REPORT_CURRENCY = 'USD';

type BilateralItem = {
  itemType: string;
  description: string;
  companyAmount: number;
  agentAmount: number;
  difference: number;
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
  currentBalance: number;
  items: BilateralItem[];
  summary: { allMatched: boolean; unmatchedItems: number };
  companyPackage?: any;
  lastApproved?: { period_to?: string; current_balance?: number } | null;
};

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

function normalizePreviewItems(items: any[]): BilateralItem[] {
  return (items ?? []).map((item, index) => ({
    itemType: String(item.itemType ?? item.item_type ?? ''),
    description: String(item.description ?? ''),
    companyAmount: Number(item.companyAmount ?? item.company_amount ?? 0),
    agentAmount: Number(item.agentAmount ?? item.agent_amount ?? 0),
    difference: Number(item.difference ?? 0),
    status: String(item.status ?? 'unmatched'),
    notes: item.notes ?? null,
    sortOrder: Number(item.sortOrder ?? item.sort_order ?? index),
  }));
}

export default function BilateralReconciliation() {
  const [searchParams] = useSearchParams();
  const { showToast } = useToast();
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
  const [history, setHistory] = useState<any[]>([]);

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

  const loadPreview = async () => {
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
      setPreview(data);
      setItems(normalizePreviewItems(data.items));
      if (!dateFrom) setDateFrom(toDateInputValue(data.periodFrom));
      if (!dateTo) setDateTo(toDateInputValue(data.periodTo));
      setDraftId(undefined);
      await loadHistory(agentId);
    } catch (e) {
      showToast(e instanceof Error ? e.message : 'تعذر تحميل المطابقة الثنائية', 'error');
      setPreview(null);
      setItems([]);
    } finally {
      setLoading(false);
    }
  };

  const updateAgentAmount = (index: number, raw: string) => {
    const agentAmount = parseDecimalAmount(raw);
    setItems((prev) =>
      prev.map((item, i) => {
        if (i !== index) return item;
        const difference = Math.round((agentAmount - item.companyAmount) * 100) / 100;
        const status = Math.abs(difference) <= 0.01 ? 'matched' : 'unmatched';
        return { ...item, agentAmount, difference, status };
      }),
    );
  };

  const derived = useMemo(() => {
    const balanceItem = items.find((item) => item.itemType === 'balance');
    const unmatched = items.filter((item) => item.status !== 'matched').length;
    return {
      currentBalance: balanceItem?.agentAmount ?? balanceItem?.companyAmount ?? preview?.currentBalance ?? 0,
      allMatched: unmatched === 0,
      unmatched,
    };
  }, [items, preview?.currentBalance]);

  const buildPayload = () => {
    if (!preview) throw new Error('لا توجد بيانات مطابقة.');
    return {
      id: draftId,
      agentId,
      periodFrom: toPeriodIso(dateFrom) ?? preview.periodFrom,
      periodTo: toPeriodIso(dateTo, true) ?? preview.periodTo,
      currencyCode: REPORT_CURRENCY,
      previousBalance: preview.previousBalance,
      currentBalance: derived.currentBalance,
      notes: notes.trim() || undefined,
      agentNotes: agentNotes.trim() || undefined,
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
    if (!preview) return;
    setSaving(true);
    try {
      const saved = await phase3FinanceGateway.accounting.bilateralReconciliation.saveDraft(buildPayload()) as any;
      setDraftId(saved.id);
      showToast('تم حفظ مسودة المطابقة.', 'success');
      await loadHistory(agentId);
    } catch (e) {
      showToast(e instanceof Error ? e.message : 'تعذر حفظ المسودة.', 'error');
    } finally {
      setSaving(false);
    }
  };

  const approve = async () => {
    if (!preview) return;
    setSaving(true);
    try {
      const saved = await phase3FinanceGateway.accounting.bilateralReconciliation.approve(buildPayload()) as any;
      setDraftId(saved.id);
      showToast('تم اعتماد المطابقة وحفظ الذمة.', 'success');
      await loadPreview();
    } catch (e) {
      showToast(e instanceof Error ? e.message : 'تعذر اعتماد المطابقة.', 'error');
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
        previousBalance: preview.previousBalance,
        currentBalance: derived.currentBalance,
        status: derived.allMatched ? 'approved' : 'draft',
        notes,
        agentNotes,
        items: items.map((item) => ({
          description: item.description,
          company_amount: item.companyAmount,
          agent_amount: item.agentAmount,
          difference: item.difference,
          status: item.status,
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
          للكشف التشغيلي فقط (شحن + حوالات + ملخص) استخدم{' '}
          <Link className="text-primary-700 underline" to="/finance/statements/reconciliation/agent-branch">
            كشف وكيل ↔ فرع
          </Link>{' '}
          ضمن مركز الكشوف.
        </p>
      </div>

      <div className="card p-2 flex flex-col gap-2">
        <div className="grid grid-cols-2 md:grid-cols-5 gap-2 items-center">
          <select className="form-select" value={agentId} onChange={(e) => setAgentId(e.target.value)}>
            <option value="">اختر الوكيل</option>
            {agents.map((a) => (
              <option key={a.id} value={a.id}>
                {a.name}{a.governorate ? ` — ${a.governorate}` : ''}
              </option>
            ))}
          </select>
          <input type="date" className="form-input" value={dateFrom} onChange={(e) => setDateFrom(e.target.value)} title="من تاريخ" />
          <input type="date" className="form-input" value={dateTo} onChange={(e) => setDateTo(e.target.value)} title="إلى تاريخ" />
          <div className="text-sm text-gray-600 px-2">العملة: {REPORT_CURRENCY}</div>
          <button type="button" className="toolbar-btn primary" disabled={loading} onClick={() => void loadPreview()}>
            {loading ? 'جاري التحميل...' : 'تحميل المطابقة'}
          </button>
        </div>
        <FinanceExportToolbar
          disabled={!printData}
          csvFileName={`bilateral-reconciliation-${agentId || 'agent'}-${new Date().toISOString().split('T')[0]}.csv`}
          csvHeaders={['البند', 'مبلغ الشركة', 'مبلغ الوكيل', 'الفرق', 'الحالة']}
          csvRows={items.map((item) => [
            item.description,
            item.companyAmount,
            item.agentAmount,
            item.difference,
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
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <div className="stat-card">
              <div className="stat-value text-sm">{formatWesternDateTime(preview.lastApproved?.period_to ?? preview.periodFrom)}</div>
              <div className="stat-label">بداية الفترة (آخر مطابقة)</div>
            </div>
            <div className="stat-card">
              <div className="stat-value">{money(preview.previousBalance)}</div>
              <div className="stat-label">الذمة السابقة</div>
            </div>
            <div className="stat-card ring-2 ring-primary-500/30">
              <div className="stat-value">{money(derived.currentBalance)}</div>
              <div className="stat-label">الذمة الحالية (حسب اتفاق الوكيل)</div>
            </div>
            <div className="stat-card">
              <div className="stat-value">{derived.unmatched}</div>
              <div className="stat-label">بنود غير متطابقة</div>
            </div>
          </div>

          <div className={`rounded-lg border px-4 py-3 ${derived.allMatched ? 'border-green-300 bg-green-50 text-green-900' : 'border-amber-300 bg-amber-50 text-amber-900'}`}>
            <div className="font-bold">
              {derived.allMatched ? '✓ جميع البنود متطابقة — جاهز للاعتماد' : '⚠ يوجد فروقات — راجع أرقام الوكيل قبل الاعتماد'}
            </div>
            <div className="text-sm mt-1">
              الفترة من {formatWesternDate(dateFrom || preview.periodFrom)} إلى {formatWesternDate(dateTo || preview.periodTo)}
            </div>
          </div>

          <div className="card p-0 overflow-x-auto">
            <table className="data-table text-sm">
              <thead>
                <tr>
                  <th>البند</th>
                  <th>مبلغ الشركة (الفرع)</th>
                  <th>مبلغ الوكيل</th>
                  <th>الفرق</th>
                  <th>الحالة</th>
                </tr>
              </thead>
              <tbody>
                {items.map((item, index) => (
                  <tr key={`${item.itemType}-${item.description}`} className={item.status === 'matched' ? '' : 'bg-amber-50'}>
                    <td>{item.description}</td>
                    <td>{money(item.companyAmount)}</td>
                    <td>
                      <input
                        type="number"
                        step="0.01"
                        className="form-input w-32"
                        value={item.agentAmount}
                        onChange={(e) => updateAgentAmount(index, e.target.value)}
                      />
                    </td>
                    <td>{money(item.difference)}</td>
                    <td>{itemStatusLabel(item.status)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <div className="form-group">
              <label className="form-label">ملاحظات الفرع الرئيسي</label>
              <textarea className="form-input w-full" rows={3} value={notes} onChange={(e) => setNotes(e.target.value)} />
            </div>
            <div className="form-group">
              <label className="form-label">ملاحظات / إقرار الوكيل</label>
              <textarea className="form-input w-full" rows={3} value={agentNotes} onChange={(e) => setAgentNotes(e.target.value)} />
            </div>
          </div>

          <div className="flex flex-wrap gap-2 items-center">
            <button type="button" className="toolbar-btn" disabled={saving} onClick={() => void saveDraft()}>
              {saving ? 'جاري الحفظ...' : 'حفظ مسودة'}
            </button>
            <button type="button" className="toolbar-btn primary" disabled={saving} onClick={() => void approve()}>
              {saving ? 'جاري الاعتماد...' : 'اعتماد المطابقة وحفظ الذمة'}
            </button>
          </div>

          {preview.companyPackage ? (
            <AgentStatementReconciliationPanel
              statementData={preview.companyPackage}
              reconciliationSaving={saving}
              onSaveReconciliation={approve}
              onRefresh={loadPreview}
              returnPath="/finance/bilateral-reconciliation"
              currencyCode={REPORT_CURRENCY}
            />
          ) : null}

          {history.length > 0 ? (
            <div className="card p-3">
              <h3 className="font-semibold mb-2">سجل المطابقات السابقة</h3>
              <div className="overflow-x-auto">
                <table className="data-table text-sm">
                  <thead>
                    <tr>
                      <th>الفترة</th>
                      <th>الحالة</th>
                      <th>الذمة السابقة</th>
                      <th>الذمة الحالية</th>
                      <th>تاريخ الاعتماد</th>
                    </tr>
                  </thead>
                  <tbody>
                    {history.map((row) => (
                      <tr key={row.id}>
                        <td>{formatWesternDate(row.period_from)} — {formatWesternDate(row.period_to)}</td>
                        <td>{row.status}</td>
                        <td>{money(row.previous_balance)}</td>
                        <td>{money(row.current_balance)}</td>
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
        <p className="text-gray-500 text-sm">اختر وكيلاً واضغط «تحميل المطابقة» لبدء المقارنة الثنائية.</p>
      )}
    </div>
  );
}
