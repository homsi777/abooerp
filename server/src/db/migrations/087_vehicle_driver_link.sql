alter table vehicles
  add column if not exists driver_id uuid references drivers(id);

create index if not exists idx_vehicles_driver
  on vehicles(driver_id)
  where driver_id is not null;
