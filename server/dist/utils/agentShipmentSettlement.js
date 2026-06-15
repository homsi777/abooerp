/** Agent settlement: commission on shipping only; remittance includes COD + hawala + hawala fees minus commission. */
function money(value) {
    const n = Number(value ?? 0);
    if (!Number.isFinite(n))
        return 0;
    return Math.round(n * 100) / 100;
}
/** Shipping price basis for commission (prepaid + freight + COD collect). */
export function resolveAgentShippingPrice(input) {
    const prepaid = money(input.prepaidAmount);
    const freight = money(input.freightCharge);
    const collect = money(input.transferFee);
    if (prepaid > 0) {
        return Math.max(prepaid + collect, 0);
    }
    return Math.max(freight + collect, 0);
}
/** Cash collected at origin / main branch — not remitted by destination agent. */
export function resolvePrepaidAtMainBranch(input) {
    const prepaid = money(input.prepaidAmount);
    if (prepaid > 0)
        return prepaid;
    const freight = money(input.freightCharge);
    const collect = money(input.transferFee);
    if (freight > 0 && collect === 0)
        return freight;
    // دفتر الشحن: المسبق في freight_charge والتحصيل في transfer_fee على نفس السطر
    if (freight > 0 && collect > 0)
        return freight;
    return 0;
}
/** Commission attributable to prepaid portion (company owes agent; cash stayed at main branch). */
export function computeCommissionOnPrepaidPortion(input) {
    const prepaidAtBranch = resolvePrepaidAtMainBranch(input);
    const commission = money(input.agentCommissionAmount);
    if (prepaidAtBranch <= 0 || commission <= 0)
        return 0;
    const base = resolveAgentShippingPrice({
        freightCharge: input.freightCharge,
        transferFee: input.transferFee,
        prepaidAmount: input.prepaidAmount,
    });
    if (base <= 0)
        return 0;
    return money((commission * prepaidAtBranch) / base);
}
/** Gross liability on agent excluding prepaid at main branch, minus full shipping commission. */
export function computeNetRequiredFromAgent(input) {
    const collect = money(input.transferFee);
    const hawala = computeAgentHawalaRemittanceDue(input);
    const commission = money(input.agentCommissionAmount);
    return Math.max(collect + hawala - commission, 0);
}
/** Commission on COD portion (after prepaid share is separated). */
export function computeCommissionOnCollectPortion(input) {
    const commission = money(input.agentCommissionAmount);
    const prepaidPart = computeCommissionOnPrepaidPortion(input);
    return Math.max(commission - prepaidPart, 0);
}
/** COD/shipping remittance — commission on collect only; prepaid stays at main branch. */
export function computeAgentShippingRemittanceDue(input) {
    const collect = money(input.transferFee);
    const commissionOnCollect = computeCommissionOnCollectPortion(input);
    return Math.max(collect - commissionOnCollect, 0);
}
/** Hawala principal + service fee — no agent commission. */
export function computeAgentHawalaRemittanceDue(input) {
    return money(input.hawalaAmount) + money(input.transferServiceFee);
}
export function computeAgentRemittanceDue(input) {
    return computeAgentShippingRemittanceDue(input) + computeAgentHawalaRemittanceDue(input);
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
