import { useEffect, useState } from 'react';
import { api, apiErrorMessage } from '@/lib/api';
import { useAuth } from '@/context/AuthContext';
import { useToast } from '@/context/ToastContext';
import { Modal } from '@/components/ui/Modal';
import { problemsFrom } from '@/components/work/ApprovalPanel';

const HELP: Record<string, string> = {
  Lead: 'A name and a need, nothing qualified yet.', Qualified: 'Budget, authority, need and timing are confirmed.', Discovery: 'Understanding the problem in detail.', Proposal: 'A proposal has been sent. A follow-up task is created for the salesperson.',
  Negotiation: 'Price and terms are being agreed.', Documentation: 'Terms agreed. Contract, purchase order and signed paperwork are being collected.', 'Closed Won': 'Won. Needs the signed documentation attached.', 'Closed Lost': 'Lost. Say why so the report can learn from it.',
};

/** Moving an opportunity always asks what happened. Closing as lost asks why; closing as won needs the signed paperwork. */
export function StageModal({ open, opp, to, stages, lostReasons, onClose, onDone }: { open: boolean; opp: any | null; to: string; stages: string[]; lostReasons: string[]; onClose: () => void; onDone: () => void }) {
  const { user } = useAuth();
  const { showError, showSuccess } = useToast();
  const [stage, setStage] = useState(to);
  const [comment, setComment] = useState(''); const [lost, setLost] = useState(''); const [lostOther, setLostOther] = useState(''); const [win, setWin] = useState(''); const [skip, setSkip] = useState(false);
  const [problems, setProblems] = useState<string[]>([]); const [busy, setBusy] = useState(false);
  const leader = ['super_admin', 'ceo', 'coo'].includes(user?.role || '');
  useEffect(() => { if (open) { setStage(to); setComment(''); setLost(''); setLostOther(''); setWin(''); setSkip(false); setProblems([]); } }, [open, to, opp?._id]);
  if (!opp) return null;
  const reason = lost === 'Other' ? lostOther.trim() : lost;
  const ready = comment.trim().length >= 3 && (stage !== 'Closed Lost' || reason.length >= 2);

  async function save() {
    setBusy(true); setProblems([]);
    try {
      await api.patch(`/opportunities/${opp._id}`, { stage, stageComment: comment.trim(), ...(stage === 'Closed Lost' ? { lostReason: reason } : {}), ...(stage === 'Closed Won' ? { winReason: win.trim() || undefined } : {}), ...(skip ? { skipDocuments: true } : {}) });
      showSuccess(`Moved to ${stage}.`); onClose(); onDone();
    } catch (e) { const p = problemsFrom(e); if (p.length) setProblems(p); else showError(apiErrorMessage(e)); } finally { setBusy(false); }
  }
  const needsDocs = problems.some((p) => /signed documentation/i.test(p));
  return (
    <Modal open={open} onClose={onClose} title="Move opportunity" footer={<><button className="btn btn-ghost" onClick={onClose}>Cancel</button><button className="btn btn-primary" disabled={busy || !ready || stage === opp.stage} onClick={save}>{busy ? 'Saving…' : `Move to ${stage}`}</button></>}>
      <div className="form-grid">
        <div className="field full"><label>Opportunity</label><div style={{ fontWeight: 600 }}>{opp.title}</div><small className="text-muted">Now at {opp.stage}</small></div>
        <div className="field full"><label htmlFor="st-stage">New stage</label><select id="st-stage" className="input" value={stage} onChange={(e) => setStage(e.target.value)}>{stages.map((s) => <option key={s}>{s}</option>)}</select><small className="text-muted">{HELP[stage]}</small></div>
        {stage === 'Closed Lost' && <>
          <div className="field"><label htmlFor="st-lost">Why was it lost? *</label><select id="st-lost" className="input" value={lost} onChange={(e) => setLost(e.target.value)}><option value="">Select…</option>{lostReasons.map((r) => <option key={r}>{r}</option>)}</select></div>
          {lost === 'Other' && <div className="field"><label htmlFor="st-lo">Say what *</label><input id="st-lo" className="input" value={lostOther} onChange={(e) => setLostOther(e.target.value)} /></div>}
        </>}
        {stage === 'Closed Won' && <div className="field full"><label htmlFor="st-win">Why did we win? (helps the report)</label><input id="st-win" className="input" value={win} onChange={(e) => setWin(e.target.value)} placeholder="e.g. Trusted our delivery on the last project" /></div>}
        <div className="field full"><label htmlFor="st-c">What happened? *</label><textarea id="st-c" className="input" rows={3} value={comment} onChange={(e) => setComment(e.target.value)} placeholder="This goes into the opportunity conversation." /></div>
        {problems.length > 0 && <div className="callout danger full"><strong>Not ready yet</strong><ul style={{ margin: '6px 0 0', paddingLeft: 18 }}>{problems.map((p, i) => <li key={i}>{p}</li>)}</ul>{needsDocs && <p style={{ margin: '8px 0 0', fontSize: 13 }}>Open the opportunity, go to Documents, and attach the signed contract or purchase order (up to 10 MB).</p>}</div>}
        {needsDocs && leader && <label className="full" style={{ display: 'flex', gap: 8, fontSize: 13 }}><input type="checkbox" checked={skip} onChange={(e) => setSkip(e.target.checked)} /> Close as won without the document for now (leadership only, recorded in the history)</label>}
      </div>
    </Modal>
  );
}
