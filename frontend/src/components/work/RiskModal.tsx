import { useEffect, useState } from 'react';
import { api, apiErrorMessage } from '@/lib/api';
import { useToast } from '@/context/ToastContext';
import { Modal } from '@/components/ui/Modal';
import { PeoplePicker } from './PeoplePicker';
import { RISK_SEVERITY_OPTIONS } from './SeverityBadge';
import './work.css';

const KINDS = [
  { value: 'risk', label: 'Risk — something that might go wrong' },
  { value: 'blocker', label: 'Blocker — stopping the work right now' },
  { value: 'issue', label: 'Issue — a problem that has happened' },
];

/** Raise a risk / blocker / issue against a task or milestone (`baseUrl` = '/tasks/:id' or '/projects/:id/milestones/:mid'). */
export function RiskModal({ open, onClose, baseUrl, onSaved, subject }: { open: boolean; onClose: () => void; baseUrl: string; onSaved: () => void; subject?: string }) {
  const { showError, showSuccess } = useToast();
  const blank = { title: '', kind: 'blocker', description: '', severity: 'medium', impact: 'medium', blocking: true, mitigationPlan: '', ownerId: '' };
  const [f, setF] = useState<any>(blank);
  const [busy, setBusy] = useState(false);
  useEffect(() => { if (open) setF(blank); /* eslint-disable-next-line */ }, [open]);

  async function save() {
    setBusy(true);
    try {
      await api.post(`${baseUrl}/risks`, { ...f, ownerId: f.ownerId || undefined, blocking: f.kind === 'blocker' ? true : f.blocking });
      showSuccess(f.blocking || f.kind === 'blocker' ? 'Logged — the work is now marked as blocked.' : 'Risk logged.');
      onClose(); onSaved();
    } catch (err) { showError(apiErrorMessage(err)); } finally { setBusy(false); }
  }

  return (
    <Modal open={open} onClose={onClose} title={subject ? `Raise a risk — ${subject}` : 'Raise a risk'} size="wide"
      footer={<><button className="btn btn-ghost" onClick={onClose}>Cancel</button><button className="btn btn-primary" disabled={busy || !f.title.trim()} onClick={save}>{busy ? 'Saving…' : 'Log it'}</button></>}>
      <div className="form-grid">
        <div className="field full"><label>Risk title *</label><input className="input" value={f.title} onChange={(e) => setF({ ...f, title: e.target.value })} placeholder="What is preventing or threatening this?" autoFocus /></div>
        <div className="field full"><label>Type</label>
          <select className="input" value={f.kind} onChange={(e) => setF({ ...f, kind: e.target.value, blocking: e.target.value === 'blocker' ? true : f.blocking })}>{KINDS.map((k) => <option key={k.value} value={k.value}>{k.label}</option>)}</select>
        </div>
        <div className="field"><label>Severity</label><select className="input" value={f.severity} onChange={(e) => setF({ ...f, severity: e.target.value })}>{RISK_SEVERITY_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}</select></div>
        <div className="field"><label>Impact</label><select className="input" value={f.impact} onChange={(e) => setF({ ...f, impact: e.target.value })}>{RISK_SEVERITY_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}</select></div>
        <div className="field full"><label style={{ display: 'flex', gap: 8, alignItems: 'center' }}><input type="checkbox" checked={f.blocking || f.kind === 'blocker'} disabled={f.kind === 'blocker'} onChange={(e) => setF({ ...f, blocking: e.target.checked })} /> This is halting the work (mark it as blocked until resolved)</label></div>
        <div className="field full"><label>What is happening?</label><textarea className="input" rows={3} value={f.description} onChange={(e) => setF({ ...f, description: e.target.value })} /></div>
        <div className="field full"><label>What will be done about it? (mitigation)</label><textarea className="input" rows={3} value={f.mitigationPlan} onChange={(e) => setF({ ...f, mitigationPlan: e.target.value })} /></div>
        <div className="field full"><label>Owner (defaults to you)</label><PeoplePicker single value={f.ownerId ? [f.ownerId] : []} onChange={(ids) => setF({ ...f, ownerId: ids[0] || '' })} /></div>
      </div>
    </Modal>
  );
}
