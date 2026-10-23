-- Second Android app (warehouse data-entry) needs its own update channel,
-- distinct from the agent app's "android" release row, so each app only
-- ever sees its own version. Additive only — existing "android" rows and
-- behavior are untouched.
alter table app_releases drop constraint if exists app_releases_platform_check;
alter table app_releases add constraint app_releases_platform_check
  check (platform in ('android', 'android-dataentry'));
