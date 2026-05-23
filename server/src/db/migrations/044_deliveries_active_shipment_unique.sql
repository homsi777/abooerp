alter table deliveries
  drop constraint if exists deliveries_shipment_id_key;

create unique index if not exists ux_deliveries_active_shipment
  on deliveries(shipment_id)
  where deleted_at is null;
