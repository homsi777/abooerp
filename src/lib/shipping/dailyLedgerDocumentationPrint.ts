import {
  buildLedgerStylePrintHtml,
  exportLedgerStylePdf,
  formatLedgerDate,
  formatLedgerMoney,
  printLedgerStyleDocument,
} from '../export/ledgerStylePrint';
import { buildDailyLedgerHeaderFields } from '../export/companyPrintHeader';
import type { PrintDocumentationDetail, PrintDocumentationSummary } from './dailyLedgerDocumentationGateway';
import { printTypeLabel } from './dailyLedgerDocumentationGateway';

function num(value: string | number | null | undefined): number {
  const n = Number(String(value ?? '').replace(/[^\d.-]/g, ''));
  return Number.isFinite(n) ? n : 0;
}

function detailRowsTable(detail: PrintDocumentationDetail) {
  const rows = detail.rows_snapshot ?? [];
  const totals = rows.reduce(
    (acc, row) => {
      acc.pieces += num(row.parcelCount);
      acc.weight += num(row.weightKg);
      acc.collect += num(row.collectAmountUsd);
      acc.prepaid += num(row.prepaidAmountUsd);
      acc.hawala += num(row.hawalaAmountUsd);
      acc.fee += num(row.transferServiceFeeUsd);
      return acc;
    },
    { pieces: 0, weight: 0, collect: 0, prepaid: 0, hawala: 0, fee: 0 },
  );
  const tons = (totals.weight / 1000).toLocaleString('en-US', { maximumFractionDigits: 3 });

  return {
    headers: [
      'نوع البضاعة',
      'عدد',
      'وزن كغ',
      'تحصيل $',
      'حوالة',
      'أجرة الحوالة',
      'دفع مسبق $',
      'المرسل',
      'المستلم',
      'الجهة',
      'إيصال',
      'ملاحظات',
    ],
    rows: rows.map((row) => [
      row.parcelType || '—',
      row.parcelCount == null ? '—' : String(row.parcelCount),
      row.weightKg || '—',
      row.collectAmountUsd || '—',
      row.hawalaAmountUsd || '—',
      row.transferServiceFeeUsd || '—',
      row.prepaidAmountUsd || '—',
      row.senderName || '—',
      row.receiverName || '—',
      row.destination || '—',
      row.receiptNo || '—',
      row.notes || '—',
    ]),
    footerRow: [
      `الإجمالي — ${rows.length} سطر / ${tons} طن`,
      '',
      String(totals.pieces),
      totals.weight.toLocaleString('en-US', { maximumFractionDigits: 2 }),
      totals.collect.toLocaleString('en-US', { maximumFractionDigits: 2 }),
      totals.hawala.toLocaleString('en-US', { maximumFractionDigits: 2 }),
      totals.fee.toLocaleString('en-US', { maximumFractionDigits: 2 }),
      totals.prepaid.toLocaleString('en-US', { maximumFractionDigits: 2 }),
      '',
      '',
      '',
      '',
    ],
  };
}

export function buildDocumentationDetailPrintHtml(detail: PrintDocumentationDetail): string {
  const title = detail.title || `توثيق دفتر الشحن — ${detail.destination_label || detail.ledger_date}`;
  const table = detailRowsTable(detail);

  return buildLedgerStylePrintHtml({
    title,
    headerFields: buildDailyLedgerHeaderFields({
      rowCount: detail.row_count,
      destination: detail.destination_label || detail.search_query || '—',
      driver: detail.driver_label || '—',
      parcelCount: detail.pieces_count,
    }),
    meta: [
      { label: 'تاريخ الشحن', value: formatLedgerDate(detail.ledger_date) },
      { label: 'الفرع', value: detail.branch_name || '—' },
      { label: 'خط المصدر', value: detail.line_label || '—' },
      { label: 'نوع الطباعة', value: printTypeLabel(detail.print_type) },
      { label: 'تحصيل', value: formatLedgerMoney(detail.collect_total_usd) },
      { label: 'مسبق', value: formatLedgerMoney(detail.prepaid_total_usd) },
      { label: 'حوالة', value: formatLedgerMoney(detail.hawala_total_usd) },
      { label: 'أجرة حوالة', value: formatLedgerMoney(detail.transfer_fee_total_usd) },
    ],
    sections: [table],
    orientation: 'landscape',
  });
}

export function buildDocumentationListPrintHtml(
  rows: PrintDocumentationSummary[],
  range: { dateFrom: string; dateTo: string },
): string {
  const totals = rows.reduce(
    (acc, row) => {
      acc.lines += row.row_count;
      acc.pieces += row.pieces_count;
      acc.collect += num(row.collect_total_usd);
      return acc;
    },
    { lines: 0, pieces: 0, collect: 0 },
  );

  return buildLedgerStylePrintHtml({
    title: `توثيق دفتر الشحن — ${range.dateFrom} إلى ${range.dateTo}`,
    meta: [
      { label: 'عدد الوثائق', value: String(rows.length) },
      { label: 'إجمالي الأسطر', value: String(totals.lines) },
      { label: 'إجمالي الطرود', value: String(totals.pieces) },
      { label: 'إجمالي التحصيل', value: formatLedgerMoney(totals.collect) },
    ],
    sections: [
      {
        headers: ['تاريخ', 'السائق', 'الجهة', 'النوع', 'أسطر', 'طرود', 'تحصيل $', 'طُبع في'],
        rows: rows.map((row) => [
          formatLedgerDate(row.ledger_date),
          row.driver_label || '—',
          row.destination_label || row.search_query || '—',
          printTypeLabel(row.print_type),
          String(row.row_count),
          String(row.pieces_count),
          row.collect_total_usd || '—',
          new Date(row.printed_at).toLocaleString('ar-SY'),
        ]),
      },
    ],
    orientation: 'landscape',
  });
}

export async function printDocumentationHtml(html: string): Promise<'queued' | 'browser' | 'error'> {
  return printLedgerStyleDocument(html, 'ledger_documentation');
}

export async function exportDocumentationPdf(payload: {
  title: string;
  html: string;
  defaultFileName: string;
}) {
  return exportLedgerStylePdf({
    title: payload.title,
    html: payload.html,
    defaultFileName: payload.defaultFileName,
    landscape: true,
  });
}
