import { KeyboardEvent, useMemo } from 'react';
import { NavLink } from 'react-router-dom';
import {
  Building,
  ClipboardList,
  DatabaseBackup,
  DollarSign,
  GitBranch,
  Globe,
  LayoutDashboard,
  Package,
  Printer,
  Settings,
  Type,
  Users,
  type LucideIcon,
} from 'lucide-react';
import {
  SETTINGS_GROUP_LABELS,
  SETTINGS_GROUP_ORDER,
  SETTINGS_SECTIONS,
  type SettingsSectionId,
} from '../../lib/settings/settingsSections';
import { useAuth } from '../../context/AuthProvider';

interface SettingsNavigationPanelProps {
  activeSection: SettingsSectionId;
  onSelect: (section: SettingsSectionId) => void;
}

const iconMap: Record<string, LucideIcon> = {
  Building,
  ClipboardList,
  DatabaseBackup,
  DollarSign,
  GitBranch,
  Globe,
  LayoutDashboard,
  Package,
  Printer,
  Settings,
  Type,
  Users,
};

export default function SettingsNavigationPanel({ activeSection, onSelect }: SettingsNavigationPanelProps) {
  const { hasPermission } = useAuth();
  const visibleSections = useMemo(
    () => SETTINGS_SECTIONS.filter((section) => !section.permission || hasPermission(section.permission)),
    [hasPermission],
  );

  const grouped = useMemo(() => {
    return SETTINGS_GROUP_ORDER.map((group) => ({
      group,
      label: SETTINGS_GROUP_LABELS[group],
      sections: visibleSections.filter((section) => section.group === group),
    })).filter((group) => group.sections.length > 0);
  }, [visibleSections]);

  const flatSections = useMemo(
    () => SETTINGS_GROUP_ORDER.flatMap((group) => visibleSections.filter((section) => section.group === group)),
    [visibleSections],
  );

  const handleKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const currentIndex = flatSections.findIndex((section) => section.id === activeSection);
    if (currentIndex < 0) return;

    if (event.key === 'ArrowDown') {
      event.preventDefault();
      const next = flatSections[(currentIndex + 1) % flatSections.length];
      onSelect(next.id);
    }

    if (event.key === 'ArrowUp') {
      event.preventDefault();
      const prev = flatSections[(currentIndex - 1 + flatSections.length) % flatSections.length];
      onSelect(prev.id);
    }
  };

  return (
    <div className="w-72 card overflow-auto no-print" onKeyDown={handleKeyDown} tabIndex={0}>
      <div className="card-header">لوحة أقسام الإعدادات</div>
      <div className="space-y-3">
        {grouped.map((group) => (
          <div key={group.group}>
            <div className="text-xs text-gray-500 mb-1 px-1">{group.label}</div>
            <div className="space-y-1">
              {group.sections.map((section) => {
                const Icon = iconMap[section.icon] || Settings;
                const isActive = section.id === activeSection;
                return (
                  <NavLink
                    key={section.id}
                    to={`/settings/${section.id}`}
                    onClick={() => onSelect(section.id)}
                    className={`flex items-center gap-2 rounded px-3 py-2 text-sm ${isActive ? 'bg-primary text-white' : 'hover:bg-gray-100 text-gray-700'}`}
                    style={{ textDecoration: 'none' }}
                  >
                    <Icon size={16} />
                    <span>{section.label}</span>
                  </NavLink>
                );
              })}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
