import { useCallback, useEffect, useState } from 'react';
import { Check, Copy, X } from 'lucide-react';
import { api, apiErrorMessage } from '@/lib/api';
import { PageHead, Tabs } from '@/components/ui/PageHead';
import { Modal } from '@/components/ui/Modal';
import { useToast } from '@/context/ToastContext';

const DAYS = [[1, 'Monday'], [2, 'Tuesday'], [3, 'Wednesday'], [4, 'Thursday'], [5, 'Friday'], [6, 'Saturday'], [0, 'Sunday']] as Array<[number, string]>;
const when = (iso?: string) => iso ? new Date(iso).toLocaleString('en-GB', { weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', timeZone: 'Africa/Lagos' }) : '';
const STATUS: Record<string, string> = { pending_approval: 'Waiting for you', approved: 'Accepted', booked: 'Booked', checked_in: 'In the building', checked_out: 'Left', rejected: 'Declined', cancelled: 'Cancelled', no_show: 'Did not arrive' };

/** Every employee: answer "someone is at reception", see who is coming, and choose when people may book them. */
export function MyVisitors() {
  const { showError, showSuccess } = useToast();
  const [tab, setTab] = useState('visitors'); const [d, setD] = useState<any>({ active: [], recent: [] });
  const [no, setNo] = useState<any>(null); const [reason, setReason] = useState(''); const [av, setAv] = useState<any>(null); const [busy, setBusy] = useState(false); const [blocked, setBlocked] = useState('');
  const load = useCallback(() => { api.get('/visitors/mine').then((r) => setD(r.data.data)).catch((e) => showError(apiErrorMessage(e))); }, [showError]);
  useEffect(() => { load(); api.get('/visitors/availability/me').then((r) => setAv(r.data.data)).catch((e) => showError(apiErrorMessage(e))); const t = setInterval(load, 20000); return () => clearInterval(t); }, [load, showError]);

  async function decide(v: any, accept: boolean) {
    try { await api.post(`/visitors/${v._id}/decision`, { accept, reason: accept ? undefined : reason }); showSuccess(accept ? `${v.visitor.name} accepted` : `${v.visitor.name} declined`); setNo(null); setReason(''); load(); } catch (e) { showError(apiErrorMessage(e)); }
  }
  async function save() {
    setBusy(true); try { const r = await api.put('/visitors/availability/me', av); setAv(r.data.data); showSuccess('Availability saved'); } catch (e) { showError(apiErrorMessage(e)); } finally { setBusy(false); }
  }
  const day = (n: number) => av.days.find((x: any) => x.day === n);
  const toggleDay = (n: number, on: boolean) => setAv({ ...av, days: on ? [...av.days, { day: n, ranges: [{ start: '09:00', end: '17:00' }] }] : av.days.filter((x: any) => x.day !== n) });
  const setRange = (n: number, i: number, k: 'start' | 'end', v: string) => setAv({ ...av, days: av.days.map((x: any) => x.day === n ? { ...x, ranges: x.ranges.map((r: any, j: number) => j === i ? { ...r, [k]: v } : r) } : x) });
  const addRange = (n: number) => setAv({ ...av, days: av.days.map((x: any) => x.day === n ? { ...x, ranges: [...x.ranges, { start: '14:00', end: '16:00' }] } : x) });
  const delRange = (n: number, i: number) => setAv({ ...av, days: av.days.map((x: any) => x.day === n ? { ...x, ranges: x.ranges.filter((_: any, j: number) => j !== i) } : x).filter((x: any) => x.ranges.length) });
  const link = `${window.location.origin}/book-visit`;
  const pending = d.active.filter((v: any) => v.status === 'pending_approval');

  return (
    <div>
      <PageHead title="My visitors" subtitle="Say yes or no when someone arrives for you, and choose when people can book time with you." />
      <Tabs value={tab} onChange={setTab} tabs={[{ key: 'visitors', label: 'Visitors', count: pending.length || undefined }, { key: 'availability', label: 'My availability' }]} />
      {tab === 'visitors' && <div style={{ display: 'grid', gap: 14, marginTop: 14 }}>
        {pending.length > 0 && <div className="card" style={{ borderLeft: '3px solid var(--gold, #F0A93B)' }}>
          <b>Waiting for your answer</b>
          {pending.map((v: any) => <div key={v._id} style={{ display: 'flex', gap: 10, alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', padding: '8px 0' }}>
            <div><b>{v.visitor.name}</b>{v.visitor.company ? ` · ${v.visitor.company}` : ''}<div className="text-muted" style={{ fontSize: 13 }}>{v.purpose || 'No purpose given'}{v.watch ? ' · reception has been alerted' : ''}</div></div>
            <div style={{ display: 'flex', gap: 8 }}><button className="btn btn-primary" onClick={() => decide(v, true)}><Check size={15} /> Accept</button><button className="btn btn-ghost" onClick={() => { setNo(v); setReason(''); }}><X size={15} /> Decline</button></div>
          </div>)}</div>}
        <div className="card"><b>Expected and on site</b>
          {d.active.filter((v: any) => v.status !== 'pending_approval').length === 0 ? <div className="text-muted" style={{ padding: '8px 0' }}>No visitors expected.</div> :
            d.active.filter((v: any) => v.status !== 'pending_approval').map((v: any) => <div key={v._id} style={{ display: 'flex', justifyContent: 'space-between', padding: '6px 0', gap: 8, flexWrap: 'wrap' }}>
              <span><b>{v.visitor.name}</b>{v.visitor.company ? ` · ${v.visitor.company}` : ''} <span className="text-muted">{v.scheduledStart ? when(v.scheduledStart) : 'walk-in'}</span></span><span className="badge">{STATUS[v.status]}</span></div>)}</div>
        <div className="card"><b>Recent</b>
          {d.recent.length === 0 ? <div className="text-muted" style={{ padding: '8px 0' }}>Nothing yet.</div> : d.recent.map((v: any) => <div key={v._id} style={{ display: 'flex', justifyContent: 'space-between', padding: '4px 0', fontSize: 14 }}><span>{v.visitor.name}</span><span className="text-muted">{STATUS[v.status]}</span></div>)}</div>
      </div>}

      {tab === 'availability' && av && <div className="card" style={{ display: 'grid', gap: 12, marginTop: 14, maxWidth: 760 }}>
        <label style={{ display: 'flex', gap: 8, alignItems: 'center' }}><input type="checkbox" checked={!!av.enabled} onChange={(e) => setAv({ ...av, enabled: e.target.checked })} /> <b>Let visitors book time with me online</b></label>
        <div className="text-muted" style={{ fontSize: 13 }}>When this is on, your name and department appear on the public booking page. Your e-mail and phone never do. Nobody can book a time that overlaps another booking.</div>
        {DAYS.map(([n, label]) => { const dd = day(n); return (
          <div key={n} style={{ display: 'grid', gridTemplateColumns: '120px 1fr', gap: 8, alignItems: 'start' }}>
            <label style={{ display: 'flex', gap: 6, alignItems: 'center' }}><input type="checkbox" checked={!!dd} onChange={(e) => toggleDay(n, e.target.checked)} />{label}</label>
            <div style={{ display: 'grid', gap: 6 }}>{dd ? <>{dd.ranges.map((r: any, i: number) => <div key={i} style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
              <input className="input" type="time" aria-label={`${label} start`} value={r.start} onChange={(e) => setRange(n, i, 'start', e.target.value)} style={{ width: 142 }} />–<input className="input" type="time" aria-label={`${label} end`} value={r.end} onChange={(e) => setRange(n, i, 'end', e.target.value)} style={{ width: 142 }} />
              <button type="button" className="icon-btn" aria-label="Remove period" onClick={() => delRange(n, i)}><X size={14} /></button></div>)}
              <button type="button" className="btn btn-ghost" style={{ width: 'fit-content' }} onClick={() => addRange(n)}>+ another period</button></> : <span className="text-muted">Not available</span>}</div>
          </div>); })}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(150px,1fr))', gap: 10 }}>
          {([['slotMinutes', 'Meeting length (min)', 15, 120], ['bufferMinutes', 'Gap between meetings (min)', 0, 120], ['maxPerDay', 'Max visitors per day', 1, 30], ['minNoticeHours', 'Minimum notice (hours)', 0, 168], ['maxAdvanceDays', 'Book up to (days ahead)', 1, 180]] as Array<[string, string, number, number]>).map(([k, l, mn, mx]) =>
            <div className="field" key={k}><label>{l}</label><input className="input" type="number" min={mn} max={mx} value={av[k] ?? ''} onChange={(e) => setAv({ ...av, [k]: e.target.value === '' ? '' : Number(e.target.value) })} /></div>)}
        </div>
        <div className="field"><label>Days you are away (no bookings)</label>
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>{(av.blockedDates || []).map((b: string) => <span key={b} className="badge" style={{ cursor: 'pointer' }} onClick={() => setAv({ ...av, blockedDates: av.blockedDates.filter((x: string) => x !== b) })}>{b} ✕</span>)}</div>
          <div style={{ display: 'flex', gap: 6 }}><input className="input" type="date" value={blocked} onChange={(e) => setBlocked(e.target.value)} style={{ width: 170 }} /><button type="button" className="btn btn-ghost" disabled={!blocked} onClick={() => { setAv({ ...av, blockedDates: Array.from(new Set([...(av.blockedDates || []), blocked])).sort() }); setBlocked(''); }}>Add day</button></div></div>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}><button className="btn btn-primary" disabled={busy} onClick={save}>{busy ? 'Saving…' : 'Save availability'}</button>
          <button className="btn btn-ghost" onClick={() => { navigator.clipboard?.writeText(link); showSuccess('Booking link copied'); }}><Copy size={14} /> Copy booking link</button><span className="text-muted" style={{ fontSize: 12.5 }}>{link}</span></div>
      </div>}

      <Modal open={!!no} onClose={() => setNo(null)} title={`Decline ${no?.visitor?.name || ''}`} footer={<><button className="btn btn-ghost" onClick={() => setNo(null)}>Back</button><button className="btn btn-primary" disabled={reason.trim().length < 3} onClick={() => decide(no, false)}>Decline visitor</button></>}>
        <div className="field"><label>Short reason (reception will tell the visitor)</label><input className="input" autoFocus value={reason} onChange={(e) => setReason(e.target.value)} placeholder="e.g. In a meeting all day" /></div>
      </Modal>
    </div>
  );
}
