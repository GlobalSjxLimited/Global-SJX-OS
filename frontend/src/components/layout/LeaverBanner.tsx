import { useEffect, useState } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { PackageCheck } from 'lucide-react';
import { api } from '@/lib/api';
import { fdate } from '@/lib/format';

/** Shown to anyone who has an open offboarding case: what they must return, and by when (POL-5013). */
export function LeaverBanner() {
  const [c, setC] = useState<any>(null);
  const { pathname } = useLocation();
  useEffect(() => { let on = true; api.get('/offboarding/mine').then((r) => on && setC(r.data.data)).catch(() => undefined); return () => { on = false; }; }, [pathname === '/my-offboarding']);
  if (!c || c.status !== 'open' || pathname === '/my-offboarding') return null;
  const left = Math.ceil((new Date(c.lastWorkingDay).getTime() - Date.now()) / 86400000);
  const todo = (c.progress?.total || 0) - (c.progress?.done || 0) - (c.progress?.awaitingApproval || 0);
  return (
    <Link to="/my-offboarding" style={{ display: 'flex', gap: 10, alignItems: 'center', padding: '9px 16px', background: left <= 3 ? 'var(--danger, #d6455d)' : 'var(--gold, #F0A93B)', color: '#1b1b1b', fontSize: 13.5, fontWeight: 600, textDecoration: 'none' }}>
      <PackageCheck size={16} /> Your last working day is {fdate(c.lastWorkingDay)} ({left < 0 ? 'passed' : `${left} day${left === 1 ? '' : 's'}`}). {todo > 0 ? `${todo} item${todo === 1 ? '' : 's'} still to return or hand over.` : 'Please sign your inventory.'} <span style={{ marginLeft: 'auto', textDecoration: 'underline' }}>Open return form</span>
    </Link>
  );
}
