-- Add Telegram Chat ID directly to agents table
-- Admin enters each agent's personal Telegram Chat ID in the agent profile.
-- The system uses the global notification bot to send shipment alerts to that Chat ID.
alter table agents add column if not exists telegram_chat_id text;
