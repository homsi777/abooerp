import {
  buildDailyLedgerHeaderFields,
  companyPrintHeaderStyles,
  renderCompanyPrintHeader,
} from '../export/companyPrintHeader';
import { remoteRowCollectionUsd } from './dailyLedgerPrintable';
import type { RemoteDailyLedgerRow } from './dailyLedgerTypes';

export type QuickLedgerPrintRow = {
  receiptNo: string;
  destination: string;
  parcelType: string;
  parcelCount: string;
  weightKg: string;
  sender: string;
  receiver: string;
  collectAmount: string;
  prepaidAmount: string;
  hawalaAmount: string;
  transferServiceFee: string;
  notes: string;
};

function escapePrintHtml(value: string) {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

export function remoteRowToPrint(row: RemoteDailyLedgerRow): QuickLedgerPrintRow {
  const collect = remoteRowCollectionUsd(row);
  return {
    receiptNo: row.receipt_no ?? '',
    destination: row.destination ?? '',
    parcelType: row.parcel_type ?? '',
    parcelCount: row.parcel_count == null ? '' : String(row.parcel_count),
    weightKg: row.weight_kg == null ? '' : String(row.weight_kg),
    sender: row.sender_name ?? '',
    receiver: row.receiver_name ?? '',
    collectAmount: collect > 0 ? String(collect) : String(row.collect_amount_usd ?? ''),
    prepaidAmount: String(row.prepaid_amount_usd ?? ''),
    hawalaAmount: String(row.hawala_amount_usd ?? ''),
    transferServiceFee: String(row.transfer_service_fee_usd ?? ''),
    notes: row.notes ?? '',
  };
}

/** نفس جدول طباعة سطر الشحنة في الدفتر — أعمدة الإدخال المعتادة */
export function buildQuickLedgerPrintHtml(
  rows: QuickLedgerPrintRow[],
  meta: {
    title: string;
    destinationLabel: string;
    driverName: string;
    /** طباعة أعمدة الإدخال فقط — بدون عمود الجهة (لنتائج البحث) */
    entryColumnsOnly?: boolean;
  },
) {
  const num = (value: string): number => {
    const n = Number(String(value).replace(/[^\d.-]/g, ''));
    return Number.isFinite(n) ? n : 0;
  };
  const totals = rows.reduce(
    (acc, row) => {
      acc.pieces += num(row.parcelCount);
      acc.weightKg += num(row.weightKg);
      acc.collect += num(row.collectAmount);
      acc.prepaid += num(row.prepaidAmount);
      acc.hawala += num(row.hawalaAmount);
      acc.fee += num(row.transferServiceFee);
      return acc;
    },
    { pieces: 0, weightKg: 0, collect: 0, prepaid: 0, hawala: 0, fee: 0 },
  );
  const fmt = (n: number) => n.toLocaleString('en-US', { maximumFractionDigits: 2 });
  const tons = (totals.weightKg / 1000).toLocaleString('en-US', { maximumFractionDigits: 3 });
  const entryOnly = meta.entryColumnsOnly === true;

  const bodyRows = rows
    .map((row) => {
      const destCell = entryOnly
        ? ''
        : `<td class="col-dest">${escapePrintHtml(row.destination)}</td>`;
      return `<tr>
<td class="col-type">${escapePrintHtml(row.parcelType)}</td>
<td class="col-count">${escapePrintHtml(row.parcelCount)}</td>
<td class="col-weight">${escapePrintHtml(row.weightKg)}</td>
<td class="col-money">${escapePrintHtml(row.collectAmount)}</td>
<td class="col-money">${escapePrintHtml(row.hawalaAmount)}</td>
<td class="col-money">${escapePrintHtml(row.transferServiceFee)}</td>
<td class="col-money">${escapePrintHtml(row.prepaidAmount)}</td>
<td class="col-party">${escapePrintHtml(row.sender)}</td>
<td class="col-party">${escapePrintHtml(row.receiver)}</td>
${destCell}
<td class="col-receipt">${escapePrintHtml(row.receiptNo)}</td>
<td class="col-notes">${escapePrintHtml(row.notes)}</td>
</tr>`;
    })
    .join('');

  const footColspan = entryOnly ? 4 : 5;
  const footRow = `<tr class="totals-row">
<td colspan="1">الإجمالي — ${rows.length} سطر / ${tons} طن</td>
<td class="col-count">${fmt(totals.pieces)}</td>
<td class="col-weight">${fmt(totals.weightKg)}</td>
<td class="col-money">${fmt(totals.collect)}</td>
<td class="col-money">${fmt(totals.hawala)}</td>
<td class="col-money">${fmt(totals.fee)}</td>
<td class="col-money">${fmt(totals.prepaid)}</td>
<td colspan="${footColspan}"></td>
</tr>`;

  const headerHtml = renderCompanyPrintHeader({
    title: meta.title,
    fields: buildDailyLedgerHeaderFields({
      rowCount: rows.length,
      destination: meta.destinationLabel,
      driver: meta.driverName,
      parcelCount: fmt(totals.pieces),
    }),
  });

  const destHeader = entryOnly ? '' : '<th class="col-dest">الجهة</th>';

  return `<!doctype html>
<html lang="ar" dir="rtl">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>${escapePrintHtml(meta.title)}</title>
  <style>
    @page { size: A4 portrait; margin: 12mm 8mm; }
    html, body { margin: 0; padding: 0; background: white; font-family: Tahoma, Arial, sans-serif; color: #10251f; }
    ${companyPrintHeaderStyles()}
    table { width: 100%; border-collapse: collapse; table-layout: fixed; font-size: 13px; page-break-inside: auto; }
    thead { display: table-header-group; }
    tr { page-break-inside: avoid; page-break-after: auto; }
    th, td { border: 1px solid #7f93a7; padding: 3px 2px; vertical-align: middle; line-height: 1.15; }
    th { background: #dce8e5; font-weight: 800; text-align: center; min-height: 30px; word-break: break-word; }
    td { text-align: center; min-height: 22px; background: #fff; white-space: nowrap; overflow: hidden; }
    .col-receipt { width: 6%; }
    .col-dest { width: 8%; }
    .col-type { width: 10%; }
    .col-count { width: 4%; }
    .col-weight { width: 8%; min-width: 14mm; direction: ltr; font-size: 12px; font-variant-numeric: tabular-nums; }
    td.col-weight, th.col-weight { overflow: visible; padding-inline: 3px; }
    .col-party { width: 11%; text-align: right; }
    .col-notes { width: 10%; text-align: right; white-space: normal; word-break: break-word; }
    .col-money { width: 5.5%; direction: ltr; font-size: 12px; }
    th.col-money { font-size: 10px; line-height: 1.1; padding: 2px 1px; }
    tfoot { display: table-footer-group; }
    tr.totals-row td { background: #dce8e5; font-weight: 800; text-align: center; }
  </style>
</head>
<body>
  ${headerHtml}
  <table>
    <thead>
      <tr>
        <th class="col-type">نوع البضاعة</th>
        <th class="col-count">عدد الطرود</th>
        <th class="col-weight">الوزن كغ</th>
        <th class="col-money">تحصيل $</th>
        <th class="col-money">حوالة</th>
        <th class="col-money">أجرة الحوالة</th>
        <th class="col-money">دفع مسبق $</th>
        <th class="col-party">المرسل</th>
        <th class="col-party">المرسل إليه</th>
        ${destHeader}
        <th class="col-receipt">رقم الإيصال</th>
        <th class="col-notes">ملاحظات</th>
      </tr>
    </thead>
    <tbody>
      ${bodyRows}
    </tbody>
    <tfoot>
      ${footRow}
    </tfoot>
  </table>
</body>
</html>`;
}
