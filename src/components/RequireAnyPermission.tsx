import { Navigate, useLocation } from 'react-router-dom';
import { useAuth } from '../context/AuthProvider';

export default function RequireAnyPermission({
  permissions,
  children,
  fallback,
}: {
  permissions: string[];
  children: React.ReactNode;
  fallback?: React.ReactNode;
}) {
  const { hasAnyPermission, user } = useAuth();
  const location = useLocation();

  if (!hasAnyPermission(permissions)) {
    if (fallback) {
      return <>{fallback}</>;
    }
    return (
      <Navigate
        to="/access-denied"
        replace
        state={{ from: location.pathname, missingPermission: permissions.join(' | ') }}
      />
    );
  }

  return <>{children}</>;
}
