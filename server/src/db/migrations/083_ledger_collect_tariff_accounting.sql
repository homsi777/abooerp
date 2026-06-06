-- دفتر الشحن: دمج fees_amount_usd القديم في collect_amount_usd، وتبسيط تعريف الأسعار (مسار + وزن).

alter table tariffs
  alter column goods_type_id drop not null;

comment on column tariffs.minimum_charge is 'الحد الأدنى للشحنة (USD) — لا يُضرب بعدد الطرود';
comment on column tariffs.goods_type_id is 'اختياري — التسعير يعتمد على المسار والوزن فقط';

-- ترحيل بيانات الدفتر: «الأجور» القديمة → «تحصيل»
update daily_ledger_rows
set
  collect_amount_usd = round(collect_amount_usd + fees_amount_usd, 2),
  fees_amount_usd = 0
where deleted_at is null
  and fees_amount_usd > 0;

-- شحنات مُنشأة من الدفتر بربط معكوس: أجور في freight وتحصيل في transfer_fee
update shipments s
set
  freight_charge = round(coalesce(s.freight_charge, 0) + coalesce(s.transfer_fee, 0), 2),
  transfer_fee = 0,
  original_amount = round(
    greatest(
      coalesce(s.freight_charge, 0) + coalesce(s.transfer_fee, 0) +
      coalesce(s.hawala_amount, 0) + coalesce(s.transfer_service_fee, 0) -
      coalesce(s.prepaid_amount, 0) - coalesce(s.discount_amount, 0),
      0
    ),
    2
  )
from daily_ledger_rows dlr
where dlr.posted_shipment_id = s.id
  and dlr.deleted_at is null
  and s.deleted_at is null
  and coalesce(s.freight_charge, 0) > 0
  and coalesce(s.transfer_fee, 0) > 0
  and coalesce(dlr.fees_amount_usd, 0) = 0;
