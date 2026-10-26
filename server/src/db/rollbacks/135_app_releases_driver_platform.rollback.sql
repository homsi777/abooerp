alter table app_releases drop constraint if exists app_releases_platform_check;
alter table app_releases add constraint app_releases_platform_check
  check (platform in ('android', 'android-dataentry'));
