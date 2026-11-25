import { useState } from 'react';
import { Bot, Download, FileArchive, Play, Power, ShieldCheck } from 'lucide-react';
import { api, apiErrorMessage } from '@/lib/api';
import { useToast } from '@/context/ToastContext';
import { useApi } from '@/lib/useApi';
import { Empty, ErrorNote, Loading } from '@/components/ui/PageHead';
import { Badge } from '@/components/ui/Badge';
import { Modal } from '@/components/ui/Modal';
import { fdatetime, filenameFrom, saveBlob } from '@/lib/format';
import { downloadExport } from './RegisterPanel';

/* ------------------------------------------------------------------ automation */
export function AutomationPanel() {
  const { data, loading, error, reload } = useApi<any>('/isms/automation');
  const { showError, showSuccess } = useToast();
  const [busy, setBusy] = useState(''); const [off, setOff] = useState<any>(null); const [reason, setReason] = useState(''); const [open, setOpen] = useState('');
  async function run(k: string) { setBusy(k); try { const r = await api.post(`/isms/automation/${k}/run`); showSuccess(`Done – ${r.data.data.summary}`); reload(); setOpen(k); } catch (e) { showError(apiErrorMessage(e)); } finally { setBusy(''); } }
  async function toggle(rule: any, enabled: boolean, why?: string) {
    try { await api.put(`/isms/automation/${rule.key}`, { enabled, reason: why }); setOff(null); setReason(''); reload(); } catch (e) { showError(apiErrorMessage(e)); }
  }
  if (loading && !data) return <Loading />;
  return (
    <div>
      <ErrorNote message={error} />
      <p className="text-muted" style={{ fontSize: 13.5, marginTop: 0 }}>These rules run on their own (times are Africa/Lagos). Every run is kept as proof that the cadence in the policy was followed. Switching one off needs a reason, which is logged.</p>
      <div style={{ display: 'grid', gap: 10 }}>
        {(data?.rules || []).map((r: any) => (
          <div key={r.key} className="card" style={{ display: 'grid', gap: 6, borderLeft: `3px solid ${!r.enabled ? 'var(--text-muted)' : r.lastRun && !r.lastRun.ok ? 'var(--danger)' : 'var(--accent)'}` }}>
            <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', alignItems: 'flex-start' }}>
              <Bot size={18} style={{ color: 'var(--accent)', marginTop: 2 }} />
              <div style={{ flex: 1, minWidth: 240 }}>
                <div style={{ fontWeight: 600 }}>{r.title} {!r.enabled && <Badge tone="danger">Off</Badge>}</div>
                <div className="text-muted" style={{ fontSize: 12.5 }}>{r.schedule} · ISO {r.clause} · {r.policy}</div>
                <div style={{ fontSize: 13.5, marginTop: 4 }}>{r.description}</div>
              </div>
              <div style={{ textAlign: 'right', minWidth: 190, fontSize: 13 }}>
                {r.lastRun ? <><Badge tone={r.lastRun.ok ? 'success' : 'danger'}>{r.lastRun.ok ? 'Last run OK' : 'Last run failed'}</Badge><div className="text-muted" style={{ fontSize: 12, marginTop: 4 }}>{fdatetime(r.lastRun.at)} · {r.lastRun.trigger}<br />{r.lastRun.summary}</div></> : <span className="text-muted">Not run yet</span>}
              </div>
            </div>
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              <button className="btn btn-ghost" disabled={busy === r.key} onClick={() => run(r.key)}><Play size={14} /> {busy === r.key ? 'Running…' : 'Run now'}</button>
              {r.enabled ? <button className="btn btn-ghost" onClick={() => setOff(r)}><Power size={14} /> Switch off…</button> : <button className="btn btn-ghost" onClick={() => toggle(r, true)}><Power size={14} /> Switch on</button>}
              {r.lastRun?.details?.length > 0 && <button className="btn btn-ghost" onClick={() => setOpen(open === r.key ? '' : r.key)}>{open === r.key ? 'Hide' : 'Show'} details</button>}
            </div>
            {open === r.key && r.lastRun?.details && <div className="text-muted" style={{ fontSize: 12.5, display: 'grid', gap: 2 }}>{r.lastRun.details.map((d: string, i: number) => <div key={i}>• {d}</div>)}{r.lastRun.error && <div style={{ color: 'var(--danger)' }}>{r.lastRun.error}</div>}</div>}
          </div>
        ))}
      </div>
      <h4 style={{ margin: '22px 0 8px' }}>Also automated elsewhere in the app</h4>
      <div style={{ display: 'grid', gap: 6 }}>
        {(data?.builtElsewhere || []).map((b: any) => <div key={b.title} className="card" style={{ fontSize: 13.5 }}><b>{b.title}</b> <span className="text-muted">– {b.note}</span> <a href={b.where} style={{ marginLeft: 6 }}>Open</a></div>)}
      </div>
      <Modal open={!!off} onClose={() => setOff(null)} title="Switch this rule off?" footer={<><button className="btn btn-ghost" onClick={() => setOff(null)}>Keep it on</button><button className="btn btn-primary" onClick={() => toggle(off, false, reason)}>Switch off</button></>}>
        <p style={{ marginTop: 0 }}><b>{off?.title}</b> will stop running. An auditor can see who switched it off and why.</p>
        <div className="field"><label>Reason *</label><input className="input" value={reason} onChange={(e) => setReason(e.target.value)} /></div>
      </Modal>
    </div>
  );
}

/* ------------------------------------------------------------------ packs */
export function PacksPanel({ generators }: { generators: any[] }) {
  const { data, loading, error, reload } = useApi<any[]>('/isms/packs');
  const { showError, showSuccess } = useToast(); const [busy, setBusy] = useState('');
  async function make() { setBusy('pack'); try { const r = await api.post('/isms/packs', {}); showSuccess(`Pack ready (${r.data.data.registers.length} registers).`); reload(); } catch (e) { showError(apiErrorMessage(e)); } finally { setBusy(''); } }
  async function dl(p: any) { try { const r = await api.get(`/isms/packs/${p._id}/download`, { responseType: 'blob' }); saveBlob(r.data, filenameFrom(r.headers['content-disposition'], p.fileName)); } catch (e) { showError(apiErrorMessage(e)); } }
  async function one(k: string) { setBusy(k); try { await downloadExport(k); } catch (e) { showError(apiErrorMessage(e)); } finally { setBusy(''); } }
  const groups = Array.from(new Set(generators.map((g) => g.group)));
  return (
    <div>
      <div className="card" style={{ display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap', marginBottom: 14 }}>
        <FileArchive size={22} style={{ color: 'var(--accent)' }} />
        <div style={{ flex: 1, minWidth: 240 }}><b>Evidence pack</b><div className="text-muted" style={{ fontSize: 13 }}>Every register as an Excel file with the company headings, in one zip with a SHA-256 fingerprint. One is also made automatically on the 1st of each month.</div></div>
        <button className="btn btn-primary" disabled={busy === 'pack'} onClick={make}>{busy === 'pack' ? 'Building…' : 'Generate now'}</button>
      </div>
      <ErrorNote message={error} />
      {loading && !data ? <Loading /> : !data?.length ? <Empty title="No packs yet" hint="Generate one now, or wait for the monthly pack." /> : (
        <div className="table-wrap"><table className="data-table"><thead><tr><th>Created</th><th>Type</th><th>By</th><th>Registers</th><th>Size</th><th>SHA-256</th><th /></tr></thead><tbody>
          {data.map((p) => <tr key={p._id}><td>{fdatetime(p.createdAt)}</td><td>{p.trigger === 'schedule' ? 'Monthly (automatic)' : 'Manual'}</td><td>{p.byName}</td><td>{p.registers?.length}</td><td>{Math.round((p.size || 0) / 1024)} KB</td><td style={{ fontFamily: 'monospace', fontSize: 11.5 }}>{String(p.sha256).slice(0, 16)}…</td><td><button className="btn btn-ghost" onClick={() => dl(p)}><Download size={14} /> Download</button></td></tr>)}
        </tbody></table></div>
      )}
      <h4 style={{ margin: '22px 0 8px' }}>Single registers</h4>
      {groups.map((gr) => (
        <div key={gr} style={{ marginBottom: 12 }}>
          <div className="text-muted" style={{ fontSize: 12, textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 6 }}>{gr}</div>
          <div className="chips">{generators.filter((g) => g.group === gr).map((g) => <button key={g.key} className="chip" disabled={busy === g.key} onClick={() => one(g.key)} title={`${g.docId} · ${g.source === 'app' ? 'built from live app data' : 'register records'}`}><Download size={12} /> {g.title}</button>)}</div>
        </div>
      ))}
    </div>
  );
}

/* ------------------------------------------------------------------ coverage */
const LEVELS: Record<string, { label: string; tone: any; hint: string }> = {
  enforced: { label: 'Enforced', tone: 'success', hint: 'The app blocks or forces what the document requires' },
  automated: { label: 'Automated', tone: 'accent', hint: 'The app schedules, reminds, creates or measures by itself' },
  recorded: { label: 'Recorded', tone: 'gold', hint: 'The app holds the register/form; people do the work' },
  manual: { label: 'Manual', tone: 'neutral', hint: 'A technical or physical control the app cannot perform' },
};
export function CoveragePanel() {
  const { data, loading, error } = useApi<any>('/isms/coverage');
  const [lv, setLv] = useState('');
  if (loading && !data) return <Loading />;
  const items = (data?.items || []).filter((i: any) => !lv || i.level === lv);
  return (
    <div>
      <ErrorNote message={error} />
      <p className="text-muted" style={{ fontSize: 13.5, marginTop: 0 }}>One honest line for each of the {data?.totals.documents} documents in the ISO-27001 client folder: what the software really does for it.</p>
      <div className="chips" style={{ marginBottom: 12 }}>
        <button className={`chip ${!lv ? 'active' : ''}`} onClick={() => setLv('')}>All ({data?.totals.documents})</button>
        {Object.entries(LEVELS).map(([k, v]) => <button key={k} className={`chip ${lv === k ? 'active' : ''}`} onClick={() => setLv(k)} title={v.hint}>{v.label} ({data?.totals[k]})</button>)}
      </div>
      <div className="table-wrap"><table className="data-table"><thead><tr><th>Clause</th><th>Document</th><th>Level</th><th>What the app does</th><th /></tr></thead><tbody>
        {items.map((c: any) => <tr key={c.document}><td>{c.clause}</td><td style={{ fontWeight: 500 }}>{c.document}</td><td><Badge tone={LEVELS[c.level].tone}>{LEVELS[c.level].label}</Badge></td><td style={{ maxWidth: 520 }}>{c.how}</td><td>{c.path && <a href={c.path}>Open</a>}</td></tr>)}
      </tbody></table></div>
    </div>
  );
}

/* ------------------------------------------------------------------ management review inputs */
export function ReviewPanel() {
  const { data: d, loading, error } = useApi<any>('/isms/review-inputs');
  if (loading && !d) return <Loading />;
  if (!d) return <ErrorNote message={error} />;
  const Card = ({ title, clause, rows }: { title: string; clause: string; rows: Array<[string, any, boolean?]> }) => (
    <div className="card"><div style={{ fontWeight: 600 }}>{title}</div><div className="text-muted" style={{ fontSize: 12, marginBottom: 8 }}>Clause 9.3.2 {clause}</div>
      {rows.map(([k, v, bad]) => <div key={k} style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13.5, padding: '2px 0' }}><span>{k}</span><b style={bad && Number(v) > 0 ? { color: 'var(--danger)' } : undefined}>{v}</b></div>)}</div>
  );
  return (
    <div>
      <p className="text-muted" style={{ fontSize: 13.5, marginTop: 0 }}>Live figures for the management review (clause 9.3). Record the decisions as actions in the “Management Review Actions” register.</p>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(260px,1fr))', gap: 12 }}>
        <Card title="Status of previous actions" clause="(a)" rows={[['Open', d.previousActions.open], ['Overdue', d.previousActions.overdue, true]]} />
        <Card title="Changes in context" clause="(b)" rows={[['Open context items', d.contextChanges.open]]} />
        <Card title="Audit results" clause="(c)" rows={[['Planned', d.audits.planned], ['Reported / closed', d.audits.reported], ['Overdue', d.audits.overdue, true]]} />
        <Card title="Nonconformities & corrective actions" clause="(c)" rows={[['Open', d.nonconformities.open], ['Major', d.nonconformities.major, true], ['Overdue', d.nonconformities.overdue, true], ['Closed in 12 months', d.nonconformities.closedLast12m]]} />
        <Card title="Monitoring & measurement" clause="(c)" rows={[['Metrics measured', d.metrics.measured], ['Target met', d.metrics.met], ['Target missed', d.metrics.missed, true]]} />
        <Card title="Risks & opportunities" clause="(e)" rows={[['Open risks', d.risks.open], ['Major after treatment', d.risks.major, true], ['Reviews overdue', d.risks.reviewsOverdue, true], ['Open opportunities', d.risks.opportunities]]} />
        <Card title="Incidents (12 months)" clause="(c)" rows={[['Reported', d.incidents.last12m], ['High / critical', d.incidents.highOrCritical, true], ['Still open', d.incidents.stillOpen, true]]} />
        <Card title="Changes" clause="(b)" rows={[['Open', d.changes.open], ['Waiting for review', d.changes.awaitingReview, true]]} />
        <Card title="Suppliers" clause="(d)" rows={[['Security reviews on file', d.suppliers.activeReviews], ['Reviews overdue', d.suppliers.overdue, true]]} />
        <Card title="Legal & contractual" clause="(b)" rows={[['Non-compliant / expired', d.legal.nonCompliant, true], ['Expiring in 90 days', d.legal.expiring90]]} />
        <Card title="Training" clause="(c)" rows={[['Planned', d.training.planned], ['Overdue', d.training.overdue, true]]} />
        <Card title="Improvement" clause="(f)" rows={[['Open observations & OFIs', d.observationsAndOfi.open]]} />
      </div>
      <div style={{ marginTop: 14 }}><ShieldCheck size={14} style={{ verticalAlign: -2 }} /> <span className="text-muted" style={{ fontSize: 12.5 }}>Interested-party feedback (clause 9.3.2 d) comes from the Observation / OFI logs — enter customer feedback there.</span></div>
    </div>
  );
}
