import { useState } from 'react';
import { KeyRound, LogOut, Cookie } from 'lucide-react';
import { api, apiErrorMessage } from '@/lib/api';
import { useToast } from '@/context/ToastContext';
import { useConsent } from '@/context/ConsentContext';
import { useConfirm } from '@/context/ConfirmContext';

const rules = (pw: string) => [
  ['12+ characters', pw.length >= 12], ['lowercase letter', /[a-z]/.test(pw)], ['uppercase letter', /[A-Z]/.test(pw)], ['number', /\d/.test(pw)], ['symbol', /[^A-Za-z0-9]/.test(pw)],
] as Array<[string, boolean]>;

export function AccountSecurityCard() {
  const { showError, showSuccess } = useToast();
  const confirm = useConfirm();
  const [cur, setCur] = useState('');
  const [next, setNext] = useState('');
  const [busy, setBusy] = useState(false);
  const ok = rules(next).every(([, v]) => v);

  async function change() {
    setBusy(true);
    try {
      const res = await api.post('/auth/change-password', { currentPassword: cur, newPassword: next });
      localStorage.setItem('gsjx_token', res.data.data.token);
      setCur(''); setNext('');
      showSuccess('Password changed. Other devices have been signed out.');
    } catch (err) { showError(apiErrorMessage(err)); } finally { setBusy(false); }
  }

  async function revoke() {
    if (!(await confirm({ title: 'Sign out everywhere', message: 'This signs out every other device and browser using your account. You will stay signed in here.', confirmLabel: 'Sign out others' }))) return;
    try {
      const res = await api.post('/auth/revoke-sessions');
      localStorage.setItem('gsjx_token', res.data.data.token);
      showSuccess('All other sessions were signed out.');
    } catch (err) { showError(apiErrorMessage(err)); }
  }

  return (
    <div className="card">
      <h3 style={{ fontSize: 16, marginBottom: 14, display: 'flex', gap: 8, alignItems: 'center' }}><KeyRound size={16} /> Password & sessions</h3>
      <div style={{ display: 'grid', gap: 12, maxWidth: 420 }}>
        <div className="field"><label>Current password</label><input className="input" type="password" autoComplete="current-password" value={cur} onChange={(e) => setCur(e.target.value)} /></div>
        <div className="field"><label>New password</label><input className="input" type="password" autoComplete="new-password" value={next} onChange={(e) => setNext(e.target.value)} /></div>
        {next && <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>{rules(next).map(([l, v]) => <span key={l} className={`badge ${v ? 'badge-success' : 'badge-neutral'}`}>{v ? '✓' : '○'} {l}</span>)}</div>}
        <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
          <button className="btn btn-primary" onClick={change} disabled={busy || !cur || !ok}>{busy ? 'Saving…' : 'Change password'}</button>
          <button className="btn btn-ghost" onClick={revoke}><LogOut size={14} /> Sign out other devices</button>
        </div>
      </div>
    </div>
  );
}

export function PrivacyCard() {
  const { consent, openSettings } = useConsent();
  return (
    <div className="card">
      <h3 style={{ fontSize: 16, marginBottom: 10, display: 'flex', gap: 8, alignItems: 'center' }}><Cookie size={16} /> Privacy & cookies</h3>
      <p style={{ fontSize: 13, color: 'var(--muted)', marginBottom: 12 }}>
        Your choice: preferences <strong>{consent?.preferences ? 'on' : 'off'}</strong>, analytics <strong>{consent?.analytics ? 'on' : 'off'}</strong>, marketing <strong>{consent?.marketing ? 'on' : 'off'}</strong>.
        {consent && <> Recorded {new Date(consent.decidedAt).toLocaleDateString()}.</>}
      </p>
      <button className="btn btn-ghost" onClick={openSettings}>Change cookie settings</button>
    </div>
  );
}
