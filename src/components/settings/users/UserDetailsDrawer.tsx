import { countEnabledPermissions, USER_ROLE_LABELS } from '../../../lib/settings/usersPermissions';
import { type AdminUser } from '../../../lib/settings/usersSettingsStore';

interface UserDetailsDrawerProps {
  user: AdminUser | null;
  open: boolean;
  onClose: () => void;
  onEdit: (user: AdminUser) => void;
  onOpenPermissions: (user: AdminUser) => void;
  onToggleStatus: (user: AdminUser) => void;
}

export default function UserDetailsDrawer({
  user,
  open,
  onClose,
  onEdit,
  onOpenPermissions,
  onToggleStatus,
}: UserDetailsDrawerProps) {
  if (!open || !user) return null;

  const statusLabel = user.status === 'active' ? 'نشط' : user.status === 'inactive' ? 'غير نشط' : 'موقوف';
  const userTypeLabel = user.userType === 'local' ? 'محلي' : 'وكيل بعيد / سحابي';

  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.2)', zIndex: 100 }}>
      <div
        className="card"
        style={{
          position: 'absolute',
          top: 0,
          left: 0,
          width: '430px',
          height: '100%',
          overflow: 'auto',
          borderRadius: 0,
        }}
      >
        <div className="card-header">تفاصيل المستخدم</div>
        <div className="space-y-3 text-sm">
          <div><strong>الاسم:</strong> {user.fullName}</div>
          <div><strong>اسم المستخدم:</strong> {user.username}</div>
          <div><strong>الدور:</strong> {USER_ROLE_LABELS[user.role]}</div>
          <div><strong>نوع المستخدم:</strong> {userTypeLabel}</div>
          <div><strong>الحالة:</strong> {statusLabel}</div>
          <div><strong>الهاتف:</strong> {user.phone}</div>
          <div><strong>البريد:</strong> {user.email || '-'}</div>
          <div><strong>الفرع/الوكيل:</strong> {user.userType === 'local' ? user.defaultBranch : user.linkedAgentOffice}</div>
          <div><strong>آخر نشاط:</strong> {user.lastActivity}</div>
          <div><strong>إجمالي الصلاحيات المفعلة:</strong> {countEnabledPermissions(user.permissions)}</div>
          <div><strong>ملاحظات:</strong> {user.notes || '-'}</div>
        </div>

        <div className="flex gap-2 mt-4">
          <button className="toolbar-btn primary" onClick={() => onEdit(user)}>تعديل</button>
          <button className="toolbar-btn" onClick={() => onOpenPermissions(user)}>صلاحيات</button>
          <button className="toolbar-btn" onClick={() => onToggleStatus(user)}>
            {user.status === 'active' ? 'إيقاف' : 'تفعيل'}
          </button>
          <button className="toolbar-btn" onClick={onClose}>إغلاق</button>
        </div>
      </div>
    </div>
  );
}
