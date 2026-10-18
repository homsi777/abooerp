drop table if exists driver_location_pings;
drop table if exists driver_trip_sessions;

delete from role_permissions
where role_id = (select id from roles where code = 'driver_mobile')
  and permission_id in (select id from permissions where code in ('driver.trip.read', 'driver.location.write'));

delete from roles where code = 'driver_mobile';
delete from permissions where code in ('driver.trip.read', 'driver.location.write');

drop index if exists idx_users_driver_id;
alter table users drop column if exists driver_id;
