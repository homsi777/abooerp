type Props = {
  data: any;
  money: (value: unknown, currency?: string) => string;
  rowReconciliationClass: (row: any) => string;
};

const transferRoleLabel: Record<string, string> = {
  origin: 'وكيل مصدر (قبض)',
  destination: 'وكيل وجهة (تسليم)',
  both: 'مصدر ووجهة',
  none: '-',
};

export function agentStatementSourceLabel(value: string): string {
  return (
    {
      shipment_commission: 'عمولة شحنة',
      transfer: 'حوالة',
      receipt_voucher: 'سند قبض',
      payment_voucher: 'سند دفع',
      cashbox_transaction: 'حركة صندوق',
      shipment_shipping_fee: 'أجور شحن',
      sender_collection_trust: 'تحصيل لصالح المرسل',
      loading_dues: 'مستحقات تحميل',
      general_collection: 'تحصيل إضافي',
      shipment_hawala_trust: 'أصل حوالة (شحنة)',
      shipment_transfer_service_fee: 'أجرة حوالة (شحنة)',
      transfer_principal_collected: 'قبض أصل حوالة',
      transfer_service_fee_collected: 'قبض أجرة حوالة',
      transfer_principal_paid: 'دفع أصل حوالة للمستلم',
      transfer_agent_commission: 'عمولة حوالة',
    }[value] ?? value
  );
}

export default function AgentFinancialStatementContent({ data, money, rowReconciliationClass }: Props) {
  const summary = data.summary ?? {};
  const since = summary.sinceLastReconciliation ?? {};

  return (
    <>
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <div className="stat-card">
          <div className="stat-value">{summary.shipmentsCount ?? 0}</div>
          <div className="stat-label">شحنات</div>
        </div>
        <div className="stat-card">
          <div className="stat-value">{summary.transfersCount ?? 0}</div>
          <div className="stat-label">حوالات</div>
        </div>
        <div className="stat-card">
          <div className="stat-value">{money(summary.totalAgentRemittanceDue ?? 0)}</div>
          <div className="stat-label">إجمالي مطلوب من الوكيل</div>
        </div>
        <div className="stat-card">
          <div className="stat-value">{money(summary.totalReceipts ?? 0)}</div>
          <div className="stat-label">سندات قبض (مسدّد)</div>
        </div>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <div className="stat-card">
          <div className="stat-value">{money(summary.totalAgentRemittanceDueFromShipments ?? 0)}</div>
          <div className="stat-label">مطلوب — شحنات</div>
        </div>
        <div className="stat-card">
          <div className="stat-value">{money(summary.totalTransferRemittanceDue ?? 0)}</div>
          <div className="stat-label">مطلوب — حوالات مستقلة</div>
        </div>
        <div className="stat-card">
          <div className="stat-value">{money(summary.totalTransferPrincipalCollected ?? 0)}</div>
          <div className="stat-label">أصل حوالات مقبوض (مصدر)</div>
        </div>
        <div className="stat-card">
          <div className="stat-value">{money(summary.totalTransferPrincipalPaid ?? 0)}</div>
          <div className="stat-label">أصل حوالات مُسلَّم (وجهة)</div>
        </div>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <div className="stat-card">
          <div className="stat-value">{money(summary.totalShipmentCommission ?? 0)}</div>
          <div className="stat-label">عمولة الشحن</div>
        </div>
        <div className="stat-card">
          <div className="stat-value">{money(summary.totalTransferCommission ?? 0)}</div>
          <div className="stat-label">عمولة الحوالات</div>
        </div>
        <div className="stat-card">
          <div className="stat-value">{money(summary.totalTransferServiceFeeCollected ?? 0)}</div>
          <div className="stat-label">أجور خدمة حوالات (مصدر)</div>
        </div>
        <div className="stat-card">
          <div className="stat-value font-bold text-red-700">{money(summary.agentBalanceDue ?? 0)}</div>
          <div className="stat-label">ذمة على الوكيل (متبقي)</div>
        </div>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <div className="stat-card">
          <div className="stat-value">{Number(data.agent?.commission_percentage || 0)}%</div>
          <div className="stat-label">نسبة عمولة الشحن</div>
        </div>
        <div className="stat-card">
          <div className="stat-value">{money(since.totalAgentRemittanceDue ?? summary.totalAgentRemittanceDue ?? 0)}</div>
          <div className="stat-label">مطلوب بعد آخر مطابقة</div>
        </div>
        <div className="stat-card">
          <div className="stat-value">{money(since.totalTransferRemittanceDue ?? summary.totalTransferRemittanceDue ?? 0)}</div>
          <div className="stat-label">حوالات — بعد المطابقة</div>
        </div>
        <div className="stat-card">
          <div className="stat-value font-bold text-red-700">
            {money(since.agentBalanceDue ?? summary.agentBalanceDue ?? 0)}
          </div>
          <div className="stat-label">ذمة بعد آخر مطابقة</div>
        </div>
      </div>

      <section>
        <h4 className="font-bold mb-2">تفاصيل الشحنات</h4>
        <table className="data-grid text-sm">
          <thead>
            <tr>
              <th>التاريخ</th>
              <th>المرجع</th>
              <th>البيان</th>
              <th>تحصيل</th>
              <th>حوالة</th>
              <th>أجور شحن</th>
              <th>مطلوب من الوكيل</th>
              <th>العمولة</th>
              <th>الحالة</th>
            </tr>
          </thead>
          <tbody>
            {(data.shipments ?? []).map((s: any) => (
              <tr
                key={s.id}
                className={rowReconciliationClass({
                  at: s.created_at,
                  source_type: 'shipment',
                  debit: Number(s.agent_remittance_due ?? 0),
                })}
              >
                <td>{String(s.created_at).split('T')[0]}</td>
                <td>{s.shipment_no}</td>
                <td>
                  {s.sender_name ?? '-'} / {s.receiver_name ?? '-'}
                  {s.destination_city ? ` — ${s.destination_city}` : ''}
                </td>
                <td>{money(s.transfer_fee, s.original_currency)}</td>
                <td>{money(s.hawala_amount, s.original_currency)}</td>
                <td>{money(s.agent_commission_base_amount ?? s.freight_charge, s.original_currency)}</td>
                <td>{money(s.agent_remittance_due ?? 0, s.original_currency)}</td>
                <td>{money(s.agent_commission_amount_snapshot, s.original_currency)}</td>
                <td>{s.status}</td>
              </tr>
            ))}
            {(data.shipments ?? []).length === 0 ? (
              <tr>
                <td colSpan={9} className="text-center p-4 text-gray-500">
                  لا توجد شحنات
                </td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </section>

      <section>
        <h4 className="font-bold mb-2">تفاصيل الحوالات</h4>
        <p className="text-xs text-gray-600 mb-2">
          الحوالات المرتبطة بشحنة تُحسب ضمن صف الشحنة — لا تُكرَّر في «مطلوب من الوكيل» هنا.
        </p>
        <table className="data-grid text-sm">
          <thead>
            <tr>
              <th>التاريخ</th>
              <th>رقم الحوالة</th>
              <th>المرسل / المستلم</th>
              <th>الوجهة</th>
              <th>الدور</th>
              <th>أصل الحوالة</th>
              <th>أجرة الخدمة</th>
              <th>عمولة الوكيل</th>
              <th>مطلوب من الوكيل</th>
              <th>شحنة</th>
              <th>الحالة</th>
            </tr>
          </thead>
          <tbody>
            {(data.transfers ?? []).map((t: any) => (
              <tr
                key={t.id}
                className={rowReconciliationClass({
                  at: t.transfer_date ?? t.created_at,
                  source_type: 'transfer',
                  debit: Number(t.agent_remittance_due ?? 0),
                })}
              >
                <td>{String(t.transfer_date ?? t.created_at).split('T')[0]}</td>
                <td>{t.id ? String(t.id).slice(0, 8) : '-'}</td>
                <td>
                  {t.sender_name ?? '-'} / {t.receiver_name ?? '-'}
                </td>
                <td>{t.destination_city ?? '-'}</td>
                <td>{transferRoleLabel[String(t.agent_role)] ?? t.agent_role ?? '-'}</td>
                <td>{money(t.amount, t.currency)}</td>
                <td>{money(t.transfer_service_fee, t.transfer_service_fee_currency ?? t.currency)}</td>
                <td>{money(t.agent_commission, t.agent_commission_currency ?? t.currency)}</td>
                <td>{money(t.agent_remittance_due ?? 0, t.currency)}</td>
                <td>{t.shipment_no ?? (t.shipment_id ? 'مرتبطة' : '-')}</td>
                <td>{t.status}</td>
              </tr>
            ))}
            {(data.transfers ?? []).length === 0 ? (
              <tr>
                <td colSpan={11} className="text-center p-4 text-gray-500">
                  لا توجد حوالات لهذا الوكيل
                </td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </section>

      <section>
        <h4 className="font-bold mb-2">سندات القبض والدفع</h4>
        <table className="data-grid text-sm">
          <thead>
            <tr>
              <th>التاريخ</th>
              <th>المرجع</th>
              <th>البيان</th>
              <th>المبلغ</th>
              <th>الحالة</th>
            </tr>
          </thead>
          <tbody>
            {(data.vouchers ?? []).map((v: any) => (
              <tr
                key={`v-${v.id}`}
                className={rowReconciliationClass({
                  at: v.created_at,
                  source_type: v.voucher_kind === 'receipt' ? 'receipt_voucher' : 'payment_voucher',
                  status: v.status,
                  credit: Number(v.original_amount ?? 0),
                  debit: v.voucher_kind === 'payment' ? Number(v.original_amount ?? 0) : 0,
                })}
              >
                <td>{String(v.created_at).split('T')[0]}</td>
                <td>{v.voucher_no}</td>
                <td>{v.voucher_kind === 'receipt' ? 'سند قبض من الوكيل' : 'سند دفع للوكيل'}</td>
                <td>{money(v.original_amount, v.original_currency)}</td>
                <td>{v.status}</td>
              </tr>
            ))}
            {(data.vouchers ?? []).length === 0 ? (
              <tr>
                <td colSpan={5} className="text-center p-4 text-gray-500">
                  لا توجد سندات
                </td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </section>
    </>
  );
}
