import { useEffect, useMemo, useRef, useState } from 'react';
import { useParams } from 'react-router-dom';
import { CheckCircle2, ClipboardList } from 'lucide-react';
import { api, apiErrorMessage } from '@/lib/api';

const OPTS: Array<[string, string]> = [['yes', 'Yes'], ['partial', 'Partly'], ['no', 'No'], ['na', 'Not applicable']];
/** Question inc2 asks about a past breach, so "No" is the good answer there. */
const needsNote = (qid: string, a?: string) => (qid === 'inc2' ? a === 'yes' || a === 'partial' : a === 'no' || a === 'partial');

/** Supplier's private questionnaire (no sign-in; the link is the key). Progress is saved so they can return. */
export function SupplierForm() {
  const { token } = useParams(); const [d, setD] = useState<any>(null); const [err, setErr] = useState('');
  const [ans, setAns] = useState<Record<string, { answer?: string; note?: string }>>({}); const [who, setWho] = useState({ name: '', role: '' });
  const [busy, setBusy] = useState(false); const [saved, setSaved] = useState(''); const [done, setDone] = useState<any>(null); const dirty = useRef(false);

  useEffect(() => { api.get(`/public/supplier/${token}`).then((r) => { const x = r.data.data; setD(x); const m: any = {}; (x.answers || []).forEach((a: any) => { m[a.qid] = { answer: a.answer, note: a.note }; }); setAns(m); if (x.completedBy) setWho({ name: x.completedBy.name || '', role: x.completedBy.role || '' }); }).catch((e) => setErr(apiErrorMessage(e))); }, [token]);
  const payload = () => ({ answers: Object.entries(ans).filter(([, v]) => v.answer).map(([qid, v]) => ({ qid, answer: v.answer, note: v.note || undefined })), completedBy: who });
  async function save(quiet = false) { try { await api.put(`/public/supplier/${token}`, payload()); dirty.current = false; if (!quiet) setSaved('Saved ' + new Date().toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })); } catch (e) { if (!quiet) setErr(apiErrorMessage(e)); } }
  useEffect(() => { if (!d || d.locked) return; const t = setInterval(() => { if (dirty.current) save(true); }, 20000); return () => clearInterval(t); });
  const set = (qid: string, patch: any) => { dirty.current = true; setSaved(''); setAns((a) => ({ ...a, [qid]: { ...a[qid], ...patch } })); };

  const groups = useMemo(() => { const g: Record<string, any[]> = {}; (d?.questions || []).forEach((q: any) => (g[q.domain] ||= []).push(q)); return Object.entries(g); }, [d]);
  const answered = (d?.questions || []).filter((q: any) => ans[q.id]?.answer).length; const total = d?.questions?.length || 0;
  const missingNotes = (d?.questions || []).filter((q: any) => needsNote(q.id, ans[q.id]?.answer) && !ans[q.id]?.note?.trim()).length;
  async function submit() {
    setBusy(true); setErr(''); try { await api.post(`/public/supplier/${token}/submit`, payload()); setDone(true); } catch (e) { setErr(apiErrorMessage(e)); window.scrollTo({ top: 0, behavior: 'smooth' }); } finally { setBusy(false); }
  }
  const wrap = (c: React.ReactNode) => <div style={{ minHeight: '100vh', display: 'grid', placeItems: 'start center', padding: 20, background: 'var(--bg)', color: 'var(--text)' }}><div style={{ maxWidth: 760, width: '100%', display: 'grid', gap: 14 }}>{c}</div></div>;
  if (err && !d) return wrap(<div className="card" role="alert">{err}</div>);
  if (!d) return wrap(<div className="card text-muted">Loading…</div>);
  if (done || d.locked) return wrap(<div className="card" role="status" style={{ display: 'grid', gap: 8 }}><div style={{ display: 'flex', gap: 10, alignItems: 'center' }}><CheckCircle2 size={28} color="var(--success)" /><h1 style={{ fontSize: 22, margin: 0 }}>Thank you</h1></div>
    <p>Your answers for <b>{d.supplier}</b> have been sent to {d.company}. Their security team will review them and contact you if they need anything more.</p><div className="text-muted" style={{ fontSize: 13 }}>Reference {d.reference}</div></div>);
  return wrap(<>
    <div className="card">
      <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}><ClipboardList size={26} color="var(--accent)" /><h1 style={{ fontSize: 22, margin: 0 }}>Supplier security questionnaire</h1></div>
      <p className="text-muted" style={{ fontSize: 14 }}>{d.company} asks its suppliers to answer these questions about <b>{d.supplier}</b>. Answer for your organisation as a whole. Where an answer is not a clear yes, tell us briefly why. You can save and return using the same link until {new Date(d.expiresAt).toLocaleDateString('en-GB')}.</p>
      {d.message && <p style={{ fontStyle: 'italic' }}>{d.message}</p>}
      <div style={{ background: 'var(--border)', borderRadius: 6, height: 8 }}><div style={{ width: `${(answered / total) * 100}%`, background: 'var(--accent)', height: 8, borderRadius: 6 }} /></div>
      <div className="text-muted" style={{ fontSize: 12.5, marginTop: 4 }}>{answered} of {total} answered</div>
    </div>
    {err && <div className="card" role="alert" style={{ color: 'var(--danger)' }}>{err}</div>}
    {groups.map(([domain, qs]) => <div className="card" key={domain} style={{ display: 'grid', gap: 14 }}><b>{domain}</b>
      {qs.map((q: any) => { const a = ans[q.id] || {}; const nn = needsNote(q.id, a.answer); return (
        <fieldset key={q.id} style={{ border: 'none', padding: 0, margin: 0, display: 'grid', gap: 6 }}>
          <legend style={{ fontSize: 14.5, padding: 0, marginBottom: 6 }}>{q.text}</legend>
          {q.help && <div className="text-muted" style={{ fontSize: 12.5 }}>{q.help}</div>}
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>{OPTS.map(([k, l]) => <label key={k} className={`btn ${a.answer === k ? 'btn-primary' : 'btn-ghost'}`} style={{ cursor: 'pointer' }}><input type="radio" name={q.id} value={k} checked={a.answer === k} onChange={() => set(q.id, { answer: k })} style={{ position: 'absolute', opacity: 0, width: 0 }} />{l}</label>)}</div>
          {(nn || a.note || q.help) && a.answer && <input className="input" placeholder={nn ? 'Please explain (required)' : 'Note (optional)'} aria-label={`Note for ${q.id}`} maxLength={1000} value={a.note || ''} onChange={(e) => set(q.id, { note: e.target.value })} style={nn && !a.note?.trim() ? { borderColor: 'var(--danger)' } : undefined} />}
        </fieldset>); })}</div>)}
    <div className="card" style={{ display: 'grid', gap: 10 }}><b>Who completed this?</b>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(220px,1fr))', gap: 10 }}>
        <div className="field"><label>Your name *</label><input className="input" value={who.name} onChange={(e) => { dirty.current = true; setWho({ ...who, name: e.target.value }); }} /></div>
        <div className="field"><label>Your role</label><input className="input" value={who.role} onChange={(e) => { dirty.current = true; setWho({ ...who, role: e.target.value }); }} /></div></div>
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
        <button type="button" className="btn btn-ghost" onClick={() => save()}>Save and finish later</button>
        <button type="button" className="btn btn-primary" disabled={busy || answered < total || missingNotes > 0 || who.name.trim().length < 2} onClick={submit}>{busy ? 'Sending…' : 'Submit answers'}</button>
        <span className="text-muted" style={{ fontSize: 12.5 }}>{saved || (answered < total ? `${total - answered} question(s) left` : missingNotes ? `${missingNotes} explanation(s) needed` : who.name.trim().length < 2 ? 'Add your name' : 'Ready to submit. You cannot change answers afterwards.')}</span></div></div>
  </>);
}
