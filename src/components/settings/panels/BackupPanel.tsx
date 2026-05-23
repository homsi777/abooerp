import RequirePermission from '../../../components/RequirePermission';
import BackupsSettingsPage from '../../../pages/settings/Backups';

export default function BackupPanel() {
  return (
    <RequirePermission
      permission="settings.backup.read"
      fallback={<div className="card text-sm text-red-700">لا تملك صلاحية عرض إعدادات النسخ الاحتياطي.</div>}
    >
      <BackupsSettingsPage />
    </RequirePermission>
  );
}
