-- سجل الأحداث التفصيلي: حصراً لدور المدير (admin) عبر صلاحية admin.events.read
insert into permissions(code, name, module, action, is_active)
values
  ('admin.events.read', 'سجل الأحداث (المدير العام)', 'admin_events', 'read', true)
on conflict (code) do update
set
  name = excluded.name,
  module = excluded.module,
  action = excluded.action,
  is_active = excluded.is_active,
  updated_at = now();

insert into role_permissions(role_id, permission_id, permission_code)
select r.id, p.id, p.code
from roles r
join permissions p on p.code = 'admin.events.read'
where r.code = 'admin'
on conflict (role_id, permission_id) do update
set permission_code = excluded.permission_code;
