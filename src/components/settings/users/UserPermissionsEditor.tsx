import { PERMISSION_GROUPS, type PermissionAction, type UserPermissionMatrix } from '../../../lib/settings/usersPermissions';

interface UserPermissionsEditorProps {
  value: UserPermissionMatrix;
  onChange: (next: UserPermissionMatrix) => void;
  compact?: boolean;
}

const actionLabel: Record<PermissionAction, string> = {
  view: 'عرض',
  create: 'إضافة',
  edit: 'تعديل',
  delete: 'حذف',
  print: 'طباعة',
  export: 'تصدير',
  approve: 'اعتماد',
};

export default function UserPermissionsEditor({ value, onChange, compact = false }: UserPermissionsEditorProps) {
  const togglePermission = (groupId: string, action: PermissionAction, checked: boolean) => {
    onChange({
      ...value,
      [groupId]: {
        ...(value[groupId] || {}),
        [action]: checked,
      },
    });
  };

  return (
    <div className={compact ? 'space-y-2' : 'space-y-3'}>
      {PERMISSION_GROUPS.map((group) => (
        <div className="card" key={group.id} style={{ margin: 0 }}>
          <div className="card-header">{group.label}</div>
          <div className="grid grid-cols-4 gap-2 text-sm">
            {group.actions.map((action) => (
              <label className="flex items-center gap-2" key={action}>
                <input
                  type="checkbox"
                  checked={Boolean(value[group.id]?.[action])}
                  onChange={(e) => togglePermission(group.id, action, e.target.checked)}
                />
                <span>{actionLabel[action]}</span>
              </label>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}
