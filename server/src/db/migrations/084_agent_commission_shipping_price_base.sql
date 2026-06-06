-- عمولة الوكيل: أساسها سعر الشحنة (freight_charge + transfer_fee) = تحصيل أو دفع مسبق.

update shipments s
set
  agent_commission_base_type = coalesce(s.agent_commission_base_type, 'FREIGHT_CHARGE'),
  agent_commission_base_amount = round(
    greatest(coalesce(s.freight_charge, 0) + coalesce(s.transfer_fee, 0), 0),
    2
  ),
  agent_commission_amount_snapshot = round(
    greatest(coalesce(s.freight_charge, 0) + coalesce(s.transfer_fee, 0), 0)
    * coalesce(
        s.agent_commission_percentage_snapshot,
        (select a.commission_percentage from agents a where a.id = s.agent_id),
        0
      ) / 100,
    2
  )
where s.deleted_at is null
  and s.agent_id is not null
  and abs(
    coalesce(s.agent_commission_base_amount, -1)
    - round(greatest(coalesce(s.freight_charge, 0) + coalesce(s.transfer_fee, 0), 0), 2)
  ) > 0.01;

comment on column shipments.agent_commission_base_amount is
  'Base amount for agent commission: shipping price (prepaid in freight_charge or COD in transfer_fee).';
