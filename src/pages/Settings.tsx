import { useEffect, useMemo } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import SettingsNavigationPanel from '../components/settings/SettingsNavigationPanel';
import SettingsWorkspace from '../components/settings/SettingsWorkspace';
import {
  SETTINGS_SECTIONS,
  SETTINGS_SECTION_STORAGE_KEY,
  type SettingsSectionId,
} from '../lib/settings/settingsSections';

export default function Settings() {
  const navigate = useNavigate();
  const { sectionId } = useParams();
  const validIds = useMemo(() => SETTINGS_SECTIONS.map((section) => section.id), []);
  const isValidSection = (value: string | undefined): value is SettingsSectionId =>
    Boolean(value && validIds.includes(value as SettingsSectionId));

  const activeSection: SettingsSectionId = isValidSection(sectionId) ? sectionId : 'overview';

  useEffect(() => {
    if (!sectionId) {
      navigate('/settings/overview', { replace: true });
      return;
    }

    if (!isValidSection(sectionId)) {
      navigate('/settings/overview', { replace: true });
      return;
    }

    window.localStorage.setItem(SETTINGS_SECTION_STORAGE_KEY, sectionId);
  }, [sectionId, navigate]);

  const handleSelectSection = (section: SettingsSectionId) => {
    window.localStorage.setItem(SETTINGS_SECTION_STORAGE_KEY, section);
    navigate(`/settings/${section}`);
  };

  return (
    <div className="h-full flex flex-col">
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-xl font-bold">ERP System Control Center</h2>
      </div>

      <div className="flex flex-row-reverse gap-4 flex-1 overflow-hidden">
        <SettingsNavigationPanel activeSection={activeSection} onSelect={handleSelectSection} />
        <div className="flex-1 overflow-auto">
          <SettingsWorkspace activeSection={activeSection} />
        </div>
      </div>
    </div>
  );
}
