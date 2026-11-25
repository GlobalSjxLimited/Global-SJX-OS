import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '@/lib/api';
import { Badge, statusTone } from '@/components/ui/Badge';
import { Skeleton } from '@/components/ui/Feedback';

export function MyWork() {
  const [data, setData] = useState<any>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api.get('/dashboard').then((res) => setData(res.data.data.employee)).finally(() => setLoading(false));
  }, []);

  if (loading) return <Skeleton height={300} />;

  return (
    <div>
      <div className="page-head">
        <div>
          <h1>My Work</h1>
          <p>What you need to do today, what's overdue, and what's coming next.</p>
        </div>
      </div>

      <div className="grid-2" style={{ marginBottom: 24 }}>
        <div className="card">
          <h3 style={{ fontSize: 16, marginBottom: 14 }}>Overdue ({data.overdueTasks.length})</h3>
          <TaskList tasks={data.overdueTasks} tone="danger" empty="Nothing overdue." />
        </div>
        <div className="card">
          <h3 style={{ fontSize: 16, marginBottom: 14 }}>Due today ({data.todayTasks.length})</h3>
          <TaskList tasks={data.todayTasks} empty="Nothing due today." />
        </div>
      </div>

      <div className="grid-2" style={{ marginBottom: 24 }}>
        <div className="card">
          <h3 style={{ fontSize: 16, marginBottom: 14 }}>Due this week ({data.upcomingTasks.length})</h3>
          <TaskList tasks={data.upcomingTasks} empty="Nothing due in the next 7 days." />
        </div>
        <div className="card">
          <h3 style={{ fontSize: 16, marginBottom: 14 }}>My goals</h3>
          {data.goals.length === 0 ? (
            <p className="text-muted" style={{ fontSize: 13 }}>No personal goals set for this quarter.</p>
          ) : (
            <div style={{ display: 'grid', gap: 12 }}>
              {data.goals.map((g: any) => (
                <div key={g._id}>
                  <div className="flex-between" style={{ marginBottom: 6 }}>
                    <span style={{ fontSize: 13 }}>{g.title}</span>
                    <span style={{ fontSize: 12, color: 'var(--muted)' }}>{g.progressPercent}%</span>
                  </div>
                  <div style={{ height: 6, borderRadius: 10, background: 'var(--surface-3)' }}>
                    <div style={{ height: '100%', width: `${g.progressPercent}%`, background: 'var(--accent)', borderRadius: 10 }} />
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      <div className="grid-2">
        <div className="card">
          <h3 style={{ fontSize: 16, marginBottom: 14 }}>My certifications</h3>
          {data.certifications.length === 0 ? (
            <p className="text-muted" style={{ fontSize: 13 }}>No certifications on file yet.</p>
          ) : (
            <div style={{ display: 'grid', gap: 10 }}>
              {data.certifications.map((c: any) => (
                <div key={c._id} className="flex-between">
                  <span style={{ fontSize: 13 }}>{c.name}</span>
                  <Badge tone={statusTone(c.status)}>{c.status.replace('_', ' ')}</Badge>
                </div>
              ))}
            </div>
          )}
        </div>
        <div className="card">
          <h3 style={{ fontSize: 16, marginBottom: 14 }}>My training</h3>
          {data.myEnrollments.length === 0 ? (
            <p className="text-muted" style={{ fontSize: 13 }}>
              No enrollments yet — visit <Link to="/training" style={{ color: 'var(--accent)' }}>Training</Link> to get started.
            </p>
          ) : (
            <div style={{ display: 'grid', gap: 10 }}>
              {data.myEnrollments.map((e: any) => (
                <Link key={e._id} to={`/training/${e.courseId?._id}`} className="flex-between">
                  <span style={{ fontSize: 13 }}>{e.courseId?.title}</span>
                  <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                    <Badge tone="success">Enrolled</Badge>
                    <Badge tone={statusTone(e.status)}>{e.progressPercent}%</Badge>
                  </div>
                </Link>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function TaskList({ tasks, tone, empty }: { tasks: any[]; tone?: 'danger'; empty: string }) {
  if (tasks.length === 0) return <p className="text-muted" style={{ fontSize: 13 }}>{empty}</p>;
  return (
    <div style={{ display: 'grid', gap: 10 }}>
      {tasks.map((t) => (
        <Link key={t._id} to={`/tasks/${t._id}`} className="flex-between">
          <span style={{ fontSize: 13.5 }}>{t.title}</span>
          <Badge tone={tone || statusTone(t.priority)}>{tone ? 'overdue' : t.priority}</Badge>
        </Link>
      ))}
    </div>
  );
}
