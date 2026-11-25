import { useEffect, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { Plus, FileText, Send, CheckCircle2, XCircle, Ban, Banknote, BellRing, Eye, Download, Paperclip, Receipt } from 'lucide-react';
import { api, apiErrorMessage, openProtectedFile } from '@/lib/api';
import { useAuth } from '@/context/AuthContext';
import { useToast } from '@/context/ToastContext';
import { useConfirm } from '@/context/ConfirmContext';
import { useApi } from '@/lib/useApi';
import { PageHead, Empty, Loading, ErrorNote, Kv } from '@/components/ui/PageHead';
import { Badge, statusTone } from '@/components/ui/Badge';
import { Modal } from '@/components/ui/Modal';
import { Pagination } from '@/components/ui/Pagination';
import { FileUpload } from '@/components/work/FileUpload';
import { RecordPanel } from '@/components/record/RecordPanel';
import { exportCsv, isoDate } from '@/lib/exportCsv';
import { InvoiceEditor } from '@/components/invoices/InvoiceEditor';
import { money, fdate, label, toInputDate, saveBlob, filenameFrom } from '@/lib/format';

const STATUSES = ['draft', 'pending_approval', 'approved', 'sent', 'partially_paid', 'paid', 'rejected', 'void'];

export function Invoices() {
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const { showError } = useToast();
  const [page, setPage] = useState(1);
  const [status, setStatus] = useState(params.get('status') || '');
  const [overdue, setOverdue] = useState(params.get('overdue') === 'true');
  const [q, setQ] = useState('');
  const [editing, setEditing] = useState<any | 'new' | null>(null);
  const [openId, setOpenId] = useState<string | null>(params.get('invoice'));
  const { data, extra, loading, error, reload } = useApi<any[]>('/invoices', { page, status: status || undefined, overdue: overdue || undefined, q: q || undefined });
  useEffect(() => setPage(1), [status, overdue, q]);
  const s = extra?.summary;
  /** Exports every invoice that matches the filters on screen (all pages). */
  async function exportAll() {
    try {
      const rows: any[] = []; let pg = 1; let pages = 1;
      do { const r = await api.get('/invoices', { params: { page: pg, limit: 100, status: status || undefined, overdue: overdue || undefined, q: q || undefined } }); rows.push(...r.data.data); pages = r.data.pagination?.pages || 1; pg += 1; } while (pg <= pages && pg <= 50);
      exportCsv('invoices', [
        { label: 'Invoice', value: (i) => i.invoiceNo }, { label: 'Client', value: (i) => i.clientId?.name }, { label: 'Status', value: (i) => label(i.status) }, { label: 'Issued', value: (i) => isoDate(i.issueDate) }, { label: 'Due', value: (i) => isoDate(i.dueDate) },
        { label: 'Currency', value: (i) => i.currency }, { label: 'Total', value: (i) => i.total }, { label: 'Paid', value: (i) => i.amountPaid }, { label: 'Balance', value: (i) => i.balance }, { label: 'Created', value: (i) => isoDate(i.createdAt) }, { label: 'Modified', value: (i) => isoDate(i.updatedAt) }, { label: 'Modified by', value: (i) => i.updatedBy?.name },
      ], rows);
    } catch (e) { showError(apiErrorMessage(e)); }
  }
  return (
    <div className="page-enter">
      <PageHead title="Invoices" subtitle="Draft, approve (four-eyes), send, record payments and WHT credits — numbered atomically, taxes recorded automatically."
        actions={<><button className="btn btn-ghost" onClick={exportAll}><Download size={15} /> Export</button><button className="btn btn-primary" onClick={() => setEditing('new')}><Plus size={16} /> New invoice</button></>} />
      {s && <div className="stat-grid" style={{ marginBottom: 16 }}>
        <div className="stat-card"><div className="stat-label"><span>Billed (NGN)</span></div><div className="stat-value">{money(s.billed)}</div></div>
        <div className="stat-card"><div className="stat-label"><span>Outstanding (NGN)</span></div><div className="stat-value">{money(s.outstanding)}</div></div>
        <div className="stat-card"><div className="stat-label"><span>Invoices</span></div><div className="stat-value">{s.n}</div></div></div>}
      <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', marginBottom: 14, alignItems: 'center' }}>
        <input className="input" style={{ maxWidth: 240 }} placeholder="Search invoice no." value={q} onChange={(e) => setQ(e.target.value)} />
        <select className="input" style={{ maxWidth: 190 }} value={status} onChange={(e) => setStatus(e.target.value)}><option value="">All statuses</option>{STATUSES.map((x) => <option key={x} value={x}>{label(x)}</option>)}</select>
        <label style={{ fontSize: 13.5 }}><input type="checkbox" checked={overdue} onChange={(e) => setOverdue(e.target.checked)} /> Overdue only</label>
      </div>
      <ErrorNote message={error} />
      {loading && !data ? <Loading /> : !data?.length ? <Empty icon={<FileText />} title="No invoices" /> : (
        <div className="table-wrap"><table className="data-table"><thead><tr><th>Invoice</th><th>Client</th><th>Issued</th><th>Due</th><th>Total</th><th>Balance</th><th>Status</th></tr></thead>
          <tbody>{data.map((i) => { const late = ['sent', 'partially_paid'].includes(i.status) && new Date(i.dueDate) < new Date(); return (
            <tr key={i._id} onClick={() => setOpenId(i._id)}><td className="mono">{i.invoiceNo}</td><td>{i.clientId?.name}</td><td>{fdate(i.issueDate)}</td><td style={late ? { color: 'var(--danger)', fontWeight: 600 } : undefined}>{fdate(i.dueDate)}</td>
              <td>{money(i.total, i.currency)}</td><td>{money(i.balance, i.currency)}</td><td><Badge tone={late ? 'danger' : statusTone(i.status)}>{late ? 'Overdue' : label(i.status)}</Badge></td></tr>); })}</tbody></table></div>
      )}
      {extra?.pagination && <Pagination page={extra.pagination.page} pages={extra.pagination.pages} total={extra.pagination.total} onChange={setPage} />}
      {editing && <InvoiceEditor invoice={editing === 'new' ? null : editing} onClose={() => setEditing(null)} onSaved={(saved, created) => { setEditing(null); reload(); if (created && saved?._id) navigate(`/expenses/new?invoice=${saved._id}`); }} />}
      {openId && <InvoiceDetail id={openId} onClose={() => setOpenId(null)} onChanged={reload} onEdit={(inv) => { setOpenId(null); setEditing(inv); }} />}
    </div>
  );
}

function InvoiceDetail({ id, onClose, onChanged, onEdit }: { id: string; onClose: () => void; onChanged: () => void; onEdit: (inv: any) => void }) {
  const { user } = useAuth();
  const { showError, showSuccess } = useToast();
  const confirm = useConfirm();
  const { data: inv, extra, loading, reload } = useApi<any>(`/invoices/${id}`);
  const [pay, setPay] = useState<any>(null);
  const linked = useApi<any[]>(`/invoices/${id}/expenses`);
  const [doc, setDoc] = useState<string | null>(null);
  async function viewDoc() { try { const r = await api.get(`/invoices/${id}/html`); setDoc(r.data.data.html); } catch (e) { showError(apiErrorMessage(e)); } }
  const [reason, setReason] = useState<{ kind: 'reject' | 'void'; text: string } | null>(null);
  const leader = ['finance', 'coo', 'ceo', 'super_admin'].includes(user?.role || '');
  async function act(fn: () => Promise<any>, ok: string) { try { await fn(); showSuccess(ok); reload(); onChanged(); } catch (e) { showError(apiErrorMessage(e)); } }
  async function pdf() { try { const r = await api.get(`/invoices/${id}/pdf`, { responseType: 'blob' }); saveBlob(r.data, filenameFrom(r.headers['content-disposition'], `${inv.invoiceNo}.pdf`)); } catch (e) { showError(apiErrorMessage(e)); } }
  return (
    <Modal open onClose={onClose} title={inv ? `${inv.invoiceNo}` : 'Invoice'} size="xwide"
      footer={inv && <>
        <button className="btn btn-ghost" onClick={viewDoc}><Eye size={14} /> View invoice</button>
        <button className="btn btn-ghost" onClick={pdf}><FileText size={14} /> PDF</button>
        {['draft', 'rejected'].includes(inv.status) && <><button className="btn btn-ghost" onClick={() => onEdit(inv)}>Edit</button><button className="btn btn-primary" onClick={() => act(() => api.post(`/invoices/${id}/submit`), 'Submitted for approval.')}>Submit for approval</button></>}
        {inv.status === 'pending_approval' && leader && <><button className="btn btn-danger" onClick={() => setReason({ kind: 'reject', text: '' })}><XCircle size={14} /> Reject</button><button className="btn btn-primary" onClick={() => act(() => api.post(`/invoices/${id}/approve`), 'Approved.')}><CheckCircle2 size={14} /> Approve</button></>}
        {['approved', 'sent', 'partially_paid'].includes(inv.status) && <button className="btn btn-ghost" onClick={() => act(() => api.post(`/invoices/${id}/send`, {}), 'Invoice sent to the client.')}><Send size={14} /> {inv.status === 'approved' ? 'Send' : 'Resend'}</button>}
        {['sent', 'partially_paid'].includes(inv.status) && <><button className="btn btn-ghost" onClick={() => act(() => api.post(`/invoices/${id}/remind`), 'Reminder sent.')}><BellRing size={14} /> Chase</button><button className="btn btn-primary" onClick={() => setPay({ amount: inv.balance, whtDeducted: 0, method: 'bank_transfer', reference: '' })}><Banknote size={14} /> Record payment</button></>}
        {leader && !['void', 'paid'].includes(inv.status) && !inv.payments?.length && <button className="btn btn-danger" onClick={() => setReason({ kind: 'void', text: '' })}><Ban size={14} /> Void</button>}
      </>}>
      {loading && !inv ? <Loading /> : inv && (
        <div style={{ display: 'grid', gap: 16 }}>
          <div className="grid-2">
            <Kv rows={[['Client', extra?.client?.name], ['Status', <Badge tone={statusTone(inv.status)}>{label(inv.status)}</Badge>], ['Issued', fdate(inv.issueDate)], ['Due', fdate(inv.dueDate)], ['Bank', extra?.bank ? `${extra.bank.bankName} ••••${extra.bank.accountLast4}` : '—'], ['Reference', inv.referenceNo || inv.poNumber || '—']]} />
            <Kv rows={[['Subtotal', money(inv.subtotal, inv.currency)], [`VAT ${inv.vatRate}%`, money(inv.vatAmount, inv.currency)], ['Total', <strong>{money(inv.total, inv.currency)}</strong>], ['Received', money(inv.amountPaid, inv.currency)], ['WHT credited', money(inv.whtCredited, inv.currency)], ['Balance', <strong>{money(inv.balance, inv.currency)}</strong>]]} />
          </div>
          {inv.rejectionReason && <div className="banner warn">Rejected: {inv.rejectionReason}</div>}
          <div className="table-wrap"><table className="data-table" style={{ cursor: 'default' }}><thead><tr><th>Description</th><th>Qty</th><th>Unit</th><th>Amount</th></tr></thead>
            <tbody>{inv.items.map((i: any, k: number) => <tr key={k} style={{ cursor: 'default' }}><td>{i.group && (k === 0 || inv.items[k - 1].group !== i.group) && <div style={{ fontSize: 11.5, fontWeight: 700, color: 'var(--accent)', marginBottom: 2 }}>{i.group}</div>}{i.description}</td><td>{i.quantity}</td><td>{money(i.unitFee, inv.currency)}</td><td>{money(i.amount, inv.currency)}</td></tr>)}</tbody></table></div>
          {inv.payments?.length > 0 && <div><strong style={{ fontSize: 13 }}>Payments</strong>
            <ul style={{ fontSize: 13, paddingLeft: 18, display: 'grid', gap: 6 }}>{inv.payments.map((p: any, k: number) => <li key={p._id || k}>{fdate(p.paidOn)} — {money(p.amount, inv.currency)}{p.whtDeducted ? ` + WHT ${money(p.whtDeducted, inv.currency)}` : ''} ({label(p.method)}{p.reference ? `, ${p.reference}` : ''}){' '}
              {p.receipt?.url
                ? <button className="btn btn-ghost btn-sm" onClick={() => openProtectedFile(p.receipt.url, p.receipt.name).catch((e) => showError(apiErrorMessage(e)))}><Receipt size={13} /> Receipt: {p.receipt.name}</button>
                : <><Badge tone="gold">No receipt</Badge> <FileUpload label="Attach receipt" multiple={false} kind="document" accept="image/*,.pdf" onUploaded={async (f) => { if (f[0]) await act(() => api.post(`/invoices/${id}/payments/${p._id}/receipt`, { url: f[0].url, name: f[0].name }), 'Receipt attached.'); }} /></>}</li>)}</ul></div>}
          <div><div style={{ display: 'flex', alignItems: 'center', gap: 10 }}><strong style={{ fontSize: 13 }}>Expenses for this invoice</strong>
            <Link className="btn btn-ghost btn-sm" to={`/expenses/new?invoice=${id}`}><Plus size={13} /> Add expense</Link></div>
            {linked.data?.length ? <ul style={{ fontSize: 13, paddingLeft: 18 }}>{linked.data.map((c: any) => <li key={c._id}><Link to={`/expenses?claim=${c._id}`}>{c.claimNo}</Link> — {c.title} · {money(c.totals?.total, c.currency)} · {label(c.status)}</li>)}</ul> : <p className="text-muted" style={{ fontSize: 12.5, margin: '4px 0 0' }}>None yet.</p>}</div>
          <RecordPanel entityType="invoice" entityId={id} doc={inv} kinds={['invoice', 'receipt', 'other']} />
          <details><summary style={{ cursor: 'pointer', fontSize: 13, fontWeight: 600 }}>History</summary><ul style={{ fontSize: 12.5, color: 'var(--muted)', paddingLeft: 18 }}>{[...inv.history].reverse().map((h: any, k: number) => <li key={k}>{fdate(h.at)} — {h.byName}: {label(h.action)}{h.note ? ` (${h.note})` : ''}</li>)}</ul></details>
        </div>
      )}
      {doc && <Modal open onClose={() => setDoc(null)} title={`Invoice ${inv?.invoiceNo || ''}`} size="xwide"><iframe title="Invoice" sandbox="" srcDoc={doc} style={{ width: '100%', height: '70vh', border: '1px solid var(--line)', borderRadius: 10, background: '#fff' }} /></Modal>}
      {pay && <Modal open onClose={() => setPay(null)} title="Record payment" footer={<><button className="btn btn-ghost" onClick={() => setPay(null)}>Cancel</button><button className="btn btn-primary" onClick={async () => { await act(() => api.post(`/invoices/${id}/payments`, pay), 'Payment recorded.'); setPay(null); }}>Save</button></>}>
        <div className="grid-2">
          <div className="field"><label>Amount received</label><input className="input" type="number" value={pay.amount} onChange={(e) => setPay({ ...pay, amount: e.target.value })} /></div>
          <div className="field"><label>WHT deducted by client</label><input className="input" type="number" value={pay.whtDeducted} onChange={(e) => setPay({ ...pay, whtDeducted: e.target.value })} /></div>
          <div className="field"><label>Method</label><select className="input" value={pay.method} onChange={(e) => setPay({ ...pay, method: e.target.value })}>{['bank_transfer', 'cash', 'cheque', 'card', 'other'].map((m) => <option key={m} value={m}>{label(m)}</option>)}</select></div>
          <div className="field"><label>Reference</label><input className="input" value={pay.reference} onChange={(e) => setPay({ ...pay, reference: e.target.value })} /></div>
          <div className="field" style={{ gridColumn: '1 / -1' }}><label>Receipt of payment (bank slip or transfer confirmation)</label>
            {pay.receiptUrl ? <div style={{ display: 'flex', gap: 8, alignItems: 'center', fontSize: 13 }}><Paperclip size={14} /> {pay.receiptName} <button className="btn btn-ghost btn-sm" onClick={() => setPay({ ...pay, receiptUrl: undefined, receiptName: undefined })}>Remove</button></div>
              : <FileUpload label="Upload receipt" multiple={false} kind="document" accept="image/*,.pdf" onUploaded={(f) => { if (f[0]) setPay((x: any) => ({ ...x, receiptUrl: f[0].url, receiptName: f[0].name })); }} />}
            {!pay.receiptUrl && <span className="text-muted" style={{ fontSize: 12 }}>Optional now. You can attach it later from the payment list.</span>}</div>
          <label style={{ fontSize: 13.5, gridColumn: '1 / -1' }}><input type="checkbox" checked={pay.notifyClient !== false} onChange={(e) => setPay({ ...pay, notifyClient: e.target.checked })} /> E-mail the client a payment acknowledgment</label>
        </div></Modal>}
      {reason && <Modal open onClose={() => setReason(null)} title={reason.kind === 'reject' ? 'Reject invoice' : 'Void invoice'} footer={<><button className="btn btn-ghost" onClick={() => setReason(null)}>Cancel</button><button className="btn btn-danger" disabled={!reason.text.trim()} onClick={async () => { await act(() => api.post(`/invoices/${id}/${reason.kind}`, { reason: reason.text }), reason.kind === 'reject' ? 'Rejected.' : 'Voided.'); setReason(null); }}>Confirm</button></>}>
        <div className="field"><label>Reason *</label><input className="input" value={reason.text} onChange={(e) => setReason({ ...reason, text: e.target.value })} /></div></Modal>}
    </Modal>
  );
}
