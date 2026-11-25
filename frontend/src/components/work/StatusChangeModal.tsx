import { useEffect, useState } from 'react';
import { api, apiErrorMessage } from '@/lib/api';
import { useToast } from '@/context/ToastContext';
import { Modal } from '@/components/ui/Modal';
import { toInputDate } from '@/lib/format';
import { HOLD_REASONS, STATUS_HELP, STATUS_LABEL, TASK_STATUSES } from '@/lib/taskStatus';
import { PeoplePicker } from './PeoplePicker';
import { FileUpload } from './FileUpload';
import { problemsFrom } from './ApprovalPanel';
import './work.css';

/**
 * One window for every status change. Every change needs a comment; some need more:
 * in progress → how far along, on hold → what for (and who, which can create a task for them),
 * delayed → the new date, cancelled / abandoned → an explanation or evidence, to be tested → who tests.
 */
export function StatusChangeModal({ open, task, initial, onClose, onDone }: { open: boolean; task: any | null; initial?: string; onClose: () => void; onDone: () => void }) {
  const { showError, showSuccess } = useToast();
  const [to, setTo] = useState<string>('in_progress');
  const [comment, setComment] = useState('');
  const [percent, setPercent] = useState(0);
  const [reason, setReason] = useState('awaiting_person');
  const [who, setWho] = useState<string[]>([]);
  const [linked, setLinked] = useState(true);
  const [newDate, setNewDate] = useState('');
  const [tester, setTester] = useState<string[]>([]);
  const [files, setFiles] = useState<Array<{ name: string; url: string }>>([]);
  const [problems, setProblems] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);

  const allowed: string[] = task?.nextStatuses || [];
  useEffect(() => {
    if (!open || !task) return;
    setTo(initial && allowed.includes(initial) ? initial : allowed[0] || 'in_progress');
    setComment(''); setPercent(task.percentComplete || 0); setReason('awaiting_person'); setWho([]); setLinked(true); setTester([]); setFiles([]); setProblems([]);
    setNewDate(toInputDate(new Date(Date.now() + 3 * 86400000)));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, task?._id, initial]);

  if (!task) return null;
  const hold = HOLD_REASONS.find((h) => h.key === reason);
  const dropped = to === 'cancelled' || to === 'abandoned';
  const needsDate = to === 'delayed';
  const ready = comment.trim().length >= 3 && (to !== 'on_hold' || !hold?.needsPerson || who[0]) && (!needsDate || newDate) && (!dropped || comment.trim().length >= 15 || files.length > 0);

  async function save() {
    setBusy(true); setProblems([]);
    try {
      const body: any = { status: to, comment: comment.trim() };
      if (to === 'in_progress') body.percent = percent;
      if (to === 'on_hold') body.hold = { reason, awaitingUserId: reason === 'awaiting_person' ? who[0] : undefined, createLinkedTask: !!who[0] && linked };
      if (needsDate) body.newDate = newDate;
      if (to === 'to_be_tested' && tester[0]) body.testerId = tester[0];
      if (dropped && files.length) body.evidence = files.map((f) => ({ ...f, kind: 'evidence' }));
      await api.post(`/tasks/${task._id}/status`, body);
      showSuccess(`Moved to ${STATUS_LABEL[to].toLowerCase()}.`); onClose(); onDone();
    } catch (err) {
      const p = problemsFrom(err);
      if (p.length) setProblems(p); else showError(apiErrorMessage(err));
    } finally { setBusy(false); }
  }

  return (
    <Modal open={open} onClose={onClose} title="Change status" footer={<><button className="btn btn-ghost" onClick={onClose}>Cancel</button><button className="btn btn-primary" disabled={busy || !ready || to === task.status} onClick={save}>{busy ? 'Saving…' : `Move to ${STATUS_LABEL[to]}`}</button></>}>
      <div className="form-grid">
        <div className="field full"><label>Task</label><div style={{ fontWeight: 600 }}>{task.title}</div><small className="text-muted">Now: {STATUS_LABEL[task.status]}{typeof task.percentComplete === 'number' ? ` · ${task.percentComplete}%` : ''}</small></div>
        <div className="field full"><label htmlFor="sc-to">New status</label>
          <select id="sc-to" className="input" value={to} onChange={(e) => setTo(e.target.value)}>{TASK_STATUSES.filter((s) => allowed.includes(s)).map((s) => <option key={s} value={s}>{STATUS_LABEL[s]}</option>)}</select>
          <small className="text-muted">{STATUS_HELP[to]}</small></div>

        {to === 'in_progress' && <div className="field full"><label htmlFor="sc-pct">How far along is it? <b>{percent}%</b></label><input id="sc-pct" type="range" min={0} max={99} step={5} value={percent} onChange={(e) => setPercent(+e.target.value)} style={{ width: '100%' }} /><small className="text-muted">At 100% send it for review instead.</small></div>}

        {to === 'on_hold' && <>
          <div className="field"><label htmlFor="sc-reason">What is it waiting for?</label><select id="sc-reason" className="input" value={reason} onChange={(e) => setReason(e.target.value)}>{HOLD_REASONS.map((h) => <option key={h.key} value={h.key}>{h.label}</option>)}</select></div>
          {reason === 'awaiting_person' && <div className="field full"><label>Who are you waiting for? *</label><PeoplePicker single value={who} onChange={setWho} /></div>}
          {(reason === 'awaiting_person' || reason === 'awaiting_ceo') && <div className="field full"><label style={{ display: 'flex', gap: 8, alignItems: 'center' }}><input type="checkbox" checked={linked} onChange={(e) => setLinked(e.target.checked)} /> Create a task for them{reason === 'awaiting_ceo' ? ' (the CEO)' : ''} from this one, and continue automatically when they finish it</label></div>}
        </>}

        {needsDate && <div className="field"><label htmlFor="sc-date">New expected date *</label><input id="sc-date" className="input" type="date" value={newDate} onChange={(e) => setNewDate(e.target.value)} /><small className="text-muted">The people above you are told straight away.</small></div>}
        {to === 'to_be_tested' && <div className="field full"><label>Who will test it? (optional)</label><PeoplePicker single value={tester} onChange={setTester} /></div>}

        <div className="field full"><label htmlFor="sc-comment">Comment *{dropped ? ' — why? (a sentence, or attach evidence)' : ''}</label>
          <textarea id="sc-comment" className="input" rows={4} value={comment} onChange={(e) => setComment(e.target.value)} placeholder={to === 'to_be_reviewed' ? 'What was done, and what should the reviewer check?' : to === 'closed' ? 'Why is this safe to close?' : 'Say what changed and why'} />
          <small className="text-muted">This goes into the task conversation for everyone involved.</small></div>
        {dropped && <div className="field full"><label>Evidence (optional if you explain clearly)</label><FileUpload multiple label="Attach evidence" onUploaded={(u) => setFiles((x) => [...x, ...u.map((f) => ({ name: f.name, url: f.url }))])} />
          {files.length > 0 && <div className="row-gap" style={{ marginTop: 6 }}>{files.map((f, i) => <span key={i} className="chip active">{f.name}</span>)}</div>}</div>}
        {problems.length > 0 && <div className="callout danger full"><strong>Not ready yet</strong><ul style={{ margin: '6px 0 0', paddingLeft: 18 }}>{problems.map((p, i) => <li key={i}>{p}</li>)}</ul></div>}
      </div>
    </Modal>
  );
}
