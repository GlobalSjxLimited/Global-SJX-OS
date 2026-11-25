import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Search, Bell, Menu, PanelLeftClose, PanelLeftOpen, Sun, Moon, LogOut, Plus, Command, HelpCircle, ChevronDown, Building2 } from 'lucide-react';
import { useAuth } from '@/context/AuthContext';
import { useTheme } from '@/context/ThemeContext';
import { useConfirm } from '@/context/ConfirmContext';
import { api } from '@/lib/api';
import { NotificationItem } from '@/types';
import { QuickCreateMenu } from './QuickCreateMenu';
import { HelpMenu } from './HelpMenu';

interface SearchResult { type: string; id: string; label: string; meta?: string; link: string; }

export function Topbar({ onMenuClick, sidebarCollapsed, onToggleSidebar }: { onMenuClick: () => void; sidebarCollapsed?: boolean; onToggleSidebar?: () => void }) {
  const { user, logout } = useAuth();
  const { theme, toggleTheme } = useTheme();
  const confirm = useConfirm();
  const navigate = useNavigate();

  const [query, setQuery] = useState('');
  const [results, setResults] = useState<SearchResult[]>([]);
  const [showResults, setShowResults] = useState(false);
  const [notifications, setNotifications] = useState<NotificationItem[]>([]);
  const [unreadCount, setUnreadCount] = useState(0);
  const [showNotifications, setShowNotifications] = useState(false);
  const [showUserMenu, setShowUserMenu] = useState(false);
  const [showOrgMenu, setShowOrgMenu] = useState(false);
  const [quickCreateOpen, setQuickCreateOpen] = useState(false);
  const [helpOpen, setHelpOpen] = useState(false);
  const searchRef = useRef<HTMLDivElement>(null);
  const notifRef = useRef<HTMLDivElement>(null);
  const orgRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const t = setTimeout(() => {
      if (query.trim().length >= 2) {
        api.get('/search', { params: { q: query } }).then((res) => setResults(res.data.data));
      } else {
        setResults([]);
      }
    }, 250);
    return () => clearTimeout(t);
  }, [query]);

  useEffect(() => {
    loadNotifications();
    const interval = setInterval(loadNotifications, 60000);
    return () => clearInterval(interval);
  }, []);

  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (searchRef.current && !searchRef.current.contains(e.target as Node)) setShowResults(false);
      if (notifRef.current && !notifRef.current.contains(e.target as Node)) setShowNotifications(false);
      if (orgRef.current && !orgRef.current.contains(e.target as Node)) setShowOrgMenu(false);
    }
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, []);

  async function handleSignOut() {
    const ok = await confirm({ title: 'Sign out', message: 'You will need to sign in again to access Global SJX OS.', confirmLabel: 'Sign out', danger: true });
    if (ok) logout();
  }

  async function loadNotifications() {
    try {
      const res = await api.get('/notifications');
      setNotifications(res.data.data);
      setUnreadCount(res.data.unreadCount || 0);
    } catch {
      /* silent — notifications are non-critical */
    }
  }

  async function markAllRead() {
    await api.post('/notifications/read-all');
    loadNotifications();
  }

  function initials(name?: string) {
    if (!name) return '?';
    return name.split(' ').map((p) => p[0]).slice(0, 2).join('').toUpperCase();
  }

  return (
    <header className="topbar">
      <div style={{ display: 'flex', alignItems: 'center', gap: 14, flex: 1 }}>
        {onToggleSidebar && (
          <button className="icon-btn desktop-toggle" onClick={onToggleSidebar} aria-label={sidebarCollapsed ? 'Open the menu' : 'Close the menu'} aria-pressed={!sidebarCollapsed} title={`${sidebarCollapsed ? 'Open' : 'Close'} the menu (Ctrl+B)`}>
            {sidebarCollapsed ? <PanelLeftOpen /> : <PanelLeftClose />}
          </button>
        )}
        <button className="icon-btn mobile-toggle" onClick={onMenuClick} aria-label="Open menu">
          <Menu />
        </button>
        <div className="topbar-search" ref={searchRef}>
          <Search />
          <input
            placeholder="Search tasks, projects, clients, people…"
            value={query}
            onChange={(e) => { setQuery(e.target.value); setShowResults(true); }}
            onFocus={() => setShowResults(true)}
          />
          {showResults && results.length > 0 && (
            <div style={{ position: 'absolute', top: '110%', left: 0, right: 0, background: 'var(--surface)', border: '1px solid var(--line-strong)', borderRadius: 12, boxShadow: 'var(--shadow)', maxHeight: 340, overflowY: 'auto', zIndex: 50 }}>
              {results.map((r) => (
                <div
                  key={`${r.type}-${r.id}`}
                  onClick={() => { navigate(r.link); setShowResults(false); setQuery(''); }}
                  style={{ padding: '10px 14px', cursor: 'pointer', display: 'flex', justifyContent: 'space-between', gap: 10, fontSize: 13 }}
                  onMouseDown={(e) => e.preventDefault()}
                >
                  <span>{r.label}</span>
                  <span style={{ color: 'var(--muted-2)', fontSize: 11 }}>{r.type}{r.meta ? ` · ${r.meta}` : ''}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      <div className="topbar-actions">
        <button className="icon-btn quick-create-hide-mobile" onClick={() => setQuickCreateOpen(true)} aria-label="Quick create" title="Quick create">
          <Plus />
        </button>

        <button
          className="icon-btn quick-create-hide-mobile"
          onClick={() => window.dispatchEvent(new Event('open-command-palette'))}
          aria-label="Open command palette"
          title="Command palette (Ctrl/Cmd+K)"
        >
          <Command />
        </button>

        <button className="icon-btn quick-create-hide-mobile" onClick={() => setHelpOpen(true)} aria-label="Help">
          <HelpCircle />
        </button>

        <button className="icon-btn" onClick={toggleTheme} aria-label="Toggle theme">
          {theme === 'dark' ? <Sun /> : <Moon />}
        </button>

        <div style={{ position: 'relative' }} ref={orgRef} className="quick-create-hide-mobile">
          <button
            onClick={() => setShowOrgMenu((s) => !s)}
            style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '7px 12px', borderRadius: 100, border: '1px solid var(--line-strong)', background: 'var(--surface)', color: 'var(--text)', fontSize: 12.5, fontWeight: 600 }}
          >
            <Building2 size={14} /> Global SJX Limited <ChevronDown size={13} color="var(--muted-2)" />
          </button>
          {showOrgMenu && (
            <div style={{ position: 'absolute', top: '120%', right: 0, width: 260, background: 'var(--surface)', border: '1px solid var(--line-strong)', borderRadius: 12, boxShadow: 'var(--shadow)', zIndex: 50, padding: 14 }}>
              <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 6 }}>Global SJX Limited</div>
              <p style={{ fontSize: 12, color: 'var(--muted)', lineHeight: 1.5 }}>
                This deployment currently serves a single organization. Multi-organization switching activates automatically once
                Global SJX OS is used to host more than one tenant.
              </p>
            </div>
          )}
        </div>

        <div style={{ position: 'relative' }} ref={notifRef}>
          <button className="icon-btn" onClick={() => setShowNotifications((s) => !s)} aria-label="Notifications">
            <Bell />
            {unreadCount > 0 && <span className="dot" />}
          </button>
          {showNotifications && (
            <div style={{ position: 'absolute', top: '120%', right: 0, width: 320, background: 'var(--surface)', border: '1px solid var(--line-strong)', borderRadius: 14, boxShadow: 'var(--shadow)', zIndex: 50, overflow: 'hidden' }}>
              <div className="flex-between" style={{ padding: '12px 16px', borderBottom: '1px solid var(--line)' }}>
                <strong style={{ fontSize: 13.5 }}>Notifications</strong>
                <button className="btn btn-ghost btn-sm" onClick={markAllRead}>Mark all read</button>
              </div>
              <div style={{ maxHeight: 320, overflowY: 'auto' }}>
                {notifications.length === 0 && <div style={{ padding: 20, textAlign: 'center', color: 'var(--muted)', fontSize: 13 }}>You're all caught up.</div>}
                {notifications.map((n) => (
                  <div key={n._id} style={{ padding: '12px 16px', borderBottom: '1px solid var(--line)', opacity: n.isRead ? 0.6 : 1, cursor: n.link ? 'pointer' : 'default' }} onClick={() => n.link && navigate(n.link)}>
                    <div style={{ fontSize: 13, fontWeight: 600 }}>{n.title}</div>
                    {n.body && <div style={{ fontSize: 12, color: 'var(--muted)', marginTop: 3 }}>{n.body}</div>}
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>

        <div style={{ position: 'relative' }}>
          <button className="user-chip" onClick={() => setShowUserMenu((s) => !s)}>
            <span className="user-avatar">{initials(user?.name)}</span>
            <span style={{ textAlign: 'left' }}>
              <span className="u-name" style={{ display: 'block' }}>{user?.name}</span>
              <span className="u-role" style={{ display: 'block' }}>{user?.role?.replace('_', ' ')}</span>
            </span>
          </button>
          {showUserMenu && (
            <div style={{ position: 'absolute', top: '120%', right: 0, width: 180, background: 'var(--surface)', border: '1px solid var(--line-strong)', borderRadius: 12, boxShadow: 'var(--shadow)', zIndex: 50, overflow: 'hidden' }}>
              <button
                onClick={handleSignOut}
                style={{ width: '100%', display: 'flex', alignItems: 'center', gap: 8, padding: '12px 14px', fontSize: 13, background: 'none', border: 'none', color: 'var(--text)' }}
              >
                <LogOut size={15} /> Sign out
              </button>
            </div>
          )}
        </div>
      </div>

      <QuickCreateMenu open={quickCreateOpen} onClose={() => setQuickCreateOpen(false)} />
      <HelpMenu open={helpOpen} onClose={() => setHelpOpen(false)} />
    </header>
  );
}
