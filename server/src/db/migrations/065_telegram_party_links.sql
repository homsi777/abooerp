-- Migration 065: Smart Telegram party links
-- Stores Telegram chat IDs linked to business parties (agent/customer/sender_receiver)
-- with strict FK integrity and one-party-per-link constraint.

create table if not exists telegram_party_links (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references companies(id) on delete cascade,
  notification_bot_id uuid references telegram_notification_bots(id) on delete set null,

  -- Exactly one of these must be filled
  agent_id uuid references agents(id) on delete cascade,
  customer_id uuid references customers(id) on delete cascade,
  sender_receiver_id uuid references senders_receivers(id) on delete cascade,

  chat_id text not null,
  is_active boolean not null default true,

  -- Last inbound message snapshot for operator recognition
  last_message text,
  last_message_at timestamptz,
  last_seen_username text,
  last_seen_name text,
  source_update_id bigint,

  created_by uuid references users(id) on delete set null,
  updated_by uuid references users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint chk_telegram_party_links_one_party
    check (num_nonnulls(agent_id, customer_id, sender_receiver_id) = 1)
);

create index if not exists idx_telegram_party_links_company
  on telegram_party_links(company_id);

create index if not exists idx_telegram_party_links_chat
  on telegram_party_links(company_id, chat_id);

create unique index if not exists uq_telegram_party_links_agent
  on telegram_party_links(company_id, agent_id)
  where agent_id is not null;

create unique index if not exists uq_telegram_party_links_customer
  on telegram_party_links(company_id, customer_id)
  where customer_id is not null;

create unique index if not exists uq_telegram_party_links_sender_receiver
  on telegram_party_links(company_id, sender_receiver_id)
  where sender_receiver_id is not null;

comment on table telegram_party_links is
  'Smart Telegram chat linking between bot users and business parties.';

