import { useAuth } from '../../../context/AuthProvider';
import AgentsSettingsPage from '../../../pages/settings/Agents';
import BranchesSettingsPage from '../../../pages/settings/Branches';

export default function BranchSettingsPanel() {
  const { hasPermission } = useAuth();
  const canReadBranches = hasPermission('settings.branches.read');
  const canReadAgents = hasPermission('settings.agents.read');

  return (
    <div className="space-y-4">
      {canReadBranches ? (
        <BranchesSettingsPage />
      ) : (
        <div className="card text-sm text-red-700">لا تملك صلاحية عرض إعدادات الفروع.</div>
      )}
      {canReadAgents ? (
        <AgentsSettingsPage />
      ) : (
        <div className="card text-sm text-red-700">لا تملك صلاحية عرض إعدادات الوكلاء.</div>
      )}
    </div>
  );
}
