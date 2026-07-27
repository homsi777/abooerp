import { parseUsd, parseWeightKg } from './ledgerTariffPricing';
import type { RemoteDailyLedgerRow } from './dailyLedgerTypes';
import { remoteRowCollectionUsd, remoteRowWeightKg } from './dailyLedgerPrintable';

/** مبالغ سطر محلي (نفس حقول واجهة الإدخال) */
export type LocalLedgerMoneyRow = {
  collectAmount: string;
  prepaidAmount: string;
  receiverCollect: string;
  transferServiceFee: string;
};

export type DailyLedgerFinancialTotals = {
  rowCount: number;
  piecesCount: number;
  weightKg: number;
  /** تحصيل COD + fees_amount */
  collectionUsd: number;
  /** أجور شحن مسبقة */
  prepaidUsd: number;
  /** مبالغ حوالة */
  hawalaUsd: number;
  /** أجور خدمة الحوالة */
  transferServiceFeeUsd: number;
  /**
   * «إجمالي الدولار» على الشاشة = تحصيل + حوالة + أجرة حوالة (بدون مسبق)
   */
  screenMoneyTotalUsd: number;
  /** مجموع كل الأعمدة المالية الأربعة */
  grandTotalUsd: number;
};

export function collectionUsdFromLocal(row: LocalLedgerMoneyRow): number {
  return parseUsd(row.collectAmount);
}

export function screenMoneyTotalFromLocal(row: LocalLedgerMoneyRow): number {
  return Math.max(
    parseUsd(row.collectAmount) + parseUsd(row.receiverCollect) + parseUsd(row.transferServiceFee),
    0,
  );
}

export function computeTotalsFromLocalRows(rows: LocalLedgerMoneyRow[]): DailyLedgerFinancialTotals {
  let piecesCount = 0;
  let weightKg = 0;
  let collectionUsd = 0;
  let prepaidUsd = 0;
  let hawalaUsd = 0;
  let transferServiceFeeUsd = 0;

  for (const row of rows) {
    collectionUsd += collectionUsdFromLocal(row);
    prepaidUsd += parseUsd(row.prepaidAmount);
    hawalaUsd += parseUsd(row.receiverCollect);
    transferServiceFeeUsd += parseUsd(row.transferServiceFee);
  }

  const screenMoneyTotalUsd = collectionUsd + hawalaUsd + transferServiceFeeUsd;
  const grandTotalUsd = screenMoneyTotalUsd + prepaidUsd;

  return {
    rowCount: rows.length,
    piecesCount,
    weightKg,
    collectionUsd,
    prepaidUsd,
    hawalaUsd,
    transferServiceFeeUsd,
    screenMoneyTotalUsd,
    grandTotalUsd,
  };
}

export function computeTotalsFromLocalRowsWithMeta(
  rows: Array<LocalLedgerMoneyRow & { parcelCount?: string; weightKg?: string }>,
): DailyLedgerFinancialTotals {
  let piecesCount = 0;
  let weightKg = 0;
  let collectionUsd = 0;
  let prepaidUsd = 0;
  let hawalaUsd = 0;
  let transferServiceFeeUsd = 0;

  for (const row of rows) {
    piecesCount += Number(row.parcelCount) || 0;
    weightKg += parseWeightKg(row.weightKg ?? '') ?? 0;
    collectionUsd += collectionUsdFromLocal(row);
    prepaidUsd += parseUsd(row.prepaidAmount);
    hawalaUsd += parseUsd(row.receiverCollect);
    transferServiceFeeUsd += parseUsd(row.transferServiceFee);
  }

  const screenMoneyTotalUsd = collectionUsd + hawalaUsd + transferServiceFeeUsd;
  const grandTotalUsd = screenMoneyTotalUsd + prepaidUsd;

  return {
    rowCount: rows.length,
    piecesCount,
    weightKg,
    collectionUsd,
    prepaidUsd,
    hawalaUsd,
    transferServiceFeeUsd,
    screenMoneyTotalUsd,
    grandTotalUsd,
  };
}

export function computeTotalsFromRemoteRows(rows: RemoteDailyLedgerRow[]): DailyLedgerFinancialTotals {
  let piecesCount = 0;
  let weightKg = 0;
  let collectionUsd = 0;
  let prepaidUsd = 0;
  let hawalaUsd = 0;
  let transferServiceFeeUsd = 0;

  for (const row of rows) {
    piecesCount += Number(row.parcel_count) || 0;
    weightKg += remoteRowWeightKg(row);
    collectionUsd += remoteRowCollectionUsd(row);
    prepaidUsd += parseUsd(String(row.prepaid_amount_usd ?? ''));
    hawalaUsd += parseUsd(String(row.hawala_amount_usd ?? ''));
    transferServiceFeeUsd += parseUsd(String(row.transfer_service_fee_usd ?? ''));
  }

  const screenMoneyTotalUsd = collectionUsd + hawalaUsd + transferServiceFeeUsd;
  const grandTotalUsd = screenMoneyTotalUsd + prepaidUsd;

  return {
    rowCount: rows.length,
    piecesCount,
    weightKg,
    collectionUsd,
    prepaidUsd,
    hawalaUsd,
    transferServiceFeeUsd,
    screenMoneyTotalUsd,
    grandTotalUsd,
  };
}

export function formatUsdAmount(n: number): string {
  return n.toLocaleString('en-US', { maximumFractionDigits: 2 });
}
