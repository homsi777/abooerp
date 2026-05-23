import RequirePermission from '../../../components/RequirePermission';
import RolesPermissionsSettingsPage from '../../../pages/settings/RolesPermissions';
import UsersSettingsPage from '../../../pages/settings/Users';

export default function UsersRolesPanel() {
  return (
    <div className="space-y-4">
      <RequirePermission
        permission="settings.users.read"
        fallback={<div className="card text-sm text-red-700">لا تملك صلاحية عرض المستخدمين.</div>}
      >
        <UsersSettingsPage />
      </RequirePermission>
      <RequirePermission
        permission="settings.roles.read"
        fallback={<div className="card text-sm text-red-700">لا تملك صلاحية عرض الأدوار والصلاحيات.</div>}
      >
        <RolesPermissionsSettingsPage />
      </RequirePermission>
    </div>
  );
}
