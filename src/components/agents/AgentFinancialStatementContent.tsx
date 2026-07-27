type Props = {
  data: any;
  money: (value: unknown, currency?: string) => string;
  rowReconciliationClass: (row: any) => string;
  reportCurrency?: string;
  showLedgerMovements?: boolean;
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

export default function AgentFinancialStatementContent({
  data,
  money,
  rowReconciliationClass,
  reportCurrency = 'USD',
  showLedgerMovements = false,
}: Props) {
  const summary = data.summary ?? {};
  const since = summary.sinceLastReconciliation ?? {};
  const fmt = (value: unknown) => money(value, reportCurrency);
  const ledgerRows = (data.accountStatement?.rows ?? []) as Array<{
    at: string;
    source_type: string;
    reference_no?: string;
    description?: string;
    debit?: number;
    credit?: number;
    status?: string;
  }>;

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
          <div className="stat-value">{fmt(summary.totalAgentRemittanceDue ?? 0)}</div>
          <div className="stat-label">إجمالي مطلوب من الوكيل</div>
        </div>
        <div className="stat-card">
          <div className="stat-value">{fmt(summary.totalReceipts ?? 0)}</div>
          <div className="stat-label">سندات قبض (مسدّد)</div>
        </div>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <div className="stat-card">
          <div className="stat-value">{fmt(summary.totalAgentRemittanceDueFromShipments ?? 0)}</div>
          <div className="stat-label">مطلوب — شحنات</div>
        </div>
        <div className="stat-card">
          <div className="stat-value">{fmt(summary.totalTransferRemittanceDue ?? 0)}</div>
          <div className="stat-label">مطلوب — حوالات مستقلة</div>
        </div>
        <div className="stat-card">
          <div className="stat-value">{fmt(summary.totalTransferPrincipalCollected ?? 0)}</div>
          <div className="stat-label">أصل حوالات مقبوض (مصدر)</div>
        </div>
        <div className="stat-card">
          <div className="stat-value">{fmt(summary.totalTransferPrincipalPaid ?? 0)}</div>
          <div className="stat-label">أصل حوالات مُسلَّم (وجهة)</div>
        </div>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <div className="stat-card">
          <div className="stat-value">{fmt(summary.totalShipmentCommission ?? 0)}</div>
          <div className="stat-label">عمولة الشحن</div>
        </div>
        <div className="stat-card">
          <div className="stat-value">{fmt(summary.totalTransferCommission ?? 0)}</div>
          <div className="stat-label">عمولة الحوالات</div>
        </div>
        <div className="stat-card">
          <div className="stat-value">{fmt(summary.totalTransferServiceFeeCollected ?? 0)}</div>
          <div className="stat-label">أجور خدمة حوالات (مصدر)</div>
        </div>
        <div className="stat-card">
          <div className="stat-value font-bold text-red-700">{fmt(summary.agentBalanceDue ?? 0)}</div>
          <div className="stat-label">ذمة على الوكيل (متبقي)</div>
        </div>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <div className="stat-card">
          <div className="stat-value">{Number(data.agent?.commission_percentage || 0)}%</div>
          <div className="stat-label">نسبة عمولة الشحن</div>
        </div>
        <div className="stat-card">
          <div className="stat-value">{fmt(since.totalAgentRemittanceDue ?? summary.totalAgentRemittanceDue ?? 0)}</div>
          <div className="stat-label">مطلوب بعد آخر مطابقة</div>
        </div>
        <div className="stat-card">
          <div className="stat-value">{fmt(since.totalTransferRemittanceDue ?? summary.totalTransferRemittanceDue ?? 0)}</div>
          <div className="stat-label">حوالات — بعد المطابقة</div>
        </div>
        <div className="stat-card">
          <div className="stat-value font-bold text-red-700">
            {fmt(since.agentBalanceDue ?? summary.agentBalanceDue ?? 0)}
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
                <td>{fmt(s.transfer_fee)}</td>
                <td>{fmt(s.hawala_amount)}</td>
                <td>{fmt(s.agent_commission_base_amount ?? s.freight_charge)}</td>
                <td>{fmt(s.agent_remittance_due ?? 0)}</td>
                <td>{fmt(s.agent_commission_amount_snapshot)}</td>
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
                <td>{fmt(t.amount)}</td>
                <td>{fmt(t.transfer_service_fee)}</td>
                <td>{fmt(t.agent_commission)}</td>
                <td>{fmt(t.agent_remittance_due ?? 0)}</td>
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
                <td>{fmt(v.original_amount)}</td>
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

      {showLedgerMovements ? (
        <section>
          <h4 className="font-bold mb-2">دفتر حركات الذمة (من قاعدة البيانات)</h4>
          <p className="text-xs text-gray-600 mb-2">
            كل حركة مُرحَّلة على عهدة الوكيل: تحصيل، حوالة، أجور شحن، عمولة، سندات — بالدولار الأمريكي.
          </p>
          <table className="data-grid text-sm">
            <thead>
              <tr>
                <th>التاريخ</th>
                <th>النوع</th>
                <th>المرجع</th>
                <th>البيان</th>
                <th>مدين</th>
                <th>دائن</th>
                <th>الحالة</th>
              </tr>
            </thead>
            <tbody>
              {ledgerRows.map((row, index) => (
                <tr
                  key={`${row.source_type}-${row.reference_no ?? index}`}
                  className={rowReconciliationClass({
                    at: row.at,
                    source_type: row.source_type,
                    status: row.status,
                    debit: Number(row.debit ?? 0),
                    credit: Number(row.credit ?? 0),
                  })}
                >
                  <td>{String(row.at).split('T')[0]}</td>
                  <td>{agentStatementSourceLabel(row.source_type)}</td>
                  <td>{row.reference_no ?? '—'}</td>
                  <td>{row.description ?? '—'}</td>
                  <td>{fmt(row.debit ?? 0)}</td>
                  <td>{fmt(row.credit ?? 0)}</td>
                  <td>{row.status ?? '—'}</td>
                </tr>
              ))}
              {ledgerRows.length === 0 ? (
                <tr>
                  <td colSpan={7} className="text-center p-4 text-gray-500">
                    لا توجد حركات ذمة — تأكد من ترحيل دفتر الشحن للفترة المحددة
                  </td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </section>
      ) : null}
    </>
  );
}
