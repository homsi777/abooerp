export type SettingsSectionId =
  | 'overview'
  | 'company'
  | 'currencies'
  | 'branches'
  | 'printers'
  | 'shipping_label_print'
  | 'users_roles'
  | 'terminology'
  | 'audit_log'
  | 'backup'
  | 'system'
  | 'localization'
  | 'linked_devices';

export interface SettingsSectionMeta {
  id: SettingsSectionId;
  label: string;
  icon: string;
  group: 'General' | 'Organization' | 'Financial' | 'Security' | 'Printing' | 'System';
  permission?: string;
}

export const SETTINGS_SECTIONS: SettingsSectionMeta[] = [
  { id: 'overview', label: 'لوحة التحكم', icon: 'LayoutDashboard', group: 'General' },
  { id: 'company', label: 'معلومات الشركة', icon: 'Building', group: 'General' },
  { id: 'localization', label: 'الإعدادات الإقليمية', icon: 'Globe', group: 'General' },
  { id: 'currencies', label: 'العملات وأسعار الصرف', icon: 'DollarSign', group: 'Financial', permission: 'settings.currencies.read' },
  { id: 'shipping_label_print', label: 'تخصيص طباعة لصاقة الشحن', icon: 'Package', group: 'Printing', permission: 'settings.shippingLabel.read' },
  { id: 'users_roles', label: 'المستخدمون والصلاحيات', icon: 'Users', group: 'Security', permission: 'settings.users.read' },
  { id: 'linked_devices', label: 'الأجهزة المرتبطة', icon: 'Monitor', group: 'Security', permission: 'settings.devices.read' },
  { id: 'audit_log', label: 'سجل النشاط', icon: 'ClipboardList', group: 'Security', permission: 'settings.audit.read' },
  { id: 'printers', label: 'إعدادات الطابعات', icon: 'Printer', group: 'Printing', permission: 'settings.printers.read' },
  { id: 'backup', label: 'النسخ الاحتياطي والاستعادة', icon: 'DatabaseBackup', group: 'System', permission: 'settings.backup.read' },
  { id: 'system', label: 'إعدادات النظام', icon: 'Settings', group: 'System', permission: 'settings.system.read' },
  { id: 'terminology', label: 'تخصيص المصطلحات', icon: 'Type', group: 'System', permission: 'settings.terminology.read' },
];

export const SETTINGS_GROUP_ORDER: SettingsSectionMeta['group'][] = [
  'General',
  'Organization',
  'Financial',
  'Security',
  'Printing',
  'System',
];

export const SETTINGS_GROUP_LABELS: Record<SettingsSectionMeta['group'], string> = {
  General: 'General',
  Organization: 'Organization',
  Financial: 'Financial',
  Security: 'Security',
  Printing: 'Printing',
  System: 'System',
};

export const SETTINGS_SECTION_STORAGE_KEY = 'activeSettingsSection';
