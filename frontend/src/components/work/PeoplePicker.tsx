import { useEffect, useMemo, useRef, useState } from 'react';
import { X } from 'lucide-react';
import { api } from '@/lib/api';
import './work.css';

export interface Person { _id: string; name: string; jobTitle?: string; department?: string }

let cache: { at: number; promise: Promise<Person[]> } | null = null;
/** Active staff of the organisation (names only), cached for a minute. */
export function loadPeople(force = false): Promise<Person[]> {
  if (!force && cache && Date.now() - cache.at < 60000) return cache.promise;
  const promise = api.get('/employees/directory/list').then((r) => r.data.data as Person[]).catch(() => { cache = null; return [] as Person[]; });
  cache = { at: Date.now(), promise };
  return promise;
}

export function usePeople(): Person[] {
  const [people, setPeople] = useState<Person[]>([]);
  useEffect(() => { let on = true; loadPeople().then((p) => on && setPeople(p)); return () => { on = false; }; }, []);
  return people;
}

interface Props {
  value: string[];
  onChange: (ids: string[]) => void;
  /** Limit the choices (e.g. to a project's team). */
  options?: Person[];
  exclude?: string[];
  single?: boolean;
  placeholder?: string;
}

/** Search-and-pick people from the organisation. `single` makes it a one-person selector. */
export function PeoplePicker({ value, onChange, options, exclude = [], single, placeholder = 'Search people…' }: Props) {
  const all = usePeople();
  const pool = options ?? all;
  const [q, setQ] = useState('');
  const [open, setOpen] = useState(false);
  const box = useRef<HTMLDivElement>(null);
  // Close when clicking anywhere else, or pressing Escape.
  useEffect(() => {
    if (!open) return;
    const away = (e: MouseEvent) => { if (box.current && !box.current.contains(e.target as Node)) setOpen(false); };
    const esc = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('mousedown', away); document.addEventListener('keydown', esc);
    return () => { document.removeEventListener('mousedown', away); document.removeEventListener('keydown', esc); };
  }, [open]);
  const byId = useMemo(() => new Map([...all, ...(options || [])].map((p) => [p._id, p])), [all, options]);
  const hits = useMemo(() => {
    const s = q.trim().toLowerCase();
    return pool.filter((p) => !value.includes(p._id) && !exclude.includes(p._id) && (!s || p.name.toLowerCase().includes(s) || (p.department || '').toLowerCase().includes(s) || (p.jobTitle || '').toLowerCase().includes(s))).slice(0, 100);
  }, [pool, q, value, exclude]);

  const pick = (id: string) => { onChange(single ? [id] : [...value, id]); setQ(''); setOpen(single ? false : true); };
  return (
    <div className="people-box" ref={box}>
      {value.length > 0 && (
        <div className="people-chips">
          {value.map((id) => (
            <span key={id} className="chip active">
              {byId.get(id)?.name || 'Unknown'}
              <button type="button" aria-label="Remove" onClick={() => onChange(value.filter((v) => v !== id))} style={{ background: 'none', border: 0, color: 'inherit', padding: 0, display: 'inline-flex', cursor: 'pointer' }}><X size={13} /></button>
            </span>
          ))}
        </div>
      )}
      {!(single && value.length) && (
        <>
          <input className="input" value={q} onChange={(e) => { setQ(e.target.value); setOpen(true); }} onFocus={() => setOpen(true)} onClick={() => setOpen(true)} placeholder={placeholder} autoComplete="off" />
          {open && (
            <div className="people-list">
              {hits.length === 0 ? <div className="text-muted" style={{ fontSize: 12.5, padding: 6 }}>No one matches.</div> : hits.map((p) => (
                <button type="button" key={p._id} onClick={() => pick(p._id)}><span>{p.name}</span><small>{p.jobTitle || p.department || ''}</small></button>
              ))}
            </div>
          )}
        </>
      )}
    </div>
  );
}
