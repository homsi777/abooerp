import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { phase3FinanceGateway, type BackendCashboxRecord } from '../../lib/api/phase3FinanceGateway';
import { getRateToUsd, getExchangeRatesToUsd, parseDecimalAmount, type CurrencyCode } from '../../lib/currency/currency';
import {
  buildAgentVoucherSearchParams,
  getAgentReconciliationMetrics,
  type AgentReconciliationMetrics,
} from '../../lib/agents/agentStatementReconciliation';
import { useToast } from '../Toast';

type QuickVoucherKind = 'receipt' | 'payment';

type Props = {
  statementData: any;
  reconciliationSaving: boolean;
  onSaveReconciliation: () => void | Promise<void>;
  onRefresh?: () => void | Promise<void>;
  returnPath?: string;
};

function money(value: number, currency = 'USD') {
  return `${Number(value || 0).toLocaleString('ar-SY', { maximumFractionDigits: 2 })} ${currency}`;
}

export default function AgentStatementReconciliationPanel({
  statementData,
  reconciliationSaving,
  onSaveReconciliation,
  onRefresh,
  returnPath,
}: Props) {
  const navigate = useNavigate();
  const { showToast } = useToast();
  const metrics = useMemo(() => getAgentReconciliationMetrics(statementData), [statementData]);
  const [cashboxes, setCashboxes] = useState<BackendCashboxRecord[]>([]);
  const [quickKind, setQuickKind] = useState<QuickVoucherKind | null>(null);
  const [quickSaving, setQuickSaving] = useState(false);
  const [quickForm, setQuickForm] = useState({
    amount: 0,
    currency: 'USD' as CurrencyCode,
    cashboxId: '',
    notes: '',
    status: 'confirmed' as 'draft' | 'confirmed',
  });

  useEffect(() => {
    phase3FinanceGateway.cashbox.listMaster().then(setCashboxes).catch(() => setCashboxes([]));
  }, []);

  const cashboxesForAgent = useMemo(
    () => cashboxes.filter((c) => c.is_active && c.agent_id === metrics.agentId && c.currency_code === quickForm.currency),
    [cashboxes, metrics.agentId, quickForm.currency],
  );

  useEffect(() => {
    if (!quickKind || cashboxesForAgent.length !== 1 || quickForm.cashboxId) return;
    setQuickForm((prev) => ({ ...prev, cashboxId: cashboxesForAgent[0].id }));
  }, [cashboxesForAgent, quickForm.cashboxId, quickKind]);

  const openQuickVoucher = (kind: QuickVoucherKind) => {
    const amount = kind === 'receipt' ? metrics.remainingDue : metrics.companyOwesAgent;
    if (amount <= 0.01) {
      showToast(kind === 'receipt' ? 'لا توجد ذمة متبقية على الوكيل.' : 'لا يوجد مستحق دفع للوكيل في هذه الفترة.', 'error');
      return;
    }
    setQuickForm({
      amount,
      currency: metrics.currencyCode as CurrencyCode,
      cashboxId: '',
      notes: `مطابقة حساب الوكيل ${metrics.agentName} — ${kind === 'receipt' ? 'قبض' : 'دفع'}`,
      status: 'confirmed',
    });
    setQuickKind(kind);
  };

  const openFullVoucherPage = (kind: QuickVoucherKind) => {
    const amount = kind === 'receipt' ? metrics.remainingDue : metrics.companyOwesAgent;
    const query = buildAgentVoucherSearchParams({
      kind,
      agentId: metrics.agentId,
      agentName: metrics.agentName,
      amount,
      currency: metrics.currencyCode,
      notes: `مطابقة حساب الوكيل ${metrics.agentName}`,
      returnTo: returnPath,
    });
    navigate(`/finance/vouchers?${query}`);
  };

  const saveQuickVoucher = async () => {
    if (!quickKind) return;
    if (quickForm.amount <= 0) {
      showToast('المبلغ غير صالح.', 'error');
      return;
    }
    if (quickForm.status === 'confirmed' && !quickForm.cashboxId) {
      showToast('يجب اختيار صندوق لتأكيد السند.', 'error');
      return;
    }
    setQuickSaving(true);
    try {
      const rates = getExchangeRatesToUsd();
      const payload = {
        voucherNo: `${quickKind === 'receipt' ? 'RV' : 'PV'}-AG-${Date.now()}`,
        originalAmount: quickForm.amount,
        originalCurrency: quickForm.currency,
        exchangeRateToUsd: getRateToUsd(quickForm.currency, rates),
        agentId: metrics.agentId,
        notes: quickForm.notes.trim(),
        status: quickForm.status,
        cashboxId: quickForm.cashboxId || undefined,
      };
      if (quickKind === 'receipt') {
        await phase3FinanceGateway.receiptVouchers.create(payload);
      } else {
        await phase3FinanceGateway.paymentVouchers.create(payload);
      }
      showToast('تم حفظ السند وربطه بالوكيل.', 'success');
      setQuickKind(null);
      await onRefresh?.();
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'تعذر حفظ السند.', 'error');
    } finally {
      setQuickSaving(false);
    }
  };

  return (
    <>
      <ReconciliationStatusBanner metrics={metrics} />

      <div className="flex flex-wrap gap-2 items-center">
        <button type="button" className="toolbar-btn success" onClick={() => openQuickVoucher('receipt')}>
          سند قبض
        </button>
        <button type="button" className="toolbar-btn" onClick={() => openQuickVoucher('payment')}>
          سند دفع
        </button>
        <button
          type="button"
          className="toolbar-btn primary"
          disabled={reconciliationSaving || !metrics.isMatched}
          title={metrics.isMatched ? 'حفظ تاريخ المطابقة' : 'يجب تصفير الذمة أولاً عبر سند قبض'}
          onClick={() => void onSaveReconciliation()}
        >
          {reconciliationSaving ? 'جاري الحفظ...' : 'حفظ مطابقة الفترة'}
        </button>
        <span className="text-xs text-gray-500 mr-auto">
          {metrics.isMatched
            ? 'الحساب متوازن — يمكن حفظ المطابقة.'
            : 'سجّل سند قبض بقيمة الذمة المتبقية ثم احفظ المطابقة.'}
        </span>
      </div>

      <div className="flex flex-wrap gap-2 text-sm">
        <Link className="toolbar-btn text-xs" to={`/finance/agent-cod-statement?agentId=${encodeURIComponent(metrics.agentId)}&currencyCode=${encodeURIComponent(metrics.currencyCode)}`}>
          كشف COD / الذمم
        </Link>
        <Link className="toolbar-btn text-xs" to={`/finance/general-ledger?partyType=agent&search=${encodeURIComponent(metrics.agentName)}`}>
          دفتر الأستاذ
        </Link>
        <button type="button" className="toolbar-btn text-xs" onClick={() => openFullVoucherPage('receipt')}>
          فتح السندات
        </button>
        <Link className="toolbar-btn text-xs" to={`/finance/cashboxes?agentId=${encodeURIComponent(metrics.agentId)}`}>
          صناديق الوكيل
        </Link>
      </div>

      {quickKind ? (
        <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/40 p-4">
          <div className="bg-white rounded-lg shadow-xl w-full max-w-md p-4 space-y-3">
            <div className="flex items-center justify-between border-b pb-2">
              <h4 className="font-bold">{quickKind === 'receipt' ? 'سند قبض من الوكيل' : 'سند دفع للوكيل'}</h4>
              <button type="button" className="toolbar-btn" onClick={() => setQuickKind(null)}>إغلاق</button>
            </div>
            <div className="text-sm text-gray-600">
              الوكيل: <strong>{metrics.agentName}</strong>
            </div>
            <div className="form-group">
              <label className="form-label">المبلغ</label>
              <input
                type="number"
                step="0.01"
                className="form-input w-full"
                value={quickForm.amount}
                onChange={(e) => setQuickForm((prev) => ({ ...prev, amount: parseDecimalAmount(e.target.value) }))}
              />
            </div>
            <div className="form-group">
              <label className="form-label">العملة</label>
              <select
                className="form-select w-full"
                value={quickForm.currency}
                onChange={(e) => setQuickForm((prev) => ({ ...prev, currency: e.target.value as CurrencyCode, cashboxId: '' }))}
              >
                <option value="USD">USD</option>
                <option value="SYP">SYP</option>
                <option value="TRY">TRY</option>
              </select>
            </div>
            <div className="form-group">
              <label className="form-label">الصندوق</label>
              <select
                className="form-select w-full"
                value={quickForm.cashboxId}
                onChange={(e) => setQuickForm((prev) => ({ ...prev, cashboxId: e.target.value }))}
              >
                <option value="">اختر صندوقاً...</option>
                {cashboxesForAgent.map((c) => (
                  <option key={c.id} value={c.id}>{c.name} ({c.code})</option>
                ))}
              </select>
              {cashboxesForAgent.length === 0 ? (
                <p className="text-xs text-amber-700 mt-1">لا يوجد صندوق نشط لهذا الوكيل بهذه العملة.</p>
              ) : null}
            </div>
            <div className="form-group">
              <label className="form-label">البيان</label>
              <textarea
                className="form-input w-full"
                rows={2}
                value={quickForm.notes}
                onChange={(e) => setQuickForm((prev) => ({ ...prev, notes: e.target.value }))}
              />
            </div>
            <div className="flex gap-2">
              <button type="button" className="toolbar-btn primary flex-1" disabled={quickSaving} onClick={() => void saveQuickVoucher()}>
                {quickSaving ? 'جاري الحفظ...' : 'تأكيد وحفظ السند'}
              </button>
              <button type="button" className="toolbar-btn flex-1" onClick={() => openFullVoucherPage(quickKind)}>
                فتح في السندات
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </>
  );
}

function ReconciliationStatusBanner({ metrics }: { metrics: AgentReconciliationMetrics }) {
  const periodLabel = metrics.lastReconciledAt
    ? `من ${new Date(metrics.lastReconciledAt).toLocaleDateString('ar-SY')} حتى الآن`
    : 'من بداية الحساب حتى الآن';

  if (metrics.isMatched) {
    return (
      <div className="rounded-lg border border-green-300 bg-green-50 px-4 py-3 text-green-900">
        <div className="font-bold">✓ تمت المطابقة — الحساب متوازن</div>
        <div className="text-sm mt-1">
          {periodLabel} — لا يوجد ذمة متبقية. يمكنك حفظ مطابقة الفترة الآن.
        </div>
      </div>
    );
  }

  return (
    <div className="rounded-lg border border-red-300 bg-red-50 px-4 py-3 text-red-900">
      <div className="font-bold">✗ مطابقة غير مكتملة — ذمة على الوكيل</div>
      <div className="text-sm mt-1 flex flex-wrap gap-x-4 gap-y-1">
        <span>{periodLabel}</span>
        <span>مطلوب من الوكيل: <strong>{money(metrics.periodRemittanceDue, metrics.currencyCode)}</strong></span>
        <span>مسدّد (سندات قبض): <strong>{money(metrics.periodReceipts, metrics.currencyCode)}</strong></span>
        <span className="font-bold">متبقي للمطابقة: {money(metrics.remainingDue, metrics.currencyCode)}</span>
      </div>
    </div>
  );
}
