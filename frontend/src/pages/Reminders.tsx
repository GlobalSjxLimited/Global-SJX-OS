import { useNavigate } from 'react-router-dom';
import { BellRing, AlertTriangle, ShieldAlert, Info, Play } from 'lucide-react';
import { api, apiErrorMessage } from '@/lib/api';
import { useAuth } from '@/context/AuthContext';
import { useToast } from '@/context/ToastContext';
import { useApi } from '@/lib/useApi';
import { PageHead, Empty, Loading, ErrorNote } from '@/components/ui/PageHead';
import { Badge } from '@/components/ui/Badge';
import { fdate, label } from '@/lib/format';

const SEV: Record<string, { tone: 'danger' | 'gold' | 'accent' | 'neutral'; icon: any; name: string }> = {
  critical: { tone: 'danger', icon: ShieldAlert, name: 'Critical' },
  high: { tone: 'danger', icon: AlertTriangle, name: 'High' },
  warning: { tone: 'gold', icon: AlertTriangle, name: 'Action needed' },
  info: { tone: 'neutral', icon: Info, name: 'For your attention' },
};

export function Reminders() {
  const navigate = useNavigate();
  const { user } = useAuth();
  const { showError, showSuccess } = useToast();
  const { data, loading, error, reload } = useApi<{ items: any[]; counts: { total: number; critical: number; high: number } }>('/reminders');
  const admin = user?.role === 'super_admin' || user?.role === 'ceo';
  return (
    <div className="page-enter">
      <PageHead title="Reminders" subtitle="Everything that needs you — certificates, policies, approvals, deadlines, reviews. Also e-mailed every morning."
        actions={admin && <button className="btn btn-ghost" onClick={async () => { try { const r = await api.post('/reminders/run'); showSuccess(`${r.data.data.sent} notification(s) sent.`); reload(); } catch (e) { showError(apiErrorMessage(e)); } }}><Play size={14} /> Run reminder engine now</button>} />
      <ErrorNote message={error} />
      {loading && !data ? <Loading /> : !data?.items.length ? <Empty icon={<BellRing />} title="You're all caught up" hint="Nothing needs your attention right now." /> : (
        <div style={{ display: 'grid', gap: 10 }}>
          {data.items.map((r, i) => {
            const s = SEV[r.severity] || SEV.info; const Icon = s.icon;
            return (
              <button key={i} className="card" onClick={() => navigate(r.link)} style={{ textAlign: 'left', display: 'flex', gap: 14, alignItems: 'center', cursor: 'pointer', borderLeft: `3px solid var(--${s.tone === 'danger' ? 'danger' : s.tone === 'gold' ? 'gold' : 'border'})` }}>
                <Icon size={20} />
                <div style={{ flex: 1 }}><div style={{ fontWeight: 600 }}>{r.title}</div><div className="text-muted" style={{ fontSize: 12.5 }}>{label(r.type)}{r.detail ? ` · ${r.detail}` : ''}{r.due ? ` · due ${fdate(r.due)}` : ''}</div></div>
                <Badge tone={s.tone}>{s.name}</Badge>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
