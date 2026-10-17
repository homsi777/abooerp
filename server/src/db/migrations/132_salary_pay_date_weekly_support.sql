-- 132_salary_pay_date_weekly_support.sql
-- الموظفون "weekly" يُفترض أن يُدفَع لهم أكثر من مرة في الشهر (أسبوعياً)،
-- لكن القيد الفريد السابق (employee_id, period_year, period_month) كان
-- يسمح بسجل راتب واحد فقط لكل موظف في كل شهر — فيُمنَع تسجيل أكثر من
-- أسبوع واحد شهرياً حتى للموظفين الأسبوعيين. نضيف pay_date (تاريخ الدفعة
-- الفعلي/تاريخ الأسبوع) ونجعل القيد الفريد يشمله: للموظف الشهري تبقى هذه
-- القيمة ثابتة = أول الشهر (سجل واحد كالسابق)، وللموظف الأسبوعي تختلف كل
-- أسبوع (فيُسمح بعدة سجلات ضمن نفس الشهر، واحد لكل أسبوع).

alter table salary_records add column if not exists pay_date date;

-- السجلات الأسبوعية المدفوعة فعلاً لشهر 10/2026 سُجِّلت قبل وجود هذا العمود
-- بدون تمييز أي أسبوع بالضبط — وهي معروفة فعلياً أنها لأسبوع 2026-10-15
-- (أول أسبوع دُفع عبر الشاشة المبسَّطة). نُثبّت هذا التاريخ الصحيح لها هنا
-- حتى لا تُحتسَب خطأً كدفعة "أول الشهر" وتُفتَح أسابيع 1 و8/10 كمكرَّرة.
update salary_records sr
set pay_date = '2026-10-15'
from employees e
where sr.employee_id = e.id
  and e.salary_type = 'weekly'
  and sr.period_year = 2026
  and sr.period_month = 10
  and sr.pay_date is null;

-- كل ما تبقّى (الرواتب الشهرية، وأي فترات أخرى) — أول الشهر افتراضياً، وهو
-- غير حسّاس لأن الموظف الشهري له سجل واحد فقط في الشهر بأي حال.
update salary_records set pay_date = make_date(period_year, period_month, 1) where pay_date is null;

alter table salary_records alter column pay_date set not null;

do $$
declare
  cname text;
begin
  select con.conname into cname
  from pg_constraint con
  where con.conrelid = 'salary_records'::regclass
    and con.contype = 'u'
    and (
      select array_agg(attname::text order by attname)
      from pg_attribute
      where attrelid = con.conrelid and attnum = any(con.conkey)
    ) = array['employee_id', 'period_month', 'period_year']
  limit 1;

  if cname is not null then
    execute format('alter table salary_records drop constraint %I', cname);
  end if;
end $$;

alter table salary_records
  add constraint salary_records_employee_period_paydate_key
  unique (employee_id, period_year, period_month, pay_date);

comment on column salary_records.pay_date is
  'تاريخ الدفعة الفعلي — ثابت (أول الشهر) للراتب الشهري، ويختلف كل أسبوع للراتب الأسبوعي.';
