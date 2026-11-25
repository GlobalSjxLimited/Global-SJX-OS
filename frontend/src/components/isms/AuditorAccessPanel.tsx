import { useState } from 'react';
import { Copy, Link2, Plus, XCircle } from 'lucide-react';
import { api, apiErrorMessage } from '@/lib/api';
import { useApi } from '@/lib/useApi';
import { useToast } from '@/context/ToastContext';
import { Badge } from '@/components/ui/Badge';
import { Modal } from '@/components/ui/Modal';
import { Empty, ErrorNote, Loading } from '@/components/ui/PageHead';
import { fdate, fdatetime } from '@/lib/format';

/** Admin: give an external auditor a time-limited, read-only link to chosen registers and evidence. */
export function AuditorAccessPanel({ registers }: { registers: Array<{ key: string; title: string }> }) {
  const { showError, showSuccess } = useToast();
  const { data, loading, error, reload } = useApi<any[]>('/auditor-access');
  const [add, setAdd] = useState(false); const [made, setMade] = useState<any>(null);
  const [f, setF] = useState<any>({ name: '', company: '', email: '', days: 14, includeEvidence: true, regs: [] as string[] });
  const set = (k: string, v: any) => setF((x: any) => ({ ...x, [k]: v }));
  async function create() {
    try { const r = await api.post('/auditor-access', { name: f.name, company: f.company || undefined, email: f.email || undefined, days: Number(f.days), includeEvidence: f.includeEvidence, registers: f.regs.length ? f.regs : undefined }); setMade(r.data.data); setAdd(false); reload(); } catch (e) { showError(apiErrorMessage(e)); }
  }
  async function revoke(id: string) { try { await api.post(`/auditor-access/${id}/revoke`, {}); showSuccess('Link revoked.'); reload(); } catch (e) { showError(apiErrorMessage(e)); } }
  const url = made ? `${window.location.origin}${made.path}` : '';
  return (
    <div style={{ display: 'grid', gap: 12 }}>
      <div className="card" style={{ display: 'flex', gap: 12, flexWrap: 'wrap', alignItems: 'center' }}>
        <div style={{ flex: 1, minWidth: 260 }}><b>Auditor access</b><div className="text-muted" style={{ fontSize: 13.5 }}>A private link that lets an auditor read the registers and evidence you choose, for a limited time. They cannot change anything. Every page they open is logged, and you can switch the link off at any moment.</div></div>
        <button className="btn btn-primary" onClick={() => setAdd(true)}><Plus size={15} /> New auditor link</button>
      </div>
      <ErrorNote message={error} />
      {loading && !data ? <Loading /> : !data?.length ? <Empty title="No auditor links yet" hint="Create one when an auditor needs to see your records." /> : (
        <div className="table-wrap"><table className="data-table"><thead><tr><th>Auditor</th><th>Registers</th><th>Expires</th><th>Last opened</th><th>State</th><th /></tr></thead>
          <tbody>{data.map((a) => (
            <tr key={a._id}>
              <td><b>{a.name}</b><div className="text-muted" style={{ fontSize: 12 }}>{a.company}{a.email ? ` · ${a.email}` : ''}</div></td>
              <td style={{ fontSize: 12.5 }}>{a.registers.length} registers{a.includeEvidence ? ' + evidence' : ''}</td>
              <td>{fdate(a.expiresAt)}</td>
              <td title={(a.log || []).map((l: any) => `${fdatetime(l.at)} ${l.what}`).join('\n')}>{a.lastUsedAt ? `${fdatetime(a.lastUsedAt)} (${a.uses} views)` : 'never'}</td>
              <td><Badge tone={a.state === 'active' ? 'success' : 'neutral'}>{a.state}</Badge></td>
              <td>{a.state === 'active' && <button className="btn btn-ghost btn-sm" onClick={() => revoke(a._id)}><XCircle size={13} /> Revoke</button>}</td>
            </tr>))}</tbody></table></div>
      )}
      {add && (
        <Modal open onClose={() => setAdd(false)} size="wide" title="New auditor link" footer={<><button className="btn btn-ghost" onClick={() => setAdd(false)}>Cancel</button><button className="btn btn-primary" onClick={create}>Create link</button></>}>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(220px,1fr))', gap: 12 }}>
            <div className="field"><label>Auditor name *</label><input className="input" value={f.name} onChange={(e) => set('name', e.target.value)} /></div>
            <div className="field"><label>Company</label><input className="input" value={f.company} onChange={(e) => set('company', e.target.value)} /></div>
            <div className="field"><label>E-mail (for your records)</label><input className="input" value={f.email} onChange={(e) => set('email', e.target.value)} /></div>
            <div className="field"><label>Valid for (days, max 60)</label><input className="input" type="number" min={1} max={60} value={f.days} onChange={(e) => set('days', e.target.value)} /></div>
          </div>
          <label style={{ fontSize: 13.5, display: 'block', margin: '8px 0' }}><input type="checkbox" checked={f.includeEvidence} onChange={(e) => set('includeEvidence', e.target.checked)} /> Include the evidence vault (files can be downloaded)</label>
          <div className="field"><label>Registers they may read (none ticked = all)</label>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill,minmax(250px,1fr))', gap: 4, maxHeight: 220, overflow: 'auto' }}>
              {registers.map((r) => <label key={r.key} style={{ fontSize: 13 }}><input type="checkbox" checked={f.regs.includes(r.key)} onChange={(e) => set('regs', e.target.checked ? [...f.regs, r.key] : f.regs.filter((x: string) => x !== r.key))} /> {r.title}</label>)}
            </div></div>
          <div className="text-muted" style={{ fontSize: 12.5 }}>Registers can contain staff names and personal details. Only share what the audit needs.</div>
        </Modal>
      )}
      {made && (
        <Modal open onClose={() => setMade(null)} title="Link created" footer={<button className="btn btn-primary" onClick={() => setMade(null)}>Done</button>}>
          <p style={{ marginTop: 0 }}>Send this link to <b>{made.name}</b>. <b>It is shown only now</b> – if it is lost, revoke it and create another.</p>
          <div style={{ display: 'flex', gap: 8 }}><input className="input" readOnly value={url} onFocus={(e) => e.target.select()} /><button className="btn btn-ghost" onClick={() => { navigator.clipboard?.writeText(url); showSuccess('Copied.'); }}><Copy size={14} /> Copy</button></div>
          <div className="text-muted" style={{ fontSize: 12.5, marginTop: 8 }}><Link2 size={12} /> Works until {fdate(made.expiresAt)}.</div>
        </Modal>
      )}
    </div>
  );
}
