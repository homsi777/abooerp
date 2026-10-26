-- Chart of accounts: group (is_postable=false) vs posting (is_postable=true)
-- accounts, unlimited-depth hierarchy support. Additive and idempotent —
-- re-running this file (or the whole migration runner) is always safe:
-- every INSERT uses ON CONFLICT DO NOTHING, every UPDATE only touches rows
-- whose current state still matches the backfill condition, and the
-- constraint/trigger are dropped-then-recreated rather than guarded with
-- unsupported "IF NOT EXISTS" constraint syntax. No DROP/TRUNCATE/DELETE
-- anywhere. Runs inside one transaction (server/src/db/migrate.ts wraps
-- every migration file in BEGIN/COMMIT already).
--
-- ROLLBACK (manual, not auto-applied): to undo on a database where this is
-- the only change since, in order:
--   drop trigger if exists trg_journal_entry_lines_postable on journal_entry_lines;
--   drop function if exists fn_journal_entry_lines_postable_check();
--   alter table chart_of_accounts drop constraint if exists chk_control_is_postable;
--   alter table chart_of_accounts drop column if exists is_postable;
-- The 5 seeded group accounts (1000/1400/2000/4000/5000) and the
-- re-parenting of 1100/1300/1410/1420/1430/2100/2200/4100/4200/4300/5100/
-- 5200/5300 under them are NOT reverted automatically — only drop them by
-- hand if truly needed, since a real deployment may have already added
-- live children under the new groups by then.

-- 1. New column — every existing account defaults to "posting" (leaf).
alter table chart_of_accounts
  add column if not exists is_postable boolean not null default true;

-- 2. Backfill: any account that already has active children becomes a
-- group. Control accounts are excluded on purpose (3.5 below forbids a
-- control account from ever being a group) — none currently have children
-- in practice, but this keeps the backfill itself safe either way.
update chart_of_accounts p
set    is_postable = false
where  p.is_control_account = false
  and  exists (
         select 1
         from   chart_of_accounts c
         where  c.parent_account_id = p.id
           and  c.company_id = p.company_id
       );

-- 3. Seed the 5 suggested group accounts for every existing company,
-- idempotent via ON CONFLICT on the existing (company_id, account_code)
-- unique constraint.
insert into chart_of_accounts (company_id, account_code, account_name, account_type, normal_balance, is_postable, is_control_account)
select c.id, v.account_code, v.account_name, v.account_type, v.normal_balance, false, false
from companies c
cross join (values
  ('1000', 'الأصول',     'asset',     'debit'),
  ('1400', 'الذمم المدينة', 'asset',   'debit'),
  ('2000', 'الخصوم',      'liability', 'credit'),
  ('4000', 'الإيرادات',   'revenue',   'credit'),
  ('5000', 'المصاريف',    'expense',   'debit')
) as v(account_code, account_name, account_type, normal_balance)
where c.is_active = true
on conflict (company_id, account_code) do nothing;

-- 4. Re-parent the original default accounts under their new group —
-- only when parent_account_id is currently NULL, so a parent the user
-- already set by hand is never overridden. One UPDATE per group, each
-- correlated by company_id so it applies correctly across every company
-- at once (no per-company loop needed).
update chart_of_accounts c
set    parent_account_id = p.id
from   chart_of_accounts p
where  c.company_id = p.company_id
  and  c.account_code in ('1100', '1300')
  and  p.account_code = '1000'
  and  c.parent_account_id is null;

update chart_of_accounts c
set    parent_account_id = p.id
from   chart_of_accounts p
where  c.company_id = p.company_id
  and  c.account_code in ('1410', '1420', '1430')
  and  p.account_code = '1400'
  and  c.parent_account_id is null;

update chart_of_accounts c
set    parent_account_id = p.id
from   chart_of_accounts p
where  c.company_id = p.company_id
  and  c.account_code in ('2100', '2200')
  and  p.account_code = '2000'
  and  c.parent_account_id is null;

update chart_of_accounts c
set    parent_account_id = p.id
from   chart_of_accounts p
where  c.company_id = p.company_id
  and  c.account_code in ('4100', '4200', '4300')
  and  p.account_code = '4000'
  and  c.parent_account_id is null;

update chart_of_accounts c
set    parent_account_id = p.id
from   chart_of_accounts p
where  c.company_id = p.company_id
  and  c.account_code in ('5100', '5200', '5300')
  and  p.account_code = '5000'
  and  c.parent_account_id is null;

-- 5. Safety net (task 3.4): an account that already carries posted journal
-- lines must never end up as a group, no matter what the backfill above
-- computed. This is a no-op on a database with no journal activity yet,
-- but protects any deployment where custody-shift postings already landed
-- on an account (see financeRepository.ts getAccountIdByCode — currently
-- only ever posts to 1100/1300, which never become groups themselves, but
-- this guard is unconditional and covers any future poster too).
update chart_of_accounts a
set    is_postable = true
where  a.is_postable = false
  and  exists (select 1 from journal_entry_lines l where l.account_id = a.id);

-- 6. A control account can never be a group (drop-then-add is the
-- idempotent equivalent of "ADD CONSTRAINT IF NOT EXISTS", which Postgres
-- does not support directly).
alter table chart_of_accounts drop constraint if exists chk_control_is_postable;
alter table chart_of_accounts add constraint chk_control_is_postable
  check (not (is_control_account and is_postable = false));

-- 7. A group account must never receive a journal line — enforced at the
-- database level, same trigger technique already used for
-- trg_journal_entry_lines_balance in 121_accounting_foundation.sql.
create or replace function fn_journal_entry_lines_postable_check()
returns trigger as $$
declare
  v_postable boolean;
begin
  select is_postable into v_postable from chart_of_accounts where id = new.account_id;
  if v_postable is false then
    raise exception 'Account % is a group account and cannot receive journal lines', new.account_id;
  end if;
  return new;
end;
$$ language plpgsql;

drop trigger if exists trg_journal_entry_lines_postable on journal_entry_lines;
create trigger trg_journal_entry_lines_postable
  before insert or update of account_id on journal_entry_lines
  for each row execute function fn_journal_entry_lines_postable_check();

comment on column chart_of_accounts.is_postable is 'false = حساب تجميعي (مجموعة)، لا يمكن ترحيل قيود عليه مباشرة؛ true = حساب حركي قابل للترحيل';
