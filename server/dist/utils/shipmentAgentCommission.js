/** Agent commission is a percentage of the shipment shipping price (تحصيل أو دفع مسبق). */
function money(value) {
    const n = Number(value ?? 0);
    if (!Number.isFinite(n))
        return 0;
    return Math.round(n * 100) / 100;
}
function roundMoney(n) {
    return Math.round(n * 100) / 100;
}
/** Shipping price: prepaid + collect (دفتر الشحن يضع المسبق في freight والتحصيل في transfer_fee). */
export function resolveShipmentShippingPrice(input) {
    const prepaid = money(input.prepaidAmount);
    if (prepaid > 0) {
        return Math.max(prepaid + money(input.transferFee), 0);
    }
    return Math.max(money(input.freightCharge) + money(input.transferFee), 0);
}
export function computeAgentCommissionSnapshot(input) {
    const agentCommissionPercentageSnapshot = money(input.commissionPercentage);
    const agentCommissionBaseAmount = resolveShipmentShippingPrice(input);
    const agentCommissionAmountSnapshot = roundMoney((agentCommissionBaseAmount * agentCommissionPercentageSnapshot) / 100);
    return {
        agentCommissionBaseType: 'FREIGHT_CHARGE',
        agentCommissionBaseAmount,
        agentCommissionPercentageSnapshot,
        agentCommissionAmountSnapshot,
    };
}
