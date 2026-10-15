alter table driver_trip_advances
  drop column if exists received_date,
  drop column if exists trip_date;
