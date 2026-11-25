import { useState } from 'react';
import { Check, Lightbulb, X } from 'lucide-react';
import { api, apiErrorMessage } from '@/lib/api';
import { useApi } from '@/lib/useApi';
import { useToast } from '@/context/ToastContext';
import { Badge } from '@/components/ui/Badge';
import { Loading } from '@/components/ui/PageHead';

const LEVEL = ['Rare', 'Unlikely', 'Possible', 'Likely', 'Almost certain'];
const IMPACT = ['Negligible', 'Minor', 'Moderate', 'Major', 'Severe'];
const TONE: Record<string, any> = { Major: 'danger', Moderate: 'gold', Minor: 'success' };

export function HeatMap() {
  const [view, setView] = useState<'inherent' | 'residual'>('inherent');
  const { data, loading } = useApi<any>('/isms/heatmap', { view });
  const [sel, setSel] = useState<string>('');
  if (loading && !data) return <Loading rows={3} />;
  if (!data) return null;
  const cell = (impact: number, likelihood: number) => data.grid.find((c: any) => c.impact === impact && c.likelihood === likelihood);
  const chosen = sel ? data.grid.find((c: any) => `${c.impact}-${c.likelihood}` === sel) : null;
  return (
    <div className="card" style={{ marginBottom: 14 }}>
      <div className="flex-between" style={{ flexWrap: 'wrap', gap: 8, marginBottom: 10 }}>
        <b>Risk heat map</b>
        <div className="chips"><button className={`chip ${view === 'inherent' ? 'active' : ''}`} onClick={() => setView('inherent')}>Before treatment</button><button className={`chip ${view === 'residual' ? 'active' : ''}`} onClick={() => setView('residual')}>After treatment (residual)</button></div>
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0,1fr) minmax(0,240px)', gap: 16, alignItems: 'start' }}>
        <div>
          <div className="hm-grid" role="grid" aria-label="Risk heat map: likelihood against impact">
            {[5, 4, 3, 2, 1].map((l) => (
              <div key={l} style={{ display: 'contents' }}>
                <div className="hm-axis" title={LEVEL[l - 1]}>{l}</div>
                {[1, 2, 3, 4, 5].map((i) => { const c = cell(i, l); return (
                  <button key={i} type="button" className={`hm-cell ${c.class} ${c.count ? 'has' : 'empty'} ${sel === `${i}-${l}` ? 'sel' : ''}`} onClick={() => c.count && setSel(sel === `${i}-${l}` ? '' : `${i}-${l}`)} title={`Impact ${IMPACT[i - 1]} × likelihood ${LEVEL[l - 1]} = ${c.score} (${c.class}) – ${c.count} risk(s)`} aria-label={`Impact ${i}, likelihood ${l}, score ${c.score}, ${c.count} risks`}>
                    {c.count ? <span className="hm-count">{c.count}</span> : null}<span style={{ opacity: 0.8 }}>{c.score}</span>
                  </button>); })}
              </div>))}
            <div />{[1, 2, 3, 4, 5].map((i) => <div key={i} className="hm-axis" title={IMPACT[i - 1]}>{i}</div>)}
          </div>
          <div className="text-muted" style={{ fontSize: 11.5, marginTop: 6 }}>Rows: likelihood 1–5 (bottom to top) · Columns: impact 1–5 · Bands: 1–4 Minor, 5–9 Moderate, 10+ Major (company matrix).</div>
        </div>
        <div style={{ display: 'grid', gap: 8 }}>
          {(['Major', 'Moderate', 'Minor'] as const).map((k) => <div key={k} className="flex-between"><Badge tone={TONE[k]}>{k}</Badge><b>{data.totals[k]}</b></div>)}
          {data.unscored > 0 && <div className="text-muted" style={{ fontSize: 12.5 }}>{data.unscored} open risk(s) not scored for this view yet.</div>}
          {chosen && (
            <div style={{ borderTop: '1px solid var(--line)', paddingTop: 8, fontSize: 13 }}>
              <div style={{ fontWeight: 600, marginBottom: 4 }}>Score {chosen.score} · {chosen.class}</div>
              {chosen.risks.map((r: any) => <div key={r.id} style={{ marginBottom: 3 }}><b>{r.refNo}</b> {r.title}</div>)}
              {chosen.count > chosen.risks.length && <div className="text-muted">… and {chosen.count - chosen.risks.length} more</div>}
            </div>)}
        </div>
      </div>
    </div>
  );
}

export function RiskSuggestions({ onChanged }: { onChanged: () => void }) {
  const { data, loading, reload } = useApi<any[]>('/isms/risk-suggestions/pending');
  const { showError, showSuccess } = useToast();
  const [busy, setBusy] = useState('');
  async function act(key: string, what: 'accept' | 'dismiss') {
    setBusy(key);
    try { await api.post(`/isms/risk-suggestions/${what}`, { key }); showSuccess(what === 'accept' ? 'Added to the risk register' : 'Dismissed'); reload(); onChanged(); } catch (e) { showError(apiErrorMessage(e)); } finally { setBusy(''); }
  }
  if (loading && !data) return null;
  if (!data?.length) return <div className="text-muted" style={{ fontSize: 13, marginBottom: 12 }}><Lightbulb size={13} style={{ verticalAlign: -2 }} /> No new risks suggested – the app found nothing in your incidents, assets, phishing or quiz results that the register does not already cover.</div>;
  return (
    <div className="card" style={{ marginBottom: 14, borderLeft: '3px solid var(--gold)' }}>
      <div style={{ fontWeight: 600, marginBottom: 2 }}><Lightbulb size={15} style={{ verticalAlign: -3 }} /> {data.length} suggested risk{data.length > 1 ? 's' : ''} from live data</div>
      <div className="text-muted" style={{ fontSize: 12.5, marginBottom: 8 }}>Scores are proposals using the company matrix. Accepting creates a register entry you can edit; dismissing hides it.</div>
      <div style={{ display: 'grid', gap: 8 }}>
        {data.map((s) => (
          <div key={s.key} style={{ display: 'grid', gridTemplateColumns: 'minmax(0,1fr) auto', gap: 10, alignItems: 'center', borderTop: '1px solid var(--line)', paddingTop: 8 }}>
            <div style={{ minWidth: 0 }}>
              <div style={{ fontSize: 13.5 }}><Badge tone={TONE[s.classification]}>{s.classification} {s.exposure}</Badge> <b>{s.summary}</b></div>
              <div className="text-muted" style={{ fontSize: 12.5 }}>{s.evidence}</div>
              <div className="text-muted" style={{ fontSize: 12 }}>Threat: {s.threat} · Impact {Math.max(s.cImpact, s.iImpact, s.aImpact)} × likelihood {s.likelihood} · SoA {s.soa}</div>
            </div>
            <div style={{ display: 'flex', gap: 6 }}>
              <button className="btn btn-primary" disabled={busy === s.key} onClick={() => act(s.key, 'accept')}><Check size={14} /> Add</button>
              <button className="btn btn-ghost" disabled={busy === s.key} aria-label="Dismiss" onClick={() => act(s.key, 'dismiss')}><X size={14} /></button>
            </div>
          </div>))}
      </div>
    </div>
  );
}
