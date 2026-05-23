-- ── Telegram Activation Settings ─────────────────────────────────────────────
create table if not exists telegram_activation_settings (
  id           uuid        primary key default gen_random_uuid(),
  company_id   uuid        not null references companies(id) on delete cascade,
  bot_token    text        not null,
  chat_id      text        not null,
  bot_username text,
  is_enabled   boolean     not null default true,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  unique(company_id)
);

-- ── Agent Telegram Bots ───────────────────────────────────────────────────────
create table if not exists agent_telegram_bots (
  id           uuid        primary key default gen_random_uuid(),
  company_id   uuid        not null references companies(id) on delete cascade,
  agent_id     uuid        not null references agents(id) on delete cascade,
  bot_token    text        not null,
  chat_id      text        not null,
  bot_username text,
  is_enabled   boolean     not null default true,
  last_test_at timestamptz,
  notes        text,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

create index if not exists idx_agent_telegram_bots_company_agent
  on agent_telegram_bots(company_id, agent_id);

create index if not exists idx_agent_telegram_bots_company_enabled
  on agent_telegram_bots(company_id, is_enabled);

-- ── Permissions ───────────────────────────────────────────────────────────────
insert into permissions (code, name, module, action, is_active) values
  ('settings.telegram.read',  'قراءة إعدادات تيليجرام', 'settings', 'read',  true),
  ('settings.telegram.write', 'تعديل إعدادات تيليجرام', 'settings', 'write', true)
on conflict (code) do nothing;

insert into role_permissions (role_id, permission_id)
select r.id, p.id
from roles r
cross join permissions p
where r.code = 'ADMIN'
  and p.code in ('settings.telegram.read', 'settings.telegram.write')
on conflict do nothing;
