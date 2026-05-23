-- 071: سعر تحويل السلفة إلى USD (أساس المشروع) + احتساب الخصومات والمجاميع بالدولار.

alter table employee_advances
  add column if not exists exchange_rate_to_usd numeric(20, 10) not null default 1;

comment on column employee_advances.exchange_rate_to_usd is
  'Multiplier: 1 unit original currency → USD (same convention as exchange_rates.rate for quote vs USD).';

-- تعبئة أسعار تاريخية: USD=1، غيره من جدول أسعار الصرف أو احتياطي SYP.
update employee_advances ea
set exchange_rate_to_usd = coalesce(
  (
    select er.rate
    from exchange_rates er
    join currencies c on c.id = er.currency_id and c.company_id = ea.company_id
    where c.code = upper(trim(ea.currency))
      and er.company_id = ea.company_id
    order by er.effective_date desc, er.created_at desc
    limit 1
  ),
  case when upper(trim(ea.currency)) = 'USD' then 1::numeric else 0.000077::numeric end
);
