import { useEffect, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Crosshair, Download, FileUp, Plus, Radar, Search, Share2, ShieldAlert, Siren, Trash2 } from 'lucide-react';
import { api, apiErrorMessage } from '@/lib/api';
import { useToast } from '@/context/ToastContext';
import { useConfirm } from '@/context/ConfirmContext';
import { useApi } from '@/lib/useApi';
import { PageHead, Tabs, Empty, Loading, ErrorNote, Kv } from '@/components/ui/PageHead';
import { Badge } from '@/components/ui/Badge';
import { Modal } from '@/components/ui/Modal';
import { fdate, fdatetime, filenameFrom, label, saveBlob, toInputDate } from '@/lib/format';

const SEV_TONE: Record<string, any> = { low: 'neutral', medium: 'gold', high: 'danger', critical: 'danger' };
const TLP_STYLE: Record<string, { bg: string; fg: string; hint: string }> = {
  CLEAR: { bg: '#fff', fg: '#222', hint: 'Public — no limits on disclosure' },
  GREEN: { bg: '#2e9e6b', fg: '#fff', hint: 'Share within the community, not publicly' },
  AMBER: { bg: '#F0A93B', fg: '#1b1b1b', hint: 'Named recipients only, on a need-to-know basis' },
  RED: { bg: '#d6455d', fg: '#fff', hint: 'Not for disclosure — only the people named' },
};
const LAYER_HELP: Record<string, string> = { strategic: 'Strategic — trends, actors and motives, for leadership and risk decisions', tactical: 'Tactical — attacker techniques (TTPs), for defenders and control owners', operational: 'Operational — specific campaigns, IOCs and detections, for the security team' };
const STATUS_TONE: Record<string, any> = { new: 'gold', triaged: 'accent', analysed: 'accent', actioned: 'success', shared: 'success', closed: 'neutral', dismissed: 'neutral' };
const csvToList = (s: string) => s.split(/[\n,]+/).map((x) => x.trim()).filter(Boolean);

export function Tlp({ v }: { v: string }) {
  const s = TLP_STYLE[v] || TLP_STYLE.GREEN;
  return <span title={s.hint} style={{ background: '#111', color: s.bg, border: `1px solid ${s.bg}`, borderRadius: 4, padding: '1px 7px', fontSize: 11.5, fontWeight: 700, letterSpacing: 0.3 }}>TLP:{v}</span>;
}

export function ThreatIntel() {
  const [params, setParams] = useSearchParams();
  const [tab, setTab] = useState(params.get('tab') || 'overview');
  const [openId, setOpenId] = useState<string | null>(params.get('item'));
  const meta = useApi<any>('/threat-intel/meta');
  const canManage = !!meta.data?.canManage;
  useEffect(() => { if (params.get('item') || params.get('tab')) { const t = params.get('tab'); if (t) setTab(t); } /* eslint-disable-next-line */ }, []);
  useEffect(() => { if (openId == null && params.get('item')) setParams({}, { replace: true }); }, [openId, params, setParams]);
  return (
    <div className="page-enter">
      <PageHead title="Threat intelligence" subtitle="Collect from vetted sources, analyse what matters to us, act on it, and share responsibly (POL-5007 · ISO 27001 A.5.7). Strategic, tactical and operational layers." />
      <Tabs value={tab} onChange={setTab} tabs={[{ key: 'overview', label: 'Overview' }, { key: 'intel', label: 'Intelligence' }, { key: 'indicators', label: 'Indicators (IOCs)' }, { key: 'sources', label: 'Sources' }]} />
      {meta.error && <ErrorNote message={meta.error} />}
      {meta.data && (tab === 'overview' ? <Overview meta={meta.data} go={(t) => setTab(t)} open={setOpenId} /> : tab === 'intel' ? <IntelList meta={meta.data} canManage={canManage} open={setOpenId} /> : tab === 'indicators' ? <Indicators meta={meta.data} canManage={canManage} seenOnly={params.get('seen') === '1'} open={setOpenId} /> : <Sources meta={meta.data} canManage={canManage} />)}
      {openId && meta.data && <IntelDetail id={openId} meta={meta.data} canManage={canManage} onClose={() => setOpenId(null)} />}
    </div>
  );
}

/* ---------------------------------- overview --------------------------------- */
function Overview({ meta, go, open }: { meta: any; go: (t: string) => void; open: (id: string) => void }) {
  const { data: s, loading } = useApi<any>('/threat-intel/summary');
  if (loading && !s) return <Loading />;
  if (!s) return null;
  const crit = (s.bySeverity?.critical || 0) + (s.bySeverity?.high || 0);
  const card = (t: string, v: any, sub?: string, tone?: string, onClick?: () => void) => <div className="stat-card" style={{ cursor: onClick ? 'pointer' : undefined, borderTop: tone ? `3px solid ${tone}` : undefined }} onClick={onClick}><div className="stat-label"><span>{t}</span></div><div className="stat-value">{v}</div>{sub && <div className="text-muted" style={{ fontSize: 12 }}>{sub}</div>}</div>;
  return (
    <div style={{ display: 'grid', gap: 18, marginTop: 14 }}>
      <div className="stat-grid">
        {card('Open intelligence', s.open, `${s.total} in total`, undefined, () => go('intel'))}
        {card('High & critical', crit, 'still open', crit ? '#d6455d' : undefined, () => go('intel'))}
        {card('Affecting our assets', s.exposed, 'matched to the register', s.exposed ? '#F0A93B' : undefined, () => go('intel'))}
        {card('Waiting for analysis', s.needAnalysis, 'new or triaged')}
        {card('Active indicators', s.indicatorsActive, `${s.indicatorsSeen} seen in our data`, s.indicatorsSeen ? '#d6455d' : undefined, () => go('indicators'))}
        {card('Vetted sources', `${s.vetted}/${s.sources}`, 'only vetted sources feed intelligence', undefined, () => go('sources'))}
        {card('Overdue actions', s.overdueActions, undefined, s.overdueActions ? '#F0A93B' : undefined)}
      </div>
      <div className="grid-2">
        <div className="card"><strong>By layer (open)</strong>
          <div style={{ display: 'grid', gap: 10, marginTop: 10 }}>{meta.layers.map((l: string) => { const n = s.byLayer?.[l] || 0; return <div key={l}><div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13 }}><span>{label(l)}</span><span>{n}</span></div><div style={{ height: 6, background: 'var(--border)', borderRadius: 4 }}><div style={{ width: `${s.open ? (n / s.open) * 100 : 0}%`, height: '100%', background: 'var(--accent, #C22FD4)', borderRadius: 4 }} /></div><div className="text-muted" style={{ fontSize: 11.5 }}>{LAYER_HELP[l]}</div></div>; })}</div></div>
        <div className="card"><strong>How it flows</strong>
          <ol style={{ fontSize: 13, color: 'var(--muted)', paddingLeft: 18, lineHeight: 1.7, marginBottom: 0 }}>
            <li><b>Collect</b> from vetted sources (feeds, files, manual entry)</li><li><b>Process</b>: de-duplicate, label severity and TLP</li><li><b>Analyse</b>: does it affect our assets? how much?</li>
            <li><b>Act</b>: risk assessment, control update, hunt, awareness, patch</li><li><b>Share</b> analysed, anonymised, TLP-checked intelligence</li><li><b>Review</b> regularly and close when no longer relevant</li></ol></div>
      </div>
      <div className="card"><strong>Latest</strong>
        {!s.recent?.length ? <p className="text-muted" style={{ fontSize: 13 }}>Nothing yet. Add intelligence manually, import a file, or collect from a vetted feed in Sources.</p> :
          <div className="table-wrap" style={{ marginTop: 8 }}><table className="data-table"><tbody>{s.recent.map((r: any) => <tr key={r._id} onClick={() => open(r._id)}><td className="mono" style={{ width: 130 }}>{r.reference}</td><td>{r.title}</td><td style={{ width: 90 }}><Badge tone={SEV_TONE[r.severity]}>{label(r.severity)}</Badge></td><td style={{ width: 90 }}><Tlp v={r.tlp} /></td><td style={{ width: 110 }}><Badge tone={STATUS_TONE[r.status]}>{label(r.status)}</Badge></td><td style={{ width: 110 }}>{r.matchedAssetIds?.length ? <Badge tone="gold">{r.matchedAssetIds.length} asset(s)</Badge> : ''}</td></tr>)}</tbody></table></div>}</div>
    </div>
  );
}

/* ------------------------------- intelligence list --------------------------- */
function IntelList({ meta, canManage, open }: { meta: any; canManage: boolean; open: (id: string) => void }) {
  const [f, setF] = useState<Record<string, string>>({ status: 'open' });
  const [creating, setCreating] = useState(false);
  const [importing, setImporting] = useState(false);
  const list = useApi<any[]>('/threat-intel', Object.fromEntries(Object.entries(f).filter(([, v]) => v)));
  const set = (k: string, v: string) => setF((p) => ({ ...p, [k]: v }));
  return (
    <div style={{ marginTop: 14 }}>
      <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', marginBottom: 14, alignItems: 'center' }}>
        <input className="input" style={{ maxWidth: 230 }} placeholder="Search title, CVE, tag…" value={f.search || ''} onChange={(e) => set('search', e.target.value)} />
        <select className="input" style={{ maxWidth: 150 }} value={f.layer || ''} onChange={(e) => set('layer', e.target.value)}><option value="">Any layer</option>{meta.layers.map((x: string) => <option key={x} value={x}>{label(x)}</option>)}</select>
        <select className="input" style={{ maxWidth: 140 }} value={f.severity || ''} onChange={(e) => set('severity', e.target.value)}><option value="">Any severity</option>{meta.severities.map((x: string) => <option key={x} value={x}>{label(x)}</option>)}</select>
        <select className="input" style={{ maxWidth: 140 }} value={f.status || ''} onChange={(e) => set('status', e.target.value)}><option value="">Any status</option><option value="open">Open</option>{meta.statuses.map((x: string) => <option key={x} value={x}>{label(x)}</option>)}</select>
        <select className="input" style={{ maxWidth: 130 }} value={f.tlp || ''} onChange={(e) => set('tlp', e.target.value)}><option value="">Any TLP</option>{meta.tlps.map((x: string) => <option key={x}>{x}</option>)}</select>
        <label style={{ fontSize: 13, display: 'flex', gap: 6 }}><input type="checkbox" checked={f.exposed === '1'} onChange={(e) => set('exposed', e.target.checked ? '1' : '')} /> Affects our assets</label>
        <div style={{ flex: 1 }} />
        {canManage && <><button className="btn btn-ghost" onClick={() => setImporting(true)}><FileUp size={15} /> Import</button><button className="btn btn-primary" onClick={() => setCreating(true)}><Plus size={15} /> New intelligence</button></>}
      </div>
      <ErrorNote message={list.error} />
      {list.loading && !list.data ? <Loading /> : !list.data?.length ? <Empty icon={<Radar />} title="No intelligence matches" hint="Record a threat, import a STIX / CSV file, or collect from a vetted feed." /> : (
        <div className="table-wrap"><table className="data-table"><thead><tr><th>Ref.</th><th>Title</th><th>Layer</th><th>Severity</th><th>TLP</th><th>Source</th><th>Status</th><th>Assets</th><th>Seen</th></tr></thead>
          <tbody>{list.data.map((r) => <tr key={r._id} onClick={() => open(r._id)}>
            <td className="mono">{r.reference}</td><td><strong>{r.title}</strong><div className="text-muted" style={{ fontSize: 12 }}>{[...(r.cves || []).slice(0, 2), ...(r.tags || []).slice(0, 2)].join(' · ')}</div></td>
            <td>{label(r.layer)}</td><td><Badge tone={SEV_TONE[r.severity]}>{label(r.severity)}</Badge></td><td><Tlp v={r.tlp} /></td><td style={{ fontSize: 12.5 }}>{r.sourceName || '—'}</td>
            <td><Badge tone={STATUS_TONE[r.status]}>{label(r.status)}</Badge></td><td>{r.matchedAssetIds?.length ? <Badge tone="gold">{r.matchedAssetIds.length}</Badge> : '—'}</td><td>{fdate(r.observedAt || r.createdAt)}</td></tr>)}</tbody></table></div>)}
      {creating && <IntelForm meta={meta} onClose={() => setCreating(false)} onSaved={(id) => { setCreating(false); list.reload(); open(id); }} />}
      {importing && <ImportModal meta={meta} onClose={() => setImporting(false)} onDone={() => { setImporting(false); list.reload(); }} />}
    </div>
  );
}

function IntelForm({ meta, onClose, onSaved }: { meta: any; onClose: () => void; onSaved: (id: string) => void }) {
  const { showError, showSuccess } = useToast();
  const sources = useApi<any[]>('/threat-intel/sources');
  const [f, setF] = useState<any>({ title: '', summary: '', layer: 'tactical', category: 'other', severity: 'medium', confidence: 'medium', credibility: 3, tlp: 'GREEN', sourceId: '', observedAt: toInputDate(new Date()), ttps: '', cves: '', affectedProducts: '', tags: '', actorName: '', restrictedTo: [] as string[] });
  const set = (k: string, v: any) => setF((p: any) => ({ ...p, [k]: v }));
  async function save() {
    try {
      const body = { ...f, sourceId: f.sourceId || undefined, ttps: csvToList(f.ttps), cves: csvToList(f.cves), affectedProducts: csvToList(f.affectedProducts), tags: csvToList(f.tags), actorName: f.actorName || undefined, restrictedTo: f.tlp === 'RED' ? f.restrictedTo : undefined };
      const r = await api.post('/threat-intel', body); showSuccess(`${r.data.data.reference} recorded.`); onSaved(r.data.data._id);
    } catch (e) { showError(apiErrorMessage(e)); }
  }
  const vetted = (sources.data || []).filter((s) => s.vetted && s.active);
  return (
    <Modal open onClose={onClose} title="New threat intelligence" size="wide" footer={<><button className="btn btn-ghost" onClick={onClose}>Cancel</button><button className="btn btn-primary" disabled={f.title.trim().length < 3} onClick={save}>Record</button></>}>
      <div style={{ display: 'grid', gap: 12 }}>
        <div className="field"><label>Title *</label><input className="input" value={f.title} onChange={(e) => set('title', e.target.value)} /></div>
        <div className="field"><label>What was reported</label><textarea className="input" rows={4} value={f.summary} onChange={(e) => set('summary', e.target.value)} /></div>
        <div className="grid-3">
          <div className="field"><label>Layer</label><select className="input" value={f.layer} onChange={(e) => set('layer', e.target.value)}>{meta.layers.map((x: string) => <option key={x} value={x}>{label(x)}</option>)}</select></div>
          <div className="field"><label>Category</label><select className="input" value={f.category} onChange={(e) => set('category', e.target.value)}>{meta.categories.map((x: string) => <option key={x} value={x}>{label(x)}</option>)}</select></div>
          <div className="field"><label>Severity</label><select className="input" value={f.severity} onChange={(e) => set('severity', e.target.value)}>{meta.severities.map((x: string) => <option key={x} value={x}>{label(x)}</option>)}</select></div>
          <div className="field"><label>Confidence</label><select className="input" value={f.confidence} onChange={(e) => set('confidence', e.target.value)}><option value="low">Low</option><option value="medium">Medium</option><option value="high">High</option></select></div>
          <div className="field"><label>Credibility (1 confirmed – 6 unknown)</label><select className="input" value={f.credibility} onChange={(e) => set('credibility', +e.target.value)}>{[1, 2, 3, 4, 5, 6].map((n) => <option key={n}>{n}</option>)}</select></div>
          <div className="field"><label>Traffic light (TLP)</label><select className="input" value={f.tlp} onChange={(e) => set('tlp', e.target.value)}>{meta.tlps.map((x: string) => <option key={x} value={x}>{x} — {TLP_STYLE[x].hint}</option>)}</select></div>
        </div>
        <div className="grid-2">
          <div className="field"><label>Source (vetted sources only)</label><select className="input" value={f.sourceId} onChange={(e) => set('sourceId', e.target.value)}><option value="">— none / internal —</option>{vetted.map((s) => <option key={s._id} value={s._id}>{s.name} (reliability {s.reliability})</option>)}</select></div>
          <div className="field"><label>Observed</label><input className="input" type="date" value={f.observedAt} onChange={(e) => set('observedAt', e.target.value)} /></div>
          <div className="field"><label>Actor / campaign</label><input className="input" value={f.actorName} onChange={(e) => set('actorName', e.target.value)} /></div>
          <div className="field"><label>Affected products (we compare these with our assets)</label><input className="input" value={f.affectedProducts} onChange={(e) => set('affectedProducts', e.target.value)} placeholder="Fortinet, Exchange Server" /></div>
          <div className="field"><label>CVEs</label><input className="input" value={f.cves} onChange={(e) => set('cves', e.target.value)} placeholder="CVE-2024-3094, …" /></div>
          <div className="field"><label>MITRE ATT&CK techniques</label><input className="input" value={f.ttps} onChange={(e) => set('ttps', e.target.value)} placeholder="T1566.001, T1059" /></div>
          <div className="field"><label>Tags</label><input className="input" value={f.tags} onChange={(e) => set('tags', e.target.value)} /></div>
        </div>
        {f.tlp === 'RED' && <div className="field"><label>Only these people may see it (you are always included)</label><select multiple className="input" style={{ height: 110 }} value={f.restrictedTo} onChange={(e) => set('restrictedTo', Array.from(e.target.selectedOptions).map((o) => o.value))}>{meta.people.map((p: any) => <option key={p._id} value={p._id}>{p.name}</option>)}</select></div>}
      </div>
    </Modal>
  );
}

function ImportModal({ meta, onClose, onDone }: { meta: any; onClose: () => void; onDone: () => void }) {
  const { showError, showSuccess } = useToast();
  const [format, setFormat] = useState('stix'); const [content, setContent] = useState(''); const [title, setTitle] = useState('');
  const [tlp, setTlp] = useState('GREEN'); const [severity, setSeverity] = useState('medium');
  const fileRef = useRef<HTMLInputElement>(null);
  async function pick(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]; if (!file) return;
    if (file.size > 12 * 1024 * 1024) { showError('That file is too large (max 12 MB).'); return; }
    setContent(await file.text()); setTitle((t) => t || file.name.replace(/\.[^.]+$/, ''));
    setFormat(/\.json$/i.test(file.name) ? 'stix' : /\.csv$/i.test(file.name) ? 'csv' : 'text');
  }
  async function save() {
    try { const r = await api.post('/threat-intel/import', { format, content, title: title || undefined, tlp, severity }); const d = r.data.data; showSuccess(`${d.created} new indicator(s), ${d.updated} already known${d.rejected?.length ? `, ${d.rejected.length} not recognised` : ''}.`); onDone(); }
    catch (e) { showError(apiErrorMessage(e)); }
  }
  return (
    <Modal open onClose={onClose} title="Import indicators" footer={<><button className="btn btn-ghost" onClick={onClose}>Cancel</button><button className="btn btn-primary" disabled={content.trim().length < 2} onClick={save}>Import</button></>}>
      <div style={{ display: 'grid', gap: 12 }}>
        <p className="text-muted" style={{ fontSize: 13, margin: 0 }}>STIX 2.1 bundle (JSON), CSV with a <code>value</code> column, or plain text — one indicator per line. Defanged forms such as <code>hxxp://bad[.]com</code> are understood.</p>
        <div style={{ display: 'flex', gap: 8 }}><button className="btn btn-ghost" onClick={() => fileRef.current?.click()}><FileUp size={14} /> Choose file</button><input ref={fileRef} type="file" accept=".json,.csv,.txt,.stix" hidden onChange={pick} />
          <select className="input" style={{ maxWidth: 160 }} value={format} onChange={(e) => setFormat(e.target.value)}><option value="stix">STIX 2.1</option><option value="csv">CSV</option><option value="text">Plain text</option></select></div>
        <textarea className="input" rows={7} value={content} onChange={(e) => setContent(e.target.value)} placeholder="…or paste here" style={{ fontFamily: 'monospace', fontSize: 12 }} />
        <div className="grid-3"><div className="field" style={{ gridColumn: 'span 3' }}><label>Title</label><input className="input" value={title} onChange={(e) => setTitle(e.target.value)} /></div>
          <div className="field"><label>TLP</label><select className="input" value={tlp} onChange={(e) => setTlp(e.target.value)}>{meta.tlps.map((x: string) => <option key={x}>{x}</option>)}</select></div>
          <div className="field"><label>Severity</label><select className="input" value={severity} onChange={(e) => setSeverity(e.target.value)}>{meta.severities.map((x: string) => <option key={x} value={x}>{label(x)}</option>)}</select></div></div>
      </div>
    </Modal>
  );
}

/* ------------------------------------ detail --------------------------------- */
function IntelDetail({ id, meta, canManage, onClose }: { id: string; meta: any; canManage: boolean; onClose: () => void }) {
  const { showError, showSuccess } = useToast();
  const confirm = useConfirm();
  const { data: t, loading, error, reload } = useApi<any>(`/threat-intel/${id}`);
  const [analysis, setAnalysis] = useState<string | null>(null);
  const [reco, setReco] = useState<string | null>(null);
  const [products, setProducts] = useState<string | null>(null);
  const [note, setNote] = useState('');
  const [adding, setAdding] = useState(false); const [sharing, setSharing] = useState(false); const [reason, setReason] = useState<{ status: string } | null>(null);
  const call = async (fn: () => Promise<any>, ok: string) => { try { const r = await fn(); showSuccess(ok); reload(); return r; } catch (e) { showError(apiErrorMessage(e)); } };
  async function assess() {
    const r = await call(() => api.post(`/threat-intel/${id}/assess`, { analysis: analysis ?? t.analysis, recommendations: reco ?? t.recommendations, affectedProducts: products != null ? csvToList(products) : undefined }), 'Assessed against our asset register.');
    if (r) { setAnalysis(null); setReco(null); setProducts(null); }
  }
  async function stix(anon: boolean) { try { const r = await api.get(`/threat-intel/${id}/stix`, { params: { anonymise: anon ? 1 : undefined }, responseType: 'blob' }); saveBlob(r.data, filenameFrom(r.headers['content-disposition'], `${t.reference}.stix.json`)); } catch (e) { showError(apiErrorMessage(e)); } }
  async function incident() { if (await confirm({ title: 'Open an incident?', message: 'A security incident is created from this intelligence, with the matched assets attached.', confirmLabel: 'Open incident' })) call(() => api.post(`/threat-intel/${id}/incident`, {}), 'Incident opened — see Incidents.'); }
  const next = (s: string) => { if (['dismissed', 'closed'].includes(s)) setReason({ status: s }); else call(() => api.post(`/threat-intel/${id}/transition`, { status: s }), `Marked ${s}.`); };
  const dirty = analysis != null || reco != null || products != null;
  return (
    <Modal open onClose={onClose} title={t ? `${t.reference} · ${t.title}` : 'Threat intelligence'} size="xwide">
      {loading && !t ? <Loading /> : error ? <ErrorNote message={error} /> : t && (
        <div style={{ display: 'grid', gap: 16 }}>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
            <Badge tone={SEV_TONE[t.severity]}>{label(t.severity)}</Badge><Tlp v={t.tlp} /><Badge>{label(t.layer)}</Badge><Badge>{label(t.category)}</Badge><Badge tone={STATUS_TONE[t.status]}>{label(t.status)}</Badge>
            {t.relevance && t.relevance !== 'unassessed' && <Badge tone={t.relevance === 'high' ? 'danger' : 'neutral'}>Relevance: {label(t.relevance)}</Badge>}
            <div style={{ flex: 1 }} />
            {canManage && <select className="input" style={{ maxWidth: 190 }} value="" onChange={(e) => e.target.value && next(e.target.value)}><option value="">Move to…</option>{meta.statuses.filter((s: string) => s !== t.status).map((s: string) => <option key={s} value={s}>{label(s)}</option>)}</select>}
          </div>
          <div className="grid-2">
            <Kv rows={[['Source', t.sourceName ? <>{t.sourceName}{t.sourceUrl && <> · <a href={t.sourceUrl} target="_blank" rel="noreferrer noopener">link</a></>}</> : '—'], ['Observed', fdate(t.observedAt)], ['Confidence', `${label(t.confidence)} · credibility ${t.credibility}/6`], ['Actor', t.actorName ? `${t.actorName}${t.actorType ? ` (${label(t.actorType)})` : ''}` : '—'], ['Analyst', t.analystName || '—'], ['Next review', fdate(t.nextReviewDate)]]} />
            <Kv rows={[['CVEs', (t.cves || []).join(', ') || '—'], ['ATT&CK', (t.ttps || []).map((x: string) => <a key={x} style={{ marginRight: 8 }} href={`https://attack.mitre.org/techniques/${x.replace('.', '/')}/`} target="_blank" rel="noreferrer noopener">{x}</a>)], ['Products', (t.affectedProducts || []).join(', ') || '—'], ['Tags', (t.tags || []).join(', ') || '—'], ['Origin', label(t.origin)], ['Recorded by', `${t.createdByName || '—'} · ${fdate(t.createdAt)}`]]} />
          </div>
          {t.summary && <div style={{ whiteSpace: 'pre-wrap', fontSize: 13.5 }}>{t.summary}</div>}

          <div className="card" style={{ display: 'grid', gap: 10 }}>
            <strong>Analysis — how does this affect us?</strong>
            {canManage ? <>
              <textarea className="input" rows={4} value={analysis ?? t.analysis ?? ''} onChange={(e) => setAnalysis(e.target.value)} placeholder="Why it matters to Global SJX, which systems / people / clients are in scope, how likely and how severe." />
              <div className="field"><label>Recommendations — remediation, response and defensive measures</label><textarea className="input" rows={3} value={reco ?? t.recommendations ?? ''} onChange={(e) => setReco(e.target.value)} /></div>
              <div className="field"><label>Affected products (compared with our asset register)</label><input className="input" value={products ?? (t.affectedProducts || []).join(', ')} onChange={(e) => setProducts(e.target.value)} /></div>
              <div><button className="btn btn-primary btn-sm" onClick={assess}><Crosshair size={13} /> {dirty ? 'Save & check exposure' : 'Check exposure'}</button></div></>
              : <><div style={{ whiteSpace: 'pre-wrap', fontSize: 13.5 }}>{t.analysis || <span className="text-muted">Not analysed yet.</span>}</div>{t.recommendations && <div style={{ whiteSpace: 'pre-wrap', fontSize: 13.5 }}><b>Recommendations:</b> {t.recommendations}</div>}</>}
            {t.exposureCheckedAt && <div style={{ fontSize: 13 }}><b>Exposure:</b> {t.matchedAssets?.length ? `${t.matchedAssets.length} of our assets match` : 'no match in the asset register'} <span className="text-muted">(checked {fdate(t.exposureCheckedAt)})</span>
              {!!t.matchedAssets?.length && <ul style={{ margin: '6px 0 0', paddingLeft: 18 }}>{t.matchedAssets.map((a: any) => <li key={a._id}><span className="mono">{a.assetId}</span> {a.title} <Badge tone={a.classification === 'Restricted' ? 'danger' : a.classification === 'Confidential' ? 'gold' : 'neutral'}>{a.classification}</Badge>{a.assignedToName ? ` · ${a.assignedToName}` : ''}</li>)}</ul>}</div>}
          </div>

          <div className="card" style={{ display: 'grid', gap: 8 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}><strong>Actions</strong>{canManage && <button className="btn btn-ghost btn-sm" onClick={() => setAdding(true)}><Plus size={13} /> Add action</button>}</div>
            {!t.actions?.length ? <span className="text-muted" style={{ fontSize: 13 }}>No actions yet — a risk assessment, control update, test input, threat hunt, awareness message or patch.</span> :
              <ul style={{ margin: 0, paddingLeft: 0, listStyle: 'none', display: 'grid', gap: 6 }}>{t.actions.map((a: any) => (
                <li key={a._id} style={{ display: 'flex', gap: 8, alignItems: 'flex-start', fontSize: 13 }}>
                  <input type="checkbox" checked={!!a.done} onChange={() => call(() => api.post(`/threat-intel/${id}/actions/${a._id}/done`), a.done ? 'Reopened.' : 'Completed.')} />
                  <div><span style={{ textDecoration: a.done ? 'line-through' : undefined }}>{a.text}</span> <Badge>{label(a.type)}</Badge>
                    <div className="text-muted" style={{ fontSize: 12 }}>{a.ownerName || 'Unassigned'}{a.dueDate ? ` · due ${fdate(a.dueDate)}` : ''}{a.taskId ? ' · task created' : ''}{a.riskId ? ' · risk raised' : ''}</div></div></li>))}</ul>}
          </div>

          {!!t.indicators?.length && <div className="card"><strong>Indicators ({t.indicators.length})</strong>
            <div className="table-wrap" style={{ marginTop: 6, maxHeight: 220, overflow: 'auto' }}><table className="data-table"><tbody>{t.indicators.slice(0, 100).map((i: any) => <tr key={i._id} style={{ cursor: 'default' }}><td style={{ width: 90 }}><Badge>{i.type}</Badge></td><td className="mono" style={{ wordBreak: 'break-all' }}>{i.value}</td><td style={{ width: 100 }}><Badge tone={i.status === 'active' ? 'success' : 'neutral'}>{label(i.status)}</Badge></td><td style={{ width: 100 }}>{i.sightings ? <Badge tone="danger">seen {i.sightings}×</Badge> : ''}</td></tr>)}</tbody></table></div></div>}

          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            {canManage && <><button className="btn btn-ghost btn-sm" disabled={!!t.incidentId} onClick={incident}><Siren size={13} /> {t.incidentId ? 'Incident opened' : 'Open incident'}</button>
              <button className="btn btn-ghost btn-sm" onClick={() => setSharing(true)} disabled={t.tlp === 'RED'} title={t.tlp === 'RED' ? 'TLP:RED cannot be shared' : ''}><Share2 size={13} /> Share…</button>
              {t.tlp !== 'RED' && <><button className="btn btn-ghost btn-sm" onClick={() => stix(false)}><Download size={13} /> STIX</button><button className="btn btn-ghost btn-sm" onClick={() => stix(true)}><Download size={13} /> STIX (anonymised)</button></>}
              {!t.shares?.length && <button className="btn btn-ghost btn-sm" onClick={async () => { if (await confirm({ title: 'Delete this intelligence?', message: 'It is removed from the register. Use Close instead if you want to keep the record.', danger: true, confirmLabel: 'Delete' })) { await call(() => api.delete(`/threat-intel/${id}`), 'Deleted.'); onClose(); } }}><Trash2 size={13} /> Delete</button>}</>}
          </div>

          {!!t.shares?.length && <div><strong style={{ fontSize: 13 }}>Sharing log</strong><ul style={{ fontSize: 12.5, color: 'var(--muted)', paddingLeft: 18 }}>{t.shares.map((s: any, i: number) => <li key={i}>{fdatetime(s.at)} — {s.byName} → {s.recipient || 'public'} via {label(s.method)} · TLP:{s.tlp}{s.anonymised ? ' · anonymised' : ''}</li>)}</ul></div>}
          <div><strong style={{ fontSize: 13 }}>Notes & history</strong>
            <div style={{ display: 'flex', gap: 8, margin: '6px 0' }}><input className="input" value={note} onChange={(e) => setNote(e.target.value)} placeholder="Add a note" /><button className="btn btn-ghost" disabled={!note.trim()} onClick={async () => { await call(() => api.post(`/threat-intel/${id}/notes`, { text: note }), 'Note added.'); setNote(''); }}>Add</button></div>
            <ul style={{ fontSize: 12.5, color: 'var(--muted)', paddingLeft: 18 }}>{[...(t.notes || [])].reverse().map((n: any, i: number) => <li key={i}>{fdatetime(n.at)} — {n.byName}: {n.text}</li>)}</ul></div>
        </div>
      )}
      {adding && t && <ActionModal id={id} meta={meta} onClose={() => setAdding(false)} onDone={() => { setAdding(false); reload(); }} />}
      {sharing && t && <ShareModal id={id} t={t} meta={meta} onClose={() => setSharing(false)} onDone={() => { setSharing(false); reload(); }} />}
      {reason && <ReasonModal status={reason.status} onClose={() => setReason(null)} onSubmit={async (r) => { await call(() => api.post(`/threat-intel/${id}/transition`, { status: reason.status, reason: r }), `Marked ${reason.status}.`); setReason(null); }} />}
    </Modal>
  );
}

function ReasonModal({ status, onClose, onSubmit }: { status: string; onClose: () => void; onSubmit: (r: string) => void }) {
  const [r, setR] = useState('');
  return <Modal open onClose={onClose} title={`${label(status)} — why?`} footer={<><button className="btn btn-ghost" onClick={onClose}>Cancel</button><button className="btn btn-primary" disabled={r.trim().length < 3} onClick={() => onSubmit(r)}>Confirm</button></>}><div className="field"><label>Reason *</label><textarea className="input" rows={3} value={r} onChange={(e) => setR(e.target.value)} /></div></Modal>;
}

function ActionModal({ id, meta, onClose, onDone }: { id: string; meta: any; onClose: () => void; onDone: () => void }) {
  const { showError, showSuccess } = useToast();
  const [f, setF] = useState<any>({ type: 'risk_assessment', text: '', ownerId: '', dueDate: '', createTask: true, createRisk: false });
  const set = (k: string, v: any) => setF((p: any) => ({ ...p, [k]: v }));
  async function save() { try { await api.post(`/threat-intel/${id}/actions`, { ...f, ownerId: f.ownerId || undefined, dueDate: f.dueDate || undefined }); showSuccess('Action added.'); onDone(); } catch (e) { showError(apiErrorMessage(e)); } }
  const ACT_HELP: Record<string, string> = { risk_assessment: 'Update the risk assessment', control_update: 'Strengthen or add a control', test_input: 'Feed into security testing / pen-test scope', threat_hunt: 'Hunt for the indicators in our environment', incident_response: 'Use in incident response', awareness: 'Tell staff / run awareness', third_party_review: 'Review a supplier or third party', patch: 'Patch / mitigate a vulnerability', other: 'Other' };
  return (
    <Modal open onClose={onClose} title="Add an action" footer={<><button className="btn btn-ghost" onClick={onClose}>Cancel</button><button className="btn btn-primary" disabled={f.text.trim().length < 3} onClick={save}>Add</button></>}>
      <div style={{ display: 'grid', gap: 12 }}>
        <div className="field"><label>Type</label><select className="input" value={f.type} onChange={(e) => set('type', e.target.value)}>{meta.actionTypes.map((x: string) => <option key={x} value={x}>{ACT_HELP[x] || label(x)}</option>)}</select></div>
        <div className="field"><label>What must be done *</label><textarea className="input" rows={3} value={f.text} onChange={(e) => set('text', e.target.value)} /></div>
        <div className="grid-2"><div className="field"><label>Owner</label><select className="input" value={f.ownerId} onChange={(e) => set('ownerId', e.target.value)}><option value="">Me</option>{meta.people.map((p: any) => <option key={p._id} value={p._id}>{p.name}</option>)}</select></div>
          <div className="field"><label>Due (default by severity)</label><input className="input" type="date" value={f.dueDate} onChange={(e) => set('dueDate', e.target.value)} /></div></div>
        <label style={{ display: 'flex', gap: 8, fontSize: 13 }}><input type="checkbox" checked={f.createTask} onChange={(e) => set('createTask', e.target.checked)} /> Create a task for the owner</label>
        <label style={{ display: 'flex', gap: 8, fontSize: 13 }}><input type="checkbox" checked={f.createRisk} onChange={(e) => set('createRisk', e.target.checked)} /> Raise it in the risk register</label>
      </div>
    </Modal>
  );
}

function ShareModal({ id, t, meta, onClose, onDone }: { id: string; t: any; meta: any; onClose: () => void; onDone: () => void }) {
  const { showError, showSuccess } = useToast();
  const [f, setF] = useState<any>({ method: 'email', recipient: '', anonymise: t.tlp !== 'AMBER' ? true : false, note: '' });
  const set = (k: string, v: any) => setF((p: any) => ({ ...p, [k]: v }));
  const external = ['stix_taxii', 'platform', 'public'].includes(f.method);
  async function save() { try { await api.post(`/threat-intel/${id}/share`, { ...f, anonymise: external ? true : f.anonymise }); showSuccess('Recorded as shared.'); onDone(); } catch (e) { showError(apiErrorMessage(e)); } }
  return (
    <Modal open onClose={onClose} title="Share this intelligence" footer={<><button className="btn btn-ghost" onClick={onClose}>Cancel</button><button className="btn btn-primary" onClick={save}>Record sharing</button></>}>
      <div style={{ display: 'grid', gap: 12 }}>
        <div className="card" style={{ background: 'var(--surface-2)', fontSize: 13 }}><Tlp v={t.tlp} /> {TLP_STYLE[t.tlp].hint}. Only analysed intelligence can be shared, and everything shared is logged.</div>
        <div className="field"><label>Method</label><select className="input" value={f.method} onChange={(e) => set('method', e.target.value)}><option value="email">E-mail (named recipient)</option><option value="verbal">Briefing / verbal</option><option value="stix_taxii">STIX / TAXII exchange</option><option value="platform">Community platform (ISAC, OTX …)</option><option value="public">Public release</option></select></div>
        <div className="field"><label>Recipient {t.tlp === 'AMBER' && '*'}</label><input className="input" value={f.recipient} onChange={(e) => set('recipient', e.target.value)} placeholder="Name, organisation or community" /></div>
        <label style={{ display: 'flex', gap: 8, fontSize: 13 }}><input type="checkbox" checked={external ? true : f.anonymise} disabled={external} onChange={(e) => set('anonymise', e.target.checked)} /> Anonymised — removes our name, e-mail addresses, internal IPs and asset ids{external ? ' (required for external sharing)' : ''}</label>
        <div className="field"><label>Note</label><input className="input" value={f.note} onChange={(e) => set('note', e.target.value)} /></div>
        <p className="text-muted" style={{ fontSize: 12.5, margin: 0 }}>This records the sharing; use “STIX (anonymised)” on the previous screen to download the file to send.</p>
      </div>
    </Modal>
  );
}

/* --------------------------------- indicators -------------------------------- */
function Indicators({ meta, canManage, seenOnly, open }: { meta: any; canManage: boolean; seenOnly: boolean; open: (id: string) => void }) {
  const { showError, showSuccess } = useToast();
  const confirm = useConfirm();
  const [f, setF] = useState<Record<string, string>>({ status: 'active', seen: seenOnly ? '1' : '' });
  const list = useApi<any[]>('/threat-intel/indicators', Object.fromEntries(Object.entries(f).filter(([, v]) => v)));
  const [adding, setAdding] = useState(false); const [checking, setChecking] = useState(false); const [importing, setImporting] = useState(false);
  const [hunt, setHunt] = useState<any | null>(null); const [hunting, setHunting] = useState(false);
  async function runHunt() { setHunting(true); try { const r = await api.post('/threat-intel/indicators/hunt', { days: 90 }); setHunt(r.data.data); list.reload(); } catch (e) { showError(apiErrorMessage(e)); } finally { setHunting(false); } }
  async function setStatus(i: any, status: string) { try { await api.patch(`/threat-intel/indicators/${i._id}`, { status }); showSuccess(`Marked ${status}.`); list.reload(); } catch (e) { showError(apiErrorMessage(e)); } }
  async function exportCsv() { try { const r = await api.get('/threat-intel/export/indicators.csv', { responseType: 'blob' }); saveBlob(r.data, 'indicators.csv'); } catch (e) { showError(apiErrorMessage(e)); } }
  return (
    <div style={{ marginTop: 14 }}>
      <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', marginBottom: 14, alignItems: 'center' }}>
        <input className="input" style={{ maxWidth: 240 }} placeholder="Search value" value={f.search || ''} onChange={(e) => setF({ ...f, search: e.target.value })} />
        <select className="input" style={{ maxWidth: 150 }} value={f.type || ''} onChange={(e) => setF({ ...f, type: e.target.value })}><option value="">Any type</option>{meta.indicatorTypes.map((x: string) => <option key={x}>{x}</option>)}</select>
        <select className="input" style={{ maxWidth: 150 }} value={f.status || ''} onChange={(e) => setF({ ...f, status: e.target.value })}><option value="">Any status</option>{['active', 'expired', 'revoked', 'allowlisted'].map((x) => <option key={x} value={x}>{label(x)}</option>)}</select>
        <label style={{ fontSize: 13, display: 'flex', gap: 6 }}><input type="checkbox" checked={f.seen === '1'} onChange={(e) => setF({ ...f, seen: e.target.checked ? '1' : '' })} /> Seen in our data</label>
        <div style={{ flex: 1 }} />
        <button className="btn btn-ghost" onClick={() => setChecking(true)}><Search size={15} /> Check a value</button>
        {canManage && <><button className="btn btn-ghost" onClick={runHunt} disabled={hunting}><Radar size={15} /> {hunting ? 'Hunting…' : 'Hunt in our data'}</button>
          <button className="btn btn-ghost" onClick={exportCsv}><Download size={15} /> CSV</button><button className="btn btn-ghost" onClick={() => setImporting(true)}><FileUp size={15} /> Import</button><button className="btn btn-primary" onClick={() => setAdding(true)}><Plus size={15} /> Add</button></>}
      </div>
      <ErrorNote message={list.error} />
      {list.loading && !list.data ? <Loading /> : !list.data?.length ? <Empty icon={<ShieldAlert />} title="No indicators" hint="Indicators of compromise (IPs, domains, URLs, hashes, e-mail addresses) come from intelligence you record or import." /> : (
        <div className="table-wrap"><table className="data-table"><thead><tr><th>Type</th><th>Value</th><th>Severity</th><th>Conf.</th><th>TLP</th><th>Sightings</th><th>Valid until</th><th>Status</th>{canManage && <th />}</tr></thead>
          <tbody>{list.data.map((i) => <tr key={i._id} style={{ cursor: i.intelId ? 'pointer' : 'default' }} onClick={() => i.intelId && open(i.intelId)}>
            <td><Badge>{i.type}</Badge></td><td className="mono" style={{ wordBreak: 'break-all' }}>{i.value}<div className="text-muted" style={{ fontSize: 11.5, fontFamily: 'inherit' }}>{i.description || i.sourceName || ''}</div></td>
            <td><Badge tone={SEV_TONE[i.severity]}>{label(i.severity)}</Badge></td><td>{i.confidence}</td><td><Tlp v={i.tlp} /></td>
            <td>{i.sightings ? <span title={i.lastSightingNote}><Badge tone="danger">{i.sightings}×</Badge></span> : '—'}</td><td>{fdate(i.validUntil)}</td><td><Badge tone={i.status === 'active' ? 'success' : 'neutral'}>{label(i.status)}</Badge></td>
            {canManage && <td onClick={(e) => e.stopPropagation()} style={{ whiteSpace: 'nowrap' }}>{i.status === 'active' ? <><button className="btn btn-ghost btn-sm" onClick={() => setStatus(i, 'allowlisted')} title="False positive">Allow</button> <button className="btn btn-ghost btn-sm" onClick={() => setStatus(i, 'revoked')}>Revoke</button></> : <button className="btn btn-ghost btn-sm" onClick={() => setStatus(i, 'active')}>Reactivate</button>}
              <button className="btn btn-ghost btn-sm" aria-label="Delete" onClick={async () => { if (await confirm({ title: 'Delete indicator?', message: i.value, danger: true, confirmLabel: 'Delete' })) { await api.delete(`/threat-intel/indicators/${i._id}`).catch((e) => showError(apiErrorMessage(e))); list.reload(); } }}><Trash2 size={13} /></button></td>}</tr>)}</tbody></table></div>)}
      {adding && <AddIndicators meta={meta} onClose={() => setAdding(false)} onDone={() => { setAdding(false); list.reload(); }} />}
      {checking && <CheckModal onClose={() => setChecking(false)} />}
      {importing && <ImportModal meta={meta} onClose={() => setImporting(false)} onDone={() => { setImporting(false); list.reload(); }} />}
      {hunt && <HuntResult r={hunt} onClose={() => setHunt(null)} />}
    </div>
  );
}

function AddIndicators({ meta, onClose, onDone }: { meta: any; onClose: () => void; onDone: () => void }) {
  const { showError, showSuccess } = useToast();
  const [text, setText] = useState(''); const [tlp, setTlp] = useState('GREEN'); const [severity, setSeverity] = useState('medium'); const [validDays, setValidDays] = useState('');
  async function save() { try { const r = await api.post('/threat-intel/indicators/bulk', { text, tlp, severity, validDays: validDays ? +validDays : undefined }); const d = r.data.data; showSuccess(`${d.created} added, ${d.updated} already known${d.rejected?.length ? `, ${d.rejected.length} not recognised (${d.rejected.slice(0, 3).join(', ')})` : ''}.`); onDone(); } catch (e) { showError(apiErrorMessage(e)); } }
  return (
    <Modal open onClose={onClose} title="Add indicators" footer={<><button className="btn btn-ghost" onClick={onClose}>Cancel</button><button className="btn btn-primary" disabled={!text.trim()} onClick={save}>Add</button></>}>
      <div style={{ display: 'grid', gap: 12 }}>
        <p className="text-muted" style={{ fontSize: 13, margin: 0 }}>Paste IP addresses, domains, URLs, e-mail addresses, file hashes (MD5 / SHA-1 / SHA-256) or CVE ids — one per line. The type is detected for you.</p>
        <textarea className="input" rows={8} value={text} onChange={(e) => setText(e.target.value)} style={{ fontFamily: 'monospace', fontSize: 12 }} />
        <div className="grid-3"><div className="field"><label>TLP</label><select className="input" value={tlp} onChange={(e) => setTlp(e.target.value)}>{meta.tlps.map((x: string) => <option key={x}>{x}</option>)}</select></div>
          <div className="field"><label>Severity</label><select className="input" value={severity} onChange={(e) => setSeverity(e.target.value)}>{meta.severities.map((x: string) => <option key={x} value={x}>{label(x)}</option>)}</select></div>
          <div className="field"><label>Expires after (days)</label><input className="input" type="number" min="1" value={validDays} onChange={(e) => setValidDays(e.target.value)} placeholder="never" /></div></div>
      </div>
    </Modal>
  );
}

function CheckModal({ onClose }: { onClose: () => void }) {
  const { showError } = useToast();
  const [v, setV] = useState(''); const [res, setRes] = useState<any | null>(null);
  async function go() { try { const r = await api.post('/threat-intel/indicators/check', { values: v }); setRes(r.data.data); } catch (e) { showError(apiErrorMessage(e)); } }
  return (
    <Modal open onClose={onClose} title="Is this a known threat?" footer={<><button className="btn btn-ghost" onClick={onClose}>Close</button><button className="btn btn-primary" disabled={!v.trim()} onClick={go}>Check</button></>}>
      <div style={{ display: 'grid', gap: 12 }}>
        <p className="text-muted" style={{ fontSize: 13, margin: 0 }}>Received a suspicious link, sender or file? Paste it here (safe to paste defanged) to see whether it is on our indicator list.</p>
        <textarea className="input" rows={4} value={v} onChange={(e) => setV(e.target.value)} style={{ fontFamily: 'monospace', fontSize: 12 }} />
        {res && <div style={{ display: 'grid', gap: 6 }}>{res.results.map((r: any, i: number) => <div key={i} className="card" style={{ display: 'flex', gap: 10, alignItems: 'center', borderLeft: `3px solid ${r.known && r.status === 'active' ? '#d6455d' : r.known ? '#F0A93B' : '#2e9e6b'}` }}><Badge>{r.type}</Badge><span className="mono" style={{ wordBreak: 'break-all', flex: 1 }}>{r.value}</span>{r.known ? <Badge tone={r.status === 'active' ? 'danger' : 'gold'}>{r.status === 'active' ? `Known threat · ${label(r.severity)}` : label(r.status)}</Badge> : <Badge tone="success">Not on our list</Badge>}</div>)}
          {!!res.rejected?.length && <div className="text-muted" style={{ fontSize: 12.5 }}>Not recognised: {res.rejected.join(', ')}</div>}
          <div className="text-muted" style={{ fontSize: 12 }}>“Not on our list” does not mean safe — report anything suspicious to the security team.</div></div>}
      </div>
    </Modal>
  );
}

function HuntResult({ r, onClose }: { r: any; onClose: () => void }) {
  return (
    <Modal open onClose={onClose} title="Threat hunt result" size="wide" footer={<button className="btn btn-primary" onClick={onClose}>Close</button>}>
      <p style={{ marginTop: 0, fontSize: 13.5 }}>{r.checked} active indicators were compared with the last {r.days} days of sign-ins, audit log, mail log and the user directory. <b>{r.hits.length ? `${r.hits.length} match(es) found.` : 'No matches.'}</b></p>
      {!!r.hits.length && <div className="table-wrap"><table className="data-table"><thead><tr><th>Indicator</th><th>Where</th><th>Detail</th><th>When</th></tr></thead><tbody>{r.hits.map((h: any, i: number) => <tr key={i} style={{ cursor: 'default' }}><td><Badge tone={SEV_TONE[h.indicator.severity]}>{h.indicator.type}</Badge> <span className="mono">{h.indicator.value}</span></td><td>{h.where}</td><td>{h.detail}</td><td>{fdatetime(h.at)}</td></tr>)}</tbody></table></div>}
      {!!r.hits.length && <p className="text-muted" style={{ fontSize: 12.5 }}>Investigate each match. If confirmed, open an incident from the related intelligence.</p>}
    </Modal>
  );
}

/* ------------------------------------ sources -------------------------------- */
function Sources({ meta, canManage }: { meta: any; canManage: boolean }) {
  const { showError, showSuccess } = useToast();
  const confirm = useConfirm();
  const list = useApi<any[]>('/threat-intel/sources');
  const [edit, setEdit] = useState<any | null>(null); const [vet, setVet] = useState<any | null>(null); const [busy, setBusy] = useState('');
  async function collect(s: any) { setBusy(s._id); try { const r = await api.post(`/threat-intel/sources/${s._id}/collect`); const d = r.data.data; showSuccess(`Collected: ${d.intelCreated} intelligence item(s), ${d.indicatorsCreated} indicator(s).`); list.reload(); } catch (e) { showError(apiErrorMessage(e)); list.reload(); } finally { setBusy(''); } }
  return (
    <div style={{ marginTop: 14 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12, gap: 10, flexWrap: 'wrap' }}>
        <p className="text-muted" style={{ margin: 0, fontSize: 13, maxWidth: 720 }}>Sources are vetted before use: record how reliable each one is (A completely reliable – E unreliable, F not yet judged) and review it periodically. Intelligence can only cite vetted sources, and only vetted sources are collected automatically.</p>
        {canManage && <button className="btn btn-primary" onClick={() => setEdit({})}><Plus size={15} /> Add source</button>}
      </div>
      <ErrorNote message={list.error} />
      {list.loading && !list.data ? <Loading /> : !list.data?.length ? <Empty icon={<Radar />} title="No sources" /> : (
        <div className="table-wrap"><table className="data-table"><thead><tr><th>Source</th><th>Type</th><th>Reliability</th><th>Vetting</th><th>Feed</th><th>Last collection</th>{canManage && <th />}</tr></thead>
          <tbody>{list.data.map((s) => <tr key={s._id} style={{ cursor: 'default', opacity: s.active ? 1 : 0.55 }}>
            <td><strong>{s.name}</strong>{s.url && <div style={{ fontSize: 12 }}><a href={s.url} target="_blank" rel="noreferrer noopener">{s.url.replace(/^https?:\/\//, '').slice(0, 44)}</a></div>}<div className="text-muted" style={{ fontSize: 12, maxWidth: 380 }}>{s.description}</div></td>
            <td>{label(s.type)}</td><td><Badge tone={['A', 'B'].includes(s.reliability) ? 'success' : s.reliability === 'F' ? 'neutral' : 'gold'}>{s.reliability}</Badge></td>
            <td>{s.vetted ? <><Badge tone="success">Vetted</Badge><div className="text-muted" style={{ fontSize: 11.5 }}>{s.vettedByName} · {fdate(s.vettedAt)}{s.nextReviewDate && new Date(s.nextReviewDate) < new Date() ? ' · review overdue' : ''}</div></> : <Badge tone="gold">Not vetted</Badge>}</td>
            <td style={{ fontSize: 12.5 }}>{s.feedFormat && s.feedFormat !== 'none' ? <>{label(s.feedFormat)}{s.autoCollect ? <div className="text-muted">auto daily</div> : <div className="text-muted">manual</div>}</> : '—'}</td>
            <td style={{ fontSize: 12.5 }}>{s.lastCollectedAt ? fdatetime(s.lastCollectedAt) : '—'}{s.lastCollectStatus && s.lastCollectStatus !== 'ok' && <div style={{ color: '#d6455d' }}>{s.lastCollectStatus}</div>}</td>
            {canManage && <td style={{ whiteSpace: 'nowrap', textAlign: 'right' }}>
              {s.feedFormat && s.feedFormat !== 'none' && s.vetted && <button className="btn btn-ghost btn-sm" disabled={busy === s._id} onClick={() => collect(s)}>{busy === s._id ? 'Collecting…' : 'Collect now'}</button>}{' '}
              <button className="btn btn-ghost btn-sm" onClick={() => setVet(s)}>{s.vetted ? 'Re-vet' : 'Vet'}</button>{' '}<button className="btn btn-ghost btn-sm" onClick={() => setEdit(s)}>Edit</button>{' '}
              <button className="btn btn-ghost btn-sm" aria-label="Remove" onClick={async () => { if (await confirm({ title: 'Remove source?', message: s.name, danger: true, confirmLabel: 'Remove' })) { await api.delete(`/threat-intel/sources/${s._id}`).catch((e) => showError(apiErrorMessage(e))); list.reload(); } }}><Trash2 size={13} /></button></td>}</tr>)}</tbody></table></div>)}
      {edit && <SourceForm meta={meta} s={edit} onClose={() => setEdit(null)} onSaved={() => { setEdit(null); list.reload(); }} />}
      {vet && <VetModal s={vet} onClose={() => setVet(null)} onSaved={() => { setVet(null); list.reload(); }} />}
    </div>
  );
}

function SourceForm({ meta, s, onClose, onSaved }: { meta: any; s: any; onClose: () => void; onSaved: () => void }) {
  const { showError, showSuccess } = useToast();
  const [f, setF] = useState<any>({ name: '', type: 'osint', url: '', description: '', defaultTlp: 'GREEN', defaultLayer: 'tactical', feedFormat: 'none', feedUrl: '', autoCollect: false, active: true, ...s });
  const set = (k: string, v: any) => setF((p: any) => ({ ...p, [k]: v }));
  async function save() {
    const body = { name: f.name, type: f.type, url: f.url || undefined, description: f.description || undefined, defaultTlp: f.defaultTlp, defaultLayer: f.defaultLayer, feedFormat: f.feedFormat, feedUrl: f.feedUrl || undefined, autoCollect: !!f.autoCollect, active: !!f.active };
    try { if (s._id) await api.patch(`/threat-intel/sources/${s._id}`, body); else await api.post('/threat-intel/sources', body); showSuccess('Saved.'); onSaved(); } catch (e) { showError(apiErrorMessage(e)); }
  }
  return (
    <Modal open onClose={onClose} title={s._id ? 'Edit source' : 'Add source'} size="wide" footer={<><button className="btn btn-ghost" onClick={onClose}>Cancel</button><button className="btn btn-primary" disabled={f.name.trim().length < 2} onClick={save}>Save</button></>}>
      <div className="grid-2">
        <div className="field"><label>Name *</label><input className="input" value={f.name} onChange={(e) => set('name', e.target.value)} /></div>
        <div className="field"><label>Type</label><select className="input" value={f.type} onChange={(e) => set('type', e.target.value)}>{meta.sourceTypes.map((x: string) => <option key={x} value={x}>{label(x)}</option>)}</select></div>
        <div className="field"><label>Website</label><input className="input" value={f.url || ''} onChange={(e) => set('url', e.target.value)} /></div>
        <div className="field"><label>Description</label><input className="input" value={f.description || ''} onChange={(e) => set('description', e.target.value)} /></div>
        <div className="field"><label>Default TLP</label><select className="input" value={f.defaultTlp} onChange={(e) => set('defaultTlp', e.target.value)}>{meta.tlps.map((x: string) => <option key={x}>{x}</option>)}</select></div>
        <div className="field"><label>Default layer</label><select className="input" value={f.defaultLayer} onChange={(e) => set('defaultLayer', e.target.value)}>{meta.layers.map((x: string) => <option key={x} value={x}>{label(x)}</option>)}</select></div>
        <div className="field"><label>Feed format</label><select className="input" value={f.feedFormat} onChange={(e) => set('feedFormat', e.target.value)}>{meta.feedFormats.map((x: string) => <option key={x} value={x}>{x === 'none' ? 'No feed (manual)' : x === 'cisa_kev' ? 'CISA KEV (JSON)' : x === 'stix' ? 'STIX 2.1 (JSON)' : x === 'csv' ? 'CSV' : 'Plain text'}</option>)}</select></div>
        <div className="field"><label>Feed address (https only)</label><input className="input" value={f.feedUrl || ''} onChange={(e) => set('feedUrl', e.target.value)} placeholder="https://…" disabled={f.feedFormat === 'none'} /></div>
      </div>
      <div style={{ display: 'flex', gap: 18, marginTop: 12 }}><label style={{ display: 'flex', gap: 6, fontSize: 13 }}><input type="checkbox" checked={!!f.autoCollect} disabled={f.feedFormat === 'none'} onChange={(e) => set('autoCollect', e.target.checked)} /> Collect automatically every day (source must be vetted)</label><label style={{ display: 'flex', gap: 6, fontSize: 13 }}><input type="checkbox" checked={!!f.active} onChange={(e) => set('active', e.target.checked)} /> Active</label></div>
    </Modal>
  );
}

function VetModal({ s, onClose, onSaved }: { s: any; onClose: () => void; onSaved: () => void }) {
  const { showError, showSuccess } = useToast();
  const [reliability, setReliability] = useState(s.reliability === 'F' ? 'C' : s.reliability); const [notes, setNotes] = useState(s.vettingNotes || ''); const [months, setMonths] = useState(12);
  async function save() { try { await api.post(`/threat-intel/sources/${s._id}/vet`, { reliability, notes, reviewMonths: months }); showSuccess('Source vetted.'); onSaved(); } catch (e) { showError(apiErrorMessage(e)); } }
  return (
    <Modal open onClose={onClose} title={`Vet: ${s.name}`} footer={<><button className="btn btn-ghost" onClick={onClose}>Cancel</button><button className="btn btn-primary" disabled={notes.trim().length < 5} onClick={save}>Mark as vetted</button></>}>
      <div style={{ display: 'grid', gap: 12 }}>
        <p className="text-muted" style={{ fontSize: 13, margin: 0 }}>Judge the source on track record, how it collects and verifies, timeliness, relevance to our sector and technology, and licence terms.</p>
        <div className="field"><label>Reliability</label><select className="input" value={reliability} onChange={(e) => setReliability(e.target.value)}><option value="A">A — completely reliable</option><option value="B">B — usually reliable</option><option value="C">C — fairly reliable</option><option value="D">D — not usually reliable</option><option value="E">E — unreliable</option></select></div>
        <div className="field"><label>How did you assess it? *</label><textarea className="input" rows={4} value={notes} onChange={(e) => setNotes(e.target.value)} /></div>
        <div className="field"><label>Review again in (months)</label><input className="input" type="number" min="1" max="36" value={months} onChange={(e) => setMonths(+e.target.value)} /></div>
      </div>
    </Modal>
  );
}
