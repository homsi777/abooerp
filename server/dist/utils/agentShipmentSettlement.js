/** Agent settlement: commission on shipping only; remittance includes COD + hawala + hawala fees minus commission. */
function money(value) {
    const n = Number(value ?? 0);
    if (!Number.isFinite(n))
        return 0;
    return Math.round(n * 100) / 100;
}
/** Shipping price basis for commission (freight + COD collect). */
export function resolveAgentShippingPrice(input) {
    return Math.max(money(input.freightCharge) + money(input.transferFee), 0);
}
/**
 * Net amount the agent must remit to the company for this shipment.
 * Prepaid shipping is excluded from remittance (collected at origin).
 */
export function computeAgentRemittanceDue(input) {
    const collect = money(input.transferFee);
    const hawala = money(input.hawalaAmount);
    const hawalaFee = money(input.transferServiceFee);
    const commission = money(input.agentCommissionAmount);
    return Math.max(collect + hawala + hawalaFee - commission, 0);
}
/** Positive = agent owes the company (outstanding liability). */
export function computeAgentBalanceDue(input) {
    const receipts = money(input.confirmedReceiptsFromAgent);
    const payments = money(input.confirmedPaymentsToAgent);
    return Math.max(money(input.totalRemittanceDue) - receipts + payments, 0);
}
