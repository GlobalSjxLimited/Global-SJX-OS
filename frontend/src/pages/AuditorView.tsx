import { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import { Download, ShieldCheck } from 'lucide-react';
import { api } from '@/lib/api';
import { fdate } from '@/lib/format';

const api0 = (token: string, p: string) => api.get(`/public/auditor/${token}${p}`).then((r) => r.data.data);

/** Public, read-only auditor view. The link token is the key; nothing here can change data. */
export function AuditorView() {
  const { token = '' } = useParams();
  const [ov, setOv] = useState<any>(null); const [bad, setBad] = useState(false);
  const [tab, setTab] = useState('register:'); const [reg, setReg] = useState<any>(null); const [ev, setEv] = useState<any[] | null>(null); const [q, setQ] = useState('');
  useEffect(() => { api0(token, '').then((d) => { setOv(d); setTab(`register:${(d.registers.find((r: any) => r.count > 0) || d.registers[0])?.key || ''}`); }).catch(() => setBad(true)); }, [token]);
  useEffect(() => {
    if (tab.startsWith('register:') && tab.length > 9) { setReg(null); api0(token, `/register/${tab.slice(9)}`).then(setReg).catch(() => setReg({ error: true })); }
    if (tab === 'evidence' && !ev) api0(token, '/evidence').then(setEv).catch(() => setEv([]));
  }, [tab, token]); // eslint-disable-line react-hooks/exhaustive-deps
  async function download(ref: string, name: string) {
    const r = await api.get(`/public/auditor/${token}/evidence/${ref}/file`, { responseType: 'blob' });
    const u = URL.createObjectURL(r.data); const a = document.createElement('a'); a.href = u; a.download = name || ref; a.click(); URL.revokeObjectURL(u);
  }
  if (bad) return <div style={{ minHeight: '100vh', display: 'grid', placeItems: 'center', background: 'var(--bg)', color: 'var(--text)' }}><div className="card" style={{ maxWidth: 480 }}><h1 style={{ fontSize: 20, marginTop: 0 }}>This link is not valid</h1><p className="text-muted">It may have expired or been withdrawn. Please ask Global SJX for a new one.</p></div></div>;
  if (!ov) return <div style={{ padding: 40, color: 'var(--text)' }}>Loading…</div>;
  const rows = (reg?.rows || []).filter((r: any) => !q || JSON.stringify(r).toLowerCase().includes(q.toLowerCase()));
  const cols = (reg?.def?.cols || []).slice(0, 10);
  return (
    <div style={{ minHeight: '100vh', background: 'var(--bg)', color: 'var(--text)', padding: 20 }}>
      <div style={{ maxWidth: 1200, margin: '0 auto', display: 'grid', gap: 14 }}>
        <div className="card" style={{ display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap' }}>
          <ShieldCheck size={26} color="var(--accent)" />
          <div style={{ flex: 1 }}><b style={{ fontSize: 18 }}>Global SJX Limited – ISMS records for audit</b><div className="text-muted" style={{ fontSize: 13 }}>Prepared for {ov.auditor}{ov.company ? `, ${ov.company}` : ''} · read-only · every page you open is logged · access ends {fdate(ov.expiresAt)}</div></div>
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: 'minmax(220px,260px) minmax(0,1fr)', gap: 14, alignItems: 'start' }}>
          <div style={{ display: 'grid', gap: 4 }}>
            {ov.registers.map((r: any) => <button key={r.key} className={`chip ${tab === `register:${r.key}` ? 'active' : ''}`} style={{ display: 'flex', justifyContent: 'space-between', textAlign: 'left' }} onClick={() => setTab(`register:${r.key}`)}><span>{r.title}</span><span style={{ opacity: 0.6 }}>{r.count}</span></button>)}
            {ov.includeEvidence && <button className={`chip ${tab === 'evidence' ? 'active' : ''}`} onClick={() => setTab('evidence')}>Evidence vault</button>}
          </div>
          <div style={{ minWidth: 0 }}>
            <input className="input" style={{ maxWidth: 300, marginBottom: 10 }} placeholder="Search this page…" value={q} onChange={(e) => setQ(e.target.value)} />
            {tab === 'evidence' ? (!ev ? 'Loading…' : (
              <div className="table-wrap"><table className="data-table"><thead><tr><th>Ref</th><th>Title</th><th>Proves</th><th>Collected</th><th>Valid until</th><th>SHA-256</th><th /></tr></thead>
                <tbody>{ev.filter((e) => !q || JSON.stringify(e).toLowerCase().includes(q.toLowerCase())).map((e) => <tr key={e.refNo}><td><b>{e.refNo}</b></td><td>{e.title}<div className="text-muted" style={{ fontSize: 12 }}>{e.description}</div></td><td style={{ fontSize: 12.5 }}>{[...(e.controlRefs || []), ...(e.clauses || []).map((c: string) => `cl. ${c}`)].join(', ')}</td><td>{fdate(e.collectedOn)}</td><td>{e.validUntil ? fdate(e.validUntil) : '—'}</td><td><code style={{ fontSize: 11 }}>{e.sha256 ? `${e.sha256.slice(0, 12)}…` : '—'}</code></td><td>{e.kind === 'file' && <button className="btn btn-ghost btn-sm" onClick={() => download(e.refNo, e.originalName)}><Download size={12} /></button>}</td></tr>)}</tbody></table></div>
            )) : !reg ? 'Loading…' : reg.error ? <div className="card">Could not load this register.</div> : (
              <div className="table-wrap"><table className="data-table"><thead><tr><th>Ref</th>{cols.map((c: any) => <th key={c.key}>{c.label.replace(/ \(.*\)$/, '')}</th>)}<th>Status</th><th>Owner</th></tr></thead>
                <tbody>{rows.map((r: any) => <tr key={r.refNo}><td><b>{r.refNo}</b></td>{cols.map((c: any) => <td key={c.key} style={{ maxWidth: 260, fontSize: 12.5 }}>{c.type === 'date' ? fdate(r.data?.[c.key]) : String(r.data?.[c.key] ?? '—').slice(0, 160)}</td>)}<td>{r.status}</td><td>{r.owner || '—'}</td></tr>)}</tbody></table></div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
