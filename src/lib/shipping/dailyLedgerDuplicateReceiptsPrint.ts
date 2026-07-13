import {
  buildLedgerStylePrintHtml,
  formatLedgerMoney,
  printLedgerStyleDocument,
} from '../export/ledgerStylePrint';
import {
  duplicateKindLabel,
  type DuplicateReceiptGroup,
  type DuplicateReceiptsReport,
} from './dailyLedgerDuplicateReceiptsGateway';

function fmtDate(value: string | null | undefined): string {
  const raw = String(value ?? '').trim();
  const match = raw.match(/^(\d{4}-\d{2}-\d{2})/);
  return (match?.[1] ?? raw) || '—';
}

function fmtCell(value: string | number | null | undefined): string {
  if (value == null) return '—';
  const raw = String(value).trim();
  return raw || '—';
}

function rowStatus(row: DuplicateReceiptGroup['rows'][number]): string {
  if (row.loaded_at) return 'محمّل';
  if (row.posted_shipment_id) return 'مُرحَّل';
  return 'غير مُرحَّل';
}

export function buildDuplicateReceiptsPrintHtml(options: {
  report: DuplicateReceiptsReport;
  dateFrom?: string;
  dateTo?: string;
  scopeLabel: string;
}): string {
  const { report, dateFrom, dateTo, scopeLabel } = options;
  const printedAt = new Date().toLocaleString('ar-SY', {
    dateStyle: 'medium',
    timeStyle: 'short',
  });

  const sections = report.groups.map((group, index) => {
    const headers = [
      '#',
      'التاريخ',
      'الفرع',
      'الخط',
      'نوع البضاعة',
      'عدد',
      'وزن',
      'تحصيل $',
      'حوالة',
      'أجرة حوالة',
      'مسبق $',
      'المرسل',
      'المرسل إليه',
      'الجهة',
      'الحالة',
      'السائق',
      'ملاحظات',
    ];
    const rows = group.rows.map((row, rowIndex) => [
      String(rowIndex + 1),
      fmtDate(row.ledger_date),
      fmtCell(row.branch_name),
      fmtCell(row.line_label),
      fmtCell(row.parcel_type),
      fmtCell(row.parcel_count),
      fmtCell(row.weight_kg),
      formatLedgerMoney(row.collect_amount_usd),
      formatLedgerMoney(row.hawala_amount_usd),
      formatLedgerMoney(row.transfer_service_fee_usd),
      formatLedgerMoney(row.prepaid_amount_usd),
      fmtCell(row.sender_name),
      fmtCell(row.receiver_name),
      fmtCell(row.destination),
      rowStatus(row),
      fmtCell(row.driver_label),
      fmtCell(row.notes),
    ]);

    return {
      heading: `${index + 1}) إيصال ${group.receipt_no} — ${duplicateKindLabel(group.kind)} (${group.count} سطر)`,
      note: `تحصيل ${formatLedgerMoney(group.collect_sum)} · حوالة ${formatLedgerMoney(group.hawala_sum)} · أجرة ${formatLedgerMoney(group.transfer_fee_sum)}`,
      headers,
      rows,
    };
  });

  return buildLedgerStylePrintHtml({
    title: 'تقرير الأسطر المكررة — دفتر الشحن',
    orientation: 'landscape',
    headerFields: [
      { label: 'عدد المجموعات', value: report.groups.length },
      { label: 'نفس اليوم', value: report.summary.sameDayGroups },
      { label: 'عبر التواريخ', value: report.summary.crossDateGroups },
      { label: 'إجمالي الأسطر', value: report.summary.totalDuplicateRows },
    ],
    meta: [
      { label: 'نطاق الفروع', value: scopeLabel },
      { label: 'من تاريخ', value: dateFrom || '—' },
      { label: 'إلى تاريخ', value: dateTo || '—' },
      { label: 'تاريخ الطباعة', value: printedAt },
    ],
    sections: sections.length
      ? sections
      : [
          {
            heading: 'لا توجد أسطر مكررة',
            headers: ['ملاحظة'],
            rows: [['لم يُعثر على تكرار ضمن النطاق المحدد.']],
          },
        ],
  });
}

export async function printDuplicateReceiptsReport(options: {
  report: DuplicateReceiptsReport;
  dateFrom?: string;
  dateTo?: string;
  scopeLabel: string;
}): Promise<'queued' | 'browser' | 'error'> {
  const html = buildDuplicateReceiptsPrintHtml(options);
  return printLedgerStyleDocument(html, 'quick_ledger_duplicate_receipts');
}
