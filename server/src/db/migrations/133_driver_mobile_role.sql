-- 133_driver_mobile_role.sql
-- دعم تطبيق السائق (AbooERP Driver): حساب دخول مرتبط بسجل سائق محدَّد، دور
-- بصلاحيات ضيّقة (قراءة رحلته فقط + إرسال موقعه)، وجدولا جلسات التتبّع ونبضات
-- الموقع. لا يمسّ أي جدول موجود غير users (عمود جديد اختياري) والصلاحيات.

alter table users add column if not exists driver_id uuid references drivers(id);
create index if not exists idx_users_driver_id on users(driver_id) where driver_id is not null;

insert into permissions (code, name, module, action, is_active)
values
  ('driver.trip.read', 'عرض رحلة السائق الحالية', 'driver_mobile', 'read', true),
  ('driver.location.write', 'إرسال موقع السائق', 'driver_mobile', 'write', true)
on conflict (code) do update set
  name = excluded.name,
  module = excluded.module,
  action = excluded.action,
  is_active = excluded.is_active;

insert into roles (code, name, description, is_system, is_active)
values (
  'driver_mobile',
  'سائق — تطبيق أندرويد',
  'صلاحيات ضيّقة تقتصر على تطبيق السائق فقط: عرض رحلته الحالية وشحناتها، وإرسال نبضات موقعه أثناء الرحلة — لا تشمل أي شاشة إدارية.',
  true,
  true
)
on conflict (code) do update set
  name = excluded.name,
  description = excluded.description,
  is_active = excluded.is_active;

insert into role_permissions (role_id, permission_id)
select r.id, p.id
from roles r
join permissions p on p.code in ('driver.trip.read', 'driver.location.write')
where r.code = 'driver_mobile'
on conflict do nothing;

-- جلسات تتبّع الرحلة: بدء/إنهاء صريحان من التطبيق، لا تمسّ حالة المانيفست
-- الإدارية (manifests.status) إطلاقاً — تلك تبقى بيد مكتب التشغيل فقط.
create table if not exists driver_trip_sessions (
  id uuid primary key default gen_random_uuid(),
  manifest_id uuid not null references manifests(id),
  driver_id uuid not null references drivers(id),
  started_at timestamptz not null default now(),
  ended_at timestamptz,
  created_at timestamptz not null default now()
);

create index if not exists idx_driver_trip_sessions_manifest on driver_trip_sessions(manifest_id);
create index if not exists idx_driver_trip_sessions_driver_open
  on driver_trip_sessions(driver_id)
  where ended_at is null;

-- نبضات موقع السائق أثناء الرحلة.
create table if not exists driver_location_pings (
  id uuid primary key default gen_random_uuid(),
  driver_id uuid not null references drivers(id),
  manifest_id uuid references manifests(id),
  lat numeric(10, 6) not null,
  lng numeric(10, 6) not null,
  accuracy_m numeric(8, 2),
  recorded_at timestamptz not null,
  created_at timestamptz not null default now()
);

create index if not exists idx_driver_location_pings_driver_recorded
  on driver_location_pings(driver_id, recorded_at desc);
create index if not exists idx_driver_location_pings_manifest
  on driver_location_pings(manifest_id);

comment on table driver_trip_sessions is 'بدء/إنهاء تتبّع الرحلة من تطبيق السائق — مستقل عن حالة المانيفست الإدارية.';
comment on table driver_location_pings is 'نبضات GPS دورية من تطبيق السائق أثناء الرحلة — لشاشة خريطة شحنات لاحقاً.';
