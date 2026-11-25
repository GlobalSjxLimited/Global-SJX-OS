import { useState } from 'react';
import { ScrollText, Plus, CheckCircle2, CalendarClock } from 'lucide-react';
import { api, apiErrorMessage } from '@/lib/api';
import { useAuth } from '@/context/AuthContext';
import { useToast } from '@/context/ToastContext';
import { useApi } from '@/lib/useApi';
import { PageHead, Tabs, Empty, Loading, ErrorNote } from '@/components/ui/PageHead';
import { Badge, statusTone } from '@/components/ui/Badge';
import { Modal } from '@/components/ui/Modal';
import { fdate, label } from '@/lib/format';

const CATS = ['Information Security', 'Data Protection', 'HR', 'Finance', 'Acceptable Use', 'Business Continuity', 'Supplier', 'Quality', 'Other'];

export function Policies() {
  const { user } = useAuth();
  const manage = !!user?.modules?.includes('policies') || user?.role === 'super_admin';
  const [tab, setTab] = useState<'mine' | 'all' | 'calendar'>('mine');
  const compliance = !!user?.modules?.includes('compliance') || user?.role === 'super_admin';
  return (
    <div className="page-enter">
      <PageHead title="Policies" subtitle="Read, acknowledge and track the policies that govern how we protect information." />
      <Tabs tabs={[{ key: 'mine', label: 'My policies' }, ...(manage ? [{ key: 'all', label: 'Policy register' }] : []), ...(compliance ? [{ key: 'calendar', label: 'Compliance calendar' }] : [])]} value={tab} onChange={(k) => setTab(k as any)} />
      {tab === 'mine' && <Mine />}
      {tab === 'all' && manage && <Register />}
      {tab === 'calendar' && compliance && <Calendar />}
    </div>
  );
}

function Mine() {
  const { showError, showSuccess } = useToast();
  const { data, loading, error, reload } = useApi<any[]>('/policies/mine');
  const [open, setOpen] = useState<any>(null);
  async function ack(p: any) {
    try { await api.post(`/policies/${p._id}/acknowledge`); showSuccess('Acknowledged — thank you.'); setOpen(null); reload(); } catch (e) { showError(apiErrorMessage(e)); }
  }
  return (
    <>
      <ErrorNote message={error} />
      {loading && !data ? <Loading /> : !data?.length ? <Empty icon={<ScrollText />} title="No policies published for you yet" /> : (
        <div className="table-wrap"><table className="data-table"><thead><tr><th>Code</th><th>Policy</th><th>Category</th><th>Version</th><th>Status</th></tr></thead>
          <tbody>{data.map((p) => <tr key={p._id} onClick={() => setOpen(p)}><td className="mono">{p.code}</td><td style={{ fontWeight: 600 }}>{p.title}</td><td>{p.category}</td><td>v{p.version}</td>
            <td>{p.acknowledged ? <Badge tone="success">Acknowledged</Badge> : p.requiresAcknowledgement ? <Badge tone="gold">Action needed</Badge> : <Badge>Info</Badge>}</td></tr>)}</tbody></table></div>
      )}
      {open && (
        <Modal open onClose={() => setOpen(null)} title={`${open.code} · ${open.title} (v${open.version})`} size="wide"
          footer={open.requiresAcknowledgement && !open.acknowledged ? <button className="btn btn-primary" onClick={() => ack(open)}><CheckCircle2 size={15} /> I have read and understood this policy</button> : undefined}>
          {open.summary && <p style={{ marginTop: 0, fontWeight: 600 }}>{open.summary}</p>}
          {open.content ? <div className="rich" dangerouslySetInnerHTML={{ __html: sanitize(open.content) }} /> : open.documentUrl ? <a href={open.documentUrl} target="_blank" rel="noreferrer noopener">Open the policy document</a> : <p className="text-muted">No content.</p>}
        </Modal>
      )}
    </>
  );
}

/** Minimal allow-list sanitiser for policy HTML (authored by trusted staff, still defence in depth). */
function sanitize(html: string) {
  const doc = new DOMParser().parseFromString(html, 'text/html');
  const allowed = new Set(['P', 'BR', 'B', 'STRONG', 'I', 'EM', 'U', 'UL', 'OL', 'LI', 'H1', 'H2', 'H3', 'H4', 'A', 'TABLE', 'THEAD', 'TBODY', 'TR', 'TH', 'TD', 'BLOCKQUOTE', 'CODE', 'PRE', 'SPAN', 'DIV']);
  const walk = (n: Element) => {
    Array.from(n.children).forEach((c) => {
      if (!allowed.has(c.tagName)) { c.replaceWith(document.createTextNode(c.textContent || '')); return; }
      Array.from(c.attributes).forEach((a) => { if (!(c.tagName === 'A' && a.name === 'href' && /^(https?:|mailto:)/i.test(a.value))) c.removeAttribute(a.name); });
      if (c.tagName === 'A') { c.setAttribute('rel', 'noopener noreferrer'); c.setAttribute('target', '_blank'); }
      walk(c);
    });
  };
  walk(doc.body);
  return doc.body.innerHTML;
}

function Register() {
  const { user } = useAuth();
  const { showError, showSuccess } = useToast();
  const { data, loading, error, reload } = useApi<any[]>('/policies');
  const [create, setCreate] = useState(false);
  const [f, setF] = useState<any>({ title: '', code: '', category: 'Information Security', version: '1.0', summary: '', content: '', requiresAcknowledgement: true, reviewCycleMonths: 12 });
  const [detail, setDetail] = useState<any>(null);
  const leader = ['super_admin', 'ceo', 'coo'].includes(user?.role || '');
  async function save() {
    try { await api.post('/policies', f); showSuccess('Policy saved as draft.'); setCreate(false); reload(); } catch (e) { showError(apiErrorMessage(e)); }
  }
  async function act(id: string, path: string, body?: any, ok = 'Done.') {
    try { await api.post(`/policies/${id}/${path}`, body); showSuccess(ok); reload(); } catch (e) { showError(apiErrorMessage(e)); }
  }
  async function openDetail(id: string) { try { const r = await api.get(`/policies/${id}`); setDetail(r.data); } catch (e) { showError(apiErrorMessage(e)); } }
  return (
    <>
      <div style={{ marginBottom: 12 }}><button className="btn btn-primary" onClick={() => setCreate(true)}><Plus size={15} /> New policy</button></div>
      <ErrorNote message={error} />
      {loading && !data ? <Loading /> : !data?.length ? <Empty icon={<ScrollText />} title="No policies yet" /> : (
        <div className="table-wrap"><table className="data-table"><thead><tr><th>Code</th><th>Policy</th><th>Version</th><th>Status</th><th>Acknowledged</th><th>Next review</th><th /></tr></thead>
          <tbody>{data.map((p) => <tr key={p._id} onClick={() => openDetail(p._id)}>
            <td className="mono">{p.code}</td><td style={{ fontWeight: 600 }}>{p.title}<div className="text-muted" style={{ fontSize: 12 }}>{p.category}</div></td><td>v{p.version}</td><td><Badge tone={statusTone(p.status)}>{label(p.status)}</Badge></td>
            <td>{p.requiresAcknowledgement ? `${p.acknowledgements}/${p.staff}` : '—'}</td><td>{fdate(p.nextReviewAt)}</td>
            <td onClick={(e) => e.stopPropagation()} style={{ whiteSpace: 'nowrap' }}>
              {['draft', 'in_review'].includes(p.status) && leader && <button className="btn btn-primary btn-sm" onClick={() => act(p._id, 'approve', undefined, 'Approved and staff notified.')}>Approve</button>}
              {p.status === 'draft' && <button className="btn btn-ghost btn-sm" onClick={async () => { try { await api.patch(`/policies/${p._id}`, { status: 'in_review' }); reload(); } catch (e) { showError(apiErrorMessage(e)); } }}>Send for review</button>}
            </td></tr>)}</tbody></table></div>
      )}
      {create && (
        <Modal open onClose={() => setCreate(false)} title="New policy" size="wide" footer={<><button className="btn btn-ghost" onClick={() => setCreate(false)}>Cancel</button><button className="btn btn-primary" onClick={save}>Save draft</button></>}>
          <div className="grid-2">
            <div className="field"><label>Policy title *</label><input className="input" value={f.title} onChange={(e) => setF({ ...f, title: e.target.value })} /></div>
            <div className="field"><label>Code (auto if blank)</label><input className="input" value={f.code} onChange={(e) => setF({ ...f, code: e.target.value })} /></div>
            <div className="field"><label>Category</label><select className="input" value={f.category} onChange={(e) => setF({ ...f, category: e.target.value })}>{CATS.map((c) => <option key={c}>{c}</option>)}</select></div>
            <div className="field"><label>Review every (months)</label><input className="input" type="number" value={f.reviewCycleMonths} onChange={(e) => setF({ ...f, reviewCycleMonths: Number(e.target.value) })} /></div>
          </div>
          <div className="field"><label>Summary</label><input className="input" value={f.summary} onChange={(e) => setF({ ...f, summary: e.target.value })} /></div>
          <div className="field"><label>Policy text</label><textarea className="input" rows={8} value={f.content} onChange={(e) => setF({ ...f, content: e.target.value })} /></div>
          <label style={{ fontSize: 13.5 }}><input type="checkbox" checked={f.requiresAcknowledgement} onChange={(e) => setF({ ...f, requiresAcknowledgement: e.target.checked })} /> Staff must acknowledge</label>
          <p className="text-muted" style={{ fontSize: 12.5 }}>Four-eyes: the author cannot approve their own policy. Approved policies are immutable — changes create a new version.</p>
        </Modal>
      )}
      {detail && (
        <Modal open onClose={() => setDetail(null)} title={`${detail.data.code} · acknowledgements (v${detail.data.version})`} size="wide">
          <p style={{ marginTop: 0 }}><strong>{detail.acknowledgements.length}</strong> acknowledged · <strong>{detail.outstanding.length}</strong> outstanding</p>
          {detail.outstanding.length > 0 && <><strong style={{ fontSize: 13 }}>Outstanding</strong><div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, margin: '6px 0 14px' }}>{detail.outstanding.map((u: any) => <Badge key={u._id} tone="gold">{u.name}</Badge>)}</div></>}
          {detail.acknowledgements.length > 0 && <ul style={{ fontSize: 13, paddingLeft: 18 }}>{detail.acknowledgements.map((a: any) => <li key={a._id}>{a.userId?.name} — {fdate(a.acknowledgedAt)}</li>)}</ul>}
        </Modal>
      )}
    </>
  );
}

function Calendar() {
  const { showError, showSuccess } = useToast();
  const { data, loading, error, reload } = useApi<any[]>('/obligations');
  const [create, setCreate] = useState(false);
  const [f, setF] = useState<any>({ title: '', category: 'regulatory', frequency: 'monthly', nextDueAt: '', authority: '' });
  async function save() { try { await api.post('/obligations', f); showSuccess('Added.'); setCreate(false); reload(); } catch (e) { showError(apiErrorMessage(e)); } }
  async function complete(id: string) { try { await api.post(`/obligations/${id}/complete`, {}); showSuccess('Marked complete — next due date set.'); reload(); } catch (e) { showError(apiErrorMessage(e)); } }
  return (
    <>
      <div style={{ marginBottom: 12 }}><button className="btn btn-primary" onClick={() => setCreate(true)}><CalendarClock size={15} /> Add obligation</button></div>
      <ErrorNote message={error} />
      {loading && !data ? <Loading /> : !data?.length ? <Empty icon={<CalendarClock />} title="No obligations tracked" /> : (
        <div className="table-wrap"><table className="data-table" style={{ cursor: 'default' }}><thead><tr><th>Obligation</th><th>Authority</th><th>Frequency</th><th>Next due</th><th>State</th><th /></tr></thead>
          <tbody>{data.map((o) => <tr key={o._id} style={{ cursor: 'default' }}><td><strong>{o.title}</strong><div className="text-muted" style={{ fontSize: 12 }}>{label(o.category)}</div></td><td>{o.authority || '—'}</td><td>{label(o.frequency)}</td><td>{fdate(o.nextDueAt)}</td>
            <td><Badge tone={o.state === 'overdue' ? 'danger' : o.state === 'due_soon' ? 'gold' : 'neutral'}>{o.state === 'overdue' ? `${-o.daysLeft}d overdue` : `${o.daysLeft}d`}</Badge></td>
            <td><button className="btn btn-ghost btn-sm" onClick={() => complete(o._id)}>Mark done</button></td></tr>)}</tbody></table></div>
      )}
      {create && (
        <Modal open onClose={() => setCreate(false)} title="Compliance obligation" footer={<><button className="btn btn-ghost" onClick={() => setCreate(false)}>Cancel</button><button className="btn btn-primary" onClick={save}>Add</button></>}>
          <div className="field"><label>Policy title *</label><input className="input" value={f.title} onChange={(e) => setF({ ...f, title: e.target.value })} /></div>
          <div className="grid-2">
            <div className="field"><label>Category</label><select className="input" value={f.category} onChange={(e) => setF({ ...f, category: e.target.value })}>{['tax', 'regulatory', 'security', 'data_protection', 'hr', 'finance', 'contract', 'other'].map((c) => <option key={c} value={c}>{label(c)}</option>)}</select></div>
            <div className="field"><label>Frequency</label><select className="input" value={f.frequency} onChange={(e) => setF({ ...f, frequency: e.target.value })}>{['once', 'monthly', 'quarterly', 'biannual', 'annual'].map((c) => <option key={c} value={c}>{label(c)}</option>)}</select></div>
            <div className="field"><label>Next due *</label><input className="input" type="date" value={f.nextDueAt} onChange={(e) => setF({ ...f, nextDueAt: e.target.value })} /></div>
            <div className="field"><label>Authority</label><input className="input" placeholder="FIRS, NDPC, CAC…" value={f.authority} onChange={(e) => setF({ ...f, authority: e.target.value })} /></div>
          </div>
        </Modal>
      )}
    </>
  );
}
