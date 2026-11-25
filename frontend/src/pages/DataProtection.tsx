import { useState } from 'react';
import { Plus, FileLock2, Scale, Clock } from 'lucide-react';
import { api, apiErrorMessage } from '@/lib/api';
import { useToast } from '@/context/ToastContext';
import { useApi } from '@/lib/useApi';
import { PageHead, Tabs, Empty, Loading, ErrorNote, Kv } from '@/components/ui/PageHead';
import { Badge, statusTone } from '@/components/ui/Badge';
import { Modal } from '@/components/ui/Modal';
import { fdate, fdatetime, label, daysLeft } from '@/lib/format';

const DSR_TYPES = ['access', 'rectification', 'erasure', 'restriction', 'portability', 'objection', 'withdraw_consent'];
const DSR_STATUS = ['received', 'verifying', 'in_progress', 'awaiting_info', 'completed', 'rejected'];
const BASES = ['consent', 'contract', 'legal_obligation', 'vital_interests', 'public_task', 'legitimate_interests'];

export function DataProtection() {
  const [tab, setTab] = useState<'dsar' | 'ropa'>('dsar');
  return (
    <div className="page-enter">
      <PageHead title="Data protection" subtitle="Data-subject requests (30-day SLA) and the record of processing activities — NDPA / GDPR." />
      <Tabs tabs={[{ key: 'dsar', label: 'Data subject requests' }, { key: 'ropa', label: 'Record of processing (ROPA)' }]} value={tab} onChange={(k) => setTab(k as any)} />
      {tab === 'dsar' ? <Dsar /> : <Ropa />}
    </div>
  );
}

function Dsar() {
  const { showError, showSuccess } = useToast();
  const { data, loading, error, reload } = useApi<any[]>('/dsar', { limit: 100 });
  const [create, setCreate] = useState(false);
  const [open, setOpen] = useState<any>(null);
  const [f, setF] = useState<any>({ type: 'access', name: '', email: '', relationship: 'client', details: '' });
  const [upd, setUpd] = useState<any>({});
  async function save() {
    try { await api.post('/dsar', { type: f.type, requester: { name: f.name, email: f.email, relationship: f.relationship }, details: f.details }); showSuccess('Request logged — the 30-day clock has started.'); setCreate(false); reload(); } catch (e) { showError(apiErrorMessage(e)); }
  }
  async function patch(body: any) {
    try { const r = await api.patch(`/dsar/${open._id}`, body); setOpen(r.data.data); showSuccess('Updated.'); reload(); } catch (e) { showError(apiErrorMessage(e)); }
  }
  return (
    <>
      <div style={{ marginBottom: 12 }}><button className="btn btn-primary" onClick={() => setCreate(true)}><Plus size={15} /> Log request</button></div>
      <ErrorNote message={error} />
      {loading && !data ? <Loading /> : !data?.length ? <Empty icon={<Scale />} title="No requests logged" /> : (
        <div className="table-wrap"><table className="data-table"><thead><tr><th>Ref</th><th>Type</th><th>Requester</th><th>Status</th><th>Due</th><th>Assignee</th></tr></thead>
          <tbody>{data.map((r) => { const d = daysLeft(r.dueAt); const live = !['completed', 'rejected'].includes(r.status); return (
            <tr key={r._id} onClick={() => { setOpen(r); setUpd({}); }}>
              <td className="mono">{r.reference}</td><td>{label(r.type)}</td><td>{r.requester?.name}<div className="text-muted" style={{ fontSize: 12 }}>{label(r.requester?.relationship)}</div></td>
              <td><Badge tone={statusTone(r.status)}>{label(r.status)}</Badge></td>
              <td>{fdate(r.dueAt)} {live && d !== null && <Badge tone={d < 0 ? 'danger' : d <= 5 ? 'gold' : 'neutral'}><Clock size={10} /> {d < 0 ? `${-d}d overdue` : `${d}d`}</Badge>}</td>
              <td>{r.assigneeId?.name}</td></tr>); })}</tbody></table></div>
      )}
      {create && (
        <Modal open onClose={() => setCreate(false)} title="Log a data-subject request" footer={<><button className="btn btn-ghost" onClick={() => setCreate(false)}>Cancel</button><button className="btn btn-primary" onClick={save}>Log request</button></>}>
          <div className="grid-2">
            <div className="field"><label>Type</label><select className="input" value={f.type} onChange={(e) => setF({ ...f, type: e.target.value })}>{DSR_TYPES.map((t) => <option key={t} value={t}>{label(t)}</option>)}</select></div>
            <div className="field"><label>Relationship</label><select className="input" value={f.relationship} onChange={(e) => setF({ ...f, relationship: e.target.value })}>{['employee', 'client', 'vendor', 'academy_learner', 'website_visitor', 'other'].map((t) => <option key={t} value={t}>{label(t)}</option>)}</select></div>
            <div className="field"><label>Requester name *</label><input className="input" value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} /></div>
            <div className="field"><label>E-mail</label><input className="input" value={f.email} onChange={(e) => setF({ ...f, email: e.target.value })} /></div>
          </div>
          <div className="field"><label>Details</label><textarea className="input" rows={3} value={f.details} onChange={(e) => setF({ ...f, details: e.target.value })} /></div>
        </Modal>
      )}
      {open && (
        <Modal open onClose={() => setOpen(null)} title={`${open.reference} · ${label(open.type)}`} size="wide">
          <div style={{ display: 'grid', gap: 14 }}>
            <Kv rows={[['Requester', `${open.requester?.name} (${open.requester?.email || 'no e-mail'})`], ['Received', fdatetime(open.receivedAt)], ['Due', fdate(open.dueAt) + (open.extended ? ' (extended)' : '')], ['Identity verified', open.identityVerified ? 'Yes' : 'No'], ['Status', <Badge tone={statusTone(open.status)}>{label(open.status)}</Badge>]]} />
            {open.details && <p style={{ margin: 0, fontSize: 14 }}>{open.details}</p>}
            {!['completed', 'rejected'].includes(open.status) && (
              <div className="card" style={{ display: 'grid', gap: 8 }}>
                <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                  {!open.identityVerified && <button className="btn btn-ghost btn-sm" onClick={() => patch({ identityVerified: true })}>Mark identity verified</button>}
                  {!open.extended && <button className="btn btn-ghost btn-sm" onClick={() => patch({ extend: true })}>Extend 60 days</button>}
                </div>
                <div className="grid-2">
                  <div className="field" style={{ margin: 0 }}><label>Move to</label><select className="input" value={upd.status || ''} onChange={(e) => setUpd({ ...upd, status: e.target.value })}><option value="">—</option>{DSR_STATUS.filter((s) => s !== open.status).map((s) => <option key={s} value={s}>{label(s)}</option>)}</select></div>
                  {upd.status === 'completed' && <div className="field" style={{ margin: 0 }}><label>Outcome *</label><input className="input" onChange={(e) => setUpd({ ...upd, outcome: e.target.value })} /></div>}
                  {upd.status === 'rejected' && <div className="field" style={{ margin: 0 }}><label>Reason for refusing *</label><input className="input" onChange={(e) => setUpd({ ...upd, rejectionReason: e.target.value })} /></div>}
                </div>
                <div className="field" style={{ margin: 0 }}><label>Note</label><input className="input" onChange={(e) => setUpd({ ...upd, note: e.target.value })} /></div>
                <div><button className="btn btn-primary btn-sm" onClick={() => patch(upd)}>Save update</button></div>
              </div>
            )}
            <ul style={{ fontSize: 12.5, color: 'var(--muted)', paddingLeft: 18, margin: 0 }}>{[...(open.timeline || [])].reverse().map((t: any, i: number) => <li key={i}>{fdatetime(t.at)} — {t.byName}: {t.text}</li>)}</ul>
          </div>
        </Modal>
      )}
    </>
  );
}

function Ropa() {
  const { showError, showSuccess } = useToast();
  const { data, extra, loading, error, reload } = useApi<any[]>('/ropa');
  const [create, setCreate] = useState(false);
  const blank = { name: '', purpose: '', lawfulBasis: 'contract', dataSubjects: '', dataCategories: '', recipients: '', retentionPeriod: '', securityMeasures: '', sensitiveData: false, thirdCountryTransfer: false, transferSafeguards: '', dpiaRequired: false };
  const [f, setF] = useState<any>(blank);
  const list = (s: string) => s.split(',').map((x) => x.trim()).filter(Boolean);
  async function save() {
    try { await api.post('/ropa', { ...f, dataSubjects: list(f.dataSubjects), dataCategories: list(f.dataCategories), recipients: list(f.recipients), dpiaStatus: f.dpiaRequired ? 'pending' : 'not_required' }); showSuccess('Processing activity recorded.'); setCreate(false); setF(blank); reload(); } catch (e) { showError(apiErrorMessage(e)); }
  }
  const s = extra?.summary;
  return (
    <>
      {s && <div className="stat-grid" style={{ marginBottom: 16 }}>
        <div className="stat-card"><div className="stat-label"><span>Activities</span></div><div className="stat-value">{s.total}</div></div>
        <div className="stat-card"><div className="stat-label"><span>Sensitive data</span></div><div className="stat-value">{s.sensitive}</div></div>
        <div className="stat-card"><div className="stat-label"><span>Cross-border transfers</span></div><div className="stat-value">{s.transfers}</div></div>
        <div className="stat-card"><div className="stat-label"><span>DPIA pending</span></div><div className="stat-value">{s.dpiaPending}</div></div></div>}
      <div style={{ marginBottom: 12 }}><button className="btn btn-primary" onClick={() => setCreate(true)}><Plus size={15} /> Add processing activity</button></div>
      <ErrorNote message={error} />
      {loading && !data ? <Loading /> : !data?.length ? <Empty icon={<FileLock2 />} title="No processing activities recorded" hint="Article 30 requires a record of every way you use personal data." /> : (
        <div className="table-wrap"><table className="data-table" style={{ cursor: 'default' }}><thead><tr><th>Activity</th><th>Purpose</th><th>Lawful basis</th><th>Data</th><th>Retention</th><th>Flags</th></tr></thead>
          <tbody>{data.map((r) => <tr key={r._id} style={{ cursor: 'default' }}>
            <td><strong>{r.name}</strong></td><td>{r.purpose}</td><td>{label(r.lawfulBasis)}</td><td style={{ fontSize: 12.5 }}>{(r.dataCategories || []).join(', ')}</td><td>{r.retentionPeriod || '—'}</td>
            <td style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>{r.sensitiveData && <Badge tone="gold">Sensitive</Badge>}{r.thirdCountryTransfer && <Badge tone="accent">Transfer</Badge>}{r.dpiaRequired && <Badge tone={r.dpiaStatus === 'completed' ? 'success' : 'danger'}>DPIA {label(r.dpiaStatus)}</Badge>}</td></tr>)}</tbody></table></div>
      )}
      {create && (
        <Modal open onClose={() => setCreate(false)} title="Processing activity" size="wide" footer={<><button className="btn btn-ghost" onClick={() => setCreate(false)}>Cancel</button><button className="btn btn-primary" onClick={save}>Save</button></>}>
          <div className="grid-2">
            <div className="field"><label>Activity name *</label><input className="input" value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} /></div>
            <div className="field"><label>Lawful basis</label><select className="input" value={f.lawfulBasis} onChange={(e) => setF({ ...f, lawfulBasis: e.target.value })}>{BASES.map((b) => <option key={b} value={b}>{label(b)}</option>)}</select></div>
          </div>
          <div className="field"><label>Purpose *</label><input className="input" value={f.purpose} onChange={(e) => setF({ ...f, purpose: e.target.value })} /></div>
          <div className="grid-2">
            <div className="field"><label>Data subjects (comma-separated)</label><input className="input" placeholder="employees, clients" value={f.dataSubjects} onChange={(e) => setF({ ...f, dataSubjects: e.target.value })} /></div>
            <div className="field"><label>Data categories</label><input className="input" placeholder="contact, financial" value={f.dataCategories} onChange={(e) => setF({ ...f, dataCategories: e.target.value })} /></div>
            <div className="field"><label>Recipients</label><input className="input" value={f.recipients} onChange={(e) => setF({ ...f, recipients: e.target.value })} /></div>
            <div className="field"><label>Retention period</label><input className="input" placeholder="6 years after contract end" value={f.retentionPeriod} onChange={(e) => setF({ ...f, retentionPeriod: e.target.value })} /></div>
          </div>
          <div className="field"><label>Security measures</label><input className="input" value={f.securityMeasures} onChange={(e) => setF({ ...f, securityMeasures: e.target.value })} /></div>
          <div style={{ display: 'flex', gap: 18, flexWrap: 'wrap', fontSize: 13.5 }}>
            <label><input type="checkbox" checked={f.sensitiveData} onChange={(e) => setF({ ...f, sensitiveData: e.target.checked })} /> Sensitive data</label>
            <label><input type="checkbox" checked={f.thirdCountryTransfer} onChange={(e) => setF({ ...f, thirdCountryTransfer: e.target.checked })} /> Cross-border transfer</label>
            <label><input type="checkbox" checked={f.dpiaRequired} onChange={(e) => setF({ ...f, dpiaRequired: e.target.checked })} /> DPIA required</label>
          </div>
        </Modal>
      )}
    </>
  );
}
