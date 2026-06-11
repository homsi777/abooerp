import { agentStatementSourceLabel } from '../../components/agents/AgentFinancialStatementContent';
import type { ProvincialInboundRow, VehicleTripReportMeta } from '../api/centersGateway';
import type { ProvincialAgentTotals, ProvincialTotals } from '../shipping/provincialInboundTotals';
import { formatWeightTotal } from '../shipping/provincialInboundTotals';
import { normalizeShipmentStatus, shipmentStatusLabelAr } from '../shipments/shipmentStatus';
import {
  buildLedgerStylePrintHtml,
  formatLedgerDate,
  formatLedgerMoney,
  type LedgerPrintMetaItem,
  type LedgerPrintTableSection,
} from './ledgerStylePrint';

const transferRoleLabel: Record<string, string> = {
  origin: 'وكيل مصدر (قبض)',
  destination: 'وكيل وجهة (تسليم)',
  both: 'مصدر ووجهة',
  none: '-',
};

function agentCommonMeta(data: any, title: string): LedgerPrintMetaItem[] {
  const summary = data.summary ?? {};
  const agent = data.agent ?? {};
  return [
    { label: 'الكشف', value: title },
    { label: 'الوكيل', value: agent.name ? `${agent.name}${agent.code ? ` (${agent.code})` : ''}` : '—' },
    { label: 'تاريخ الاستخراج', value: formatLedgerDate(data.generatedAt) },
    { label: 'آخر مطابقة', value: formatLedgerDate(data.lastReconciliation?.reconciled_at) },
    {
      label: 'رصيد آخر مطابقة',
      value: formatLedgerMoney(
        data.lastReconciliation?.balance_amount,
        data.lastReconciliation?.currency_code || 'USD',
      ),
    },
    { label: 'ذمة على الوكيل', value: formatLedgerMoney(summary.agentBalanceDue ?? 0) },
    { label: 'إجمالي مطلوب', value: formatLedgerMoney(summary.totalAgentRemittanceDue ?? 0) },
    { label: 'سندات قبض', value: formatLedgerMoney(summary.totalReceipts ?? 0) },
  ];
}

function buildFinancialSections(data: any): LedgerPrintTableSection[] {
  const summary = data.summary ?? {};
  const sections: LedgerPrintTableSection[] = [
    {
      heading: 'ملخص مالي',
      headers: ['البند', 'القيمة'],
      rows: [
        ['شحنات', String(summary.shipmentsCount ?? 0)],
        ['حوالات', String(summary.transfersCount ?? 0)],
        ['مطلوب — شحنات', formatLedgerMoney(summary.totalAgentRemittanceDueFromShipments ?? 0)],
        ['مطلوب — حوالات', formatLedgerMoney(summary.totalTransferRemittanceDue ?? 0)],
        ['عمولة الشحن', formatLedgerMoney(summary.totalShipmentCommission ?? 0)],
        ['عمولة الحوالات', formatLedgerMoney(summary.totalTransferCommission ?? 0)],
        ['ذمة متبقية', formatLedgerMoney(summary.agentBalanceDue ?? 0)],
      ],
    },
    {
      heading: 'تفاصيل الشحنات',
      headers: ['التاريخ', 'المرجع', 'البيان', 'تحصيل', 'حوالة', 'أجور شحن', 'مطلوب', 'عمولة', 'الحالة'],
      rows: (data.shipments ?? []).map((s: any) => [
        formatLedgerDate(s.created_at),
        s.shipment_no ?? '—',
        `${s.sender_name ?? '-'} / ${s.receiver_name ?? '-'}${s.destination_city ? ` — ${s.destination_city}` : ''}`,
        formatLedgerMoney(s.transfer_fee, s.original_currency),
        formatLedgerMoney(s.hawala_amount, s.original_currency),
        formatLedgerMoney(s.agent_commission_base_amount ?? s.freight_charge, s.original_currency),
        formatLedgerMoney(s.agent_remittance_due ?? 0, s.original_currency),
        formatLedgerMoney(s.agent_commission_amount_snapshot, s.original_currency),
        s.status ?? '—',
      ]),
    },
    {
      heading: 'تفاصيل الحوالات',
      note: 'الحوالات المرتبطة بشحنة تُحسب ضمن صف الشحنة.',
      headers: ['التاريخ', 'المرجع', 'المرسل/المستلم', 'الوجهة', 'الدور', 'أصل', 'أجرة', 'عمولة', 'مطلوب', 'شحنة', 'الحالة'],
      rows: (data.transfers ?? []).map((t: any) => [
        formatLedgerDate(t.transfer_date ?? t.created_at),
        t.id ? String(t.id).slice(0, 8) : '—',
        `${t.sender_name ?? '-'} / ${t.receiver_name ?? '-'}`,
        t.destination_city ?? '—',
        transferRoleLabel[String(t.agent_role)] ?? t.agent_role ?? '—',
        formatLedgerMoney(t.amount, t.currency),
        formatLedgerMoney(t.transfer_service_fee, t.transfer_service_fee_currency ?? t.currency),
        formatLedgerMoney(t.agent_commission, t.agent_commission_currency ?? t.currency),
        formatLedgerMoney(t.agent_remittance_due ?? 0, t.currency),
        t.shipment_no ?? (t.shipment_id ? 'مرتبطة' : '—'),
        t.status ?? '—',
      ]),
    },
    {
      heading: 'سندات القبض والدفع',
      headers: ['التاريخ', 'المرجع', 'البيان', 'المبلغ', 'الحالة'],
      rows: (data.vouchers ?? []).map((v: any) => [
        formatLedgerDate(v.created_at),
        v.voucher_no ?? '—',
        v.voucher_kind === 'receipt' ? 'سند قبض من الوكيل' : 'سند دفع للوكيل',
        formatLedgerMoney(v.original_amount, v.original_currency),
        v.status ?? '—',
      ]),
    },
  ];
  return sections;
}

function buildAccountSections(data: any): LedgerPrintTableSection[] {
  const summary = data.summary ?? {};
  const since = summary.sinceLastReconciliation ?? {};
  const rows = data.rows ?? [];
  return [
    {
      heading: 'ملخص الحركات',
      headers: ['البند', 'القيمة'],
      rows: [
        ['عدد الحركات', String(summary.rowsCount ?? rows.length)],
        ['إجمالي مدين', formatLedgerMoney(summary.totalDebit ?? 0)],
        ['إجمالي دائن', formatLedgerMoney(summary.totalCredit ?? 0)],
        ['ذمة على الوكيل', formatLedgerMoney(summary.agentBalanceDue ?? 0)],
        ['حركات بعد المطابقة', String(since.rowsCount ?? 0)],
        ['ذمة بعد المطابقة', formatLedgerMoney(since.agentBalanceDue ?? summary.agentBalanceDue ?? 0)],
      ],
    },
    {
      heading: 'تفاصيل الحركات',
      headers: ['التاريخ', 'المصدر', 'المرجع', 'البيان', 'الطرف', 'مدين', 'دائن', 'العملة', 'الحالة'],
      rows: rows.map((r: any) => [
        formatLedgerDate(r.at),
        agentStatementSourceLabel(String(r.source_type)),
        r.reference_no ?? '—',
        r.description ?? '—',
        r.party_name ?? '—',
        Number(r.debit || 0).toLocaleString('en-US', { maximumFractionDigits: 2 }),
        Number(r.credit || 0).toLocaleString('en-US', { maximumFractionDigits: 2 }),
        r.currency_code ?? '—',
        r.status ?? '—',
      ]),
      footerRow: [
        'الإجمالي',
        '',
        '',
        '',
        '',
        Number(summary.totalDebit || 0).toLocaleString('en-US', { maximumFractionDigits: 2 }),
        Number(summary.totalCredit || 0).toLocaleString('en-US', { maximumFractionDigits: 2 }),
        '',
        '',
      ],
    },
  ];
}

export function buildAgentStatementPrintHtml(kind: 'financial' | 'account', data: any, title: string): string {
  return buildLedgerStylePrintHtml({
    title,
    meta: agentCommonMeta(data, title),
    sections: kind === 'financial' ? buildFinancialSections(data) : buildAccountSections(data),
    orientation: 'landscape',
  });
}

export function buildDetailedAccountStatementPrintHtml(input: {
  title: string;
  subtitle?: string;
  rows: Array<{
    date: string;
    partyType: string;
    partyName: string;
    referenceType: string;
    referenceNo: string;
    shipmentNo: string;
    description: string;
    debit: number;
    credit: number;
    runningBalance: number;
    currencyCode: string;
    paymentMethod: string;
    branchName: string;
    username: string;
    notes: string;
  }>;
  totals: { totalDebit: number; totalCredit: number; finalBalance: number };
}): string {
  const meta: LedgerPrintMetaItem[] = [
    { label: 'الكشف', value: input.title },
    ...(input.subtitle ? [{ label: 'الفلاتر', value: input.subtitle }] : []),
    { label: 'عدد الحركات', value: String(input.rows.length) },
    { label: 'تاريخ الطباعة', value: formatLedgerDate(new Date().toISOString()) },
  ];
  const section: LedgerPrintTableSection = {
    heading: 'حركات كشف الحساب',
    headers: ['#', 'التاريخ', 'نوع الطرف', 'اسم الطرف', 'المرجع', 'رقم الشحنة', 'البيان', 'مدين', 'دائن', 'الرصيد', 'العملة', 'الفرع'],
    rows: input.rows.map((r, i) => [
      String(i + 1),
      formatLedgerDate(r.date),
      r.partyType,
      r.partyName,
      r.referenceNo || '—',
      r.shipmentNo || '—',
      r.description || '—',
      r.debit.toLocaleString('en-US', { maximumFractionDigits: 2 }),
      r.credit.toLocaleString('en-US', { maximumFractionDigits: 2 }),
      r.runningBalance.toLocaleString('en-US', { maximumFractionDigits: 2 }),
      r.currencyCode,
      r.branchName || '—',
    ]),
    footerRow: [
      'الإجماليات',
      '',
      '',
      '',
      '',
      '',
      '',
      input.totals.totalDebit.toLocaleString('en-US', { maximumFractionDigits: 2 }),
      input.totals.totalCredit.toLocaleString('en-US', { maximumFractionDigits: 2 }),
      input.totals.finalBalance.toLocaleString('en-US', { maximumFractionDigits: 2 }),
      '',
      '',
    ],
  };
  return buildLedgerStylePrintHtml({
    title: input.title,
    meta,
    sections: [section],
    orientation: 'landscape',
  });
}

export function buildDebitCreditPrintHtml(input: {
  subtitle?: string;
  rows: Array<{
    partyCode: string;
    partyName: string;
    partyType: string;
    branchName: string;
    currencyCode: string;
    totalDebit: number;
    totalCredit: number;
    balance: number;
    balanceDirection: string;
    lastMovementAt: string | null;
    movementCount: number;
  }>;
  totals: { totalDebit: number; totalCredit: number; net: number; parties: number };
}): string {
  const meta: LedgerPrintMetaItem[] = [
    { label: 'الكشف', value: 'مركز الدائن والمدين' },
    ...(input.subtitle ? [{ label: 'الفلاتر', value: input.subtitle }] : []),
    { label: 'عدد الأطراف', value: String(input.totals.parties) },
    { label: 'تاريخ الطباعة', value: formatLedgerDate(new Date().toISOString()) },
  ];
  const section: LedgerPrintTableSection = {
    heading: 'أرصدة الأطراف',
    headers: ['#', 'كود', 'الاسم', 'النوع', 'الفرع', 'العملة', 'مدين', 'دائن', 'الرصيد', 'الاتجاه', 'آخر حركة', 'عدد الحركات'],
    rows: input.rows.map((r, i) => [
      String(i + 1),
      r.partyCode,
      r.partyName,
      r.partyType,
      r.branchName || '—',
      r.currencyCode,
      r.totalDebit.toLocaleString('en-US', { maximumFractionDigits: 2 }),
      r.totalCredit.toLocaleString('en-US', { maximumFractionDigits: 2 }),
      r.balance.toLocaleString('en-US', { maximumFractionDigits: 2 }),
      r.balanceDirection,
      r.lastMovementAt ? formatLedgerDate(r.lastMovementAt) : '—',
      String(r.movementCount),
    ]),
    footerRow: [
      'الإجمالي',
      '',
      '',
      '',
      '',
      '',
      input.totals.totalDebit.toLocaleString('en-US', { maximumFractionDigits: 2 }),
      input.totals.totalCredit.toLocaleString('en-US', { maximumFractionDigits: 2 }),
      input.totals.net.toLocaleString('en-US', { maximumFractionDigits: 2 }),
      '',
      '',
      '',
    ],
  };
  return buildLedgerStylePrintHtml({
    title: 'مركز الدائن والمدين',
    meta,
    sections: [section],
    orientation: 'landscape',
  });
}

export function buildAgentCodStatementPrintHtml<T>(input: {
  subtitle?: string;
  rows: T[];
  headers: string[];
  rowMapper: (row: T, index: number) => string[];
}): string {
  const meta: LedgerPrintMetaItem[] = [
    { label: 'الكشف', value: 'كشف مبالغ عند التسليم لدى الوكيل' },
    ...(input.subtitle ? [{ label: 'الفلاتر', value: input.subtitle }] : []),
    { label: 'عدد الشحنات', value: String(input.rows.length) },
    { label: 'تاريخ الطباعة', value: formatLedgerDate(new Date().toISOString()) },
  ];
  return buildLedgerStylePrintHtml({
    title: 'كشف مبالغ عند التسليم لدى الوكيل',
    meta,
    sections: [
      {
        heading: 'تفاصيل الشحنات',
        headers: input.headers,
        rows: input.rows.map((row, index) => input.rowMapper(row, index)),
      },
    ],
    orientation: 'landscape',
  });
}

export function buildVehicleTripReportPrintHtml(input: {
  driverName: string;
  reportDate: string;
  vehicleLabel: string;
  meta: VehicleTripReportMeta | null;
  totals: ProvincialTotals;
  agentTotals: ProvincialAgentTotals[];
  rows: ProvincialInboundRow[];
}): string {
  const meta: LedgerPrintMetaItem[] = [
    { label: 'التقرير', value: 'تقرير سيارة — حسب السائق والتاريخ' },
    { label: 'السائق', value: input.driverName || '—' },
    { label: 'التاريخ', value: input.reportDate || '—' },
    { label: 'السيارة', value: input.vehicleLabel || '—' },
    { label: 'أسطر الدفتر', value: String(input.meta?.totalRows ?? input.totals.shipments) },
    { label: 'مرحّلة كشحنات', value: String(input.meta?.postedRows ?? '—') },
    { label: 'دفتر فقط', value: String(input.meta?.ledgerOnlyRows ?? '—') },
    { label: 'عدد الطرود', value: input.totals.parcelCount.toLocaleString('en-US') },
    { label: 'مجموع الأوزان (كغ)', value: formatWeightTotal(input.totals.weightKg) },
    { label: 'تحصيل', value: input.totals.collectAmount.toLocaleString('en-US', { maximumFractionDigits: 2 }) },
    { label: 'مسبق', value: input.totals.prepaidAmount.toLocaleString('en-US', { maximumFractionDigits: 2 }) },
    { label: 'حوالات', value: input.totals.hawalaAmount.toLocaleString('en-US', { maximumFractionDigits: 2 }) },
    { label: 'أجور حوالات', value: input.totals.transferServiceFee.toLocaleString('en-US', { maximumFractionDigits: 2 }) },
    { label: 'تاريخ الطباعة', value: formatLedgerDate(new Date().toISOString()) },
  ];

  const sections: LedgerPrintTableSection[] = [];

  if (input.agentTotals.length > 0) {
    sections.push({
      heading: 'مجاميع حسب الوكيل',
      headers: ['الوكيل', 'شحنات', 'طرود', 'وزن (كغ)', 'تحصيل', 'مسبق', 'حوالة', 'أجرة'],
      rows: input.agentTotals.map((agent) => [
        agent.agentName,
        String(agent.shipments),
        agent.parcelCount.toLocaleString('en-US'),
        formatWeightTotal(agent.weightKg),
        agent.collectAmount.toLocaleString('en-US', { maximumFractionDigits: 2 }),
        agent.prepaidAmount.toLocaleString('en-US', { maximumFractionDigits: 2 }),
        agent.hawalaAmount.toLocaleString('en-US', { maximumFractionDigits: 2 }),
        agent.transferServiceFee.toLocaleString('en-US', { maximumFractionDigits: 2 }),
      ]),
    });
  }

  sections.push({
    heading: 'تفاصيل الشحنات (دفتر الإدخال السريع)',
    headers: ['وصل', 'وجهة', 'وكيل', 'حالة', 'عدد', 'وزن', 'تحصيل', 'مسبق', 'حوالة', 'أجرة'],
    rows: input.rows.map((row) => [
      row.ledgerReceiptNo ?? row.shipmentNo,
      row.ledgerDestination ?? row.operationalCenter,
      row.agentName ?? '—',
      row.isPosted ? shipmentStatusLabelAr(normalizeShipmentStatus(row.shipmentStatus)) : 'دفتر فقط',
      row.parcelCount == null ? '—' : String(row.parcelCount),
      row.weightKg == null ? '—' : formatWeightTotal(row.weightKg),
      row.collectAmount.toLocaleString('en-US', { maximumFractionDigits: 2 }),
      row.prepaidAmount.toLocaleString('en-US', { maximumFractionDigits: 2 }),
      row.hawalaAmount.toLocaleString('en-US', { maximumFractionDigits: 2 }),
      row.transferServiceFee.toLocaleString('en-US', { maximumFractionDigits: 2 }),
    ]),
    footerRow: [
      'الإجمالي',
      '',
      '',
      '',
      input.totals.parcelCount.toLocaleString('en-US'),
      formatWeightTotal(input.totals.weightKg),
      input.totals.collectAmount.toLocaleString('en-US', { maximumFractionDigits: 2 }),
      input.totals.prepaidAmount.toLocaleString('en-US', { maximumFractionDigits: 2 }),
      input.totals.hawalaAmount.toLocaleString('en-US', { maximumFractionDigits: 2 }),
      input.totals.transferServiceFee.toLocaleString('en-US', { maximumFractionDigits: 2 }),
    ],
  });

  return buildLedgerStylePrintHtml({
    title: `تقرير سيارة — ${input.driverName} — ${input.reportDate}`,
    meta,
    sections,
    orientation: 'landscape',
  });
}

export function buildDailyLedgerDestinationPrintHtml(input: {
  reportDate: string;
  lineLabel: string;
  destination: string;
  driverNames: string[];
  rows: Array<{
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
    driverLabel?: string;
    notes?: string;
  }>;
}): string {
  const num = (value: string): number => {
    const parsed = Number(String(value ?? '').replace(/[^\d.-]/g, ''));
    return Number.isFinite(parsed) ? parsed : 0;
  };

  const totals = input.rows.reduce(
    (acc, row) => {
      acc.parcelCount += num(row.parcelCount);
      acc.weightKg += num(row.weightKg);
      acc.collectAmount += num(row.collectAmount);
      acc.prepaidAmount += num(row.prepaidAmount);
      acc.hawalaAmount += num(row.hawalaAmount);
      acc.transferServiceFee += num(row.transferServiceFee);
      return acc;
    },
    {
      parcelCount: 0,
      weightKg: 0,
      collectAmount: 0,
      prepaidAmount: 0,
      hawalaAmount: 0,
      transferServiceFee: 0,
    },
  );

  const screenMoneyTotal = totals.collectAmount + totals.hawalaAmount + totals.transferServiceFee;
  const grandTotal = screenMoneyTotal + totals.prepaidAmount;

  const meta: LedgerPrintMetaItem[] = [
    { label: 'التقرير', value: 'دفتر الشحن اليومي — حسب الوجهة' },
    { label: 'التاريخ', value: input.reportDate || '—' },
    { label: 'خط المصدر', value: input.lineLabel || '—' },
    { label: 'الوجهة', value: input.destination || '—' },
    { label: 'السائقون', value: input.driverNames.length ? input.driverNames.join('، ') : '—' },
    { label: 'عدد الأسطر', value: String(input.rows.length) },
    { label: 'عدد الطرود', value: totals.parcelCount.toLocaleString('en-US') },
    { label: 'إجمالي الوزن', value: formatWeightTotal(totals.weightKg) },
    {
      label: 'إجمالي الدولار (تحصيل+حوالة+أجرة)',
      value: screenMoneyTotal.toLocaleString('en-US', { maximumFractionDigits: 2 }),
    },
    { label: 'مسبق (منفصل)', value: totals.prepaidAmount.toLocaleString('en-US', { maximumFractionDigits: 2 }) },
    { label: 'المجموع الكلي', value: grandTotal.toLocaleString('en-US', { maximumFractionDigits: 2 }) },
    { label: 'تاريخ الطباعة', value: formatLedgerDate(new Date().toISOString()) },
  ];

  const sections: LedgerPrintTableSection[] = [
    {
      heading: 'تفاصيل الشحنات',
      headers: ['الوصل', 'السائق', 'نوع الطرد', 'عدد', 'وزن', 'المرسل', 'المستلم', 'تحصيل', 'مسبق', 'حوالة', 'أجرة', 'ملاحظات'],
      rows: input.rows.map((row) => [
        row.receiptNo || '—',
        row.driverLabel || '—',
        row.parcelType || '—',
        row.parcelCount || '0',
        row.weightKg ? formatWeightTotal(row.weightKg) : '—',
        row.sender || '—',
        row.receiver || '—',
        num(row.collectAmount).toLocaleString('en-US', { maximumFractionDigits: 2 }),
        num(row.prepaidAmount).toLocaleString('en-US', { maximumFractionDigits: 2 }),
        num(row.hawalaAmount).toLocaleString('en-US', { maximumFractionDigits: 2 }),
        num(row.transferServiceFee).toLocaleString('en-US', { maximumFractionDigits: 2 }),
        row.notes || '—',
      ]),
      footerRow: [
        'الإجمالي',
        '',
        '',
        totals.parcelCount.toLocaleString('en-US'),
        formatWeightTotal(totals.weightKg),
        '',
        '',
        totals.collectAmount.toLocaleString('en-US', { maximumFractionDigits: 2 }),
        totals.prepaidAmount.toLocaleString('en-US', { maximumFractionDigits: 2 }),
        totals.hawalaAmount.toLocaleString('en-US', { maximumFractionDigits: 2 }),
        totals.transferServiceFee.toLocaleString('en-US', { maximumFractionDigits: 2 }),
        '',
      ],
    },
  ];

  return buildLedgerStylePrintHtml({
    title: `دفتر الشحن اليومي — ${input.destination} — ${input.reportDate}`,
    meta,
    sections,
    orientation: 'landscape',
  });
}

export function buildTrialBalancePrintHtml(data: any): string {
  const rows = data.rows ?? [];
  const totals = data.totals ?? {};
  return buildLedgerStylePrintHtml({
    title: 'ميزان المراجعة',
    subtitle: data.filters?.currencyCode ? `العملة: ${data.filters.currencyCode}` : undefined,
    meta: [
      { label: 'تاريخ الاستخراج', value: formatLedgerDate(data.generatedAt) },
      { label: 'من', value: formatLedgerDate(data.filters?.fromAt) },
      { label: 'إلى', value: formatLedgerDate(data.filters?.toAt ?? data.filters?.asOf) },
      { label: 'إجمالي مدين', value: formatLedgerMoney(totals.totalDebit ?? 0) },
      { label: 'إجمالي دائن', value: formatLedgerMoney(totals.totalCredit ?? 0) },
      { label: 'فارق', value: formatLedgerMoney(totals.difference ?? 0) },
    ],
    sections: [
      {
        heading: 'حسابات ميزان المراجعة',
        headers: ['الكود', 'الحساب', 'القسم', 'مدين', 'دائن', 'صافي'],
        rows: rows.map((r: any) => [
          r.accountCode ?? '—',
          r.accountName ?? '—',
          r.section ?? '—',
          Number(r.debit || 0).toLocaleString('en-US', { maximumFractionDigits: 2 }),
          Number(r.credit || 0).toLocaleString('en-US', { maximumFractionDigits: 2 }),
          Number(r.netDebit || 0).toLocaleString('en-US', { maximumFractionDigits: 2 }),
        ]),
      },
    ],
    orientation: 'landscape',
  });
}

export function buildBalanceSheetPrintHtml(data: any): string {
  const sections = (data.sections ?? []).map((section: any) => ({
    heading: section.label,
    headers: ['البند', 'المبلغ'],
    rows: (section.lines ?? []).map((line: any) => [
      line.label ?? '—',
      formatLedgerMoney(line.amount ?? 0, data.summary?.currencyCode ?? 'USD'),
    ]),
    footerRow: ['الإجمالي', formatLedgerMoney(section.total ?? 0, data.summary?.currencyCode ?? 'USD')],
  }));
  return buildLedgerStylePrintHtml({
    title: 'قائمة المركز المالي',
    meta: [
      { label: 'تاريخ الاستخراج', value: formatLedgerDate(data.generatedAt) },
      { label: 'الأصول', value: formatLedgerMoney(data.summary?.totalAssets ?? 0, data.summary?.currencyCode) },
      { label: 'الخصوم', value: formatLedgerMoney(data.summary?.totalLiabilities ?? 0, data.summary?.currencyCode) },
      { label: 'حقوق الملكية', value: formatLedgerMoney(data.summary?.totalEquity ?? 0, data.summary?.currencyCode) },
    ],
    sections,
    orientation: 'portrait',
  });
}

export function buildAgentSettlementPrintHtml(data: any): string {
  return buildAgentStatementPrintHtml('financial', data, 'كشف تسوية الوكيل');
}

export function buildAgentBranchReconciliationPrintHtml(data: any): string {
  const agent = data.agent ?? {};
  const mb = data.mainBranch ?? {};
  const meta: LedgerPrintMetaItem[] = [
    { label: 'الوكيل', value: agent.name ? `${agent.name}${agent.code ? ` (${agent.code})` : ''}` : '—' },
    { label: 'تاريخ الاستخراج', value: formatLedgerDate(data.generatedAt) },
    { label: 'مسبق في الفرع الرئيسي', value: formatLedgerMoney(mb.prepaidRetainedAtMainBranch ?? 0) },
    { label: 'تحصيل مع الوكيل', value: formatLedgerMoney(mb.collectionCollectedByAgent ?? 0) },
    { label: 'حوالات (أصل + أجور)', value: formatLedgerMoney(mb.hawalaRemittanceTotal ?? 0) },
    { label: 'عمولة شحن للوكيل', value: formatLedgerMoney(mb.totalShippingCommissionDueToAgent ?? 0) },
    { label: 'عمولة على المسبق', value: formatLedgerMoney(mb.commissionOnPrepaidAtMainBranch ?? 0) },
    { label: 'صافي مطلوب من الوكيل', value: formatLedgerMoney(mb.netRequiredFromAgentAfterCommission ?? 0) },
    { label: 'سندات قبض', value: formatLedgerMoney(mb.confirmedReceiptsFromAgent ?? 0) },
    { label: 'سندات دفع', value: formatLedgerMoney(mb.confirmedPaymentsToAgent ?? 0) },
    { label: 'فارق المطابقة', value: formatLedgerMoney(mb.reconciliationGap ?? 0) },
  ];
  const sections: LedgerPrintTableSection[] = [
    {
      heading: 'شحنات الوكيل',
      headers: ['التاريخ', 'الشحنة', 'الوجهة', 'مسبق فرع', 'تحصيل', 'حوالة', 'أجور', 'عمولة', 'صافي مطلوب'],
      rows: (data.shipments ?? []).map((s: any) => [
        formatLedgerDate(s.created_at),
        s.shipment_no ?? '—',
        s.destination_city ?? '—',
        formatLedgerMoney(s.prepaid_at_main_branch ?? 0, s.original_currency),
        formatLedgerMoney(s.transfer_fee, s.original_currency),
        formatLedgerMoney(s.hawala_amount, s.original_currency),
        formatLedgerMoney(s.transfer_service_fee, s.original_currency),
        formatLedgerMoney(s.agent_commission_amount_snapshot, s.original_currency),
        formatLedgerMoney(s.agent_net_required_from_agent ?? 0, s.original_currency),
      ]),
    },
    {
      heading: 'حوالات مستقلة',
      note: 'لا عمولة وكيل على الحوالات.',
      headers: ['التاريخ', 'المرسل/المستلم', 'الوجهة', 'أصل', 'أجرة', 'مطلوب'],
      rows: (data.hawalaSection?.transfers ?? [])
        .filter((t: any) => !t.shipment_id)
        .map((t: any) => [
          formatLedgerDate(t.transfer_date ?? t.created_at),
          `${t.sender_name ?? '-'} / ${t.receiver_name ?? '-'}`,
          t.destination_city ?? '—',
          formatLedgerMoney(t.amount, t.currency),
          formatLedgerMoney(t.transfer_service_fee, t.transfer_service_fee_currency ?? t.currency),
          formatLedgerMoney(t.agent_remittance_due ?? 0, t.currency),
        ]),
    },
  ];
  return buildLedgerStylePrintHtml({
    title: 'مطابقة الوكيل ↔ الفرع الرئيسي',
    meta,
    sections,
    orientation: 'landscape',
  });
}

export function buildHawalaReconciliationPrintHtml(data: any): string {
  const summary = data.summary ?? {};
  const agent = data.agent ?? {};
  const meta: LedgerPrintMetaItem[] = [
    { label: 'الوكيل', value: agent.name ? `${agent.name}${agent.code ? ` (${agent.code})` : ''}` : '—' },
    { label: 'تاريخ الاستخراج', value: formatLedgerDate(data.generatedAt) },
    { label: 'حوالة على شحنات', value: formatLedgerMoney(summary.hawalaPrincipalOnShipments ?? 0) },
    { label: 'أجور حوالة على شحنات', value: formatLedgerMoney(summary.hawalaFeesOnShipments ?? 0) },
    { label: 'مطلوب حوالات (شحنات)', value: formatLedgerMoney(summary.hawalaRemittanceOnShipments ?? 0) },
    { label: 'مطلوب حوالات مستقلة', value: formatLedgerMoney(summary.standaloneRemittanceDue ?? 0) },
    { label: 'إجمالي مطلوب حوالات', value: formatLedgerMoney(summary.totalHawalaRemittanceDue ?? 0) },
    { label: 'عمولة وكيل على الحوالات', value: '0 — لا عمولة' },
  ];
  const sections: LedgerPrintTableSection[] = [
    {
      heading: 'شحنات بها حوالة أو أجور حوالة',
      headers: ['التاريخ', 'الشحنة', 'الوجهة', 'حوالة', 'أجور', 'مطلوب حوالة', 'عمولة شحن'],
      rows: (data.shipments ?? []).map((s: any) => [
        formatLedgerDate(s.created_at),
        s.shipment_no ?? '—',
        s.destination_city ?? '—',
        formatLedgerMoney(s.hawala_amount, s.original_currency),
        formatLedgerMoney(s.transfer_service_fee, s.original_currency),
        formatLedgerMoney(s.agent_hawala_remittance_due ?? 0, s.original_currency),
        formatLedgerMoney(s.agent_commission_amount_snapshot, s.original_currency),
      ]),
    },
    {
      heading: 'حوالات مستقلة',
      note: 'لا عمولة وكيل — توريد أصل الحوالة + أجور الخدمة.',
      headers: ['التاريخ', 'المرسل/المستلم', 'الوجهة', 'الدور', 'أصل', 'أجرة', 'مطلوب', 'شحنة', 'الحالة'],
      rows: (data.transfers ?? []).filter((t: any) => !t.shipment_id).map((t: any) => [
        formatLedgerDate(t.transfer_date ?? t.created_at),
        `${t.sender_name ?? '-'} / ${t.receiver_name ?? '-'}`,
        t.destination_city ?? '—',
        transferRoleLabel[String(t.agent_role)] ?? t.agent_role ?? '—',
        formatLedgerMoney(t.amount, t.currency),
        formatLedgerMoney(t.transfer_service_fee, t.transfer_service_fee_currency ?? t.currency),
        formatLedgerMoney(t.agent_remittance_due ?? 0, t.currency),
        t.shipment_no ?? '—',
        t.status ?? '—',
      ]),
    },
  ];
  return buildLedgerStylePrintHtml({
    title: 'كشف مطابقة الحوالات',
    meta,
    sections,
    orientation: 'landscape',
  });
}
