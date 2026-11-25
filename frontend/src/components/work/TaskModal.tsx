import { useEffect, useMemo, useState } from 'react';
import { Plus, X } from 'lucide-react';
import { api, apiErrorMessage } from '@/lib/api';
import { useToast } from '@/context/ToastContext';
import { Modal } from '@/components/ui/Modal';
import { RichTextEditor } from '@/components/ui/RichText';
import { toInputDate } from '@/lib/format';
import { PeoplePicker } from './PeoplePicker';
import { SEVERITY_OPTIONS } from './SeverityBadge';
import './work.css';

const SEV_NEEDS_EVIDENCE = ['major', 'critical', 'show_stopper'];

interface Props {
  open: boolean;
  onClose: () => void;
  onSaved: (task?: any) => void;
  /** Present when editing. */
  task?: any | null;
  /** Prefill for creating. */
  defaults?: { projectId?: string; milestoneId?: string; parentTaskId?: string; parentTitle?: string; ownerId?: string };
  /** What a plain assignee may change when editing (everything else is hidden). */
  limited?: boolean;
}

const idOf = (v: any) => (v && typeof v === 'object' ? String(v._id || '') : v ? String(v) : '');

export function TaskModal({ open, onClose, onSaved, task, defaults, limited }: Props) {
  const { showError, showSuccess } = useToast();
  const editing = !!task;
  const [raw, setF] = useState<any>({});
  const f = useMemo(() => ({ title: '', description: '', ownerIds: [] as string[], approverId: '', projectId: '', milestoneId: '', priority: 'medium', severity: 'minor', startDate: '', endDate: '', statusComment: '', notifyAudience: true, confidential: false, requireEvidence: false, requireEvidenceTouched: false, ...raw }), [raw]);
  const [criteria, setCriteria] = useState<string[]>([]);
  const [newCrit, setNewCrit] = useState('');
  const [projects, setProjects] = useState<any[]>([]);
  const [milestones, setMilestones] = useState<any[]>([]);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!open) return;
    api.get('/projects').then((r) => setProjects(r.data.data)).catch(() => setProjects([]));
    if (task) {
      setF({
        title: task.title || '', description: task.description || '', ownerIds: [idOf(task.ownerId), ...(task.coOwnerIds || []).map(idOf)].filter(Boolean), approverId: idOf(task.approverId),
        projectId: idOf(task.projectId), milestoneId: idOf(task.milestoneId), priority: task.priority || 'medium', severity: task.severity || 'minor',
        startDate: toInputDate(task.startDate), endDate: toInputDate(task.endDate || task.dueDate),
        confidential: !!task.confidential, requireEvidence: !!task.requireEvidence, requireEvidenceTouched: false,
      });
      setCriteria((task.acceptanceCriteria || []).map((c: any) => c.text));
    } else {
      setF({
        title: '', description: '', ownerIds: defaults?.ownerId ? [defaults.ownerId] : [], approverId: '', statusComment: '', notifyAudience: true, projectId: defaults?.projectId || '', milestoneId: defaults?.milestoneId || '',
        priority: 'medium', severity: 'minor', startDate: toInputDate(new Date()), endDate: '', confidential: false, requireEvidence: false, requireEvidenceTouched: false,
      });
      setCriteria([]);
    }
    setNewCrit('');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, task]);

  useEffect(() => {
    if (!open || !f.projectId) { setMilestones([]); return; }
    api.get(`/projects/${f.projectId}`).then((r) => setMilestones(r.data.data.project?.milestones || [])).catch(() => setMilestones([]));
  }, [open, f.projectId]);

  const evidenceDefault = useMemo(() => SEV_NEEDS_EVIDENCE.includes(f.severity) || !!f.milestoneId, [f.severity, f.milestoneId]);
  const evidenceOn = f.requireEvidenceTouched ? f.requireEvidence : f.requireEvidence || (!editing && evidenceDefault);
  const set = (k: string, v: any) => setF((x: any) => ({ ...x, [k]: v }));
  const dateBad = f.startDate && f.endDate && f.endDate < f.startDate;

  async function save() {
    setBusy(true);
    try {
      const body: any = {
        title: f.title.trim(), description: f.description || undefined, ownerIds: f.ownerIds?.length ? f.ownerIds : undefined, approverId: f.approverId || undefined,
        projectId: f.projectId || undefined, milestoneId: f.milestoneId || undefined, priority: f.priority, severity: f.severity,
        startDate: f.startDate || undefined, endDate: f.endDate || undefined, confidential: f.confidential, requireEvidence: evidenceOn,
        acceptanceCriteria: criteria.map((text) => ({ text })),
      };
      if (!editing && defaults?.parentTaskId) body.parentTaskId = defaults.parentTaskId;
      if (!editing) { body.statusComment = f.statusComment.trim(); body.notifyAudience = f.notifyAudience; }
      if (editing) { if (!f.projectId) body.projectId = null; if (!f.milestoneId) body.milestoneId = null; }
      if (editing && limited) {
        const res = await api.patch(`/tasks/${task._id}`, { description: body.description });
        showSuccess('Saved.'); onClose(); onSaved(res.data.data); return;
      }
      const res = editing ? await api.patch(`/tasks/${task._id}`, body) : await api.post('/tasks', body);
      showSuccess(editing ? 'Task updated.' : defaults?.parentTaskId ? 'Subtask added.' : 'Task created.');
      onClose(); onSaved(res.data.data);
    } catch (err) { showError(apiErrorMessage(err)); } finally { setBusy(false); }
  }

  const heading = editing ? 'Edit task' : defaults?.parentTaskId ? `New subtask${defaults.parentTitle ? ` of “${defaults.parentTitle}”` : ''}` : 'New task';

  return (
    <Modal open={open} onClose={onClose} title={heading} size="wide"
      footer={<><button className="btn btn-ghost" onClick={onClose}>Cancel</button><button className="btn btn-primary" disabled={busy || !f.title?.trim() || !!dateBad || (!editing && f.statusComment.trim().length < 3)} onClick={save}>{busy ? 'Saving…' : editing ? 'Save changes' : 'Create task'}</button></>}>
      <div className="form-grid">
        {!limited && <div className="field full"><label>Task title *</label><input className="input" value={f.title || ''} onChange={(e) => set('title', e.target.value)} autoFocus /></div>}
        {!editing && <div className="field full"><label>Why is this task being opened? *</label><input className="input" value={f.statusComment || ''} onChange={(e) => set('statusComment', e.target.value)} placeholder="e.g. Client asked for this in this morning’s call" /><small className="text-muted">Every status starts with a comment, including “open”. It becomes the first message in the task conversation.</small></div>}
        <div className="field full"><label>Description</label><RichTextEditor value={f.description || ''} onChange={(h) => set('description', h)} minHeight={110} compact /></div>
        {!limited && (<>
          <div className="field"><label>Priority</label>
            <select className="input" value={f.priority} onChange={(e) => set('priority', e.target.value)}>{['low', 'medium', 'high', 'urgent'].map((p) => <option key={p} value={p}>{p}</option>)}</select>
          </div>
          <div className="field"><label>Severity</label>
            <select className="input" value={f.severity} onChange={(e) => set('severity', e.target.value)}>{SEVERITY_OPTIONS.map((p) => <option key={p.value} value={p.value}>{p.label}</option>)}</select>
          </div>
          <div className="field"><label>Start date</label><input className="input" type="date" value={f.startDate || ''} onChange={(e) => set('startDate', e.target.value)} /></div>
          <div className="field"><label>End date</label><input className="input" type="date" min={f.startDate || undefined} value={f.endDate || ''} onChange={(e) => set('endDate', e.target.value)} />{dateBad && <small style={{ color: '#e5484d' }}>End date is before the start date.</small>}</div>
          <div className="field"><label>Project</label>
            <select className="input" value={f.projectId || ''} onChange={(e) => setF((x: any) => ({ ...x, projectId: e.target.value, milestoneId: '' }))} disabled={!!defaults?.parentTaskId}>
              <option value="">No project</option>{projects.map((p) => <option key={p._id} value={p._id}>{p.name}</option>)}
            </select>
          </div>
          <div className="field"><label>Milestone</label>
            <select className="input" value={f.milestoneId || ''} onChange={(e) => set('milestoneId', e.target.value)} disabled={!f.projectId}>
              <option value="">{f.projectId ? 'None' : 'Pick a project first'}</option>{milestones.map((m: any) => <option key={m._id} value={m._id}>{m.title}</option>)}
            </select>
          </div>
          <div className="field full"><label>Owners — one or more people doing the work (the first is the primary owner; defaults to you)</label><PeoplePicker value={f.ownerIds || []} onChange={(ids) => set('ownerIds', ids)} /></div>
          <div className="field full"><label>Approver (who signs this off — defaults to the project lead or whoever created it)</label><PeoplePicker single value={f.approverId ? [f.approverId] : []} onChange={(ids) => set('approverId', ids[0] || '')} /></div>
          <div className="field full">
            <label>Acceptance criteria (all must be met before it can be completed)</label>
            {criteria.map((c, i) => (
              <div key={i} className="row-gap" style={{ marginBottom: 6 }}>
                <input className="input" style={{ flex: 1 }} value={c} onChange={(e) => setCriteria(criteria.map((x, j) => (j === i ? e.target.value : x)))} />
                <button type="button" className="icon-btn" aria-label="Remove" onClick={() => setCriteria(criteria.filter((_, j) => j !== i))}><X size={15} /></button>
              </div>
            ))}
            <div className="row-gap">
              <input className="input" style={{ flex: 1 }} value={newCrit} placeholder="e.g. Attendance sheet signed by client" onChange={(e) => setNewCrit(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter' && newCrit.trim()) { e.preventDefault(); setCriteria([...criteria, newCrit.trim()]); setNewCrit(''); } }} />
              <button type="button" className="btn btn-ghost btn-sm" disabled={!newCrit.trim()} onClick={() => { setCriteria([...criteria, newCrit.trim()]); setNewCrit(''); }}><Plus size={14} /> Add</button>
            </div>
          </div>
          <div className="field full">
            <label style={{ display: 'flex', gap: 8, alignItems: 'center' }}><input type="checkbox" checked={evidenceOn} onChange={(e) => setF((x: any) => ({ ...x, requireEvidence: e.target.checked, requireEvidenceTouched: true }))} /> Evidence is required before this can be completed</label>
            <small className="text-muted">Switched on by default for major / critical / show-stopper work and anything tied to a milestone.</small>
          </div>
          {!editing && <div className="field full"><label style={{ display: 'flex', gap: 8, alignItems: 'center' }}><input type="checkbox" checked={f.notifyAudience !== false} onChange={(e) => set('notifyAudience', e.target.checked)} /> Tell everyone in the project / milestone about this task</label></div>}
          <div className="field full">
            <label style={{ display: 'flex', gap: 8, alignItems: 'center' }}><input type="checkbox" checked={!!f.confidential} onChange={(e) => set('confidential', e.target.checked)} /> Confidential — only the people involved can see it, and it cannot be sent to anyone</label>
          </div>
        </>)}
      </div>
    </Modal>
  );
}
