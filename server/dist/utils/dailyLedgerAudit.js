const TRACKED_FIELDS = [
    'rowNo',
    'receiptNo',
    'ledgerDate',
    'lineLabel',
    'originLabel',
    'destination',
    'parcelType',
    'parcelCount',
    'weightKg',
    'senderName',
    'receiverName',
    'collectUsd',
    'prepaidUsd',
    'hawalaUsd',
    'transferFeeUsd',
    'notes',
];
export function dailyLedgerRowAuditSnapshot(row) {
    return {
        rowId: row.id,
        rowNo: row.row_no,
        receiptNo: row.receipt_no,
        ledgerDate: row.ledger_date,
        lineLabel: row.line_label,
        originLabel: row.origin_label ?? null,
        destination: row.destination,
        parcelType: row.parcel_type,
        parcelCount: row.parcel_count,
        weightKg: row.weight_kg,
        senderName: row.sender_name,
        receiverName: row.receiver_name,
        collectUsd: String(row.collect_amount_usd ?? '0'),
        prepaidUsd: String(row.prepaid_amount_usd ?? '0'),
        hawalaUsd: String(row.hawala_amount_usd ?? '0'),
        transferFeeUsd: String(row.transfer_service_fee_usd ?? '0'),
        notes: row.notes,
    };
}
export function diffDailyLedgerRowSnapshots(before, after) {
    const changedFields = [];
    const changes = {};
    for (const key of TRACKED_FIELDS) {
        const prev = before[key];
        const next = after[key];
        if (String(prev ?? '') !== String(next ?? '')) {
            changedFields.push(key);
            changes[key] = { before: prev ?? null, after: next ?? null };
        }
    }
    return { changedFields, changes };
}
