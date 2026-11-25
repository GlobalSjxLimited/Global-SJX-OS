import { useEffect, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { Plus, Receipt, Eye, CheckCircle2, XCircle, ShieldAlert, Wallet, Pencil, Ban, Banknote } from 'lucide-react';
import { api, apiErrorMessage } from '@/lib/api';
import { useAuth } from '@/context/AuthContext';
import { useToast } from '@/context/ToastContext';
import { useConfirm } from '@/context/ConfirmContext';
import { useApi } from '@/lib/useApi';
import { PageHead, Tabs, Empty, Loading, ErrorNote, Kv } from '@/components/ui/PageHead';
import { Badge, statusTone } from '@/components/ui/Badge';
import { Modal } from '@/components/ui/Modal';
import { Pagination } from '@/components/ui/Pagination';
import { AttachmentList } from '@/components/ui/FileAttach';
import { money, fdate, fdatetime, label } from '@/lib/format';
import { RecordPanel } from '@/components/record/RecordPanel';
import { ExportButton } from '@/components/ui/ExportButton';

const MODE_LABEL: Record<string, string> = { company_paid: 'Company paid', paid_personally: 'Paid personally', awaiting_disbursement: 'Awaiting disbursement' };
const MODE_TONE: Record<string, 'neutral' | 'accent' | 'gold'> = { company_paid: 'neutral', paid_personally: 'accent', awaiting_disbursement: 'gold' };
const FLAG: Record<string, string> = { missing_receipt: 'Missing receipt', possible_duplicate: 'Possible duplicate' };

export function Expenses() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const approver = !!user?.modules?.includes('expense_approvals') || user?.role === 'super_admin';
  const canClaim = !!user?.modules?.includes('expenses') || user?.role === 'super_admin';
  const [scope, setScope] = useState<'mine' | 'all'>(approver && !canClaim ? 'all' : 'mine');
  const [status, setStatus] = useState(params.get('status') || '');
  const [page, setPage] = useState(1);
  const [q, setQ] = useState('');
  const [openId, setOpenId] = useState<string | null>(params.get('claim'));
  const { data, extra, loading, error, reload } = useApi<any[]>('/expenses', { scope, status: status || undefined, page, q: q || undefined });

  useEffect(() => { setPage(1); }, [scope, status, q]);
  const summary: Array<{ _id: string; n: number; total: number; payable: number }> = extra?.summary || [];
  const sum = (s: string) => summary.find((x) => x._id === s);

  return (
    <div className="page-enter">
      <PageHead
        title="Expenses"
        subtitle="Claim what you spent — several items, several receipts — and track approval and payment."
        actions={<><ExportButton endpoint="/expenses" params={{ scope, status: status || undefined, q: q || undefined }} filename="expense-claims" columns={[{ label: 'Claim', value: (r) => r.claimNo }, { label: 'Title', value: (r) => r.title }, { label: 'By', value: (r) => r.submittedByName }, { label: 'Status', value: (r) => r.status }, { label: 'Currency', value: (r) => r.currency }, { label: 'Total', value: (r) => r.totals?.total }, { label: 'Payable', value: (r) => r.totals?.payable }, { label: 'Invoice', value: (r) => r.invoiceNo }]} />{canClaim && <button className="btn btn-primary" onClick={() => navigate('/expenses/new')}><Plus size={16} /> New expense claim</button>}</>}
      />
      <div className="stat-grid" style={{ marginBottom: 20 }}>
        <div className="stat-card"><div className="stat-label"><span>Awaiting approval</span><Receipt /></div><div className="stat-value">{(sum('submitted')?.n || 0) + (sum('partially_approved')?.n || 0)}</div></div>
        <div className="stat-card"><div className="stat-label"><span>Approved, unpaid</span><Wallet /></div><div className="stat-value">{sum('approved')?.n || 0}</div><div className="stat-sub">{money(sum('approved')?.payable)} payable</div></div>
        <div className="stat-card"><div className="stat-label"><span>Paid</span></div><div className="stat-value">{sum('paid')?.n || 0}</div></div>
        <div className="stat-card"><div className="stat-label"><span>Drafts</span></div><div className="stat-value">{sum('draft')?.n || 0}</div></div>
      </div>

      {approver && canClaim && <Tabs tabs={[{ key: 'mine', label: 'My claims' }, { key: 'all', label: 'All claims (approvals)' }]} value={scope} onChange={(k) => setScope(k as any)} />}
      <div style={{ display: 'flex', gap: 10, marginBottom: 14, flexWrap: 'wrap' }}>
        <input className="input" style={{ maxWidth: 260 }} placeholder="Search claim no. or title" value={q} onChange={(e) => setQ(e.target.value)} />
        <select className="input" style={{ maxWidth: 200 }} value={status} onChange={(e) => setStatus(e.target.value)}>
          <option value="">All statuses</option>
          {['draft', 'submitted', 'partially_approved', 'approved', 'rejected', 'paid', 'cancelled'].map((s) => <option key={s} value={s}>{label(s)}</option>)}
        </select>
      </div>

      <ErrorNote message={error} />
      {loading && !data ? <Loading /> : !data?.length ? (
        <Empty icon={<Receipt />} title="No expense claims yet" hint={canClaim ? 'Create your first claim — add every item and receipt in one go.' : undefined} />
      ) : (
        <div className="table-wrap">
          <table className="data-table">
            <thead><tr><th>Claim</th><th>Claim title</th>{scope === 'all' && <th>Employee</th>}<th>Items</th><th>Total</th><th>Reimburse / disburse</th><th>Status</th><th>Submitted</th><th /></tr></thead>
            <tbody>
              {data.map((c: any) => (
                <tr key={c._id} onClick={() => setOpenId(c._id)}>
                  <td className="mono">{c.claimNo}</td>
                  <td style={{ fontWeight: 600 }}>{c.title}</td>
                  {scope === 'all' && <td>{c.submittedByName}</td>}
                  <td>{c.items?.length}</td>
                  <td>{money(c.totals?.total, c.currency)}</td>
                  <td>
                    {c.totals?.reimbursable > 0 && <Badge tone="accent">{money(c.totals.reimbursable, c.currency)} personal</Badge>}{' '}
                    {c.totals?.toDisburse > 0 && <Badge tone="gold">{money(c.totals.toDisburse, c.currency)} to disburse</Badge>}
                  </td>
                  <td><Badge tone={statusTone(c.status)}>{label(c.status)}</Badge></td>
                  <td>{fdate(c.submittedAt || c.createdAt)}</td>
                  <td><button className="icon-btn" aria-label="Open"><Eye /></button></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {extra?.pagination && <Pagination page={extra.pagination.page} pages={extra.pagination.pages} total={extra.pagination.total} onChange={setPage} />}

      {openId && <ClaimDetail id={openId} onClose={() => { setOpenId(null); if (params.get('claim')) { params.delete('claim'); setParams(params, { replace: true }); } }} onChanged={reload} />}
    </div>
  );
}

function ClaimDetail({ id, onClose, onChanged }: { id: string; onClose: () => void; onChanged: () => void }) {
  const navigate = useNavigate();
  const { showError, showSuccess } = useToast();
  const confirm = useConfirm();
  const { data: claim, extra, loading, error, reload } = useApi<any>(`/expenses/${id}`);
  const [notes, setNotes] = useState<Record<string, string>>({});
  const [picks, setPicks] = useState<Record<string, 'approved' | 'rejected'>>({});
  const [accounts, setAccounts] = useState<any>(null);
  const [payOpen, setPayOpen] = useState(false);
  const [pay, setPay] = useState({ method: 'bank_transfer', reference: '' });
  const [busy, setBusy] = useState(false);
  const submitter = extra?.submitter;
  const canDecide = extra?.canDecide;
  const { user } = useAuth();
  const own = claim && claim.submittedById === user?.id;
  const approver = !!user?.modules?.includes('expense_approvals') || user?.role === 'super_admin';

  useEffect(() => { if (claim && canDecide) setPicks(Object.fromEntries(claim.items.filter((i: any) => i.decision === 'pending').map((i: any) => [i._id, 'approved']))); }, [claim, canDecide]);

  async function act<T>(fn: () => Promise<T>, ok: string) {
    setBusy(true);
    try { await fn(); showSuccess(ok); await reload(); onChanged(); } catch (err) { showError(apiErrorMessage(err)); } finally { setBusy(false); }
  }

  async function decide() {
    const decisions = Object.entries(picks).map(([itemId, decision]) => ({ itemId, decision, note: notes[itemId] }));
    if (decisions.some((d) => d.decision === 'rejected' && !d.note?.trim())) { showError('Give a reason for every rejected item.'); return; }
    await act(() => api.post(`/expenses/${id}/decision`, { decisions }), 'Decision recorded.');
  }

  async function reveal() {
    try {
      const res = await api.post(`/expenses/${id}/reveal-account`);
      setAccounts(res.data.data);
    } catch (err) { showError(apiErrorMessage(err)); }
  }

  return (
    <Modal open onClose={onClose} title={claim ? `${claim.claimNo} · ${claim.title}` : 'Expense claim'} size="xwide"
      footer={claim && (
        <>
          {own && ['draft', 'rejected'].includes(claim.status) && <button className="btn btn-ghost" onClick={() => navigate(`/expenses/${id}/edit`)}><Pencil size={14} /> Edit{claim.status === 'rejected' ? ' & resubmit' : ''}</button>}
          {own && claim.status === 'draft' && <button className="btn btn-primary" disabled={busy} onClick={() => act(() => api.post(`/expenses/${id}/submit`), 'Submitted.')}>Submit</button>}
          {own && ['draft', 'submitted'].includes(claim.status) && <button className="btn btn-danger" disabled={busy} onClick={async () => { if (await confirm({ title: 'Cancel claim?', message: 'This cannot be undone.', danger: true, confirmLabel: 'Cancel claim' })) act(() => api.post(`/expenses/${id}/cancel`), 'Cancelled.'); }}><Ban size={14} /> Cancel claim</button>}
          {canDecide && <button className="btn btn-primary" disabled={busy} onClick={decide}><CheckCircle2 size={15} /> Record decision</button>}
          {approver && !own && claim.status === 'approved' && <button className="btn btn-primary" onClick={() => setPayOpen(true)}><Banknote size={15} /> Mark as paid</button>}
        </>
      )}>
      {loading && !claim ? <Loading /> : error ? <ErrorNote message={error} /> : claim && (
        <div style={{ display: 'grid', gap: 18 }}>
          <div className="grid-2">
            <Kv rows={[
              ['Status', <Badge tone={statusTone(claim.status)}>{label(claim.status)}</Badge>],
              ['Submitted by', claim.submittedByName],
              ['Role', [submitter?.jobTitle, submitter?.department].filter(Boolean).join(' · ') || '—'],
              ['Contact', [submitter?.email, submitter?.phone].filter(Boolean).join(' · ') || '—'],
              ['Submitted', fdatetime(claim.submittedAt)],
              ['Purpose', claim.purpose || '—'],
            ]} />
            <Kv rows={[
              ['Total', <strong>{money(claim.totals.total, claim.currency)}</strong>],
              ['Company paid', money(claim.totals.companyPaid, claim.currency)],
              ['Paid personally', money(claim.totals.reimbursable, claim.currency)],
              ['Awaiting disbursement', money(claim.totals.toDisburse, claim.currency)],
              ['VAT / WHT', `${money(claim.totals.vat, claim.currency)} / ${money(claim.totals.wht, claim.currency)}`],
              ['Payable (net of WHT)', <strong>{money(claim.totals.payable, claim.currency)}</strong>],
            ]} />
          </div>

          {claim.totals.toDisburse > 0 && <div className="banner warn"><HandCoinsIcon /> <span><strong>Awaiting company to disburse</strong> — {money(claim.totals.toDisburse, claim.currency)} must be released to {claim.submittedByName} / the payees below.</span></div>}
          {claim.totals.reimbursable > 0 && <div className="banner"><Wallet size={16} /> <span><strong>Paid personally</strong> — {money(claim.totals.reimbursable, claim.currency)} to be reimbursed once approved.</span></div>}

          {(claim.totals.reimbursable > 0 || claim.totals.toDisburse > 0) && (approver || own) && (
            <div className="card" style={{ display: 'grid', gap: 8 }}>
              <div className="flex-between"><strong style={{ fontSize: 14 }}>Account information</strong>
                {!accounts && <button className="btn btn-ghost btn-sm" onClick={reveal}><ShieldAlert size={14} /> Reveal account numbers (audited)</button>}</div>
              <div style={{ fontSize: 13 }}>
                <div><strong>{claim.submittedByName}</strong>: {submitter?.bankAccount?.bankName ? `${submitter.bankAccount.bankName} · ${submitter.bankAccount.accountName || ''} · ••••${submitter.bankAccount.accountLast4}` : <span className="text-muted">No account on the employee profile — ask them to add one.</span>}</div>
                {accounts?.employee && <div className="mono" style={{ marginTop: 4 }}>Full number: {accounts.employee.accountNumber}</div>}
                {claim.items.filter((i: any) => i.boughtBy?.kind === 'other' && i.paymentMode !== 'company_paid').map((i: any) => (
                  <div key={i._id} style={{ marginTop: 6 }}><strong>{i.boughtBy.name}</strong> (external): {i.payee?.bankName || '—'} · {i.payee?.accountName || '—'} · {i.payee?.accountLast4 ? `••••${i.payee.accountLast4}` : 'no account'}
                    {accounts?.external?.find((x: any) => x.itemId === i._id) && <span className="mono"> — {accounts.external.find((x: any) => x.itemId === i._id).accountNumber}</span>}</div>
                ))}
              </div>
            </div>
          )}

          <div className="table-wrap">
            <table className="data-table" style={{ cursor: 'default' }}>
              <thead><tr><th>#</th><th>Category / item</th><th>Bought / done by</th><th>Payment</th><th>Amount</th><th>Receipts</th>{canDecide && <th style={{ minWidth: 210 }}>Decision</th>}{!canDecide && <th>Decision</th>}</tr></thead>
              <tbody>
                {claim.items.map((it: any, idx: number) => (
                  <tr key={it._id} style={{ cursor: 'default' }}>
                    <td>{idx + 1}</td>
                    <td><div style={{ fontWeight: 600 }}>{it.category}</div><div className="text-muted" style={{ fontSize: 12.5 }}>{it.description}{it.vendor ? ` · ${it.vendor}` : ''} · {fdate(it.date)}</div>
                      {(it.flags || []).map((f: string) => <Badge key={f} tone="danger">{FLAG[f] || f}</Badge>)}</td>
                    <td>{it.boughtBy?.name}{it.boughtBy?.kind === 'other' && <div className="text-muted" style={{ fontSize: 11.5 }}>external{it.boughtBy.contact ? ` · ${it.boughtBy.contact}` : ''}</div>}</td>
                    <td><Badge tone={MODE_TONE[it.paymentMode]}>{MODE_LABEL[it.paymentMode]}</Badge></td>
                    <td>{money(it.amount + (it.tax?.vatAmount || 0), claim.currency)}{(it.tax?.vatAmount > 0 || it.tax?.whtAmount > 0) && <div className="text-muted" style={{ fontSize: 11.5 }}>VAT {money(it.tax.vatAmount, claim.currency)} · WHT {money(it.tax.whtAmount, claim.currency)}</div>}</td>
                    <td><AttachmentList items={it.attachments} /></td>
                    <td>
                      {canDecide && it.decision === 'pending' ? (
                        <div style={{ display: 'grid', gap: 6 }}>
                          <div className="seg"><button type="button" className={picks[it._id] === 'approved' ? 'on' : ''} onClick={() => setPicks((p) => ({ ...p, [it._id]: 'approved' }))}><CheckCircle2 size={12} /> Approve</button><button type="button" className={picks[it._id] === 'rejected' ? 'on' : ''} onClick={() => setPicks((p) => ({ ...p, [it._id]: 'rejected' }))}><XCircle size={12} /> Reject</button></div>
                          {picks[it._id] === 'rejected' && <input className="input" placeholder="Reason (required)" value={notes[it._id] || ''} onChange={(e) => setNotes((n) => ({ ...n, [it._id]: e.target.value }))} />}
                        </div>
                      ) : <><Badge tone={statusTone(it.decision)}>{label(it.decision)}</Badge>{it.decisionNote && <div className="text-muted" style={{ fontSize: 11.5 }}>{it.decisionNote}</div>}</>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {claim.attachments?.length > 0 && <div><strong style={{ fontSize: 13 }}>Claim documents</strong><div style={{ marginTop: 6 }}><AttachmentList items={claim.attachments} /></div></div>}
          {claim.settlement?.paidAt && <div className="banner ok"><CheckCircle2 size={16} /> Paid {fdate(claim.settlement.paidAt)} by {label(claim.settlement.method)}{claim.settlement.reference ? ` · ref ${claim.settlement.reference}` : ''}</div>}
          <details><summary style={{ cursor: 'pointer', fontSize: 13, fontWeight: 600 }}>History</summary>
            <ul style={{ fontSize: 12.5, color: 'var(--muted)', paddingLeft: 18 }}>{[...claim.history].reverse().map((h: any, i: number) => <li key={i}>{fdatetime(h.at)} — {h.byName || 'system'}: {label(h.action)}{h.note ? ` (${h.note})` : ''}</li>)}</ul></details>
          <RecordPanel entityType="expense" entityId={id} doc={claim} kinds={['receipt', 'invoice', 'other']} />
        </div>
      )}
      <Modal open={payOpen} onClose={() => setPayOpen(false)} title="Mark as paid" footer={<><button className="btn btn-ghost" onClick={() => setPayOpen(false)}>Cancel</button><button className="btn btn-primary" disabled={busy} onClick={async () => { await act(() => api.post(`/expenses/${id}/pay`, pay), 'Marked as paid.'); setPayOpen(false); }}>Confirm payment</button></>}>
        <div className="field"><label>Method</label><select className="input" value={pay.method} onChange={(e) => setPay({ ...pay, method: e.target.value })}>{['bank_transfer', 'cash', 'payroll', 'other'].map((m) => <option key={m} value={m}>{label(m)}</option>)}</select></div>
        <div className="field"><label>Payment reference</label><input className="input" value={pay.reference} onChange={(e) => setPay({ ...pay, reference: e.target.value })} /></div>
        {claim && <p className="text-muted" style={{ fontSize: 12.5 }}>Records settlement of {money(claim.totals.payable, claim.currency)} and posts the input VAT / WHT entries to the tax records.</p>}
      </Modal>
    </Modal>
  );
}

function HandCoinsIcon() { return <Banknote size={16} />; }
