import { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Boxes, Plus, ShieldCheck, UserCheck, Trash2, Wand2, AlertTriangle, SlidersHorizontal } from 'lucide-react';
import { api, apiErrorMessage } from '@/lib/api';
import { useAuth } from '@/context/AuthContext';
import { useToast } from '@/context/ToastContext';
import { useApi } from '@/lib/useApi';
import { PageHead, Tabs, Empty, Loading, ErrorNote, Kv } from '@/components/ui/PageHead';
import { Badge } from '@/components/ui/Badge';
import { Modal } from '@/components/ui/Modal';
import { Pagination } from '@/components/ui/Pagination';
import { fdate, fdatetime, label, toInputDate } from '@/lib/format';
import { RecordPanel } from '@/components/record/RecordPanel';
import { ExportButton } from '@/components/ui/ExportButton';
import { AssetRiskPanel } from '@/components/AssetRiskPanel';

const CLASS_TONE: Record<string, any> = { Public: 'neutral', Internal: 'neutral', Confidential: 'gold', Restricted: 'danger' };
const EOL_TONE: Record<string, any> = { ok: 'success', approaching: 'gold', expired: 'danger', untracked: 'neutral' };

export function Assets() {
  const [params] = useSearchParams();
  const [page, setPage] = useState(1);
  const [f, setF] = useState<Record<string, string>>({ review: params.get('review') || '' });
  const [create, setCreate] = useState(false);
  const [openId, setOpenId] = useState<string | null>(null);
  const [tab, setTab] = useState(params.get('tab') === 'policy' ? 'policy' : 'register');
  const { user } = useAuth();
  const { showError: bfErr, showSuccess: bfOk } = useToast();
  const canRisk = user?.role === 'super_admin' || (user?.modules || []).some((m: string) => m === 'isms' || m === 'risks');
  async function backfill() { try { const r = await api.post('/asset-risk/backfill', {}); const d = r.data.data; bfOk(`${d.evaluated} asset(s) evaluated, ${d.created} risk(s) added, ${d.rescored} re-scored, ${d.suggested} suggested.`); reload(); } catch (e) { bfErr(apiErrorMessage(e)); } }
  const canPolicy = user?.role === 'super_admin' || (user?.modules || []).includes('asset_policy');
  const meta = useApi<any>('/assets/meta');
  const summary = useApi<any>('/assets/summary');
  const list = useApi<any[]>('/assets', { page, ...Object.fromEntries(Object.entries(f).filter(([, v]) => v)) });
  useEffect(() => setPage(1), [f]);
  const s = summary.data;
  const reload = () => { list.reload(); summary.reload(); };
  return (
    <div className="page-enter">
      <PageHead title="Asset register" subtitle="Hardware, software, data, cloud and suppliers — classified, owned, reviewed and securely disposed of (ISO 27001 A.5.9–A.5.11, A.7.14)."
        actions={<><ExportButton endpoint="/assets" params={Object.fromEntries(Object.entries(f).filter(([, v]) => v))} filename="assets" columns={[{ label: 'Asset ID', value: (r) => r.assetId }, { label: 'Title', value: (r) => r.title }, { label: 'Category', value: (r) => r.category }, { label: 'Classification', value: (r) => r.classification }, { label: 'Lifecycle', value: (r) => r.lifecycleStatus }, { label: 'Assigned to', value: (r) => r.assignedToId?.name }, { label: 'Owner', value: (r) => r.owner }, { label: 'Location', value: (r) => r.location }]} />{canRisk && <button className="btn btn-ghost" onClick={backfill} title="Work out threats and risks for every asset and update the registers"><AlertTriangle size={15} /> Evaluate all risks</button>}<button className="btn btn-primary" onClick={() => setCreate(true)}><Plus size={16} /> Add asset</button></>} />
      {canPolicy && <Tabs value={tab} onChange={setTab} tabs={[{ key: 'register', label: 'Register' }, { key: 'policy', label: 'Classification & naming policy' }]} />}
      {tab === 'policy' && canPolicy ? <PolicyTab classifications={meta.data?.classifications || ['Public', 'Internal', 'Confidential', 'Restricted']} categories={meta.data?.categories || {}} onRescanned={reload} /> : <>
      {s && <div className="stat-grid" style={{ marginBottom: 16 }}>
        <div className="stat-card"><div className="stat-label"><span>Assets</span></div><div className="stat-value">{s.total}</div></div>
        <div className="stat-card"><div className="stat-label"><span>Reviews due (30d)</span></div><div className="stat-value">{s.reviewsDue}</div></div>
        <div className="stat-card"><div className="stat-label"><span>Licences expiring</span></div><div className="stat-value">{s.licencesExpiring}</div></div>
        <div className="stat-card"><div className="stat-label"><span>Warranties expiring</span></div><div className="stat-value">{s.warrantiesExpiring}</div></div></div>}
      {!!s?.byClassification?.length && <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 12, alignItems: 'center' }}><span className="text-muted" style={{ fontSize: 12.5 }}>By classification:</span>{(meta.data?.classifications || []).map((k: string) => { const n = s.byClassification.find((x: any) => x._id === k)?.n || 0; return <button key={k} className="btn btn-ghost btn-sm" onClick={() => setF({ ...f, classification: f.classification === k ? '' : k })} style={{ borderColor: f.classification === k ? 'var(--accent, #C22FD4)' : undefined }}><Badge tone={CLASS_TONE[k]}>{k}</Badge> {n}</button>; })}</div>}
      <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', marginBottom: 14 }}>
        <input className="input" style={{ maxWidth: 240 }} placeholder="Search" value={f.q || ''} onChange={(e) => setF({ ...f, q: e.target.value })} />
        <select className="input" style={{ maxWidth: 220 }} value={f.category || ''} onChange={(e) => setF({ ...f, category: e.target.value })}><option value="">All categories</option>{Object.entries(meta.data?.categories || {}).map(([k, v]: any) => <option key={k} value={k}>{v.label}</option>)}</select>
        <select className="input" style={{ maxWidth: 170 }} value={f.classification || ''} onChange={(e) => setF({ ...f, classification: e.target.value })}><option value="">Any classification</option>{(meta.data?.classifications || []).map((c: string) => <option key={c}>{c}</option>)}</select>
        <select className="input" style={{ maxWidth: 170 }} value={f.lifecycleStatus || ''} onChange={(e) => setF({ ...f, lifecycleStatus: e.target.value })}><option value="">Any status</option>{(meta.data?.lifecycleStatuses || []).map((c: string) => <option key={c} value={c}>{label(c)}</option>)}</select>
      </div>
      <ErrorNote message={list.error} />
      {list.loading && !list.data ? <Loading /> : !list.data?.length ? <Empty icon={<Boxes />} title="No assets" /> : (
        <div className="table-wrap"><table className="data-table"><thead><tr><th>ID</th><th>Asset</th><th>Category</th><th>Class.</th><th>Assigned to</th><th>Life</th><th>Next review</th><th>Status</th></tr></thead>
          <tbody>{list.data.map((a) => <tr key={a._id} onClick={() => setOpenId(a._id)}>
            <td className="mono">{a.assetId}</td><td><strong>{a.title}</strong><div className="text-muted" style={{ fontSize: 12 }}>{a.makeModel || a.serialNumber || ''}</div></td><td>{meta.data?.categories?.[a.category]?.label || a.category}</td>
            <td><Badge tone={CLASS_TONE[a.classification]}>{a.classification}</Badge></td><td>{a.assignedToId?.name || '—'}</td><td><Badge tone={EOL_TONE[a.eolState]}>{label(a.eolState)}</Badge></td>
            <td>{fdate(a.nextReviewDate)}</td><td><Badge>{label(a.lifecycleStatus)}</Badge></td></tr>)}</tbody></table></div>
      )}
      {list.extra?.pagination && <Pagination page={list.extra.pagination.page} pages={list.extra.pagination.pages} total={list.extra.pagination.total} onChange={setPage} />}
      </>}
      {create && meta.data && <AssetForm meta={meta.data} onClose={() => setCreate(false)} onSaved={() => { setCreate(false); reload(); }} />}
      {openId && <AssetDetail id={openId} onClose={() => setOpenId(null)} onChanged={reload} />}
    </div>
  );
}

function AssetForm({ meta, onClose, onSaved }: { meta: any; onClose: () => void; onSaved: () => void }) {
  const { showError, showSuccess } = useToast();
  const { user } = useAuth();
  const canOverride = user?.role === 'super_admin' || (user?.modules || []).includes('asset_policy');
  const [f, setF] = useState<any>({ title: '', description: '', category: 'hardware', classification: 'Internal', autoLabel: true, overrideReason: '', confidentiality: 'Medium', integrity: 'Medium', availability: 'Medium', owner: '', custodian: '', location: '', vendor: '', serialNumber: '', makeModel: '', acquisitionDate: '', expectedLifeMonths: '', reviewCycleMonths: 12, licenseExpiryDate: '', warrantyExpiryDate: '' });
  const [check, setCheck] = useState<any>(null);
  const set = (k: string, v: any) => setF((p: any) => ({ ...p, [k]: v }));
  // Live check: what label do the policy rules give this description, and is the name acceptable?
  useEffect(() => {
    const t = setTimeout(async () => {
      if (!f.title.trim() && !f.description.trim()) { setCheck(null); return; }
      try { const r = await api.post('/assets/classify', { title: f.title, description: f.description, category: f.category, classification: f.autoLabel ? undefined : f.classification, auto: f.autoLabel, overrideReason: f.overrideReason }); setCheck(r.data.data); } catch { /* the server re-checks on save */ }
    }, 350);
    return () => clearTimeout(t);
  }, [f.title, f.description, f.category, f.classification, f.autoLabel, f.overrideReason]);
  const problems: any[] = check?.problems || [];
  const sug = check?.suggestion; const blocked = !f.autoLabel ? check?.decision?.blocked : undefined;
  async function save() {
    try { const r = await api.post('/assets', { ...f, classification: f.autoLabel ? undefined : f.classification, classificationOverrideReason: f.overrideReason || undefined }); const a = r.data.data; const re = r.data.riskEngine; showSuccess(`Registered as ${a.assetId} · ${a.classification}${a.classificationSource === 'auto' ? ' (labelled automatically)' : ''}.${re?.created?.length ? ` ${re.created.length} risk(s) added to the risk register and stakeholders notified.` : ''}`); onSaved(); }
    catch (e: any) { const d = e?.response?.data?.details; showError(Array.isArray(d) && d.length ? `${apiErrorMessage(e)} ${d.map((x: any) => x.message || x).join(' ')}` : apiErrorMessage(e)); }
  }
  const sel = (k: string, opts: string[]) => <select className="input" value={f[k]} onChange={(e) => set(k, e.target.value)}>{opts.map((o) => <option key={o}>{o}</option>)}</select>;
  return (
    <Modal open onClose={onClose} title="Add asset" size="wide" footer={<><button className="btn btn-ghost" onClick={onClose}>Cancel</button><button className="btn btn-primary" disabled={problems.length > 0 || (!!blocked && !(canOverride && f.overrideReason.trim()))} onClick={save}>Register asset</button></>}>
      <div className="grid-3">
        <div className="field" style={{ gridColumn: 'span 2' }}><label>Asset title *</label><input className="input" value={f.title} onChange={(e) => set('title', e.target.value)} placeholder="e.g. Finance HP EliteBook 840 G9" /></div>
        <div className="field"><label>Category</label><select className="input" value={f.category} onChange={(e) => set('category', e.target.value)}>{Object.entries(meta.categories).map(([k, v]: any) => <option key={k} value={k}>{v.label}</option>)}</select></div>
        <div className="field" style={{ gridColumn: 'span 3' }}><label>Description — what it is and what it holds (this decides its label)</label><textarea className="input" rows={2} value={f.description} onChange={(e) => set('description', e.target.value)} placeholder="e.g. Customer database backup containing personal data" /></div>
        {problems.length > 0 && <div className="card" style={{ gridColumn: 'span 3', borderLeft: '3px solid var(--danger, #d6455d)' }}><strong style={{ fontSize: 13 }}><AlertTriangle size={13} style={{ verticalAlign: -2 }} /> This cannot be entered</strong><ul style={{ margin: '6px 0 0', paddingLeft: 18, fontSize: 12.5 }}>{problems.map((p: any, i: number) => <li key={i}>{p.message}</li>)}</ul></div>}
        <div className="card" style={{ gridColumn: 'span 3', display: 'grid', gap: 8, background: 'var(--surface-2)' }}>
          <label style={{ display: 'flex', gap: 8, alignItems: 'center', fontSize: 13 }}><input type="checkbox" checked={f.autoLabel} onChange={(e) => set('autoLabel', e.target.checked)} /> <Wand2 size={14} /> Label automatically from the description</label>
          {sug && <div style={{ fontSize: 13 }}>Suggested label: <Badge tone={CLASS_TONE[sug.classification]}>{sug.classification}</Badge> <span className="text-muted">{sug.reason}</span></div>}
          {!f.autoLabel && <div className="grid-2"><div className="field"><label>Classification</label>{sel('classification', meta.classifications)}</div>
            {blocked && <div className="field"><label>{canOverride ? 'Override reason (to keep a lower label)' : 'Not allowed'}</label>{canOverride ? <input className="input" value={f.overrideReason} onChange={(e) => set('overrideReason', e.target.value)} /> : <div style={{ fontSize: 12.5, color: 'var(--danger, #d6455d)' }}>{blocked}</div>}</div>}</div>}
          {!f.autoLabel && blocked && canOverride && <div style={{ fontSize: 12.5, color: 'var(--danger, #d6455d)' }}>{blocked}</div>}
        </div>
        <div className="field"><label>Confidentiality</label>{sel('confidentiality', meta.cia)}</div>
        <div className="field"><label>Integrity</label>{sel('integrity', meta.cia)}</div>
        <div className="field"><label>Availability</label>{sel('availability', meta.cia)}</div>
        <div className="field"><label>Owner</label><input className="input" value={f.owner} onChange={(e) => set('owner', e.target.value)} /></div>
        <div className="field"><label>Custodian</label><input className="input" value={f.custodian} onChange={(e) => set('custodian', e.target.value)} /></div>
        <div className="field"><label>Location</label><input className="input" value={f.location} onChange={(e) => set('location', e.target.value)} /></div>
        <div className="field"><label>Vendor</label><input className="input" value={f.vendor} onChange={(e) => set('vendor', e.target.value)} /></div>
        <div className="field"><label>Make / model</label><input className="input" value={f.makeModel} onChange={(e) => set('makeModel', e.target.value)} /></div>
        <div className="field"><label>Serial no.</label><input className="input" value={f.serialNumber} onChange={(e) => set('serialNumber', e.target.value)} /></div>
        <div className="field"><label>Acquired</label><input className="input" type="date" value={f.acquisitionDate} onChange={(e) => set('acquisitionDate', e.target.value)} /></div>
        <div className="field"><label>Expected life (months)</label><input className="input" type="number" value={f.expectedLifeMonths} onChange={(e) => set('expectedLifeMonths', e.target.value)} /></div>
        <div className="field"><label>Review every (months)</label><input className="input" type="number" value={f.reviewCycleMonths} onChange={(e) => set('reviewCycleMonths', e.target.value)} /></div>
        <div className="field"><label>Licence expiry</label><input className="input" type="date" value={f.licenseExpiryDate} onChange={(e) => set('licenseExpiryDate', e.target.value)} /></div>
        <div className="field"><label>Warranty expiry</label><input className="input" type="date" value={f.warrantyExpiryDate} onChange={(e) => set('warrantyExpiryDate', e.target.value)} /></div>
      </div>
    </Modal>
  );
}

/* --------------------- classification & naming policy (admins) --------------------- */
function PolicyTab({ classifications, categories, onRescanned }: { classifications: string[]; categories: Record<string, any>; onRescanned: () => void }) {
  const { showError, showSuccess } = useToast();
  const { data, loading, error, reload } = useApi<any>('/assets/policy');
  const [p, setP] = useState<any | null>(null);
  const [scan, setScan] = useState<any | null>(null);
  useEffect(() => { if (data) setP(JSON.parse(JSON.stringify(data))); }, [data]);
  if (loading && !p) return <Loading />;
  if (error) return <ErrorNote message={error} />;
  if (!p) return null;
  const upd = (k: string, v: any) => setP((x: any) => ({ ...x, [k]: v }));
  const rule = (i: number, k: string, v: any) => upd('rules', p.rules.map((r: any, j: number) => (j === i ? { ...r, [k]: v } : r)));
  const blk = (i: number, k: string, v: any) => upd('blockedNames', p.blockedNames.map((r: any, j: number) => (j === i ? { ...r, [k]: v } : r)));
  async function save() { try { await api.put('/assets/policy', { autoLabel: p.autoLabel, enforceMinimum: p.enforceMinimum, defaultClassification: p.defaultClassification, categoryDefaults: p.categoryDefaults, rules: p.rules, blockedNames: p.blockedNames, naming: p.naming }); showSuccess('Policy saved.'); reload(); } catch (e) { showError(apiErrorMessage(e)); } }
  async function rescan(dryRun: boolean) { try { const r = await api.post('/assets/policy/rescan', { dryRun }); setScan(r.data.data); if (!dryRun) { showSuccess(`${r.data.data.raised.length} asset(s) re-labelled.`); onRescanned(); } } catch (e) { showError(apiErrorMessage(e)); } }
  const NAMING: Array<[string, string]> = [['blockPlaceholders', 'Placeholder names (n/a, tbd, temp, sample…)'], ['blockEmails', 'E-mail addresses in names or descriptions'], ['blockSecrets', 'Passwords, API keys, tokens and private keys'], ['blockCardNumbers', 'Payment card numbers'], ['blockIpAddresses', 'IP addresses']];
  return (
    <div style={{ display: 'grid', gap: 18, marginTop: 14 }}>
      <div className="card" style={{ display: 'grid', gap: 10 }}>
        <strong><SlidersHorizontal size={14} style={{ verticalAlign: -2 }} /> How labels are decided</strong>
        <label style={{ display: 'flex', gap: 8, fontSize: 13 }}><input type="checkbox" checked={p.autoLabel} onChange={(e) => upd('autoLabel', e.target.checked)} /> Label assets automatically from their title and description. The highest matching rule wins.</label>
        <label style={{ display: 'flex', gap: 8, fontSize: 13 }}><input type="checkbox" checked={p.enforceMinimum} onChange={(e) => upd('enforceMinimum', e.target.checked)} /> Nobody can choose a label lower than the rules require (only a policy owner can override, with a reason that is recorded).</label>
        <div className="field" style={{ maxWidth: 260 }}><label>When nothing matches</label><select className="input" value={p.defaultClassification} onChange={(e) => upd('defaultClassification', e.target.value)}>{classifications.map((c) => <option key={c}>{c}</option>)}</select></div>
        <div><div style={{ fontSize: 13, marginBottom: 6 }}>Minimum label by category</div><div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>{Object.entries(categories).map(([k, v]: any) => <label key={k} style={{ fontSize: 12.5 }}>{v.label}<br /><select className="input" style={{ minWidth: 130 }} value={p.categoryDefaults?.[k] || ''} onChange={(e) => upd('categoryDefaults', { ...p.categoryDefaults, [k]: e.target.value || undefined })}><option value="">—</option>{classifications.map((c) => <option key={c}>{c}</option>)}</select></label>)}</div></div>
      </div>
      <div className="card" style={{ display: 'grid', gap: 10 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between' }}><strong>Labelling rules</strong><button className="btn btn-ghost btn-sm" onClick={() => upd('rules', [...p.rules, { name: 'New rule', classification: 'Confidential', keywords: [], categories: [], enabled: true }])}><Plus size={13} /> Add rule</button></div>
        {p.rules.map((r: any, i: number) => <div key={i} style={{ display: 'grid', gridTemplateColumns: '1.2fr 130px 3fr auto', gap: 8, alignItems: 'start', opacity: r.enabled === false ? 0.5 : 1 }}>
          <input className="input" aria-label="Rule name" value={r.name} onChange={(e) => rule(i, 'name', e.target.value)} />
          <select className="input" aria-label="Classification" value={r.classification} onChange={(e) => rule(i, 'classification', e.target.value)}>{classifications.map((c) => <option key={c}>{c}</option>)}</select>
          <textarea className="input" aria-label="Keywords" rows={2} value={(r.keywords || []).join(', ')} onChange={(e) => rule(i, 'keywords', e.target.value.split(',').map((x: string) => x.trim()).filter(Boolean))} placeholder="keywords, separated by commas" />
          <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}><label style={{ fontSize: 12 }}><input type="checkbox" checked={r.enabled !== false} onChange={(e) => rule(i, 'enabled', e.target.checked)} /> on</label><button className="btn btn-ghost btn-sm" aria-label="Delete rule" onClick={() => upd('rules', p.rules.filter((_: any, j: number) => j !== i))}><Trash2 size={13} /></button></div></div>)}
      </div>
      <div className="card" style={{ display: 'grid', gap: 10 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between' }}><strong>Names that cannot be entered</strong><button className="btn btn-ghost btn-sm" onClick={() => upd('blockedNames', [...p.blockedNames, { term: '', matchType: 'word', reason: '', appliesTo: 'all', enabled: true }])}><Plus size={13} /> Add name</button></div>
        {p.blockedNames.map((b: any, i: number) => <div key={i} style={{ display: 'grid', gridTemplateColumns: '1.3fr 130px 130px 2.4fr auto', gap: 8, alignItems: 'center', opacity: b.enabled === false ? 0.5 : 1 }}>
          <input className="input" aria-label="Blocked term" value={b.term} onChange={(e) => blk(i, 'term', e.target.value)} placeholder="word or pattern" />
          <select className="input" aria-label="Match type" value={b.matchType} onChange={(e) => blk(i, 'matchType', e.target.value)}><option value="word">Whole word</option><option value="contains">Contains</option><option value="regex">Pattern</option></select>
          <select className="input" aria-label="Applies to" value={b.appliesTo || 'all'} onChange={(e) => blk(i, 'appliesTo', e.target.value)}><option value="all">Title & description</option><option value="title">Title only</option></select>
          <input className="input" aria-label="Message shown" value={b.reason || ''} onChange={(e) => blk(i, 'reason', e.target.value)} placeholder="Message shown to the person" />
          <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}><label style={{ fontSize: 12 }}><input type="checkbox" checked={b.enabled !== false} onChange={(e) => blk(i, 'enabled', e.target.checked)} /> on</label><button className="btn btn-ghost btn-sm" aria-label="Delete name" onClick={() => upd('blockedNames', p.blockedNames.filter((_: any, j: number) => j !== i))}><Trash2 size={13} /></button></div></div>)}
        <div style={{ borderTop: '1px solid var(--border)', paddingTop: 10, display: 'grid', gap: 6 }}>
          <span style={{ fontSize: 13 }}>Also refuse:</span>{NAMING.map(([k, t]) => <label key={k} style={{ display: 'flex', gap: 8, fontSize: 13 }}><input type="checkbox" checked={!!p.naming?.[k]} onChange={(e) => upd('naming', { ...p.naming, [k]: e.target.checked })} /> {t}</label>)}
          <label style={{ fontSize: 13 }}>Shortest allowed title <input className="input" type="number" min="1" max="40" style={{ width: 80, display: 'inline-block', marginLeft: 6 }} value={p.naming?.minTitleLength ?? 4} onChange={(e) => upd('naming', { ...p.naming, minTitleLength: +e.target.value })} /> characters</label></div>
      </div>
      <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
        <button className="btn btn-primary" onClick={save}>Save policy</button>
        <button className="btn btn-ghost" onClick={() => rescan(true)}>Preview effect on the register</button>
      </div>
      {scan && <div className="card" style={{ display: 'grid', gap: 8 }}>
        <strong>{scan.dryRun ? 'Preview' : 'Applied'}: {scan.scanned} assets checked — {scan.raised.length} would be raised, {scan.namingProblems.length} have unacceptable names</strong>
        {!!scan.raised.length && <div className="table-wrap"><table className="data-table"><tbody>{scan.raised.slice(0, 50).map((c: any) => <tr key={c.id} style={{ cursor: 'default' }}><td className="mono">{c.assetId}</td><td>{c.title}</td><td><Badge tone={CLASS_TONE[c.from]}>{c.from}</Badge> → <Badge tone={CLASS_TONE[c.to]}>{c.to}</Badge></td><td className="text-muted" style={{ fontSize: 12 }}>{c.reason}</td></tr>)}</tbody></table></div>}
        {!!scan.namingProblems.length && <div><div style={{ fontSize: 13 }}>Names to fix:</div><ul style={{ fontSize: 12.5, color: 'var(--muted)', paddingLeft: 18 }}>{scan.namingProblems.slice(0, 30).map((n: any) => <li key={n.id}><span className="mono">{n.assetId}</span> {n.title} — {n.problems.join(' ')}</li>)}</ul></div>}
        <div className="text-muted" style={{ fontSize: 12.5 }}>Labels are only ever raised automatically — never lowered. Save any edits first; the preview uses the saved policy.</div>
        {scan.dryRun && !!scan.raised.length && <div><button className="btn btn-primary" onClick={() => rescan(false)}>Apply to {scan.raised.length} asset(s)</button></div>}
      </div>}
    </div>
  );
}

function AssetDetail({ id, onClose, onChanged }: { id: string; onClose: () => void; onChanged: () => void }) {
  const { user } = useAuth();
  const { showError, showSuccess } = useToast();
  const { data: a, extra, loading, reload } = useApi<any>(`/assets/${id}`);
  const people = useApi<any[]>('/employees/directory/list');
  const [assignTo, setAssignTo] = useState('');
  const [disp, setDisp] = useState<{ reason: string; method: string; cert: string } | null>(null);
  const leader = ['super_admin', 'ceo', 'coo'].includes(user?.role || '');
  async function act(path: string, body: any, ok: string, method: 'post' | 'delete' = 'post') {
    try { await (api as any)[method](`/assets/${id}${path}`, method === 'post' ? body : undefined); showSuccess(ok); reload(); onChanged(); } catch (e) { showError(apiErrorMessage(e)); }
  }
  const integ = extra?.integrity;
  return (
    <Modal open onClose={onClose} title={a ? `${a.assetId} · ${a.title}` : 'Asset'} size="xwide">
      {loading && !a ? <Loading /> : a && (
        <div style={{ display: 'grid', gap: 16 }}>
          <div className="grid-2">
            <Kv rows={[['Category', label(a.category)], ['Classification', <><Badge tone={CLASS_TONE[a.classification]}>{a.classification}</Badge> <span className="text-muted" style={{ fontSize: 12 }}>{a.classificationSource === 'auto' ? 'labelled automatically' : a.classificationSource === 'override' ? 'policy override' : a.classificationSource === 'manual' ? 'set manually' : ''}</span>{a.classificationReason && <div className="text-muted" style={{ fontSize: 12 }}>{a.classificationReason}</div>}</>], ['CIA', `${a.confidentiality || '–'} / ${a.integrity || '–'} / ${a.availability || '–'}`], ['Owner', a.owner], ['Custodian', a.custodian], ['Location', a.location]]} />
            <Kv rows={[['Status', label(a.lifecycleStatus)], ['Assigned to', a.assignedToId?.name], ['Acquired', fdate(a.acquisitionDate)], ['End of life', fdate(a.endOfLifeDate)], ['Next review', fdate(a.nextReviewDate)], ['Licence / warranty', `${fdate(a.licenseExpiryDate)} / ${fdate(a.warrantyExpiryDate)}`], ...(a.conditionOnReturn?.condition ? [['Last returned', `${label(a.conditionOnReturn.condition)} · ${label(a.conditionOnReturn.medium || '')} · ${fdate(a.conditionOnReturn.at)}${a.conditionOnReturn.dataWipeVerified ? ' · data wipe verified' : ''}`] as [string, string]] : [])]} />
          </div>
          {a.lifecycleStatus === 'in_disposal' && a.disposal && (
            <div className="card" style={{ borderLeft: '3px solid var(--gold)', display: 'grid', gap: 8 }}>
              <strong>Disposal in progress</strong>
              <div style={{ fontSize: 13 }}>{a.disposal.method} — {a.disposal.reason}. {a.disposal.approvedAt ? `Approved by ${a.disposal.approvedByName}.` : 'Awaiting leadership approval.'}</div>
              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                {!a.disposal.approvedAt && leader && <><button className="btn btn-primary btn-sm" onClick={() => act('/disposal/approve', {}, 'Approved.')}>Approve</button><button className="btn btn-ghost btn-sm" onClick={() => act('/disposal/reject', { reason: 'Not approved' }, 'Rejected.')}>Reject</button></>}
                {a.disposal.approvedAt && <button className="btn btn-primary btn-sm" onClick={() => setDisp({ reason: '', method: '', cert: '' })}>Complete with wipe certificate</button>}
              </div>
            </div>
          )}
          {!['in_disposal', 'disposed'].includes(a.lifecycleStatus) && (
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
              <select className="input" style={{ maxWidth: 220 }} value={assignTo} onChange={(e) => setAssignTo(e.target.value)}><option value="">Select person…</option>{(people.data || []).map((p) => <option key={p._id} value={p._id}>{p.name}</option>)}</select>
              <button className="btn btn-ghost btn-sm" disabled={!assignTo} onClick={() => act('/assign', { userId: assignTo }, 'Assigned.')}><UserCheck size={13} /> Assign</button>
              {a.assignedToId && <button className="btn btn-ghost btn-sm" onClick={() => act('/assign', {}, 'Returned.')}>Return to pool</button>}
              <button className="btn btn-ghost btn-sm" onClick={() => act('/review', {}, 'Review recorded.')}><ShieldCheck size={13} /> Confirm reviewed</button>
              <button className="btn btn-ghost btn-sm" onClick={() => setDisp({ reason: '', method: '', cert: '' })}><Trash2 size={13} /> Request disposal</button>
            </div>
          )}
          <div>
            <strong style={{ fontSize: 13 }}>History {integ && (integ.valid ? <Badge tone="success">chain intact · {integ.events} events</Badge> : <Badge tone="danger">chain broken: {integ.reason}</Badge>)}</strong>
            <ul style={{ fontSize: 12.5, color: 'var(--muted)', paddingLeft: 18 }}>{[...(extra?.events || [])].reverse().map((e: any) => <li key={e._id}>{fdatetime(e.createdAt)} — {e.actor?.name}: {label(e.action)}{e.note ? ` (${e.note})` : ''}{(e.changes || []).map((c: any) => ` · ${c.field}: ${c.from || '—'} → ${c.to || '—'}`).join('')}</li>)}</ul>
          </div>
          <AssetRiskPanel assetId={id} />
          <RecordPanel entityType="asset" entityId={id} doc={a} kinds={['invoice', 'receipt', 'other']} />
        </div>
      )}
      {disp && a && (
        <Modal open onClose={() => setDisp(null)} title={a.lifecycleStatus === 'in_disposal' ? 'Complete disposal' : 'Request disposal'}
          footer={<><button className="btn btn-ghost" onClick={() => setDisp(null)}>Cancel</button><button className="btn btn-primary" onClick={async () => { if (a.lifecycleStatus === 'in_disposal') await act('/disposal/complete', { certificateRef: disp.cert }, 'Disposal completed.'); else await act('/disposal/request', { reason: disp.reason, method: disp.method }, 'Disposal requested.'); setDisp(null); }}>Submit</button></>}>
          {a.lifecycleStatus === 'in_disposal'
            ? <div className="field"><label>Wipe / destruction certificate reference *</label><input className="input" value={disp.cert} onChange={(e) => setDisp({ ...disp, cert: e.target.value })} /></div>
            : <><div className="field"><label>Reason *</label><input className="input" value={disp.reason} onChange={(e) => setDisp({ ...disp, reason: e.target.value })} /></div><div className="field"><label>Method * (secure wipe, shredding, recycling…)</label><input className="input" value={disp.method} onChange={(e) => setDisp({ ...disp, method: e.target.value })} /></div></>}
        </Modal>
      )}
    </Modal>
  );
}
