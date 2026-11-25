import { useEffect, useState } from 'react';
import { api, apiErrorMessage } from '@/lib/api';
import { useToast } from '@/context/ToastContext';
import { Modal } from '@/components/ui/Modal';
import { PeoplePicker } from './PeoplePicker';
import './work.css';

/** Send a task to colleagues (in the app, by e-mail, or both) and to outside e-mail addresses. Never for confidential tasks. */
export function ShareTaskModal({ open, onClose, task, onDone }: { open: boolean; onClose: () => void; task: { _id: string; title: string; confidential?: boolean } | null; onDone?: () => void }) {
  const { showError, showSuccess } = useToast();
  const [userIds, setUserIds] = useState<string[]>([]);
  const [emails, setEmails] = useState('');
  const [via, setVia] = useState<'app' | 'email' | 'both'>('both');
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);
  useEffect(() => { if (open) { setUserIds([]); setEmails(''); setVia('both'); setMessage(''); } }, [open]);

  const list = emails.split(/[\s,;]+/).map((e) => e.trim()).filter(Boolean);
  const bad = list.filter((e) => !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(e));

  async function send() {
    if (!task) return;
    setBusy(true);
    try {
      await api.post(`/tasks/${task._id}/share`, { userIds, emails: list, via: list.length && via === 'app' ? 'both' : via, message: message || undefined });
      showSuccess('Task sent.'); onClose(); onDone?.();
    } catch (err) { showError(apiErrorMessage(err)); } finally { setBusy(false); }
  }

  return (
    <Modal open={open} onClose={onClose} title="Send task" footer={<><button className="btn btn-ghost" onClick={onClose}>Cancel</button><button className="btn btn-primary" disabled={busy || (!userIds.length && !list.length) || bad.length > 0} onClick={send}>{busy ? 'Sending…' : 'Send'}</button></>}>
      {task?.confidential ? (
        <div className="callout danger">This task is confidential, so it cannot be sent to other people.</div>
      ) : (
        <div className="form-grid">
          <div className="field full"><label>Task</label><div style={{ fontWeight: 600 }}>{task?.title}</div></div>
          <div className="field full"><label>Colleagues</label><PeoplePicker value={userIds} onChange={setUserIds} /></div>
          <div className="field full"><label>Or e-mail addresses (comma or space separated)</label><input className="input" value={emails} onChange={(e) => setEmails(e.target.value)} placeholder="client@example.com, partner@example.com" />{bad.length > 0 && <small style={{ color: '#e5484d' }}>Check: {bad.join(', ')}</small>}</div>
          <div className="field full"><label>Send</label>
            <div className="seg">
              <button type="button" className={via === 'both' ? 'on' : ''} onClick={() => setVia('both')}>In app + e-mail</button>
              <button type="button" className={via === 'app' ? 'on' : ''} onClick={() => setVia('app')} disabled={list.length > 0}>In app only</button>
              <button type="button" className={via === 'email' ? 'on' : ''} onClick={() => setVia('email')}>E-mail only</button>
            </div>
            <small className="text-muted">Colleagues you send it to in the app can open the task. Outside addresses receive a summary by e-mail only.</small>
          </div>
          <div className="field full"><label>Message (optional)</label><textarea className="input" rows={3} value={message} onChange={(e) => setMessage(e.target.value)} /></div>
        </div>
      )}
    </Modal>
  );
}
