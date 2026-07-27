import type { DailyLedgerRowWithSession } from '../repositories/dailyLedgerRepository.js';

export type DailyLedgerRowAuditSnapshot = {
  rowId: string;
  rowNo: number;
  receiptNo: string | null;
  ledgerDate: string;
  lineLabel: string;
  originLabel: string | null;
  destination: string;
  parcelType: string;
  parcelCount: number | null;
  weightKg: string | null;
  senderName: string;
  receiverName: string;
  collectUsd: string;
  prepaidUsd: string;
  hawalaUsd: string;
  transferFeeUsd: string;
  notes: string | null;
};

const TRACKED_FIELDS: Array<keyof DailyLedgerRowAuditSnapshot> = [
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

export function dailyLedgerRowAuditSnapshot(row: DailyLedgerRowWithSession): DailyLedgerRowAuditSnapshot {
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

export function diffDailyLedgerRowSnapshots(
  before: DailyLedgerRowAuditSnapshot,
  after: DailyLedgerRowAuditSnapshot,
): { changedFields: string[]; changes: Record<string, { before: unknown; after: unknown }> } {
  const changedFields: string[] = [];
  const changes: Record<string, { before: unknown; after: unknown }> = {};
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
