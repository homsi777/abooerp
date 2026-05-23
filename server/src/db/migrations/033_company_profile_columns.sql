alter table companies
  add column if not exists phone text;

alter table companies
  add column if not exists address text;

alter table companies
  add column if not exists logo_data_url text;
