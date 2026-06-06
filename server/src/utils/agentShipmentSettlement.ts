/** Agent settlement: commission on shipping only; remittance includes COD + hawala + hawala fees minus commission. */

function money(value: number | string | null | undefined): number {
  const n = Number(value ?? 0);
  if (!Number.isFinite(n)) return 0;
  return Math.round(n * 100) / 100;
}

export type AgentShipmentSettlementInput = {
  freightCharge?: number | string | null;
  transferFee?: number | string | null;
  hawalaAmount?: number | string | null;
  transferServiceFee?: number | string | null;
  prepaidAmount?: number | string | null;
  agentCommissionAmount?: number | string | null;
};

/** Shipping price basis for commission (freight + COD collect). */
export function resolveAgentShippingPrice(input: {
  freightCharge?: number | string | null;
  transferFee?: number | string | null;
}): number {
  return Math.max(money(input.freightCharge) + money(input.transferFee), 0);
}

/**
 * Net amount the agent must remit to the company for this shipment.
 * Prepaid shipping is excluded from remittance (collected at origin).
 */
export function computeAgentRemittanceDue(input: AgentShipmentSettlementInput): number {
  const collect = money(input.transferFee);
  const hawala = money(input.hawalaAmount);
  const hawalaFee = money(input.transferServiceFee);
  const commission = money(input.agentCommissionAmount);
  return Math.max(collect + hawala + hawalaFee - commission, 0);
}

/** Positive = agent owes the company (outstanding liability). */
export function computeAgentBalanceDue(input: {
  totalRemittanceDue: number;
  totalShippingCommission: number;
  confirmedReceiptsFromAgent: number;
  confirmedPaymentsToAgent?: number;
}): number {
  const receipts = money(input.confirmedReceiptsFromAgent);
  const payments = money(input.confirmedPaymentsToAgent);
  return Math.max(money(input.totalRemittanceDue) - receipts + payments, 0);
}
