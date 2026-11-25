import { useCallback, useEffect, useState } from 'react';
import { Copy, FileDown, Plus, Send, X } from 'lucide-react';
import { api, apiErrorMessage, openProtectedFile } from '@/lib/api';
import { useToast } from '@/context/ToastContext';
import { PageHead, Tabs } from '@/components/ui/PageHead';
import { Modal } from '@/components/ui/Modal';

const ST: Record<string, string> = { out_for_signature: 'Out for signature', completed: 'Signed', declined: 'Declined', expired: 'Expired', cancelled: 'Cancelled' };
const dt = (s?: string) => s ? new Date(s).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' }) : '';

export function Signatures() {
  const { showError, showSuccess } = useToast(); const [tab, setTab] = useState('out'); const [rows, setRows] = useState<any[]>([]); const [add, setAdd] = useState(false); const [links, setLinks] = useState<any[]>([]); const [open, setOpen] = useState<any>(null);
  const load = useCallback(() => { api.get('/signatures').then((r) => setRows(r.data.data)).catch((e) => showError(apiErrorMessage(e))); }, [showError]);
  useEffect(() => { load(); }, [load]);
  const list = rows.filter((r) => tab === 'out' ? r.status === 'out_for_signature' : tab === 'done' ? r.status === 'completed' : ['declined', 'expired', 'cancelled'].includes(r.status));
  async function act(id: string, what: 'remind' | 'cancel') { try { const r = await api.post(`/signatures/${id}/${what}`); showSuccess(what === 'remind' ? `Reminder sent to ${r.data.data.reminded} signer(s)` : 'Cancelled'); load(); } catch (e) { showError(apiErrorMessage(e)); } }
  return (<div>
    <PageHead title="E-signatures" subtitle="Send an NDA, contract or supplier terms to be signed by private link, then keep the certificate." actions={<button className="btn btn-primary" onClick={() => setAdd(true)}><Plus size={15} /> New request</button>} />
    <Tabs value={tab} onChange={setTab} tabs={[{ key: 'out', label: 'Out for signature', count: rows.filter((r) => r.status === 'out_for_signature').length || undefined }, { key: 'done', label: 'Signed' }, { key: 'other', label: 'Declined / expired' }]} />
    <div className="card" style={{ marginTop: 14 }}>{list.length === 0 ? <div className="text-muted">Nothing here.</div> : list.map((r) => (
      <div key={r._id} style={{ display: 'flex', justifyContent: 'space-between', gap: 8, flexWrap: 'wrap', padding: '10px 0', borderTop: '1px solid var(--border)' }}>
        <div><b>{r.title}</b> <span className="badge">{ST[r.status]}</span><div className="text-muted" style={{ fontSize: 13 }}>{r.reference} · {r.signers.filter((s: any) => s.status === 'signed').length}/{r.signers.length} signed · {r.signers.map((s: any) => s.name).join(', ')} · sent {dt(r.createdAt)}{r.status === 'out_for_signature' ? ` · expires ${dt(r.expiresAt)}` : ''}</div></div>
        <div style={{ display: 'flex', gap: 6 }}><button className="btn btn-ghost" onClick={() => api.get(`/signatures/${r._id}`).then((x) => setOpen(x.data.data))}>Details</button>
          {r.status === 'completed' && <button className="btn btn-ghost" onClick={() => openProtectedFile(`/signatures/${r._id}/certificate`, `${r.reference}-certificate.pdf`).catch((e) => showError(apiErrorMessage(e)))}><FileDown size={14} /> Certificate</button>}
          {r.status === 'out_for_signature' && <><button className="btn btn-ghost" onClick={() => act(r._id, 'remind')}>Send reminder</button><button className="btn btn-ghost" onClick={() => act(r._id, 'cancel')}>Cancel</button></>}</div></div>))}</div>
    {links.length > 0 && <div className="card" style={{ marginTop: 10, display: 'grid', gap: 6 }}><b>Signing links (also e-mailed; shown only now)</b>{links.map((l) => <div key={l.email} style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}><span style={{ minWidth: 180 }}>{l.email}</span><input className="input" readOnly value={l.link} style={{ flex: 1, minWidth: 240 }} onFocus={(e) => e.target.select()} /><button className="btn btn-ghost" onClick={() => navigator.clipboard?.writeText(l.link)}><Copy size={14} /></button></div>)}<button className="btn btn-ghost" style={{ width: 'fit-content' }} onClick={() => setLinks([])}>Hide</button></div>}
    {add && <New onClose={() => setAdd(false)} onDone={(l: any[]) => { setAdd(false); setLinks(l); setTab('out'); load(); }} />}
    {open && <Modal open onClose={() => setOpen(null)} size="wide" title={`${open.title} — ${open.reference}`} footer={<button className="btn btn-ghost" onClick={() => setOpen(null)}>Close</button>}>
      <div style={{ display: 'grid', gap: 10 }}><div className="text-muted" style={{ fontSize: 12, wordBreak: 'break-all' }}>Fingerprint (SHA-256): {open.bodyHash}</div>
        {open.signers.map((s: any) => <div key={s._id}><b>{s.name}</b> <span className="text-muted">{s.email}</span> — {s.status}{s.signedAt ? ` ${dt(s.signedAt)}` : ''}{s.declineReason ? `: ${s.declineReason}` : ''}</div>)}
        <details><summary>Activity ({open.timeline.length})</summary>{open.timeline.map((t: any, i: number) => <div key={i} style={{ fontSize: 13 }}>{new Date(t.at).toLocaleString('en-GB')} · {t.byName}: {t.text}</div>)}</details>
        <details><summary>Document text</summary><pre style={{ whiteSpace: 'pre-wrap', fontFamily: 'inherit' }}>{open.body}</pre></details></div></Modal>}
  </div>);
}

function New({ onClose, onDone }: { onClose: () => void; onDone: (l: any[]) => void }) {
  const { showError } = useToast(); const [f, setF] = useState({ title: '', category: 'nda', body: '', days: 14 }); const [signers, setSigners] = useState([{ name: '', email: '' }]); const [busy, setBusy] = useState(false);
  const ok = f.title.trim().length >= 3 && f.body.trim().length >= 20 && signers.every((s) => s.name.trim().length >= 2 && /\S+@\S+\.\S+/.test(s.email));
  async function go() { setBusy(true); try { const r = await api.post('/signatures', { ...f, days: Number(f.days), signers }); onDone(r.data.data.links); } catch (e) { showError(apiErrorMessage(e)); } finally { setBusy(false); } }
  return <Modal open onClose={onClose} size="wide" title="New signature request" footer={<><button className="btn btn-ghost" onClick={onClose}>Cancel</button><button className="btn btn-primary" disabled={busy || !ok} onClick={go}><Send size={14} /> {busy ? 'Sending…' : 'Send for signature'}</button></>}>
    <div style={{ display: 'grid', gap: 10 }}>
      <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr 1fr', gap: 10 }}>
        <div className="field"><label>Title *</label><input className="input" value={f.title} onChange={(e) => setF({ ...f, title: e.target.value })} /></div>
        <div className="field"><label>Type</label><select className="input" value={f.category} onChange={(e) => setF({ ...f, category: e.target.value })}>{[['nda', 'NDA'], ['contract', 'Contract'], ['supplier', 'Supplier terms'], ['policy', 'Policy'], ['other', 'Other']].map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select></div>
        <div className="field"><label>Valid for (days)</label><input className="input" type="number" min={2} max={60} value={f.days} onChange={(e) => setF({ ...f, days: Number(e.target.value) })} /></div></div>
      <div className="field"><label>Document text * (this exact text is frozen and fingerprinted when sent)</label><textarea className="input" rows={10} value={f.body} onChange={(e) => setF({ ...f, body: e.target.value })} /></div>
      <b>Signers</b>{signers.map((s, i) => <div key={i} style={{ display: 'flex', gap: 6 }}><input className="input" placeholder="Full name (they must type it exactly)" value={s.name} onChange={(e) => setSigners(signers.map((x, j) => j === i ? { ...x, name: e.target.value } : x))} /><input className="input" type="email" placeholder="E-mail" value={s.email} onChange={(e) => setSigners(signers.map((x, j) => j === i ? { ...x, email: e.target.value } : x))} />{signers.length > 1 && <button className="icon-btn" aria-label="Remove signer" onClick={() => setSigners(signers.filter((_, j) => j !== i))}><X size={14} /></button>}</div>)}
      <button className="btn btn-ghost" style={{ width: 'fit-content' }} disabled={signers.length >= 10} onClick={() => setSigners([...signers, { name: '', email: '' }])}>+ Add signer</button>
      <div className="text-muted" style={{ fontSize: 12.5 }}>Text only for now: paste or type the document. Signers all sign in parallel.</div></div></Modal>;
}
