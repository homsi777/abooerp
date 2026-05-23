import { Navigate, useLocation } from 'react-router-dom';
import { useAuth } from '../context/AuthProvider';

export default function RequirePermission({
  permission,
  children,
  fallback,
}: {
  permission: string;
  children: React.ReactNode;
  fallback?: React.ReactNode;
}) {
  const { hasPermission, user } = useAuth();
  const location = useLocation();

  if (!hasPermission(permission)) {
    if (fallback) {
      return <>{fallback}</>;
    }
    return (
      <Navigate
        to="/access-denied"
        replace
        state={{ from: location.pathname, missingPermission: permission }}
      />
    );
  }

  return <>{children}</>;
}
