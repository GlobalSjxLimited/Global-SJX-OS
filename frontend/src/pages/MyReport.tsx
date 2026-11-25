import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { Download } from 'lucide-react';
import { useApi } from '@/lib/useApi';
import { fdate, fdatetime, toInputDate } from '@/lib/format';
import { exportCsv, isoDate } from '@/lib/exportCsv';
import { Empty, ErrorNote, Loading, PageHead } from '@/components/ui/PageHead';
import { Badge } from '@/components/ui/Badge';
import { ProgressBar, StatusBadge } from '@/components/work/StatusBadge';
import { STATUS_LABEL, TASK_STATUSES } from '@/lib/taskStatus';

const PERIODS = [
  { key: 'daily', label: 'Today' }, { key: 'weekly', label: 'Last 7 days' }, { key: 'monthly', label: 'This month' }, { key: 'quarterly', label: 'This quarter' }, { key: 'custom', label: 'From a date…' },
];

function Stat({ title, value, hint, tone }: { title: string; value: React.ReactNode; hint?: string; tone?: 'danger' | 'gold' }) {
  return (
    <div className="stat-card" style={tone ? { borderColor: tone === 'danger' ? 'rgba(229,72,77,.5)' : 'rgba(240,169,59,.5)' } : undefined}>
      <div className="stat-label"><span>{title}</span></div><div className="stat-value">{value}</div>{hint && <div className="text-muted" style={{ fontSize: 11.5 }}>{hint}</div>}
    </div>
  );
}

/** Your own tasks and projects over a period you choose: what you were given, what you finished, what you did, what is late. */
export function MyReport() {
  const [period, setPeriod] = useState('weekly');
  const [from, setFrom] = useState(toInputDate(new Date(Date.now() - 14 * 86400000)));
  const [to, setTo] = useState('');
  const params = useMemo(() => (period === 'custom' ? { period, from, ...(to ? { to } : {}) } : { period }), [period, from, to]);
  const { data: d, loading, error } = useApi<any>('/work-reports/mine', params);
  const t = d?.totals;

  return (
    <div>
      <PageHead title="My report" subtitle="Your own tasks and projects: what you were given, what you did, what is late."
        actions={d && <button className="btn btn-ghost" onClick={() => exportCsv(`my-report-${period}`, [
          { label: 'Task', value: (r) => r.title }, { label: 'Project', value: (r) => r.project }, { label: 'Status', value: (r) => STATUS_LABEL[r.status] || r.status }, { label: '% complete', value: (r) => r.percent },
          { label: 'Severity', value: (r) => r.severity }, { label: 'Due', value: (r) => isoDate(r.due) }, { label: 'Completed', value: (r) => isoDate(r.completedAt) }, { label: 'Overdue', value: (r) => (r.overdue ? 'Yes' : '') },
        ], d.tasks)}><Download size={15} /> Export</button>} />
      <div className="filter-bar">
        <div className="seg" role="group" aria-label="Report period">{PERIODS.map((p) => <button key={p.key} className={period === p.key ? 'on' : ''} onClick={() => setPeriod(p.key)}>{p.label}</button>)}</div>
        {period === 'custom' && <>
          <label style={{ fontSize: 13 }}>Start from <input className="input" type="date" value={from} max={toInputDate(new Date())} onChange={(e) => setFrom(e.target.value)} /></label>
          <label style={{ fontSize: 13 }}>Until (optional) <input className="input" type="date" value={to} min={from} onChange={(e) => setTo(e.target.value)} /></label>
        </>}
      </div>
      <ErrorNote message={error} />
      {loading && !d ? <Loading rows={5} /> : !d ? null : (<>
        <p className="text-muted" style={{ fontSize: 13 }}>{fdate(d.from)} to {fdate(d.to)}</p>
        <div className="stat-grid" style={{ marginBottom: 20 }}>
          <Stat title="Open now" value={t.open} hint={`${t.owned} owned in total`} />
          <Stat title="Finished in this period" value={t.completedInPeriod} />
          <Stat title="Given to me in this period" value={t.createdInPeriod} />
          <Stat title="Overdue" value={t.overdue} tone={t.overdue ? 'danger' : undefined} />
          <Stat title="Due in this period" value={t.dueInPeriod} />
          <Stat title="Average progress" value={`${t.avgProgress}%`} hint="of open tasks" />
          <Stat title="Status changes I made" value={t.statusChanges} />
        </div>

        <h3 style={{ margin: '0 0 10px' }}>By status</h3>
        <div className="row-gap" style={{ marginBottom: 22 }}>{TASK_STATUSES.filter((s) => d.byStatus[s]).map((s) => <span key={s} className="chip"><StatusBadge status={s} /> <b>{d.byStatus[s]}</b></span>)}{!Object.keys(d.byStatus).length && <span className="text-muted">Nothing in this period.</span>}</div>

        <h3 style={{ margin: '0 0 10px' }}>My projects</h3>
        {d.projects.length === 0 ? <Empty title="You are not on any project yet" /> : (
          <div className="table-wrap" style={{ marginBottom: 24 }}><table className="table"><thead><tr><th>Project</th><th>My tasks</th><th>Done</th><th>Open</th><th>Overdue</th><th>Progress</th><th>My milestones</th></tr></thead>
            <tbody>{d.projects.map((p: any) => (
              <tr key={p.projectId || 'none'} style={{ cursor: 'default' }}>
                <td>{p.projectId ? <Link to={`/projects/${p.projectId}`} style={{ fontWeight: 600 }}>{p.name}</Link> : p.name}{p.iManage && <> <Badge tone="accent">I manage it</Badge></>}</td>
                <td>{p.tasks}</td><td>{p.done}</td><td>{p.open}</td><td style={{ color: p.overdue ? 'var(--danger)' : undefined }}>{p.overdue}</td><td><ProgressBar value={p.avgProgress} /></td>
                <td style={{ fontSize: 12.5 }}>{p.myMilestones.length ? p.myMilestones.map((m: any) => `${m.title} (${String(m.status).replace(/_/g, ' ')})`).join('; ') : '—'}</td>
              </tr>))}</tbody></table></div>
        )}

        <h3 style={{ margin: '0 0 10px' }}>My tasks ({d.tasks.length})</h3>
        {d.tasks.length === 0 ? <Empty title="No tasks in this period" /> : (
          <div className="table-wrap" style={{ marginBottom: 24 }}><table className="table"><thead><tr><th>Task</th><th>Project</th><th>Status</th><th>Progress</th><th>Due</th><th>Finished</th></tr></thead>
            <tbody>{d.tasks.map((r: any) => (
              <tr key={r._id} style={{ cursor: 'default' }}><td><Link to={`/tasks/${r._id}`} style={{ fontWeight: 600 }}>{r.title}</Link></td><td>{r.project || '—'}</td><td><StatusBadge status={r.status} /></td><td><ProgressBar value={r.percent} status={r.status} /></td>
                <td style={{ color: r.overdue ? 'var(--danger)' : undefined }}>{fdate(r.due)}</td><td>{fdate(r.completedAt)}</td></tr>))}</tbody></table></div>
        )}

        <h3 style={{ margin: '0 0 10px' }}>What I did ({d.activity.length})</h3>
        {d.activity.length === 0 ? <p className="text-muted" style={{ fontSize: 13 }}>No status changes in this period.</p> : (
          <ul className="stack" style={{ listStyle: 'none', margin: 0, padding: 0 }}>{d.activity.map((a: any, i: number) => (
            <li key={i} className="mini-card" style={{ fontSize: 13 }}>
              <div><Link to={`/tasks/${a.taskId}`} style={{ fontWeight: 600 }}>{a.task}</Link>{a.project ? <span className="text-muted"> · {a.project}</span> : null}</div>
              <div><b>{a.from ? `${STATUS_LABEL[a.from] || a.from} → ` : ''}{STATUS_LABEL[a.to] || a.to}</b>{typeof a.percent === 'number' ? ` · ${a.percent}%` : ''}</div>
              {a.comment && <div className="text-muted">{a.comment}</div>}
              <div className="text-muted" style={{ fontSize: 11.5 }}>{fdatetime(a.at)}{a.device ? ` · ${a.device}` : ''}</div>
            </li>))}</ul>
        )}
      </>)}
    </div>
  );
}
