import { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Download, Megaphone, Plus } from 'lucide-react';
import { api, apiErrorMessage } from '@/lib/api';
import { useApi } from '@/lib/useApi';
import { useAuth } from '@/context/AuthContext';
import { useToast } from '@/context/ToastContext';
import { Badge } from '@/components/ui/Badge';
import { Empty, ErrorNote, Loading, PageHead, Tabs } from '@/components/ui/PageHead';
import { Pagination } from '@/components/ui/Pagination';
import { ResourcePage } from '@/components/ui/ResourcePage';
import { CampaignModal } from '@/components/marketing/CampaignModal';
import { SocialAccountsPanel } from '@/components/marketing/SocialAccountsPanel';
import { fdate, fdatetime, saveBlob, filenameFrom, money } from '@/lib/format';
import { APPROVAL_LABEL, APPROVAL_TONE, CHANNELS, GOAL_KINDS, GOAL_META, channelLabel } from '@/lib/marketing';
import '@/components/marketing/marketing.css';

/** Marketing: campaigns with goals, approval before anything is posted, hand-over to the social media manager, accounts, leads. */
export function Marketing() {
  const { user } = useAuth();
  const [params, setParams] = useSearchParams();
  const [tab, setTab] = useState(params.get('tab') || 'overview');
  const [open, setOpen] = useState<string | 'new' | null>(params.get('campaign'));
  const [refresh, setRefresh] = useState(0);
  const overview = useApi<any>('/campaigns/overview');
  const waiting = overview.data?.awaitingApproval?.length || 0;

  const closeModal = () => { setOpen(null); if (params.get('campaign')) { params.delete('campaign'); setParams(params, { replace: true }); } };
  const changed = () => { setRefresh((n) => n + 1); overview.reload(); };

  return (
    <div className="page-enter">
      <PageHead title="Marketing" subtitle="Plan campaigns around a goal, get them approved with evidence, then hand them to the social media manager to post."
        actions={<button className="btn btn-primary" onClick={() => setOpen('new')}><Plus size={16} /> New campaign</button>} />
      <Tabs value={tab} onChange={setTab} tabs={[
        { key: 'overview', label: 'Overview' }, { key: 'campaigns', label: 'Campaigns' },
        { key: 'approvals', label: 'Waiting for approval', count: waiting || undefined }, { key: 'accounts', label: 'Social accounts' }, { key: 'leads', label: 'Leads' },
      ]} />
      <div style={{ marginTop: 14 }}>
        {tab === 'overview' && <Overview o={overview} onOpen={setOpen} goQueue={() => setTab('accounts')} />}
        {tab === 'campaigns' && <Campaigns refresh={refresh} onOpen={setOpen} />}
        {tab === 'approvals' && <Approvals o={overview} onOpen={setOpen} />}
        {tab === 'accounts' && <SocialAccountsPanel />}
        {tab === 'leads' && <Leads />}
      </div>
      {open && <CampaignModal id={open === 'new' ? null : open} me={user?.id} onClose={closeModal} onChanged={changed} />}
    </div>
  );
}

function Overview({ o, onOpen }: { o: ReturnType<typeof useApi<any>>; onOpen: (id: string) => void; goQueue: () => void }) {
  const d = o.data;
  if (o.loading && !d) return <Loading />;
  if (o.error) return <ErrorNote message={o.error} />;
  if (!d) return null;
  const t = d.totals;
  return (
    <div style={{ display: 'grid', gap: 16 }}>
      <div className="stat-grid">
        <div className="stat-card"><div className="stat-label"><span>Campaigns</span></div><div className="stat-value">{d.total}</div></div>
        <div className="stat-card"><div className="stat-label"><span>Live</span></div><div className="stat-value">{d.live}</div></div>
        <div className="stat-card"><div className="stat-label"><span>Waiting for approval</span></div><div className="stat-value">{d.approvals.pending}</div></div>
        <div className="stat-card"><div className="stat-label"><span>Posts waiting for the manager</span></div><div className="stat-value">{d.postsWaiting}</div></div>
      </div>
      {d.awaitingApproval.length > 0 && d.canApprove && <div className="banner warn"><strong>{d.awaitingApproval.length} campaign(s) need your decision:</strong> {d.awaitingApproval.map((c: any) => <button key={c._id} className="btn btn-ghost btn-sm" onClick={() => onOpen(c._id)}>{c.name}</button>)}</div>}
      <div className="grid-2">
        <div className="card"><strong style={{ fontSize: 14 }}>Progress by goal</strong>
          {d.goals.length === 0 ? <p className="text-muted" style={{ fontSize: 13 }}>No campaigns yet.</p> : d.goals.map((g: any) => { const pct = g.target ? Math.round((g.current / g.target) * 100) : 0; return (
            <div key={g.kind} style={{ marginTop: 12 }}><div className="flex-between" style={{ fontSize: 13, marginBottom: 4 }}><span>{g.label} · {g.campaigns} campaign{g.campaigns === 1 ? '' : 's'}</span><strong>{g.target ? `${g.current} / ${g.target} (${pct}%)` : `${g.current}`}</strong></div><div className="mk-bar"><i style={{ width: `${Math.min(100, pct)}%` }} /></div></div>); })}</div>
        <div className="card"><strong style={{ fontSize: 14 }}>Results so far</strong>
          <dl className="kv" style={{ marginTop: 10 }}><dt>People reached</dt><dd>{t.reach}</dd><dt>Clicks / visits</dt><dd>{t.clicks}</dd><dt>Leads</dt><dd>{t.leads}</dd><dt>Hires</dt><dd>{t.hires}</dd><dt>Revenue</dt><dd>{money(t.revenue)}</dd><dt>Spend</dt><dd>{money(t.spend)}</dd><dt>Return</dt><dd>{t.roi === null ? '—' : `${t.roi} per 1 spent`}</dd></dl>
          <div style={{ marginTop: 10, fontSize: 13 }}><strong>Posted</strong>: {Object.keys(d.postedByChannel).length ? Object.entries(d.postedByChannel).map(([k, n]) => `${channelLabel(k)} ${n}`).join(' · ') : 'nothing yet'}</div></div>
      </div>
      <div className="card"><strong style={{ fontSize: 14 }}>Approval pipeline</strong>
        <div className="row-gap" style={{ marginTop: 8, flexWrap: 'wrap' }}>{Object.entries(d.approvals).map(([k, n]) => <Badge key={k} tone={APPROVAL_TONE[k]}>{APPROVAL_LABEL[k]}: {n as number}</Badge>)}</div></div>
    </div>
  );
}

function Campaigns({ refresh, onOpen }: { refresh: number; onOpen: (id: string) => void }) {
  const { showError } = useToast();
  const [f, setF] = useState({ q: '', status: '', approval: '', goal: '', channel: '', from: '', to: '' });
  const [page, setPage] = useState(1);
  const params = { ...Object.fromEntries(Object.entries(f).filter(([, v]) => v)), page };
  const { data, extra, loading, error, reload } = useApi<any[]>('/campaigns', params);
  useEffect(() => setPage(1), [f]);
  useEffect(() => { if (refresh) reload(); /* eslint-disable-next-line */ }, [refresh]);
  const set = (k: string, v: string) => setF((x) => ({ ...x, [k]: v }));
  async function exportCsv() {
    try { const r = await api.get('/campaigns/export.csv', { params: Object.fromEntries(Object.entries(f).filter(([, v]) => v)), responseType: 'blob' }); saveBlob(r.data, filenameFrom(r.headers['content-disposition'], 'campaigns.csv')); } catch (e) { showError(apiErrorMessage(e)); }
  }
  return (
    <div>
      <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', marginBottom: 14, alignItems: 'center' }}>
        <input className="input" style={{ maxWidth: 220 }} placeholder="Search campaigns" value={f.q} onChange={(e) => set('q', e.target.value)} />
        <select className="input" style={{ maxWidth: 170 }} value={f.approval} onChange={(e) => set('approval', e.target.value)}><option value="">Any approval</option>{Object.entries(APPROVAL_LABEL).map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select>
        <select className="input" style={{ maxWidth: 150 }} value={f.status} onChange={(e) => set('status', e.target.value)}><option value="">Any status</option>{['planned', 'live', 'completed', 'cancelled'].map((s) => <option key={s}>{s}</option>)}</select>
        <select className="input" style={{ maxWidth: 170 }} value={f.goal} onChange={(e) => set('goal', e.target.value)}><option value="">Any goal</option>{GOAL_KINDS.map((k) => <option key={k} value={k}>{GOAL_META[k].label}</option>)}</select>
        <select className="input" style={{ maxWidth: 160 }} value={f.channel} onChange={(e) => set('channel', e.target.value)}><option value="">Any channel</option>{CHANNELS.map((c) => <option key={c.key} value={c.key}>{c.label}</option>)}</select>
        <label style={{ fontSize: 12.5 }}>Created <input className="input" type="date" style={{ maxWidth: 150 }} value={f.from} onChange={(e) => set('from', e.target.value)} /> to <input className="input" type="date" style={{ maxWidth: 150 }} value={f.to} onChange={(e) => set('to', e.target.value)} /></label>
        <button className="btn btn-ghost" onClick={exportCsv}><Download size={15} /> Export</button>
      </div>
      <ErrorNote message={error} />
      {loading && !data ? <Loading /> : !data?.length ? <Empty icon={<Megaphone />} title="No campaigns match" hint="Change the filters, or start a new campaign." /> : (
        <div className="table-wrap"><table className="data-table"><thead><tr><th>Campaign</th><th>Goal</th><th>Approval</th><th>Channels</th><th>Owner</th><th>Modified</th></tr></thead>
          <tbody>{data.map((c) => (
            <tr key={c._id} onClick={() => onOpen(c._id)}>
              <td><strong>{c.name}</strong><div className="text-muted" style={{ fontSize: 12 }}>{c.status}{c.startDate ? ` · ${fdate(c.startDate)}` : ''}</div></td>
              <td style={{ minWidth: 150 }}><div style={{ fontSize: 12.5 }}>{GOAL_META[c.goal?.kind]?.label}{c.goal?.target ? ` · ${c.progress.current}/${c.goal.target}` : ''}</div><div className="mk-bar" style={{ marginTop: 4 }}><i style={{ width: `${Math.min(100, c.progress?.percent || 0)}%` }} /></div></td>
              <td><Badge tone={APPROVAL_TONE[c.approval?.status || 'draft']}>{APPROVAL_LABEL[c.approval?.status || 'draft']}</Badge></td>
              <td style={{ fontSize: 12.5 }}>{(c.channels || []).map(channelLabel).join(', ') || '—'}</td>
              <td>{c.ownerId?.name || '—'}</td>
              <td style={{ fontSize: 12.5 }}>{fdatetime(c.updatedAt)}{c.updatedBy?.name ? <div className="text-muted">{c.updatedBy.name}</div> : null}</td>
            </tr>))}</tbody></table></div>
      )}
      {extra?.pagination && <Pagination page={extra.pagination.page} pages={extra.pagination.pages} total={extra.pagination.total} onChange={setPage} />}
    </div>
  );
}

function Approvals({ o, onOpen }: { o: ReturnType<typeof useApi<any>>; onOpen: (id: string) => void }) {
  const list = o.data?.awaitingApproval || [];
  if (o.loading && !o.data) return <Loading />;
  if (!list.length) return <Empty title="Nothing is waiting" hint="Campaigns sent for approval show up here." />;
  return (
    <div className="table-wrap"><table className="data-table"><thead><tr><th>Campaign</th><th>Sent by</th><th>Sent</th></tr></thead>
      <tbody>{list.map((c: any) => <tr key={c._id} onClick={() => onOpen(c._id)}><td><strong>{c.name}</strong></td><td>{c.submittedByName}</td><td>{fdatetime(c.submittedAt)}</td></tr>)}</tbody></table>
      {!o.data?.canApprove && <p className="text-muted" style={{ fontSize: 12.5, padding: 10 }}>Only the CEO, COO, the head of Marketing or a named approver can decide these.</p>}</div>
  );
}

function Leads() {
  return (
    <ResourcePage
      title="Leads" description="People who showed interest. Convert the good ones into opportunities." endpoint="/leads" entityType="lead" createLabel="New lead" itemName="Lead"
      filters={[{ name: 'status', label: 'Status', options: ['new', 'contacted', 'qualified', 'converted', 'lost'] }]}
      columns={[{ key: 'name', label: 'Name' }, { key: 'company', label: 'Company' }, { key: 'email', label: 'E-mail' }, { key: 'source', label: 'Source' }, { key: 'status', label: 'Status', badge: true }]}
      fields={[
        { name: 'name', label: 'Name', type: 'text', required: true }, { name: 'email', label: 'E-mail', type: 'text' }, { name: 'company', label: 'Company', type: 'text' }, { name: 'source', label: 'Source', type: 'text' },
        { name: 'status', label: 'Status', type: 'select', options: ['new', 'contacted', 'qualified', 'converted', 'lost'] }, { name: 'campaignId', label: 'From campaign', type: 'select', optionsEndpoint: '/campaigns?limit=100' },
      ]}
    />
  );
}
