import { useEffect, useMemo, useState } from 'react';
import { NavLink, useLocation } from 'react-router-dom';
import { X, ChevronDown, Megaphone } from 'lucide-react';
import { api } from '@/lib/api';
import { useAuth } from '@/context/AuthContext';
import { canSeeNavForUser, isExternalRole, EXTERNAL_NAV_PATHS } from '@/lib/permissions';
import { NAV_GROUPS } from '@/lib/navDestinations';
import { BrandLogo } from '@/components/ui/BrandLogo';
import '@/styles/sidebar-nav.css';

const KEY = 'gsjx.nav.open';
const readOpen = (): string | null => { try { return localStorage.getItem(KEY); } catch { return null; } };
const writeOpen = (v: string) => { try { localStorage.setItem(KEY, v); } catch { /* storage unavailable */ } };

export function Sidebar({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { user } = useAuth();
  const { pathname } = useLocation();
  const external = isExternalRole(user?.role);
  // Anyone can be a social media manager, so the posting queue appears for whoever has approved posts waiting for them.
  const [queued, setQueued] = useState(0);
  useEffect(() => {
    if (!user || external) { setQueued(0); return; }
    let on = true;
    api.get('/social-queue').then((r) => on && setQueued((r.data.data || []).length)).catch(() => on && setQueued(0));
    return () => { on = false; };
  }, [pathname, user, external]);

  const groups = useMemo(
    () => NAV_GROUPS.map((g) => ({ ...g, items: g.items.filter((i) => canSeeNavForUser(user, i.to)) })).filter((g) => g.items.length > 0),
    [user],
  );
  const isActivePath = (to: string) => (to === '/' ? pathname === '/' : pathname === to || pathname.startsWith(`${to}/`));
  const activeSection = groups.find((g) => g.section && g.items.some((i) => isActivePath(i.to)))?.section;

  // One section open at a time; the section holding the current page opens automatically.
  const [openSection, setOpenSection] = useState<string | null>(readOpen());
  useEffect(() => { if (activeSection) { setOpenSection(activeSection); writeOpen(activeSection); } }, [activeSection]);
  const toggle = (s: string) => { const next = openSection === s ? '' : s; setOpenSection(next); writeOpen(next); };

  const link = (item: (typeof NAV_GROUPS)[number]['items'][number]) => (
    <NavLink key={item.to} to={item.to} end={item.to === '/'} className={({ isActive }) => `sidebar-link ${isActive ? 'active' : ''}`} onClick={onClose}>
      {item.icon}
      {item.label}
      {item.beta && <span className="beta-pill">Beta</span>}
    </NavLink>
  );

  return (
    <aside className={`sidebar ${open ? 'open' : ''}`}>
      <div className="sidebar-brand flex-between">
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <BrandLogo size={34} />
          <span>Global SJX OS</span>
        </div>
        <button className="icon-btn mobile-toggle" onClick={onClose} aria-label="Close menu">
          <X />
        </button>
      </div>
      <nav className="sidebar-nav">
        {external ? (
          <div>
            <div className="sidebar-section-label">Your workspace</div>
            {NAV_GROUPS.flatMap((g) => g.items).filter((item) => EXTERNAL_NAV_PATHS.includes(item.to)).map(link)}
          </div>
        ) : (
          groups.map((group, i) => {
            if (!group.section) return <div key={i}>{i > 0 && <div className="nav-divider" />}{group.items.map(link)}</div>;
            const isOpen = openSection === group.section;
            const hasActive = group.section === activeSection;
            return (
              <div key={i} className={`nav-group ${isOpen ? 'open' : ''}`}>
                <button type="button" className={`nav-group-head ${hasActive ? 'has-active' : ''}`} aria-expanded={isOpen} onClick={() => toggle(group.section!)}>
                  <span className="nav-group-title">{group.section}</span>
                  <span className="nav-group-count">{group.items.length}</span>
                  <ChevronDown className="chev" />
                </button>
                <div className="nav-group-body"><div>{group.items.map(link)}</div></div>
              </div>
            );
          })
        )}
        {!external && queued > 0 && <div><div className="nav-divider" />{link({ label: `Posting queue (${queued})`, to: '/social-queue', icon: <Megaphone /> } as any)}</div>}
      </nav>
      <div className="sidebar-footer">
        <div style={{ fontSize: 11.5, color: 'var(--muted-2)' }}>Global SJX Limited</div>
        <div style={{ fontSize: 11, color: 'var(--muted-2)', marginTop: 2 }}>v1.0 — internal build</div>
      </div>
    </aside>
  );
}
