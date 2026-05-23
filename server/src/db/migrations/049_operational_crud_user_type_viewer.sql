alter table users
  drop constraint if exists users_user_type_check;

alter table users
  add constraint users_user_type_check
  check (user_type in ('admin', 'employee', 'agent', 'accountant', 'branch_supervisor', 'delivery', 'viewer'));
