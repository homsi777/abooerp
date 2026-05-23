import { type SettingsSectionId } from '../../lib/settings/settingsSections';
import LinkedDevicesPage from '../../pages/settings/LinkedDevicesPage';
import AuditLogPanel from './panels/AuditLogPanel';
import BackupPanel from './panels/BackupPanel';
import BranchSettingsPanel from './panels/BranchSettingsPanel';
import CompanySettingsPanel from './panels/CompanySettingsPanel';
import CurrencySettingsPanel from './panels/CurrencySettingsPanel';
import LocalizationPanel from './panels/LocalizationPanel';
import PrinterSettingsPanel from './panels/PrinterSettingsPanel';
import ShippingLabelPrintSettingsPanel from './panels/ShippingLabelPrintSettingsPanel';
import SettingsOverviewPanel from './panels/SettingsOverviewPanel';
import SystemSettingsPanel from './panels/SystemSettingsPanel';
import TerminologyPanel from './panels/TerminologyPanel';
import UsersRolesPanel from './panels/UsersRolesPanel';

interface SettingsWorkspaceProps {
  activeSection: SettingsSectionId;
}

export default function SettingsWorkspace({ activeSection }: SettingsWorkspaceProps) {
  switch (activeSection) {
    case 'company':
      return <CompanySettingsPanel />;
    case 'currencies':
      return <CurrencySettingsPanel />;
    case 'branches':
      return <BranchSettingsPanel />;
    case 'printers':
      return <PrinterSettingsPanel />;
    case 'shipping_label_print':
      return <ShippingLabelPrintSettingsPanel />;
    case 'users_roles':
      return <UsersRolesPanel />;
    case 'linked_devices':
      return <LinkedDevicesPage />;
    case 'terminology':
      return <TerminologyPanel />;
    case 'audit_log':
      return <AuditLogPanel />;
    case 'backup':
      return <BackupPanel />;
    case 'system':
      return <SystemSettingsPanel />;
    case 'localization':
      return <LocalizationPanel />;
    case 'overview':
    default:
      return <SettingsOverviewPanel />;
  }
}
