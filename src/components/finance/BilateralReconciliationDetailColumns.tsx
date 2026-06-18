import { useMemo, type ReactNode } from 'react';
import { formatWesternDate } from '../../lib/format/westernDigits';

type MoneyFn = (value: unknown) => string;

type Props = {
  data: Record<string, any>;
  money: MoneyFn;
  periodBalance?: {
    previousBalance: number;
    periodMovement: number;
    currentBalance: number;
  };
};

function DetailColumn({
  title,
  summary,
  children,
  accent,
}: {
  title: string;
  summary: ReactNode;
  children: ReactNode;
  accent?: string;
}) {
  return (
    <div className={`card flex flex-col min-w-[300px] max-w-[340px] shrink-0 border-t-4 ${accent ?? 'border-primary-500'}`}>
      <div className="border-b bg-gray-50 px-3 py-2">
        <h4 className="font-bold text-sm">{title}</h4>
        <div className="mt-2 space-y-1 text-xs text-gray-700">{summary}</div>
      </div>
      <div className="max-h-[420px] flex-1 overflow-y-auto p-2 text-xs">{children}</div>
    </div>
  );
}

function SummaryLine({ label, value, bold }: { label: string; value: string; bold?: boolean }) {
  return (
    <div className={`flex justify-between gap-2 ${bold ? 'font-bold text-gray-900' : ''}`}>
      <span>{label}</span>
      <span className="whitespace-nowrap">{value}</span>
    </div>
  );
}

function EmptyHint({ text }: { text: string }) {
  return <p className="py-6 text-center text-gray-400">{text}</p>;
}

function DetailRow({
  primary,
  secondary,
  amount,
  meta,
}: {
  primary: string;
  secondary?: string;
  amount: string;
  meta?: string;
}) {
  return (
    <div className="border-b border-gray-100 py-2 last:border-0">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="truncate font-medium text-gray-800">{primary}</div>
          {secondary ? <div className="truncate text-gray-500">{secondary}</div> : null}
          {meta ? <div className="text-[10px] text-gray-400">{meta}</div> : null}
        </div>
        <div className="shrink-0 font-semibold text-gray-900">{amount}</div>
      </div>
    </div>
  );
}

const hawalaRoleLabel: Record<string, string> = {
  origin: 'مصدر',
  destination: 'وجهة',
  both: 'مصدر ووجهة',
};

export default function BilateralReconciliationDetailColumns({ data, money, periodBalance }: Props) {
  const mainBranch = data.mainBranch ?? {};
  const settlement = data.settlement ?? {};
  const hawalaSummary = data.hawalaSection?.summary ?? {};
  const agent = data.agent ?? {};
  const commissionPct = Number(agent.commission_percentage ?? 0);

  const shipments = (data.shipments ?? []) as Array<Record<string, any>>;
  const transfers = (data.transfers ?? data.hawalaSection?.transfers ?? []) as Array<Record<string, any>>;
  const vouchers = (data.vouchers ?? []) as Array<Record<string, any>>;

  const collectionRows = useMemo(
    () => shipments.filter((s) => Number(s.transfer_fee ?? 0) > 0),
    [shipments],
  );

  const prepaidRows = useMemo(
    () => shipments.filter((s) => Number(s.prepaid_at_main_branch ?? s.prepaid_amount ?? 0) > 0),
    [shipments],
  );

  const hawalaOnShipments = useMemo(
    () => shipments.filter((s) => Number(s.hawala_amount ?? 0) > 0 || Number(s.transfer_service_fee ?? 0) > 0),
    [shipments],
  );

  const standaloneTransfers = useMemo(
    () => transfers.filter((t) => !t.shipment_id),
    [transfers],
  );

  const commissionRows = useMemo(
    () => shipments.filter((s) => Number(s.agent_commission_amount_snapshot ?? 0) > 0),
    [shipments],
  );

  const receiptVouchers = useMemo(
    () => vouchers.filter((v) => v.voucher_kind === 'receipt'),
    [vouchers],
  );

  const paymentVouchers = useMemo(
    () => vouchers.filter((v) => v.voucher_kind === 'payment'),
    [vouchers],
  );

  const collectionTotal = Number(mainBranch.collectionCollectedByAgent ?? settlement.collectionOnAgent ?? 0);
  const prepaidTotal = Number(mainBranch.prepaidRetainedAtMainBranch ?? settlement.prepaidAtMainBranch ?? 0);
  const hawalaTotal = Number(mainBranch.hawalaRemittanceTotal ?? hawalaSummary.totalHawalaRemittanceDue ?? 0);
  const commissionDue = Number(mainBranch.totalShippingCommissionDueToAgent ?? settlement.totalShippingCommission ?? 0);
  const commissionPaid = Number(mainBranch.confirmedPaymentsToAgent ?? settlement.confirmedPayments ?? 0);
  const commissionRemaining = Number(mainBranch.companyOwesAgentUnpaidCommission ?? Math.max(commissionDue - commissionPaid, 0));
  const receiptsTotal = Number(mainBranch.confirmedReceiptsFromAgent ?? settlement.confirmedReceipts ?? 0);
  const paymentsTotal = Number(mainBranch.confirmedPaymentsToAgent ?? settlement.confirmedPayments ?? 0);
  const netRequired = Number(mainBranch.netRequiredFromAgentAfterCommission ?? settlement.netRequiredFromAgent ?? 0);
  const periodGap = Number(mainBranch.reconciliationGap ?? settlement.agentBalanceDue ?? 0);

  return (
    <div className="space-y-3">
      <div>
        <h3 className="text-lg font-bold">كشف تفصيلي شامل — حسب البند</h3>
        <p className="text-sm text-gray-600">
          كل عمود: ملخص المجاميع في الأعلى، ثم تفاصيل كل حركة داخل العمود.
        </p>
      </div>

      <div className="flex gap-3 overflow-x-auto pb-2">
        <DetailColumn
          title="التحصيل (COD مع الوكيل)"
          accent="border-blue-500"
          summary={(
            <>
              <SummaryLine label="عدد الشحنات" value={String(collectionRows.length)} />
              <SummaryLine label="إجمالي التحصيل" value={money(collectionTotal)} bold />
            </>
          )}
        >
          {collectionRows.length === 0 ? (
            <EmptyHint text="لا يوجد تحصيل مع الوكيل في هذه الفترة" />
          ) : (
            collectionRows.map((s) => (
              <DetailRow
                key={s.id}
                primary={String(s.shipment_no ?? '—')}
                secondary={`${s.sender_name ?? '—'} → ${s.receiver_name ?? '—'}`}
                meta={`${formatWesternDate(s.created_at)}${s.destination_city ? ` — ${s.destination_city}` : ''}`}
                amount={money(s.transfer_fee)}
              />
            ))
          )}
        </DetailColumn>

        <DetailColumn
          title="المسبق في الفرع الرئيسي"
          accent="border-violet-500"
          summary={(
            <>
              <SummaryLine label="عدد الشحنات" value={String(prepaidRows.length)} />
              <SummaryLine label="إجمالي المسبق" value={money(prepaidTotal)} bold />
              <p className="text-[10px] text-gray-500 pt-1">
                محصّل في الفرع — لا يُطالب الوكيل بتوريده
              </p>
            </>
          )}
        >
          {prepaidRows.length === 0 ? (
            <EmptyHint text="لا يوجد مسبق في الفرع لهذه الفترة" />
          ) : (
            prepaidRows.map((s) => (
              <DetailRow
                key={s.id}
                primary={String(s.shipment_no ?? '—')}
                secondary={`${s.sender_name ?? '—'} → ${s.receiver_name ?? '—'}`}
                meta={formatWesternDate(s.created_at)}
                amount={money(s.prepaid_at_main_branch ?? s.prepaid_amount ?? 0)}
              />
            ))
          )}
        </DetailColumn>

        <DetailColumn
          title="الحوالات"
          accent="border-amber-500"
          summary={(
            <>
              <SummaryLine label="حوالة على شحنات" value={money(hawalaSummary.hawalaPrincipalOnShipments ?? 0)} />
              <SummaryLine label="أجور على شحنات" value={money(hawalaSummary.hawalaFeesOnShipments ?? 0)} />
              <SummaryLine label="حوالات مستقلة" value={String(standaloneTransfers.length)} />
              <SummaryLine label="إجمالي مطلوب حوالات" value={money(hawalaTotal)} bold />
            </>
          )}
        >
          {hawalaOnShipments.length === 0 && standaloneTransfers.length === 0 ? (
            <EmptyHint text="لا توجد حوالات في هذه الفترة" />
          ) : (
            <>
              {hawalaOnShipments.map((s) => (
                <DetailRow
                  key={`sh-${s.id}`}
                  primary={`شحنة ${s.shipment_no ?? '—'}`}
                  secondary="حوالة على شحنة"
                  meta={formatWesternDate(s.created_at)}
                  amount={money(Number(s.hawala_amount ?? 0) + Number(s.transfer_service_fee ?? 0))}
                />
              ))}
              {standaloneTransfers.map((t) => (
                <DetailRow
                  key={t.id}
                  primary={`${t.sender_name ?? '—'} / ${t.receiver_name ?? '—'}`}
                  secondary={t.destination_city ?? '—'}
                  meta={`${formatWesternDate(t.transfer_date ?? t.created_at)} — ${hawalaRoleLabel[String(t.agent_role)] ?? t.agent_role ?? '—'}`}
                  amount={money(t.agent_remittance_due ?? Number(t.amount ?? 0) + Number(t.transfer_service_fee ?? 0))}
                />
              ))}
            </>
          )}
        </DetailColumn>

        <DetailColumn
          title="عمولة الوكيل"
          accent="border-emerald-500"
          summary={(
            <>
              <SummaryLine label="نسبة العمولة" value={`${commissionPct}%`} />
              <SummaryLine label="إجمالي مستحق" value={money(commissionDue)} />
              <SummaryLine label="مدفوع (سندات دفع)" value={money(commissionPaid)} />
              <SummaryLine label="متبقي للوكيل" value={money(commissionRemaining)} bold />
              <p className="text-[10px] text-gray-500 pt-1">
                {mainBranch.commissionNote ?? settlement.commissionNote ?? 'عمولة على الشحن فقط'}
              </p>
            </>
          )}
        >
          {commissionRows.length === 0 ? (
            <EmptyHint text="لا توجد عمولات شحن في هذه الفترة" />
          ) : (
            commissionRows.map((s) => (
              <DetailRow
                key={s.id}
                primary={String(s.shipment_no ?? '—')}
                secondary={`${s.sender_name ?? '—'} → ${s.receiver_name ?? '—'}`}
                meta={formatWesternDate(s.created_at)}
                amount={money(s.agent_commission_amount_snapshot)}
              />
            ))
          )}
        </DetailColumn>

        <DetailColumn
          title="سندات القبض والدفع"
          accent="border-cyan-500"
          summary={(
            <>
              <SummaryLine label="سندات قبض (توريد)" value={money(receiptsTotal)} />
              <SummaryLine label="سندات دفع (عمولة)" value={money(paymentsTotal)} />
              <SummaryLine
                label="صافي السندات"
                value={money(receiptsTotal - paymentsTotal)}
                bold
              />
            </>
          )}
        >
          {vouchers.length === 0 ? (
            <EmptyHint text="لا توجد سندات في هذه الفترة" />
          ) : (
            <>
              {receiptVouchers.map((v) => (
                <DetailRow
                  key={`r-${v.id}`}
                  primary={String(v.voucher_no ?? '—')}
                  secondary="سند قبض من الوكيل"
                  meta={`${formatWesternDate(v.created_at)} — ${v.status ?? '—'}`}
                  amount={money(v.original_amount)}
                />
              ))}
              {paymentVouchers.map((v) => (
                <DetailRow
                  key={`p-${v.id}`}
                  primary={String(v.voucher_no ?? '—')}
                  secondary="سند دفع للوكيل"
                  meta={`${formatWesternDate(v.created_at)} — ${v.status ?? '—'}`}
                  amount={money(v.original_amount)}
                />
              ))}
            </>
          )}
        </DetailColumn>

        <DetailColumn
          title="المطلوب والذمة"
          accent="border-red-500"
          summary={(
            <>
              <SummaryLine label="صافي مطلوب من الوكيل" value={money(netRequired)} />
              <SummaryLine label="مسدّد (قبض)" value={money(receiptsTotal)} />
              <SummaryLine label="فارق الفترة" value={money(periodGap)} bold />
              {periodBalance ? (
                <>
                  <div className="my-1 border-t border-gray-200" />
                  <SummaryLine label="ذمة سابقة" value={money(periodBalance.previousBalance)} />
                  <SummaryLine label="حركات الفترة" value={money(periodBalance.periodMovement)} />
                  <SummaryLine label="الذمة الحالية" value={money(periodBalance.currentBalance)} bold />
                </>
              ) : null}
            </>
          )}
        >
          <div className="space-y-2 py-1">
            <DetailRow
              primary="تحصيل + حوالات (إجمالي)"
              amount={money(Number(collectionTotal) + Number(hawalaTotal))}
            />
            <DetailRow primary="ناقص عمولة الشحن" amount={money(-commissionDue)} />
            <DetailRow primary="= صافي مطلوب" amount={money(netRequired)} />
            <DetailRow primary="ناقص سندات قبض" amount={money(-receiptsTotal)} />
            <DetailRow primary="+ سندات دفع للوكيل" amount={money(paymentsTotal)} />
            <DetailRow
              primary="= ذمة نهاية الفترة"
              amount={money(periodGap)}
            />
            {periodBalance ? (
              <DetailRow
                primary="ذمة تراكمية معتمدة"
                secondary="سابقة + حركات الفترة"
                amount={money(periodBalance.currentBalance)}
              />
            ) : null}
          </div>
        </DetailColumn>
      </div>
    </div>
  );
}
