import { useRef, useState } from 'react';
import { FileCheck2, Lock, Plus, RefreshCw, ShieldCheck, Link2, StickyNote, Paperclip, Download, ClipboardList } from 'lucide-react';
import { api, apiErrorMessage } from '@/lib/api';
import { useToast } from '@/context/ToastContext';
import { useApi } from '@/lib/useApi';
import { Empty, ErrorNote, Loading } from '@/components/ui/PageHead';
import { Badge } from '@/components/ui/Badge';
import { Modal } from '@/components/ui/Modal';
import { fdate, fdatetime } from '@/lib/format';

const STATE_TONE: Record<string, any> = { current: 'success', expiring: 'gold', expired: 'danger', superseded: 'neutral' };

/** Evidence vault: fingerprinted files, links and notes tied to Annex A controls and clauses, with expiry, locking and requests. */
export function EvidenceVault({ control }: { control?: string }) {
  const { showError, showSuccess } = useToast();
  const [q, setQ] = useState(''); const [state, setState] = useState(''); const [hist, setHist] = useState(false);
  const [add, setAdd] = useState<null | { base?: any }>(null); const [req, setReq] = useState(false); const [open, setOpen] = useState<any>(null);
  const sum = useApi<any>('/evidence/summary');
  const list = useApi<any[]>('/evidence', { q: q || undefined, state: state || undefined, control: control || undefined, history: hist || undefined, limit: 100 });
  const reqs = useApi<any[]>('/evidence/requests/list', { status: 'open' });
  const reload = () => { sum.reload(); list.reload(); reqs.reload(); };
  async function act(id: string, what: 'verify' | 'lock', ok: string) { try { await api.post(`/evidence/${id}/${what}`, {}); showSuccess(ok); reload(); setOpen(null); } catch (e) { showError(apiErrorMessage(e)); } }
  const s = sum.data;
  return (
    <div style={{ display: 'grid', gap: 12 }}>
      {!control && <div className="card"><div style={{ fontWeight: 650, fontSize: 16 }}>Evidence vault</div><div className="text-muted" style={{ fontSize: 13.5, marginTop: 4 }}>Keep the proof that a control works. Files are fingerprinted (SHA-256) when added and re-checked every week; locking freezes an item so it cannot be quietly changed; expiry dates trigger refresh requests.</div></div>}
      {s && !control && (
        <div className="stat-grid">
          <div className="stat-card"><div className="stat-label"><span>Evidence items</span></div><div className="stat-value">{s.total}</div></div>
          <div className="stat-card"><div className="stat-label"><span>Annex A controls with evidence</span></div><div className="stat-value">{s.controlsCovered}<span className="text-muted" style={{ fontSize: 14 }}> / 93</span></div></div>
          <div className="stat-card"><div className="stat-label"><span>Expiring / expired</span></div><div className="stat-value" style={s.expired ? { color: 'var(--danger)' } : undefined}>{s.expiring} / {s.expired}</div></div>
          <div className="stat-card"><div className="stat-label"><span>Locked · integrity alerts</span></div><div className="stat-value" style={s.tampered ? { color: 'var(--danger)' } : undefined}>{s.locked} · {s.tampered}</div></div>
        </div>
      )}
      {!control && !!reqs.data?.length && (
        <div className="card" style={{ display: 'grid', gap: 6 }}>
          <strong style={{ fontSize: 13.5, display: 'flex', gap: 6, alignItems: 'center' }}><ClipboardList size={14} /> Open evidence requests ({reqs.data.length})</strong>
          {reqs.data.slice(0, 8).map((r) => <div key={r._id} style={{ fontSize: 13, display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}><b>{r.refNo}</b> {r.title}{r.controlRef && <Badge tone="accent">{r.controlRef}</Badge>}<span className="text-muted">{r.assigneeName || 'unassigned'}{r.dueDate ? ` · due ${fdate(r.dueDate)}` : ''}{r.source === 'auto' ? ' · opened automatically' : ''}</span><button className="btn btn-ghost btn-sm" style={{ marginLeft: 'auto' }} onClick={() => setAdd({ base: { requestId: r._id, title: r.title.replace(/^Refresh expired evidence: /, ''), controlRefs: r.controlRef || '' } })}>Provide</button></div>)}
        </div>
      )}
      <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'center' }}>
        <input className="input" style={{ width: 230 }} placeholder="Search evidence…" value={q} onChange={(e) => setQ(e.target.value)} />
        <select className="input" style={{ width: 160 }} value={state} onChange={(e) => setState(e.target.value)}><option value="">All states</option><option value="current">Current</option><option value="expiring">Expiring</option><option value="expired">Expired</option></select>
        <label style={{ fontSize: 13.5 }}><input type="checkbox" checked={hist} onChange={(e) => setHist(e.target.checked)} /> Include old versions</label>
        <span style={{ marginLeft: 'auto', display: 'flex', gap: 8 }}>
          <button className="btn btn-ghost" onClick={() => setReq(true)}><ClipboardList size={15} /> Request evidence</button>
          <button className="btn btn-primary" onClick={() => setAdd({ base: control ? { controlRefs: control } : undefined })}><Plus size={15} /> Add evidence</button>
        </span>
      </div>
      <ErrorNote message={list.error} />
      {list.loading && !list.data ? <Loading /> : !list.data?.length ? <Empty title="No evidence yet" hint="Add a file, link or note and tie it to the control it proves." /> : (
        <div className="table-wrap"><table className="data-table">
          <thead><tr><th>Ref</th><th>Title</th><th>Proves</th><th>Valid until</th><th>State</th><th>Integrity</th></tr></thead>
          <tbody>{list.data.map((e) => (
            <tr key={e._id} onClick={() => setOpen(e)} style={{ cursor: 'pointer' }}>
              <td style={{ fontWeight: 600, whiteSpace: 'nowrap' }}>{e.refNo}{e.version > 1 && <span className="text-muted"> v{e.version}</span>} {e.lockedAt && <Lock size={12} style={{ verticalAlign: -1 }} />}</td>
              <td>{e.kind === 'link' ? <Link2 size={12} /> : e.kind === 'note' ? <StickyNote size={12} /> : <Paperclip size={12} />} {e.title}</td>
              <td style={{ fontSize: 12.5 }}>{[...(e.controlRefs || []), ...(e.clauses || []).map((c: string) => `cl. ${c}`)].join(', ')}</td>
              <td>{e.validUntil ? fdate(e.validUntil) : '—'}</td>
              <td><Badge tone={STATE_TONE[e.state]}>{e.state}</Badge></td>
              <td>{e.kind === 'file' ? <Badge tone={e.integrity === 'ok' ? 'success' : 'danger'}>{e.integrity === 'ok' ? 'fingerprint ok' : e.integrity}</Badge> : <span className="text-muted">—</span>}</td>
            </tr>))}</tbody>
        </table></div>
      )}
      {add && <AddEvidence base={add.base} onClose={() => setAdd(null)} onSaved={() => { setAdd(null); reload(); }} />}
      {req && <RequestModal onClose={() => setReq(false)} onSaved={() => { setReq(false); reload(); }} />}
      {open && (
        <Modal open onClose={() => setOpen(null)} size="wide" title={`${open.refNo} · ${open.title}`}
          footer={<>
            {!open.supersededById && <button className="btn btn-ghost" onClick={() => { setAdd({ base: { versionOf: open } }); setOpen(null); }}><RefreshCw size={14} /> New version</button>}
            {open.kind === 'file' && <button className="btn btn-ghost" onClick={() => act(open._id, 'verify', 'Fingerprint checked.')}><ShieldCheck size={14} /> Verify file</button>}
            {!open.lockedAt && !open.supersededById && <button className="btn btn-primary" onClick={() => act(open._id, 'lock', 'Locked.')}><Lock size={14} /> Lock</button>}
          </>}>
          <div style={{ display: 'grid', gap: 8, fontSize: 13.5 }}>
            <div>{open.description || <span className="text-muted">No description.</span>}</div>
            <div className="text-muted">Proves: {[...(open.controlRefs || []), ...(open.clauses || []).map((c: string) => `clause ${c}`), ...(open.registerRefs || [])].join(', ') || '—'}</div>
            <div className="text-muted">Collected {fdate(open.collectedOn)} by {open.ownerName}{open.validUntil ? ` · valid until ${fdate(open.validUntil)}` : ''}{open.lockedAt ? ` · locked ${fdate(open.lockedAt)} by ${open.lockedByName}` : ''}</div>
            {open.url && open.kind === 'link' && <a href={open.url} target="_blank" rel="noreferrer">{open.url}</a>}
            {open.kind === 'file' && <div><button className="btn btn-ghost btn-sm" onClick={async () => { const r = await api.get(open.url.replace(/^\/api/, ''), { responseType: 'blob' }); const u = URL.createObjectURL(r.data); const a = document.createElement('a'); a.href = u; a.download = open.originalName || open.refNo; a.click(); URL.revokeObjectURL(u); }}><Download size={13} /> {open.originalName || 'Download'}</button> <span className="text-muted" style={{ fontSize: 12 }}>{open.size} bytes · SHA-256 <code>{open.sha256}</code></span></div>}
            <div><FileCheck2 size={13} style={{ verticalAlign: -2 }} /> <b>History</b>{[...(open.history || [])].reverse().map((h: any, i: number) => <div key={i} className="text-muted" style={{ fontSize: 12.5 }}>{fdatetime(h.at)} · {h.byName} · {h.action}{h.note ? ` – ${h.note}` : ''}</div>)}</div>
          </div>
        </Modal>
      )}
    </div>
  );
}

function AddEvidence({ base, onClose, onSaved }: { base?: any; onClose: () => void; onSaved: () => void }) {
  const { showError, showSuccess } = useToast();
  const prev = base?.versionOf;
  const [f, setF] = useState<any>({ kind: 'file', title: prev?.title || base?.title || '', description: prev?.description || '', controlRefs: prev ? (prev.controlRefs || []).join(', ') : base?.controlRefs || '', clauses: prev ? (prev.clauses || []).join(', ') : '', validUntil: '', url: '' });
  const [file, setFile] = useState<File | null>(null); const [busy, setBusy] = useState(false); const [err, setErr] = useState('');
  const ref = useRef<HTMLInputElement>(null);
  const set = (k: string, v: any) => setF((x: any) => ({ ...x, [k]: v }));
  async function save() {
    setBusy(true); setErr('');
    try {
      const body: any = { ...f, validUntil: f.validUntil || undefined, url: f.url || undefined };
      if (f.kind === 'file') {
        if (!file) throw new Error('Choose a file to upload');
        const fd = new FormData(); fd.append('file', file); const u = (await api.post('/uploads', fd)).data.data;
        body.url = u.url; body.originalName = u.originalName; body.mimeType = u.mimeType; body.size = u.size;
      }
      if (base?.requestId) body.requestId = base.requestId;
      if (prev) await api.post(`/evidence/${prev._id}/new-version`, body); else await api.post('/evidence', body);
      showSuccess(prev ? 'New version added; the old one is kept.' : 'Evidence added.'); onSaved();
    } catch (e: any) { const m = apiErrorMessage(e); setErr(m && m !== 'Something went wrong' ? m : e?.message || m); showError(m); } finally { setBusy(false); }
  }
  return (
    <Modal open onClose={onClose} size="wide" title={prev ? `New version of ${prev.refNo}` : 'Add evidence'} footer={<><button className="btn btn-ghost" onClick={onClose}>Cancel</button><button className="btn btn-primary" disabled={busy} onClick={save}>{busy ? 'Saving…' : 'Save'}</button></>}>
      {err && <div className="card" style={{ borderLeft: '3px solid var(--danger)', marginBottom: 10, fontSize: 13.5 }}>{err}</div>}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(230px,1fr))', gap: 12 }}>
        <div className="field"><label>Type</label><select className="input" value={f.kind} onChange={(e) => set('kind', e.target.value)}><option value="file">File (fingerprinted)</option><option value="link">Link</option><option value="note">Written note</option></select></div>
        <div className="field"><label>Title *</label><input className="input" value={f.title} onChange={(e) => set('title', e.target.value)} /></div>
        <div className="field"><label>Annex A controls * (e.g. A.8.13, A.5.30)</label><input className="input" value={f.controlRefs} onChange={(e) => set('controlRefs', e.target.value)} /></div>
        <div className="field"><label>ISMS clauses (e.g. 9.2)</label><input className="input" value={f.clauses} onChange={(e) => set('clauses', e.target.value)} /></div>
        <div className="field"><label>Valid until (leave empty if it does not expire)</label><input className="input" type="date" value={f.validUntil} onChange={(e) => set('validUntil', e.target.value)} /></div>
        {f.kind === 'file' && <div className="field"><label>File (pdf, office, image, csv, txt – max 20 MB)</label><input ref={ref} className="input" type="file" onChange={(e) => setFile(e.target.files?.[0] || null)} /></div>}
        {f.kind === 'link' && <div className="field"><label>Link *</label><input className="input" placeholder="https://…" value={f.url} onChange={(e) => set('url', e.target.value)} /></div>}
      </div>
      <div className="field"><label>{f.kind === 'note' ? 'What was done and seen *' : 'Description'}</label><textarea className="input" rows={3} value={f.description} onChange={(e) => set('description', e.target.value)} /></div>
    </Modal>
  );
}

function RequestModal({ onClose, onSaved }: { onClose: () => void; onSaved: () => void }) {
  const { showError, showSuccess } = useToast();
  const people = useApi<any[]>('/employees/directory/list');
  const [f, setF] = useState<any>({ title: '', controlRef: '', assigneeId: '', dueDate: '', note: '' });
  const set = (k: string, v: any) => setF((x: any) => ({ ...x, [k]: v }));
  async function save() { try { await api.post('/evidence/requests', { ...f, assigneeId: f.assigneeId || undefined, dueDate: f.dueDate || undefined, controlRef: f.controlRef || undefined }); showSuccess('Request sent.'); onSaved(); } catch (e) { showError(apiErrorMessage(e)); } }
  return (
    <Modal open onClose={onClose} title="Request evidence" footer={<><button className="btn btn-ghost" onClick={onClose}>Cancel</button><button className="btn btn-primary" onClick={save}>Send request</button></>}>
      <div className="field"><label>What is needed *</label><input className="input" value={f.title} onChange={(e) => set('title', e.target.value)} /></div>
      <div className="field"><label>Annex A control</label><input className="input" placeholder="A.8.20" value={f.controlRef} onChange={(e) => set('controlRef', e.target.value)} /></div>
      <div className="field"><label>Ask</label><select className="input" value={f.assigneeId} onChange={(e) => set('assigneeId', e.target.value)}><option value="">— nobody yet —</option>{(people.data || []).map((p) => <option key={p._id} value={p._id}>{p.name}</option>)}</select></div>
      <div className="field"><label>Due</label><input className="input" type="date" value={f.dueDate} onChange={(e) => set('dueDate', e.target.value)} /></div>
      <div className="field"><label>Note</label><textarea className="input" rows={2} value={f.note} onChange={(e) => set('note', e.target.value)} /></div>
    </Modal>
  );
}
