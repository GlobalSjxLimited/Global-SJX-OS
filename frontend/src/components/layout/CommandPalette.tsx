import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { AnimatePresence, motion } from 'framer-motion';
import { Search, ArrowRight, Sparkles } from 'lucide-react';
import { api } from '@/lib/api';
import { useAuth } from '@/context/AuthContext';
import { canSeeNavForUser, isExternalRole, EXTERNAL_NAV_PATHS } from '@/lib/permissions';
import { NAV_DESTINATIONS } from '@/lib/navDestinations';

interface SearchResult { type: string; id: string; label: string; meta?: string; link: string; }

/**
 * Global Cmd/Ctrl+K palette. Two sections: destinations (every module the
 * signed-in role can see, same RBAC rules as the sidebar) and, once the user
 * types 2+ characters, live results from the same /search endpoint the
 * topbar search box uses.
 */
export function CommandPalette() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<SearchResult[]>([]);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    function handleKeydown(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        setOpen((o) => !o);
      }
      if (e.key === 'Escape') setOpen(false);
    }
    function handleExternalOpen() {
      setOpen(true);
    }
    window.addEventListener('keydown', handleKeydown);
    window.addEventListener('open-command-palette', handleExternalOpen);
    return () => {
      window.removeEventListener('keydown', handleKeydown);
      window.removeEventListener('open-command-palette', handleExternalOpen);
    };
  }, []);

  useEffect(() => {
    if (open) setTimeout(() => inputRef.current?.focus(), 50);
    else {
      setQuery('');
      setResults([]);
    }
  }, [open]);

  useEffect(() => {
    if (query.trim().length < 2) {
      setResults([]);
      return;
    }
    const t = setTimeout(() => {
      api.get('/search', { params: { q: query } }).then((res) => setResults(res.data.data));
    }, 250);
    return () => clearTimeout(t);
  }, [query]);

  const destinations = NAV_DESTINATIONS.filter((d) => {
    if (!user) return false;
    if (isExternalRole(user.role)) return EXTERNAL_NAV_PATHS.includes(d.to);
    return canSeeNavForUser(user, d.to);
  }).filter((d) => d.label.toLowerCase().includes(query.toLowerCase()));

  function go(to: string) {
    setOpen(false);
    navigate(to);
  }

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          className="overlay"
          style={{ alignItems: 'flex-start', paddingTop: '12vh' }}
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          onMouseDown={(e) => { if (e.target === e.currentTarget) setOpen(false); }}
        >
          <motion.div
            initial={{ opacity: 0, scale: 0.97, y: -8 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.98 }}
            transition={{ duration: 0.2, ease: [0.16, 0.8, 0.24, 1] }}
            className="modal"
            style={{ maxWidth: 560 }}
            role="dialog"
            aria-label="Command palette"
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '16px 20px', borderBottom: '1px solid var(--line)' }}>
              <Search size={17} color="var(--muted)" />
              <input
                ref={inputRef}
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Go to a module, search records, or ask SJX AI…"
                style={{ flex: 1, background: 'none', border: 'none', outline: 'none', color: 'var(--text)', fontSize: 14.5 }}
              />
              <kbd style={{ fontSize: 11, color: 'var(--muted-2)', border: '1px solid var(--line-strong)', borderRadius: 5, padding: '2px 6px' }}>Esc</kbd>
            </div>

            <div style={{ maxHeight: 420, overflowY: 'auto', padding: 8 }}>
              {query.trim().length >= 2 && (
                <button
                  onClick={() => { setOpen(false); navigate('/ai'); }}
                  style={{ width: '100%', display: 'flex', alignItems: 'center', gap: 10, padding: '11px 12px', borderRadius: 10, background: 'var(--accent-soft)', border: 'none', color: 'var(--accent)', fontSize: 13.5, fontWeight: 600, marginBottom: 6 }}
                >
                  <Sparkles size={15} /> Ask SJX AI: "{query}"
                </button>
              )}

              {results.length > 0 && (
                <div style={{ marginBottom: 6 }}>
                  <div style={{ fontSize: 11, color: 'var(--muted-2)', padding: '6px 12px', textTransform: 'uppercase', letterSpacing: '.04em' }}>Records</div>
                  {results.map((r) => (
                    <button
                      key={`${r.type}-${r.id}`}
                      onClick={() => go(r.link)}
                      style={{ width: '100%', display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 10, padding: '10px 12px', borderRadius: 10, background: 'none', border: 'none', color: 'var(--text)', fontSize: 13.5 }}
                      onMouseEnter={(e) => (e.currentTarget.style.background = 'var(--surface-2)')}
                      onMouseLeave={(e) => (e.currentTarget.style.background = 'none')}
                    >
                      <span>{r.label}</span>
                      <span style={{ fontSize: 11, color: 'var(--muted-2)' }}>{r.type}</span>
                    </button>
                  ))}
                </div>
              )}

              <div>
                <div style={{ fontSize: 11, color: 'var(--muted-2)', padding: '6px 12px', textTransform: 'uppercase', letterSpacing: '.04em' }}>Go to</div>
                {destinations.length === 0 && <div style={{ padding: '10px 12px', fontSize: 13, color: 'var(--muted)' }}>No matching module.</div>}
                {destinations.map((d) => (
                  <button
                    key={d.to}
                    onClick={() => go(d.to)}
                    style={{ width: '100%', display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 10, padding: '10px 12px', borderRadius: 10, background: 'none', border: 'none', color: 'var(--text)', fontSize: 13.5 }}
                    onMouseEnter={(e) => (e.currentTarget.style.background = 'var(--surface-2)')}
                    onMouseLeave={(e) => (e.currentTarget.style.background = 'none')}
                  >
                    <span style={{ display: 'flex', alignItems: 'center', gap: 10 }}>{d.icon}{d.label}</span>
                    <ArrowRight size={13} color="var(--muted-2)" />
                  </button>
                ))}
              </div>
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
