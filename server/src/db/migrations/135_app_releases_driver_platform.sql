-- Driver Android app (apk-driver) needs its own update channel, like the
-- data-entry app got in 120_app_releases_dataentry_platform.sql. Additive
-- only — existing "android" / "android-dataentry" rows and behavior are
-- untouched.
alter table app_releases drop constraint if exists app_releases_platform_check;
alter table app_releases add constraint app_releases_platform_check
  check (platform in ('android', 'android-dataentry', 'android-driver'));
