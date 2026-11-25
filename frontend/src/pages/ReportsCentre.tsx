import { useMemo, useState } from 'react';
import { FileText, Download, Play, CalendarClock, Trash2, Send, BarChart3, ShieldCheck } from 'lucide-react';
import { QuarterFilter } from '@/components/work/QuarterFilter';
import { api, apiErrorMessage } from '@/lib/api';
import { useAuth } from '@/context/AuthContext';
import { useToast } from '@/context/ToastContext';
import { useConfirm } from '@/context/ConfirmContext';
import { useApi } from '@/lib/useApi';
import { PageHead, Tabs, Empty, Loading, ErrorNote } from '@/components/ui/PageHead';
import { Badge } from '@/components/ui/Badge';
import { Modal } from '@/components/ui/Modal';
import { fdatetime, label, saveBlob, filenameFrom } from '@/lib/format';

interface Def { key: string; title: string; category: string; description: string; standard?: string; params: string[]; module: string | string[] }
interface Result { key: string; title: string; generatedAt: string; standard?: string; columns: Array<{ key: string; label: string }>; rows: Array<Record<string, any>>; summary?: Array<[string, string | number]>; note?: string }

const PARAM_LABEL: Record<string, string> = { from: 'From', to: 'To', days: 'Last N days', year: 'Year', month: 'Month', quarter: 'Quarter' };
const isBad = (v: any) => typeof v === 'string' && /^(NOT |Overdue|Expired|Failed|FAIL|No\b)/i.test(v);

export function ReportsCentre() {
  const { user } = useAuth();
  const { showError, showSuccess } = useToast();
  const confirm = useConfirm();
  const catalog = useApi<Def[]>('/reporting/catalog');
  const canSchedule = !!user?.modules?.includes('reports') || user?.role === 'super_admin';
  const [tab, setTab] = useState<'catalog' | 'schedules'>('catalog');
  const [cat, setCat] = useState('All');
  const [q, setQ] = useState('');
  const [sel, setSel] = useState<Def | null>(null);
  const [params, setParams] = useState<Record<string, string>>({});
  const [result, setResult] = useState<Result | null>(null);
  const [running, setRunning] = useState(false);
  const [schedOpen, setSchedOpen] = useState(false);
  const schedules = useApi<any[]>(canSchedule ? '/reporting/schedules' : null);

  const categories = useMemo(() => ['All', ...Array.from(new Set((catalog.data || []).map((r) => r.category)))], [catalog.data]);
  const list = (catalog.data || []).filter((r) => (cat === 'All' || r.category === cat) && (!q || `${r.title} ${r.description} ${r.standard || ''}`.toLowerCase().includes(q.toLowerCase())));

  const qs = () => Object.fromEntries(Object.entries(params).filter(([k, v]) => v !== '' && sel?.params.includes(k)));

  async function run(def: Def) {
    setSel(def); setRunning(true); setResult(null);
    try {
      const res = await api.get(`/reporting/run/${def.key}`, { params: qs() });
      setResult(res.data.data);
    } catch (err) { showError(apiErrorMessage(err)); } finally { setRunning(false); }
  }
  async function download(format: 'csv' | 'pdf') {
    if (!sel) return;
    try {
      const res = await api.get(`/reporting/run/${sel.key}/export`, { params: { ...qs(), format }, responseType: 'blob' });
      saveBlob(res.data, filenameFrom(res.headers['content-disposition'], `${sel.key}.${format}`));
    } catch (err) { showError(apiErrorMessage(err)); }
  }

  return (
    <div className="page-enter">
      <PageHead title="Reports Centre" subtitle="Every report you are entitled to see, built from live data — run it, export it, or have it delivered on a schedule." />
      <Tabs tabs={[{ key: 'catalog', label: 'Reports', count: catalog.data?.length }, ...(canSchedule ? [{ key: 'schedules', label: 'Scheduled deliveries', count: schedules.data?.length }] : [])]} value={tab} onChange={(k) => setTab(k as any)} />

      {tab === 'catalog' && (
        <>
          <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', marginBottom: 14 }}>
            <input className="input" style={{ maxWidth: 280 }} placeholder="Search reports or standards (e.g. A.8.5)" value={q} onChange={(e) => setQ(e.target.value)} />
            <div className="chips">{categories.map((c) => <button key={c} className={`chip ${cat === c ? 'active' : ''}`} onClick={() => setCat(c)}>{c}</button>)}</div>
          </div>
          <ErrorNote message={catalog.error} />
          {catalog.loading ? <Loading /> : !list.length ? <Empty icon={<BarChart3 />} title="No reports match" /> : (
            <div className="grid-3">
              {list.map((r) => (
                <div key={r.key} className="card" style={{ display: 'grid', gap: 8, alignContent: 'start' }}>
                  <div className="flex-between"><Badge tone="accent">{r.category}</Badge>{r.standard && <span className="text-muted" style={{ fontSize: 11.5 }}><ShieldCheck size={11} /> {r.standard}</span>}</div>
                  <strong style={{ fontSize: 15 }}>{r.title}</strong>
                  <p className="text-muted" style={{ fontSize: 13, margin: 0 }}>{r.description}</p>
                  <div><button className="btn btn-primary btn-sm" onClick={() => { setParams({}); setResult(null); setSel(r); if (!r.params.length) run(r); }}><Play size={13} /> Open</button></div>
                </div>
              ))}
            </div>
          )}
        </>
      )}

      {tab === 'schedules' && canSchedule && (
        <>
          <div style={{ marginBottom: 12 }}><button className="btn btn-primary" onClick={() => setSchedOpen(true)}><CalendarClock size={15} /> Schedule a report</button></div>
          <ErrorNote message={schedules.error} />
          {schedules.loading ? <Loading /> : !schedules.data?.length ? <Empty icon={<CalendarClock />} title="No scheduled reports" hint="Have key reports e-mailed to the right people every week, month or quarter." /> : (
            <div className="table-wrap"><table className="data-table" style={{ cursor: 'default' }}>
              <thead><tr><th>Name</th><th>Frequency</th><th>Format</th><th>Recipients</th><th>Next run</th><th>Last</th><th>Active</th><th /></tr></thead>
              <tbody>{schedules.data!.map((s: any) => (
                <tr key={s._id} style={{ cursor: 'default' }}>
                  <td><strong>{s.name}</strong><div className="text-muted" style={{ fontSize: 12 }}>{s.reportKey}</div></td>
                  <td>{label(s.frequency)}</td><td>{s.format.toUpperCase()}</td>
                  <td style={{ fontSize: 12.5 }}>{(s.recipientIds || []).map((r: any) => r.name).join(', ')}{s.extraEmails?.length ? `, ${s.extraEmails.join(', ')}` : ''}</td>
                  <td>{fdatetime(s.nextRunAt)}</td><td>{s.lastRunAt ? `${fdatetime(s.lastRunAt)} · ${s.lastStatus || ''}` : '—'}</td>
                  <td><input type="checkbox" checked={s.active} onChange={async (e) => { try { await api.patch(`/reporting/schedules/${s._id}`, { active: e.target.checked }); schedules.reload(); } catch (err) { showError(apiErrorMessage(err)); } }} /></td>
                  <td style={{ whiteSpace: 'nowrap' }}>
                    <button className="icon-btn" title="Send now" onClick={async () => { try { await api.post(`/reporting/schedules/${s._id}/run-now`); showSuccess('Report sent.'); schedules.reload(); } catch (err) { showError(apiErrorMessage(err)); } }}><Send /></button>
                    <button className="icon-btn" title="Delete" onClick={async () => { if (await confirm({ title: 'Delete schedule?', message: s.name, danger: true, confirmLabel: 'Delete' })) { try { await api.delete(`/reporting/schedules/${s._id}`); schedules.reload(); } catch (err) { showError(apiErrorMessage(err)); } } }}><Trash2 /></button>
                  </td>
                </tr>))}</tbody></table></div>
          )}
        </>
      )}

      {sel && (
        <Modal open onClose={() => { setSel(null); setResult(null); }} title={sel.title} size="xwide"
          footer={<>
            {canSchedule && <button className="btn btn-ghost" onClick={() => setSchedOpen(true)}><CalendarClock size={14} /> Schedule</button>}
            <button className="btn btn-ghost" disabled={!result} onClick={() => download('csv')}><Download size={14} /> CSV</button>
            <button className="btn btn-primary" disabled={!result} onClick={() => download('pdf')}><FileText size={14} /> PDF</button>
          </>}>
          <p className="text-muted" style={{ marginTop: 0, fontSize: 13 }}>{sel.description}{sel.standard ? ` · ${sel.standard}` : ''}</p>
          <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'end', marginBottom: 14 }}>
            {sel.params.map((p) => (
              <div className="field" key={p} style={{ margin: 0 }}>
                <label>{PARAM_LABEL[p]}</label>
                {p === 'quarter' ? <QuarterFilter value={params[p] || ''} onChange={(v) => setParams({ ...params, [p]: v })} /> : <input className="input" style={{ width: p === 'from' || p === 'to' ? 160 : 110 }} type={p === 'from' || p === 'to' ? 'date' : 'number'} value={params[p] || ''} onChange={(e) => setParams({ ...params, [p]: e.target.value })} />}
              </div>
            ))}
            <button className="btn btn-primary" onClick={() => run(sel)} disabled={running}><Play size={14} /> {running ? 'Running…' : result ? 'Refresh' : 'Run report'}</button>
          </div>
          {running && <Loading />}
          {result && (
            <>
              {result.summary && <div className="stat-grid" style={{ marginBottom: 14 }}>{result.summary.map(([k, v]) => <div className="stat-card" key={k}><div className="stat-label"><span>{k}</span></div><div className="stat-value" style={{ fontSize: 22 }}>{String(v)}</div></div>)}</div>}
              {result.note && <div className="banner">{result.note}</div>}
              {!result.rows.length ? <Empty title="Nothing to report for this period" hint="That is good news for exception reports." /> : (
                <div className="table-wrap" style={{ maxHeight: '48vh', overflow: 'auto' }}>
                  <table className="data-table" style={{ cursor: 'default' }}>
                    <thead><tr>{result.columns.map((c) => <th key={c.key}>{c.label}</th>)}</tr></thead>
                    <tbody>{result.rows.slice(0, 500).map((row, i) => <tr key={i} style={{ cursor: 'default' }}>{result.columns.map((c) => <td key={c.key} style={isBad(row[c.key]) ? { color: 'var(--danger)', fontWeight: 600 } : undefined}>{row[c.key] === undefined || row[c.key] === null || row[c.key] === '' ? '—' : String(row[c.key])}</td>)}</tr>)}</tbody>
                  </table>
                </div>
              )}
              <div className="text-muted" style={{ fontSize: 12, marginTop: 8 }}>{result.rows.length} row(s){result.rows.length > 500 ? ' — first 500 shown, export for all' : ''} · generated {fdatetime(result.generatedAt)}</div>
            </>
          )}
        </Modal>
      )}

      {schedOpen && <ScheduleModal defs={catalog.data || []} preset={sel} onClose={() => setSchedOpen(false)} onSaved={() => { setSchedOpen(false); schedules.reload(); setTab('schedules'); }} />}
    </div>
  );
}

function ScheduleModal({ defs, preset, onClose, onSaved }: { defs: Def[]; preset: Def | null; onClose: () => void; onSaved: () => void }) {
  const { showError, showSuccess } = useToast();
  const { user } = useAuth();
  const dir = useApi<any[]>('/employees/directory/list');
  const [f, setF] = useState<any>({ reportKey: preset?.key || defs[0]?.key || '', frequency: 'monthly', format: 'pdf', recipientIds: user ? [user.id] : [], extra: '' });
  const external = user?.role === 'super_admin' || user?.role === 'ceo';
  async function save() {
    try {
      await api.post('/reporting/schedules', { reportKey: f.reportKey, name: f.name || undefined, frequency: f.frequency, format: f.format, recipientIds: f.recipientIds, extraEmails: f.extra.split(/[\s,;]+/).filter(Boolean) });
      showSuccess('Schedule created.'); onSaved();
    } catch (err) { showError(apiErrorMessage(err)); }
  }
  const toggle = (id: string) => setF({ ...f, recipientIds: f.recipientIds.includes(id) ? f.recipientIds.filter((x: string) => x !== id) : [...f.recipientIds, id] });
  return (
    <Modal open onClose={onClose} title="Schedule a report" footer={<><button className="btn btn-ghost" onClick={onClose}>Cancel</button><button className="btn btn-primary" onClick={save}>Create schedule</button></>}>
      <div className="field"><label>Report</label><select className="input" value={f.reportKey} onChange={(e) => setF({ ...f, reportKey: e.target.value })}>{defs.map((d) => <option key={d.key} value={d.key}>{d.category} — {d.title}</option>)}</select></div>
      <div className="field"><label>Name (optional)</label><input className="input" value={f.name || ''} onChange={(e) => setF({ ...f, name: e.target.value })} /></div>
      <div className="grid-2">
        <div className="field"><label>Frequency</label><select className="input" value={f.frequency} onChange={(e) => setF({ ...f, frequency: e.target.value })}><option value="weekly">Weekly</option><option value="monthly">Monthly</option><option value="quarterly">Quarterly</option></select></div>
        <div className="field"><label>Format</label><select className="input" value={f.format} onChange={(e) => setF({ ...f, format: e.target.value })}><option value="pdf">PDF</option><option value="csv">CSV</option></select></div>
      </div>
      <div className="field"><label>Recipients (must have access to the report's module)</label>
        <div style={{ maxHeight: 160, overflow: 'auto', border: '1px solid var(--line)', borderRadius: 10, padding: 8 }}>
          {(dir.data || []).map((u) => <label key={u._id} style={{ display: 'flex', gap: 8, fontSize: 13, padding: '3px 0' }}><input type="checkbox" checked={f.recipientIds.includes(u._id)} onChange={() => toggle(u._id)} /> {u.name} <span className="text-muted">{u.jobTitle}</span></label>)}
        </div></div>
      {external && <div className="field"><label>External e-mail addresses (CEO / admin only)</label><input className="input" placeholder="auditor@firm.com, dpo@example.com" value={f.extra} onChange={(e) => setF({ ...f, extra: e.target.value })} /></div>}
    </Modal>
  );
}
