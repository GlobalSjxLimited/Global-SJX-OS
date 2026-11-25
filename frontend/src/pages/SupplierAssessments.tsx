import { useCallback, useEffect, useState } from 'react';
import { Copy, Send } from 'lucide-react';
import { api, apiErrorMessage } from '@/lib/api';
import { useToast } from '@/context/ToastContext';
import { PageHead, Tabs } from '@/components/ui/PageHead';
import { Modal } from '@/components/ui/Modal';

const ST: Record<string, string> = { sent: 'Sent', in_progress: 'In progress', submitted: 'Needs review', reviewed: 'Reviewed', expired: 'Expired', revoked: 'Revoked' };
const dt = (s?: string) => s ? new Date(s).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' }) : '';
const tone = (t?: string) => t === 'high' ? 'var(--danger)' : t === 'medium' ? 'var(--gold, #F0A93B)' : 'var(--success)';

export function SupplierAssessments() {
  const { showError, showSuccess } = useToast(); const [tab, setTab] = useState('review'); const [rows, setRows] = useState<any[]>([]); const [vendors, setVendors] = useState<any[]>([]);
  const [open, setOpen] = useState<any>(null); const [send, setSend] = useState(false); const [link, setLink] = useState('');
  const load = useCallback(() => { api.get('/supplier-assessments').then((r) => setRows(r.data.data)).catch((e) => showError(apiErrorMessage(e))); }, [showError]);
  useEffect(() => { load(); api.get('/supplier-assessments/vendors/list').then((r) => setVendors(r.data.data || [])).catch(() => undefined); }, [load]);
  const list = rows.filter((r) => tab === 'review' ? r.status === 'submitted' : tab === 'waiting' ? ['sent', 'in_progress'].includes(r.status) : ['reviewed', 'expired', 'revoked'].includes(r.status));
  const n = (s: string[]) => rows.filter((r) => s.includes(r.status)).length;
  async function act(id: string, what: 'resend' | 'revoke') { try { const r = await api.post(`/supplier-assessments/${id}/${what}`); if (what === 'resend') { setLink(r.data.data.link); showSuccess('New link e-mailed'); } else showSuccess('Revoked'); load(); } catch (e) { showError(apiErrorMessage(e)); } }
  async function openOne(id: string) { try { setOpen((await api.get(`/supplier-assessments/${id}`)).data.data); } catch (e) { showError(apiErrorMessage(e)); } }
  return (<div>
    <PageHead title="Supplier assessments" subtitle="Send suppliers a private security questionnaire, score the answers, and record your decision in the supplier register." actions={<button className="btn btn-primary" onClick={() => setSend(true)}><Send size={15} /> Send questionnaire</button>} />
    <Tabs value={tab} onChange={setTab} tabs={[{ key: 'review', label: 'Needs review', count: n(['submitted']) || undefined }, { key: 'waiting', label: 'Waiting for supplier', count: n(['sent', 'in_progress']) || undefined }, { key: 'done', label: 'Closed' }]} />
    <div className="card" style={{ marginTop: 14 }}>{list.length === 0 ? <div className="text-muted">Nothing here.</div> : list.map((r) => (
      <div key={r._id} style={{ display: 'flex', justifyContent: 'space-between', gap: 8, flexWrap: 'wrap', padding: '10px 0', borderTop: '1px solid var(--border)' }}>
        <div><b>{r.supplier}</b> <span className="badge">{ST[r.status]}</span>{r.tier && <span className="badge" style={{ background: tone(r.tier), color: '#000', marginLeft: 6 }}>{r.score}% · {r.tier} risk</span>}
          <div className="text-muted" style={{ fontSize: 13 }}>{r.reference} · {r.contactEmail} · sent {dt(r.createdAt)}{r.status === 'sent' || r.status === 'in_progress' ? ` · link valid to ${dt(r.expiresAt)}` : ''}{r.decision ? ` · ${r.decision.replace(/_/g, ' ')}` : ''}</div></div>
        <div style={{ display: 'flex', gap: 6 }}>
          {['submitted', 'reviewed'].includes(r.status) && <button className="btn btn-ghost" onClick={() => openOne(r._id)}>{r.status === 'submitted' ? 'Review' : 'View'}</button>}
          {['sent', 'in_progress', 'expired'].includes(r.status) && <button className="btn btn-ghost" onClick={() => act(r._id, 'resend')}>Send reminder</button>}
          {['sent', 'in_progress', 'submitted'].includes(r.status) && <button className="btn btn-ghost" onClick={() => act(r._id, 'revoke')}>Revoke</button>}</div></div>))}</div>
    {link && <div className="card" style={{ marginTop: 10, display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}><span className="text-muted" style={{ fontSize: 13 }}>Link (also e-mailed):</span><input className="input" readOnly value={link} style={{ flex: 1, minWidth: 240 }} onFocus={(e) => e.target.select()} /><button className="btn btn-ghost" onClick={() => navigator.clipboard?.writeText(link)}><Copy size={14} /> Copy</button></div>}
    {send && <Send_ vendors={vendors} onClose={() => setSend(false)} onDone={(l: string) => { setSend(false); setLink(l); setTab('waiting'); load(); }} />}
    {open && <Detail a={open} onClose={() => setOpen(null)} onDone={() => { setOpen(null); load(); }} />}
  </div>);
}

function Send_({ vendors, onClose, onDone }: any) {
  const { showError } = useToast(); const [f, setF] = useState<any>({ vendorId: '', supplier: '', contactName: '', contactEmail: '', message: '' }); const [busy, setBusy] = useState(false);
  const pick = (id: string) => { const v = vendors.find((x: any) => x._id === id); const c = v?.contacts?.find((x: any) => x.isPrimary) || v?.contacts?.[0]; setF({ ...f, vendorId: id, supplier: v?.name || f.supplier, contactName: c?.name || f.contactName, contactEmail: c?.email || v?.email || f.contactEmail }); };
  async function go() { setBusy(true); try { const r = await api.post('/supplier-assessments', { vendorId: f.vendorId || undefined, supplier: f.supplier || undefined, contactName: f.contactName || undefined, contactEmail: f.contactEmail, message: f.message || undefined }); onDone(r.data.data.link); } catch (e) { showError(apiErrorMessage(e)); } finally { setBusy(false); } }
  return <Modal open onClose={onClose} title="Send security questionnaire" footer={<><button className="btn btn-ghost" onClick={onClose}>Cancel</button><button className="btn btn-primary" disabled={busy || (!f.vendorId && f.supplier.trim().length < 2) || !f.contactEmail} onClick={go}>{busy ? 'Sending…' : 'Send'}</button></>}>
    <div style={{ display: 'grid', gap: 10 }}>
      <div className="field"><label>Supplier from your vendor list</label><select className="input" value={f.vendorId} onChange={(e) => pick(e.target.value)}><option value="">— or type a name below —</option>{vendors.map((v: any) => <option key={v._id} value={v._id}>{v.name}</option>)}</select></div>
      <div className="field"><label>Supplier name</label><input className="input" value={f.supplier} onChange={(e) => setF({ ...f, supplier: e.target.value })} /></div>
      <div className="field"><label>Contact name</label><input className="input" value={f.contactName} onChange={(e) => setF({ ...f, contactName: e.target.value })} /></div>
      <div className="field"><label>Contact e-mail *</label><input className="input" type="email" value={f.contactEmail} onChange={(e) => setF({ ...f, contactEmail: e.target.value })} /></div>
      <div className="field"><label>Message to the supplier (optional)</label><textarea className="input" rows={2} maxLength={1000} value={f.message} onChange={(e) => setF({ ...f, message: e.target.value })} /></div>
      <div className="text-muted" style={{ fontSize: 12.5 }}>They get a private link valid for 21 days. No account is needed.</div></div></Modal>;
}

function Detail({ a, onClose, onDone }: { a: any; onClose: () => void; onDone: () => void }) {
  const { showError, showSuccess } = useToast(); const [decision, setDecision] = useState('accepted'); const [note, setNote] = useState(''); const [risk, setRisk] = useState(a.tier || 'medium'); const [months, setMonths] = useState(a.tier === 'high' ? 6 : 12); const [busy, setBusy] = useState(false);
  async function go() { setBusy(true); try { await api.post(`/supplier-assessments/${a._id}/review`, { decision, note: note || undefined, riskRating: risk, nextReviewMonths: Number(months) }); showSuccess('Recorded in the supplier register'); onDone(); } catch (e) { showError(apiErrorMessage(e)); } finally { setBusy(false); } }
  const gaps = a.answers.filter((x: any) => (x.qid === 'inc2' ? x.answer === 'yes' || x.answer === 'partial' : x.answer === 'no' || x.answer === 'partial'));
  return <Modal open onClose={onClose} size="xwide" title={`${a.supplier} — ${a.reference}`} footer={a.status === 'submitted' ? <><button className="btn btn-ghost" onClick={onClose}>Close</button><button className="btn btn-primary" disabled={busy || (decision !== 'accepted' && note.trim().length < 5)} onClick={go}>{busy ? 'Saving…' : 'Record decision'}</button></> : <button className="btn btn-ghost" onClick={onClose}>Close</button>}>
    <div style={{ display: 'grid', gap: 12 }}>
      <div><span className="badge" style={{ background: tone(a.tier), color: '#000' }}>{a.score}% · suggested {a.tier} risk</span> <span className="text-muted" style={{ fontSize: 13 }}>answered by {a.completedBy?.name}{a.completedBy?.role ? `, ${a.completedBy.role}` : ''} on {dt(a.submittedAt)}</span></div>
      {a.critFails?.length > 0 && <div role="alert" style={{ borderLeft: '3px solid var(--danger)', paddingLeft: 10 }}><b>{a.critFails.length} critical gap(s)</b>: these cap the rating at high however good the score.</div>}
      <div style={{ maxHeight: 280, overflow: 'auto' }}><b>Gaps and explanations ({gaps.length})</b>{gaps.length === 0 ? <div className="text-muted">None.</div> : gaps.map((x: any) => <div key={x.qid} style={{ padding: '6px 0', borderTop: '1px solid var(--border)', fontSize: 13.5 }}><span className="text-muted">{x.domain}{x.critical ? ' · critical' : ''}</span><br />{x.question}<br /><b>{x.answer}</b>{x.note ? ` — ${x.note}` : ''}</div>)}</div>
      <details><summary>All {a.answers.length} answers</summary>{a.answers.map((x: any) => <div key={x.qid} style={{ fontSize: 13, padding: '3px 0' }}>{x.question} <b>{x.answer}</b>{x.note ? ` — ${x.note}` : ''}</div>)}</details>
      {a.status === 'submitted' ? <div style={{ display: 'grid', gap: 10 }}><b>Your decision</b>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(160px,1fr))', gap: 10 }}>
          <div className="field"><label>Decision</label><select className="input" value={decision} onChange={(e) => setDecision(e.target.value)}><option value="accepted">Accept</option><option value="accepted_with_conditions">Accept with conditions</option><option value="rejected">Reject</option></select></div>
          <div className="field"><label>Risk rating</label><select className="input" value={risk} onChange={(e) => setRisk(e.target.value)}><option value="low">Low</option><option value="medium">Medium</option><option value="high">High</option></select></div>
          <div className="field"><label>Review again in (months)</label><input className="input" type="number" min={1} max={24} value={months} onChange={(e) => setMonths(Number(e.target.value))} /></div></div>
        <div className="field"><label>{decision === 'accepted' ? 'Note (optional)' : 'Conditions or reason (required)'}</label><input className="input" value={note} onChange={(e) => setNote(e.target.value)} /></div></div>
        : <div><b>Decision:</b> {a.decision?.replace(/_/g, ' ')} by {a.reviewedByName} on {dt(a.reviewedAt)}{a.reviewNote ? ` — ${a.reviewNote}` : ''}</div>}
    </div></Modal>;
}
