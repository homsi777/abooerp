-- 130_driver_trip_advance_dates.sql
-- A driver may receive cash from an agent on a different date than the
-- official trip date (e.g. trip dated Oct 3, cash actually handed over
-- Oct 5) — both dates need to be recorded separately for an accurate
-- driver report. Additive only.

alter table driver_trip_advances
  add column if not exists trip_date     date,
  add column if not exists received_date date;
