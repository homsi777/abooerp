create table if not exists printers (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references companies(id),
  branch_id uuid references branches(id) on delete set null,
  code text not null,
  name text not null,
  printer_type text not null,
  connection_type text not null,
  target text not null,
  is_default boolean not null default false,
  is_active boolean not null default true,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'printers_printer_type_check'
  ) then
    alter table printers
      add constraint printers_printer_type_check
      check (printer_type in ('thermal', 'label', 'a4', 'kitchen', 'receipt'));
  end if;

  if not exists (
    select 1
    from pg_constraint
    where conname = 'printers_connection_type_check'
  ) then
    alter table printers
      add constraint printers_connection_type_check
      check (connection_type in ('local', 'network', 'usb', 'windows'));
  end if;
end $$;

create unique index if not exists uq_printers_company_code on printers(company_id, code);
create index if not exists idx_printers_company_branch on printers(company_id, branch_id);
create index if not exists idx_printers_active on printers(company_id, is_active);
