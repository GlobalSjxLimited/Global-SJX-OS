import { useEffect, useMemo, useState } from 'react';
import { Plus, X } from 'lucide-react';
import { api, apiErrorMessage } from '@/lib/api';
import { useToast } from '@/context/ToastContext';
import { Modal } from '@/components/ui/Modal';
import { toInputDate } from '@/lib/format';
import { PeoplePicker } from './PeoplePicker';
import { SEVERITY_OPTIONS } from './SeverityBadge';

const idOf = (v: any) => (v && typeof v === 'object' ? String(v._id || '') : v ? String(v) : '');

export function MilestoneModal({ open, onClose, projectId, milestone, onSaved }: { open: boolean; onClose: () => void; projectId: string; milestone?: any | null; onSaved: () => void }) {
  const { showError, showSuccess } = useToast();
  const editing = !!milestone;
  const [raw, setF] = useState<any>({});
  const f = useMemo(() => ({ title: '', description: '', severity: 'major', ownerId: '', approverId: '', startDate: '', endDate: '', requireEvidence: true, status: 'pending', ...raw }), [raw]);
  const [crit, setCrit] = useState<string[]>([]);
  const [newCrit, setNewCrit] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!open) return;
    if (milestone) {
      setF({ title: milestone.title, description: milestone.description || '', severity: milestone.severity || 'major', ownerId: idOf(milestone.ownerId), approverId: idOf(milestone.approverId),
        startDate: toInputDate(milestone.startDate), endDate: toInputDate(milestone.endDate || milestone.dueDate), requireEvidence: !!milestone.requireEvidence, status: ['awaiting_approval', 'completed'].includes(milestone.status) ? milestone.status : milestone.status === 'overdue' ? 'in_progress' : milestone.status });
      setCrit((milestone.acceptanceCriteria || []).map((c: any) => c.text));
    } else { setF({ title: '', description: '', severity: 'major', ownerId: '', approverId: '', startDate: toInputDate(new Date()), endDate: '', requireEvidence: true, status: 'pending' }); setCrit([]); }
    setNewCrit('');
  }, [open, milestone]);

  const set = (k: string, v: any) => setF((x: any) => ({ ...x, [k]: v }));
  const dateBad = f.startDate && f.endDate && f.endDate < f.startDate;
  const locked = editing && ['awaiting_approval', 'completed'].includes(milestone.status);

  async function save() {
    setBusy(true);
    try {
      const body: any = { title: f.title.trim(), description: f.description || undefined, severity: f.severity, ownerId: f.ownerId || undefined, approverId: f.approverId || undefined,
        startDate: f.startDate || undefined, endDate: f.endDate || undefined, requireEvidence: f.requireEvidence, acceptanceCriteria: crit.map((text) => ({ text })) };
      if (editing && !locked) body.status = f.status;
      if (editing) await api.patch(`/projects/${projectId}/milestones/${milestone._id}`, body); else await api.post(`/projects/${projectId}/milestones`, body);
      showSuccess(editing ? 'Milestone updated.' : 'Milestone added.'); onClose(); onSaved();
    } catch (err) { showError(apiErrorMessage(err)); } finally { setBusy(false); }
  }

  return (
    <Modal open={open} onClose={onClose} size="wide" title={editing ? 'Edit milestone' : 'New milestone'}
      footer={<><button className="btn btn-ghost" onClick={onClose}>Cancel</button><button className="btn btn-primary" disabled={busy || !f.title?.trim() || !!dateBad} onClick={save}>{busy ? 'Saving…' : editing ? 'Save changes' : 'Add milestone'}</button></>}>
      <div className="form-grid">
        <div className="field full"><label>Milestone title *</label><input className="input" value={f.title || ''} onChange={(e) => set('title', e.target.value)} autoFocus /></div>
        <div className="field full"><label>Description</label><textarea className="input" rows={3} value={f.description || ''} onChange={(e) => set('description', e.target.value)} /></div>
        <div className="field"><label>Severity</label><select className="input" value={f.severity} onChange={(e) => set('severity', e.target.value)}>{SEVERITY_OPTIONS.map((s) => <option key={s.value} value={s.value}>{s.label}</option>)}</select></div>
        {editing && !locked && <div className="field"><label>Status</label><select className="input" value={f.status} onChange={(e) => set('status', e.target.value)}>{['pending', 'in_progress', 'blocked'].map((s) => <option key={s} value={s}>{s.replace('_', ' ')}</option>)}</select><small className="text-muted">Completion happens through approval.</small></div>}
        <div className="field"><label>Start date</label><input className="input" type="date" value={f.startDate || ''} onChange={(e) => set('startDate', e.target.value)} /></div>
        <div className="field"><label>End date</label><input className="input" type="date" min={f.startDate || undefined} value={f.endDate || ''} onChange={(e) => set('endDate', e.target.value)} />{dateBad && <small style={{ color: '#e5484d' }}>End date is before the start date.</small>}</div>
        <div className="field full"><label>Owner</label><PeoplePicker single value={f.ownerId ? [f.ownerId] : []} onChange={(ids) => set('ownerId', ids[0] || '')} /></div>
        <div className="field full"><label>Approver (defaults to the project manager)</label><PeoplePicker single value={f.approverId ? [f.approverId] : []} onChange={(ids) => set('approverId', ids[0] || '')} /></div>
        <div className="field full">
          <label>Acceptance criteria</label>
          {crit.map((c, i) => (<div key={i} className="row-gap" style={{ marginBottom: 6 }}><input className="input" style={{ flex: 1 }} value={c} onChange={(e) => setCrit(crit.map((x, j) => (j === i ? e.target.value : x)))} /><button type="button" className="icon-btn" aria-label="Remove" onClick={() => setCrit(crit.filter((_, j) => j !== i))}><X size={15} /></button></div>))}
          <div className="row-gap"><input className="input" style={{ flex: 1 }} value={newCrit} placeholder="e.g. Final report signed off by client" onChange={(e) => setNewCrit(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter' && newCrit.trim()) { e.preventDefault(); setCrit([...crit, newCrit.trim()]); setNewCrit(''); } }} /><button type="button" className="btn btn-ghost btn-sm" disabled={!newCrit.trim()} onClick={() => { setCrit([...crit, newCrit.trim()]); setNewCrit(''); }}><Plus size={14} /> Add</button></div>
        </div>
        <div className="field full"><label style={{ display: 'flex', gap: 8, alignItems: 'center' }}><input type="checkbox" checked={!!f.requireEvidence} onChange={(e) => set('requireEvidence', e.target.checked)} /> Evidence is required before the milestone can be completed</label>
          <small className="text-muted">Every milestone also needs tasks assigned to it, so progress, who did what and the latest updates can be tracked.</small></div>
      </div>
    </Modal>
  );
}
