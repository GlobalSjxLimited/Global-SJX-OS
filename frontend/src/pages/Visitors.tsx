import { useCallback, useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { AlertOctagon, Copy, FileDown, LogIn, LogOut, Printer, QrCode, ShieldAlert, UserPlus } from 'lucide-react';
import { api, apiErrorMessage, openProtectedFile } from '@/lib/api';
import { useAuth } from '@/context/AuthContext';
import { useToast } from '@/context/ToastContext';
import { PageHead, Tabs } from '@/components/ui/PageHead';
import { Modal } from '@/components/ui/Modal';
import { StatCard } from '@/components/ui/StatCard';
import { Pagination } from '@/components/ui/Pagination';

const hm = (iso?: string) => iso ? new Date(iso).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', timeZone: 'Africa/Lagos' }) : '';
const dt = (iso?: string) => iso ? new Date(iso).toLocaleString('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', timeZone: 'Africa/Lagos' }) : '';
const ST: Record<string, string> = { pending_approval: 'Waiting for host', approved: 'Host accepted', booked: 'Booked', checked_in: 'On site', checked_out: 'Left', rejected: 'Declined', cancelled: 'Cancelled', no_show: 'No-show' };
const Flag = ({ w }: { w?: any }) => w ? <span className="badge" style={{ background: w.level === 'block' ? 'var(--danger)' : 'var(--gold, #F0A93B)', color: '#000', marginLeft: 6 }}><ShieldAlert size={11} /> security alert</span> : null;
const csv = (rows: any[][]) => rows.map((r) => r.map((c) => `"${String(c ?? '').replace(/"/g, '""')}"`).join(',')).join('\n');
function download(name: string, text: string) { const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([text], { type: 'text/csv' })); a.download = name; a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 5000); }

export function Visitors() {
  const { user } = useAuth(); const { showError, showSuccess } = useToast();
  const isAdmin = user?.role === 'super_admin' || !!user?.modules?.includes('visitors_admin');
  const isDesk = user?.role === 'super_admin' || !!user?.modules?.includes('visitors');
  const [sp, setSp] = useSearchParams(); const tab = sp.get('tab') || 'today'; const setTab = (t: string) => setSp({ tab: t });
  const [today, setToday] = useState<any>({ pending: [], expected: [], onSite: [], done: [] }); const [on, setOn] = useState<any>({ people: [], evacuation: null });
  const [walk, setWalk] = useState(false); const [code, setCode] = useState(''); const [ovr, setOvr] = useState<any>(null); const [ovrText, setOvrText] = useState('');
  const link = `${window.location.origin}/book-visit`;

  const load = useCallback(() => {
    api.get('/visitors/today').then((r) => setToday(r.data.data)).catch((e) => showError(apiErrorMessage(e)));
    api.get('/visitors/onsite/list').then((r) => setOn(r.data.data)).catch(() => undefined);
  }, [showError]);
  useEffect(() => { load(); const t = setInterval(load, 15000); return () => clearInterval(t); }, [load]);

  async function checkIn(v: any, override?: string) {
    try { const r = await api.post(`/visitors/${v._id}/check-in`, { override }); showSuccess(`${v.visitor.name} checked in — badge ${r.data.data.badgeNo}`); setOvr(null); setOvrText(''); load(); openPass(r.data.data); }
    catch (e: any) { const m = apiErrorMessage(e); if (e?.response?.status === 400 && /note|reason|override|security/i.test(m)) { setOvr(v); } else showError(m); }
  }
  async function openPass(v: any) { try { await openProtectedFile(`/visitors/${v._id}/pass`, `pass-${v.badgeNo}.pdf`); } catch (e) { showError(apiErrorMessage(e)); } }
  async function checkOut(v: any) { try { await api.post(`/visitors/${v._id}/check-out`); showSuccess(`${v.visitor.name} checked out`); load(); } catch (e) { showError(apiErrorMessage(e)); } }
  async function lookup(e: React.FormEvent) {
    e.preventDefault(); try { const v = (await api.post('/visitors/lookup', { code })).data.data; setCode(''); if (v.status === 'checked_in') showError(`${v.visitor.name} is already checked in`); else if (['booked', 'approved'].includes(v.status)) checkIn(v); else showError(`${v.visitor.name}: ${ST[v.status]}`); } catch (x) { showError(apiErrorMessage(x)); }
  }
  const Row = ({ v, actions }: { v: any; actions?: React.ReactNode }) => (
    <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, flexWrap: 'wrap', padding: '8px 0', borderTop: '1px solid var(--border)' }}>
      <div><b>{v.visitor.name}</b>{v.visitor.company ? ` · ${v.visitor.company}` : ''}<Flag w={v.watch} />
        <div className="text-muted" style={{ fontSize: 13 }}>for {v.hostName}{v.scheduledStart ? ` · ${hm(v.scheduledStart)}` : ' · walk-in'}{v.badgeNo ? ` · badge ${v.badgeNo}` : ''}{v.purpose ? ` · ${v.purpose}` : ''}</div></div>
      <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>{actions}</div></div>);

  const tabs = [{ key: 'today', label: 'Today', count: today.pending.length || undefined }, { key: 'onsite', label: 'On site & evacuation', count: on.people.length }, { key: 'history', label: 'History' }, ...(isAdmin ? [{ key: 'watch', label: 'Watchlist' }, { key: 'analytics', label: 'Analytics' }] : []), { key: 'booking', label: 'Booking link' }];
  return (
    <div>
      <PageHead title="Visitors" subtitle="Reception desk: approvals, check-in, passes, and who is in the building." actions={isDesk ? <button className="btn btn-primary" onClick={() => setWalk(true)}><UserPlus size={15} /> Register walk-in</button> : undefined} />
      {on.evacuation && <div role="alert" style={{ background: 'var(--danger)', color: '#fff', padding: '10px 14px', borderRadius: 10, marginBottom: 12, display: 'flex', justifyContent: 'space-between', gap: 8, flexWrap: 'wrap' }}><b>{on.evacuation.drill ? 'EVACUATION DRILL' : 'EVACUATION'} IN PROGRESS: {on.evacuation.reason}</b><button className="btn btn-ghost" style={{ color: '#fff' }} onClick={() => setTab('onsite')}>Open dashboard</button></div>}
      <Tabs tabs={tabs} value={tab} onChange={setTab} />
      <div style={{ marginTop: 14, display: 'grid', gap: 14 }}>
        {tab === 'today' && <>
          <div className="grid-stats" style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(150px,1fr))', gap: 10 }}>
            <StatCard label="Waiting for host" value={today.pending.length} /><StatCard label="Expected" value={today.expected.length} /><StatCard label="On site" value={today.onSite.length} /><StatCard label="Left today" value={today.done.filter((v: any) => v.status === 'checked_out').length} /></div>
          {isDesk && <form className="card" onSubmit={lookup} style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}><QrCode size={18} /><b>Scan or type a pass code</b>
            <input className="input" style={{ flex: 1, minWidth: 200 }} placeholder="Click here, then scan the visitor's QR code" value={code} onChange={(e) => setCode(e.target.value)} aria-label="Pass code" /><button className="btn btn-ghost" disabled={code.trim().length < 6}>Find & check in</button></form>}
          <div className="card"><b>Waiting for the host to answer</b>{today.pending.length === 0 ? <div className="text-muted" style={{ padding: '8px 0' }}>None.</div> : today.pending.map((v: any) => <Row key={v._id} v={v} actions={isDesk && <button className="btn btn-ghost" onClick={() => api.post(`/visitors/${v._id}/cancel`, { reason: 'cancelled by reception' }).then(load).catch((e) => showError(apiErrorMessage(e)))}>Cancel</button>} />)}</div>
          <div className="card"><b>Expected / accepted — ready to check in</b>{today.expected.length === 0 ? <div className="text-muted" style={{ padding: '8px 0' }}>None.</div> : today.expected.map((v: any) => <Row key={v._id} v={v} actions={isDesk && <><button className="btn btn-primary" onClick={() => checkIn(v)}><LogIn size={14} /> Check in</button><button className="btn btn-ghost" onClick={() => api.post(`/visitors/${v._id}/cancel`, {}).then(load).catch((e) => showError(apiErrorMessage(e)))}>Cancel</button></>} />)}</div>
          <div className="card"><b>On site now</b>{today.onSite.length === 0 ? <div className="text-muted" style={{ padding: '8px 0' }}>Nobody.</div> : today.onSite.map((v: any) => <Row key={v._id} v={v} actions={isDesk && <><button className="btn btn-ghost" onClick={() => openPass(v)}><Printer size={14} /> Pass</button><button className="btn btn-primary" onClick={() => checkOut(v)}><LogOut size={14} /> Check out</button></>} />)}</div>
          <div className="card"><b>Done today</b>{today.done.length === 0 ? <div className="text-muted" style={{ padding: '8px 0' }}>Nothing yet.</div> : today.done.map((v: any) => <Row key={v._id} v={v} actions={<span className="badge">{ST[v.status]}</span>} />)}</div>
        </>}
        {tab === 'onsite' && <Evacuation on={on} reload={load} />}
        {tab === 'history' && <History />}
        {tab === 'watch' && isAdmin && <Watchlist />}
        {tab === 'analytics' && isAdmin && <Analytics />}
        {tab === 'booking' && <div className="card" style={{ display: 'grid', gap: 10 }}>
          <b>Public booking link</b><div className="text-muted" style={{ fontSize: 13.5 }}>Share this link with anyone who needs to book a visit. They choose a person, a day and a free time; each employee controls their own hours under “My visitors”.</div>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}><input className="input" readOnly value={link} style={{ flex: 1, minWidth: 240 }} onFocus={(e) => e.target.select()} /><button className="btn btn-primary" onClick={() => { navigator.clipboard?.writeText(link); showSuccess('Link copied'); }}><Copy size={14} /> Copy</button><a className="btn btn-ghost" href={link} target="_blank" rel="noreferrer">Open</a></div>
          {isAdmin && <Hosts />}</div>}
      </div>
      {walk && <Walk onClose={() => setWalk(false)} onDone={() => { setWalk(false); load(); }} />}
      <Modal open={!!ovr} onClose={() => setOvr(null)} title="Security check" footer={<><button className="btn btn-ghost" onClick={() => setOvr(null)}>Back</button><button className="btn btn-primary" disabled={ovrText.trim().length < 10} onClick={() => checkIn(ovr, ovrText)}>Check in anyway</button></>}>
        <p>Reception has been alerted about <b>{ovr?.visitor?.name}</b>. Security has been told. Do not tell the visitor why. Record what you did (e.g. “security informed, escorted by guard”). A person who is blocked can only be checked in by security staff.</p>
        <div className="field"><label>Note / reason (min 10 characters)</label><input className="input" autoFocus value={ovrText} onChange={(e) => setOvrText(e.target.value)} /></div>
      </Modal>
    </div>
  );
}

function Walk({ onClose, onDone }: { onClose: () => void; onDone: () => void }) {
  const { showError, showSuccess } = useToast();
  const [q, setQ] = useState(''); const [people, setPeople] = useState<any[]>([]); const [host, setHost] = useState<any>(null);
  const [f, setF] = useState({ name: '', email: '', phone: '', company: '', purpose: '', vehicle: '', idType: '', idLast4: '' }); const [busy, setBusy] = useState(false);
  const set = (k: string, v: string) => setF((x) => ({ ...x, [k]: v }));
  useEffect(() => { const t = setTimeout(() => api.get('/visitors/people', { params: { q } }).then((r) => setPeople(r.data.data)).catch(() => undefined), 200); return () => clearTimeout(t); }, [q]);
  async function go() {
    setBusy(true); try {
      const r = await api.post('/visitors/walk-in', { hostId: host.id, person: { name: f.name, email: f.email, phone: f.phone, company: f.company }, purpose: f.purpose, vehicle: f.vehicle || undefined, idType: f.idType || undefined, idLast4: f.idLast4 || undefined });
      showSuccess(`Request sent to ${host.name}`); if (r.data.data.watch) showError('Security alert on this visitor. Do not discuss it with them.'); onDone();
    } catch (e) { showError(apiErrorMessage(e)); } finally { setBusy(false); }
  }
  return (
    <Modal open onClose={onClose} title="Register walk-in visitor" size="wide" footer={<><button className="btn btn-ghost" onClick={onClose}>Cancel</button><button className="btn btn-primary" disabled={busy || !host || f.name.trim().length < 2} onClick={go}>{busy ? 'Sending…' : 'Ask host to approve'}</button></>}>
      <div style={{ display: 'grid', gap: 10 }}>
        <div className="field"><label>Who are they here to see? *</label>
          {host ? <div><b>{host.name}</b> <span className="text-muted">{host.department}</span> <button className="btn btn-ghost" onClick={() => setHost(null)}>Change</button></div> : <>
            <input className="input" autoFocus placeholder="Type a name" value={q} onChange={(e) => setQ(e.target.value)} />
            <div style={{ display: 'grid', gap: 4, maxHeight: 150, overflow: 'auto' }}>{people.map((p) => <button type="button" key={p.id} className="btn btn-ghost" style={{ justifyContent: 'space-between' }} onClick={() => setHost(p)}><span>{p.name}</span><span className="text-muted">{p.department || ''}</span></button>)}</div></>}</div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(200px,1fr))', gap: 10 }}>
          <div className="field"><label>Visitor's full name *</label><input className="input" value={f.name} onChange={(e) => set('name', e.target.value)} /></div>
          <div className="field"><label>Company</label><input className="input" value={f.company} onChange={(e) => set('company', e.target.value)} /></div>
          <div className="field"><label>Phone</label><input className="input" value={f.phone} onChange={(e) => set('phone', e.target.value)} /></div>
          <div className="field"><label>E-mail (they get a status e-mail)</label><input className="input" type="email" value={f.email} onChange={(e) => set('email', e.target.value)} /></div>
          <div className="field"><label>ID type seen</label><select className="input" value={f.idType} onChange={(e) => set('idType', e.target.value)}><option value="">—</option>{['National ID', 'Driver licence', 'Passport', 'Voter card', 'Company ID', 'Other'].map((x) => <option key={x}>{x}</option>)}</select></div>
          <div className="field"><label>Last 4 of ID number</label><input className="input" maxLength={4} value={f.idLast4} onChange={(e) => set('idLast4', e.target.value)} /></div>
          <div className="field"><label>Vehicle plate</label><input className="input" value={f.vehicle} onChange={(e) => set('vehicle', e.target.value)} /></div></div>
        <div className="field"><label>Purpose of visit</label><input className="input" value={f.purpose} onChange={(e) => set('purpose', e.target.value)} /></div>
        <div className="text-muted" style={{ fontSize: 12.5 }}>Check the photo ID by eye. Only the last 4 characters are kept.</div>
      </div>
    </Modal>);
}

function Evacuation({ on, reload }: { on: any; reload: () => void }) {
  const { showError, showSuccess } = useToast(); const [ask, setAsk] = useState(false); const [reason, setReason] = useState(''); const [drill, setDrill] = useState(false); const [ev, setEv] = useState<any>(on.evacuation);
  useEffect(() => { setEv(on.evacuation); }, [on.evacuation]);
  const people: any[] = ev ? ev.people : on.people;
  const rows = people.map((p) => ({ id: p.visitId || p._id, name: p.name || p.visitor?.name, phone: p.phone || p.visitor?.phone, email: p.email || p.visitor?.email, company: p.company || p.visitor?.company, host: p.hostName, badge: p.badgeNo, since: p.checkedInAt, safe: p.accountedAt }));
  async function start() { try { const r = await api.post('/visitors/evacuation/start', { reason, drill }); setEv(r.data.data); setAsk(false); setReason(''); reload(); } catch (e) { showError(apiErrorMessage(e)); } }
  async function account(id: string) { try { setEv((await api.post(`/visitors/evacuation/${ev._id}/account`, { visitId: id })).data.data); } catch (e) { showError(apiErrorMessage(e)); } }
  async function end() { try { const r = await api.post(`/visitors/evacuation/${ev._id}/end`); showSuccess(r.data.data.missing ? `Ended: ${r.data.data.missing} not accounted for. Security alerted.` : 'Ended: everyone accounted for'); setEv(null); reload(); } catch (e) { showError(apiErrorMessage(e)); } }
  const exp = () => download(`${ev ? 'evacuation' : 'on-site'}-${new Date().toISOString().slice(0, 16).replace(/[:T]/g, '-')}.csv`, csv([['Name', 'Company', 'Phone', 'Email', 'Host', 'Badge', ev ? 'Accounted for' : 'Since'], ...rows.map((r) => [r.name, r.company, r.phone, r.email, r.host, r.badge, ev ? (r.safe ? 'yes' : 'NO') : dt(r.since)])]));
  const missing = ev ? rows.filter((r) => !r.safe).length : 0;
  return (<div className="card" style={{ display: 'grid', gap: 12 }} id="evac-print">
    <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
      <div><b style={{ fontSize: 18 }}>{ev ? (ev.drill ? 'Evacuation drill' : 'EVACUATION') + `: ${ev.reason}` : 'Who is in the building now'}</b><div className="text-muted" style={{ fontSize: 13 }}>Visitors only. Staff are not tracked here. List as of {new Date().toLocaleTimeString('en-GB', { timeZone: 'Africa/Lagos' })}.{ev && ` ${missing} of ${rows.length} not yet accounted for.`}</div></div>
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
        <button className="btn btn-ghost" onClick={exp}><FileDown size={14} /> CSV</button><button className="btn btn-ghost" onClick={() => { document.body.classList.add('printing-evac'); const done = () => { document.body.classList.remove('printing-evac'); window.removeEventListener('afterprint', done); }; window.addEventListener('afterprint', done); window.print(); }}><Printer size={14} /> Print</button>
        {ev ? <button className="btn btn-primary" onClick={end}>End evacuation</button> : <button className="btn" style={{ background: 'var(--danger)', color: '#fff', fontWeight: 700 }} onClick={() => setAsk(true)}><AlertOctagon size={15} /> START EVACUATION</button>}</div></div>
    {rows.length === 0 ? <div className="text-muted">No visitors are checked in.</div> :
      <div style={{ overflowX: 'auto' }}><table className="table" style={{ width: '100%' }}><thead><tr><th>Name</th><th>Company</th><th>Phone</th><th>Host</th><th>Badge</th>{ev ? <th>Safe?</th> : <th>Since</th>}</tr></thead>
        <tbody>{rows.map((r) => <tr key={r.id} style={ev && r.safe ? { opacity: .55 } : undefined}><td><b>{r.name}</b></td><td>{r.company}</td><td>{r.phone ? <a href={`tel:${r.phone}`}>{r.phone}</a> : '—'}</td><td>{r.host}</td><td>{r.badge}</td>
          <td>{ev ? <label style={{ display: 'flex', gap: 6, alignItems: 'center' }}><input type="checkbox" checked={!!r.safe} onChange={() => account(r.id)} aria-label={`${r.name} accounted for`} />{r.safe ? 'Safe' : 'Missing'}</label> : hm(r.since)}</td></tr>)}</tbody></table></div>}
    <Modal open={ask} onClose={() => setAsk(false)} title="Start evacuation" footer={<><button className="btn btn-ghost" onClick={() => setAsk(false)}>Cancel</button><button className="btn" style={{ background: 'var(--danger)', color: '#fff' }} disabled={reason.trim().length < 3} onClick={start}>{drill ? 'Start drill' : 'Start evacuation'}</button></>}>
      <p>This freezes the current list of visitors, alerts management and security, and lets you tick people off at the assembly point.</p>
      <div className="field"><label>Reason</label><input className="input" autoFocus value={reason} onChange={(e) => setReason(e.target.value)} placeholder="e.g. Fire alarm, floor 2" /></div>
      <label style={{ display: 'flex', gap: 6, alignItems: 'center' }}><input type="checkbox" checked={drill} onChange={(e) => setDrill(e.target.checked)} /> This is a drill</label></Modal>
  </div>);
}

function History() {
  const { showError } = useToast(); const [q, setQ] = useState(''); const [status, setStatus] = useState(''); const [page, setPage] = useState(1); const [d, setD] = useState<any>({ rows: [], pages: 1, total: 0 });
  useEffect(() => { const t = setTimeout(() => api.get('/visitors', { params: { q: q || undefined, status: status || undefined, page, limit: 25 } }).then((r) => setD({ rows: r.data.data, pages: r.data.pagination.pages, total: r.data.pagination.total })).catch((e) => showError(apiErrorMessage(e))), 250); return () => clearTimeout(t); }, [q, status, page, showError]);
  return (<div className="card" style={{ display: 'grid', gap: 10 }}>
    <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}><input className="input" style={{ flex: 1, minWidth: 200 }} placeholder="Search name, company, host, badge, reference" value={q} onChange={(e) => { setQ(e.target.value); setPage(1); }} />
      <select className="input" style={{ width: 180 }} value={status} onChange={(e) => { setStatus(e.target.value); setPage(1); }}><option value="">All statuses</option>{Object.entries(ST).map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select></div>
    <div style={{ overflowX: 'auto' }}><table className="table" style={{ width: '100%' }}><thead><tr><th>Ref</th><th>Visitor</th><th>Host</th><th>Type</th><th>In</th><th>Out</th><th>Status</th></tr></thead>
      <tbody>{d.rows.map((v: any) => <tr key={v._id}><td>{v.reference}</td><td>{v.visitor.name}{v.visitor.company ? ` · ${v.visitor.company}` : ''}<Flag w={v.watch} /></td><td>{v.hostName}</td><td>{v.type === 'walk_in' ? 'Walk-in' : 'Appointment'}</td><td>{dt(v.checkedInAt)}</td><td>{dt(v.checkedOutAt)}</td><td>{ST[v.status]}</td></tr>)}</tbody></table></div>
    <Pagination page={page} pages={d.pages} total={d.total} onChange={setPage} /></div>);
}

function Watchlist() {
  const { showError, showSuccess } = useToast(); const [rows, setRows] = useState<any[]>([]); const [f, setF] = useState<any>({ name: '', email: '', phone: '', company: '', level: 'flag', reason: '', expiresAt: '' });
  const load = () => api.get('/visitors/watchlist/list').then((r) => setRows(r.data.data)).catch((e) => showError(apiErrorMessage(e)));
  useEffect(() => { load(); }, []);
  async function add(e: React.FormEvent) { e.preventDefault(); try { await api.post('/visitors/watchlist', f); setF({ name: '', email: '', phone: '', company: '', level: 'flag', reason: '', expiresAt: '' }); showSuccess('Added'); load(); } catch (x) { showError(apiErrorMessage(x)); } }
  return (<>
    <form className="card" onSubmit={add} style={{ display: 'grid', gap: 10 }}><b>Add to watchlist</b>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(180px,1fr))', gap: 10 }}>
        <div className="field"><label>Name *</label><input className="input" required value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} /></div>
        <div className="field"><label>E-mail</label><input className="input" type="email" value={f.email} onChange={(e) => setF({ ...f, email: e.target.value })} /></div>
        <div className="field"><label>Phone</label><input className="input" value={f.phone} onChange={(e) => setF({ ...f, phone: e.target.value })} /></div>
        <div className="field"><label>Level</label><select className="input" value={f.level} onChange={(e) => setF({ ...f, level: e.target.value })}><option value="flag">Flag (extra attention)</option><option value="block">Block (security must clear)</option></select></div>
        <div className="field"><label>Expires (optional)</label><input className="input" type="date" value={f.expiresAt} onChange={(e) => setF({ ...f, expiresAt: e.target.value })} /></div></div>
      <div className="field"><label>Reason (only security admins see this) *</label><input className="input" required minLength={5} value={f.reason} onChange={(e) => setF({ ...f, reason: e.target.value })} /></div>
      <div className="text-muted" style={{ fontSize: 12.5 }}>A match on e-mail or phone applies the level you choose. A match on name alone only ever raises a flag, because names are not unique. Keep reasons factual; people can ask to see data held about them.</div>
      <button className="btn btn-primary" style={{ width: 'fit-content' }}>Add entry</button></form>
    <div className="card"><b>Entries</b>{rows.length === 0 ? <div className="text-muted" style={{ padding: 8 }}>None.</div> : rows.map((r) => <div key={r._id} style={{ display: 'flex', justifyContent: 'space-between', gap: 8, flexWrap: 'wrap', padding: '8px 0', borderTop: '1px solid var(--border)', opacity: r.active ? 1 : .5 }}>
      <div><b>{r.name}</b> <span className="badge">{r.level}</span> <span className="text-muted" style={{ fontSize: 13 }}>{[r.email, r.phone].filter(Boolean).join(' · ')}</span><div style={{ fontSize: 13 }}>{r.reason}</div><div className="text-muted" style={{ fontSize: 12 }}>{r.hits || 0} hit(s){r.expiresAt ? ` · expires ${new Date(r.expiresAt).toLocaleDateString('en-GB')}` : ''}</div></div>
      <button className="btn btn-ghost" onClick={() => api.post(`/visitors/watchlist/${r._id}/toggle`).then(load).catch((e) => showError(apiErrorMessage(e)))}>{r.active ? 'Deactivate' : 'Reactivate'}</button></div>)}</div></>);
}

function Bars({ data, label, value }: { data: any[]; label: (d: any) => string; value: (d: any) => number }) {
  const max = Math.max(1, ...data.map(value));
  return <div style={{ display: 'grid', gap: 4 }}>{data.map((d, i) => <div key={i} style={{ display: 'grid', gridTemplateColumns: '90px 1fr 32px', gap: 8, alignItems: 'center', fontSize: 13 }}><span className="text-muted">{label(d)}</span><div style={{ background: 'var(--border)', borderRadius: 4, height: 10 }}><div style={{ width: `${(value(d) / max) * 100}%`, background: 'var(--accent)', height: 10, borderRadius: 4 }} /></div><span>{value(d)}</span></div>)}</div>;
}
function Analytics() {
  const { showError } = useToast(); const [days, setDays] = useState(30); const [a, setA] = useState<any>(null);
  useEffect(() => { api.get('/visitors/stats/analytics', { params: { days } }).then((r) => setA(r.data.data)).catch((e) => showError(apiErrorMessage(e))); }, [days, showError]);
  const weeks = useMemo(() => { if (!a) return []; const out: any[] = []; for (let i = 0; i < a.series.length; i += 7) out.push({ label: a.series[i].date.slice(5), n: a.series.slice(i, i + 7).reduce((s: number, x: any) => s + x.visitors, 0) }); return out; }, [a]);
  if (!a) return <div className="text-muted">Loading…</div>;
  return (<>
    <div style={{ display: 'flex', gap: 8 }}>{[7, 30, 90, 365].map((d) => <button key={d} className={`btn ${days === d ? 'btn-primary' : 'btn-ghost'}`} onClick={() => setDays(d)}>{d === 365 ? '1 year' : `${d} days`}</button>)}</div>
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(150px,1fr))', gap: 10 }}>
      <StatCard label="Visitors checked in" value={a.checkedIn} /><StatCard label="Walk-ins" value={a.walkIns} /><StatCard label="Appointments" value={a.appointments} /><StatCard label="Avg visit (min)" value={a.avgMinutes ?? 0} /><StatCard label="No-show rate" value={a.noShowRate ?? 0} suffix="%" /><StatCard label="Watchlist hits" value={a.watchlistHits} /></div>
    <div className="text-muted" style={{ fontSize: 13.5 }}>Busiest hour: <b>{a.busiestHour || '—'}</b> · busiest day: <b>{a.busiestDay || '—'}</b> · repeat visitors: <b>{a.repeatVisitors}</b> · booked online: <b>{a.online}</b>{a.rejectedRate !== null && <> · walk-ins declined: <b>{a.rejectedRate}%</b></>}</div>
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(300px,1fr))', gap: 14 }}>
      <div className="card"><b>Visitors per week</b><Bars data={weeks} label={(d) => `from ${d.label}`} value={(d) => d.n} /></div>
      <div className="card"><b>By hour of day</b><Bars data={a.byHour} label={(d) => `${String(d.hour).padStart(2, '0')}:00`} value={(d) => d.n} /></div>
      <div className="card"><b>By weekday</b><Bars data={a.byWeekday} label={(d) => d.day} value={(d) => d.n} /></div>
      <div className="card"><b>Most visited employees</b>{a.topHosts.length ? <Bars data={a.topHosts} label={(d) => d.name} value={(d) => d.n} /> : <div className="text-muted">No data yet.</div>}</div></div></>);
}

function Hosts() {
  const [h, setH] = useState<any[]>([]); useEffect(() => { api.get('/visitors/availability/all').then((r) => setH(r.data.data)).catch(() => undefined); }, []);
  return <div><b>People taking online bookings ({h.length})</b><div className="text-muted" style={{ fontSize: 13 }}>{h.length ? h.map((x) => x.name).join(', ') : 'Nobody has switched it on yet. Each employee does this under “My visitors”.'}</div></div>;
}
