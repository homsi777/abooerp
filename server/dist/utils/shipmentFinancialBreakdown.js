function money(value) {
    const n = Number(value ?? 0);
    if (!Number.isFinite(n))
        return 0;
    return Math.round(n * 100) / 100;
}
function hasExplicitValue(value) {
    return value !== null && value !== undefined && Number(value) !== 0;
}
export function calculateShipmentFinancialBreakdown(row) {
    const originalAmount = money(row.original_amount);
    const senderCollectionAmount = money(row.transfer_fee);
    const loadingDuesAmount = money(row.additional_charges);
    const hawalaAmount = money(row.hawala_amount);
    const transferServiceFeeAmount = money(row.transfer_service_fee);
    const generalCollectionAmount = money(row.general_collection_amount);
    const prepaidAmount = money(row.prepaid_amount);
    const discountAmount = money(row.discount_amount);
    const hasSeparatedComponents = hasExplicitValue(row.transfer_fee) ||
        hasExplicitValue(row.additional_charges) ||
        hasExplicitValue(row.hawala_amount) ||
        hasExplicitValue(row.transfer_service_fee) ||
        hasExplicitValue(row.general_collection_amount) ||
        hasExplicitValue(row.prepaid_amount) ||
        hasExplicitValue(row.discount_amount);
    const explicitFreight = hasExplicitValue(row.freight_charge);
    const freightValue = money(row.freight_charge);
    const freightLooksLikeLegacyBackfill = hasSeparatedComponents &&
        explicitFreight &&
        originalAmount > 0 &&
        Math.abs(freightValue - originalAmount) < 0.01;
    const companyShippingFee = explicitFreight && !freightLooksLikeLegacyBackfill
        ? freightValue
        : hasSeparatedComponents
            ? money(Math.max(originalAmount - senderCollectionAmount - loadingDuesAmount - hawalaAmount - transferServiceFeeAmount - generalCollectionAmount + prepaidAmount + discountAmount, 0))
            : originalAmount;
    return {
        companyShippingFee,
        senderCollectionAmount,
        loadingDuesAmount,
        hawalaAmount,
        transferServiceFeeAmount,
        generalCollectionAmount,
        prepaidAmount,
        discountAmount,
        totalDueOnDelivery: money(companyShippingFee +
            senderCollectionAmount +
            loadingDuesAmount +
            hawalaAmount +
            transferServiceFeeAmount +
            generalCollectionAmount -
            prepaidAmount -
            discountAmount),
    };
}
export function buildShipmentBreakdownMetadata(breakdown) {
    return {
        company_shipping_fee: breakdown.companyShippingFee,
        sender_collection_amount: breakdown.senderCollectionAmount,
        loading_dues_amount: breakdown.loadingDuesAmount,
        hawala_amount: breakdown.hawalaAmount,
        transfer_service_fee_amount: breakdown.transferServiceFeeAmount,
        general_collection_amount: breakdown.generalCollectionAmount,
        prepaid_amount: breakdown.prepaidAmount,
        discount_amount: breakdown.discountAmount,
        total_due_on_delivery: breakdown.totalDueOnDelivery,
    };
}
