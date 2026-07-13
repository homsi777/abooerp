import {
  buildLedgerStylePrintHtml,
  formatLedgerMoney,
  printLedgerStyleDocument,
} from '../export/ledgerStylePrint';
import type { LedgerGlobalSearchInput } from './dailyLedgerGlobalSearchGateway';
import type { RemoteDailyLedgerRow } from './dailyLedgerTypes';

function fmtLedgerDate(value: string | null | undefined): string {
  const raw = String(value ?? '').trim();
  const match = raw.match(/^(\d{4}-\d{2}-\d{2})/);
  return (match?.[1] ?? raw) || '—';
}

function rowStatusLabel(row: RemoteDailyLedgerRow): string {
  if (row.loaded_at) return 'محمّل';
  if (row.posted_shipment_id) return 'مُرحَّل';
  return 'غير مُرحَّل';
}

function parseNum(value: string | number | null | undefined): number {
  const n = Number(String(value ?? '').replace(/[^\d.-]/g, ''));
  return Number.isFinite(n) ? n : 0;
}

function criteriaSummary(criteria: LedgerGlobalSearchInput): string {
  const parts = [
    criteria.receiptNo?.trim() ? `إيصال: ${criteria.receiptNo.trim()}` : '',
    criteria.parcelType?.trim() ? `نوع: ${criteria.parcelType.trim()}` : '',
    criteria.senderName?.trim() ? `مرسل: ${criteria.senderName.trim()}` : '',
    criteria.receiverName?.trim() ? `مستلم: ${criteria.receiverName.trim()}` : '',
  ].filter(Boolean);
  return parts.length ? parts.join(' · ') : '—';
}

export function buildGlobalSearchResultsPrintHtml(options: {
  rows: RemoteDailyLedgerRow[];
  criteria: LedgerGlobalSearchInput;
  scopeLabel: string;
  branchNameById: Map<string, string>;
}): string {
  const { rows, criteria, scopeLabel, branchNameById } = options;
  const printedAt = new Date().toLocaleString('ar-SY', {
    dateStyle: 'medium',
    timeStyle: 'short',
  });

  const totals = rows.reduce(
    (acc, row) => {
      acc.pieces += parseNum(row.parcel_count);
      acc.weightKg += parseNum(row.weight_kg);
      acc.collect += parseNum(row.collect_amount_usd);
      acc.prepaid += parseNum(row.prepaid_amount_usd);
      acc.hawala += parseNum(row.hawala_amount_usd);
      acc.fee += parseNum(row.transfer_service_fee_usd);
      acc.fees += parseNum(row.fees_amount_usd);
      return acc;
    },
    { pieces: 0, weightKg: 0, collect: 0, prepaid: 0, hawala: 0, fee: 0, fees: 0 },
  );

  const fmt = (n: number) => n.toLocaleString('en-US', { maximumFractionDigits: 2 });
  const tableRows = rows.map((row, index) => [
    String(index + 1),
    fmtLedgerDate(row.ledger_date),
    branchNameById.get(row.branch_id) ?? row.branch_id.slice(0, 8),
    row.line_label || '—',
    row.receipt_no || '—',
    row.destination || '—',
    row.parcel_type || '—',
    row.parcel_count != null ? String(row.parcel_count) : '—',
    row.weight_kg != null ? String(row.weight_kg) : '—',
    formatLedgerMoney(row.collect_amount_usd),
    formatLedgerMoney(row.hawala_amount_usd),
    formatLedgerMoney(row.transfer_service_fee_usd),
    formatLedgerMoney(row.prepaid_amount_usd),
    formatLedgerMoney(row.fees_amount_usd),
    row.sender_name || '—',
    row.receiver_name || '—',
    rowStatusLabel(row),
    row.driver_label || '—',
    row.vehicle_label || '—',
    row.dispatch_no != null ? `#${row.dispatch_no}` : '—',
    row.origin_label || '—',
    row.notes || '—',
  ]);

  const footerRow = [
    `الإجمالي — ${rows.length} سطر`,
    '',
    '',
    '',
    '',
    '',
    '',
    fmt(totals.pieces),
    fmt(totals.weightKg),
    fmt(totals.collect),
    fmt(totals.hawala),
    fmt(totals.fee),
    fmt(totals.prepaid),
    fmt(totals.fees),
    '',
    '',
    '',
    '',
    '',
    '',
    '',
    '',
  ];

  return buildLedgerStylePrintHtml({
    title: 'نتائج البحث الشامل — دفتر الشحن اليومي',
    orientation: 'landscape',
    headerFields: [
      { label: 'عدد النتائج', value: rows.length },
      { label: 'نطاق البحث', value: scopeLabel },
      { label: 'معايير البحث', value: criteriaSummary(criteria) },
    ],
    meta: [
      { label: 'تاريخ الطباعة', value: printedAt },
      { label: 'عدد الأسطر', value: String(rows.length) },
      { label: 'إجمالي الطرود', value: fmt(totals.pieces) },
      { label: 'إجمالي الوزن (كغ)', value: fmt(totals.weightKg) },
    ],
    sections: [
      {
        heading: 'أسطر البحث — بيانات شاملة',
        note:
          rows.length >= 200
            ? 'ملاحظة: الطباعة تعرض أول 200 نتيجة — حدّد معايير أكثر للتضييق.'
            : undefined,
        headers: [
          '#',
          'التاريخ',
          'الفرع',
          'الخط',
          'إيصال',
          'الجهة',
          'نوع البضاعة',
          'عدد',
          'وزن كغ',
          'تحصيل $',
          'حوالة',
          'أجرة حوالة',
          'مسبق $',
          'رسوم $',
          'المرسل',
          'المستلم',
          'الحالة',
          'السائق',
          'المركبة',
          'إرسالية',
          'منشأ',
          'ملاحظات',
        ],
        rows: tableRows,
        footerRow,
      },
    ],
  });
}

export async function printGlobalSearchResults(options: {
  rows: RemoteDailyLedgerRow[];
  criteria: LedgerGlobalSearchInput;
  scopeLabel: string;
  branchNameById: Map<string, string>;
}): Promise<'queued' | 'browser' | 'error'> {
  const html = buildGlobalSearchResultsPrintHtml(options);
  return printLedgerStyleDocument(html, 'quick_ledger_global_search');
}
