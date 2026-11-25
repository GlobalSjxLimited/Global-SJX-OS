import { useState } from 'react';
import { ShieldCheck } from 'lucide-react';
import { api, apiErrorMessage } from '@/lib/api';

const TYPES: Array<[string, string, string]> = [
  ['access', 'See my data', 'A copy of the personal data we hold about you.'], ['rectification', 'Correct my data', 'Fix something that is wrong or incomplete.'],
  ['erasure', 'Delete my data', 'Ask us to erase your data where the law allows.'], ['restriction', 'Pause using my data', 'Ask us to stop using it while a dispute is settled.'],
  ['portability', 'Give me my data to move', 'Receive it in a common machine-readable format.'], ['objection', 'I object to how it is used', 'Object to a particular use, such as marketing.'],
  ['withdraw_consent', 'Withdraw my consent', 'Stop something you earlier agreed to.'],
];

/** Public page (no sign-in): anyone can make a data-subject request. Staff verify identity before anything is disclosed. */
export function DataRequest() {
  const [f, setF] = useState<any>({ type: 'access', name: '', email: '', phone: '', relationship: 'other', details: '', website: '' });
  const [busy, setBusy] = useState(false); const [err, setErr] = useState(''); const [done, setDone] = useState<any>(null);
  const [chk, setChk] = useState<any>({ reference: '', email: '' }); const [status, setStatus] = useState<any>(null); const [chkErr, setChkErr] = useState('');
  const set = (k: string, v: any) => setF((x: any) => ({ ...x, [k]: v }));
  async function submit(e: React.FormEvent) {
    e.preventDefault(); setBusy(true); setErr('');
    try { setDone((await api.post('/public/dsar', f)).data.data); } catch (x) { setErr(apiErrorMessage(x)); } finally { setBusy(false); }
  }
  async function check(e: React.FormEvent) {
    e.preventDefault(); setChkErr(''); setStatus(null);
    try { setStatus((await api.post('/public/dsar/status', chk)).data.data); } catch (x) { setChkErr(apiErrorMessage(x)); }
  }
  return (
    <div style={{ minHeight: '100vh', display: 'grid', placeItems: 'start center', padding: 20, background: 'var(--bg)', color: 'var(--text)' }}>
      <div style={{ maxWidth: 640, width: '100%', display: 'grid', gap: 16 }}>
        <div className="card">
          <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}><ShieldCheck size={26} color="var(--accent)" /><h1 style={{ fontSize: 22, margin: 0 }}>Make a data request</h1></div>
          <p className="text-muted" style={{ fontSize: 14 }}>Under Nigeria's data protection law you can ask Global SJX Limited what personal data we hold about you and what we do with it. We will confirm who you are first, then reply within 30 days.</p>
          {done ? (
            <div role="status" style={{ borderLeft: '3px solid var(--success, #3fb950)', paddingLeft: 12 }}>
              <b>Request received.</b> Your reference is <b data-testid="dsar-ref">{done.reference}</b>. We sent a confirmation to your e-mail and will reply by {new Date(done.respondBy).toLocaleDateString('en-GB')}.
            </div>
          ) : (
            <form onSubmit={submit} style={{ display: 'grid', gap: 10 }}>
              <div className="field"><label>What would you like to do?</label>
                <select className="input" value={f.type} onChange={(e) => set('type', e.target.value)}>{TYPES.map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select>
                <div className="text-muted" style={{ fontSize: 12.5 }}>{TYPES.find((t) => t[0] === f.type)?.[2]}</div></div>
              <div className="field"><label>Your full name *</label><input className="input" required value={f.name} onChange={(e) => set('name', e.target.value)} /></div>
              <div className="field"><label>E-mail we can reach you on *</label><input className="input" type="email" required value={f.email} onChange={(e) => set('email', e.target.value)} /></div>
              <div className="field"><label>Phone (optional)</label><input className="input" value={f.phone} onChange={(e) => set('phone', e.target.value)} /></div>
              <div className="field"><label>Your relationship with us</label>
                <select className="input" value={f.relationship} onChange={(e) => set('relationship', e.target.value)}>{[['employee', 'Employee or former employee'], ['client', 'Client'], ['vendor', 'Supplier'], ['academy_learner', 'Academy learner'], ['website_visitor', 'Website visitor'], ['other', 'Other']].map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select></div>
              <div className="field"><label>Anything that helps us find your data</label><textarea className="input" rows={3} maxLength={3000} value={f.details} onChange={(e) => set('details', e.target.value)} /></div>
              <input tabIndex={-1} autoComplete="off" aria-hidden style={{ position: 'absolute', left: -9999, height: 0, width: 0, opacity: 0 }} value={f.website} onChange={(e) => set('website', e.target.value)} />
              {err && <div role="alert" style={{ color: 'var(--danger)', fontSize: 13.5 }}>{err}</div>}
              <button className="btn btn-primary" disabled={busy}>{busy ? 'Sending…' : 'Send request'}</button>
              <div className="text-muted" style={{ fontSize: 12 }}>We use what you enter only to handle this request.</div>
            </form>
          )}
        </div>
        <form className="card" onSubmit={check} style={{ display: 'grid', gap: 8 }}>
          <b>Already made a request?</b>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            <input className="input" style={{ flex: 1, minWidth: 160 }} placeholder="Reference e.g. DSR-2026-0001" value={chk.reference} onChange={(e) => setChk({ ...chk, reference: e.target.value })} />
            <input className="input" style={{ flex: 1, minWidth: 180 }} type="email" placeholder="E-mail you used" value={chk.email} onChange={(e) => setChk({ ...chk, email: e.target.value })} />
            <button className="btn btn-ghost">Check status</button>
          </div>
          {chkErr && <div style={{ color: 'var(--danger)', fontSize: 13.5 }}>{chkErr}</div>}
          {status && <div style={{ fontSize: 14 }}>Status: <b>{String(status.status).replace('_', ' ')}</b> · we will reply by {new Date(status.respondBy).toLocaleDateString('en-GB')}.</div>}
        </form>
      </div>
    </div>
  );
}
