import { useEffect, useMemo, useState } from 'react';
import { useParams } from 'react-router-dom';
import { CalendarCheck, CheckCircle2, ChevronLeft, ChevronRight } from 'lucide-react';
import { api, apiErrorMessage } from '@/lib/api';

const wrap = (children: React.ReactNode) => (
  <div style={{ minHeight: '100vh', display: 'grid', placeItems: 'start center', padding: 20, background: 'var(--bg)', color: 'var(--text)' }}>
    <div style={{ maxWidth: 680, width: '100%', display: 'grid', gap: 16 }}>{children}</div>
  </div>
);
const fmtDate = (d: string) => new Date(d + 'T12:00:00Z').toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' });
const lagosTime = (iso: string) => new Date(iso).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', timeZone: 'Africa/Lagos' });
const lagosDay = (iso: string) => new Date(iso).toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric', timeZone: 'Africa/Lagos' });

/** Public booking page. No sign-in. The visitor picks who they are seeing, a day that has free time, then a time. */
export function BookVisit() {
  const [company, setCompany] = useState(''); const [hosts, setHosts] = useState<any[] | null>(null);
  const [host, setHost] = useState<any>(null); const [cal, setCal] = useState<any[]>([]); const [month, setMonth] = useState(0);
  const [date, setDate] = useState(''); const [slots, setSlots] = useState<any[] | null>(null); const [slot, setSlot] = useState<any>(null);
  const [f, setF] = useState({ name: '', email: '', phone: '', company: '', purpose: '', website: '' });
  const [busy, setBusy] = useState(false); const [err, setErr] = useState(''); const [done, setDone] = useState<any>(null); const [q, setQ] = useState('');
  const set = (k: string, v: string) => setF((x) => ({ ...x, [k]: v }));

  useEffect(() => { api.get('/public/visit/hosts').then((r) => { setCompany(r.data.data.company); setHosts(r.data.data.hosts); }).catch((e) => { setErr(apiErrorMessage(e)); setHosts([]); }); }, []);
  useEffect(() => { if (!host) return; setCal([]); setDate(''); setSlot(null); api.get('/public/visit/calendar', { params: { hostId: host.id, days: 60 } }).then((r) => setCal(r.data.data)).catch((e) => setErr(apiErrorMessage(e))); }, [host]);
  useEffect(() => { if (!host || !date) return; setSlots(null); setSlot(null); api.get('/public/visit/slots', { params: { hostId: host.id, date } }).then((r) => setSlots(r.data.data)).catch((e) => setErr(apiErrorMessage(e))); }, [host, date]);

  const months = useMemo(() => Array.from(new Set(cal.map((c) => c.date.slice(0, 7)))), [cal]);
  const mKey = months[month]; const inMonth = cal.filter((c) => c.date.slice(0, 7) === mKey);
  const lead = inMonth.length ? (new Date(inMonth[0].date + 'T12:00:00Z').getUTCDay() + 6) % 7 : 0; // Monday first

  async function submit(e: React.FormEvent) {
    e.preventDefault(); if (!slot) return; setBusy(true); setErr('');
    try { setDone((await api.post('/public/visit/book', { hostId: host.id, start: slot.start, ...f })).data.data); }
    catch (x: any) { setErr(apiErrorMessage(x)); if (x?.response?.status === 409) { setSlot(null); api.get('/public/visit/slots', { params: { hostId: host.id, date } }).then((r) => setSlots(r.data.data)); api.get('/public/visit/calendar', { params: { hostId: host.id, days: 60 } }).then((r) => setCal(r.data.data)); } }
    finally { setBusy(false); }
  }

  if (done) return wrap(
    <div className="card" role="status" style={{ display: 'grid', gap: 10 }}>
      <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}><CheckCircle2 size={28} color="var(--success)" /><h1 style={{ fontSize: 22, margin: 0 }}>{done.status === 'booked' ? "You're booked" : 'Request received'}</h1></div>
      <p>{done.status === 'booked' ? <>Your visit with <b>{done.hostName}</b> is confirmed for <b>{lagosDay(done.start)} at {lagosTime(done.start)}</b>.</> : <>Your request to see <b>{done.hostName}</b> on <b>{lagosDay(done.start)} at {lagosTime(done.start)}</b> has been received. Reception will confirm by e-mail.</>}</p>
      <p>Reference <b data-testid="visit-ref">{done.reference}</b>. We have e-mailed you a link to your visitor pass with a QR code. Please bring a photo ID and show the pass at reception.</p>
      <a className="btn btn-primary" href={`/visit/${done.code}`}>Open my visitor pass</a>
    </div>);

  return wrap(<>
    <div className="card">
      <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}><CalendarCheck size={26} color="var(--accent)" /><h1 style={{ fontSize: 22, margin: 0 }}>Book a visit{company ? ` — ${company}` : ''}</h1></div>
      <p className="text-muted" style={{ fontSize: 14, marginBottom: 0 }}>Choose who you are coming to see, pick a day and a time, and we will confirm by e-mail. Times are Lagos time.</p>
    </div>

    <div className="card" style={{ display: 'grid', gap: 10 }}>
      <b>1. Who are you visiting?</b>
      {hosts === null ? <div className="text-muted">Loading…</div> : hosts.length === 0 ? <div className="text-muted">No one is taking online bookings right now. Please call reception.</div> : <>
        <input className="input" placeholder="Search by name or department" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search people" />
        <div style={{ display: 'grid', gap: 6, maxHeight: 220, overflow: 'auto' }}>
          {hosts.filter((h) => !q || `${h.name} ${h.department || ''}`.toLowerCase().includes(q.toLowerCase())).map((h) => (
            <button type="button" key={h.id} className={`btn ${host?.id === h.id ? 'btn-primary' : 'btn-ghost'}`} style={{ justifyContent: 'space-between', textAlign: 'left' }} onClick={() => { setHost(h); setMonth(0); setErr(''); }}>
              <span>{h.name}</span><span style={{ opacity: .7, fontSize: 12.5 }}>{h.department || ''}</span></button>))}
        </div></>}
    </div>

    {host && <div className="card" style={{ display: 'grid', gap: 10 }}>
      <b>2. Pick a day</b>
      {cal.length === 0 ? <div className="text-muted">Loading…</div> : <>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <button type="button" className="icon-btn" aria-label="Previous month" disabled={month === 0} onClick={() => setMonth(month - 1)}><ChevronLeft /></button>
          <b>{new Date(mKey + '-15T12:00:00Z').toLocaleDateString('en-GB', { month: 'long', year: 'numeric', timeZone: 'UTC' })}</b>
          <button type="button" className="icon-btn" aria-label="Next month" disabled={month >= months.length - 1} onClick={() => setMonth(month + 1)}><ChevronRight /></button>
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7,1fr)', gap: 4, textAlign: 'center', fontSize: 12 }}>
          {['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].map((d) => <div key={d} className="text-muted">{d}</div>)}
          {Array.from({ length: lead }).map((_, i) => <div key={'b' + i} />)}
          {inMonth.map((c) => { const sel = c.date === date; const off = c.free === 0; return (
            <button type="button" key={c.date} disabled={off} aria-label={`${fmtDate(c.date)}: ${c.free} free`} onClick={() => setDate(c.date)}
              style={{ padding: '8px 0', borderRadius: 8, border: '1px solid var(--border)', cursor: off ? 'not-allowed' : 'pointer', opacity: off ? .35 : 1, background: sel ? 'var(--accent)' : 'transparent', color: sel ? '#fff' : 'inherit' }}>
              <div style={{ fontWeight: 600 }}>{+c.date.slice(8)}</div><div style={{ fontSize: 10.5 }}>{off ? '—' : `${c.free} free`}</div></button>); })}
        </div></>}
    </div>}

    {host && date && <div className="card" style={{ display: 'grid', gap: 10 }}>
      <b>3. Pick a time on {fmtDate(date)}</b>
      {slots === null ? <div className="text-muted">Loading…</div> : slots.length === 0 ? <div className="text-muted">That day has just filled up. Please pick another.</div> :
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>{slots.map((s) => <button type="button" key={s.start} className={`btn ${slot?.start === s.start ? 'btn-primary' : 'btn-ghost'}`} onClick={() => setSlot(s)}>{s.label}</button>)}</div>}
    </div>}

    {host && slot && <form className="card" onSubmit={submit} style={{ display: 'grid', gap: 10 }}>
      <b>4. Your details</b>
      <div className="field"><label>Full name *</label><input className="input" required minLength={2} value={f.name} onChange={(e) => set('name', e.target.value)} /></div>
      <div className="field"><label>E-mail *</label><input className="input" type="email" required value={f.email} onChange={(e) => set('email', e.target.value)} /></div>
      <div className="field"><label>Phone</label><input className="input" value={f.phone} onChange={(e) => set('phone', e.target.value)} /></div>
      <div className="field"><label>Company</label><input className="input" value={f.company} onChange={(e) => set('company', e.target.value)} /></div>
      <div className="field"><label>Purpose of your visit</label><textarea className="input" rows={3} maxLength={500} value={f.purpose} onChange={(e) => set('purpose', e.target.value)} /></div>
      <input tabIndex={-1} autoComplete="off" aria-hidden style={{ position: 'absolute', left: -9999, height: 0, width: 0, opacity: 0 }} value={f.website} onChange={(e) => set('website', e.target.value)} />
      <div className="text-muted" style={{ fontSize: 12.5 }}>{host.name} · {fmtDate(date)} at {slot.label}. We keep your details only to manage your visit and for building security.</div>
      <button className="btn btn-primary" disabled={busy}>{busy ? 'Booking…' : 'Confirm booking'}</button>
    </form>}
    {err && <div role="alert" className="card" style={{ color: 'var(--danger)', fontSize: 14 }}>{err}</div>}
  </>);
}

/** The visitor's pass: shows the QR to scan at reception; the visitor can cancel until they arrive. */
export function VisitPass() {
  const { code } = useParams(); const [p, setP] = useState<any>(null); const [err, setErr] = useState(''); const [busy, setBusy] = useState(false);
  const load = () => api.get(`/public/visit/pass/${code}`).then((r) => setP(r.data.data)).catch((e) => setErr(apiErrorMessage(e)));
  useEffect(() => { load(); }, [code]);
  async function cancel() { if (!window.confirm('Cancel this visit?')) return; setBusy(true); try { await api.post(`/public/visit/pass/${code}/cancel`); await load(); } catch (e) { setErr(apiErrorMessage(e)); } finally { setBusy(false); } }
  if (err && !p) return wrap(<div className="card" role="alert">{err}</div>);
  if (!p) return wrap(<div className="card text-muted">Loading…</div>);
  const dead = ['cancelled', 'rejected', 'no_show', 'checked_out'].includes(p.status);
  return wrap(
    <div className="card" style={{ display: 'grid', gap: 10, textAlign: 'center' }}>
      <div className="text-muted" style={{ fontSize: 13 }}>{p.company} · Visitor pass</div>
      <h1 style={{ fontSize: 22, margin: 0 }}>{p.visitor}</h1>
      <div>Visiting <b>{p.host}</b>{p.start && <><br />{lagosDay(p.start)} at {lagosTime(p.start)}</>}</div>
      <div><span className="badge">{String(p.status).replace(/_/g, ' ')}</span> · {p.reference}{p.badgeNo ? ` · badge ${p.badgeNo}` : ''}</div>
      {!dead && <img src={p.qr} alt="Visitor QR code" style={{ width: 220, height: 220, margin: '0 auto', background: '#fff', padding: 8, borderRadius: 8 }} />}
      {!dead && <div className="text-muted" style={{ fontSize: 13 }}>Show this code and a photo ID at reception.</div>}
      {err && <div role="alert" style={{ color: 'var(--danger)' }}>{err}</div>}
      {p.canCancel && <button className="btn btn-ghost" disabled={busy} onClick={cancel}>Cancel my visit</button>}
    </div>);
}
