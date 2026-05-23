-- Phase 1: Shipment lifecycle foundation with backward compatibility

-- Keep both legacy and canonical statuses allowed in DB during transition.
alter table shipments drop constraint if exists shipments_status_check;
alter table shipments
  add constraint shipments_status_check check (
    status in (
      -- canonical
      'DRAFT','REGISTERED','CONFIRMED','READY_FOR_PICKUP','HANDED_TO_DRIVER','HANDED_TO_AGENT',
      'AGENT_RECEIVED','IN_TRANSIT','ARRIVED_AT_DESTINATION','OUT_FOR_DELIVERY','DELIVERED',
      'RETURN_REQUESTED','RETURNED','CANCELLED','FINANCIALLY_CLOSED',
      -- legacy
      'created','draft','confirmed','loaded','manifested','in_transit','arrived','ready_delivery','delivered','returned','cancelled'
    )
  );

create index if not exists idx_shipments_status_company_branch
  on shipments(status, company_id, branch_id)
  where deleted_at is null;

alter table shipment_status_history
  add column if not exists previous_status text,
  add column if not exists next_status text,
  add column if not exists source text,
  add column if not exists metadata jsonb not null default '{}'::jsonb;

alter table shipment_status_history drop constraint if exists shipment_status_history_status_check;
alter table shipment_status_history
  add constraint shipment_status_history_status_check check (
    status in (
      -- canonical
      'DRAFT','REGISTERED','CONFIRMED','READY_FOR_PICKUP','HANDED_TO_DRIVER','HANDED_TO_AGENT',
      'AGENT_RECEIVED','IN_TRANSIT','ARRIVED_AT_DESTINATION','OUT_FOR_DELIVERY','DELIVERED',
      'RETURN_REQUESTED','RETURNED','CANCELLED','FINANCIALLY_CLOSED',
      -- legacy
      'created','draft','confirmed','loaded','manifested','in_transit','arrived','ready_delivery','delivered','returned','cancelled'
    )
  );

update shipment_status_history
set next_status = coalesce(next_status, status)
where next_status is null;

create index if not exists idx_shipment_status_history_shipment_changed_at
  on shipment_status_history(shipment_id, changed_at desc);

