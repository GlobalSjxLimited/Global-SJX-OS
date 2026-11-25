import { useAuth } from '@/context/AuthContext';
import { useTheme } from '@/context/ThemeContext';
import { Sun, Moon } from 'lucide-react';
import { MfaSettingsCard } from '@/components/ui/MfaSettingsCard';
import { AccountSecurityCard, PrivacyCard } from '@/components/ui/AccountSecurityCard';
import { SessionsCard } from '@/components/security/SessionsCard';
import { NotificationPrefsCard } from '@/components/ui/NotificationPrefsCard';

export function Settings() {
  const { user } = useAuth();
  const { theme, toggleTheme } = useTheme();

  return (
    <div>
      <div className="page-head">
        <div>
          <h1>Settings</h1>
          <p>Your profile and workspace preferences.</p>
        </div>
      </div>

      <div className="grid-2">
        <div className="card">
          <h3 style={{ fontSize: 16, marginBottom: 16 }}>Profile</h3>
          <div style={{ display: 'grid', gap: 14 }}>
            <div className="field"><label>Name</label><input className="input" value={user?.name || ''} disabled /></div>
            <div className="field"><label>Email</label><input className="input" value={user?.email || ''} disabled /></div>
            <div className="field"><label>Role</label><input className="input" value={user?.role?.replace('_', ' ') || ''} disabled /></div>
            <div className="field"><label>Job title</label><input className="input" value={user?.jobTitle || ''} disabled /></div>
          </div>
          <p style={{ fontSize: 12, color: 'var(--muted-2)', marginTop: 14 }}>Profile editing is managed by HR from the Employees module.</p>
        </div>

        <div className="card">
          <h3 style={{ fontSize: 16, marginBottom: 16 }}>Appearance</h3>
          <div className="flex-between">
            <div>
              <div style={{ fontSize: 14, fontWeight: 600 }}>Theme</div>
              <div style={{ fontSize: 12.5, color: 'var(--muted)' }}>Switch between dark and light mode.</div>
            </div>
            <button className="btn btn-ghost" onClick={toggleTheme}>
              {theme === 'dark' ? <Sun size={16} /> : <Moon size={16} />} {theme === 'dark' ? 'Light mode' : 'Dark mode'}
            </button>
          </div>
        </div>
      </div>

      <div style={{ marginTop: 20 }}>
        <NotificationPrefsCard />
      </div>

      <div style={{ marginTop: 20 }}>
        <MfaSettingsCard />
      </div>

      <div className="grid-2" style={{ marginTop: 20 }}>
        <AccountSecurityCard />
        <PrivacyCard />
      </div>

      <div style={{ marginTop: 20 }}>
        <SessionsCard />
      </div>

      <div className="card" style={{ marginTop: 20 }}>
        <h3 style={{ fontSize: 16, marginBottom: 10 }}>About this platform</h3>
        <p style={{ fontSize: 13, color: 'var(--muted)' }}>
          Global SJX OS is built with a multi-tenant-ready architecture (every record is scoped to an organization) so it can evolve
          into a commercial SaaS product without a schema rewrite. Security features implemented: JWT authentication, role-based
          access control, tenant-scoped queries on every module, TOTP multi-factor authentication, account lockout, session revocation, input sanitising, and a full audit trail. See Information Security in the sidebar for the controls register.
        </p>
      </div>
    </div>
  );
}
