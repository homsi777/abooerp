create table if not exists backup_records (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references companies(id),
  branch_id uuid references branches(id) on delete set null,
  backup_code text not null,
  backup_type text not null,
  scope text not null,
  status text not null default 'creating',
  file_name text not null,
  file_path text not null,
  size_bytes bigint not null default 0,
  checksum_sha256 text,
  is_stub boolean not null default false,
  error_message text,
  created_by uuid references users(id),
  restored_by uuid references users(id),
  restored_at timestamptz,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'backup_records_backup_type_check'
  ) then
    alter table backup_records
      add constraint backup_records_backup_type_check
      check (backup_type in ('manual', 'scheduled', 'before_update'));
  end if;

  if not exists (
    select 1
    from pg_constraint
    where conname = 'backup_records_status_check'
  ) then
    alter table backup_records
      add constraint backup_records_status_check
      check (status in ('creating', 'ready', 'verifying', 'failed', 'restoring', 'restored'));
  end if;
end $$;

create unique index if not exists uq_backup_records_company_code on backup_records(company_id, backup_code);
create index if not exists idx_backup_records_company_created on backup_records(company_id, created_at desc);
create index if not exists idx_backup_records_company_status on backup_records(company_id, status);
