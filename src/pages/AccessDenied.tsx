import { useNavigate, useLocation } from 'react-router-dom';
import { useAuth } from '../context/AuthProvider';

export default function AccessDenied() {
  const navigate = useNavigate();
  const location = useLocation();
  const { logout } = useAuth();

  const state = (location.state || {}) as { from?: string; missingPermission?: string };

  return (
    <div className="h-full flex items-center justify-center">
      <div className="card max-w-xl w-full space-y-4">
        <h2 className="text-xl font-bold text-red-700">لا تملك صلاحية الوصول</h2>
        <p className="text-gray-700">
          ليس لديك الصلاحية اللازمة لفتح هذه الصفحة.
        </p>
        {state.from && (
          <p className="text-sm text-gray-600">المسار المطلوب: {state.from}</p>
        )}
        {state.missingPermission && (
          <p className="text-sm text-gray-600">الصلاحية المطلوبة: {state.missingPermission}</p>
        )}
        <div className="flex gap-2">
          <button className="toolbar-btn primary" onClick={() => navigate('/dashboard')}>
            العودة إلى الرئيسية
          </button>
          <button
            className="toolbar-btn"
            onClick={() => {
              void logout('access-denied');
              navigate('/login');
            }}
          >
            تسجيل الخروج
          </button>
        </div>
      </div>
    </div>
  );
}
