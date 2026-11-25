import { useEffect, useState } from 'react';
import { api, apiErrorMessage } from '@/lib/api';
import { useToast } from '@/context/ToastContext';
import { Modal } from '@/components/ui/Modal';
import { PeoplePicker } from './PeoplePicker';
import './work.css';

/** Ask someone on the task (usually the assignee) for a progress update. */
export function AskUpdateModal({ open, onClose, task, defaultUserId, onDone }: { open: boolean; onClose: () => void; task: { _id: string; title: string } | null; defaultUserId?: string; onDone?: () => void }) {
  const { showError, showSuccess } = useToast();
  const [who, setWho] = useState<string[]>([]);
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);
  useEffect(() => { if (open) { setWho(defaultUserId ? [defaultUserId] : []); setMessage(''); } }, [open, defaultUserId]);

  async function send() {
    if (!task || !who[0]) return;
    setBusy(true);
    try {
      const res = await api.post(`/tasks/${task._id}/request-update`, { userId: who[0], message: message || undefined });
      showSuccess(res.data?.data?.message || 'Update requested.'); onClose(); onDone?.();
    } catch (err) { showError(apiErrorMessage(err)); } finally { setBusy(false); }
  }

  return (
    <Modal open={open} onClose={onClose} title="Ask for an update" footer={<><button className="btn btn-ghost" onClick={onClose}>Cancel</button><button className="btn btn-primary" disabled={busy || !who[0]} onClick={send}>{busy ? 'Sending…' : 'Ask for update'}</button></>}>
      <div className="form-grid">
        <div className="field full"><label>Task</label><div style={{ fontWeight: 600 }}>{task?.title}</div></div>
        <div className="field full"><label>Who should update you?</label><PeoplePicker single value={who} onChange={setWho} /></div>
        <div className="field full"><label>Message (optional)</label><textarea className="input" rows={3} value={message} onChange={(e) => setMessage(e.target.value)} placeholder="Could you post a quick update on where this stands?" /></div>
      </div>
    </Modal>
  );
}
