import { useEffect, useState } from 'react';
import { ScrollText, ShieldCheck, Download, Stamp } from 'lucide-react';
import { api, apiErrorMessage } from '@/lib/api';
import { useToast } from '@/context/ToastContext';
import { useApi } from '@/lib/useApi';
import { PageHead, Tabs, Loading, ErrorNote, Empty } from '@/components/ui/PageHead';
import { Badge } from '@/components/ui/Badge';
import { Pagination } from '@/components/ui/Pagination';
import { fdatetime, label, saveBlob, filenameFrom } from '@/lib/format';

const SEV_TONE: Record<string, any> = { info: 'neutral', low: 'neutral', medium: 'gold', high: 'danger', critical: 'danger' };

export function AuditLog() {
  const { showError, showSuccess } = useToast();
  const [tab, setTab] = useState<'log' | 'integrity'>('log');
  const [page, setPage] = useState(1);
  const [f, setF] = useState<Record<string, string>>({});
  const stats = useApi<any>('/audit/stats', { days: 30 });
  const log = useApi<any[]>('/audit', { page, limit: 50, ...Object.fromEntries(Object.entries(f).filter(([, v]) => v)) });
  const seals = useApi<any[]>(tab === 'integrity' ? '/audit/seals' : null);
  const [verify, setVerify] = useState<any>(null);
  useEffect(() => setPage(1), [f]);

  async function exportCsv() {
    try { const r = await api.get('/audit/export.csv', { params: f, responseType: 'blob' }); saveBlob(r.data, filenameFrom(r.headers['content-disposition'], 'audit-log.csv')); } catch (e) { showError(apiErrorMessage(e)); }
  }
  async function runVerify() { try { const r = await api.get('/audit/seals/verify'); setVerify(r.data.data); } catch (e) { showError(apiErrorMessage(e)); } }
  async function seal() { try { const r = await api.post('/audit/seals/run'); showSuccess(`${r.data.data.sealed} day(s) sealed.`); seals.reload(); } catch (e) { showError(apiErrorMessage(e)); } }
  const s = stats.data;
  const sev = (k: string) => s?.bySeverity?.find((x: any) => x._id === k)?.n || 0;

  return (
    <div className="page-enter">
      <PageHead title="Audit log" subtitle="Tamper-evident record of who did what (ISO 27001 A.8.15). Entries are sealed daily with a hash chain."
        actions={<button className="btn btn-ghost" onClick={exportCsv}><Download size={14} /> Export CSV</button>} />
      {s && <div className="stat-grid" style={{ marginBottom: 16 }}>
        <div className="stat-card"><div className="stat-label"><span>Events (30d)</span></div><div className="stat-value">{s.total}</div></div>
        <div className="stat-card"><div className="stat-label"><span>High / critical</span></div><div className="stat-value">{sev('high') + sev('critical')}</div></div>
        <div className="stat-card"><div className="stat-label"><span>Failures</span></div><div className="stat-value">{s.failed}</div></div>
        <div className="stat-card"><div className="stat-label"><span>Top failed-login IP</span></div><div className="stat-value" style={{ fontSize: 18 }}>{s.failedLoginSources?.[0]?._id || '—'}</div><div className="stat-sub">{s.failedLoginSources?.[0]?.n || 0} attempts</div></div></div>}
      <Tabs tabs={[{ key: 'log', label: 'Events' }, { key: 'integrity', label: 'Integrity seals' }]} value={tab} onChange={(k) => setTab(k as any)} />

      {tab === 'log' && (
        <>
          <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', marginBottom: 14 }}>
            <input className="input" style={{ maxWidth: 240 }} placeholder="Search action, summary, person" value={f.q || ''} onChange={(e) => setF({ ...f, q: e.target.value })} />
            <select className="input" style={{ maxWidth: 150 }} value={f.severity || ''} onChange={(e) => setF({ ...f, severity: e.target.value })}><option value="">Any severity</option>{['info', 'low', 'medium', 'high', 'critical'].map((x) => <option key={x}>{x}</option>)}</select>
            <select className="input" style={{ maxWidth: 140 }} value={f.status || ''} onChange={(e) => setF({ ...f, status: e.target.value })}><option value="">Any outcome</option><option value="success">Success</option><option value="failed">Failed</option></select>
            <input className="input" style={{ maxWidth: 160 }} type="date" value={f.from || ''} onChange={(e) => setF({ ...f, from: e.target.value })} />
            <input className="input" style={{ maxWidth: 160 }} type="date" value={f.to || ''} onChange={(e) => setF({ ...f, to: e.target.value })} />
          </div>
          <ErrorNote message={log.error} />
          {log.loading && !log.data ? <Loading /> : !log.data?.length ? <Empty icon={<ScrollText />} title="No events match" /> : (
            <div className="table-wrap"><table className="data-table" style={{ cursor: 'default' }}><thead><tr><th>When</th><th>Who</th><th>Action</th><th>Summary</th><th>Severity</th><th>IP</th></tr></thead>
              <tbody>{log.data.map((e) => <tr key={e._id} style={{ cursor: 'default' }}><td style={{ whiteSpace: 'nowrap' }}>{fdatetime(e.createdAt)}</td><td>{e.actorName || 'system'}</td><td className="mono" style={{ fontSize: 12 }}>{e.action}</td><td style={{ maxWidth: 380 }}>{e.summary}</td>
                <td><Badge tone={SEV_TONE[e.severity]}>{label(e.severity)}</Badge>{e.status === 'failed' && <Badge tone="danger">failed</Badge>}</td><td className="mono" style={{ fontSize: 12 }}>{e.ip}</td></tr>)}</tbody></table></div>
          )}
          {log.extra?.pagination && <Pagination page={log.extra.pagination.page} pages={log.extra.pagination.pages} total={log.extra.pagination.total} onChange={setPage} />}
        </>
      )}

      {tab === 'integrity' && (
        <>
          <div style={{ display: 'flex', gap: 10, marginBottom: 14 }}>
            <button className="btn btn-primary" onClick={runVerify}><ShieldCheck size={15} /> Verify chain now</button>
            <button className="btn btn-ghost" onClick={seal}><Stamp size={15} /> Seal pending days</button>
          </div>
          {verify && (verify.valid
            ? <div className="banner ok"><ShieldCheck size={16} /> Audit trail intact — {verify.sealedDays} sealed day(s) verified, no tampering detected.</div>
            : <div className="banner warn"><strong>Tampering detected.</strong> {(verify.problems || []).join('; ') || 'A sealed day no longer matches its recorded digest.'}</div>)}
          <ErrorNote message={seals.error} />
          {seals.loading ? <Loading /> : !seals.data?.length ? <Empty icon={<Stamp />} title="No seals yet" hint="Days are sealed automatically at the end of each day." /> : (
            <div className="table-wrap"><table className="data-table" style={{ cursor: 'default' }}><thead><tr><th>Day</th><th>Events</th><th>Digest</th><th>Chain hash</th></tr></thead>
              <tbody>{seals.data.map((x) => <tr key={x.day} style={{ cursor: 'default' }}><td>{x.day}</td><td>{x.count}</td><td className="mono" style={{ fontSize: 11.5 }}>{x.digest.slice(0, 20)}…</td><td className="mono" style={{ fontSize: 11.5 }}>{x.chainHash.slice(0, 20)}…</td></tr>)}</tbody></table></div>
          )}
        </>
      )}
    </div>
  );
}
