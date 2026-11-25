import { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import { CheckCircle2, FileSignature } from 'lucide-react';
import { api, apiErrorMessage } from '@/lib/api';

/** Signer's private page: read the exact text, type your name, confirm consent. */
export function SignDocument() {
  const { token } = useParams(); const [d, setD] = useState<any>(null); const [err, setErr] = useState(''); const [name, setName] = useState(''); const [agree, setAgree] = useState(false);
  const [busy, setBusy] = useState(false); const [done, setDone] = useState<any>(null); const [dec, setDec] = useState(false); const [reason, setReason] = useState('');
  useEffect(() => { api.get(`/public/sign/${token}`).then((r) => setD(r.data.data)).catch((e) => setErr(apiErrorMessage(e))); }, [token]);
  const wrap = (c: React.ReactNode) => <div style={{ minHeight: '100vh', display: 'grid', placeItems: 'start center', padding: 20, background: 'var(--bg)', color: 'var(--text)' }}><div style={{ maxWidth: 760, width: '100%', display: 'grid', gap: 14 }}>{c}</div></div>;
  async function sign() { setBusy(true); setErr(''); try { setDone((await api.post(`/public/sign/${token}/sign`, { typedName: name, agree })).data.data); } catch (e) { setErr(apiErrorMessage(e)); } finally { setBusy(false); } }
  async function decline() { setBusy(true); setErr(''); try { await api.post(`/public/sign/${token}/decline`, { reason }); setDone({ declined: true }); } catch (e) { setErr(apiErrorMessage(e)); } finally { setBusy(false); } }
  if (err && !d) return wrap(<div className="card" role="alert">{err}</div>);
  if (!d) return wrap(<div className="card text-muted">Loading…</div>);
  if (done?.declined) return wrap(<div className="card" role="status"><h1 style={{ fontSize: 22, margin: 0 }}>Response sent</h1><p>You declined to sign <b>{d.title}</b>. {d.company} has been told.</p></div>);
  if (done || d.status === 'signed') return wrap(<div className="card" role="status" style={{ display: 'grid', gap: 8 }}><div style={{ display: 'flex', gap: 10, alignItems: 'center' }}><CheckCircle2 size={28} color="var(--success)" /><h1 style={{ fontSize: 22, margin: 0 }}>You have signed</h1></div>
    <p><b>{d.title}</b> ({d.reference}). {done?.completed || d.requestStatus === 'completed' ? 'Everyone has now signed.' : 'We will tell you if anything else is needed.'} Keep this reference for your records.</p></div>);
  if (d.status === 'declined') return wrap(<div className="card">You declined this document.</div>);
  return wrap(<>
    <div className="card"><div style={{ display: 'flex', gap: 10, alignItems: 'center' }}><FileSignature size={26} color="var(--accent)" /><h1 style={{ fontSize: 22, margin: 0 }}>{d.title}</h1></div>
      <p className="text-muted" style={{ fontSize: 14, marginBottom: 0 }}>{d.company} · {d.reference} · for {d.signerName} · please sign by {new Date(d.expiresAt).toLocaleDateString('en-GB')}. Signing as: {d.others.map((o: any) => `${o.name}${o.status === 'signed' ? ' ✓' : ''}`).join(', ')}.</p></div>
    <div className="card"><pre style={{ whiteSpace: 'pre-wrap', fontFamily: 'inherit', margin: 0, maxHeight: '55vh', overflow: 'auto' }} tabIndex={0} aria-label="Document text">{d.body}</pre>
      <div className="text-muted" style={{ fontSize: 11.5, marginTop: 8, wordBreak: 'break-all' }}>Document fingerprint (SHA-256): {d.fingerprint}</div></div>
    {err && <div className="card" role="alert" style={{ color: 'var(--danger)' }}>{err}</div>}
    <div className="card" style={{ display: 'grid', gap: 10 }}>
      <label style={{ display: 'flex', gap: 8, alignItems: 'start' }}><input type="checkbox" checked={agree} onChange={(e) => setAgree(e.target.checked)} /><span>I have read this document and agree to sign it electronically. I understand typing my name here has the same intent as signing by hand.</span></label>
      <div className="field"><label>Type your full name to sign: <b>{d.signerName}</b></label><input className="input" value={name} onChange={(e) => setName(e.target.value)} autoComplete="off" /></div>
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}><button className="btn btn-primary" disabled={busy || !agree || name.trim().length < 2} onClick={sign}>{busy ? 'Signing…' : 'Sign document'}</button><button className="btn btn-ghost" onClick={() => setDec(!dec)}>I do not agree</button></div>
      {dec && <div style={{ display: 'grid', gap: 8 }}><input className="input" placeholder="Why? (required)" value={reason} onChange={(e) => setReason(e.target.value)} /><button className="btn btn-ghost" disabled={busy || reason.trim().length < 3} onClick={decline}>Send decline</button></div>}
      <div className="text-muted" style={{ fontSize: 12 }}>We record your name, time and a fingerprint of your network address as evidence of signing.</div></div>
  </>);
}
