import { useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Bot } from 'lucide-react';
import { useApi } from '@/lib/useApi';
import { PageHead, Tabs, ErrorNote, Loading } from '@/components/ui/PageHead';
import { RegisterPanel, RegDef } from '@/components/isms/RegisterPanel';
import { HeatMap, RiskSuggestions } from '@/components/isms/RiskInsights';
import { AuditorAccessPanel } from '@/components/isms/AuditorAccessPanel';
import { EvidenceVault } from '@/components/isms/EvidenceVault';
import { AutomationPanel, CoveragePanel, PacksPanel, ReviewPanel } from '@/components/isms/HubPanels';

function SoaStrip() {
  const { data } = useApi<any>('/isms/annex-a/summary');
  if (!data) return null;
  return (
    <div className="stat-grid" style={{ marginBottom: 12 }}>
      <div className="stat-card"><div className="stat-label"><span>Applicable controls</span></div><div className="stat-value">{data.applicable}<span className="text-muted" style={{ fontSize: 14 }}> / {data.total}</span></div></div>
      <div className="stat-card"><div className="stat-label"><span>Implemented</span></div><div className="stat-value">{data.implemented}</div></div>
      <div className="stat-card"><div className="stat-label"><span>Passed · failed</span></div><div className="stat-value">{data.pass} · <span style={data.fail ? { color: 'var(--danger)' } : undefined}>{data.fail}</span></div></div>
      <div className="stat-card"><div className="stat-label"><span>Never tested · overdue</span></div><div className="stat-value">{data.untested} · <span style={data.testsOverdue ? { color: 'var(--danger)' } : undefined}>{data.testsOverdue}</span></div></div>
    </div>
  );
}

const GROUP_ORDER = ['Context & leadership', 'Planning', 'Support', 'Operation', 'Performance', 'Improvement'];

export function Isms() {
  const [sp, setSp] = useSearchParams();
  const tab = sp.get('tab') || 'registers';
  const cat = useApi<{ registers: RegDef[]; generators: any[] }>('/isms/registers');
  const ov = useApi<any>('/isms/overview');
  const regs = cat.data?.registers || [];
  const current = regs.find((r) => r.key === (sp.get('register') || 'car')) || regs[0];
  const groups = useMemo(() => GROUP_ORDER.map((g) => ({ g, items: regs.filter((r) => r.group === g) })).filter((x) => x.items.length), [regs]);
  const [bump, setBump] = useState(0);
  const reload = () => { cat.reload(); ov.reload(); };
  const go = (p: Record<string, string>) => setSp(p, { replace: true });

  return (
    <div className="page-enter">
      <PageHead title="ISMS Automation Hub" subtitle="Registers that fill themselves from the app, rules that chase the deadlines in your policies, and an evidence pack for the auditor." />
      {ov.data && (
        <div className="stat-grid" style={{ marginBottom: 16 }}>
          <div className="stat-card"><div className="stat-label"><span>Register records</span></div><div className="stat-value">{ov.data.records}</div></div>
          <div className="stat-card"><div className="stat-label"><span>Open items</span></div><div className="stat-value">{ov.data.open}</div></div>
          <div className="stat-card"><div className="stat-label"><span>Overdue</span></div><div className="stat-value" style={ov.data.overdue ? { color: 'var(--danger)' } : undefined}>{ov.data.overdue}</div></div>
          <div className="stat-card"><div className="stat-label"><span>Rules failing</span></div><div className="stat-value" style={ov.data.rulesFailing ? { color: 'var(--danger)' } : undefined}>{ov.data.rulesFailing}</div></div>
        </div>
      )}
      <Tabs value={tab} onChange={(t) => go({ tab: t })} tabs={[{ key: 'registers', label: 'Registers' }, { key: 'automation', label: 'Automation rules' }, { key: 'evidence', label: 'Evidence vault' }, { key: 'auditors', label: 'Auditor access' }, { key: 'packs', label: 'Evidence packs & downloads' }, { key: 'review', label: 'Management review' }, { key: 'coverage', label: 'Policy coverage' }]} />
      <div style={{ marginTop: 14 }}>
        <ErrorNote message={cat.error} />
        {cat.loading && !cat.data ? <Loading /> : tab === 'registers' && current ? (
          <div style={{ display: 'grid', gridTemplateColumns: 'minmax(190px,230px) minmax(0,1fr)', gap: 16, alignItems: 'start' }}>
            <div style={{ display: 'grid', gap: 12 }}>
              {groups.map(({ g, items }) => (
                <div key={g}>
                  <div className="text-muted" style={{ fontSize: 11.5, textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 4 }}>{g}</div>
                  {items.map((r) => (
                    <button key={r.key} className={`chip ${current.key === r.key ? 'active' : ''}`} style={{ display: 'flex', width: '100%', justifyContent: 'space-between', marginBottom: 4, textAlign: 'left' }} onClick={() => go({ tab: 'registers', register: r.key })}>
                      <span>{r.title.replace(/ \(.*\)$/, '')}</span>
                      <span style={r.stats.overdue ? { color: 'var(--danger)', fontWeight: 700 } : { opacity: 0.6 }}>{r.stats.overdue ? `${r.stats.overdue}!` : r.stats.open}</span>
                    </button>
                  ))}
                </div>
              ))}
              <div className="text-muted" style={{ fontSize: 12 }}><Bot size={12} style={{ verticalAlign: -1 }} /> Asset, access, incident, threat, controls, document log and supplier registers are built from their own modules — find them under “Evidence packs & downloads”.</div>
            </div>
            <div style={{ minWidth: 0 }}>
              {current.key === 'annex_a' && <SoaStrip />}
              {current.key === 'risk' && <><RiskSuggestions onChanged={() => { reload(); setBump((b) => b + 1); }} /><HeatMap key={bump} /></>}
              <RegisterPanel key={`${current.key}-${bump}`} def={current} onChanged={() => { reload(); setBump((b) => b + 1); }} />
            </div>
          </div>
        ) : tab === 'automation' ? <AutomationPanel />
          : tab === 'evidence' ? <EvidenceVault />
          : tab === 'auditors' ? <AuditorAccessPanel registers={regs} />
          : tab === 'packs' ? <PacksPanel generators={cat.data?.generators || []} />
          : tab === 'review' ? <ReviewPanel />
          : tab === 'coverage' ? <CoveragePanel /> : null}
      </div>
    </div>
  );
}
