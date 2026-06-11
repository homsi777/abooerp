import { convertToUsd, getRateToUsd, parseDecimalAmount, type CurrencyCode } from '../currency/currency';
import type { BackendCashboxRecord } from '../api/phase3FinanceGateway';

export type VoucherGridRowStatus = 'new' | 'draft' | 'confirmed' | 'cancelled';
export type VoucherGridSaveState = 'idle' | 'dirty' | 'saving' | 'saved' | 'error';

export type VoucherGridRow = {
  localId: string;
  kind: 'receipt' | 'payment';
  date: string;
  relatedParty: string;
  customerId: string | null;
  agentId: string | null;
  amount: string;
  currency: CurrencyCode;
  cashboxId: string;
  description: string;
  voucherNo: string;
  syntheticId?: number;
  backendId?: string;
  status: VoucherGridRowStatus;
  saveState: VoucherGridSaveState;
  selected: boolean;
  errorMessage?: string;
};

let gridRowSeq = 0;

export function createVoucherGridRow(partial: Partial<VoucherGridRow> = {}): VoucherGridRow {
  gridRowSeq += 1;
  return {
    localId: partial.localId ?? `vgr-${Date.now()}-${gridRowSeq}`,
    kind: partial.kind ?? 'receipt',
    date: partial.date ?? new Date().toISOString().split('T')[0],
    relatedParty: partial.relatedParty ?? '',
    customerId: partial.customerId ?? null,
    agentId: partial.agentId ?? null,
    amount: partial.amount ?? '',
    currency: partial.currency ?? 'USD',
    cashboxId: partial.cashboxId ?? '',
    description: partial.description ?? '',
    voucherNo: partial.voucherNo ?? '',
    syntheticId: partial.syntheticId,
    backendId: partial.backendId,
    status: partial.status ?? 'new',
    saveState: partial.saveState ?? 'idle',
    selected: partial.selected ?? false,
    errorMessage: partial.errorMessage,
  };
}

export function isVoucherGridRowStarted(row: VoucherGridRow): boolean {
  return Boolean(
    row.relatedParty.trim() ||
      row.customerId ||
      row.agentId ||
      parseDecimalAmount(row.amount) > 0 ||
      row.description.trim() ||
      row.voucherNo.trim(),
  );
}

export function voucherGridRowUsd(row: VoucherGridRow, rates: ReturnType<typeof import('../currency/currency').getExchangeRatesToUsd>): number {
  return convertToUsd(parseDecimalAmount(row.amount), row.currency, rates);
}

export function buildVoucherPayload(
  row: VoucherGridRow,
  options: {
    rates: ReturnType<typeof import('../currency/currency').getExchangeRatesToUsd>;
    canBackdate: boolean;
    todayIso: string;
    confirm?: boolean;
  },
): { payload: Record<string, unknown>; error?: string } {
  const amount = parseDecimalAmount(row.amount);
  if (amount <= 0) return { payload: {}, error: 'المبلغ يجب أن يكون أكبر من صفر' };
  if (row.date > options.todayIso) return { payload: {}, error: 'لا يمكن استخدام تاريخ مستقبلي' };
  if (row.date !== options.todayIso && !options.canBackdate) {
    return { payload: {}, error: 'التاريخ مقيد بيوم اليوم' };
  }

  const manualPartyName = row.relatedParty.trim();
  const isManualParty = !row.customerId && !row.agentId && manualPartyName.length > 0;
  if (!row.customerId && !row.agentId && !isManualParty) {
    return { payload: {}, error: 'يجب اختيار أو كتابة الجهة' };
  }

  const nextStatus = options.confirm ? 'confirmed' : 'draft';
  if (nextStatus === 'confirmed' && !row.cashboxId) {
    return { payload: {}, error: 'يلزم اختيار صندوق للترحيل' };
  }

  const voucherNo =
    row.voucherNo ||
    (row.kind === 'receipt' ? `RV-${Date.now()}` : `PV-${Date.now()}`);

  const payload: Record<string, unknown> = {
    voucherNo,
    originalAmount: amount,
    originalCurrency: row.currency,
    exchangeRateToUsd: getRateToUsd(row.currency, options.rates),
    customerId: row.customerId || undefined,
    agentId: row.agentId || undefined,
    relatedEntityType: isManualParty ? 'manual_party' : undefined,
    notes: isManualParty
      ? [`جهة: ${manualPartyName}`, row.description.trim()].filter(Boolean).join(' - ')
      : row.description.trim(),
    status: nextStatus,
    cashboxId: row.cashboxId || undefined,
  };

  if (options.canBackdate && row.date) {
    payload.createdAt = new Date(`${row.date}T12:00:00`).toISOString();
  }

  return { payload, error: undefined };
}

export function cashboxesForCurrency(cashboxes: BackendCashboxRecord[], currency: CurrencyCode): BackendCashboxRecord[] {
  return cashboxes.filter((c) => c.is_active && c.currency_code === currency);
}

export function resolveAgentCashbox(
  cashboxes: BackendCashboxRecord[],
  agentId: string,
  currency: CurrencyCode,
): BackendCashboxRecord | undefined {
  return (
    cashboxes.find((c) => c.is_active && c.agent_id === agentId && c.currency_code === currency) ??
    cashboxes.find((c) => c.is_active && c.agent_id === agentId)
  );
}
