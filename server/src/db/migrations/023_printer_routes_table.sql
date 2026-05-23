create table if not exists printer_routes (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references companies(id),
  branch_id uuid references branches(id) on delete set null,
  document_type text not null,
  printer_id uuid not null references printers(id),
  copies integer not null default 1,
  is_default boolean not null default false,
  is_active boolean not null default true,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_printer_routes_company_branch_doc on printer_routes(company_id, branch_id, document_type);
create index if not exists idx_printer_routes_printer on printer_routes(printer_id);

create unique index if not exists uq_printer_routes_active_default_scope
  on printer_routes(company_id, coalesce(branch_id, '00000000-0000-0000-0000-000000000000'::uuid), document_type)
  where is_default = true and is_active = true;
