import { NavLink } from 'react-router-dom';
import { LayoutDashboard, ListChecks, Plus, Sparkles, User } from 'lucide-react';
import { useState } from 'react';
import { QuickCreateMenu } from './QuickCreateMenu';

/**
 * Mobile-only bottom tab bar (hidden ≥980px via CSS). Kept deliberately small
 * — five destinations, matching the "mobile app should not reproduce every
 * desktop screen" principle: dashboard, my work, a central quick-create
 * action, AI assistant, profile/settings.
 */
export function MobileTabBar() {
  const [quickCreateOpen, setQuickCreateOpen] = useState(false);

  return (
    <>
      <nav className="mobile-tabbar" aria-label="Primary">
        <NavLink to="/" end className={({ isActive }) => `mobile-tab ${isActive ? 'active' : ''}`}>
          <LayoutDashboard size={20} />
          <span>Home</span>
        </NavLink>
        <NavLink to="/my-work" className={({ isActive }) => `mobile-tab ${isActive ? 'active' : ''}`}>
          <ListChecks size={20} />
          <span>My Work</span>
        </NavLink>
        <button className="mobile-tab mobile-tab-fab" onClick={() => setQuickCreateOpen(true)} aria-label="Quick create">
          <Plus size={22} />
        </button>
        <NavLink to="/ai" className={({ isActive }) => `mobile-tab ${isActive ? 'active' : ''}`}>
          <Sparkles size={20} />
          <span>AI</span>
        </NavLink>
        <NavLink to="/settings" className={({ isActive }) => `mobile-tab ${isActive ? 'active' : ''}`}>
          <User size={20} />
          <span>Profile</span>
        </NavLink>
      </nav>
      <QuickCreateMenu open={quickCreateOpen} onClose={() => setQuickCreateOpen(false)} />
    </>
  );
}
