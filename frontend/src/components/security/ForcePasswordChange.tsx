import { useState } from 'react';
import { KeyRound } from 'lucide-react';
import { api, apiErrorMessage } from '@/lib/api';
import { useAuth } from '@/context/AuthContext';
import { BrandLogo } from '@/components/ui/BrandLogo';

const RULES: Array<[string, (p: string) => boolean]> = [
  ['At least 12 characters', (p) => p.length >= 12],
  ['An uppercase letter', (p) => /[A-Z]/.test(p)],
  ['A lowercase letter', (p) => /[a-z]/.test(p)],
  ['A number', (p) => /\d/.test(p)],
  ['A symbol', (p) => /[^A-Za-z0-9]/.test(p)],
];

/** Shown instead of the app when an administrator issued a temporary password or the password expired. */
export function ForcePasswordChange() {
  const { refreshUser, logout, user } = useAuth();
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [confirm, setConfirm] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const ok = RULES.every(([, f]) => f(next)) && next === confirm && current.length > 0 && next !== current;

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true); setError('');
    try {
      const res = await api.post('/auth/change-password', { currentPassword: current, newPassword: next });
      localStorage.setItem('gsjx_token', res.data.data.token); // the old session was ended; this is the fresh one
      await refreshUser();
    } catch (err) { setError(apiErrorMessage(err)); } finally { setBusy(false); }
  }

  return (
    <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'var(--ink)', padding: 20 }}>
      <form onSubmit={submit} className="card" style={{ maxWidth: 440, width: '100%', display: 'grid', gap: 14 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <BrandLogo size={40} />
          <div>
            <div style={{ fontFamily: 'Fraunces, serif', fontSize: 18, fontWeight: 600 }}>Choose a new password</div>
            <div style={{ fontSize: 12, color: 'var(--muted-2)' }}>Required before you can continue{user ? `, ${user.name.split(' ')[0]}` : ''}</div>
          </div>
        </div>
        <p style={{ fontSize: 13, color: 'var(--muted)' }}>Your password was issued by an administrator or has expired. For security you must set your own before using Global SJX OS.</p>
        <div className="field"><label>Current / temporary password</label><input className="input" type="password" autoComplete="current-password" value={current} onChange={(e) => setCurrent(e.target.value)} required /></div>
        <div className="field"><label>New password</label><input className="input" type="password" autoComplete="new-password" value={next} onChange={(e) => setNext(e.target.value)} required /></div>
        <div className="field"><label>Confirm new password</label><input className="input" type="password" autoComplete="new-password" value={confirm} onChange={(e) => setConfirm(e.target.value)} required /></div>
        <ul style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 4, fontSize: 12, listStyle: 'none', padding: 0, margin: 0 }}>
          {RULES.map(([label, f]) => <li key={label} className={f(next) ? 'check-ok' : 'text-muted'}>{f(next) ? '✓' : '○'} {label}</li>)}
          <li className={next && next === confirm ? 'check-ok' : 'text-muted'}>{next && next === confirm ? '✓' : '○'} Both match</li>
        </ul>
        <p style={{ fontSize: 11.5, color: 'var(--muted-2)', margin: 0 }}>You cannot reuse any of your last 5 passwords.</p>
        {error && <div style={{ color: 'var(--danger)', fontSize: 13 }}>{error}</div>}
        <button className="btn btn-primary" disabled={!ok || busy}><KeyRound size={15} /> {busy ? 'Saving…' : 'Set password & continue'}</button>
        <button type="button" className="btn btn-ghost btn-sm" onClick={logout}>Sign out</button>
      </form>
    </div>
  );
}
