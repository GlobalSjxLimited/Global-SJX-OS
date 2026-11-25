import { useEffect, useState } from 'react';
import { Outlet, useLocation } from 'react-router-dom';
import { AnimatePresence, motion } from 'framer-motion';
import { Sidebar } from './Sidebar';
import { Topbar } from './Topbar';
import { Breadcrumbs } from './Breadcrumbs';
import { MobileTabBar } from './MobileTabBar';
import { CommandPalette } from './CommandPalette';
import { LeaverBanner } from './LeaverBanner';
import { AwarenessPopup } from '@/components/awareness/AwarenessPopup';

export function AppShell() {
  const [sidebarOpen, setSidebarOpen] = useState(false);
  // Desktop: the menu can be hidden to give the page the full width. Remembered per browser.
  const [collapsed, setCollapsed] = useState<boolean>(() => { try { return localStorage.getItem('gsjx.sidebar.collapsed') === '1'; } catch { return false; } });
  const toggleCollapsed = () => setCollapsed((c) => { const n = !c; try { localStorage.setItem('gsjx.sidebar.collapsed', n ? '1' : '0'); } catch { /* storage unavailable */ } return n; });
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'b') { e.preventDefault(); toggleCollapsed(); } };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);
  const location = useLocation();

  return (
    <div className={`app-shell${collapsed ? ' sidebar-collapsed' : ''}`}>
      <Sidebar open={sidebarOpen} onClose={() => setSidebarOpen(false)} />
      {sidebarOpen && <div className="overlay" style={{ zIndex: 39, background: 'rgba(0,0,0,0.4)' }} onClick={() => setSidebarOpen(false)} />}
      <div className="app-main">
        <Topbar onMenuClick={() => setSidebarOpen(true)} sidebarCollapsed={collapsed} onToggleSidebar={toggleCollapsed} />
        <LeaverBanner />
        <AnimatePresence mode="wait">
          <motion.main
            key={location.pathname}
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -6 }}
            transition={{ duration: 0.25, ease: [0.16, 0.8, 0.24, 1] }}
            className="page"
          >
            <Breadcrumbs />
            <Outlet />
          </motion.main>
        </AnimatePresence>
      </div>
      <MobileTabBar />
      <CommandPalette />
      <AwarenessPopup />
    </div>
  );
}
