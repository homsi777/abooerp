-- ── Migration 043: جدول بوتات إشعارات الشحن ──────────────────────────────────
-- بوتات الإشعارات التي يضيفها الزبون (شركة الشحن) لإرسال إشعارات للوكلاء.
-- هذا الجدول مستقل تماماً عن بوت التفعيل الخاص بشركة البرمجة (الذي يبقى في .env).

create table if not exists telegram_notification_bots (
  id              uuid          primary key default gen_random_uuid(),
  company_id      uuid          not null references companies(id),
  name            text          not null,                 -- اسم مميز للبوت (مثل: بوت الفرع الرئيسي)
  bot_token       text          not null,                 -- توكن البوت من @BotFather
  is_active       boolean       not null default true,    -- هل هو مفعّل؟
  is_default      boolean       not null default false,   -- هل هو البوت الافتراضي لإشعارات الشركة؟
  notes           text,
  last_test_at    timestamptz,
  created_at      timestamptz   not null default now(),
  updated_at      timestamptz   not null default now()
);

-- يضمن وجود بوت افتراضي واحد فقط لكل شركة في أي وقت
create unique index if not exists uq_notif_bot_default
  on telegram_notification_bots(company_id)
  where is_default = true;

create index if not exists idx_notif_bots_company
  on telegram_notification_bots(company_id);
