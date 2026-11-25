import { useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Download, Plus, Search } from 'lucide-react';
import { api, apiErrorMessage } from '@/lib/api';
import { useApi } from '@/lib/useApi';
import { Badge } from '@/components/ui/Badge';
import { Skeleton } from '@/components/ui/Feedback';
import { KanbanBoard } from '@/components/ui/KanbanBoard';
import { Empty, ErrorNote, PageHead, Tabs } from '@/components/ui/PageHead';
import { PeoplePicker } from '@/components/work/PeoplePicker';
import { useToast } from '@/context/ToastContext';
import { useQuickCreate } from '@/lib/useQuickCreate';
import { exportCsv, isoDate } from '@/lib/exportCsv';
import { fdate } from '@/lib/format';
import { OpportunityModal } from '@/components/sales/OpportunityModal';
import { StageModal } from '@/components/sales/StageModal';
import { SalesReport } from '@/components/sales/SalesReport';

const DEFAULT_META = { stages: ['Lead', 'Qualified', 'Discovery', 'Proposal', 'Negotiation', 'Documentation', 'Closed Won', 'Closed Lost'], openStages: ['Lead', 'Qualified', 'Discovery', 'Proposal', 'Negotiation', 'Documentation'], lostReasons: [] as string[] };
const money = (n: number, cur = 'NGN') => `${cur === 'NGN' ? '₦' : `${cur} `}${(n || 0).toLocaleString()}`;

export function Sales() {
  const { showError } = useToast();
  const [sp, setSp] = useSearchParams();
  const [tab, setTab] = useState(sp.get('tab') || 'pipeline');
  const [f, setF] = useState({ q: '', clientId: '', salespersonId: '', source: '', createdFrom: '', createdTo: '', minValue: '' });
  const params = useMemo(() => Object.fromEntries(Object.entries(f).filter(([, v]) => v)), [f]);
  const metaQ = useApi<any>('/opportunities/meta');
  const meta = metaQ.data || DEFAULT_META;
  const board = useApi<Record<string, any[]>>(tab === 'pipeline' ? '/opportunities/board' : null, params);
  const list = useApi<any[]>(tab === 'list' ? '/opportunities' : null, params);
  const clients = useApi<any[]>('/clients');
  const [openId, setOpenId] = useState<string | null>(sp.get('opportunity'));
  const [creating, setCreating] = useState(false);
  const [move, setMove] = useState<{ opp: any; to: string } | null>(null);
  const [refresh, setRefresh] = useState(0);
  const reload = () => { board.reload(); list.reload(); };
  useQuickCreate(() => setCreating(true));
  useEffect(() => { if (sp.get('opportunity')) { setOpenId(sp.get('opportunity')); const n = new URLSearchParams(sp); n.delete('opportunity'); setSp(n, { replace: true }); } /* eslint-disable-next-line */ }, []);

  const cols = (meta.stages as string[]).map((s) => ({ key: s, label: s }));
  const all = Object.values(board.data || {}).flat();
  const openValue = all.filter((o: any) => meta.openStages.includes(o.stage)).reduce((n: number, o: any) => n + (o.value || 0), 0);
  const set = (k: string, v: string) => setF((x) => ({ ...x, [k]: v }));

  function startMove(id: string, to: string) {
    const opp: any = Object.values(board.data || {}).flat().find((o: any) => o._id === id);
    if (!opp || opp.stage === to) return;
    setMove({ opp, to });
  }
  async function doExport() {
    try {
      const r = await api.get('/opportunities', { params });
      exportCsv('opportunities', [
        { label: 'Opportunity', value: (o) => o.title }, { label: 'Client', value: (o) => o.clientId?.name || o.prospectName }, { label: 'Stage', value: (o) => o.stage }, { label: 'Value', value: (o) => o.value }, { label: 'Probability %', value: (o) => o.probability },
        { label: 'Salesperson', value: (o) => o.salespersonId?.name }, { label: 'Main contact', value: (o) => (o.contacts || []).find((c: any) => c.isPrimary)?.name }, { label: 'Contact e-mail', value: (o) => (o.contacts || []).find((c: any) => c.isPrimary)?.email },
        { label: 'Source', value: (o) => o.source }, { label: 'Start date', value: (o) => isoDate(o.startDate) }, { label: 'Expected close', value: (o) => isoDate(o.expectedCloseDate) }, { label: 'Next action', value: (o) => o.nextAction }, { label: 'Lost reason', value: (o) => o.lostReason },
        { label: 'Date created', value: (o) => isoDate(o.createdAt) }, { label: 'Created by', value: (o) => o.createdBy?.name }, { label: 'Date modified', value: (o) => isoDate(o.updatedAt) }, { label: 'Modified by', value: (o) => o.updatedBy?.name },
      ], r.data.data);
    } catch (e) { showError(apiErrorMessage(e)); }
  }

  return (
    <div>
      <PageHead title="Sales pipeline" subtitle={tab === 'report' ? 'What we are doing, what happened, how to convert and how to improve.' : `Open pipeline value: ${money(openValue)}`}
        actions={<><button className="btn btn-ghost" onClick={doExport}><Download size={15} /> Export</button><button className="btn btn-primary" onClick={() => setCreating(true)}><Plus size={16} /> New opportunity</button></>} />
      <Tabs value={tab} onChange={setTab} tabs={[{ key: 'pipeline', label: 'Pipeline' }, { key: 'list', label: 'List' }, { key: 'report', label: 'Report' }]} />

      <div className="filter-bar" style={{ marginTop: 14 }}>
        <div className="grow" style={{ position: 'relative' }}><Search size={15} style={{ position: 'absolute', left: 12, top: 12, color: 'var(--muted-2)' }} /><input className="input" style={{ paddingLeft: 34, width: '100%' }} placeholder="Search title, prospect or contact…" value={f.q} onChange={(e) => set('q', e.target.value)} aria-label="Search opportunities" /></div>
        <select className="input" aria-label="Client" value={f.clientId} onChange={(e) => set('clientId', e.target.value)}><option value="">All clients</option>{(clients.data || []).map((c) => <option key={c._id} value={c._id}>{c.name}</option>)}</select>
        <select className="input" aria-label="Source" value={f.source} onChange={(e) => set('source', e.target.value)}><option value="">Any source</option>{['manual', 'project', 'campaign', 'referral', 'event', 'inbound', 'other'].map((s) => <option key={s}>{s}</option>)}</select>
        <div style={{ minWidth: 200 }}><PeoplePicker single value={f.salespersonId ? [f.salespersonId] : []} onChange={(ids) => set('salespersonId', ids[0] || '')} placeholder="Any salesperson" /></div>
        <label style={{ fontSize: 12.5 }}>From <input className="input" type="date" value={f.createdFrom} onChange={(e) => set('createdFrom', e.target.value)} aria-label="Created from" /></label>
        <label style={{ fontSize: 12.5 }}>To <input className="input" type="date" value={f.createdTo} onChange={(e) => set('createdTo', e.target.value)} aria-label="Created to" /></label>
        <input className="input" style={{ width: 130 }} type="number" min={0} placeholder="Min value" value={f.minValue} onChange={(e) => set('minValue', e.target.value)} aria-label="Minimum value" />
      </div>
      <ErrorNote message={board.error || list.error} />

      {tab === 'pipeline' && (board.loading && !board.data ? <Skeleton height={400} /> : (
        <KanbanBoard columns={cols} itemsByColumn={board.data || {}} getId={(o: any) => o._id} onMove={(id, _from, to) => startMove(id, to)}
          renderCard={(o: any) => {
            const primary = (o.contacts || []).find((c: any) => c.isPrimary) || (o.contacts || [])[0];
            const late = o.nextActionDate && new Date(o.nextActionDate) < new Date() && meta.openStages.includes(o.stage);
            return (
              <div className="kanban-card" onClick={() => setOpenId(o._id)} style={{ cursor: 'pointer' }}>
                <div className="kc-title">{o.title}</div>
                <div style={{ fontSize: 12, color: 'var(--muted)', marginBottom: 4 }}>{o.clientId?.name || o.prospectName || '—'}</div>
                {primary && <div style={{ fontSize: 11.5, color: 'var(--muted-2)' }}>{primary.name}</div>}
                {o.nextAction && <div style={{ fontSize: 11.5, marginTop: 4, color: late ? 'var(--danger)' : 'var(--muted-2)' }}>{late ? 'Overdue: ' : 'Next: '}{o.nextAction}</div>}
                <div className="kc-meta" style={{ marginTop: 8 }}>
                  <Badge tone="gold">{money(o.value, o.currency)}</Badge>
                  <select className="input" aria-label={`Move "${o.title}" to a different stage`} style={{ padding: '4px 6px', fontSize: 11, width: 'auto' }} value={o.stage}
                    onChange={(e) => startMove(o._id, e.target.value)} onClick={(e) => e.stopPropagation()} onPointerDown={(e) => e.stopPropagation()}>{(meta.stages as string[]).map((s) => <option key={s} value={s}>{s}</option>)}</select>
                </div>
              </div>
            );
          }} />
      ))}

      {tab === 'list' && (list.loading && !list.data ? <Skeleton height={300} /> : !list.data?.length ? <Empty title="No opportunities match" /> : (
        <div className="table-wrap"><table className="data-table"><thead><tr><th>Opportunity</th><th>Client</th><th>Stage</th><th>Value</th><th>Main contact</th><th>Salesperson</th><th>Next action</th><th>Created</th><th>Modified</th></tr></thead>
          <tbody>{list.data.map((o) => { const c = (o.contacts || []).find((x: any) => x.isPrimary) || (o.contacts || [])[0]; return (
            <tr key={o._id} onClick={() => setOpenId(o._id)} style={{ cursor: 'pointer' }}>
              <td><strong>{o.title}</strong></td><td>{o.clientId?.name || o.prospectName || '—'}</td><td><Badge tone={o.stage === 'Closed Won' ? 'success' : o.stage === 'Closed Lost' ? 'danger' : 'accent'}>{o.stage}</Badge></td><td>{money(o.value, o.currency)}</td>
              <td style={{ fontSize: 12.5 }}>{c ? <>{c.name}<div className="text-muted">{c.email || c.phone || ''}</div></> : '—'}</td><td>{o.salespersonId?.name || '—'}</td><td style={{ fontSize: 12.5 }}>{o.nextAction || '—'}{o.nextActionDate ? <div className="text-muted">{fdate(o.nextActionDate)}</div> : null}</td>
              <td>{fdate(o.createdAt)}</td><td title={o.updatedBy?.name ? `by ${o.updatedBy.name}${o.updatedFrom?.device ? ` · ${o.updatedFrom.device}` : ''}` : undefined}>{fdate(o.updatedAt)}</td></tr>); })}</tbody></table></div>
      ))}

      {tab === 'report' && <SalesReport params={params} open={(id) => setOpenId(id)} />}

      <OpportunityModal open={creating} meta={meta} onClose={() => setCreating(false)} onSaved={reload} />
      <OpportunityModal open={!!openId} id={openId} refresh={refresh} meta={meta} onClose={() => setOpenId(null)} onSaved={reload} onMove={(opp) => setMove({ opp, to: opp.stage })} />
      <StageModal open={!!move} opp={move?.opp || null} to={move?.to || 'Lead'} stages={meta.stages} lostReasons={meta.lostReasons} onClose={() => setMove(null)} onDone={() => { reload(); setRefresh((n) => n + 1); }} />
    </div>
  );
}
