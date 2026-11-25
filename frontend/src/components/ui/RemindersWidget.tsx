import { Link } from 'react-router-dom';
import { BellRing, ArrowRight } from 'lucide-react';
import { useApi } from '@/lib/useApi';
import { Badge } from '@/components/ui/Badge';
import { fdate } from '@/lib/format';

const TONE: Record<string, any> = { critical: 'danger', high: 'danger', warning: 'gold', info: 'neutral' };

/** Top reminders for the signed-in person; hidden when there is nothing to do. */
export function RemindersWidget() {
  const { data } = useApi<{ items: any[]; counts: { total: number; critical: number; high: number } }>('/reminders');
  if (!data?.items.length) return null;
  return (
    <section className="card" style={{ marginBottom: 24 }}>
      <div className="flex-between" style={{ marginBottom: 10 }}>
        <h2 style={{ fontSize: 16, margin: 0, display: 'flex', gap: 8, alignItems: 'center' }}><BellRing size={17} /> Needs your attention <Badge tone={data.counts.critical ? 'danger' : 'gold'}>{data.counts.total}</Badge></h2>
        <Link to="/reminders" style={{ fontSize: 13, display: 'flex', gap: 4, alignItems: 'center' }}>All reminders <ArrowRight size={13} /></Link>
      </div>
      <div style={{ display: 'grid', gap: 6 }}>
        {data.items.slice(0, 5).map((r, i) => (
          <Link key={i} to={r.link} className="flex-between" style={{ fontSize: 13.5, padding: '6px 0', borderBottom: '1px solid var(--line)' }}>
            <span>{r.title}{r.due ? <span className="text-muted"> · due {fdate(r.due)}</span> : null}</span><Badge tone={TONE[r.severity]}>{r.severity}</Badge>
          </Link>))}
      </div>
    </section>
  );
}
