import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api, apiErrorMessage } from '@/lib/api';
import { useToast } from '@/context/ToastContext';
import { Modal } from '@/components/ui/Modal';

/** Start a sales opportunity from an existing project: same client, the client's contacts copied across, source set to "project". */
export function RaiseOpportunityModal({ open, project, onClose }: { open: boolean; project: any; onClose: () => void }) {
  const { showError, showSuccess } = useToast();
  const [title, setTitle] = useState(''); const [value, setValue] = useState(''); const [comment, setComment] = useState(''); const [busy, setBusy] = useState(false); const [made, setMade] = useState<any>(null);
  useEffect(() => { if (open) { setTitle(`Follow-on work: ${project.name}`); setValue(''); setComment(''); setMade(null); } }, [open, project?.name]);
  async function save() {
    setBusy(true);
    try { const r = await api.post(`/projects/${project._id}/opportunity`, { title, value: Number(value) || 0, comment: comment || undefined }); setMade(r.data.data); showSuccess('Opportunity created.'); }
    catch (e) { showError(apiErrorMessage(e)); } finally { setBusy(false); }
  }
  return (
    <Modal open={open} onClose={onClose} title="Raise an opportunity from this project"
      footer={made ? <button className="btn btn-primary" onClick={onClose}>Done</button> : <><button className="btn btn-ghost" onClick={onClose}>Cancel</button><button className="btn btn-primary" disabled={busy || title.trim().length < 2} onClick={save}>{busy ? 'Creating…' : 'Create opportunity'}</button></>}>
      {made ? (
        <div className="callout ok">Created “{made.title}”. It starts at <b>Lead</b> with {made.contacts?.length || 0} contact{made.contacts?.length === 1 ? '' : 's'} from the client. <Link to={`/sales?opportunity=${made._id}`} style={{ textDecoration: 'underline' }}>Open it in the pipeline</Link>.</div>
      ) : (
        <div className="form-grid">
          <p className="text-muted full" style={{ fontSize: 13, margin: 0 }}>For follow-on work, an upsell or a renewal. {project.clientId?.name ? `It is linked to ${project.clientId.name}.` : 'This project has no client, so the project name is used as the prospect.'} The client’s account owner (or sales) is told.</p>
          <div className="field full"><label htmlFor="ro-title">Title *</label><input id="ro-title" className="input" value={title} onChange={(e) => setTitle(e.target.value)} /></div>
          <div className="field"><label htmlFor="ro-value">Estimated value</label><input id="ro-value" className="input" type="number" min={0} value={value} onChange={(e) => setValue(e.target.value)} /></div>
          <div className="field full"><label htmlFor="ro-c">What did the client say or ask for?</label><textarea id="ro-c" className="input" rows={3} value={comment} onChange={(e) => setComment(e.target.value)} placeholder="Becomes the first comment on the opportunity." /></div>
        </div>
      )}
    </Modal>
  );
}
