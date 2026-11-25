import { useState } from 'react';
import { FlaskConical } from 'lucide-react';
import { api, apiErrorMessage } from '@/lib/api';
import { useToast } from '@/context/ToastContext';
import { Modal } from './Modal';

export function BetaPill() {
  return <span className="beta-pill" title="Academy is in beta">Beta</span>;
}

/** Banner shown across the Academy while it is in beta, with a one-click feedback form that lands in the Support Desk. */
export function AcademyBetaBanner() {
  const { showError, showSuccess } = useToast();
  const [open, setOpen] = useState(false);
  const [text, setText] = useState('');
  const [kind, setKind] = useState('Something is not working');
  const [sending, setSending] = useState(false);

  async function send() {
    setSending(true);
    try {
      await api.post('/tickets', { subject: `Academy Beta feedback: ${kind}`, description: text, category: 'academy_beta', priority: 'low' });
      showSuccess('Thank you — your feedback was sent to the Global SJX team.');
      setOpen(false);
      setText('');
    } catch (err) {
      showError(apiErrorMessage(err));
    } finally {
      setSending(false);
    }
  }

  return (
    <>
      <div className="card" style={{ marginBottom: 20, display: 'flex', gap: 14, alignItems: 'center', background: 'var(--gold-soft)', border: '1px solid var(--gold)', flexWrap: 'wrap' }}>
        <FlaskConical size={22} color="var(--gold)" />
        <div style={{ flex: 1, minWidth: 220 }}>
          <strong style={{ fontSize: 14 }}>Global SJX Academy is in Beta</strong>
          <div style={{ fontSize: 13, color: 'var(--muted)' }}>Features are still being refined and things may change. Your feedback shapes what we build next.</div>
        </div>
        <button className="btn btn-ghost btn-sm" onClick={() => setOpen(true)}>Share feedback</button>
      </div>
      <Modal open={open} onClose={() => setOpen(false)} title="Academy Beta feedback" footer={<><button className="btn btn-ghost" onClick={() => setOpen(false)}>Cancel</button><button className="btn btn-primary" onClick={send} disabled={sending || text.trim().length < 3}>{sending ? 'Sending…' : 'Send feedback'}</button></>}>
        <div className="field"><label>What is this about?</label>
          <select className="input" value={kind} onChange={(e) => setKind(e.target.value)}>
            {['Something is not working', 'Idea or request', 'Confusing experience', 'Praise'].map((k) => <option key={k}>{k}</option>)}
          </select>
        </div>
        <div className="field"><label>Tell us more</label><textarea className="input" rows={5} value={text} onChange={(e) => setText(e.target.value)} /></div>
      </Modal>
    </>
  );
}
