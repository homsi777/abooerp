-- Migration 075: Shipment agent commission snapshot (V1)
-- Stores historical agent commission data on the shipment record so later changes
-- to agents.commission_percentage do not retroactively affect old shipments.

alter table shipments
  add column if not exists agent_commission_base_type text,
  add column if not exists agent_commission_base_amount numeric(14, 2),
  add column if not exists agent_commission_percentage_snapshot numeric(5, 2),
  add column if not exists agent_commission_amount_snapshot numeric(14, 2);

alter table shipments drop constraint if exists shipments_agent_commission_base_type_check;
alter table shipments
  add constraint shipments_agent_commission_base_type_check
  check (
    agent_commission_base_type is null
    or agent_commission_base_type in ('FREIGHT_CHARGE')
  );

create index if not exists idx_shipments_agent_commission_snapshot
  on shipments(agent_id, agent_commission_amount_snapshot)
  where agent_id is not null and coalesce(agent_commission_amount_snapshot, 0) > 0;

comment on column shipments.agent_commission_base_type is 'Commission base type. V1 supports FREIGHT_CHARGE only.';
comment on column shipments.agent_commission_base_amount is 'Base amount used to calculate agent commission (in shipment original currency).';
comment on column shipments.agent_commission_percentage_snapshot is 'Agent commission percentage snapshot at operation time.';
comment on column shipments.agent_commission_amount_snapshot is 'Agent commission amount snapshot at operation time (in shipment original currency).';
