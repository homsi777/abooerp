export type AgentReconciliationMetrics = {
  agentId: string;
  agentName: string;
  currencyCode: string;
  lastReconciledAt: string | null;
  remainingDue: number;
  periodRemittanceDue: number;
  periodReceipts: number;
  isMatched: boolean;
  companyOwesAgent: number;
};

export function getAgentReconciliationMetrics(data: any): AgentReconciliationMetrics {
  const since = data?.summary?.sinceLastReconciliation ?? data?.summary ?? {};
  const remainingDue = Number(since.agentBalanceDue ?? data?.summary?.agentBalanceDue ?? 0);
  const netAgentDue = Number(since.netAgentDue ?? data?.summary?.netAgentDue ?? 0);
  return {
    agentId: String(data?.agent?.id ?? ''),
    agentName: String(data?.agent?.name ?? ''),
    currencyCode: String(data?.lastReconciliation?.currency_code || 'USD'),
    lastReconciledAt: data?.lastReconciliation?.reconciled_at ?? null,
    remainingDue,
    periodRemittanceDue: Number(since.totalAgentRemittanceDue ?? data?.summary?.totalAgentRemittanceDue ?? 0),
    periodReceipts: Number(since.totalReceipts ?? data?.summary?.totalReceipts ?? 0),
    isMatched: remainingDue <= 0.01,
    companyOwesAgent: Math.max(netAgentDue, 0),
  };
}

export function buildAgentVoucherSearchParams(input: {
  kind: 'receipt' | 'payment';
  agentId: string;
  agentName: string;
  amount: number;
  currency?: string;
  notes?: string;
  returnTo?: string;
}): string {
  const query = new URLSearchParams({
    new: input.kind,
    agentId: input.agentId,
    agentName: input.agentName,
    amount: String(Math.max(input.amount, 0)),
    currency: input.currency || 'USD',
    status: 'confirmed',
  });
  if (input.notes?.trim()) query.set('notes', input.notes.trim());
  if (input.returnTo?.trim()) query.set('returnTo', input.returnTo.trim());
  return query.toString();
}

export function resolveStatementRowReconciliationClass(
  row: { at?: string; source_type?: string; status?: string; debit?: number; credit?: number },
  lastReconciledAt: string | null | undefined,
  periodMatched: boolean,
): string {
  if (lastReconciledAt) {
    const rowAt = new Date(String(row.at)).getTime();
    const cutoff = new Date(String(lastReconciledAt)).getTime();
    if (Number.isFinite(rowAt) && Number.isFinite(cutoff) && rowAt <= cutoff) {
      return 'opacity-70';
    }
  }

  if (periodMatched) return 'bg-green-50';
  if (row.source_type === 'receipt_voucher' && row.status === 'confirmed') return 'bg-green-50';
  if (row.source_type === 'payment_voucher' && row.status === 'confirmed') return 'bg-emerald-50';
  if (Number(row.debit || 0) > 0 || row.source_type === 'shipment_commission') return 'bg-red-50';
  return '';
}
