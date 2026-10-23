-- العهدة الموحّدة (custody) — بديل واحد لكل من: عهدة موظف إدخال البيانات على
-- التابلت، وسلفة السائق من الوكلاء أثناء الرحلة. حامل واحد لكل عهدة،
-- ترتبط حركاتها المالية بمحرك القيود (journal_entries/journal_entry_lines)
-- المبني في migration 121. إضافي بالكامل — لا يمس أي جدول موجود.
--
-- ملاحظة تصميم مهمة: السائقون (جدول drivers) ليس لديهم حساب دخول
-- (users) في هذا النظام، بعكس موظف إدخال البيانات. لذلك الحامل قد يكون
-- إمّا مستخدم نظام حقيقي (holder_user_id) أو سائقاً بلا حساب دخول
-- (holder_driver_id) — بالضبط واحد منهما حسب holder_type، تفتحها
-- المحاسب نيابة عن السائق من شاشة الكمبيوتر، تماماً كما اتُّفق عليه.

create table if not exists custody_shifts (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references companies(id) on delete cascade,
  branch_id uuid references branches(id) on delete set null,
  holder_type text not null check (holder_type in ('data_entry_employee', 'driver')),
  holder_user_id uuid references users(id),
  holder_driver_id uuid references drivers(id),
  holder_label text,
  opened_at timestamptz not null default now(),
  opened_by_user_id uuid references users(id),
  status text not null default 'open' check (status in ('open', 'pending_confirmation', 'confirmed', 'rejected')),
  closed_at timestamptz,
  confirmed_by_user_id uuid references users(id),
  confirmed_at timestamptz,
  rejection_reason text,
  opening_journal_entry_id uuid references journal_entries(id),
  closing_journal_entry_id uuid references journal_entries(id),
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint custody_shifts_holder_ref_chk check (
    (holder_type = 'data_entry_employee' and holder_user_id is not null and holder_driver_id is null)
    or
    (holder_type = 'driver' and holder_driver_id is not null and holder_user_id is null)
  )
);

create index if not exists idx_custody_shifts_holder_user on custody_shifts(holder_user_id) where holder_user_id is not null;
create index if not exists idx_custody_shifts_holder_driver on custody_shifts(holder_driver_id) where holder_driver_id is not null;
create index if not exists idx_custody_shifts_status on custody_shifts(company_id, status);
create index if not exists idx_custody_shifts_branch on custody_shifts(branch_id) where branch_id is not null;

-- قاعدة "لا يمكن فتح عهدة جديدة بينما توجد عهدة سابقة بانتظار تأكيد
-- المحاسب" — مفروضة على مستوى القاعدة نفسها، لا الواجهة فقط. حسب نوع
-- الحامل، على عمود مختلف (user أو driver).
create unique index if not exists ux_custody_shifts_one_active_per_user
  on custody_shifts(holder_user_id)
  where holder_user_id is not null and status in ('open', 'pending_confirmation');

create unique index if not exists ux_custody_shifts_one_active_per_driver
  on custody_shifts(holder_driver_id)
  where holder_driver_id is not null and status in ('open', 'pending_confirmation');

comment on table custody_shifts is 'عهدة مالية موحّدة — موظف إدخال بيانات أو سائق؛ حامل واحد لا يستطيع فتح عهدة جديدة بينما لديه عهدة مفتوحة أو بانتظار تأكيد';

create table if not exists custody_shift_balances (
  id uuid primary key default gen_random_uuid(),
  custody_shift_id uuid not null references custody_shifts(id) on delete cascade,
  currency_code text not null references currencies(code),
  opening_amount numeric(14, 2) not null default 0,
  current_amount numeric(14, 2) not null default 0,
  unique (custody_shift_id, currency_code)
);

create index if not exists idx_custody_shift_balances_shift on custody_shift_balances(custody_shift_id);
