import RequirePermission from '../../../components/RequirePermission';
import AuditLogsSettingsPage from '../../../pages/settings/AuditLogs';

export default function AuditLogPanel() {
  return (
    <RequirePermission
      permission="settings.audit.read"
      fallback={<div className="card text-sm text-red-700">لا تملك صلاحية عرض سجل التدقيق.</div>}
    >
      <AuditLogsSettingsPage />
    </RequirePermission>
  );
}
