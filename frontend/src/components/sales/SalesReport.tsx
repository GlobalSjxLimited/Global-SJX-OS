import { useApi } from '@/lib/useApi';
import { Empty, ErrorNote, Loading } from '@/components/ui/PageHead';
import { Badge } from '@/components/ui/Badge';
import { fdate } from '@/lib/format';

const money = (n: number) => `₦${Math.round(n || 0).toLocaleString()}`;
const TONE: Record<string, 'success' | 'gold' | 'neutral'> = { good: 'success', warn: 'gold', info: 'neutral' };

function Stat({ title, value, hint }: { title: string; value: React.ReactNode; hint?: string }) {
  return <div className="stat-card"><div className="stat-label"><span>{title}</span></div><div className="stat-value" style={{ fontSize: 24 }}>{value}</div>{hint && <div className="text-muted" style={{ fontSize: 11.5 }}>{hint}</div>}</div>;
}
function Section({ title, sub, children }: { title: string; sub: string; children: React.ReactNode }) {
  return <section className="card" style={{ marginBottom: 16 }}><h3 style={{ fontSize: 16, margin: 0 }}>{title}</h3><p className="text-muted" style={{ fontSize: 13, margin: '2px 0 12px' }}>{sub}</p>{children}</section>;
}

/** Four questions: what are we doing now, what happened, how do we convert what is open, how do we get better. */
export function SalesReport({ params, open }: { params: Record<string, any>; open: (id: string) => void }) {
  const { data: d, loading, error } = useApi<any>('/opportunities/report', params);
  if (loading && !d) return <Loading rows={5} />;
  if (error) return <ErrorNote message={error} />;
  if (!d) return null;
  const o = d.overview;
  const by = (area: string) => (d.insights as any[]).filter((i) => i.area === area);
  const list = (items: any[], empty: string) => !items.length ? <p className="text-muted" style={{ fontSize: 13, margin: 0 }}>{empty}</p> : (
    <ul className="stack" style={{ listStyle: 'none', margin: 0, padding: 0 }}>{items.map((i, k) => (
      <li key={k} className="mini-card" style={{ display: 'flex', gap: 10, alignItems: 'flex-start', cursor: i.oppId ? 'pointer' : 'default' }} onClick={() => i.oppId && open(i.oppId)}><Badge tone={TONE[i.severity]}>{i.severity === 'good' ? 'Good' : i.severity === 'warn' ? 'Act' : 'Note'}</Badge><span style={{ fontSize: 13.5 }}>{i.text}</span></li>))}</ul>
  );
  return (
    <div style={{ marginTop: 16 }}>
      <div className="stat-grid" style={{ marginBottom: 18 }}>
        <Stat title="Open now" value={o.open} hint={money(o.openValue)} /><Stat title="Weighted pipeline" value={money(o.weightedValue)} hint="value × probability" />
        <Stat title="Win rate" value={`${o.winRate}%`} hint={`${o.won} won · ${o.lost} lost`} /><Stat title="Won value" value={money(o.wonValue)} hint={`avg ${money(o.avgDealSize)}`} />
        <Stat title="Sales cycle" value={`${o.avgCycleDays} days`} hint="first contact to won" /><Stat title="Need attention" value={d.stalled.length + d.overdueActions} hint={`${d.stalled.length} stalled · ${d.overdueActions} overdue actions`} />
      </div>

      <Section title="What we are doing now" sub="Where the open money sits, and how deals flow from one stage to the next.">
        {list(by('current'), 'Nothing open.')}
        <div className="table-wrap" style={{ marginTop: 12 }}><table className="table"><thead><tr><th>Stage</th><th>Open now</th><th>Value</th><th>Ever reached</th><th>Went on to the next stage</th><th>Avg days here</th></tr></thead>
          <tbody>{d.funnel.map((f: any, i: number) => (<tr key={f.stage} style={{ cursor: 'default' }}><td><strong>{f.stage}</strong></td><td>{f.now}</td><td>{money(f.value)}</td><td>{f.reached}</td>
            <td><div style={{ display: 'flex', gap: 8, alignItems: 'center' }}><div style={{ width: 90, height: 6, background: 'var(--border)', borderRadius: 4 }}><div style={{ width: `${f.toNextPct}%`, height: '100%', background: f.toNextPct < 40 ? 'var(--danger, #e5484d)' : 'var(--accent)', borderRadius: 4 }} /></div>{f.toNextPct}%</div></td>
            <td>{d.timeInStage[i]?.avgDays ? `${d.timeInStage[i].avgDays}` : '—'}</td></tr>))}</tbody></table></div>
      </Section>

      <Section title="What happened" sub="Results so far and the latest movements.">
        {list(by('happened'), 'No closed deals yet.')}
        {d.happened.length > 0 && <div className="table-wrap" style={{ marginTop: 12 }}><table className="table"><thead><tr><th>When</th><th>Opportunity</th><th>Moved</th><th>Comment</th><th>By</th></tr></thead>
          <tbody>{d.happened.slice(0, 15).map((h: any, i: number) => (<tr key={i} onClick={() => open(h.oppId)} style={{ cursor: 'pointer' }}><td>{fdate(h.at)}</td><td><strong>{h.title}</strong><div className="text-muted" style={{ fontSize: 12 }}>{h.client || ''}</div></td><td>{h.from ? `${h.from} → ` : ''}{h.to}</td><td style={{ fontSize: 12.5 }}>{h.comment}</td><td>{h.by}</td></tr>))}</tbody></table></div>}
      </Section>

      <Section title="How to convert what is open" sub="Specific deals that need a push today.">
        {list(by('convert'), 'Nothing is stuck. Keep the next actions dated.')}
        {d.stalled.length > 0 && <div className="table-wrap" style={{ marginTop: 12 }}><table className="table"><thead><tr><th>Stalled deal</th><th>Stage</th><th>Value</th><th>Idle</th></tr></thead>
          <tbody>{d.stalled.map((s: any) => (<tr key={s.oppId} onClick={() => open(s.oppId)} style={{ cursor: 'pointer' }}><td><strong>{s.title}</strong><div className="text-muted" style={{ fontSize: 12 }}>{s.client || ''}</div></td><td>{s.stage}</td><td>{money(s.value)}</td><td style={{ color: 'var(--danger)' }}>{s.idleDays} days</td></tr>))}</tbody></table></div>}
      </Section>

      <Section title="How to improve" sub="Patterns across every deal in this period.">
        {list(by('improve'), 'Not enough data yet to see a pattern.')}
        <div className="grid-2" style={{ marginTop: 14, alignItems: 'start' }}>
          <div><h4 style={{ margin: '0 0 8px', fontSize: 14 }}>Why we lose</h4>{d.lostReasons.length === 0 ? <p className="text-muted" style={{ fontSize: 13 }}>No lost deals with a reason yet.</p> : <ul style={{ margin: 0, paddingLeft: 18, fontSize: 13.5 }}>{d.lostReasons.map((r: any) => <li key={r.reason}>{r.reason}: <b>{r.count}</b></li>)}</ul>}
            <h4 style={{ margin: '14px 0 8px', fontSize: 14 }}>Why we win</h4>{d.winReasons.length === 0 ? <p className="text-muted" style={{ fontSize: 13 }}>No reasons recorded yet. Ask for one when closing a win.</p> : <ul style={{ margin: 0, paddingLeft: 18, fontSize: 13.5 }}>{d.winReasons.map((r: any) => <li key={r.reason}>{r.reason}: <b>{r.count}</b></li>)}</ul>}</div>
          <div><h4 style={{ margin: '0 0 8px', fontSize: 14 }}>Where deals come from</h4>
            {d.bySource.length === 0 ? <Empty title="No data" /> : <div className="table-wrap"><table className="table"><thead><tr><th>Source</th><th>Deals</th><th>Won</th><th>Win rate</th></tr></thead><tbody>{d.bySource.map((s: any) => <tr key={s.source} style={{ cursor: 'default' }}><td>{s.source}</td><td>{s.total}</td><td>{s.won}</td><td>{s.won + s.lost ? `${s.winRate}%` : '—'}</td></tr>)}</tbody></table></div>}</div>
        </div>
        {d.bySalesperson.length > 0 && <div className="table-wrap" style={{ marginTop: 14 }}><table className="table"><thead><tr><th>Salesperson</th><th>Open</th><th>Open value</th><th>Won</th><th>Lost</th><th>Win rate</th><th>Won value</th></tr></thead>
          <tbody>{d.bySalesperson.map((p: any) => (<tr key={p.id} style={{ cursor: 'default' }}><td><strong>{p.name}</strong></td><td>{p.open}</td><td>{money(p.openValue)}</td><td>{p.won}</td><td>{p.lost}</td><td>{p.won + p.lost ? `${p.winRate}%` : '—'}</td><td>{money(p.wonValue)}</td></tr>))}</tbody></table></div>}
      </Section>
    </div>
  );
}
