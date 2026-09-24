-- App update manifest: lets the Android agent app check for and download new
-- releases from our own domain instead of Google Play (we sideload the APK).
create table if not exists app_releases (
  id uuid primary key default gen_random_uuid(),
  platform text not null check (platform in ('android')),
  version_code integer not null,
  version_name text not null,
  apk_url text not null,
  changelog text,
  mandatory boolean not null default false,
  created_at timestamptz not null default now()
);

create index if not exists idx_app_releases_platform_version
  on app_releases(platform, version_code desc);
