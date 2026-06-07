-- 095: ربط جلسات الدفتر بمعرّف السائق عندما وُجد driver_label فقط (بيانات قديمة)
update daily_ledger_sessions s
set
  driver_id = pick.driver_id,
  updated_at = now()
from (
  select distinct on (s2.id)
    s2.id as session_id,
    d.id as driver_id
  from daily_ledger_sessions s2
  join drivers d on (
    lower(regexp_replace(trim(coalesce(s2.driver_label, '')), E'\\s+', ' ', 'g'))
      = lower(regexp_replace(trim(coalesce(d.full_name, '')), E'\\s+', ' ', 'g'))
    or lower(trim(coalesce(s2.driver_label, ''))) like '%' || lower(trim(coalesce(d.full_name, ''))) || '%'
    or lower(trim(coalesce(d.full_name, ''))) like '%' || lower(trim(coalesce(s2.driver_label, ''))) || '%'
  )
  where s2.deleted_at is null
    and s2.driver_id is null
    and nullif(trim(s2.driver_label), '') is not null
  order by
    s2.id,
    case
      when lower(regexp_replace(trim(coalesce(s2.driver_label, '')), E'\\s+', ' ', 'g'))
        = lower(regexp_replace(trim(coalesce(d.full_name, '')), E'\\s+', ' ', 'g'))
      then 0
      else 1
    end,
    length(coalesce(d.full_name, '')) desc
) pick
where s.id = pick.session_id
  and s.driver_id is null;
