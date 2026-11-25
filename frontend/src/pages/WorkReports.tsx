import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { Download } from 'lucide-react';
import { useApi } from '@/lib/useApi';
import { api } from '@/lib/api';
import { fdate, label } from '@/lib/format';
import { Badge, statusTone } from '@/components/ui/Badge';
import { Empty, ErrorNote, Loading, PageHead } from '@/components/ui/PageHead';
import { QuarterFilter } from '@/components/work/QuarterFilter';
import { PeoplePicker, usePeople } from '@/components/work/PeoplePicker';
import { SeverityBadge } from '@/components/work/SeverityBadge';
import { quarterOf } from '@/lib/quarter';

function Stat({ title, value, tone, hint, to }: { title: string; value: React.ReactNode; tone?: 'danger' | 'gold'; hint?: string; to?: string }) {
  const body = (
    <div className="stat-card" style={tone ? { borderColor: tone === 'danger' ? 'rgba(229,72,77,.5)' : 'rgba(240,169,59,.5)' } : undefined}>
      <div className="stat-label"><span>{title}</span></div>
      <div className="stat-value">{value}</div>
      {hint && <div className="text-muted" style={{ fontSize: 11.5, marginTop: 2 }}>{hint}</div>}
    </div>
  );
  return to ? <Link to={to}>{body}</Link> : body;
}

function Bar({ pct }: { pct: number }) { return <div className="progress" style={{ minWidth: 90 }}><span style={{ width: `${pct}%` }} /></div>; }

export function WorkReports() {
  const [quarter, setQuarter] = useState(quarterOf());
  const [projectId, setProjectId] = useState('');
  const [ownerId, setOwnerId] = useState('');
  const [projects, setProjects] = useState<any[]>([]);
  useEffect(() => { api.get('/projects').then((r) => setProjects(r.data.data)).catch(() => undefined); }, []);
  usePeople();
  const params = useMemo(() => ({ ...(quarter ? { quarter } : {}), ...(projectId ? { projectId } : {}), ...(ownerId ? { ownerId } : {}) }), [quarter, projectId, ownerId]);
  const { data: d, loading, error } = useApi<any>('/work-reports/summary', params);


  const t = d?.totals;
  return (
    <div>
      <PageHead title="Work reports" subtitle="Who has been given what, what is waiting for sign-off, and what is getting in the way."
        actions={<Link to="/reports" className="btn btn-ghost btn-sm"><Download size={14} /> Export from Reports centre</Link>} />
      <div className="filter-bar">
        <QuarterFilter value={quarter} onChange={setQuarter} />
        <select className="input" value={projectId} onChange={(e) => setProjectId(e.target.value)}><option value="">All projects</option>{projects.map((p) => <option key={p._id} value={p._id}>{p.name}</option>)}</select>
        <div style={{ minWidth: 240 }}><PeoplePicker single value={ownerId ? [ownerId] : []} onChange={(ids) => setOwnerId(ids[0] || '')} placeholder="Filter by person…" /></div>
      </div>
      <ErrorNote message={error} />
      {loading && !d ? <Loading rows={6} /> : !d ? null : (<>
        <div className="stat-grid" style={{ marginBottom: 22 }}>
          <Stat title="Tasks assigned" value={t.assigned} hint={`${t.tasks} tasks · ${t.subtasks} subtasks`} />
          <Stat title="Awaiting approval" value={t.awaitingApproval} tone={t.awaitingApproval ? 'gold' : undefined} to="/tasks?tab=approvals" />
          <Stat title="Done" value={`${t.done}`} hint={`${t.completionRate}% completion`} />
          <Stat title="In progress" value={t.inProgress} />
          <Stat title="Blocked" value={t.blocked} tone={t.blocked ? 'danger' : undefined} />
          <Stat title="Overdue" value={t.overdue} tone={t.overdue ? 'danger' : undefined} />
          <Stat title="Critical open" value={t.criticalOpen} tone={t.criticalOpen ? 'danger' : undefined} />
          <Stat title="Created from e-mail" value={t.fromEmail} />
        </div>

        <h3 style={{ margin: '0 0 10px' }}>Tasks assigned to each person</h3>
        {d.byUser.length === 0 ? <Empty title="No tasks in this period" /> : (
          <div className="table-wrap" style={{ marginBottom: 24 }}><table className="table"><thead><tr><th>Person</th><th>Assigned</th><th>To do</th><th>In progress</th><th>Blocked</th><th>Awaiting approval</th><th>Done</th><th>Overdue</th><th style={{ width: 140 }}>Completion</th></tr></thead>
            <tbody>{d.byUser.map((u: any) => (<tr key={u.userId}><td><strong>{u.name}</strong></td><td>{u.assigned}</td><td>{u.todo}</td><td>{u.inProgress}</td><td style={{ color: u.blocked ? 'var(--danger)' : undefined }}>{u.blocked}</td><td style={{ color: u.awaitingApproval ? 'var(--gold)' : undefined }}>{u.awaitingApproval}</td><td>{u.done}</td><td style={{ color: u.overdue ? 'var(--danger)' : undefined }}>{u.overdue}</td><td><Bar pct={u.completionRate} /></td></tr>))}</tbody></table></div>
        )}

        <div className="grid-2" style={{ marginBottom: 24, alignItems: 'start' }}>
          <div><h3 style={{ margin: '0 0 10px' }}>By project</h3>
            <div className="table-wrap"><table className="table"><thead><tr><th>Project</th><th>Tasks</th><th>Done</th><th>Awaiting</th><th>Blocked</th></tr></thead>
              <tbody>{d.byProject.map((p: any) => (<tr key={p.projectId || 'none'}><td>{p.projectId ? <Link to={`/projects/${p.projectId}`}>{p.name}</Link> : p.name}</td><td>{p.assigned}</td><td>{p.done}</td><td>{p.awaitingApproval}</td><td>{p.blocked}</td></tr>))}</tbody></table></div></div>
          <div><h3 style={{ margin: '0 0 10px' }}>By severity</h3>
            <div className="table-wrap"><table className="table"><thead><tr><th>Severity</th><th>Total</th><th>Still open</th></tr></thead>
              <tbody>{d.bySeverity.map((s: any) => (<tr key={s.severity}><td><SeverityBadge value={s.severity} /></td><td>{s.total}</td><td>{s.open}</td></tr>))}</tbody></table></div></div>
        </div>

        <h3 style={{ margin: '0 0 10px' }}>Awaiting approval ({d.awaitingApproval.length})</h3>
        {d.awaitingApproval.length === 0 ? <div className="callout ok" style={{ marginBottom: 24 }}>Nothing is waiting for sign-off.</div> : (
          <div className="table-wrap" style={{ marginBottom: 24 }}><table className="table"><thead><tr><th>Task title</th><th>Done by</th><th>Approver</th><th>Project</th><th>Severity</th><th>Waiting</th></tr></thead>
            <tbody>{d.awaitingApproval.map((a: any) => (<tr key={a.taskId}><td><Link to={`/tasks/${a.taskId}`} style={{ fontWeight: 600 }}>{a.title}</Link></td><td>{a.owner}</td><td>{a.approver}</td><td>{a.project || '—'}</td><td><SeverityBadge value={a.severity} /></td><td style={{ color: a.waitingDays >= 3 ? 'var(--danger)' : undefined }}>{a.waitingDays} day{a.waitingDays === 1 ? '' : 's'}</td></tr>))}</tbody></table></div>
        )}

        <h3 style={{ margin: '0 0 10px' }}>Milestones</h3>
        {d.milestones.length === 0 ? <Empty title="No milestones" /> : (
          <div className="table-wrap" style={{ marginBottom: 24 }}><table className="table"><thead><tr><th>Milestone title</th><th>Project</th><th>Severity</th><th>Status</th><th>Owner</th><th>Ends</th><th style={{ width: 150 }}>Progress</th></tr></thead>
            <tbody>{d.milestones.map((m: any) => (<tr key={m.milestoneId}><td><strong>{m.title}</strong></td><td><Link to={`/projects/${m.projectId}`}>{m.project}</Link></td><td><SeverityBadge value={m.severity} /></td><td><Badge tone={statusTone(m.status)}>{label(m.status)}</Badge></td><td>{m.owner || '—'}</td><td>{fdate(m.endDate)}</td><td>{m.noTasks ? <span className="text-muted" style={{ fontSize: 12 }}>No tasks</span> : <Bar pct={m.percent ?? 0} />}</td></tr>))}</tbody></table></div>
        )}

        <div className="stat-grid">
          <Stat title="Open risks" value={d.risks.total} hint={`${d.risks.blocking} halting work · ${d.risks.critical} critical`} tone={d.risks.blocking ? 'danger' : undefined} to="/risks" />
          <Stat title="Meetings missing a recording" value={d.meetingsMissingRecordings} tone={d.meetingsMissingRecordings ? 'gold' : undefined} to="/meetings" />
          <Stat title="Goals" value={`${d.goals.completed}/${d.goals.total}`} hint={`${d.goals.verified} verified · ${d.goals.avgProgress}% average`} to="/goals" />
        </div>
      </>)}
    </div>
  );
}
