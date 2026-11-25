import { useEffect, useState } from 'react';
import { CheckCircle2, ExternalLink, FileText, Link2, Send, ShieldCheck, XCircle } from 'lucide-react';
import { api, apiErrorMessage, openProtectedFile } from '@/lib/api';
import { useToast } from '@/context/ToastContext';
import { useConfirm } from '@/context/ConfirmContext';
import { Badge } from '@/components/ui/Badge';
import { FileUpload } from '@/components/work/FileUpload';
import { PeoplePicker } from '@/components/work/PeoplePicker';
import { fdatetime } from '@/lib/format';
import { APPROVAL_LABEL, APPROVAL_TONE, POSTING_LABEL, channelLabel } from '@/lib/marketing';

interface Evidence { kind: 'file' | 'link'; url: string; name?: string }
const problemsOf = (e: any): string[] => (e?.response?.data?.details?.problems as string[]) || [];

/** The approval gate and the hand-over: nothing is posted until someone else has approved this exact content, with evidence. */
export function CampaignApproval({ camp, dirty, onSaveFirst, onChanged }: { camp: any; dirty: boolean; onSaveFirst: () => Promise<boolean>; onChanged: () => void }) {
  const { showError, showSuccess } = useToast();
  const confirm = useConfirm();
  const status: string = camp.approval?.status || 'draft';
  const [note, setNote] = useState('');
  const [evidence, setEvidence] = useState<Evidence[]>([]);
  const [link, setLink] = useState('');
  const [busy, setBusy] = useState(false);
  const [problems, setProblems] = useState<string[]>([]);
  const [accounts, setAccounts] = useState<any[]>([]);
  const [hand, setHand] = useState<{ manager: string[]; accounts: Record<string, string>; when: string; instructions: string }>({ manager: camp.socialManagerId?._id ? [camp.socialManagerId._id] : [], accounts: {}, when: '', instructions: '' });
  useEffect(() => { api.get('/campaigns/accounts').then((r) => setAccounts(r.data.data)).catch(() => undefined); }, []);

  const posted = (camp.postings || []).filter((p: any) => p.status === 'posted').length;
  const steps = [
    { t: 'Draft', d: 'Write it and add pictures', done: status !== 'draft', now: status === 'draft' || status === 'changes_requested' || status === 'rejected' },
    { t: 'Approval', d: camp.approval?.submittedByName ? `Sent by ${camp.approval.submittedByName}` : 'Not sent yet', done: status === 'approved', now: status === 'pending' },
    { t: 'Social media manager', d: (camp.postings || []).length ? `${(camp.postings || []).length} channel(s) handed over` : 'Not handed over', done: (camp.postings || []).length > 0, now: status === 'approved' && !(camp.postings || []).length },
    { t: 'Posted', d: posted ? `${posted} live` : 'Nothing posted', done: posted > 0, now: (camp.postings || []).length > 0 && !posted },
  ];

  async function run(fn: () => Promise<any>, ok: string) {
    setBusy(true); setProblems([]);
    try { await fn(); showSuccess(ok); setNote(''); setEvidence([]); setLink(''); onChanged(); }
    catch (e) { const p = problemsOf(e); setProblems(p.length > 1 ? p : []); showError(apiErrorMessage(e)); } finally { setBusy(false); }
  }

  async function submit() {
    if (dirty && !(await onSaveFirst())) return;
    await run(() => api.post(`/campaigns/${camp._id}/submit`, { note: note || undefined }), 'Sent for approval. Nothing is posted until it is approved.');
  }
  async function decide(decision: 'approve' | 'reject' | 'changes') {
    if (decision === 'approve' && !(await confirm({ title: 'Approve this campaign?', message: 'You are confirming that you checked the post, the pictures and the channels, and that the evidence you attached is real. This is recorded in the audit log.', confirmLabel: 'Approve' }))) return;
    await run(() => api.post(`/campaigns/${camp._id}/decision`, { decision, note, evidence }), decision === 'approve' ? 'Approved.' : decision === 'reject' ? 'Rejected.' : 'Sent back for changes.');
  }
  async function handOver() {
    await run(() => api.post(`/campaigns/${camp._id}/send-to-manager`, { managerId: hand.manager[0] || undefined, accounts: Object.keys(hand.accounts).length ? Object.fromEntries(Object.entries(hand.accounts).filter(([, v]) => v)) : undefined, scheduledFor: hand.when || undefined, instructions: hand.instructions || undefined }), 'Handed to the social media manager.');
  }

  const channelsToSend = (camp.channels || []).filter((c: string) => !(camp.postings || []).some((p: any) => p.channel === c && ['sent_to_manager', 'posted'].includes(p.status)));

  return (
    <div style={{ display: 'grid', gap: 14 }}>
      <div className="mk-steps">{steps.map((s) => <div key={s.t} className={`mk-step ${s.done ? 'done' : ''} ${s.now ? 'now' : ''}`}><b>{s.done ? '✓ ' : ''}{s.t}</b>{s.d}</div>)}</div>

      {problems.length > 1 && <div className="banner warn"><ul style={{ margin: 0, paddingLeft: 18 }}>{problems.map((p) => <li key={p}>{p}</li>)}</ul></div>}
      {camp.contentChanged && <div className="banner warn">The content changed after it was approved. It must be approved again before anything is posted.</div>}

      {['draft', 'changes_requested', 'rejected'].includes(status) && (
        <div className="card" style={{ display: 'grid', gap: 10 }}>
          {status === 'changes_requested' && <div className="banner warn"><strong>{camp.approval.decidedByName}</strong> asked for changes: {camp.approval.note}</div>}
          {status === 'rejected' && <div className="banner warn"><strong>{camp.approval.decidedByName}</strong> rejected it: {camp.approval.note}</div>}
          <strong>Send for approval</strong>
          <p className="text-muted" style={{ fontSize: 13, margin: 0 }}>The CEO, COO, the head of Marketing{camp.approverId ? ` or ${camp.approverId.name}` : ''} will be asked. Nothing is posted anywhere until they approve it and attach evidence.{dirty ? ' Your unsaved changes will be saved first.' : ''}</p>
          <input className="input" placeholder="Note for the approver (optional)" value={note} onChange={(e) => setNote(e.target.value)} maxLength={500} />
          <div><button className="btn btn-primary" disabled={busy} onClick={submit}><Send size={14} /> Send for approval</button></div>
        </div>
      )}

      {status === 'pending' && (
        camp.canApprove ? (
          <div className="card" style={{ display: 'grid', gap: 10, borderColor: 'var(--accent)' }}>
            <strong><ShieldCheck size={15} style={{ verticalAlign: -2 }} /> Your decision</strong>
            <p className="text-muted" style={{ fontSize: 13, margin: 0 }}>Sent by {camp.approval.submittedByName} on {fdatetime(camp.approval.submittedAt)}. Check the post, the pictures and the channels on the “Post & pictures” tab.</p>
            <div className="field"><label>Your comment *</label><textarea className="input" rows={2} value={note} onChange={(e) => setNote(e.target.value)} maxLength={2000} placeholder="What did you check? If something is wrong, say what to fix." /></div>
            <div className="field"><label>Evidence of approval * (needed to approve)</label>
              <div className="text-muted" style={{ fontSize: 12, marginBottom: 6 }}>A sign-off e-mail, the signed brief, a screenshot of the chat where it was agreed, or a link to it.</div>
              {evidence.map((e, i) => <div key={i} style={{ display: 'flex', gap: 8, alignItems: 'center', fontSize: 13 }}>{e.kind === 'link' ? <Link2 size={13} /> : <FileText size={13} />} {e.name || e.url}<button className="btn btn-ghost btn-sm" onClick={() => setEvidence(evidence.filter((_, k) => k !== i))}>Remove</button></div>)}
              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center', marginTop: 6 }}>
                <FileUpload kind="document" label="Attach a file" onUploaded={(f) => setEvidence((x) => [...x, ...f.map((u) => ({ kind: 'file' as const, url: u.url, name: u.name }))])} />
                <input className="input" style={{ maxWidth: 280 }} placeholder="or paste a link https://…" value={link} onChange={(e) => setLink(e.target.value)} />
                <button className="btn btn-ghost btn-sm" disabled={!/^https?:\/\/\S+$/i.test(link)} onClick={() => { setEvidence([...evidence, { kind: 'link', url: link, name: link }]); setLink(''); }}>Add link</button></div></div>
            <div className="row-gap" style={{ flexWrap: 'wrap' }}>
              <button className="btn btn-primary" disabled={busy || note.trim().length < 3 || evidence.length < 1} onClick={() => decide('approve')}><CheckCircle2 size={14} /> Approve</button>
              <button className="btn btn-ghost" disabled={busy || note.trim().length < 3} onClick={() => decide('changes')}>Ask for changes</button>
              <button className="btn btn-danger" disabled={busy || note.trim().length < 3} onClick={() => decide('reject')}><XCircle size={14} /> Reject</button>
            </div>
          </div>
        ) : <div className="banner">Waiting for the CEO, COO, head of Marketing{camp.approverId ? ` or ${camp.approverId.name}` : ''} to decide. You will be told as soon as they do.</div>
      )}

      {status === 'approved' && (
        <div className="card" style={{ display: 'grid', gap: 8 }}>
          <div className="flex-between"><strong><CheckCircle2 size={15} style={{ verticalAlign: -2, color: 'var(--success)' }} /> Approved by {camp.approval.decidedByName}</strong><span className="text-muted" style={{ fontSize: 12 }}>{fdatetime(camp.approval.decidedAt)}</span></div>
          {camp.approval.selfApproved && <Badge tone="gold">Approved by its own author (leadership)</Badge>}
          <div style={{ fontSize: 13 }}>{camp.approval.note}</div>
          <div><span className="text-muted" style={{ fontSize: 12 }}>Evidence</span>
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 4 }}>{(camp.approval.evidence || []).map((e: any, i: number) => e.kind === 'link'
              ? <a key={i} className="btn btn-ghost btn-sm" href={e.url} target="_blank" rel="noreferrer noopener"><ExternalLink size={13} /> {e.name || 'Link'}</a>
              : <button key={i} className="btn btn-ghost btn-sm" onClick={() => openProtectedFile(e.url, e.name).catch((er) => showError(apiErrorMessage(er)))}><FileText size={13} /> {e.name}</button>)}</div></div>
        </div>
      )}

      {status === 'approved' && !camp.contentChanged && channelsToSend.length > 0 && (
        <div className="card" style={{ display: 'grid', gap: 10 }}>
          <strong>Hand over to the social media manager</strong>
          <div className="form-grid">
            {channelsToSend.map((ch: string) => { const mine = accounts.filter((a) => a.platform === ch && a.status !== 'inactive'); return (
              <div className="field" key={ch}><label>{channelLabel(ch)} account</label>
                {mine.length ? <select className="input" value={hand.accounts[ch] || ''} onChange={(e) => setHand({ ...hand, accounts: { ...hand.accounts, [ch]: e.target.value } })}><option value="">{mine[0].label} (default)</option>{mine.map((a) => <option key={a._id} value={a._id}>{a.label}{a.canAutoPost ? ' · app can post' : ' · posted by hand'}</option>)}</select>
                  : <span className="text-muted" style={{ fontSize: 12.5 }}>No account set up. It will be posted by hand.</span>}</div>); })}
            <div className="field"><label>Social media manager{accounts.some((a) => a.managerId) ? ' (an account’s own manager is used first)' : ''}</label><PeoplePicker single value={hand.manager} onChange={(v) => setHand({ ...hand, manager: v })} /></div>
            <div className="field"><label>Post on / after (optional)</label><input className="input" type="datetime-local" value={hand.when} onChange={(e) => setHand({ ...hand, when: e.target.value })} /></div>
            <div className="field full"><label>Instructions for the manager (optional)</label><input className="input" value={hand.instructions} onChange={(e) => setHand({ ...hand, instructions: e.target.value })} maxLength={1000} /></div>
          </div>
          <div><button className="btn btn-primary" disabled={busy} onClick={handOver}><Send size={14} /> Send to social media manager</button></div>
        </div>
      )}

      {(camp.postings || []).length > 0 && (
        <div><strong style={{ fontSize: 13 }}>Posts</strong>
          <div className="table-wrap" style={{ marginTop: 6 }}><table className="data-table" style={{ cursor: 'default' }}><thead><tr><th>Channel</th><th>Account</th><th>Status</th><th>Details</th></tr></thead>
            <tbody>{camp.postings.map((p: any) => (
              <tr key={p._id} style={{ cursor: 'default' }}><td>{channelLabel(p.channel)}</td><td>{p.accountLabel || '—'}</td>
                <td><Badge tone={p.status === 'posted' ? 'success' : p.status === 'failed' ? 'danger' : p.status === 'sent_to_manager' ? 'gold' : 'neutral'}>{POSTING_LABEL[p.status] || p.status}</Badge></td>
                <td style={{ fontSize: 12.5 }}>
                  {p.status === 'posted' && <>{p.postedByName} · {fdatetime(p.postedAt)} · {p.via === 'api' ? 'posted by the app' : 'posted by hand'} {p.postUrl && <a href={p.postUrl} target="_blank" rel="noreferrer noopener">View post</a>} {p.proof?.url && <button className="btn btn-ghost btn-sm" onClick={() => openProtectedFile(p.proof.url, p.proof.name).catch((er) => showError(apiErrorMessage(er)))}>Proof</button>}</>}
                  {p.status === 'sent_to_manager' && <>Handed over {fdatetime(p.sentAt)}{p.scheduledFor ? ` · post on ${fdatetime(p.scheduledFor)}` : ''}</>}
                  {p.error && <div style={{ color: 'var(--danger)' }}>{p.error}</div>}{p.note && <div className="text-muted">{p.note}</div>}
                </td></tr>))}</tbody></table></div></div>
      )}

      {(camp.approvalHistory || []).length > 0 && (
        <details><summary style={{ cursor: 'pointer', fontSize: 13, fontWeight: 600 }}>Approval history</summary>
          <ul style={{ fontSize: 12.5, color: 'var(--muted)', paddingLeft: 18 }}>{[...camp.approvalHistory].reverse().map((h: any, i: number) => <li key={i}>{fdatetime(h.at)} — {h.byName}: <Badge tone={APPROVAL_TONE[h.status] || 'neutral'}>{APPROVAL_LABEL[h.status] || h.status}</Badge> {h.note}</li>)}</ul></details>
      )}
    </div>
  );
}
