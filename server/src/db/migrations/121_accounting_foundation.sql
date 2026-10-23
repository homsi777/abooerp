-- Accounting foundation: chart of accounts + double-entry journal.
-- Additive only — no existing table is touched. receipt_vouchers /
-- payment_vouchers / party_financial_movements keep working exactly as
-- before; this is purely new, separate infrastructure for the new manual
-- "قيد يدوي" (journal voucher) capability. Auto-posting receipt/payment
-- vouchers into this journal is explicitly OUT of scope here and left for
-- a later, separately-approved step.

create table if not exists chart_of_accounts (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references companies(id) on delete cascade,
  account_code text not null,
  account_name text not null,
  account_type text not null check (account_type in ('asset', 'liability', 'equity', 'revenue', 'expense')),
  normal_balance text not null check (normal_balance in ('debit', 'credit')),
  parent_account_id uuid references chart_of_accounts(id) on delete restrict,
  is_control_account boolean not null default false,
  control_party_type text check (control_party_type in ('customer', 'agent', 'sender_receiver', 'supplier')),
  is_active boolean not null default true,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (company_id, account_code)
);

create index if not exists idx_chart_of_accounts_company_type
  on chart_of_accounts(company_id, account_type) where is_active;

comment on table chart_of_accounts is 'دليل حسابات — حسابات تحكم فقط؛ أرصدة كل طرف (وكيل/عميل/مرسل-مستلم) تُتبَّع عبر party_type/party_id في journal_entry_lines لا حساب مستقل لكل طرف';

create table if not exists journal_entries (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references companies(id) on delete cascade,
  branch_id uuid references branches(id) on delete set null,
  entry_no text not null,
  entry_date date not null default current_date,
  description text,
  source_type text not null default 'manual' check (source_type in (
    'voucher_receipt', 'voucher_payment', 'manual', 'custody_shift', 'auto_system'
  )),
  source_reference_type text,
  source_reference_id uuid,
  status text not null default 'posted' check (status in ('draft', 'posted', 'reversed')),
  reversal_of_entry_id uuid references journal_entries(id),
  created_by_user_id uuid references users(id),
  created_at timestamptz not null default now(),
  unique (company_id, entry_no)
);

create index if not exists idx_journal_entries_company_date
  on journal_entries(company_id, entry_date desc);

comment on column journal_entries.entry_no is 'JE-<تسلسل> — يُولَّد من طول journal_entries الحالي لكل شركة عند الإدخال';

create table if not exists journal_entry_lines (
  id uuid primary key default gen_random_uuid(),
  journal_entry_id uuid not null references journal_entries(id) on delete cascade,
  line_no integer not null,
  account_id uuid not null references chart_of_accounts(id),
  debit_amount numeric(14, 2) not null default 0,
  credit_amount numeric(14, 2) not null default 0,
  original_currency text not null default 'USD' references currencies(code),
  exchange_rate_to_usd numeric(18, 8) not null default 1 check (exchange_rate_to_usd > 0),
  base_amount_usd numeric(14, 2) not null,
  party_type text check (party_type in ('customer', 'agent', 'sender_receiver', 'supplier', 'driver', 'employee')),
  party_id uuid,
  notes text,
  created_at timestamptz not null default now(),
  unique (journal_entry_id, line_no),
  constraint jel_debit_xor_credit check (
    (debit_amount > 0 and credit_amount = 0) or (credit_amount > 0 and debit_amount = 0)
  )
);

create index if not exists idx_journal_entry_lines_entry on journal_entry_lines(journal_entry_id);
create index if not exists idx_journal_entry_lines_account on journal_entry_lines(account_id);
create index if not exists idx_journal_entry_lines_party on journal_entry_lines(party_type, party_id) where party_id is not null;

-- Deferred (checked at COMMIT, not per-row) so a multi-line entry can be
-- inserted line by line inside one transaction without tripping the check
-- before the last line lands — same technique used for the app_releases
-- constraint change earlier, applied here as an actual balance guarantee.
create or replace function fn_journal_entry_lines_balance_check()
returns trigger as $$
declare
  v_journal_entry_id uuid;
  v_debit_total numeric(14,2);
  v_credit_total numeric(14,2);
begin
  v_journal_entry_id := coalesce(new.journal_entry_id, old.journal_entry_id);
  select coalesce(sum(debit_amount), 0), coalesce(sum(credit_amount), 0)
    into v_debit_total, v_credit_total
    from journal_entry_lines
    where journal_entry_id = v_journal_entry_id;
  if v_debit_total <> v_credit_total then
    raise exception 'Journal entry % is not balanced: debit=% credit=%', v_journal_entry_id, v_debit_total, v_credit_total;
  end if;
  return null;
end;
$$ language plpgsql;

drop trigger if exists trg_journal_entry_lines_balance on journal_entry_lines;
create constraint trigger trg_journal_entry_lines_balance
  after insert or update or delete on journal_entry_lines
  deferrable initially deferred
  for each row execute function fn_journal_entry_lines_balance_check();

-- Locked seed chart of accounts — additive, minimal, control-account model
-- (per the separately-approved Finance/Accounting audit's B4 recommendation:
-- a fixed seed set for phase 1, no admin UI to add accounts yet). Seeded
-- for every active company so multi-company setups aren't left without one.
insert into chart_of_accounts (company_id, account_code, account_name, account_type, normal_balance, is_control_account, control_party_type)
select c.id, v.account_code, v.account_name, v.account_type, v.normal_balance, v.is_control_account, v.control_party_type
from companies c
cross join (values
  ('1100', 'الصندوق الرئيسي',            'asset',     'debit',  false, null),
  ('1300', 'عهد الورديات والسلف',         'asset',     'debit',  false, null),
  ('1410', 'ذمم العملاء',                'asset',     'debit',  true,  'customer'),
  ('1420', 'ذمم الوكلاء',                'asset',     'debit',  true,  'agent'),
  ('1430', 'ذمم المرسلين والمستلمين',     'asset',     'debit',  true,  'sender_receiver'),
  ('2100', 'ذمم الموردين',               'liability', 'credit', true,  'supplier'),
  ('2200', 'عمولات وكلاء مستحقة',         'liability', 'credit', true,  'agent'),
  ('3000', 'حقوق الملكية',               'equity',    'credit', false, null),
  ('4100', 'إيرادات أجور الشحن',          'revenue',   'credit', false, null),
  ('4200', 'إيرادات عمولات الحوالات',     'revenue',   'credit', false, null),
  ('4300', 'إيرادات خدمات إضافية',        'revenue',   'credit', false, null),
  ('5100', 'مصاريف تشغيلية عامة',         'expense',   'debit',  false, null),
  ('5200', 'مصاريف عمولات الوكلاء',       'expense',   'debit',  false, null),
  ('5300', 'حسومات ممنوحة للوكلاء',       'expense',   'debit',  false, null)
) as v(account_code, account_name, account_type, normal_balance, is_control_account, control_party_type)
where c.is_active = true
on conflict (company_id, account_code) do nothing;
