import { RecordPanel } from '@/components/record/RecordPanel';
import { useEffect, useMemo, useState } from 'react';
import { Award, CheckCircle2, Plus, X } from 'lucide-react';
import { api, apiErrorMessage } from '@/lib/api';
import { useApi } from '@/lib/useApi';
import { useAuth } from '@/context/AuthContext';
import { useToast } from '@/context/ToastContext';
import { useConfirm } from '@/context/ConfirmContext';
import { useQuickCreate } from '@/lib/useQuickCreate';
import { fdate, fdatetime, filenameFrom, label, saveBlob, toInputDate } from '@/lib/format';
import { quarterOf } from '@/lib/quarter';
import { Badge, statusTone } from '@/components/ui/Badge';
import { RichTextEditor, RichTextRenderer } from '@/components/ui/RichText';
import { Modal } from '@/components/ui/Modal';
import { Pagination } from '@/components/ui/Pagination';
import { Empty, ErrorNote, Loading, PageHead, Tabs } from '@/components/ui/PageHead';
import { QuarterFilter } from '@/components/work/QuarterFilter';
import { RowActions } from '@/components/work/RowActions';
import { PeoplePicker } from '@/components/work/PeoplePicker';
import { EvidencePanel } from '@/components/work/EvidencePanel';
import { quarterOptions } from '@/lib/quarter';
import { ExportButton } from '@/components/ui/ExportButton';

const idOf = (v: any) => (v && typeof v === 'object' ? String(v._id || '') : v ? String(v) : '');
const nm = (v: any) => (v && typeof v === 'object' ? v.name || v.title : undefined);
const LEVELS = ['company', 'department', 'team', 'employee'];

function Bar({ pct }: { pct: number }) { return <div className="progress"><span style={{ width: `${Math.min(100, Math.max(0, pct))}%` }} /></div>; }

/* --------------------------------- create / edit -------------------------------- */
function GoalForm({ open, goal, onClose, onSaved }: { open: boolean; goal: any | null; onClose: () => void; onSaved: () => void }) {
  const { user } = useAuth();
  const { showError, showSuccess } = useToast();
  const editing = !!goal;
  const [raw, setF] = useState<any>({});
  const f = useMemo(() => ({ title: '', level: 'employee', department: '', ownerId: '', parentGoalId: '', quarter: '', startDate: '', endDate: '', description: '', ...raw }), [raw]);
  const [krs, setKrs] = useState<any[]>([]);
  const [parents, setParents] = useState<any[]>([]);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (!open) return;
    api.get('/goals', { params: { limit: 100 } }).then((r) => setParents(r.data.data)).catch(() => undefined);
    if (goal) {
      setF({ title: goal.title, level: goal.level, department: goal.department || '', ownerId: idOf(goal.ownerId), parentGoalId: idOf(goal.parentGoalId), quarter: goal.quarter || '', startDate: toInputDate(goal.startDate), endDate: toInputDate(goal.endDate), description: goal.description || '' });
      setKrs((goal.keyResults || []).map((k: any) => ({ _id: k._id, description: k.description, targetValue: k.targetValue, currentValue: k.currentValue, unit: k.unit })));
    } else { setF({ title: '', level: 'employee', department: '', ownerId: user?.id || '', parentGoalId: '', quarter: quarterOf(), startDate: '', endDate: '', description: '' }); setKrs([]); }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, goal]);
  const set = (k: string, v: any) => setF((x: any) => ({ ...x, [k]: v }));
  const dateBad = f.startDate && f.endDate && f.endDate < f.startDate;
  async function save() {
    setBusy(true);
    try {
      const body: any = { title: f.title.trim(), level: f.level, department: f.department || undefined, ownerId: f.ownerId || undefined, parentGoalId: f.parentGoalId || undefined, quarter: f.quarter || undefined, startDate: f.startDate || undefined, endDate: f.endDate || undefined, description: f.description || undefined,
        keyResults: krs.filter((k) => k.description.trim()).map((k) => ({ _id: k._id, description: k.description.trim(), targetValue: Number(k.targetValue) || 100, unit: k.unit || '%' })) };
      if (editing) await api.patch(`/goals/${goal._id}`, body); else await api.post('/goals', body);
      showSuccess(editing ? 'Goal updated.' : 'Goal created.'); onClose(); onSaved();
    } catch (err) { showError(apiErrorMessage(err)); } finally { setBusy(false); }
  }
  return (
    <Modal open={open} onClose={onClose} size="wide" title={editing ? 'Edit goal' : 'New goal'} footer={<><button className="btn btn-ghost" onClick={onClose}>Cancel</button><button className="btn btn-primary" disabled={busy || !f.title?.trim() || !!dateBad} onClick={save}>{busy ? 'Saving…' : 'Save'}</button></>}>
      <div className="form-grid">
        <div className="field full"><label>Goal title *</label><input className="input" value={f.title || ''} onChange={(e) => set('title', e.target.value)} autoFocus /></div>
        <div className="field"><label>Level</label><select className="input" value={f.level} onChange={(e) => set('level', e.target.value)}>{LEVELS.map((l) => <option key={l} value={l}>{label(l)}</option>)}</select></div>
        <div className="field"><label>Quarter</label><select className="input" value={f.quarter || ''} onChange={(e) => set('quarter', e.target.value)}><option value="">No quarter</option>{quarterOptions().map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}</select></div>
        <div className="field"><label>Start date</label><input className="input" type="date" value={f.startDate || ''} onChange={(e) => set('startDate', e.target.value)} /></div>
        <div className="field"><label>End date</label><input className="input" type="date" min={f.startDate || undefined} value={f.endDate || ''} onChange={(e) => set('endDate', e.target.value)} />{dateBad && <small style={{ color: '#e5484d' }}>End date is before the start date.</small>}</div>
        <div className="field full"><label>Parent goal (what this contributes to)</label><select className="input" value={f.parentGoalId || ''} onChange={(e) => set('parentGoalId', e.target.value)}><option value="">None</option>{parents.filter((p) => p._id !== goal?._id).map((p) => <option key={p._id} value={p._id}>{p.title}</option>)}</select></div>
        <div className="field full"><label>Owner — the only person who can update progress</label><PeoplePicker single value={f.ownerId ? [f.ownerId] : []} onChange={(ids) => set('ownerId', ids[0] || '')} /></div>
        <div className="field full"><label>Description</label><RichTextEditor value={f.description || ''} onChange={(h) => set('description', h)} minHeight={90} compact /></div>
        <div className="field full">
          <label>Key results (measurable)</label>
          {krs.map((k, i) => (
            <div key={i} className="row-gap" style={{ marginBottom: 6 }}>
              <input className="input" style={{ flex: 1, minWidth: 180 }} placeholder="What will be measured" value={k.description} onChange={(e) => setKrs(krs.map((x, j) => (j === i ? { ...x, description: e.target.value } : x)))} />
              <input className="input" style={{ width: 90 }} type="number" min={0} value={k.targetValue ?? 100} onChange={(e) => setKrs(krs.map((x, j) => (j === i ? { ...x, targetValue: e.target.value } : x)))} aria-label="Target" />
              <input className="input" style={{ width: 70 }} value={k.unit ?? '%'} onChange={(e) => setKrs(krs.map((x, j) => (j === i ? { ...x, unit: e.target.value } : x)))} aria-label="Unit" />
              <button type="button" className="icon-btn" aria-label="Remove" onClick={() => setKrs(krs.filter((_, j) => j !== i))}><X size={15} /></button>
            </div>
          ))}
          <button type="button" className="btn btn-ghost btn-sm" onClick={() => setKrs([...krs, { description: '', targetValue: 100, unit: '%' }])}><Plus size={14} /> Add key result</button>
        </div>
      </div>
    </Modal>
  );
}

/* ------------------------------------ detail ------------------------------------ */
function GoalDetail({ id, onClose, onChanged }: { id: string; onClose: () => void; onChanged: () => void }) {
  const { showError, showSuccess } = useToast();
  const { data: g, loading, error, reload } = useApi<any>(`/goals/${id}`);
  const [progress, setProgress] = useState<number | null>(null);
  const [krVals, setKrVals] = useState<Record<string, number>>({});
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [completing, setCompleting] = useState(false);
  useEffect(() => { if (g) { setProgress(g.progressPercent || 0); setKrVals(Object.fromEntries((g.keyResults || []).map((k: any) => [k._id, k.currentValue || 0]))); } }, [g]);
  const done = () => { reload(); onChanged(); };

  async function saveProgress() {
    setBusy(true);
    try {
      const hasKr = (g.keyResults || []).length > 0;
      const body: any = hasKr ? { keyResults: g.keyResults.map((k: any) => ({ _id: k._id, description: k.description, targetValue: k.targetValue, unit: k.unit, currentValue: Number(krVals[k._id]) || 0 })) } : { progressPercent: Number(progress) || 0 };
      if (note.trim()) body.completionNote = note.trim();
      await api.patch(`/goals/${id}`, body); showSuccess('Progress saved.'); setNote(''); done();
    } catch (err) { showError(apiErrorMessage(err)); } finally { setBusy(false); }
  }
  async function complete() {
    setBusy(true);
    try { await api.patch(`/goals/${id}`, { status: 'completed', completionNote: note.trim() || undefined }); showSuccess('Marked as completed — waiting for verification.'); setCompleting(false); setNote(''); done(); } catch (err) { showError(apiErrorMessage(err)); } finally { setBusy(false); }
  }
  async function verify() {
    setBusy(true);
    try { await api.post(`/goals/${id}/verify`, {}); showSuccess('Verified — certificate issued.'); done(); } catch (err) { showError(apiErrorMessage(err)); } finally { setBusy(false); }
  }
  async function certificate() {
    try { const res = await api.get(`/goals/${id}/certificate`, { responseType: 'blob' }); saveBlob(res.data, filenameFrom(res.headers['content-disposition'], 'goal-certificate.pdf')); } catch (err) { showError(apiErrorMessage(err)); }
  }

  const p = g?.permissions || {};
  const completed = g?.status === 'completed';
  return (
    <Modal open onClose={onClose} size="xwide" title={g ? `Goal — ${g.title}` : 'Goal'}>
      {loading && !g ? <Loading /> : error ? <ErrorNote message={error} /> : g && (
        <div className="stack">
          <div className="row-gap"><Badge tone="neutral">{label(g.level)}</Badge>{g.quarter && <Badge tone="accent">{g.quarter}</Badge>}<Badge tone={statusTone(g.status)}>{label(g.status)}</Badge>{g.verifiedAt && <Badge tone="success"><Award size={11} /> Verified</Badge>}
            <span className="text-muted" style={{ fontSize: 13 }}>Owner {nm(g.ownerId) || '—'} · {fdate(g.startDate)} → {fdate(g.endDate)}</span></div>
          {g.description && <RichTextRenderer content={g.description} />}
          <div><div className="flex-between" style={{ fontSize: 13, marginBottom: 4 }}><span>Progress</span><strong>{g.progressPercent || 0}%</strong></div><Bar pct={g.progressPercent || 0} /></div>

          {(g.keyResults || []).length > 0 && (
            <div className="card"><h3 style={{ fontSize: 15, marginBottom: 10 }}>Key results</h3>
              {g.keyResults.map((k: any) => (
                <div key={k._id} className="crit-row" style={{ flexWrap: 'wrap' }}>
                  <span style={{ flex: 1, minWidth: 200 }}>{k.description}</span>
                  {p.updateProgress && !completed ? <span className="row-gap"><input className="input" style={{ width: 90 }} type="number" min={0} value={krVals[k._id] ?? 0} onChange={(e) => setKrVals({ ...krVals, [k._id]: Number(e.target.value) })} /><span className="text-muted">/ {k.targetValue} {k.unit}</span></span> : <span className="text-muted">{k.currentValue || 0} / {k.targetValue} {k.unit}</span>}
                </div>))}
            </div>
          )}

          {p.updateProgress && !completed ? (
            <div className="card"><h3 style={{ fontSize: 15, marginBottom: 10 }}>Update progress <span className="text-muted" style={{ fontWeight: 400, fontSize: 12.5 }}>— only you, as the owner, can do this</span></h3>
              {(g.keyResults || []).length === 0 && (<div className="row-gap" style={{ marginBottom: 10 }}><input type="range" min={0} max={100} value={progress ?? 0} onChange={(e) => setProgress(Number(e.target.value))} style={{ flex: 1 }} /><strong style={{ width: 48, textAlign: 'right' }}>{progress ?? 0}%</strong></div>)}
              <textarea className="input" rows={2} placeholder="What moved? (optional note)" value={note} onChange={(e) => setNote(e.target.value)} />
              <div className="row-gap" style={{ marginTop: 10 }}><button className="btn btn-primary btn-sm" disabled={busy} onClick={saveProgress}>Save progress</button>
                <button className="btn btn-ghost btn-sm" disabled={busy || !(g.evidence || []).length} onClick={() => setCompleting(true)} title={!(g.evidence || []).length ? 'Attach evidence first' : undefined}><CheckCircle2 size={14} /> Mark as achieved</button>
                {!(g.evidence || []).length && <span className="text-muted" style={{ fontSize: 12.5 }}>Attach evidence below before marking the goal achieved.</span>}</div>
            </div>
          ) : !completed && <div className="callout">Only the goal owner ({nm(g.ownerId)}) can update progress.</div>}

          <div className="card"><h3 style={{ fontSize: 15, marginBottom: 10 }}>Evidence of achievement ({(g.evidence || []).length})</h3>
            <EvidencePanel baseUrl={`/goals/${id}`} items={g.evidence || []} canAdd={!!p.updateProgress} canRemove={!!p.updateProgress} locked={!!g.verifiedAt} onChanged={done} hint="Attach proof — reports, screenshots, sign-offs — that the goal was achieved." /></div>

          {completed && (
            <div className={`callout ${g.verifiedAt ? 'ok' : 'warn'}`}>
              {g.verifiedAt ? <><strong>Verified</strong> · {fdatetime(g.verifiedAt)} · Certificate {g.certificateNo}<div style={{ marginTop: 8 }}><button className="btn btn-ghost btn-sm" onClick={certificate}><Award size={14} /> Download certificate</button></div></>
                : <><strong>Achieved by the owner — waiting for verification</strong>{g.completionNote && <div style={{ marginTop: 4 }}>{g.completionNote}</div>}{p.verify && <div style={{ marginTop: 8 }}><button className="btn btn-primary btn-sm" disabled={busy} onClick={verify}><CheckCircle2 size={14} /> Verify & issue certificate</button></div>}</>}
            </div>
          )}

          {(g.progressLog || []).length > 0 && (<div><h4 style={{ marginBottom: 6 }}>Progress history</h4>{[...g.progressLog].reverse().slice(0, 10).map((l: any, i: number) => (<div key={i} style={{ fontSize: 13 }}><strong>{l.value}%</strong> · {fdatetime(l.at)}{l.note ? ` — ${l.note}` : ''}</div>))}</div>)}
          <RecordPanel entityType="goal" entityId={id} doc={g} kinds={['other']} />
        </div>
      )}
      <Modal open={completing} onClose={() => setCompleting(false)} title="Mark goal as achieved" footer={<><button className="btn btn-ghost" onClick={() => setCompleting(false)}>Cancel</button><button className="btn btn-primary" disabled={busy} onClick={complete}>Mark achieved</button></>}>
        <div className="field"><label>How was it achieved? (completion note)</label><textarea className="input" rows={4} value={note} onChange={(e) => setNote(e.target.value)} /></div>
      </Modal>
    </Modal>
  );
}

/* ------------------------------------- page ------------------------------------- */
export function Goals() {
  const { showError, showSuccess } = useToast();
  const confirm = useConfirm();
  const [tab, setTab] = useState<'all' | 'mine'>('all');
  const [quarter, setQuarter] = useState('');
  const [level, setLevel] = useState('');
  const [status, setStatus] = useState('');
  const [page, setPage] = useState(1);
  const [form, setForm] = useState<null | { goal: any | null }>(null);
  const [open, setOpen] = useState<string | null>(null);
  const { user } = useAuth();
  const params = useMemo(() => ({ page, limit: 24, ...(quarter ? { quarter } : {}), ...(level ? { level } : {}), ...(status ? { status } : {}), ...(tab === 'mine' ? { ownerId: user?.id } : {}) }), [page, quarter, level, status, tab, user?.id]);
  const { data, extra, loading, error, reload } = useApi<any[]>('/goals', params);
  useQuickCreate(() => setForm({ goal: null }));
  const pg = extra?.pagination;

  async function remove(g: any) {
    if (!(await confirm({ title: 'Delete goal', message: `Delete “${g.title}”?`, confirmLabel: 'Delete', danger: true }))) return;
    try { await api.delete(`/goals/${g._id}`); showSuccess('Goal deleted.'); reload(); } catch (err) { showError(apiErrorMessage(err)); }
  }

  return (
    <div>
      <PageHead title="Goals & OKRs" subtitle="Quarterly goals that cascade from the company to each person. Only the owner moves a goal’s progress, and achieving it needs evidence." actions={<><ExportButton endpoint="/goals" params={params} filename="goals" columns={[{ label: 'Goal', value: (r) => r.title }, { label: 'Level', value: (r) => r.level }, { label: 'Quarter', value: (r) => r.quarter }, { label: 'Status', value: (r) => r.status }, { label: 'Owner', value: (r) => r.ownerId?.name }, { label: 'Progress %', value: (r) => r.progressPercent }]} /><button className="btn btn-primary" onClick={() => setForm({ goal: null })}><Plus size={16} /> New goal</button></>} />
      <Tabs value={tab} onChange={(k) => { setTab(k as any); setPage(1); }} tabs={[{ key: 'all', label: 'All goals' }, { key: 'mine', label: 'My goals' }]} />
      <div className="filter-bar" style={{ marginTop: 16 }}>
        <QuarterFilter value={quarter} onChange={(v) => { setQuarter(v); setPage(1); }} />
        <select className="input" value={level} onChange={(e) => { setLevel(e.target.value); setPage(1); }}><option value="">Any level</option>{LEVELS.map((l) => <option key={l} value={l}>{label(l)}</option>)}</select>
        <select className="input" value={status} onChange={(e) => { setStatus(e.target.value); setPage(1); }}><option value="">Any status</option>{['not_started', 'on_track', 'at_risk', 'completed'].map((s) => <option key={s} value={s}>{label(s)}</option>)}</select>
      </div>
      <ErrorNote message={error} />
      {loading && !data ? <Loading /> : !data?.length ? <Empty title="No goals match" hint="Set one for this quarter." /> : (
        <div className="grid-3">
          {data.map((g) => (
            <div key={g._id} className="card card-hover" style={{ cursor: 'pointer' }} onClick={() => setOpen(g._id)}>
              <div className="flex-between" style={{ marginBottom: 10 }}><div className="row-gap"><Badge tone="neutral">{label(g.level)}</Badge>{g.quarter && <Badge tone="accent">{g.quarter}</Badge>}</div>
                <span onClick={(e) => e.stopPropagation()}><RowActions permissions={g.permissions} onView={() => setOpen(g._id)} onEdit={() => setForm({ goal: g })} onDelete={() => remove(g)} /></span></div>
              <h3 style={{ fontSize: 15.5, marginBottom: 6 }}>{g.title}</h3>
              <div className="text-muted" style={{ fontSize: 12.5, marginBottom: 10 }}>{nm(g.ownerId) || '—'} · {fdate(g.startDate)} → {fdate(g.endDate)}</div>
              <Bar pct={g.progressPercent || 0} />
              <div className="flex-between" style={{ marginTop: 8, fontSize: 12.5 }}><Badge tone={statusTone(g.status)}>{label(g.status)}</Badge><span>{g.progressPercent || 0}%{g.verifiedAt ? ' · verified' : ''}</span></div>
            </div>))}
        </div>
      )}
      {pg && <Pagination page={pg.page} pages={pg.pages} total={pg.total} onChange={setPage} />}
      <GoalForm open={!!form} goal={form?.goal || null} onClose={() => setForm(null)} onSaved={reload} />
      {open && <GoalDetail id={open} onClose={() => setOpen(null)} onChanged={reload} />}
    </div>
  );
}
