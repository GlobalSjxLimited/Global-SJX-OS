import { useState } from 'react';
import { Link } from 'react-router-dom';
import { Radar, RefreshCw, Plus, EyeOff } from 'lucide-react';
import { api, apiErrorMessage } from '@/lib/api';
import { useApi } from '@/lib/useApi';
import { useToast } from '@/context/ToastContext';
import { Badge } from '@/components/ui/Badge';
import { Loading } from '@/components/ui/PageHead';

const TONE: Record<string, any> = { Major: 'danger', Moderate: 'gold', Minor: 'success' };

/** Threats and risks the asset is exposed to, as worked out by the asset risk engine. */
export function AssetRiskPanel({ assetId, onChanged }: { assetId: string; onChanged?: () => void }) {
  const { data, loading, error, reload } = useApi<any>(`/asset-risk/${assetId}`);
  const { showError, showSuccess } = useToast();
  const [dismiss, setDismiss] = useState<{ key: string; reason: string } | null>(null);
  const [busy, setBusy] = useState(false);
  async function run(fn: () => Promise<any>, ok: string) {
    setBusy(true);
    try { await fn(); showSuccess(ok); reload(); onChanged?.(); } catch (e) { showError(apiErrorMessage(e)); } finally { setBusy(false); }
  }
  if (loading && !data) return <Loading />;
  if (error || !data) return null;
  const p = data;
  const rows: any[] = [...p.rows].sort((a, b) => b.exposure - a.exposure);
  return (
    <div className="card" style={{ display: 'grid', gap: 10 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
        <strong style={{ display: 'flex', alignItems: 'center', gap: 6 }}><Radar size={15} /> Threats &amp; risks</strong>
        <Badge tone="success">{p.totals.registered} on the risk register</Badge>
        {p.totals.suggested > 0 && <Badge tone="gold">{p.totals.suggested} suggested</Badge>}
        {p.totals.dismissed > 0 && <Badge tone="neutral">{p.totals.dismissed} not applicable</Badge>}
        <span style={{ flex: 1 }} />
        <Link to="/isms?register=risk" className="btn btn-ghost btn-sm">Risk register</Link>
        {p.canManage && <button className="btn btn-ghost btn-sm" disabled={busy} onClick={() => run(() => api.post(`/asset-risk/${assetId}/evaluate`), 'Re-evaluated.')}><RefreshCw size={13} /> Re-evaluate</button>}
      </div>
      {!p.inService && <div className="text-muted" style={{ fontSize: 12.5 }}>This asset is not in service, so no risks are raised. They are created when it goes live.</div>}
      <div className="text-muted" style={{ fontSize: 12 }}>Threats scoring {p.autoThreshold} or more are added to the risk register automatically and the owner is told. Lower ones are suggestions.</div>
      {p.intel?.length > 0 && <div style={{ fontSize: 12.5 }}>Live threat intelligence matching this asset: {p.intel.map((i: any) => <Badge key={i.reference} tone={i.severity === 'critical' || i.severity === 'high' ? 'danger' : 'gold'}>{i.reference} · {i.title}</Badge>)}</div>}
      <div style={{ display: 'grid', gap: 8 }}>
        {rows.map((r) => (
          <div key={r.key} style={{ borderLeft: `3px solid var(--${r.classification === 'Major' ? 'danger' : r.classification === 'Moderate' ? 'gold' : 'border'})`, paddingLeft: 10, opacity: r.state === 'dismissed' ? 0.6 : 1 }}>
            <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
              <strong style={{ fontSize: 13 }}>{r.name}</strong>
              <Badge tone={TONE[r.classification]}>{r.classification} · {r.impact}×{r.likelihood}={r.exposure}</Badge>
              {r.state === 'registered' && r.risk && <Badge tone="success">{r.risk.refNo} · {r.risk.status}</Badge>}
              {r.state === 'dismissed' && <Badge tone="neutral">not applicable</Badge>}
              <span style={{ flex: 1 }} />
              {p.canManage && r.state === 'suggested' && <button className="btn btn-ghost btn-sm" disabled={busy} onClick={() => run(() => api.post(`/asset-risk/${assetId}/accept`, { key: r.key }), 'Added to the risk register.')}><Plus size={12} /> Add to register</button>}
              {p.canManage && r.state !== 'dismissed' && <button className="btn btn-ghost btn-sm" disabled={busy} onClick={() => setDismiss({ key: r.key, reason: '' })}><EyeOff size={12} /> Not applicable</button>}
            </div>
            <div className="text-muted" style={{ fontSize: 12.5 }}>{r.vulnerability}</div>
            <div className="text-muted" style={{ fontSize: 12 }}>{r.reasons.join(' · ')} · Annex A {r.soa}</div>
            {r.state === 'dismissed' && <div className="text-muted" style={{ fontSize: 12 }}>Reason: {r.dismissedReason}</div>}
            {dismiss && dismiss.key === r.key && (
              <div style={{ display: 'flex', gap: 6, marginTop: 6 }}>
                <input className="input" autoFocus placeholder="Why does this not apply? (min 10 characters)" value={dismiss.reason} onChange={(e) => setDismiss({ key: r.key, reason: e.target.value })} />
                <button className="btn btn-primary btn-sm" disabled={busy || dismiss.reason.trim().length < 10} onClick={() => run(async () => { await api.post(`/asset-risk/${assetId}/dismiss`, { key: r.key, reason: dismiss.reason }); setDismiss(null); }, 'Marked not applicable.')}>Save</button>
                <button className="btn btn-ghost btn-sm" onClick={() => setDismiss(null)}>Cancel</button>
              </div>
            )}
          </div>
        ))}
        {!rows.length && <div className="text-muted" style={{ fontSize: 12.5 }}>No threats apply.</div>}
      </div>
    </div>
  );
}
