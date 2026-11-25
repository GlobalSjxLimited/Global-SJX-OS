import { RecordPanel } from '@/components/record/RecordPanel';
import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { Plus, Search } from 'lucide-react';
import { api, apiErrorMessage } from '@/lib/api';
import { useApi } from '@/lib/useApi';
import { useAuth } from '@/context/AuthContext';
import { useToast } from '@/context/ToastContext';
import { useConfirm } from '@/context/ConfirmContext';
import { useQuickCreate } from '@/lib/useQuickCreate';
import { fdate, label, toInputDate } from '@/lib/format';
import { Badge, statusTone } from '@/components/ui/Badge';
import { RichTextEditor, RichTextRenderer } from '@/components/ui/RichText';
import { Modal } from '@/components/ui/Modal';
import { Pagination } from '@/components/ui/Pagination';
import { Empty, ErrorNote, Kv, PageHead } from '@/components/ui/PageHead';
import { TableSkeleton } from '@/components/ui/Feedback';
import { QuarterFilter } from '@/components/work/QuarterFilter';
import { RowActions } from '@/components/work/RowActions';
import { PeoplePicker } from '@/components/work/PeoplePicker';
import { RISK_SEVERITY_OPTIONS } from '@/components/work/SeverityBadge';
import { ExportButton } from '@/components/ui/ExportButton';

const CATEGORIES = ['project', 'financial', 'operational', 'security', 'compliance', 'reputational'];
const idOf = (v: any) => (v && typeof v === 'object' ? String(v._id || '') : v ? String(v) : '');
const nm = (v: any) => (v && typeof v === 'object' ? v.name || v.title : undefined);

function RiskModal({ open, risk, mode, onClose, onSaved, onEdit }: { open: boolean; risk: any | null; mode: 'view' | 'edit'; onClose: () => void; onSaved: () => void; onEdit: () => void }) {
  const { user } = useAuth();
  const { showError, showSuccess } = useToast();
  const editing = !!risk;
  const [raw, setF] = useState<any>({});
  const f = useMemo(() => ({ title: '', kind: 'risk', category: 'project', severity: 'medium', impact: 'medium', blocking: false, status: 'open', ownerId: '', relatedProjectId: '', relatedMilestoneId: '', relatedTaskId: '', startDate: '', endDate: '', description: '', mitigationPlan: '', ...raw }), [raw]);
  const [projects, setProjects] = useState<any[]>([]);
  const [milestones, setMilestones] = useState<any[]>([]);
  const [tasks, setTasks] = useState<any[]>([]);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!open) return;
    api.get('/projects').then((r) => setProjects(r.data.data)).catch(() => undefined);
    setF(risk ? {
      title: risk.title, kind: risk.kind || 'risk', category: risk.category || 'project', severity: risk.severity || 'medium', impact: risk.impact || 'medium', blocking: !!risk.blocking, status: risk.status || 'open',
      ownerId: idOf(risk.ownerId), relatedProjectId: idOf(risk.relatedProjectId), relatedMilestoneId: idOf(risk.relatedMilestoneId), relatedTaskId: idOf(risk.relatedTaskId),
      startDate: toInputDate(risk.startDate), endDate: toInputDate(risk.endDate), description: risk.description || '', mitigationPlan: risk.mitigationPlan || '',
    } : { title: '', kind: 'risk', category: 'project', severity: 'medium', impact: 'medium', blocking: false, status: 'open', ownerId: user?.id || '', relatedProjectId: '', relatedMilestoneId: '', relatedTaskId: '', startDate: '', endDate: '', description: '', mitigationPlan: '' });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, risk]);

  useEffect(() => {
    const pid = f.relatedProjectId;
    if (!open || !pid) { setMilestones([]); setTasks([]); return; }
    api.get(`/projects/${pid}`).then((r) => { setMilestones(r.data.data.project?.milestones || []); setTasks(r.data.data.tasks || []); }).catch(() => undefined);
  }, [open, f.relatedProjectId]);

  const set = (k: string, v: any) => setF((x: any) => ({ ...x, [k]: v }));
  const view = mode === 'view' && editing;
  const dateBad = f.startDate && f.endDate && f.endDate < f.startDate;
  const taskChoices = f.relatedMilestoneId ? tasks.filter((t: any) => idOf(t.milestoneId) === f.relatedMilestoneId) : tasks;

  async function save() {
    setBusy(true);
    try {
      const body: any = { ...f, blocking: f.kind === 'blocker' ? true : f.blocking, ownerId: f.ownerId || undefined, startDate: f.startDate || undefined, endDate: f.endDate || undefined,
        relatedProjectId: f.relatedProjectId || undefined, relatedMilestoneId: f.relatedMilestoneId || undefined, relatedTaskId: f.relatedTaskId || undefined };
      if (editing) await api.patch(`/risks/${risk._id}`, body); else await api.post('/risks', body);
      showSuccess(editing ? 'Risk updated.' : 'Risk logged.'); onClose(); onSaved();
    } catch (err) { showError(apiErrorMessage(err)); } finally { setBusy(false); }
  }

  if (view) {
    return (
      <Modal open={open} onClose={onClose} size="wide" title="Risk" footer={<><button className="btn btn-ghost" onClick={onClose}>Close</button>{risk.permissions?.edit && <button className="btn btn-primary" onClick={onEdit}>Edit</button>}</>}>
        <h3 style={{ marginBottom: 10 }}>{risk.title}</h3>
        <Kv rows={[['Type', label(risk.kind)], ['Category', label(risk.category)], ['Severity', <span key="s" className={`sev sev-${risk.severity}`}>{label(risk.severity)}</span>], ['Impact', <span key="i" className={`sev sev-${risk.impact}`}>{label(risk.impact)}</span>],
          ['Halting work', risk.blocking ? 'Yes' : 'No'], ['Status', label(risk.status)], ['Owner', nm(risk.ownerId)], ['Project', nm(risk.relatedProjectId)], ['Task', nm(risk.relatedTaskId)], ['Start date', fdate(risk.startDate)], ['End date', fdate(risk.endDate)]]} />
        {risk.description && <><h4 style={{ margin: '14px 0 6px' }}>What is happening</h4><RichTextRenderer content={risk.description} /></>}
        {risk.mitigationPlan && <><h4 style={{ margin: '14px 0 6px' }}>Mitigation</h4><RichTextRenderer content={risk.mitigationPlan} /></>}
        <RecordPanel entityType="risk" entityId={risk._id} doc={risk} kinds={['other']} />
      </Modal>
    );
  }

  return (
    <Modal open={open} onClose={onClose} size="wide" title={editing ? 'Edit risk' : 'New risk'}
      footer={<><button className="btn btn-ghost" onClick={onClose}>Cancel</button><button className="btn btn-primary" disabled={busy || !f.title?.trim() || !!dateBad} onClick={save}>{busy ? 'Saving…' : 'Save'}</button></>}>
      <div className="form-grid">
        <div className="field full"><label>Risk title *</label><input className="input" value={f.title || ''} onChange={(e) => set('title', e.target.value)} autoFocus /></div>
        <div className="field"><label>Type</label><select className="input" value={f.kind} onChange={(e) => set('kind', e.target.value)}><option value="risk">Risk</option><option value="blocker">Blocker</option><option value="issue">Issue</option></select></div>
        <div className="field"><label>Category</label><select className="input" value={f.category} onChange={(e) => set('category', e.target.value)}>{CATEGORIES.map((c) => <option key={c} value={c}>{label(c)}</option>)}</select></div>
        <div className="field"><label>Severity</label><select className="input" value={f.severity} onChange={(e) => set('severity', e.target.value)}>{RISK_SEVERITY_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}</select></div>
        <div className="field"><label>Impact</label><select className="input" value={f.impact} onChange={(e) => set('impact', e.target.value)}>{RISK_SEVERITY_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}</select></div>
        <div className="field"><label>Status</label><select className="input" value={f.status} onChange={(e) => set('status', e.target.value)}>{['open', 'mitigating', 'closed'].map((o) => <option key={o} value={o}>{label(o)}</option>)}</select></div>
        <div className="field"><label style={{ display: 'flex', gap: 8, alignItems: 'center', marginTop: 28 }}><input type="checkbox" checked={f.blocking || f.kind === 'blocker'} disabled={f.kind === 'blocker'} onChange={(e) => set('blocking', e.target.checked)} /> Halting the linked work</label></div>
        <div className="field"><label>Start date</label><input className="input" type="date" value={f.startDate || ''} onChange={(e) => set('startDate', e.target.value)} /></div>
        <div className="field"><label>End date</label><input className="input" type="date" min={f.startDate || undefined} value={f.endDate || ''} onChange={(e) => set('endDate', e.target.value)} /></div>
        <div className="field"><label>Project</label><select className="input" value={f.relatedProjectId || ''} onChange={(e) => setF((x: any) => ({ ...x, relatedProjectId: e.target.value, relatedMilestoneId: '', relatedTaskId: '' }))}><option value="">Not tied to a project</option>{projects.map((p) => <option key={p._id} value={p._id}>{p.name}</option>)}</select></div>
        <div className="field"><label>Milestone</label><select className="input" disabled={!f.relatedProjectId} value={f.relatedMilestoneId || ''} onChange={(e) => setF((x: any) => ({ ...x, relatedMilestoneId: e.target.value, relatedTaskId: '' }))}><option value="">None</option>{milestones.map((m: any) => <option key={m._id} value={m._id}>{m.title}</option>)}</select></div>
        <div className="field full"><label>Task</label><select className="input" disabled={!f.relatedProjectId} value={f.relatedTaskId || ''} onChange={(e) => set('relatedTaskId', e.target.value)}><option value="">None</option>{taskChoices.map((t: any) => <option key={t._id} value={t._id}>{t.title}</option>)}</select></div>
        <div className="field full"><label>Owner</label><PeoplePicker single value={f.ownerId ? [f.ownerId] : []} onChange={(ids) => set('ownerId', ids[0] || '')} /></div>
        <div className="field full"><label>What is happening?</label><RichTextEditor value={f.description || ''} onChange={(h) => set('description', h)} minHeight={90} compact /></div>
        <div className="field full"><label>Mitigation plan</label><RichTextEditor value={f.mitigationPlan || ''} onChange={(h) => set('mitigationPlan', h)} minHeight={90} compact /></div>
      </div>
    </Modal>
  );
}

export function Risks() {
  const { showError, showSuccess } = useToast();
  const confirm = useConfirm();
  const [page, setPage] = useState(1);
  const [q, setQ] = useState('');
  const [debounced, setDebounced] = useState('');
  const [quarter, setQuarter] = useState('');
  const [severity, setSeverity] = useState('');
  const [kind, setKind] = useState('');
  const [status, setStatus] = useState('');
  const [blockingOnly, setBlockingOnly] = useState(false);
  const [modal, setModal] = useState<null | { risk: any | null; mode: 'view' | 'edit' }>(null);
  useEffect(() => { const t = setTimeout(() => { setDebounced(q); setPage(1); }, 250); return () => clearTimeout(t); }, [q]);
  const params = useMemo(() => ({ page, limit: 20, ...(debounced ? { q: debounced } : {}), ...(quarter ? { quarter } : {}), ...(severity ? { severity } : {}), ...(kind ? { kind } : {}), ...(status ? { status } : {}), ...(blockingOnly ? { blocking: 'true' } : {}) }), [page, debounced, quarter, severity, kind, status, blockingOnly]);
  const { data, extra, loading, error, reload } = useApi<any[]>('/risks', params);
  useQuickCreate(() => setModal({ risk: null, mode: 'edit' }));
  const pg = extra?.pagination;

  async function remove(r: any) {
    if (!(await confirm({ title: 'Delete risk', message: `Delete “${r.title}”?`, confirmLabel: 'Delete', danger: true }))) return;
    try { await api.delete(`/risks/${r._id}`); showSuccess('Risk deleted.'); reload(); } catch (err) { showError(apiErrorMessage(err)); }
  }

  return (
    <div>
      <PageHead title="Risks" subtitle="Risks, blockers and issues — on projects, milestones and tasks, or across the business." actions={<><ExportButton endpoint="/risks" params={params} filename="risks" columns={[{ label: 'Title', value: (r) => r.title }, { label: 'Type', value: (r) => r.kind }, { label: 'Severity', value: (r) => r.severity }, { label: 'Status', value: (r) => r.status }, { label: 'Owner', value: (r) => r.ownerId?.name }, { label: 'Project', value: (r) => r.relatedProjectId?.name }, { label: 'Blocking', value: (r) => (r.blocking ? 'Yes' : 'No') }]} /><button className="btn btn-primary" onClick={() => setModal({ risk: null, mode: 'edit' })}><Plus size={16} /> New risk</button></>} />
      <div className="filter-bar">
        <div className="grow" style={{ position: 'relative' }}><Search size={15} style={{ position: 'absolute', left: 12, top: 12, color: 'var(--muted-2)' }} /><input className="input" style={{ paddingLeft: 34, width: '100%' }} placeholder="Search risks…" value={q} onChange={(e) => setQ(e.target.value)} /></div>
        <QuarterFilter value={quarter} onChange={(v) => { setQuarter(v); setPage(1); }} />
        <select className="input" value={severity} onChange={(e) => { setSeverity(e.target.value); setPage(1); }}><option value="">Any severity</option>{RISK_SEVERITY_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}</select>
        <select className="input" value={kind} onChange={(e) => { setKind(e.target.value); setPage(1); }}><option value="">All types</option><option value="risk">Risks</option><option value="blocker">Blockers</option><option value="issue">Issues</option></select>
        <select className="input" value={status} onChange={(e) => { setStatus(e.target.value); setPage(1); }}><option value="">Any status</option>{['open', 'mitigating', 'closed'].map((s) => <option key={s} value={s}>{label(s)}</option>)}</select>
        <label style={{ display: 'inline-flex', gap: 6, alignItems: 'center', fontSize: 13 }}><input type="checkbox" checked={blockingOnly} onChange={(e) => { setBlockingOnly(e.target.checked); setPage(1); }} /> Halting work only</label>
      </div>
      <ErrorNote message={error} />
      {loading && !data ? <TableSkeleton /> : !data?.length ? <Empty title="No risks match" hint="Try another quarter, or log a new one." /> : (
        <div className="table-wrap"><table className="table">
          <thead><tr><th>Risk title</th><th>Type</th><th>Applies to</th><th>Severity</th><th>Impact</th><th>Owner</th><th>Status</th><th style={{ width: 44 }} /></tr></thead>
          <tbody>{data.map((r) => (
            <tr key={r._id} style={{ cursor: 'pointer' }} onClick={() => setModal({ risk: r, mode: 'view' })}>
              <td style={{ maxWidth: 320 }}><strong>{r.title}</strong>{r.blocking && r.status !== 'closed' && <> <Badge tone="danger">Halting</Badge></>}</td>
              <td>{label(r.kind || 'risk')}</td>
              <td>{r.relatedTaskId ? <Link to={`/tasks/${idOf(r.relatedTaskId)}`} onClick={(e) => e.stopPropagation()}>Task: {nm(r.relatedTaskId)}</Link> : r.relatedProjectId ? <Link to={`/projects/${idOf(r.relatedProjectId)}`} onClick={(e) => e.stopPropagation()}>{r.relatedMilestoneId ? 'Milestone in ' : 'Project: '}{nm(r.relatedProjectId)}</Link> : <span className="text-muted">General</span>}</td>
              <td><span className={`sev sev-${r.severity}`}>{label(r.severity)}</span></td>
              <td><span className={`sev sev-${r.impact}`}>{label(r.impact)}</span></td>
              <td>{nm(r.ownerId) || '—'}</td>
              <td><Badge tone={statusTone(r.status)}>{label(r.status)}</Badge></td>
              <td onClick={(e) => e.stopPropagation()}><RowActions permissions={r.permissions} onView={() => setModal({ risk: r, mode: 'view' })} onEdit={() => setModal({ risk: r, mode: 'edit' })} onDelete={() => remove(r)} /></td>
            </tr>))}</tbody></table></div>
      )}
      {pg && <Pagination page={pg.page} pages={pg.pages} total={pg.total} onChange={setPage} />}
      <RiskModal open={!!modal} risk={modal?.risk || null} mode={modal?.mode || 'edit'} onClose={() => setModal(null)} onSaved={reload} onEdit={() => setModal((m) => (m ? { ...m, mode: 'edit' } : m))} />
    </div>
  );
}
