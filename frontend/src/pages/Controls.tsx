import { useMemo, useState } from 'react';
import { ShieldCheck, Plus, CheckCircle2, Pencil, History, PauseCircle, PlayCircle, KeyRound, ClipboardCheck } from 'lucide-react';
import { api, apiErrorMessage } from '@/lib/api';
import { useToast } from '@/context/ToastContext';
import { useApi } from '@/lib/useApi';
import { PageHead, Empty, Loading, ErrorNote } from '@/components/ui/PageHead';
import { Badge } from '@/components/ui/Badge';
import { Modal } from '@/components/ui/Modal';
import { fdate, label, toInputDate } from '@/lib/format';

const PREF_LABEL: Record<string, string> = { risk_manager: 'Risk manager → IT → CEO', it: 'IT / Governance → CEO', ceo: 'CEO', hr: 'HR → CEO', dpo: 'Data-protection officer → CEO', finance: 'Finance → CEO', user: 'Named person' };
const FREQ = [[30, 'Monthly'], [60, '60 days'], [90, 'Every 90 days'], [180, '6 months'], [365, 'Yearly']] as Array<[number, string]>;
const STATE: Record<string, { tone: 'danger' | 'gold' | 'success' | 'neutral'; text: string }> = { overdue: { tone: 'danger', text: 'Overdue' }, due_soon: { tone: 'gold', text: 'Due soon' }, on_track: { tone: 'success', text: 'On track' }, paused: { tone: 'neutral', text: 'Paused' } };
const every = (d: number) => (d % 365 === 0 ? `${d / 365} year${d === 365 ? '' : 's'}` : d % 30 === 0 && d >= 60 ? `${d / 30} months` : `${d} days`);

export function Controls() {
  const { data, extra, loading, error, reload } = useApi<any[]>('/controls');
  const { showError, showSuccess } = useToast();
  const [cat, setCat] = useState('');
  const [mine, setMine] = useState(false);
  const [q, setQ] = useState('');
  const [done, setDone] = useState<any>(null);
  const [edit, setEdit] = useState<any>(null);
  const [hist, setHist] = useState<any>(null);
  const [pause, setPause] = useState<any>(null);
  const can = !!extra?.canManage;
  const s = extra?.summary;
  const rows = useMemo(() => (data || []).filter((c) => (!cat || c.category === cat) && (!mine || c.mine) && (!q || `${c.title} ${c.isoRef || ''} ${c.policyRef || ''}`.toLowerCase().includes(q.toLowerCase()))), [data, cat, mine, q]);
  const cats: string[] = extra?.categories || [];
  async function resume(c: any) { try { await api.post(`/controls/${c._id}/resume`); showSuccess('Control resumed.'); reload(); } catch (e) { showError(apiErrorMessage(e)); } }
  return (
    <div className="page-enter">
      <PageHead title="Controls & recurring tasks" subtitle="Password rotations, risk assessments, access reviews, backup tests — the routine ISMS work, assigned to the right person, reminded on schedule, and evidenced."
        actions={can && <button className="btn btn-primary" onClick={() => setEdit('new')}><Plus size={16} /> New control</button>} />
      {s && <div className="stat-grid" style={{ marginBottom: 16 }}>
        <div className="stat-card"><div className="stat-label"><span>Compliance score</span></div><div className="stat-value">{s.score}%</div></div>
        <div className="stat-card"><div className="stat-label"><span>Overdue</span></div><div className="stat-value" style={s.overdue ? { color: 'var(--danger)' } : undefined}>{s.overdue}</div></div>
        <div className="stat-card"><div className="stat-label"><span>Due in 14 days</span></div><div className="stat-value">{s.dueSoon}</div></div>
        <div className="stat-card"><div className="stat-label"><span>No owner</span></div><div className="stat-value" style={s.unowned ? { color: 'var(--danger)' } : undefined}>{s.unowned}</div></div>
      </div>}
      <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', marginBottom: 12, alignItems: 'center' }}>
        <input className="input" style={{ maxWidth: 240 }} placeholder="Search controls, ISO refs…" value={q} onChange={(e) => setQ(e.target.value)} />
        <label style={{ fontSize: 13.5 }}><input type="checkbox" checked={mine} onChange={(e) => setMine(e.target.checked)} /> Assigned to me</label>
      </div>
      <div className="chips" style={{ marginBottom: 14 }}>
        <button className={`chip ${!cat ? 'active' : ''}`} onClick={() => setCat('')}>All</button>
        {cats.map((c) => <button key={c} className={`chip ${cat === c ? 'active' : ''}`} onClick={() => setCat(c)}>{c}</button>)}
      </div>
      <ErrorNote message={error} />
      {loading && !data ? <Loading /> : !rows.length ? <Empty icon={<ShieldCheck />} title="No controls match" /> : (
        <div style={{ display: 'grid', gap: 10 }}>
          {rows.map((c) => { const st = STATE[c.state] || STATE.on_track; return (
            <div key={c._id} className="card" style={{ display: 'grid', gap: 8, borderLeft: `3px solid ${c.state === 'overdue' ? 'var(--danger)' : c.state === 'due_soon' ? 'var(--gold)' : 'var(--line-strong)'}`, opacity: c.status === 'paused' ? 0.7 : 1 }}>
              <div style={{ display: 'flex', gap: 12, alignItems: 'flex-start', flexWrap: 'wrap' }}>
                <div style={{ color: 'var(--accent)', paddingTop: 2 }}>{c.category === 'Passwords & Access' ? <KeyRound size={20} /> : c.category === 'Risk' ? <ShieldCheck size={20} /> : <ClipboardCheck size={20} />}</div>
                <div style={{ flex: 1, minWidth: 240 }}>
                  <div style={{ fontWeight: 600 }}>{c.title} {c.mine && <Badge tone="accent">Yours</Badge>}</div>
                  <div className="text-muted" style={{ fontSize: 12.5, marginTop: 2 }}>{c.category} · every {every(c.frequencyDays)}{c.isoRef ? ` · ISO 27001 ${c.isoRef}` : ''}{c.policyRef ? ` · ${c.policyRef}` : ''}</div>
                  {c.description && <div style={{ fontSize: 13, marginTop: 6 }}>{c.description}</div>}
                </div>
                <div style={{ textAlign: 'right', minWidth: 170 }}>
                  <Badge tone={st.tone}>{st.text}</Badge>
                  <div style={{ fontSize: 13, marginTop: 6 }}>{c.status === 'paused' ? 'Paused' : c.daysLeft < 0 ? `${-c.daysLeft} day(s) overdue` : c.daysLeft === 0 ? 'Due today' : `Due ${fdate(c.nextDueAt)} (${c.daysLeft}d)`}</div>
                  <div className="text-muted" style={{ fontSize: 12 }}>Last: {c.lastCompletedAt ? `${fdate(c.lastCompletedAt)} by ${c.lastCompletedByName || '—'}` : 'never'}</div>
                </div>
              </div>
              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center', fontSize: 13 }}>
                <span className="text-muted">Owner:</span><b>{c.owners.length ? c.owners.map((o: any) => o.name).join(', ') : <span style={{ color: 'var(--danger)' }}>nobody — assign someone</span>}</b>
                <span className="text-muted">({c.assignedVia})</span>
                <span style={{ flex: 1 }} />
                {(c.mine || can) && c.status === 'active' && <button className="btn btn-primary btn-sm" onClick={() => setDone(c)}><CheckCircle2 size={14} /> Mark done</button>}
                <button className="btn btn-ghost btn-sm" onClick={async () => { try { const r = await api.get(`/controls/${c._id}/history`); setHist({ c, rows: r.data.data }); } catch (e) { showError(apiErrorMessage(e)); } }}><History size={14} /> History</button>
                {can && <button className="btn btn-ghost btn-sm" onClick={() => setEdit(c)}><Pencil size={14} /> Edit</button>}
                {can && (c.status === 'active' ? <button className="btn btn-ghost btn-sm" onClick={() => setPause({ c, reason: '' })}><PauseCircle size={14} /> Pause</button> : <button className="btn btn-ghost btn-sm" onClick={() => resume(c)}><PlayCircle size={14} /> Resume</button>)}
              </div>
            </div>); })}
        </div>)}
      {done && <DoneModal c={done} onClose={() => setDone(null)} onSaved={() => { setDone(null); reload(); }} />}
      {edit && <EditModal c={edit === 'new' ? null : edit} extra={extra} onClose={() => setEdit(null)} onSaved={() => { setEdit(null); reload(); }} />}
      {hist && <Modal open onClose={() => setHist(null)} title={`History — ${hist.c.title}`}>{!hist.rows.length ? <Empty title="Not completed yet" /> : <ul style={{ paddingLeft: 18, fontSize: 13.5, display: 'grid', gap: 8 }}>{hist.rows.map((h: any, i: number) => <li key={i}><b>{fdate(h.at)}</b> — {h.byName}{h.wasOverdueDays ? ` (${h.wasOverdueDays}d late)` : ''}{h.note ? `: ${h.note}` : ''}{h.evidenceUrl && <> · <a href={h.evidenceUrl} target="_blank" rel="noreferrer noopener">evidence</a></>}<div className="text-muted" style={{ fontSize: 12 }}>next due {fdate(h.nextDueAt)}</div></li>)}</ul>}</Modal>}
      {pause && <Modal open onClose={() => setPause(null)} title={`Pause — ${pause.c.title}`} footer={<><button className="btn btn-ghost" onClick={() => setPause(null)}>Cancel</button><button className="btn btn-primary" disabled={!pause.reason.trim()} onClick={async () => { try { await api.post(`/controls/${pause.c._id}/pause`, { reason: pause.reason }); setPause(null); showSuccess('Control paused.'); reload(); } catch (e) { showError(apiErrorMessage(e)); } }}>Pause</button></>}>
        <div className="field"><label>Reason * (auditors will ask)</label><input className="input" value={pause.reason} onChange={(e) => setPause({ ...pause, reason: e.target.value })} placeholder="e.g. Not applicable — no on-prem router" /></div></Modal>}
    </div>
  );
}

function DoneModal({ c, onClose, onSaved }: { c: any; onClose: () => void; onSaved: () => void }) {
  const { showError, showSuccess } = useToast();
  const [f, setF] = useState({ completedOn: toInputDate(new Date()), note: '', evidenceUrl: '' });
  const [ticks, setTicks] = useState<boolean[]>(() => (c.checklist || []).map(() => false));
  const all = ticks.every(Boolean);
  async function save() {
    try { await api.post(`/controls/${c._id}/complete`, { ...f, note: [f.note, !all && c.checklist?.length ? `(${ticks.filter(Boolean).length}/${c.checklist.length} checklist items ticked)` : ''].filter(Boolean).join(' ') }); showSuccess('Logged. Next due date set.'); onSaved(); }
    catch (e) { showError(apiErrorMessage(e)); }
  }
  return (
    <Modal open onClose={onClose} title={`Mark done — ${c.title}`} footer={<><button className="btn btn-ghost" onClick={onClose}>Cancel</button><button className="btn btn-primary" onClick={save}>Log completion</button></>}>
      {!!c.checklist?.length && <div style={{ marginBottom: 12 }}><strong style={{ fontSize: 13 }}>Checklist</strong>{c.checklist.map((t: string, i: number) => <label key={i} style={{ display: 'flex', gap: 8, fontSize: 13.5, padding: '4px 0' }}><input type="checkbox" checked={ticks[i]} onChange={(e) => setTicks((p) => p.map((x, j) => (j === i ? e.target.checked : x)))} /> {t}</label>)}</div>}
      <div className="grid-2">
        <div className="field"><label>Completed on</label><input className="input" type="date" max={toInputDate(new Date())} value={f.completedOn} onChange={(e) => setF({ ...f, completedOn: e.target.value })} /></div>
        <div className="field"><label>Evidence link{c.requireEvidence ? ' *' : ''}</label><input className="input" placeholder="https://… (signed report, ticket, screenshot)" value={f.evidenceUrl} onChange={(e) => setF({ ...f, evidenceUrl: e.target.value })} /></div>
      </div>
      <div className="field"><label>Note{c.requireEvidence ? ' (or evidence) *' : ''}</label><textarea className="input" rows={3} value={f.note} onChange={(e) => setF({ ...f, note: e.target.value })} placeholder="What was done, anything unusual. Never write the password itself here." /></div>
      <p className="text-muted" style={{ fontSize: 12.5 }}>Next due: {fdate(new Date(new Date(f.completedOn || Date.now()).getTime() + c.frequencyDays * 86400000))} (every {every(c.frequencyDays)}). Do not paste passwords here — store them in your password vault.</p>
    </Modal>
  );
}

function EditModal({ c, extra, onClose, onSaved }: { c: any | null; extra: any; onClose: () => void; onSaved: () => void }) {
  const { showError, showSuccess } = useToast();
  const [f, setF] = useState<any>(() => c ? { title: c.title, description: c.description || '', category: c.category, frequencyDays: String(c.frequencyDays), ownerPref: c.ownerPref, ownerId: c.ownerId || '', leadDays: (c.leadDays || []).join(', '), checklist: (c.checklist || []).join('\n'), requireEvidence: !!c.requireEvidence, nextDueAt: toInputDate(c.nextDueAt), isoRef: c.isoRef || '', policyRef: c.policyRef || '' }
    : { title: '', description: '', category: 'Governance', frequencyDays: '90', ownerPref: 'it', ownerId: '', leadDays: '14, 7, 3, 1', checklist: '', requireEvidence: false, nextDueAt: '', isoRef: '', policyRef: '' });
  const set = (k: string, v: any) => setF((p: any) => ({ ...p, [k]: v }));
  async function save() {
    const body = { ...f, frequencyDays: Number(f.frequencyDays), ownerId: f.ownerPref === 'user' ? f.ownerId : '', leadDays: f.leadDays.split(',').map((x: string) => Number(x.trim())).filter((x: number) => !isNaN(x)), checklist: f.checklist.split('\n').map((x: string) => x.trim()).filter(Boolean), nextDueAt: f.nextDueAt || undefined };
    try { if (c) await api.put(`/controls/${c._id}`, body); else await api.post('/controls', body); showSuccess('Saved.'); onSaved(); } catch (e) { showError(apiErrorMessage(e)); }
  }
  return (
    <Modal open onClose={onClose} title={c ? `Edit — ${c.title}` : 'New control'} size="wide" footer={<><button className="btn btn-ghost" onClick={onClose}>Cancel</button><button className="btn btn-primary" onClick={save}>Save</button></>}>
      <div className="grid-2">
        <div className="field"><label>Control title *</label><input className="input" disabled={!!c?.builtIn} value={f.title} onChange={(e) => set('title', e.target.value)} /></div>
        <div className="field"><label>Category</label><select className="input" value={f.category} onChange={(e) => set('category', e.target.value)}>{(extra?.categories || []).map((x: string) => <option key={x}>{x}</option>)}</select></div>
      </div>
      <div className="field"><label>How often? (days) *</label>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>{FREQ.map(([d, t]) => <button key={d} type="button" className={`chip ${Number(f.frequencyDays) === d ? 'active' : ''}`} onClick={() => set('frequencyDays', String(d))}>{t}</button>)}
          <input className="input" style={{ width: 110 }} type="number" min={1} max={1830} value={f.frequencyDays} onChange={(e) => set('frequencyDays', e.target.value)} /><span className="text-muted" style={{ fontSize: 12.5 }}>days</span></div></div>
      <div className="grid-2">
        <div className="field"><label>Who is responsible?</label><select className="input" value={f.ownerPref} onChange={(e) => set('ownerPref', e.target.value)}>{(extra?.ownerPrefs || []).map((p: string) => <option key={p} value={p}>{PREF_LABEL[p] || label(p)}</option>)}</select>
          <div className="text-muted" style={{ fontSize: 12 }}>If nobody fits, it automatically falls to the next person in the chain.</div></div>
        {f.ownerPref === 'user' && <div className="field"><label>Person</label><select className="input" value={f.ownerId} onChange={(e) => set('ownerId', e.target.value)}><option value="">Select…</option>{(extra?.people || []).map((p: any) => <option key={p.id} value={p.id}>{p.name}{p.jobTitle ? ` — ${p.jobTitle}` : ''}</option>)}</select></div>}
        <div className="field"><label>Next due date</label><input className="input" type="date" value={f.nextDueAt} onChange={(e) => set('nextDueAt', e.target.value)} /></div>
        <div className="field"><label>Remind this many days before (comma-separated)</label><input className="input" value={f.leadDays} onChange={(e) => set('leadDays', e.target.value)} /></div>
        <div className="field"><label>ISO 27001 / standard reference</label><input className="input" value={f.isoRef} onChange={(e) => set('isoRef', e.target.value)} placeholder="e.g. A.5.17" /></div>
        <div className="field"><label>Policy</label><input className="input" value={f.policyRef} onChange={(e) => set('policyRef', e.target.value)} placeholder="e.g. Password Policy" /></div>
      </div>
      <div className="field"><label>Description</label><textarea className="input" rows={2} value={f.description} onChange={(e) => set('description', e.target.value)} /></div>
      <div className="field"><label>Checklist (one step per line)</label><textarea className="input" rows={5} value={f.checklist} onChange={(e) => set('checklist', e.target.value)} /></div>
      <label style={{ fontSize: 13.5 }}><input type="checkbox" checked={f.requireEvidence} onChange={(e) => set('requireEvidence', e.target.checked)} /> Require evidence (note or document link) when marking done</label>
    </Modal>
  );
}
