import { Navigate, useLocation } from 'react-router-dom';
import { useAuth } from '@/context/AuthContext';
import { canSeeNavForUser, isExternalRole, EXTERNAL_NAV_PATHS } from '@/lib/permissions';
import { ForcePasswordChange } from '@/components/security/ForcePasswordChange';

export function ProtectedRoute({ children }: { children: React.ReactNode }) {
  const { user, loading } = useAuth();
  const location = useLocation();

  if (loading) {
    return (
      <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'var(--ink)', color: 'var(--muted)' }}>
        Loading Global SJX OS…
      </div>
    );
  }
  if (!user) return <Navigate to="/login" replace />;

  // Route-level RBAC: mirrors what's hidden from the sidebar, so a restricted
  // module can't be reached just by typing the URL. The API would reject the
  // underlying requests anyway (or scope them down to nothing useful), but a
  // hard redirect here is a much better experience than a page full of
  // "unauthorized" errors.
  const path = '/' + location.pathname.split('/')[1];
  const allowed = isExternalRole(user.role) ? EXTERNAL_NAV_PATHS.includes(path) || path === '/' : canSeeNavForUser(user, path);
  if (user.mustChangePassword) return <ForcePasswordChange />;
  if (!allowed) return <Navigate to="/" replace />;

  return <>{children}</>;
}
