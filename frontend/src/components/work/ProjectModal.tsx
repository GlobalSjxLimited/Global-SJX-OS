import { useEffect, useMemo, useState } from 'react';
import { api, apiErrorMessage } from '@/lib/api';
import { useAuth } from '@/context/AuthContext';
import { useToast } from '@/context/ToastContext';
import { Modal } from '@/components/ui/Modal';
import { RichTextEditor } from '@/components/ui/RichText';
import { toInputDate } from '@/lib/format';
import { PeoplePicker } from './PeoplePicker';
import { PROJECT_ENDING, PROJECT_LABEL, PROJECT_STATUS_OPTIONS } from '@/lib/projectStatus';

const PRACTICES = ['Cybersecurity & Digital Trust', 'Payments & Financial Technology', 'Cloud, Infrastructure & Performance', 'Digital Transformation & Software', 'Technology Advisory & Project Delivery'];
const idOf = (v: any) => (v && typeof v === 'object' ? String(v._id || '') : v ? String(v) : '');

export function ProjectModal({ open, onClose, onSaved, project, defaults }: { open: boolean; onClose: () => void; onSaved: (p?: any) => void; project?: any | null; defaults?: { clientId?: string } }) {
  const { user } = useAuth();
  const { showError, showSuccess } = useToast();
  const editing = !!project;
  const [raw, setF] = useState<any>({});
  const f = useMemo(() => ({ name: '', overview: '', clientId: '', practice: '', projectManagerId: '', team: [], budget: 0, revenue: 0, startDate: '', endDate: '', status: 'initiation', statusComment: '', force: false, holdReason: '', health: 'on_track', ...raw }), [raw]);
  const [clients, setClients] = useState<any[]>([]);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!open) return;
    api.get('/clients').then((r) => setClients(r.data.data)).catch(() => setClients([]));
    if (project) {
      setF({ name: project.name, overview: project.overview || '', clientId: idOf(project.clientId), practice: project.practice || '', projectManagerId: idOf(project.projectManagerId), team: (project.team || []).map(idOf),
        budget: project.budget ?? 0, revenue: project.revenue ?? 0, startDate: toInputDate(project.startDate), endDate: toInputDate(project.endDate), status: project.status, statusComment: '', force: false, holdReason: '', health: project.health || 'on_track' });
    } else {
      setF({ name: '', overview: '', clientId: defaults?.clientId || '', practice: '', projectManagerId: user?.id || '', team: [], budget: 0, revenue: 0, startDate: toInputDate(new Date()), endDate: '', status: 'initiation', statusComment: '', force: false, holdReason: '', health: 'on_track' });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, project]);

  const set = (k: string, v: any) => setF((x: any) => ({ ...x, [k]: v }));
  const changing = editing && project.status !== f.status;
  const holding = ['on_hold', 'paused'].includes(f.status) && changing;
  const ending = changing && PROJECT_ENDING.includes(f.status);
  const [needForce, setNeedForce] = useState('');
  const dateBad = f.startDate && f.endDate && f.endDate < f.startDate;

  async function save() {
    setBusy(true);
    try {
      const body: any = { name: f.name.trim(), overview: f.overview || undefined, clientId: f.clientId || undefined, practice: f.practice || undefined, projectManagerId: f.projectManagerId || undefined, team: f.team,
        budget: Number(f.budget) || 0, revenue: Number(f.revenue) || 0, startDate: f.startDate || undefined, endDate: f.endDate || undefined, status: f.status, health: f.health };
      if (changing) { body.statusComment = f.statusComment.trim(); if (holding) body.holdReason = f.statusComment.trim(); if (f.force) body.force = true; }
      if (editing && !f.endDate) body.endDate = null;
      const res = editing ? await api.patch(`/projects/${project._id}`, body) : await api.post('/projects', body);
      showSuccess(editing ? 'Project updated.' : 'Project created.'); onClose(); onSaved(res.data.data);
    } catch (err: any) {
      const m = apiErrorMessage(err);
      if (/still open/i.test(m)) setNeedForce(m); else showError(m);
    } finally { setBusy(false); }
  }

  return (
    <Modal open={open} onClose={onClose} size="wide" title={editing ? 'Edit project' : 'New project'}
      footer={<><button className="btn btn-ghost" onClick={onClose}>Cancel</button><button className="btn btn-primary" onClick={save} disabled={busy || !f.name?.trim() || !!dateBad || (changing && f.statusComment.trim().length < 3)}>{busy ? 'Saving…' : editing ? 'Save changes' : 'Create project'}</button></>}>
      <div className="form-grid">
        <div className="field full"><label>Project title *</label><input className="input" value={f.name || ''} onChange={(e) => set('name', e.target.value)} autoFocus /></div>
        <div className="field full"><label>Overview</label><RichTextEditor value={f.overview || ''} onChange={(h) => set('overview', h)} minHeight={100} compact /></div>
        <div className="field"><label>Client</label><select className="input" value={f.clientId || ''} onChange={(e) => set('clientId', e.target.value)}><option value="">Internal</option>{clients.map((c) => <option key={c._id} value={c._id}>{c.name}</option>)}</select></div>
        <div className="field"><label>Practice</label><select className="input" value={f.practice || ''} onChange={(e) => set('practice', e.target.value)}><option value="">—</option>{PRACTICES.map((p) => <option key={p}>{p}</option>)}</select></div>
        <div className="field"><label>Start date</label><input className="input" type="date" value={f.startDate || ''} onChange={(e) => set('startDate', e.target.value)} /></div>
        <div className="field"><label>End date (optional — leave empty for ongoing work)</label><input className="input" type="date" min={f.startDate || undefined} value={f.endDate || ''} onChange={(e) => set('endDate', e.target.value)} />{dateBad && <small style={{ color: '#e5484d' }}>End date is before the start date.</small>}</div>
        <div className="field"><label>Budget</label><input className="input" type="number" min={0} value={f.budget} onChange={(e) => set('budget', e.target.value)} /></div>
        <div className="field"><label>Revenue</label><input className="input" type="number" min={0} value={f.revenue} onChange={(e) => set('revenue', e.target.value)} /></div>
        <div className="field"><label>Status</label><select className="input" value={f.status} onChange={(e) => set('status', e.target.value)}>{[...PROJECT_STATUS_OPTIONS, ...(!PROJECT_STATUS_OPTIONS.some((o) => o.key === f.status) ? [{ key: f.status, label: PROJECT_LABEL[f.status] || f.status }] : [])].map((o) => <option key={o.key} value={o.key}>{o.label}</option>)}</select></div>
        {editing && <div className="field"><label>Health</label><select className="input" value={f.health} onChange={(e) => set('health', e.target.value)}>{['on_track', 'at_risk', 'off_track'].map((s) => <option key={s} value={s}>{s.replace('_', ' ')}</option>)}</select></div>}
        {changing && <div className="field full"><label>{holding ? `Why is this project on hold? *` : `Why is the status changing to ${PROJECT_LABEL[f.status] || f.status}? *`}</label><textarea className="input" rows={3} value={f.statusComment} onChange={(e) => set('statusComment', e.target.value)} placeholder="This goes into the project conversation for everyone on the project." /></div>}
        {ending && <div className="field full"><div className="callout" style={{ fontSize: 13 }}>Only the project owner can close a project or make it inactive.{needForce && <> <strong>{needForce}</strong></>}</div>{needForce && <label style={{ display: 'flex', gap: 8, marginTop: 8 }}><input type="checkbox" checked={f.force} onChange={(e) => set('force', e.target.checked)} /> Close anyway. The open tasks stay as they are.</label>}</div>}
        <div className="field full"><label>Project manager</label><PeoplePicker single value={f.projectManagerId ? [f.projectManagerId] : []} onChange={(ids) => set('projectManagerId', ids[0] || '')} /></div>
        <div className="field full"><label>Team</label><PeoplePicker value={f.team || []} onChange={(ids) => set('team', ids)} /></div>
      </div>
    </Modal>
  );
}
