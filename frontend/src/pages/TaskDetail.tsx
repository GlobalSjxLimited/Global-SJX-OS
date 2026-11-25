import { useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { AlertTriangle, ArrowLeft, Bell, BellOff, CalendarPlus, Lock, MessageCircleQuestion, Plus, Repeat, Send, ShieldAlert, X } from 'lucide-react';
import { api, apiErrorMessage } from '@/lib/api';
import { useApi } from '@/lib/useApi';
import { useToast } from '@/context/ToastContext';
import { fdate, fdatetime, label } from '@/lib/format';
import { Badge, statusTone } from '@/components/ui/Badge';
import { RichTextRenderer } from '@/components/ui/RichText';
import { ErrorNote, Kv, Loading } from '@/components/ui/PageHead';
import { RowActions } from '@/components/work/RowActions';
import { SeverityBadge } from '@/components/work/SeverityBadge';
import { EvidencePanel, DocumentsPanel } from '@/components/work/EvidencePanel';
import { ApprovalPanel } from '@/components/work/ApprovalPanel';
import { UpdatesFeed } from '@/components/work/UpdatesFeed';
import { RiskModal } from '@/components/work/RiskModal';
import { TaskModal } from '@/components/work/TaskModal';
import { MeetingModal, providerLabel } from '@/components/work/MeetingModal';
import { useTaskActions } from '@/components/work/useTaskActions';
import { ProgressBar, StatusBadge } from '@/components/work/StatusBadge';
import { StatusChangeModal } from '@/components/work/StatusChangeModal';
import { Discussion } from '@/components/discussion/Discussion';
import { AuditStamp } from '@/components/ui/AuditStamp';
import { HOLD_LABEL, STATUS_LABEL } from '@/lib/taskStatus';
import { useConfirm } from '@/context/ConfirmContext';

const nm = (v: any) => (v && typeof v === 'object' ? v.name || v.title : undefined);
const idOf = (v: any) => (v && typeof v === 'object' ? String(v._id || '') : v ? String(v) : '');

function Section({ title, action, children }: { title: string; action?: React.ReactNode; children: React.ReactNode }) {
  return (
    <div className="card" style={{ marginBottom: 16 }}>
      <div className="flex-between" style={{ marginBottom: 12 }}><h3 style={{ fontSize: 15 }}>{title}</h3>{action}</div>
      {children}
    </div>
  );
}

export function TaskDetail() {
  const { id } = useParams();
  const nav = useNavigate();
  const { showError, showSuccess } = useToast();
  const { data: t, loading, error, reload } = useApi<any>(id ? `/tasks/${id}` : null);
  const actions = useTaskActions(reload);
  const [risk, setRisk] = useState(false);
  const [sub, setSub] = useState(false);
  const [meet, setMeet] = useState(false);
  const [change, setChange] = useState<string | null>(null);
  const [pct, setPct] = useState<number | null>(null);
  const [muted, setMuted] = useState(false);
  const confirm = useConfirm();
  useEffect(() => { if (id) api.get(`/notification-prefs/mute/task/${id}`).then((r) => setMuted(!!r.data.data.muted)).catch(() => undefined); }, [id]);
  useEffect(() => { setPct(null); }, [t?.percentComplete, t?.status]);

  if (loading && !t) return <Loading />;
  if (error || !t) return <div><Link to="/tasks" className="btn btn-ghost btn-sm"><ArrowLeft size={14} /> Back to tasks</Link><div style={{ marginTop: 16 }}><ErrorNote message={error || 'Task not found'} /></div></div>;

  const p = t.permissions || {};
  const locked = ['complete', 'closed', 'to_be_reviewed'].includes(t.status);
  const canMove = !!(p.edit || p.isReviewer) && (t.nextStatuses || []).length > 0;
  const canSlide = !!p.edit && ['open', 'in_progress', 'delayed', 'to_be_tested'].includes(t.status);
  const owners = [nm(t.ownerId), ...(t.coOwnerIds || []).map(nm)].filter(Boolean);
  const feedItems = (t.comments || []).map((c: any) => ({ ...c, authorId: c.authorId, requestedFromId: c.requestedFromId }));
  const waitingOn: string[] = (t.openUpdateRequests || []).map((c: any) => nm(c.requestedFromId)).filter(Boolean);
  const openRisks = (t.risks || []).filter((r: any) => r.status !== 'closed');
  const base = `/tasks/${t._id}`;

  async function commitPct(v: number) {
    if (v === t.percentComplete) { setPct(null); return; }
    if (v >= 100 && !(await confirm({ title: 'Finished?', message: 'At 100% the task is sent to its reviewer. Continue?', confirmLabel: 'Send for review' }))) { setPct(null); return; }
    try {
      const r = await api.post(`${base}/progress`, { percent: v });
      showSuccess(r.data.data.movedToReview ? 'Sent for review.' : `Progress set to ${v}%.`); reload();
    } catch (err) { showError(apiErrorMessage(err)); setPct(null); }
  }
  async function toggleMute() {
    try { await api.post('/notification-prefs/mute', { entityType: 'task', entityId: t._id, muted: !muted }); setMuted(!muted); showSuccess(!muted ? 'Muted. You will only hear about urgent things.' : 'Unmuted.'); } catch (err) { showError(apiErrorMessage(err)); }
  }
  async function unshare(userId: string) {
    try { await api.delete(`${base}/share/${userId}`); reload(); } catch (err) { showError(apiErrorMessage(err)); }
  }

  return (
    <div>
      <div className="flex-between" style={{ marginBottom: 14, gap: 10, flexWrap: 'wrap' }}>
        <Link to={t.parentTaskId ? `/tasks/${idOf(t.parentTaskId)}` : '/tasks'} className="btn btn-ghost btn-sm"><ArrowLeft size={14} /> {t.parentTaskId ? `Back to ${nm(t.parentTaskId) || 'parent task'}` : 'All tasks'}</Link>
        <div className="row-gap">
          <button className="btn btn-ghost btn-sm" onClick={toggleMute} title={muted ? 'Get notifications for this task again' : 'Stop notifications for this task (urgent ones still arrive)'}>{muted ? <BellOff size={14} /> : <Bell size={14} />} {muted ? 'Muted' : 'Mute'}</button>
          {canMove && <button className="btn btn-primary btn-sm" onClick={() => setChange('')}><Repeat size={14} /> Change status</button>}
          {p.close && t.status === 'complete' && <button className="btn btn-ghost btn-sm" onClick={() => setChange('closed')} title="Only the project owner can close a task">Close task</button>}
          {p.view && !['complete', 'closed', 'cancelled', 'abandoned'].includes(t.status) && <button className="btn btn-ghost btn-sm" onClick={() => actions.openAsk(t)}><MessageCircleQuestion size={14} /> Ask for update</button>}
          {p.share && !t.confidential && <button className="btn btn-ghost btn-sm" onClick={() => actions.openShare(t)}><Send size={14} /> Send</button>}
          <button className="btn btn-ghost btn-sm" onClick={() => setMeet(true)}><CalendarPlus size={14} /> Meeting</button>
          <button className="btn btn-ghost btn-sm" onClick={() => setRisk(true)}><ShieldAlert size={14} /> Raise risk</button>
          <RowActions permissions={p} onEdit={() => actions.openEdit(t)} onDelete={async () => { if (await actions.remove(t)) nav('/tasks'); }} />
        </div>
      </div>

      <div className="card" style={{ marginBottom: 16 }}>
        <div className="row-gap" style={{ marginBottom: 8 }}>
          <StatusBadge status={t.status} hold={t.hold} />
          <SeverityBadge value={t.severity} />
          <Badge tone={statusTone(t.priority)}>{label(t.priority)} priority</Badge>
          {t.confidential && <Badge tone="gold"><Lock size={11} /> Confidential</Badge>}
          {t.source === 'email' && <Badge tone="neutral">From e-mail</Badge>}
        </div>
        <h1 style={{ fontSize: 24, marginBottom: 8 }}>{t.title}</h1>
        <div className="text-muted" style={{ fontSize: 13 }}>
          {nm(t.projectId) && <>in <Link to={`/projects/${idOf(t.projectId)}`} style={{ textDecoration: 'underline' }}>{nm(t.projectId)}</Link></>}
          {t.milestone && <> · milestone <strong>{t.milestone.title}</strong></>}
          {t.startDate || t.endDate || t.dueDate ? <> · {fdate(t.startDate)} → {fdate(t.endDate || t.dueDate)}</> : null}
        </div>
        <div style={{ marginTop: 12, maxWidth: 460 }}>
          <div className="flex-between" style={{ fontSize: 12.5, marginBottom: 4 }}><span>Progress</span><strong>{pct ?? t.percentComplete ?? 0}%</strong></div>
          <ProgressBar value={pct ?? t.percentComplete} status={t.status} compact />
          {canSlide && <input aria-label="Set progress" type="range" min={0} max={100} step={5} value={pct ?? t.percentComplete ?? 0} onChange={(e) => setPct(+e.target.value)} onPointerUp={() => pct !== null && commitPct(pct)} onKeyUp={(e) => { if (pct !== null && ['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(e.key)) commitPct(pct); }} style={{ width: '100%', marginTop: 6 }} />}
          {canSlide && <small className="text-muted">Drag to update. At 100% it goes to review.</small>}
        </div>
        {t.status === 'on_hold' && t.hold?.reason && (
          <div className="callout" style={{ marginTop: 12 }}><strong>{HOLD_LABEL[t.hold.reason] || 'On hold'}</strong>{nm(t.hold.awaitingUserId) ? <> — waiting for <strong>{nm(t.hold.awaitingUserId)}</strong></> : null}{t.hold.since ? <> since {fdate(t.hold.since)}</> : null}.
            {t.waitingOnTask && <> A task was created for them: <Link to={`/tasks/${t.waitingOnTask._id}`} style={{ textDecoration: 'underline' }}>{t.waitingOnTask.title}</Link> ({STATUS_LABEL[t.waitingOnTask.status] || t.waitingOnTask.status}). This task continues automatically when it is complete.</>}</div>
        )}
        {t.unblocksTask && <div className="callout" style={{ marginTop: 12 }}>Someone is waiting on this task: <Link to={`/tasks/${t.unblocksTask._id}`} style={{ textDecoration: 'underline' }}>{t.unblocksTask.title}</Link>. Finishing it lets them continue.</div>}
        {t.status === 'delayed' && <div className="callout danger" style={{ marginTop: 12 }}><strong>Delayed</strong> — escalation level {t.delay?.level || 1}{t.delay?.originalDate ? <>, originally due {fdate(t.delay.originalDate)}</> : null}{t.delay?.newDate ? <>, now expected {fdate(t.delay.newDate)}</> : null}. {t.delay?.auto ? 'Flagged automatically because the date passed.' : 'Reported by the owner.'}</div>}
        {t.blocked && openRisks.some((r: any) => r.blocking) && (
          <div className="callout danger" style={{ marginTop: 12 }}><strong>Why this is blocked:</strong> {openRisks.filter((r: any) => r.blocking).map((r: any) => r.title).join(' · ')}</div>
        )}
      </div>

      <div className="grid-2" style={{ gridTemplateColumns: 'minmax(0, 2fr) minmax(280px, 1fr)', alignItems: 'start' }}>
        <div>
          {t.description && <Section title="Description"><RichTextRenderer content={t.description} /></Section>}

          <Section title={`Subtasks (${(t.subtasks || []).length})`} action={p.manage || p.edit ? <button className="btn btn-ghost btn-sm" onClick={() => setSub(true)}><Plus size={14} /> Add subtask</button> : undefined}>
            {(t.subtasks || []).length === 0 ? <p className="text-muted" style={{ fontSize: 13 }}>No subtasks.</p> : (
              <div className="stack">
                {t.subtasks.map((s: any) => (
                  <div key={s._id} className="mini-card flex-between" style={{ gap: 10 }}>
                    <div style={{ minWidth: 0 }}>
                      <Link to={`/tasks/${s._id}`} style={{ fontWeight: 600 }}>{s.title}</Link>
                      <div className="text-muted" style={{ fontSize: 12 }}>{nm(s.ownerId) || 'Unassigned'} · {fdate(s.startDate)} → {fdate(s.endDate || s.dueDate)}</div>
                    </div>
                    <div className="row-gap"><SeverityBadge value={s.severity} /><Badge tone={statusTone(s.status)}>{label(s.status)}</Badge>
                      <RowActions permissions={s.permissions} onView={() => nav(`/tasks/${s._id}`)} onEdit={() => actions.openEdit(s)} onDelete={() => actions.remove(s)} extra={actions.extras(s)} /></div>
                  </div>
                ))}
              </div>
            )}
          </Section>

          <Section title="Completion & approval">
            <ApprovalPanel baseUrl={base} item={t} perms={p} evidenceCount={(t.evidence || []).length} onChanged={reload} />
            {t.status === 'closed' && <p className="text-muted" style={{ fontSize: 13, marginTop: 10 }}>Closed {fdatetime(t.closedAt)}{nm(t.closedById) ? ` by ${nm(t.closedById)}` : ''}.</p>}
          </Section>

          <Section title={`Evidence (${(t.evidence || []).length})`}>
            <EvidencePanel baseUrl={base} items={t.evidence || []} canAdd={!!p.edit} canRemove={!!p.edit} locked={locked} onChanged={reload}
              hint={t.requireEvidence ? 'Evidence is required before this can be completed.' : 'Attach proof of the work — files, photos, links.'} />
          </Section>

          <Section title="Progress updates">
            <UpdatesFeed baseUrl={base} items={feedItems.filter((c: any) => c.kind !== 'comment')} canUpdate={!!(p.edit || p.isOwner)} onChanged={reload} openRequestFor={waitingOn} />
          </Section>

          <div className="card" style={{ marginBottom: 16 }}>
            <Discussion entityType="task" entityId={t._id} title="Conversation" onChanged={() => undefined} />
          </div>
        </div>

        <div>
          <Section title="Details">
            <Kv rows={[
              ['Owners', owners.join(', ') || '—'], ['Created by', nm(t.creatorId)], ['Reviewer', nm(t.reviewerId) || nm(t.approverId)], ...(t.testerId ? [['Tester', nm(t.testerId)] as [string, any]] : []),
              ['Severity', <SeverityBadge key="s" value={t.severity} />], ['Start date', fdate(t.startDate)], ['End date', fdate(t.endDate || t.dueDate)],
              ['Client', nm(t.clientId)],
            ]} />
            <AuditStamp doc={t} style={{ marginTop: 10, flexDirection: 'column' }} />
          </Section>

          {!t.confidential && (t.sharedWith || []).length > 0 && (
            <Section title="Shared with">
              <div className="row-gap">{t.sharedWith.map((u: any) => (
                <span key={idOf(u)} className="chip active">{nm(u)}{p.share && <button type="button" aria-label="Remove" onClick={() => unshare(idOf(u))} style={{ background: 'none', border: 0, color: 'inherit', cursor: 'pointer', display: 'inline-flex' }}><X size={12} /></button>}</span>
              ))}</div>
            </Section>
          )}

          <Section title={`Status history (${(t.statusHistory || []).length})`}>
            {(t.statusHistory || []).length === 0 ? <p className="text-muted" style={{ fontSize: 13 }}>No changes recorded.</p> : (
              <ol className="stack" style={{ listStyle: 'none', margin: 0, padding: 0 }}>{[...t.statusHistory].reverse().map((h: any, i: number) => (
                <li key={i} className="mini-card" style={{ fontSize: 12.5 }}>
                  <div><b>{h.from ? `${STATUS_LABEL[h.from] || h.from} → ` : ''}{STATUS_LABEL[h.to] || h.to}</b>{typeof h.percent === 'number' ? ` · ${h.percent}%` : ''}</div>
                  {h.comment && <div className="text-muted" style={{ margin: '2px 0' }}>{h.comment}</div>}
                  <div className="text-muted" style={{ fontSize: 11.5 }}>{h.byName || 'System'} · {fdatetime(h.at)}{h.device ? ` · ${h.device}` : ''}{h.ip ? ` (${h.ip})` : ''}</div>
                </li>))}</ol>
            )}
          </Section>

          <Section title={`Risks & blockers (${(t.risks || []).length})`} action={<button className="btn btn-ghost btn-sm" onClick={() => setRisk(true)}><Plus size={14} /> Raise</button>}>
            {(t.risks || []).length === 0 ? <p className="text-muted" style={{ fontSize: 13 }}>Nothing is in the way.</p> : (
              <div className="stack">{t.risks.map((r: any) => (
                <div key={r._id} className="mini-card">
                  <div className="row-gap" style={{ marginBottom: 4 }}><Badge tone={r.blocking ? 'danger' : 'neutral'}>{label(r.kind)}</Badge><span className={`sev sev-${r.severity}`}>{label(r.severity)}</span>{r.status === 'closed' && <Badge tone="success">Closed</Badge>}</div>
                  <h4>{r.title}</h4>
                  {r.mitigationPlan && <div className="text-muted" style={{ fontSize: 12.5 }}>{r.mitigationPlan}</div>}
                  <div className="text-muted" style={{ fontSize: 11.5, marginTop: 4 }}>{nm(r.ownerId)}</div>
                </div>
              ))}</div>
            )}
          </Section>

          <Section title={`Meetings (${(t.meetings || []).length})`} action={<button className="btn btn-ghost btn-sm" onClick={() => setMeet(true)}><Plus size={14} /> New</button>}>
            {(t.meetings || []).length === 0 ? <p className="text-muted" style={{ fontSize: 13 }}>No meetings yet.</p> : (
              <div className="stack">{t.meetings.map((m: any) => (
                <Link key={m._id} to={`/meetings?open=${m._id}`} className="mini-card">
                  <h4>{m.title}</h4>
                  <div className="text-muted" style={{ fontSize: 12 }}>{fdatetime(m.date)} · {providerLabel(m.provider)}</div>
                  {m.recording?.reminderEnabled && !m.recording?.uploaded && <div style={{ fontSize: 11.5, color: 'var(--gold)' }}>Recording not uploaded yet</div>}
                </Link>
              ))}</div>
            )}
          </Section>

          <Section title={`Documents (${(t.documents || []).length})`}>
            <DocumentsPanel baseUrl={base} items={t.documents || []} canAdd={!!(p.edit || p.manage)} canRemove={!!(p.edit || p.manage)} onChanged={reload} />
          </Section>
        </div>
      </div>

      <RiskModal open={risk} onClose={() => setRisk(false)} baseUrl={base} onSaved={reload} subject={t.title} />
      <TaskModal open={sub} onClose={() => setSub(false)} onSaved={reload} defaults={{ parentTaskId: t._id, parentTitle: t.title, projectId: idOf(t.projectId) || undefined, milestoneId: idOf(t.milestoneId) || undefined }} />
      <MeetingModal open={meet} onClose={() => setMeet(false)} onSaved={reload} context={{ taskId: t._id, projectId: idOf(t.projectId) || undefined, milestoneId: idOf(t.milestoneId) || undefined, title: t.title, kind: t.parentTaskId ? 'Subtask' : 'Task' }} />
      <StatusChangeModal open={change !== null} task={t} initial={change || undefined} onClose={() => setChange(null)} onDone={reload} />
      {actions.modals}
    </div>
  );
}
