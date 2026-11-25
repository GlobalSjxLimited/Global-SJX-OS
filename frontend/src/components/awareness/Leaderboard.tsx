import { useState } from 'react';
import { Link } from 'react-router-dom';
import { ArrowRight, Flame, Trophy, TrendingUp } from 'lucide-react';
import { useApi } from '@/lib/useApi';
import { useAuth } from '@/context/AuthContext';
import { Badge } from '@/components/ui/Badge';
import { label } from '@/lib/format';

const EXTERNAL = ['client', 'vendor', 'training_customer'];
const medal = (n: number) => <span className={`aw-medal ${n <= 3 ? `m${n}` : ''}`}>{n}</span>;

/** Cross-role leaderboard. Individuals are ranked by points; departments and roles by AVERAGE points so small teams compete fairly. */
export function AwarenessLeaderboard({ compact = false }: { compact?: boolean }) {
  const { user } = useAuth();
  const [period, setPeriod] = useState<'month' | 'all'>('month');
  const [view, setView] = useState<'people' | 'departments' | 'roles'>('people');
  const { data, loading } = useApi<any>(user && !EXTERNAL.includes(user.role) ? '/awareness/leaderboard' : null, { period });
  if (!user || EXTERNAL.includes(user.role)) return null;
  if (loading && !data) return null;
  if (!data) return null;
  const people: any[] = compact ? data.people.slice(0, 5) : data.people;
  const me = data.me;
  const inTop = people.some((p) => p.userId === user.id);

  return (
    <section className="card" style={{ marginBottom: compact ? 24 : 0 }}>
      <div className="flex-between" style={{ marginBottom: 10, flexWrap: 'wrap', gap: 8 }}>
        <h2 style={{ fontSize: 16, margin: 0, display: 'flex', gap: 8, alignItems: 'center' }}><Trophy size={17} /> Security leaderboard</h2>
        <div className="chips">
          <button className={`chip ${period === 'month' ? 'active' : ''}`} onClick={() => setPeriod('month')}>This month</button>
          <button className={`chip ${period === 'all' ? 'active' : ''}`} onClick={() => setPeriod('all')}>All time</button>
        </div>
      </div>
      <div className="chips" style={{ marginBottom: 8 }}>
        {(['people', 'departments', 'roles'] as const).map((v) => <button key={v} className={`chip ${view === v ? 'active' : ''}`} onClick={() => setView(v)}>{label(v)}</button>)}
      </div>

      {view === 'people' && (
        people.length ? (
          <div>
            {people.map((p) => (
              <div key={p.userId} className={`aw-rank ${p.userId === user.id ? 'aw-me' : ''}`}>
                {medal(p.rank)}
                <div style={{ minWidth: 0 }}><div style={{ fontWeight: 600, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{p.name}{p.userId === user.id ? ' (you)' : ''}</div><div className="text-muted" style={{ fontSize: 12 }}>{p.department}{p.accuracy !== null ? ` · ${p.accuracy}% correct` : ''}</div></div>
                <b>{p.points}</b>
              </div>))}
          </div>
        ) : <p className="text-muted" style={{ margin: '8px 0', fontSize: 13.5 }}>Nobody has scored yet this {period === 'month' ? 'month' : 'period'}. Answer a question to be first.</p>
      )}
      {view === 'departments' && <GroupList rows={data.departments} compact={compact} />}
      {view === 'roles' && <GroupList rows={data.roles} compact={compact} />}

      {me && (
        <div className="text-muted" style={{ fontSize: 13, marginTop: 10 }}>
          {me.hidden ? 'You are hidden from the leaderboard (change this on the Awareness page).' : me.rank ? <>You are <b style={{ color: 'var(--text)' }}>#{me.rank}</b> of {me.of} with <b style={{ color: 'var(--text)' }}>{me.points}</b> points{!inTop && view === 'people' ? ' – keep going to reach the top 10' : ''}.</> : 'You have no points yet this period – answer the next pop-up question to get on the board.'}
        </div>)}

      {!compact && data.improved?.length > 0 && period === 'month' && (
        <div style={{ marginTop: 14 }}>
          <div className="text-muted" style={{ fontSize: 12, textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 4 }}><TrendingUp size={12} style={{ verticalAlign: -1 }} /> Most improved vs last month</div>
          {data.improved.map((p: any) => <div key={p.userId} className="flex-between" style={{ fontSize: 13.5, padding: '3px 0' }}><span>{p.name} <span className="text-muted">· {p.department}</span></span><Badge tone="success">+{p.gain}</Badge></div>)}
        </div>)}

      <div className="flex-between" style={{ marginTop: 12, fontSize: 12.5 }}>
        <span className="text-muted"><Flame size={12} style={{ verticalAlign: -1 }} /> {data.participants} of {data.staff} staff have scored</span>
        {compact && <Link to="/awareness" style={{ display: 'flex', gap: 4, alignItems: 'center' }}>Take a quiz <ArrowRight size={13} /></Link>}
      </div>
    </section>
  );
}

function GroupList({ rows, compact }: { rows: any[]; compact: boolean }) {
  const list = compact ? rows.slice(0, 5) : rows;
  if (!list.length) return <p className="text-muted" style={{ fontSize: 13.5 }}>No data yet.</p>;
  const max = Math.max(1, ...list.map((r) => r.avgPoints));
  return (
    <div>
      {list.map((r, i) => (
        <div key={r.name} style={{ padding: '6px 0', borderBottom: '1px solid var(--line)' }}>
          <div className="flex-between" style={{ fontSize: 13.5 }}><span>{medal(i + 1)} <span style={{ marginLeft: 8, fontWeight: 600 }}>{label(r.name)}</span> <span className="text-muted">· {r.members} people</span></span><b>{r.avgPoints} avg</b></div>
          <div className="aw-bar" style={{ marginTop: 5 }}><span style={{ width: `${Math.round((r.avgPoints / max) * 100)}%` }} /></div>
          <div className="text-muted" style={{ fontSize: 11.5, marginTop: 2 }}>{r.participation}% taking part</div>
        </div>))}
    </div>
  );
}
