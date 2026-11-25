import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, PieChart, Pie, Cell } from 'recharts';
import { Briefcase, TrendingUp, Users, ShieldAlert, CheckCircle2, Clock } from 'lucide-react';
import { api } from '@/lib/api';
import { useAuth } from '@/context/AuthContext';
import { StatCard } from '@/components/ui/StatCard';
import { Badge, statusTone } from '@/components/ui/Badge';
import { Skeleton } from '@/components/ui/Feedback';
import { RemindersWidget } from '@/components/ui/RemindersWidget';
import { AwarenessLeaderboard } from '@/components/awareness/Leaderboard';

const PIE_COLORS = ['#C22FD4', '#F0A93B', '#3DDC97', '#6B7280', '#8C1F8C', '#5B2E8F'];

export function Dashboard() {
  const { user } = useAuth();
  const [data, setData] = useState<any>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api.get('/dashboard').then((res) => setData(res.data.data)).finally(() => setLoading(false));
  }, []);

  if (loading) {
    return (
      <div>
        <Skeleton height={30} width={260} style={{ marginBottom: 20 }} />
        <div className="stat-grid">
          {[1, 2, 3, 4].map((i) => <Skeleton key={i} height={110} />)}
        </div>
      </div>
    );
  }

  const ceo = data?.ceo;
  const coo = data?.coo;
  const sales = data?.sales;
  const employee = data?.employee;

  return (
    <div>
      <div className="page-head">
        <div>
          <h1>Welcome back, {user?.name?.split(' ')[0]}</h1>
          <p>Here's what's happening across Global SJX today.</p>
        </div>
      </div>

      <RemindersWidget />
      <AwarenessLeaderboard compact />

      {ceo && (
        <section style={{ marginBottom: 32 }}>
          <div className="stat-grid">
            <StatCard label="Open pipeline value" value={ceo.pipelineValue} prefix="₦" icon={<TrendingUp />} sub={`${ceo.pipelineCount} open opportunities`} />
            <StatCard label="Won revenue (period)" value={ceo.wonRevenue} prefix="₦" icon={<CheckCircle2 />} sub={`${ceo.wonCount} deals closed`} />
            <StatCard label="Active clients" value={ceo.activeClients} icon={<Users />} />
            <StatCard label="Open risks" value={ceo.openRisks} icon={<ShieldAlert />} sub={`${ceo.projectsAtRisk} projects flagged`} />
          </div>
        </section>
      )}

      {coo && (
        <section style={{ marginBottom: 32 }}>
          <h2 style={{ fontSize: 18, marginBottom: 14 }}>Operations</h2>
          <div className="stat-grid">
            <StatCard label="Open tasks" value={coo.openTasks} icon={<Clock />} />
            <StatCard label="Overdue tasks" value={coo.overdueTasks} icon={<Clock />} />
            <StatCard label="Active/planning projects" value={coo.projects?.length || 0} icon={<Briefcase />} />
            <StatCard label="Certifications expiring (60d)" value={coo.certExpiring?.length || 0} icon={<ShieldAlert />} />
          </div>
        </section>
      )}

      <div className="grid-2" style={{ marginBottom: 32 }}>
        {sales && (
          <div className="card">
            <div className="flex-between" style={{ marginBottom: 16 }}>
              <h3 style={{ fontSize: 16 }}>Pipeline by stage</h3>
              <Badge tone="accent">{sales.winRate}% win rate</Badge>
            </div>
            {!sales.byStage || sales.byStage.length === 0 ? (
              <div style={{ padding: '40px 0', textAlign: 'center', color: 'var(--muted)', fontSize: 13 }}>
                No opportunities in the pipeline yet.{' '}
                <Link to="/sales" style={{ color: 'var(--accent)' }}>Add one</Link>
              </div>
            ) : (
              <div style={{ width: '100%', height: 220 }}>
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={sales.byStage}>
                    <XAxis dataKey="_id" tick={{ fontSize: 11, fill: 'var(--muted)' }} axisLine={false} tickLine={false} />
                    <YAxis tick={{ fontSize: 11, fill: 'var(--muted)' }} axisLine={false} tickLine={false} allowDecimals={false} />
                    <Tooltip contentStyle={{ background: 'var(--surface)', border: '1px solid var(--line-strong)', borderRadius: 10, fontSize: 12 }} />
                    <Bar dataKey="count" fill="#C22FD4" radius={[6, 6, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            )}
          </div>
        )}

        {ceo?.companyGoals && (
          <div className="card">
            <h3 style={{ fontSize: 16, marginBottom: 16 }}>Company goals this quarter</h3>
            {ceo.companyGoals.length === 0 ? (
              <p className="text-muted" style={{ fontSize: 13 }}>No company-level goals set yet.</p>
            ) : (
              <div style={{ display: 'grid', gap: 14 }}>
                {ceo.companyGoals.map((g: any) => (
                  <div key={g._id}>
                    <div className="flex-between" style={{ marginBottom: 6 }}>
                      <span style={{ fontSize: 13, fontWeight: 600 }}>{g.title}</span>
                      <span style={{ fontSize: 12, color: 'var(--muted)' }}>{g.progressPercent}%</span>
                    </div>
                    <div style={{ height: 6, borderRadius: 10, background: 'var(--surface-3)', overflow: 'hidden' }}>
                      <div style={{ height: '100%', width: `${g.progressPercent}%`, background: 'linear-gradient(90deg,var(--accent),var(--gold))', borderRadius: 10 }} />
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {!sales && !ceo?.companyGoals && employee?.activeProjects?.length > 0 && (
          <div className="card">
            <h3 style={{ fontSize: 16, marginBottom: 16 }}>Your active projects</h3>
            <div style={{ display: 'grid', gap: 10 }}>
              {employee.activeProjects.map((p: any) => (
                <Link key={p._id} to={`/projects/${p._id}`} style={{ display: 'flex', justifyContent: 'space-between', padding: '10px 0', borderBottom: '1px solid var(--line)' }}>
                  <span style={{ fontSize: 13.5 }}>{p.name}</span>
                  <Badge tone={statusTone(p.health)}>{p.health.replace('_', ' ')}</Badge>
                </Link>
              ))}
            </div>
          </div>
        )}
      </div>

      <div className="grid-2">
        <div className="card">
          <div className="flex-between" style={{ marginBottom: 14 }}>
            <h3 style={{ fontSize: 16 }}>Today's tasks</h3>
            <Link to="/my-work" className="btn btn-ghost btn-sm">View all</Link>
          </div>
          {employee.todayTasks.length === 0 && employee.overdueTasks.length === 0 ? (
            <p className="text-muted" style={{ fontSize: 13 }}>Nothing due today — you're clear.</p>
          ) : (
            <div style={{ display: 'grid', gap: 10 }}>
              {employee.overdueTasks.slice(0, 3).map((t: any) => (
                <div key={t._id} className="flex-between">
                  <span style={{ fontSize: 13.5 }}>{t.title}</span>
                  <Badge tone="danger">overdue</Badge>
                </div>
              ))}
              {employee.todayTasks.map((t: any) => (
                <div key={t._id} className="flex-between">
                  <span style={{ fontSize: 13.5 }}>{t.title}</span>
                  <Badge tone={statusTone(t.priority)}>{t.priority}</Badge>
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="card">
          <h3 style={{ fontSize: 16, marginBottom: 14 }}>Upcoming meetings</h3>
          {employee.upcomingMeetings.length === 0 ? (
            <p className="text-muted" style={{ fontSize: 13 }}>No meetings scheduled.</p>
          ) : (
            <div style={{ display: 'grid', gap: 10 }}>
              {employee.upcomingMeetings.map((m: any) => (
                <div key={m._id} className="flex-between">
                  <span style={{ fontSize: 13.5 }}>{m.title}</span>
                  <span style={{ fontSize: 12, color: 'var(--muted)' }}>{new Date(m.date).toLocaleDateString()}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      <div className="card" style={{ marginTop: 20 }}>
        <div className="flex-between" style={{ marginBottom: 14 }}>
          <h3 style={{ fontSize: 16 }}>My training</h3>
          <Link to="/training" className="btn btn-ghost btn-sm">Browse courses</Link>
        </div>
        {employee.myEnrollments.length === 0 ? (
          <p className="text-muted" style={{ fontSize: 13 }}>Not enrolled in any courses yet.</p>
        ) : (
          <div style={{ display: 'grid', gap: 10 }}>
            {employee.myEnrollments.map((e: any) => (
              <Link key={e._id} to={`/training/${e.courseId?._id}`} className="flex-between">
                <span style={{ fontSize: 13.5 }}>{e.courseId?.title}</span>
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
  );
}
