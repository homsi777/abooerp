-- نوع دورة الراتب للموظف: شهري أو أسبوعي (للمطابقة مع التسليم وكشف الرواتب)
alter table employees
  add column if not exists salary_type text not null default 'monthly'
    check (salary_type in ('monthly', 'weekly'));

comment on column employees.salary_type is 'monthly=راتب شهري، weekly=راتب أسبوعي';
