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
export function resolveAgentTransferRole(agentId, originAgentId, destinationAgentId, legacyAgentId) {
    const id = String(agentId);
    const isOrigin = Boolean(originAgentId && String(originAgentId) === id);
    const isDestination = Boolean((destinationAgentId && String(destinationAgentId) === id)
        || (!destinationAgentId && legacyAgentId && String(legacyAgentId) === id));
    if (isOrigin && isDestination)
        return 'both';
    if (isOrigin)
        return 'origin';
    if (isDestination)
        return 'destination';
    return 'none';
}
/** Net remittance for standalone transfers (hawala not already on a shipment row). */
export function computeAgentTransferRemittanceDue(input) {
    if (input.linkedShipmentId)
        return 0;
    const status = String(input.status || '').toUpperCase();
    if (status === 'CANCELLED' || input.agentRole === 'none' || input.agentRole === 'destination') {
        return 0;
    }
    if (!input.collectedAt && status !== 'COMPLETED' && status !== 'PENDING') {
        return 0;
    }
    return Math.max(money(input.amount) + money(input.transferServiceFee), 0);
}
