alter table shipments
  add column if not exists loaded_pieces_count integer not null default 0;

alter table shipments
  drop constraint if exists shipments_loaded_pieces_count_check;

alter table shipments
  add constraint shipments_loaded_pieces_count_check
  check (loaded_pieces_count >= 0 and loaded_pieces_count <= pieces_count);

comment on column shipments.loaded_pieces_count is 'Number of parcels loaded during the driver loading action.';
