import { useState } from 'react';
import { Award, CheckCircle2, Send, XCircle } from 'lucide-react';
import { api, apiErrorMessage } from '@/lib/api';
import { useToast } from '@/context/ToastContext';
import { saveBlob, filenameFrom, fdatetime } from '@/lib/format';
import { Modal } from '@/components/ui/Modal';
import './work.css';

export interface Criterion { _id: string; text: string; met: boolean }

/** Pull the list of unmet rules out of a 422 so the person sees exactly what is missing. */
export function problemsFrom(err: any): string[] {
  const p = err?.response?.data?.error?.details?.problems ?? err?.response?.data?.details?.problems;
  return Array.isArray(p) ? p : [];
}

/**
 * The completion gate shared by tasks and milestones: acceptance criteria checklist,
 * submit-for-approval (blocked until the rules are met), approve / send back, certificate.
 */
export function ApprovalPanel({ baseUrl, item, perms, evidenceCount, onChanged, kindLabel = 'task' }: {
  baseUrl: string;
  item: { status: string; requireEvidence?: boolean; acceptanceCriteria?: Criterion[]; approval?: any; certificateNo?: string };
  perms: { edit?: boolean; submit?: boolean; approve?: boolean; manage?: boolean; isOwner?: boolean };
  evidenceCount: number;
  onChanged: () => void;
  kindLabel?: string;
}) {
  const { showError, showSuccess } = useToast();
  const [modal, setModal] = useState<null | 'submit' | 'approve' | 'reject'>(null);
  const [note, setNote] = useState('');
  const [ribbon, setRibbon] = useState('');
  const [busy, setBusy] = useState(false);
  const [problems, setProblems] = useState<string[]>([]);

  const criteria = item.acceptanceCriteria || [];
  const pendingApproval = item.status === 'awaiting_approval' || item.status === 'to_be_reviewed';
  const done = ['done', 'completed', 'complete', 'closed'].includes(item.status);
  const appr = item.approval || {};
  const unmet: string[] = [];
  if (item.requireEvidence && evidenceCount === 0) unmet.push('Attach at least one piece of evidence');
  criteria.filter((c) => !c.met).forEach((c) => unmet.push(`Criterion not yet met: ${c.text}`));
  const ready = unmet.length === 0;
  const gated = !!item.requireEvidence || criteria.length > 0;

  async function toggle(c: Criterion) {
    try { await api.patch(`${baseUrl}/criteria/${c._id}`, { met: !c.met }); onChanged(); } catch (err) { showError(apiErrorMessage(err)); }
  }

  async function act(kind: 'submit' | 'approve' | 'reject') {
    setBusy(true); setProblems([]);
    try {
      const body = kind === 'approve' ? { note: note || undefined, ribbon: ribbon || undefined } : { note: note || undefined };
      await api.post(`${baseUrl}/${kind}`, body);
      showSuccess(kind === 'submit' ? 'Submitted for approval.' : kind === 'approve' ? 'Approved and marked complete.' : 'Sent back for rework.');
      setModal(null); setNote(''); setRibbon(''); onChanged();
    } catch (err) {
      const p = problemsFrom(err);
      if (p.length) setProblems(p); else showError(apiErrorMessage(err));
    } finally { setBusy(false); }
  }

  async function certificate() {
    try {
      const res = await api.get(`${baseUrl}/certificate`, { responseType: 'blob' });
      saveBlob(res.data, filenameFrom(res.headers['content-disposition'], 'certificate.pdf'));
    } catch (err) { showError(apiErrorMessage(err)); }
  }

  return (
    <div className="stack">
      {criteria.length > 0 && (
        <div>
          <div className="text-muted" style={{ fontSize: 12, marginBottom: 4, fontWeight: 600 }}>ACCEPTANCE CRITERIA</div>
          {criteria.map((c) => (
            <label key={c._id} className="crit-row">
              <input type="checkbox" checked={c.met} disabled={!perms.edit || pendingApproval || done} onChange={() => toggle(c)} />
              <span style={{ textDecoration: c.met ? 'line-through' : 'none', color: c.met ? 'var(--muted)' : undefined }}>{c.text}</span>
            </label>
          ))}
        </div>
      )}

      {done && (
        <div className="callout ok">
          <strong>Approved{appr.decidedById?.name ? ` by ${appr.decidedById.name}` : ''}</strong>{appr.decidedAt ? ` · ${fdatetime(appr.decidedAt)}` : ''}
          {appr.ribbon && <> · <strong>{appr.ribbon}</strong></>}
          {appr.decisionNote && <div style={{ marginTop: 4 }}>{appr.decisionNote}</div>}
          {gated && <div style={{ marginTop: 8 }}><button type="button" className="btn btn-ghost btn-sm" onClick={certificate}><Award size={14} /> Download certificate</button></div>}
        </div>
      )}

      {pendingApproval && (
        <div className="callout warn">
          <strong>Waiting for approval</strong>{appr.submittedById?.name ? ` — submitted by ${appr.submittedById.name}` : ''}{appr.submittedAt ? ` · ${fdatetime(appr.submittedAt)}` : ''}
          {appr.completionNote && <div style={{ marginTop: 4 }}>{appr.completionNote}</div>}
          {perms.approve && (
            <div className="row-gap" style={{ marginTop: 10 }}>
              <button type="button" className="btn btn-primary btn-sm" onClick={() => { setNote(''); setModal('approve'); }}><CheckCircle2 size={14} /> Approve</button>
              <button type="button" className="btn btn-ghost btn-sm" onClick={() => { setNote(''); setModal('reject'); }}><XCircle size={14} /> Send back</button>
            </div>
          )}
        </div>
      )}

      {appr.status === 'rejected' && !pendingApproval && !done && (
        <div className="callout danger"><strong>Sent back{appr.decidedById?.name ? ` by ${appr.decidedById.name}` : ''}</strong>{appr.decisionNote ? ` — ${appr.decisionNote}` : ''}</div>
      )}

      {!pendingApproval && !done && gated && (
        <div className={`callout ${ready ? 'ok' : 'warn'}`}>
          {ready ? <>Everything required is in place. Submit this {kindLabel} to your approver to mark it complete.</> : (
            <>This {kindLabel} cannot be marked complete yet:<ul>{unmet.map((u) => <li key={u}>{u}</li>)}</ul></>
          )}
          {perms.submit && (
            <div style={{ marginTop: 10 }}>
              <button type="button" className="btn btn-primary btn-sm" disabled={!ready} onClick={() => { setNote(''); setProblems([]); setModal('submit'); }}><Send size={14} /> Submit for approval</button>
            </div>
          )}
        </div>
      )}

      <Modal
        open={!!modal}
        onClose={() => setModal(null)}
        title={modal === 'submit' ? 'Submit for approval' : modal === 'approve' ? 'Approve' : 'Send back for rework'}
        footer={<>
          <button className="btn btn-ghost" onClick={() => setModal(null)}>Cancel</button>
          <button className={`btn ${modal === 'reject' ? 'btn-danger' : 'btn-primary'}`} disabled={busy || (modal === 'reject' && note.trim().length < 3)} onClick={() => modal && act(modal)}>
            {busy ? 'Working…' : modal === 'submit' ? 'Submit' : modal === 'approve' ? 'Approve' : 'Send back'}
          </button>
        </>}
      >
        <div className="form-grid">
          {problems.length > 0 && <div className="callout danger full" style={{ gridColumn: '1 / -1' }}>Not ready:<ul>{problems.map((p) => <li key={p}>{p}</li>)}</ul></div>}
          <div className="field full">
            <label>{modal === 'submit' ? 'What was done? (completion comment)' : modal === 'approve' ? 'Comment (optional)' : 'What needs to change? *'}</label>
            <textarea className="input" rows={4} value={note} onChange={(e) => setNote(e.target.value)} placeholder={modal === 'submit' ? 'Summarise what was completed and point to the evidence…' : ''} />
          </div>
          {modal === 'approve' && (
            <div className="field full">
              <label>Ribbon / recognition (optional)</label>
              <input className="input" value={ribbon} onChange={(e) => setRibbon(e.target.value)} placeholder="e.g. Delivered early · Excellence" maxLength={60} />
            </div>
          )}
        </div>
      </Modal>
    </div>
  );
}
