alter table salary_records drop constraint if exists salary_records_employee_period_paydate_key;
alter table salary_records
  add constraint salary_records_employee_id_period_year_period_month_key
  unique (employee_id, period_year, period_month);
alter table salary_records drop column if exists pay_date;
