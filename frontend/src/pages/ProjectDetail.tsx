import { useMemo, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { AlertTriangle, ArrowLeft, Building2, CalendarDays, CalendarPlus, ChevronRight, Layers, Plus, ShieldAlert, TrendingUp, UserRound } from 'lucide-react';
import { RichTextRenderer } from '@/components/ui/RichText';
import { api, apiErrorMessage } from '@/lib/api';
import { useApi } from '@/lib/useApi';
import { Badge, statusTone } from '@/components/ui/Badge';
import { Discussion } from '@/components/discussion/Discussion';
import { AuditStamp } from '@/components/ui/AuditStamp';
import { StatusBadge, ProgressBar } from '@/components/work/StatusBadge';
import { RaiseOpportunityModal } from '@/components/record/RaiseOpportunityModal';
import { PROJECT_LABEL } from '@/lib/projectStatus';
import { Empty, ErrorNote, Loading, Tabs } from '@/components/ui/PageHead';
import { Modal } from '@/components/ui/Modal';
import { MultiFileUploadModal } from '@/components/ui/MultiFileUploadModal';
import { useToast } from '@/context/ToastContext';
import { useConfirm } from '@/context/ConfirmContext';
import { useAuth } from '@/context/AuthContext';
import { fdate, fdatetime, label } from '@/lib/format';
import { QuarterFilter } from '@/components/work/QuarterFilter';
import { RowActions } from '@/components/work/RowActions';
import { SeverityBadge } from '@/components/work/SeverityBadge';
import { ProjectModal } from '@/components/work/ProjectModal';
import { MilestoneModal } from '@/components/work/MilestoneModal';
import { EvidencePanel } from '@/components/work/EvidencePanel';
import { ApprovalPanel } from '@/components/work/ApprovalPanel';
import { UpdatesFeed } from '@/components/work/UpdatesFeed';
import { RiskModal } from '@/components/work/RiskModal';
import { MeetingModal, providerLabel } from '@/components/work/MeetingModal';
import { useTaskActions } from '@/components/work/useTaskActions';

const nm = (v: any) => (v && typeof v === 'object' ? v.name || v.title : undefined);
const idOf = (v: any) => (v && typeof v === 'object' ? String(v._id || '') : v ? String(v) : '');
const initials = (n?: string) => (n || '?').split(/\s+/).map((w) => w[0]).slice(0, 2).join('').toUpperCase();
const TABS = [['overview', 'Overview'], ['tasks', 'Tasks'], ['milestones', 'Milestones'], ['risks', 'Risks & issues'], ['meetings', 'Meetings'], ['documents', 'Documents'], ['discussion', 'Discussion']];
const HOLD = ['on_hold', 'paused'];

function Progress({ pct }: { pct: number }) { return <div className="progress" aria-label={`${pct}% complete`}><span style={{ width: `${pct}%` }} /></div>; }

/* --------------------------- "Why is it on hold?" --------------------------- */
function HoldReport({ projectId, open, onClose }: { projectId: string; open: boolean; onClose: () => void }) {
  const { showError, showSuccess } = useToast();
  const { data, loading, error, reload } = useApi<any>(open ? `/projects/${projectId}/hold-report` : null);
  const [body, setBody] = useState('');
  const [kind, setKind] = useState('comment');
  async function post() {
    try { await api.post(`/projects/${projectId}/comments`, { body: body.trim(), kind }); setBody(''); showSuccess('Posted.'); reload(); } catch (err) { showError(apiErrorMessage(err)); }
  }
  return (
    <Modal open={open} onClose={onClose} size="xwide" title={`Why is this project ${data?.project?.status === 'paused' ? 'paused' : 'on hold'}?`}>
      {loading && !data ? <Loading /> : error ? <ErrorNote message={error} /> : data && (
        <div className="stack">
          <div className="callout warn">
            <strong>{data.reason || 'No reason was recorded.'}</strong>
            <div className="text-muted" style={{ fontSize: 12.5, marginTop: 4 }}>{[data.heldBy ? `By ${data.heldBy}` : null, data.since ? fdatetime(data.since) : null, data.project?.projectManager ? `Project manager: ${data.project.projectManager}` : null].filter(Boolean).join(' · ')}</div>
          </div>

          <h4>Risks, blockers & issues ({data.risks.length})</h4>
          {data.risks.length === 0 ? <p className="text-muted" style={{ fontSize: 13 }}>No open risks are recorded against this project.</p> : (
            <div className="table-wrap"><table className="table"><thead><tr><th>Risk title</th><th>Type</th><th>Applies to</th><th>Severity</th><th>Owner</th></tr></thead>
              <tbody>{data.risks.map((r: any) => (<tr key={r._id}><td><strong>{r.title}</strong>{r.blocking && <> <Badge tone="danger">Blocking</Badge></>}{r.mitigationPlan && <div className="text-muted" style={{ fontSize: 12 }}>{r.mitigationPlan}</div>}</td><td>{label(r.kind)}</td><td>{r.appliesTo}</td><td><span className={`sev sev-${r.severity}`}>{label(r.severity)}</span></td><td>{r.owner || '—'}</td></tr>))}</tbody></table></div>
          )}

          {(data.blockedMilestones.length > 0 || data.blockedTasks.length > 0) && (
            <div className="grid-2">
              <div><h4 style={{ marginBottom: 6 }}>Blocked milestones</h4>{data.blockedMilestones.length === 0 ? <span className="text-muted" style={{ fontSize: 13 }}>None</span> : data.blockedMilestones.map((m: any) => <div key={m._id} className="row-gap" style={{ marginBottom: 4 }}><SeverityBadge value={m.severity} /> {m.title}</div>)}</div>
              <div><h4 style={{ marginBottom: 6 }}>Blocked tasks</h4>{data.blockedTasks.length === 0 ? <span className="text-muted" style={{ fontSize: 13 }}>None</span> : data.blockedTasks.map((t: any) => <div key={t._id} className="row-gap" style={{ marginBottom: 4 }}><SeverityBadge value={t.severity} /> <Link to={`/tasks/${t._id}`}>{t.title}</Link> <span className="text-muted">· {t.owner}</span></div>)}</div>
            </div>
          )}

          <h4>Status history</h4>
          {data.history.length === 0 ? <p className="text-muted" style={{ fontSize: 13 }}>No changes recorded.</p> : data.history.map((h: any, i: number) => (
            <div key={i} style={{ fontSize: 13 }}><strong>{label(h.from)} → {label(h.to)}</strong> · {h.by || 'Someone'} · {fdatetime(h.at)}{h.reason ? <div className="text-muted">{h.reason}</div> : null}</div>
          ))}

          <h4>Comments</h4>
          <div className="feed">{data.comments.length === 0 ? <p className="text-muted" style={{ fontSize: 13 }}>No comments yet.</p> : data.comments.map((c: any) => (
            <div key={c._id} className={`feed-item kind-${c.kind}`}><div className="feed-meta"><strong>{c.by || 'Someone'}</strong><span>{label(c.kind)}</span><span>{fdatetime(c.at)}</span></div><div className="feed-body">{c.body}</div></div>
          ))}</div>
          <div className="row-gap" style={{ alignItems: 'flex-start' }}>
            <select className="input" style={{ width: 'auto' }} value={kind} onChange={(e) => setKind(e.target.value)}><option value="comment">Comment</option><option value="blocker">Blocker</option><option value="update">Update</option></select>
            <textarea className="input" style={{ flex: 1, minWidth: 200 }} rows={2} value={body} onChange={(e) => setBody(e.target.value)} placeholder="Add to the discussion…" />
            <button className="btn btn-primary btn-sm" disabled={!body.trim()} onClick={post}>Post</button>
          </div>
        </div>
      )}
    </Modal>
  );
}

/* ------------------------------ Milestone page ------------------------------ */
function MilestoneDetail({ project, milestone, canManage, tasks, onClose, onChanged, openTask }: { project: any; milestone: any; canManage: boolean; tasks: any[]; onClose: () => void; onChanged: () => void; openTask: (d: any) => void }) {
  const { user } = useAuth();
  const [risk, setRisk] = useState(false);
  const [meet, setMeet] = useState(false);
  const m = milestone;
  const base = `/projects/${project._id}/milestones/${m._id}`;
  const isOwner = idOf(m.ownerId) === user?.id;
  const perms = { edit: canManage || isOwner, submit: canManage || isOwner, approve: (idOf(m.approverId) === user?.id || canManage) && !isOwner, manage: canManage, isOwner };
  const mt = tasks.filter((t) => idOf(t.milestoneId) === m._id && !t.parentTaskId);
  const locked = ['awaiting_approval', 'completed'].includes(m.status);
  return (
    <Modal open onClose={onClose} size="xwide" title={`Milestone — ${m.title}`}>
      <div className="stack">
        <div className="row-gap"><SeverityBadge value={m.severity} /><Badge tone={statusTone(m.status)}>{label(m.status)}</Badge>{m.blocked && <Badge tone="danger"><AlertTriangle size={11} /> Blocked</Badge>}
          <span className="text-muted" style={{ fontSize: 13 }}>{fdate(m.startDate)} → {fdate(m.endDate || m.dueDate)} · Owner {nm(m.ownerId) || '—'} · Approver {nm(m.approverId) || 'project manager'}</span></div>
        {m.description && <p style={{ fontSize: 14 }}>{m.description}</p>}
        <div><div className="flex-between" style={{ fontSize: 13, marginBottom: 4 }}><span>{m.tasks.done} of {m.tasks.total} tasks done</span><strong>{m.tasks.percent}%</strong></div><Progress pct={m.tasks.percent} /></div>

        <div className="card"><div className="flex-between" style={{ marginBottom: 10 }}><h3 style={{ fontSize: 15 }}>Tasks on this milestone</h3>{(canManage || isOwner) && <button className="btn btn-ghost btn-sm" onClick={() => openTask({ projectId: project._id, milestoneId: m._id })}><Plus size={14} /> Add task</button>}</div>
          {mt.length === 0 ? <div className="callout warn">No tasks are assigned to this milestone yet — add some so progress, who did what and the latest updates can be tracked.</div> : (
            <div className="stack">{mt.map((t) => (<Link key={t._id} to={`/tasks/${t._id}`} className="mini-card flex-between"><div><strong>{t.title}</strong><div className="text-muted" style={{ fontSize: 12 }}>{nm(t.ownerId) || 'Unassigned'} · {fdate(t.startDate)} → {fdate(t.endDate || t.dueDate)}</div></div><div className="row-gap"><SeverityBadge value={t.severity} /><Badge tone={statusTone(t.status)}>{label(t.status)}</Badge></div></Link>))}</div>
          )}</div>

        <div className="card"><h3 style={{ fontSize: 15, marginBottom: 10 }}>Completion & approval</h3><ApprovalPanel baseUrl={base} item={m} perms={perms} evidenceCount={(m.evidence || []).length} kindLabel="milestone" onChanged={onChanged} /></div>
        <div className="card"><h3 style={{ fontSize: 15, marginBottom: 10 }}>Evidence ({(m.evidence || []).length})</h3><EvidencePanel baseUrl={base} items={m.evidence || []} canAdd={perms.edit} locked={locked} onChanged={onChanged} hint="Attach proof the milestone was achieved — reports, sign-offs, photos." /></div>
        <div className="card"><div className="flex-between" style={{ marginBottom: 10 }}><h3 style={{ fontSize: 15 }}>Updates</h3><div className="row-gap"><button className="btn btn-ghost btn-sm" onClick={() => setMeet(true)}><CalendarPlus size={14} /> Meeting</button><button className="btn btn-ghost btn-sm" onClick={() => setRisk(true)}><ShieldAlert size={14} /> Raise risk</button></div></div>
          <UpdatesFeed baseUrl={base} items={(m.updates || []).map((u: any) => ({ ...u, _id: u._id }))} canUpdate onChanged={onChanged} commentPath="/updates" allowAttach={false} /></div>
      </div>
      <div className="card" style={{ marginTop: 14 }}><Discussion entityType="milestone" entityId={m._id} scopeId={project._id} title="Milestone conversation" /></div>
      <RiskModal open={risk} onClose={() => setRisk(false)} baseUrl={base} onSaved={onChanged} subject={m.title} />
      <MeetingModal open={meet} onClose={() => setMeet(false)} onSaved={onChanged} context={{ projectId: project._id, milestoneId: m._id, title: m.title, kind: 'Milestone' }} />
    </Modal>
  );
}

/* ---------------------------------- Page ---------------------------------- */
export function ProjectDetail() {
  const { id } = useParams();
  const nav = useNavigate();
  const { showError, showSuccess } = useToast();
  const { user } = useAuth();
  const confirm = useConfirm();
  const [quarter, setQuarter] = useState('');
  const { data, loading, error, reload } = useApi<any>(id ? `/projects/${id}` : null);
  const actions = useTaskActions(reload);
  const [tab, setTab] = useState('overview');
  const [editing, setEditing] = useState(false);
  const [msModal, setMsModal] = useState<{ ms?: any } | null>(null);
  const [openMs, setOpenMs] = useState<string | null>(null);
  const [hold, setHold] = useState(false);
  const [risk, setRisk] = useState(false);
  const [meet, setMeet] = useState(false);
  const [docs, setDocs] = useState(false);
  const [statusReport, setStatusReport] = useState<string | null>(null);
  const [note, setNote] = useState('');
  const [raise, setRaise] = useState(false);
  const [reqClose, setReqClose] = useState<{ to: 'closure' | 'inactive'; comment: string } | null>(null);

  const inQuarter = (d?: string) => !quarter || !d || `${new Date(d).getFullYear()}-Q${Math.floor(new Date(d).getMonth() / 3) + 1}` === quarter;
  const tasks = useMemo(() => (data?.tasks || []).filter((t: any) => !quarter || inQuarter(t.endDate || t.dueDate || t.startDate)), [data, quarter]);

  if (loading && !data) return <Loading />;
  if (error || !data) return <div><Link to="/projects" className="btn btn-ghost btn-sm"><ArrowLeft size={14} /> Projects</Link><ErrorNote message={error || 'Project not found'} /></div>;
  const { project, risks, meetings, documents, taskStats, permissions } = data;
  const ownerId = String(project.projectManagerId?._id || project.projectManagerId || '');
  const iOwn = !!user && (user.id === ownerId || ['super_admin', 'ceo'].includes(user.role));
  const canAskToClose = !iOwn && ['initiation', 'planning', 'execution', 'monitoring', 'active'].includes(project.status);
  async function sendCloseRequest() {
    if (!reqClose) return;
    try { await api.post(`/projects/${id}/request-closure`, reqClose); showSuccess('Asked the project owner. They will see it in the project conversation.'); setReqClose(null); reload(); } catch (err) { showError(apiErrorMessage(err)); }
  }
  const canManage = !!permissions?.manageMilestones;
  const onHold = HOLD.includes(project.status);
  const pct = taskStats.total ? Math.round((taskStats.done / taskStats.total) * 100) : 0;
  const milestones = (project.milestones || []).filter((m: any) => inQuarter(m.endDate || m.dueDate || m.startDate));
  const current = project.milestones.find((m: any) => m._id === openMs);

  async function deleteMs(m: any) {
    if (!(await confirm({ title: 'Delete milestone', message: `Delete “${m.title}”? Tasks assigned to it will be detached.`, confirmLabel: 'Delete', danger: true }))) return;
    try { await api.delete(`/projects/${id}/milestones/${m._id}`, { params: { force: 'true' } }); showSuccess('Milestone deleted.'); reload(); } catch (err) { showError(apiErrorMessage(err)); }
  }
  async function removeProject() {
    if (!(await confirm({ title: 'Delete project', message: `Delete “${project.name}”?`, confirmLabel: 'Delete', danger: true }))) return;
    try { await api.delete(`/projects/${id}`); showSuccess('Project deleted.'); nav('/projects'); } catch (err) { showError(apiErrorMessage(err)); }
  }
  async function aiReport() {
    try { const res = await api.post('/ai/ask', { message: 'give me a project status report', projectId: id }); setStatusReport(res.data.data.reply); } catch (err) { showError(apiErrorMessage(err)); }
  }
  async function postNote() {
    try { await api.post(`/projects/${id}/comments`, { body: note.trim(), kind: 'comment' }); setNote(''); reload(); } catch (err) { showError(apiErrorMessage(err)); }
  }

  return (
    <div>
      <div className="flex-between" style={{ marginBottom: 14, flexWrap: 'wrap', gap: 10 }}>
        <Link to="/projects" className="btn btn-ghost btn-sm"><ArrowLeft size={14} /> Projects</Link>
        <div className="row-gap"><QuarterFilter value={quarter} onChange={setQuarter} /><button className="btn btn-ghost btn-sm" onClick={() => setRaise(true)}><TrendingUp size={14} /> Raise opportunity</button>{canAskToClose && <button className="btn btn-ghost btn-sm" onClick={() => setReqClose({ to: 'closure', comment: '' })}>Request closure</button>}<button className="btn btn-ghost btn-sm" onClick={aiReport}>AI status report</button>
          <RowActions permissions={{ view: true, edit: permissions?.edit, delete: permissions?.delete }} onEdit={() => setEditing(true)} onDelete={removeProject} /></div>
      </div>

      <div className="proj-hero">
        <div className="row-gap" style={{ marginBottom: 10 }}>
          {onHold ? <button type="button" className="badge badge-gold" style={{ border: 0, cursor: 'pointer' }} onClick={() => setHold(true)} title="Why is this on hold?">{PROJECT_LABEL[project.status] || label(project.status)} — why? <ChevronRight size={12} /></button> : <Badge tone={statusTone(project.status)}>{PROJECT_LABEL[project.status] || label(project.status)}</Badge>}
          <Badge tone={statusTone(project.health)}>{label(project.health)}</Badge>
        </div>
        <h1>{project.name}</h1>
        <div className="proj-meta">
          <span><Building2 size={14} /> {project.clientId?.name || 'Internal project'}</span>
          {project.practice && <span><Layers size={14} /> {project.practice}</span>}
          <span><CalendarDays size={14} /> {fdate(project.startDate)} → {project.endDate ? fdate(project.endDate) : 'ongoing'}</span>
          <span><UserRound size={14} /> {project.projectManagerId?.name || 'No manager'}</span>
        </div>
        <AuditStamp doc={project} style={{ marginBottom: 10 }} />
        <div className="proj-progress" title={`${pct}% of tasks complete`}>
          <div className="bar"><i style={{ width: `${pct}%` }} /></div>
          <b>{pct}%</b><small>{taskStats.done} of {taskStats.total} tasks complete</small>
        </div>
        {onHold && project.holdReason && <div className="callout warn" style={{ marginTop: 14, cursor: 'pointer' }} onClick={() => setHold(true)}><strong>{label(project.status)}:</strong> {project.holdReason} <span style={{ textDecoration: 'underline' }}>See the full report</span></div>}
      </div>
      {statusReport && <div className="card" style={{ marginBottom: 16, borderColor: 'var(--accent)' }}><p style={{ fontSize: 13.5 }}>{statusReport}</p></div>}

      <div className="stat-grid" style={{ marginBottom: 22 }}>
        <div className="stat-card"><div className="stat-label"><span>Tasks complete</span></div><div className="stat-value">{taskStats.done}/{taskStats.total}</div></div>
        <div className="stat-card"><div className="stat-label"><span>Awaiting approval</span></div><div className="stat-value">{taskStats.awaitingApproval ?? 0}</div></div>
        <div className="stat-card"><div className="stat-label"><span>Blocked / overdue</span></div><div className="stat-value">{taskStats.blocked ?? 0} / {taskStats.overdue}</div></div>
        <div className="stat-card"><div className="stat-label"><span>Budget</span></div><div className="stat-value" style={{ fontSize: 22 }}>{project.currency} {(project.budget || 0).toLocaleString()}</div></div>
      </div>

      <Tabs value={tab} onChange={setTab} tabs={TABS.map(([key, lbl]) => ({ key, label: lbl, count: key === 'tasks' ? tasks.length : key === 'milestones' ? milestones.length : key === 'risks' ? risks.filter((r: any) => r.status !== 'closed').length : undefined }))} />
      <div style={{ marginTop: 16 }}>
        {tab === 'overview' && (
          <div className="proj-grid">
            <div className="card">
              <h3 className="sect-title">About this project</h3>
              <RichTextRenderer content={project.overview || 'No overview provided.'} />
            </div>
            <div className="card">
              <h3 className="sect-title">Details</h3>
              <dl className="detail-list">
                <div><dt>Project manager</dt><dd>{project.projectManagerId?.name ? <span className="person"><span className="avatar-xs">{initials(project.projectManagerId.name)}</span>{project.projectManagerId.name}</span> : '—'}</dd></div>
                <div><dt>Team</dt><dd>{project.team?.length ? <span className="person-list">{project.team.map((t: any) => <span key={t._id} className="person"><span className="avatar-xs">{initials(t.name)}</span>{t.name}</span>)}</span> : '—'}</dd></div>
                <div><dt>Start date</dt><dd>{fdate(project.startDate)}</dd></div>
                <div><dt>End date</dt><dd>{project.endDate ? fdate(project.endDate) : 'Ongoing — no end date'}</dd></div>
                <div><dt>Revenue</dt><dd>{project.currency} {(project.revenue || 0).toLocaleString()}</dd></div>
              </dl>
            </div>
          </div>
        )}

        {tab === 'tasks' && (<div>
          <div className="flex-between" style={{ marginBottom: 12 }}><span className="text-muted" style={{ fontSize: 13 }}>Everything on this project that you are allowed to see.</span><button className="btn btn-primary btn-sm" onClick={() => actions.openCreate({ projectId: project._id })}><Plus size={14} /> New task</button></div>
          {tasks.length === 0 ? <Empty title="No tasks" hint="Create one, or change the quarter filter." /> : (
            <div className="table-wrap"><table className="table"><thead><tr><th>Task title</th><th>Assigned to</th><th>Severity</th><th>Status</th><th>Start</th><th>End</th><th style={{ width: 44 }} /></tr></thead>
              <tbody>{tasks.map((t: any) => (<tr key={t._id}><td><Link to={`/tasks/${t._id}`} style={{ fontWeight: 600 }}>{t.title}</Link>{t.parentTaskId && <div className="text-muted" style={{ fontSize: 11.5 }}>Subtask of {nm(t.parentTaskId)}</div>}</td><td>{nm(t.ownerId) || '—'}</td><td><SeverityBadge value={t.severity} /></td><td><StatusBadge status={t.status} hold={t.hold} /><div style={{ marginTop: 4 }}><ProgressBar value={t.percentComplete} status={t.status} compact /></div></td><td>{fdate(t.startDate)}</td><td>{fdate(t.endDate || t.dueDate)}</td>
                <td><RowActions permissions={t.permissions} onView={() => nav(`/tasks/${t._id}`)} onEdit={() => actions.openEdit(t)} onDelete={() => actions.remove(t)} extra={actions.extras(t)} /></td></tr>))}</tbody></table></div>
          )}</div>)}

        {tab === 'milestones' && (<div>
          <div className="flex-between" style={{ marginBottom: 12 }}><span className="text-muted" style={{ fontSize: 13 }}>Progress comes from the tasks assigned to each milestone.</span>{canManage && <button className="btn btn-primary btn-sm" onClick={() => setMsModal({})}><Plus size={14} /> New milestone</button>}</div>
          {milestones.length === 0 ? <Empty title="No milestones" hint="Add milestones to break the project into checkpoints." /> : (
            <div className="stack">{milestones.map((m: any) => (
              <div key={m._id} className="card card-hover" style={{ cursor: 'pointer' }} onClick={() => setOpenMs(m._id)}>
                <div className="flex-between" style={{ gap: 10, alignItems: 'flex-start' }}>
                  <div style={{ minWidth: 0 }}><strong style={{ fontSize: 15 }}>{m.title}</strong>
                    <div className="text-muted" style={{ fontSize: 12.5 }}>{fdate(m.startDate)} → {fdate(m.endDate || m.dueDate)} · Owner {nm(m.ownerId) || '—'}</div></div>
                  <div className="row-gap" onClick={(e) => e.stopPropagation()}><SeverityBadge value={m.severity} /><Badge tone={statusTone(m.status)}>{label(m.status)}</Badge>{m.blocked && <Badge tone="danger">Blocked</Badge>}
                    <RowActions permissions={{ view: true, edit: canManage, delete: canManage }} onView={() => setOpenMs(m._id)} onEdit={() => setMsModal({ ms: m })} onDelete={() => deleteMs(m)} /></div>
                </div>
                <div style={{ margin: '12px 0 6px' }}><Progress pct={m.tasks.percent} /></div>
                <div className="text-muted" style={{ fontSize: 12 }}>{m.tasks.done}/{m.tasks.total} tasks done · {m.openRisks} open risk{m.openRisks === 1 ? '' : 's'} · {(m.evidence || []).length} evidence</div>
                {m.tasks.total === 0 && <div style={{ fontSize: 12, color: 'var(--gold)', marginTop: 4 }}>No tasks assigned yet — progress can’t be tracked.</div>}
              </div>))}</div>
          )}</div>)}

        {tab === 'risks' && (<div>
          <div className="flex-between" style={{ marginBottom: 12 }}><span className="text-muted" style={{ fontSize: 13 }}>Risks can also be raised on a single task or milestone.</span><button className="btn btn-primary btn-sm" onClick={() => setRisk(true)}><Plus size={14} /> Raise risk</button></div>
          {risks.length === 0 ? <Empty title="No risks logged" /> : (
            <div className="stack">{risks.map((r: any) => (
              <div key={r._id} className="card"><div className="flex-between" style={{ marginBottom: 6, gap: 8 }}><strong>{r.title}</strong><div className="row-gap">{r.blocking && r.status !== 'closed' && <Badge tone="danger">Blocking</Badge>}<Badge tone="neutral">{label(r.kind || 'risk')}</Badge><span className={`sev sev-${r.severity}`}>{label(r.severity)}</span><Badge tone={statusTone(r.status)}>{label(r.status)}</Badge></div></div>
                <div className="text-muted" style={{ fontSize: 12, marginBottom: 6 }}>{r.relatedTaskId ? `Task: ${nm(r.relatedTaskId)}` : r.relatedMilestoneId ? `Milestone: ${project.milestones.find((m: any) => m._id === idOf(r.relatedMilestoneId))?.title || '—'}` : 'Whole project'} · {nm(r.ownerId)}</div>
                <RichTextRenderer content={r.mitigationPlan || 'No mitigation plan recorded.'} /></div>))}</div>
          )}</div>)}

        {tab === 'meetings' && (<div>
          <div className="flex-between" style={{ marginBottom: 12 }}><span className="text-muted" style={{ fontSize: 13 }}>Meetings about this project, its tasks and milestones.</span><button className="btn btn-primary btn-sm" onClick={() => setMeet(true)}><CalendarPlus size={14} /> Schedule meeting</button></div>
          {meetings.length === 0 ? <Empty title="No meetings yet" /> : <div className="stack">{meetings.map((m: any) => (<Link key={m._id} to="/meetings" className="card flex-between"><span style={{ fontWeight: 600 }}>{m.title}</span><span className="text-muted" style={{ fontSize: 12.5 }}>{fdatetime(m.date)} · {providerLabel(m.provider)}</span></Link>))}</div>}</div>)}

        {tab === 'documents' && (<div>
          <div className="flex-between" style={{ marginBottom: 12 }}><span /><button className="btn btn-primary btn-sm" onClick={() => setDocs(true)}><Plus size={14} /> Upload documents</button></div>
          {documents.length === 0 ? <Empty title="No documents linked to this project" /> : <div className="stack">{documents.map((d: any) => (<div key={d._id} className="card flex-between"><span>{d.title}</span><Badge tone="neutral">{d.category}</Badge></div>))}</div>}</div>)}

        {tab === 'discussion' && (<div className="card">
          <Discussion entityType="project" entityId={project._id} title="Project conversation" />
          {(project.comments || []).length > 0 && (<details style={{ marginTop: 16 }}><summary className="text-muted" style={{ cursor: 'pointer', fontSize: 13 }}>Earlier notes ({project.comments.length})</summary>
            <div className="feed" style={{ marginTop: 10 }}>{[...project.comments].reverse().map((c: any) => (<div key={c._id} className={`feed-item kind-${c.kind}`}><div className="feed-meta"><strong>{nm(c.authorId) || 'Someone'}</strong><span>{label(c.kind)}</span><span>{fdatetime(c.createdAt)}</span></div><div className="feed-body">{c.body}</div></div>))}</div></details>)}
        </div>)}
      </div>

      {reqClose && <Modal open onClose={() => setReqClose(null)} title="Ask the project owner to close this project"
        footer={<><button className="btn btn-ghost" onClick={() => setReqClose(null)}>Cancel</button><button className="btn btn-primary" disabled={reqClose.comment.trim().length < 3} onClick={sendCloseRequest}>Send request</button></>}>
        <p className="text-muted" style={{ fontSize: 13 }}>Only the project owner can close a project or make it inactive. Your request is posted in the project conversation and the owner is notified.</p>
        <div className="field"><label>What should happen?</label><select className="input" value={reqClose.to} onChange={(e) => setReqClose({ ...reqClose, to: e.target.value as any })}><option value="closure">Close the project</option><option value="inactive">Make it inactive</option></select></div>
        <div className="field"><label>Why? *</label><textarea className="input" rows={3} value={reqClose.comment} onChange={(e) => setReqClose({ ...reqClose, comment: e.target.value })} placeholder="e.g. All milestones are signed off and the client has accepted delivery." /></div>
      </Modal>}
      <RaiseOpportunityModal open={raise} project={project} onClose={() => setRaise(false)} />
      <ProjectModal open={editing} project={project} onClose={() => setEditing(false)} onSaved={reload} />
      {msModal && <MilestoneModal open projectId={project._id} milestone={msModal.ms} onClose={() => setMsModal(null)} onSaved={reload} />}
      {current && <MilestoneDetail project={project} milestone={current} canManage={canManage} tasks={data.tasks} onClose={() => setOpenMs(null)} onChanged={reload} openTask={(d) => actions.openCreate(d)} />}
      <HoldReport projectId={project._id} open={hold} onClose={() => { setHold(false); reload(); }} />
      <RiskModal open={risk} onClose={() => setRisk(false)} baseUrl={`/projects/${project._id}`} onSaved={reload} subject={project.name} />
      <MeetingModal open={meet} onClose={() => setMeet(false)} onSaved={reload} context={{ projectId: project._id, title: project.name }} />
      <MultiFileUploadModal open={docs} onClose={() => setDocs(false)} onUploaded={reload} defaultCategory="Projects" relatedProjectId={id} />
      {actions.modals}
    </div>
  );
}
