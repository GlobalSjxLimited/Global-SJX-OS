import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { Plus, Trash2, Copy, Send, Save, ArrowLeft, Layers, UserRound, Wallet, HandCoins, Building2 } from 'lucide-react';
import { api, apiErrorMessage } from '@/lib/api';
import { useAuth } from '@/context/AuthContext';
import { useToast } from '@/context/ToastContext';
import { useConfirm } from '@/context/ConfirmContext';
import { PageHead, Loading } from '@/components/ui/PageHead';
import { FileAttach, Attachment } from '@/components/ui/FileAttach';
import { money, toInputDate, SYMBOL } from '@/lib/format';

type Mode = 'company_paid' | 'paid_personally' | 'awaiting_disbursement';
interface Item {
  key: string;
  _id?: string;
  description: string; vendor: string; date: string;
  quantity: string; unitAmount: string; amount: string;
  boughtBy: { kind: 'employee' | 'other'; employeeId: string; name: string; contact: string };
  paymentMode: Mode;
  payee: { bankName: string; accountName: string; accountNumber: string; existing?: boolean };
  tax: { vatEnabled: boolean; vatRate: string; whtEnabled: boolean; whtRate: string; payeeCompany: string };
  notes: string;
  attachments: Attachment[];
}
interface Section { key: string; category: string; items: Item[] }

const uid = () => Math.random().toString(36).slice(2, 10);
const MODES: Array<{ key: Mode; label: string; hint: string; icon: JSX.Element }> = [
  { key: 'company_paid', label: 'Company paid', hint: 'Already paid from company funds', icon: <Building2 size={14} /> },
  { key: 'paid_personally', label: 'I paid for this personally', hint: 'Reimburse the person who paid', icon: <Wallet size={14} /> },
  { key: 'awaiting_disbursement', label: 'Awaiting company to disburse', hint: 'Company must release the money', icon: <HandCoins size={14} /> },
];

function blankItem(meId: string, template?: Partial<Item>): Item {
  return {
    key: uid(), description: '', vendor: '', date: toInputDate(new Date()), quantity: '1', unitAmount: '', amount: '',
    boughtBy: template?.boughtBy ? { ...template.boughtBy } : { kind: 'employee', employeeId: meId, name: '', contact: '' },
    paymentMode: template?.paymentMode || 'paid_personally',
    payee: template?.payee ? { ...template.payee } : { bankName: '', accountName: '', accountNumber: '' },
    tax: { vatEnabled: false, vatRate: '7.5', whtEnabled: false, whtRate: '5', payeeCompany: '' },
    notes: '', attachments: [],
  };
}

function lineNet(it: Item) {
  const direct = parseFloat(it.amount);
  if (it.amount !== '' && Number.isFinite(direct)) return direct;
  const q = parseFloat(it.quantity) || 1, u = parseFloat(it.unitAmount) || 0;
  return q * u;
}
const vatOf = (it: Item) => (it.tax.vatEnabled ? (lineNet(it) * (parseFloat(it.tax.vatRate) || 0)) / 100 : 0);
const whtOf = (it: Item) => (it.tax.whtEnabled ? (lineNet(it) * (parseFloat(it.tax.whtRate) || 0)) / 100 : 0);
const grossOf = (it: Item) => lineNet(it) + vatOf(it);

export function ExpenseForm() {
  const { id } = useParams();
  const [search] = useSearchParams();
  const invoiceParam = search.get('invoice');
  /** When this claim was started from an invoice: the invoice it is for. */
  const [invoice, setInvoice] = useState<{ _id: string; invoiceNo: string; client?: string } | null>(null);
  const { user } = useAuth();
  const navigate = useNavigate();
  const { showError, showSuccess } = useToast();
  const confirm = useConfirm();
  const [meta, setMeta] = useState<{ categories: string[]; receiptRequiredAbove: number } | null>(null);
  const [people, setPeople] = useState<Array<{ _id: string; name: string; jobTitle?: string }>>([]);
  const [title, setTitle] = useState('');
  const [purpose, setPurpose] = useState('');
  const [currency, setCurrency] = useState('NGN');
  const [claimAttachments, setClaimAttachments] = useState<Attachment[]>([]);
  const [sections, setSections] = useState<Section[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [errors, setErrors] = useState<string[]>([]);
  const me = user?.id || '';

  useEffect(() => {
    (async () => {
      try {
        const [m, p] = await Promise.all([api.get('/expenses/meta'), api.get('/employees/directory/list')]);
        setMeta(m.data.data); setPeople(p.data.data);
        if (id) {
          const res = await api.get(`/expenses/${id}`);
          const c = res.data.data;
          setTitle(c.title); setPurpose(c.purpose || ''); setCurrency(c.currency); setClaimAttachments(c.attachments || []);
          const map = new Map<string, Section>();
          for (const it of c.items) {
            const sec: Section = map.get(it.category) || { key: uid(), category: it.category, items: [] as Section['items'] };
            sec.items.push({
              key: uid(), _id: it._id, description: it.description, vendor: it.vendor || '', date: toInputDate(it.date), quantity: String(it.quantity ?? 1), unitAmount: it.unitAmount ? String(it.unitAmount) : '', amount: String(it.amount),
              boughtBy: { kind: it.boughtBy?.kind || 'employee', employeeId: it.boughtBy?.employeeId || me, name: it.boughtBy?.kind === 'other' ? it.boughtBy?.name || '' : '', contact: it.boughtBy?.contact || '' },
              paymentMode: it.paymentMode,
              payee: { bankName: it.payee?.bankName || '', accountName: it.payee?.accountName || '', accountNumber: '', existing: !!it.payee?.accountLast4 },
              tax: { vatEnabled: !!it.tax?.vatEnabled, vatRate: String(it.tax?.vatRate || 7.5), whtEnabled: !!it.tax?.whtEnabled, whtRate: String(it.tax?.whtRate || 5), payeeCompany: it.tax?.payeeCompany || '' },
              notes: it.notes || '', attachments: it.attachments || [],
            });
            map.set(it.category, sec);
          }
          setSections([...map.values()]);
        } else {
          setSections([{ key: uid(), category: m.data.data.categories[0], items: [blankItem(me)] }]);
          if (invoiceParam) {
            try {
              const inv = await api.get(`/invoices/${invoiceParam}`);
              const i = inv.data.data;
              setInvoice({ _id: i._id, invoiceNo: i.invoiceNo, client: inv.data.client?.name });
              setTitle(`Costs for invoice ${i.invoiceNo}${inv.data.client?.name ? ` — ${inv.data.client.name}` : ''}`);
              setPurpose(`Expenses incurred delivering invoice ${i.invoiceNo}.`);
            } catch { /* the invoice link is optional; the claim can still be written */ }
          }
        }
      } catch (err) { showError(apiErrorMessage(err)); } finally { setLoading(false); }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  const flat = useMemo(() => sections.flatMap((s) => s.items.map((it) => ({ ...it, category: s.category }))), [sections]);
  const totals = useMemo(() => {
    const t = { total: 0, company: 0, personal: 0, awaiting: 0, wht: 0, vat: 0 };
    for (const it of flat) {
      const g = grossOf(it); t.total += g; t.vat += vatOf(it); t.wht += whtOf(it);
      if (it.paymentMode === 'company_paid') t.company += g; else if (it.paymentMode === 'paid_personally') t.personal += g; else t.awaiting += g;
    }
    return t;
  }, [flat]);
  const byCategory = useMemo(() => {
    const m = new Map<string, { n: number; total: number }>();
    for (const it of flat) { const c = m.get(it.category) || { n: 0, total: 0 }; c.n++; c.total += grossOf(it); m.set(it.category, c); }
    return [...m.entries()];
  }, [flat]);

  const patchItem = (sk: string, ik: string, patch: (i: Item) => Item) => setSections((ss) => ss.map((s) => (s.key === sk ? { ...s, items: s.items.map((i) => (i.key === ik ? patch(i) : i)) } : s)));
  const patchSection = (sk: string, patch: Partial<Section>) => setSections((ss) => ss.map((s) => (s.key === sk ? { ...s, ...patch } : s)));
  const addSection = () => setSections((ss) => [...ss, { key: uid(), category: meta!.categories.find((c) => !ss.some((s) => s.category === c)) || meta!.categories[0], items: [blankItem(me, ss.at(-1)?.items.at(-1))] }]);
  const addItem = (sk: string) => setSections((ss) => ss.map((s) => (s.key === sk ? { ...s, items: [...s.items, blankItem(me, s.items.at(-1))] } : s)));
  const dupItem = (sk: string, it: Item) => setSections((ss) => ss.map((s) => (s.key === sk ? { ...s, items: [...s.items, { ...it, key: uid(), _id: undefined, attachments: [] }] } : s)));
  const removeItem = (sk: string, ik: string) => setSections((ss) => ss.map((s) => (s.key === sk ? { ...s, items: s.items.filter((i) => i.key !== ik) } : s)).filter((s) => s.items.length > 0));

  function validate(): string[] {
    const out: string[] = [];
    if (!title.trim()) out.push('Give the claim a title.');
    let n = 0;
    for (const s of sections) for (const it of s.items) {
      n++;
      const label = `Item ${n} (${s.category})`;
      if (!it.description.trim()) out.push(`${label}: add a description.`);
      if (!(lineNet(it) > 0)) out.push(`${label}: enter an amount.`);
      if (!it.date) out.push(`${label}: pick the date.`);
      if (it.boughtBy.kind === 'other' && !it.boughtBy.name.trim()) out.push(`${label}: write the name of who bought it.`);
      if (it.paymentMode !== 'company_paid' && it.boughtBy.kind === 'other' && !it.payee.existing && !it.payee.accountNumber.trim()) out.push(`${label}: add the account to pay (${it.boughtBy.name || 'external person'}).`);
      if (it.attachments.length === 0 && lineNet(it) >= (meta?.receiptRequiredAbove || 5000) && currency === 'NGN') out.push(`${label}: no receipt attached (required above ${money(meta?.receiptRequiredAbove, 'NGN')}). You can still submit — the approver will see a flag.`);
    }
    return out;
  }

  function payload(submit: boolean) {
    return {
      title, purpose, currency, attachments: claimAttachments, submit, ...(invoice && !id ? { invoiceId: invoice._id } : {}),
      items: sections.flatMap((s) => s.items.map((it) => ({
        _id: it._id, category: s.category, description: it.description, vendor: it.vendor, date: it.date,
        quantity: parseFloat(it.quantity) || 1, unitAmount: parseFloat(it.unitAmount) || 0, amount: lineNet(it),
        boughtBy: it.boughtBy.kind === 'employee' ? { kind: 'employee', employeeId: it.boughtBy.employeeId || me } : { kind: 'other', name: it.boughtBy.name, contact: it.boughtBy.contact },
        paymentMode: it.paymentMode,
        payee: it.boughtBy.kind === 'other' && it.paymentMode !== 'company_paid' ? { bankName: it.payee.bankName, accountName: it.payee.accountName, accountNumber: it.payee.accountNumber } : undefined,
        tax: { vatEnabled: it.tax.vatEnabled, vatRate: parseFloat(it.tax.vatRate) || 0, whtEnabled: it.tax.whtEnabled, whtRate: parseFloat(it.tax.whtRate) || 0, payeeCompany: it.tax.payeeCompany },
        notes: it.notes, attachments: it.attachments,
      }))),
    };
  }

  async function save(submit: boolean) {
    const problems = validate();
    const blocking = problems.filter((p) => !p.includes('You can still submit'));
    setErrors(problems);
    if (blocking.length) { window.scrollTo({ top: 0, behavior: 'smooth' }); return; }
    if (submit) {
      const ok = await confirm({ title: 'Submit for approval?', message: `This sends ${flat.length} item(s) totalling ${money(totals.total, currency)} to the approvers by email${totals.awaiting ? ', including your request for the company to disburse funds' : ''}.`, confirmLabel: 'Submit' });
      if (!ok) return;
    }
    setSaving(true);
    try {
      if (id) await api.put(`/expenses/${id}`, payload(submit)); else await api.post('/expenses', payload(submit));
      showSuccess(submit ? 'Expense claim submitted — approvers have been notified.' : 'Draft saved.');
      navigate(invoice ? `/invoices?invoice=${invoice._id}` : '/expenses');
    } catch (err) { showError(apiErrorMessage(err)); } finally { setSaving(false); }
  }

  if (loading || !meta) return <Loading />;

  return (
    <div className="page-enter">
      <PageHead
        title={id ? 'Edit expense claim' : 'New expense claim'}
        subtitle="Add as many items as you need — several in one category, or across different categories. Attach every receipt and photo."
        actions={<button className="btn btn-ghost" onClick={() => navigate(invoice ? `/invoices?invoice=${invoice._id}` : '/expenses')}><ArrowLeft size={15} /> {invoice ? 'Skip — back to the invoice' : 'Back'}</button>}
      />
      {invoice && <div className="banner" style={{ marginBottom: 16 }}>This expense will be linked to invoice <strong>{invoice.invoiceNo}</strong>{invoice.client ? ` for ${invoice.client}` : ''}. Nothing to add? <Link to={`/invoices?invoice=${invoice._id}`}>Skip and go back to the invoice</Link>.</div>}
      {errors.length > 0 && (
        <div className="banner warn" style={{ marginBottom: 16 }} role="alert">
          <ul style={{ margin: 0, paddingLeft: 18 }}>{errors.map((e) => <li key={e}>{e}</li>)}</ul>
        </div>
      )}
      <div className="two-col">
        <div style={{ display: 'grid', gap: 18 }}>
          <div className="card" style={{ display: 'grid', gap: 14 }}>
            <div className="form-grid">
              <div className="field full"><label>Claim title *</label><input className="input" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="e.g. Client workshop — Abuja, Oct 2026" maxLength={160} /></div>
              <div className="field"><label>Currency</label>
                <select className="input" value={currency} onChange={(e) => setCurrency(e.target.value)}>{['NGN', 'USD', 'GBP', 'EUR'].map((c) => <option key={c} value={c}>{c} {SYMBOL[c]}</option>)}</select>
              </div>
              <div className="field"><label>Claim-level documents (optional)</label><FileAttach value={claimAttachments} onChange={setClaimAttachments} label="Add statement / approval" /></div>
              <div className="field full"><label>Purpose / business reason</label><textarea className="input" rows={2} value={purpose} onChange={(e) => setPurpose(e.target.value)} maxLength={1000} /></div>
            </div>
          </div>

          {sections.map((sec, si) => {
            const secTotal = sec.items.reduce((s, i) => s + grossOf(i), 0);
            return (
              <div key={sec.key} className="section-card">
                <div className="flex-between" style={{ flexWrap: 'wrap' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
                    <Layers size={17} style={{ color: 'var(--accent)' }} />
                    <select className="input" style={{ width: 'auto', fontWeight: 600 }} value={sec.category} onChange={(e) => patchSection(sec.key, { category: e.target.value })} aria-label="Category">
                      {meta.categories.map((c) => <option key={c}>{c}</option>)}
                    </select>
                    <span className="text-muted" style={{ fontSize: 12.5 }}>{sec.items.length} item{sec.items.length > 1 ? 's' : ''} · {money(secTotal, currency)}</span>
                  </div>
                  {sections.length > 1 && (
                    <button type="button" className="btn btn-danger btn-sm" onClick={() => setSections((ss) => ss.filter((s) => s.key !== sec.key))}><Trash2 size={13} /> Remove category</button>
                  )}
                </div>

                {sec.items.map((it, ii) => {
                  const net = lineNet(it);
                  return (
                    <div key={it.key} className="item-card">
                      <div className="flex-between"><strong style={{ fontSize: 13.5 }}>Item {ii + 1}</strong>
                        <div className="row-actions">
                          <button type="button" className="btn btn-ghost btn-sm" onClick={() => dupItem(sec.key, it)} title="Copy this item (without receipts)"><Copy size={13} /> Duplicate</button>
                          <button type="button" className="btn btn-danger btn-sm" onClick={() => removeItem(sec.key, it.key)} aria-label="Remove item"><Trash2 size={13} /></button>
                        </div>
                      </div>

                      <div className="form-grid">
                        <div className="field full"><label>What was bought / done? *</label><input className="input" value={it.description} onChange={(e) => patchItem(sec.key, it.key, (x) => ({ ...x, description: e.target.value }))} maxLength={300} /></div>
                        <div className="field"><label>Vendor / shop</label><input className="input" value={it.vendor} onChange={(e) => patchItem(sec.key, it.key, (x) => ({ ...x, vendor: e.target.value }))} /></div>
                        <div className="field"><label>Date *</label><input className="input" type="date" max={toInputDate(new Date())} value={it.date} onChange={(e) => patchItem(sec.key, it.key, (x) => ({ ...x, date: e.target.value }))} /></div>
                        <div className="field"><label>Quantity</label><input className="input" type="number" min="0" step="any" value={it.quantity} onChange={(e) => patchItem(sec.key, it.key, (x) => ({ ...x, quantity: e.target.value, amount: '' }))} /></div>
                        <div className="field"><label>Unit price</label><input className="input" type="number" min="0" step="any" value={it.unitAmount} onChange={(e) => patchItem(sec.key, it.key, (x) => ({ ...x, unitAmount: e.target.value, amount: '' }))} /></div>
                        <div className="field full">
                          {(() => {
                            // A total worked out from quantity × unit price is a result, not an input — it can't be typed over.
                            const computed = it.amount === '' && (parseFloat(it.unitAmount) || 0) > 0;
                            return (<>
                              <label>Amount (before VAT) *{computed ? ' — calculated' : ''}</label>
                              <input className="input" type="number" min="0" step="any" readOnly={computed} aria-readonly={computed} tabIndex={computed ? -1 : undefined}
                                style={computed ? { background: 'var(--surface-2)', color: 'var(--muted)', cursor: 'not-allowed' } : undefined}
                                value={it.amount !== '' ? it.amount : net ? String(Math.round(net * 100) / 100) : ''}
                                onChange={(e) => patchItem(sec.key, it.key, (x) => ({ ...x, amount: e.target.value }))}
                                placeholder="Or enter the total directly" />
                              {computed && <small className="text-muted">Worked out from quantity × unit price. To type a total yourself, clear the unit price.</small>}
                            </>);
                          })()}
                        </div>
                      </div>

                      <div className="field">
                        <label>Bought by / done by</label>
                        <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'center' }}>
                          <div className="seg" role="radiogroup" aria-label="Bought by">
                            <button type="button" className={it.boughtBy.kind === 'employee' ? 'on' : ''} onClick={() => patchItem(sec.key, it.key, (x) => ({ ...x, boughtBy: { ...x.boughtBy, kind: 'employee' } }))}><UserRound size={12} /> Employee</button>
                            <button type="button" className={it.boughtBy.kind === 'other' ? 'on' : ''} onClick={() => patchItem(sec.key, it.key, (x) => ({ ...x, boughtBy: { ...x.boughtBy, kind: 'other' } }))}>Other</button>
                          </div>
                          {it.boughtBy.kind === 'employee' ? (
                            <select className="input" style={{ flex: 1, minWidth: 200 }} value={it.boughtBy.employeeId || me} onChange={(e) => patchItem(sec.key, it.key, (x) => ({ ...x, boughtBy: { ...x.boughtBy, employeeId: e.target.value } }))}>
                              {people.map((p) => <option key={p._id} value={p._id}>{p.name}{p._id === me ? ' (me)' : ''}{p.jobTitle ? ` — ${p.jobTitle}` : ''}</option>)}
                            </select>
                          ) : (
                            <>
                              <input className="input" style={{ flex: 1, minWidth: 160 }} placeholder="Write their name *" value={it.boughtBy.name} onChange={(e) => patchItem(sec.key, it.key, (x) => ({ ...x, boughtBy: { ...x.boughtBy, name: e.target.value } }))} />
                              <input className="input" style={{ flex: 1, minWidth: 160 }} placeholder="Phone / email (optional)" value={it.boughtBy.contact} onChange={(e) => patchItem(sec.key, it.key, (x) => ({ ...x, boughtBy: { ...x.boughtBy, contact: e.target.value } }))} />
                            </>
                          )}
                        </div>
                      </div>

                      <div className="field">
                        <label>How was it paid?</label>
                        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(210px, 1fr))', gap: 8 }}>
                          {MODES.map((m) => (
                            <label key={m.key} className="card" style={{ padding: 10, cursor: 'pointer', borderColor: it.paymentMode === m.key ? 'var(--accent)' : undefined, background: it.paymentMode === m.key ? 'var(--accent-soft)' : undefined, display: 'flex', gap: 8, alignItems: 'flex-start' }}>
                              <input type="radio" name={`pm-${it.key}`} checked={it.paymentMode === m.key} onChange={() => patchItem(sec.key, it.key, (x) => ({ ...x, paymentMode: m.key }))} style={{ marginTop: 3 }} />
                              <span><span style={{ fontWeight: 600, fontSize: 13, display: 'flex', alignItems: 'center', gap: 5 }}>{m.icon}{m.label}</span><span className="text-muted" style={{ fontSize: 11.5 }}>{m.hint}</span></span>
                            </label>
                          ))}
                        </div>
                      </div>

                      {it.paymentMode !== 'company_paid' && it.boughtBy.kind === 'other' && (
                        <div className="banner">
                          <div style={{ flex: 1, display: 'grid', gap: 10 }}>
                            <strong style={{ fontSize: 13 }}>Account to pay {it.boughtBy.name || 'this person'}</strong>
                            {it.payee.existing && !it.payee.accountNumber && <span className="text-muted" style={{ fontSize: 12 }}>An account is already saved (encrypted). Leave blank to keep it, or type a new number to replace it.</span>}
                            <div className="form-grid cols-3">
                              <input className="input" placeholder="Bank name" value={it.payee.bankName} onChange={(e) => patchItem(sec.key, it.key, (x) => ({ ...x, payee: { ...x.payee, bankName: e.target.value } }))} />
                              <input className="input" placeholder="Account name" value={it.payee.accountName} onChange={(e) => patchItem(sec.key, it.key, (x) => ({ ...x, payee: { ...x.payee, accountName: e.target.value } }))} />
                              <input className="input" placeholder="Account number" inputMode="numeric" autoComplete="off" value={it.payee.accountNumber} onChange={(e) => patchItem(sec.key, it.key, (x) => ({ ...x, payee: { ...x.payee, accountNumber: e.target.value } }))} />
                            </div>
                          </div>
                        </div>
                      )}
                      {it.paymentMode !== 'company_paid' && it.boughtBy.kind === 'employee' && (
                        <div className="text-muted" style={{ fontSize: 12 }}>Payment goes to the employee’s account on their profile — finance will see it in the approval email.</div>
                      )}

                      <details>
                        <summary style={{ cursor: 'pointer', fontSize: 13, fontWeight: 600, color: 'var(--muted)' }}>VAT / withholding tax {(it.tax.vatEnabled || it.tax.whtEnabled) && <span className="badge badge-accent" style={{ marginLeft: 6 }}>applied</span>}</summary>
                        <div className="form-grid" style={{ marginTop: 12 }}>
                          <label style={{ display: 'flex', gap: 8, alignItems: 'center', fontSize: 13 }}><input type="checkbox" checked={it.tax.vatEnabled} onChange={(e) => patchItem(sec.key, it.key, (x) => ({ ...x, tax: { ...x.tax, vatEnabled: e.target.checked } }))} /> VAT charged
                            <input className="input" style={{ width: 80 }} type="number" step="any" disabled={!it.tax.vatEnabled} value={it.tax.vatRate} onChange={(e) => patchItem(sec.key, it.key, (x) => ({ ...x, tax: { ...x.tax, vatRate: e.target.value } }))} /> %</label>
                          <label style={{ display: 'flex', gap: 8, alignItems: 'center', fontSize: 13 }}><input type="checkbox" checked={it.tax.whtEnabled} onChange={(e) => patchItem(sec.key, it.key, (x) => ({ ...x, tax: { ...x.tax, whtEnabled: e.target.checked } }))} /> Withhold WHT
                            <input className="input" style={{ width: 80 }} type="number" step="any" disabled={!it.tax.whtEnabled} value={it.tax.whtRate} onChange={(e) => patchItem(sec.key, it.key, (x) => ({ ...x, tax: { ...x.tax, whtRate: e.target.value } }))} /> %</label>
                          <div className="field full"><label>Payee company (for the tax record)</label><input className="input" value={it.tax.payeeCompany} onChange={(e) => patchItem(sec.key, it.key, (x) => ({ ...x, tax: { ...x.tax, payeeCompany: e.target.value } }))} /></div>
                        </div>
                        {(it.tax.vatEnabled || it.tax.whtEnabled) && <div className="text-muted" style={{ fontSize: 12, marginTop: 8 }}>VAT {money(vatOf(it), currency)} · WHT {money(whtOf(it), currency)} · Net payable {money(grossOf(it) - whtOf(it), currency)}</div>}
                      </details>

                      <div className="field"><label>Receipts & photos {net >= (meta.receiptRequiredAbove || 5000) && it.attachments.length === 0 && currency === 'NGN' && <span style={{ color: 'var(--danger)' }}> — required for this amount</span>}</label>
                        <FileAttach value={it.attachments} onChange={(v) => patchItem(sec.key, it.key, (x) => ({ ...x, attachments: v }))} />
                      </div>
                      <div className="field"><label>Notes</label><input className="input" value={it.notes} onChange={(e) => patchItem(sec.key, it.key, (x) => ({ ...x, notes: e.target.value }))} maxLength={1000} /></div>
                      <div style={{ textAlign: 'right', fontWeight: 600 }}>Line total {money(grossOf(it), currency)}</div>
                    </div>
                  );
                })}

                <button type="button" className="btn btn-ghost" onClick={() => addItem(sec.key)}><Plus size={15} /> Add another item to “{sec.category}”</button>
                {si === sections.length - 1 && null}
              </div>
            );
          })}

          <button type="button" className="btn btn-ghost" onClick={addSection} style={{ borderStyle: 'dashed' }}><Plus size={15} /> Add items in a different category</button>
        </div>

        <aside className="card sticky-summary" style={{ display: 'grid', gap: 14 }}>
          <h3 style={{ fontSize: 15 }}>Summary</h3>
          <div style={{ fontFamily: 'Fraunces, serif', fontSize: 28, fontWeight: 600 }}>{money(totals.total, currency)}</div>
          <div className="text-muted" style={{ fontSize: 12.5 }}>{flat.length} item{flat.length !== 1 ? 's' : ''} · {flat.reduce((s, i) => s + i.attachments.length, 0)} attachment(s)</div>
          <div style={{ display: 'grid', gap: 6, fontSize: 13 }}>
            {byCategory.map(([c, v]) => <div key={c} className="flex-between"><span>{c} <span className="text-muted">×{v.n}</span></span><span>{money(v.total, currency)}</span></div>)}
          </div>
          <hr style={{ border: 0, borderTop: '1px solid var(--line)', width: '100%' }} />
          <div style={{ display: 'grid', gap: 6, fontSize: 13 }}>
            <div className="flex-between"><span>Company paid</span><span>{money(totals.company, currency)}</span></div>
            <div className="flex-between"><span>Paid personally (reimburse)</span><span>{money(totals.personal, currency)}</span></div>
            <div className="flex-between"><span>Awaiting disbursement</span><span>{money(totals.awaiting, currency)}</span></div>
            {totals.vat > 0 && <div className="flex-between"><span>VAT included</span><span>{money(totals.vat, currency)}</span></div>}
            {totals.wht > 0 && <div className="flex-between"><span>WHT to withhold</span><span>−{money(totals.wht, currency)}</span></div>}
          </div>
          <div style={{ display: 'grid', gap: 8 }}>
            <button className="btn btn-primary" disabled={saving} onClick={() => save(true)}><Send size={15} /> {saving ? 'Saving…' : 'Submit for approval'}</button>
            <button className="btn btn-ghost" disabled={saving} onClick={() => save(false)}><Save size={15} /> Save as draft</button>
          </div>
          <p className="text-muted" style={{ fontSize: 11.5, margin: 0 }}>On submit, approvers receive an email with your details, the items, and the account information for any amount you paid personally or are awaiting.</p>
        </aside>
      </div>
    </div>
  );
}
