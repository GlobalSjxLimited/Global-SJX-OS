import { useEffect, useMemo, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { X, Plus, Calendar, Eye, ArrowLeft, Save, Loader2 } from 'lucide-react';
import { api, apiErrorMessage } from '@/lib/api';
import { useToast } from '@/context/ToastContext';
import { useApi } from '@/lib/useApi';
import { SYMBOL, toInputDate } from '@/lib/format';
import '@/styles/invoice-modal.css';

const WIRE_LABELS = ['PAY TO:', 'ROUTING & TRANSIT #:', 'SWIFT CODE:', 'FOR CREDIT OF:', 'FINAL CREDIT ACCOUNT #:'];
const blankItem = () => ({ description: '', quantity: '1', unitFee: '' });
const blankParty = (label = '', kind = 'local') => ({ label, amount: '', kind, wire: kind === 'wire' ? WIRE_LABELS.map((l) => ({ label: l, value: '' })) : [] });
const PRESETS: Record<string, string[]> = { 'Managed Services': ['AUTHENTICATION FEE', 'MONTHLY HOSTING FEE'] };
const n = (v: any) => (Number.isFinite(Number(v)) ? Number(v) : 0);
const dpFor = (c: string) => (c === 'NGN' ? 2 : 3);
const fmt = (v: number, c: string) => `${SYMBOL[c] || c}${v.toLocaleString('en-US', { minimumFractionDigits: dpFor(c), maximumFractionDigits: dpFor(c) })}`;
const longDate = (s?: string) => (s ? new Date(s).toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' }) : '');

function sectionsFrom(items: any[]) {
  const order: string[] = [], map = new Map<string, any[]>();
  for (const it of items || []) { const g = it.group || ''; if (!map.has(g)) { map.set(g, []); order.push(g); } map.get(g)!.push({ description: it.description, quantity: String(it.quantity), unitFee: String(it.unitFee) }); }
  return order.map((g) => ({ name: g.replace(/\s+FOR PERIOD:.*$/i, ''), items: map.get(g)! }));
}

interface Props { invoice: any | null; onClose: () => void; onSaved: (saved?: any, created?: boolean) => void }

/** Create / edit invoice — legacy modal layout: client & type → dates/currency/rate → sections A/B → summary → Preview → Create. */
export function InvoiceEditor({ invoice, onClose, onSaved }: Props) {
  const { showError, showSuccess } = useToast();
  const clients = useApi<any[]>('/clients', { limit: 200 });
  const banks = useApi<any[]>('/bank-accounts');
  const meta = useApi<any>('/invoices/meta');
  const services = useApi<any[]>('/rates/services');
  const today = toInputDate(new Date());
  const [f, setF] = useState<any>(() => invoice ? {
    clientId: invoice.clientId?._id || invoice.clientId, bankAccountId: invoice.bankAccountId, invoiceType: invoice.invoiceType || 'Other', templateType: invoice.templateType || 'standard', currency: invoice.currency,
    issueDate: toInputDate(invoice.issueDate), dueDate: toInputDate(invoice.dueDate), periodStart: toInputDate(invoice.periodStart), periodEnd: toInputDate(invoice.periodEnd), periodLabel: invoice.periodLabel || '',
    referenceNo: invoice.referenceNo || '', poNumber: invoice.poNumber || '', notes: invoice.notes || '', documentTitle: invoice.documentTitle || '',
    includeNaira: !!invoice.includeNaira, addVat: invoice.vatRate > 0, vatRate: String(invoice.vatRate || 7.5), whtRate: String(invoice.whtRate || 0),
    rateSource: invoice.rateSource === 'manual' ? 'manual' : 'database', rate: String(invoice.exchangeRate || ''), rateReason: invoice.rateOverrideReason || '', rateApplied: invoice.rateSource === 'manual',
  } : { clientId: '', bankAccountId: '', invoiceType: 'Managed Services', templateType: 'standard', currency: 'USD', issueDate: today, dueDate: '', periodStart: '', periodEnd: '', periodLabel: '', referenceNo: '', poNumber: '', notes: '', documentTitle: '', includeNaira: true, addVat: true, vatRate: '7.5', whtRate: '0', rateSource: 'database', rate: '', rateReason: '', rateApplied: false });
  const [sections, setSections] = useState<any[]>(() => (invoice ? sectionsFrom(invoice.items) : PRESETS['Managed Services'].map((name) => ({ name, items: [blankItem()] }))));
  const [parties, setParties] = useState<any[]>(() => (invoice?.splitAmounts?.length ? invoice.splitAmounts.map((s: any) => ({ label: s.label, amount: String(s.amount), kind: s.kind || 'local', wire: s.wire || [] })) : [blankParty('Wibmo Inc', 'wire'), blankParty('Global SJX Limited', 'local')]));
  const [preview, setPreview] = useState<any>(null);
  const [busy, setBusy] = useState(false);
  const set = (k: string, v: any) => setF((p: any) => ({ ...p, [k]: v }));
  const cur = f.currency;
  const dbRate = (meta.data?.rates || []).find((r: any) => r.currency === cur);
  const foreign = cur !== 'NGN';

  // default due date follows the issue date
  useEffect(() => { if (!invoice && f.issueDate && !f.dueDate && meta.data) { /* leave blank: server applies terms */ } }, [meta.data]); // eslint-disable-line

  function changeType(t: string) {
    set('invoiceType', t);
    const preset = PRESETS[t];
    const empty = sections.every((s) => s.items.every((i: any) => !i.description && !i.unitFee));
    if (empty) setSections((preset || ['']).map((name) => ({ name, items: [blankItem()] })));
  }
  const setItem = (si: number, ii: number, k: string, v: any) => setSections((p) => p.map((s, a) => (a !== si ? s : { ...s, items: s.items.map((it: any, b: number) => (b === ii ? { ...it, [k]: v } : it)) })));
  const totals = useMemo(() => {
    const r = (x: number) => { const m = Math.pow(10, dpFor(cur)); return Math.round((x + Number.EPSILON) * m) / m; };
    const subs = sections.map((s) => r(s.items.reduce((t: number, i: any) => t + r(n(i.quantity) * n(i.unitFee)), 0)));
    const sub = r(subs.reduce((a, b) => a + b, 0));
    const vat = f.addVat ? r((sub * n(f.vatRate)) / 100) : 0;
    const rate = f.rateSource === 'manual' ? n(f.rate) : dbRate?.rate || 0;
    return { subs, sub, vat, total: r(sub + vat), rate, ngn: foreign && rate ? Math.round((sub + vat) * rate * 100) / 100 : 0 };
  }, [sections, f.addVat, f.vatRate, f.rate, f.rateSource, dbRate, cur, foreign]);

  const periodText = f.periodStart && f.periodEnd ? `${longDate(f.periodStart)} – ${longDate(f.periodEnd)}` : '';
  function payload() {
    const items = sections.flatMap((s) => s.items.filter((i: any) => i.description.trim()).map((i: any) => ({ group: s.name.trim() ? `${s.name.trim().toUpperCase()}${periodText && !/PERIOD/i.test(s.name) ? ` FOR PERIOD: ${periodText}` : ''}` : undefined, description: i.description, quantity: n(i.quantity), unitFee: n(i.unitFee) })));
    return {
      ...f, items, vatRate: f.addVat ? n(f.vatRate) : 0, whtRate: n(f.whtRate), dueDate: f.dueDate || undefined, periodStart: f.periodStart || undefined, periodEnd: f.periodEnd || undefined, includeNaira: foreign && f.includeNaira,
      rateSource: foreign && f.rateSource === 'manual' ? 'manual' : 'database', exchangeRate: f.rateSource === 'manual' ? n(f.rate) : undefined, rateOverrideReason: f.rateReason, rateDate: f.rateSource === 'manual' ? today : undefined,
      splitAmounts: f.templateType === 'split' ? parties.filter((p) => p.label && n(p.amount) > 0).map((p) => ({ label: p.label, amount: n(p.amount), kind: p.kind, wire: p.kind === 'wire' ? p.wire.filter((w: any) => w.value) : [] })) : [],
    };
  }
  function validate(): string | null {
    if (!f.clientId) return 'Choose a client.';
    if (!f.bankAccountId) return 'Choose the bank account to pay into.';
    if (!sections.some((s) => s.items.some((i: any) => i.description.trim() && n(i.unitFee) >= 0 && i.unitFee !== ''))) return 'Add at least one item with a description and unit fee.';
    if (f.dueDate && f.dueDate < f.issueDate) return 'Due date cannot be before the issue date.';
    if (f.periodStart && f.periodEnd && f.periodEnd < f.periodStart) return 'Period end is before the period start.';
    if (foreign && f.rateSource === 'manual') { if (n(f.rate) <= 0) return 'Enter the exchange rate.'; if (!f.rateReason.trim()) return 'Say why you are using a manual rate (it is audited).'; }
    if (foreign && f.rateSource === 'database' && !dbRate) return `No ${cur} rate in the database — add one under Taxes → Rates or use a manual rate.`;
    if (f.templateType === 'split') { const sum = parties.reduce((t, p) => t + n(p.amount), 0); if (Math.abs(sum - totals.total) > 0.01) return `The split amounts (${sum.toFixed(3)}) must add up to the invoice total (${totals.total.toFixed(3)}).`; }
    return null;
  }
  async function doPreview(overrides: any = {}) {
    const bad = validate(); if (bad) return showError(bad);
    setBusy(true);
    try { const r = await api.post('/invoices/preview', { ...payload(), ...overrides, invoiceNo: invoice?.invoiceNo }); setPreview(r.data.data); }
    catch (e) { showError(apiErrorMessage(e)); } finally { setBusy(false); }
  }
  async function save() {
    const bad = validate(); if (bad) return showError(bad);
    setBusy(true);
    try { const res = invoice ? await api.put(`/invoices/${invoice._id}`, payload()) : await api.post('/invoices', payload()); showSuccess(invoice ? 'Invoice updated.' : 'Invoice created as a draft. Add any expenses for it next.'); onSaved(res.data?.data, !invoice); }
    catch (e) { showError(apiErrorMessage(e)); } finally { setBusy(false); }
  }
  const activeBanks = (banks.data || []).filter((b) => b.status === 'active');

  if (preview) return <PreviewModal data={preview} f={f} set={set} onBack={() => setPreview(null)} onRefresh={(o: any) => doPreview(o)} onCreate={save} busy={busy} editing={!!invoice} onClose={onClose} />;

  return (
    <Shell onClose={onClose} title={invoice ? `Edit ${invoice.invoiceNo}` : 'Create Invoice'} sub="Fill in the details, preview the invoice exactly as the client will see it, then save it as a draft for approval."
      foot={<><button className="im-btn ghost" onClick={onClose}>Cancel</button><button className="im-btn primary" disabled={busy} onClick={() => doPreview()}>{busy ? <Loader2 size={15} className="spin" /> : <Eye size={15} />} Preview Invoice</button></>}>
      <div className="im-card"><h4>Client & type</h4><div className="im-grid">
        <div className="im-field"><label>Client *</label><select className="input" value={f.clientId} onChange={(e) => set('clientId', e.target.value)}><option value="">Select a client…</option>{(clients.data || []).map((c) => <option key={c._id} value={c._id}>{c.name}</option>)}</select></div>
        <div className="im-field"><label>Invoice type</label><select className="input" value={f.invoiceType} onChange={(e) => changeType(e.target.value)}>{(meta.data?.types || ['Managed Services', 'Other']).map((t: string) => <option key={t}>{t}</option>)}</select></div>
        <div className="im-field"><label>Template</label><div className="im-toggle"><button type="button" className={f.templateType === 'standard' ? 'on' : ''} onClick={() => set('templateType', 'standard')}>Standard</button><button type="button" className={f.templateType === 'split' ? 'on' : ''} onClick={() => set('templateType', 'split')}>Split between parties</button></div></div>
        <div className="im-field"><label>Pay into *</label><select className="input" value={f.bankAccountId} onChange={(e) => set('bankAccountId', e.target.value)}><option value="">Select an account…</option>{activeBanks.map((b) => <option key={b._id} value={b._id}>{b.bankName} — {b.accountName} ••••{b.accountLast4}</option>)}</select></div>
        <div className="im-field"><label>Document title (optional)</label><input className="input" placeholder="e.g. AUTHENTICATION SERVICES INVOICE" value={f.documentTitle} onChange={(e) => set('documentTitle', e.target.value)} /></div>
        <div className="im-field"><label>Reference no. / PO</label><div style={{ display: 'flex', gap: 6 }}><input className="input" placeholder="Reference" value={f.referenceNo} onChange={(e) => set('referenceNo', e.target.value)} /><input className="input" placeholder="PO number" value={f.poNumber} onChange={(e) => set('poNumber', e.target.value)} /></div></div>
      </div></div>

      <div className="im-card"><h4>Dates, period & currency</h4><div className="im-grid">
        <div className="im-field"><label>Issue date</label><input className="input" type="date" value={f.issueDate} onChange={(e) => set('issueDate', e.target.value)} /></div>
        <div className="im-field"><label>Due date (blank = +{meta.data?.termsDays ?? 14} days)</label><input className="input" type="date" value={f.dueDate} onChange={(e) => set('dueDate', e.target.value)} /></div>
        <div className="im-field"><label>Period start</label><input className="input" type="date" value={f.periodStart} onChange={(e) => set('periodStart', e.target.value)} /></div>
        <div className="im-field"><label>Period end</label><input className="input" type="date" value={f.periodEnd} onChange={(e) => set('periodEnd', e.target.value)} /></div>
        <div className="im-field"><label>Currency</label><select className="input" value={f.currency} onChange={(e) => set('currency', e.target.value)}>{(meta.data?.currencies || ['NGN', 'USD', 'GBP', 'EUR']).map((c: string) => <option key={c}>{c}</option>)}</select></div>
      </div>
        {foreign && <div className="im-rate" style={{ marginTop: 12 }}>
          <div className="im-rate-row"><div className="im-toggle"><button type="button" className={f.rateSource === 'database' ? 'on' : ''} onClick={() => { set('rateSource', 'database'); set('rateApplied', false); }}>📊 Database Rate</button><button type="button" className={f.rateSource === 'manual' ? 'on' : ''} onClick={() => set('rateSource', 'manual')}>✏️ Manual Input</button></div>
            {f.rateSource === 'database' && (dbRate ? <span className="im-hint">CBN rate ₦{dbRate.rate.toLocaleString()} / {cur} (as at {new Date(dbRate.rateDate).toLocaleDateString('en-GB')})</span> : <span className="im-warn">No {cur} rate in the database yet.</span>)}</div>
          {f.rateSource === 'manual' && <div className="im-grid"><div className="im-field"><label>Rate (₦ per {cur})</label><input className="input" type="number" min={0} step="any" value={f.rate} onChange={(e) => { set('rate', e.target.value); set('rateApplied', false); }} /></div>
            <div className="im-field"><label>Reason for manual rate *</label><input className="input" placeholder="e.g. Rate agreed in contract" value={f.rateReason} onChange={(e) => set('rateReason', e.target.value)} /></div>
            <div className="im-field" style={{ alignSelf: 'end' }}><button type="button" className="im-btn primary" onClick={() => { if (n(f.rate) > 0 && f.rateReason.trim()) { set('rateApplied', true); showSuccess(`Manual rate ₦${n(f.rate).toLocaleString()} applied.`); } else showError('Enter the rate and the reason.'); }}>Apply</button></div></div>}
          {f.rateSource === 'manual' && <div className="im-hint">Manual rates are recorded in the audit log with your reason.</div>}
          <label className="im-check"><input type="checkbox" checked={f.includeNaira} onChange={(e) => set('includeNaira', e.target.checked)} /> Add NGN equivalent to the invoice</label>
        </div>}
      </div>

      <div className="im-card"><h4>Taxes</h4><div className="im-grid">
        <div><label className="im-check"><input type="checkbox" checked={f.addVat} onChange={(e) => set('addVat', e.target.checked)} /> Add Taxes (VAT)</label>{f.addVat && <div className="im-field"><label>VAT %</label><input className="input" type="number" min={0} max={100} step="any" value={f.vatRate} onChange={(e) => set('vatRate', e.target.value)} /></div>}</div>
        <div className="im-field"><label>WHT % (client deducts)</label><input className="input" type="number" min={0} max={100} step="any" value={f.whtRate} onChange={(e) => set('whtRate', e.target.value)} /></div>
      </div></div>

      {sections.map((s, si) => (
        <div className="im-section" key={si}>
          <div className="im-section-head"><span className="im-letter">{String.fromCharCode(65 + si)}</span><input className="input" style={{ flex: 1 }} placeholder="Section title (e.g. AUTHENTICATION FEE) — optional" value={s.name} onChange={(e) => setSections((p) => p.map((x, i) => (i === si ? { ...x, name: e.target.value } : x)))} />
            {sections.length > 1 && <button className="im-rm" aria-label="Remove section" onClick={() => setSections((p) => p.filter((_, i) => i !== si))}>✕</button>}</div>
          <div className="im-lines">
            <div className="im-line head"><span>Description</span><span>Volume</span><span>Unit fee ({SYMBOL[cur] || cur})</span><span style={{ textAlign: 'right' }}>Total</span><span /></div>
            {s.items.map((it: any, ii: number) => (
              <div className="im-line" key={ii}>
                <input className="input" list="im-svc" placeholder="Description" value={it.description} onChange={(e) => { setItem(si, ii, 'description', e.target.value); const sv = (services.data || []).find((x) => x.name === e.target.value); if (sv && !it.unitFee) setItem(si, ii, 'unitFee', String(sv.defaultUnitFee)); }} />
                <input className="input" type="number" min={0} step="any" value={it.quantity} onChange={(e) => setItem(si, ii, 'quantity', e.target.value)} />
                <input className="input" type="number" min={0} step="any" value={it.unitFee} onChange={(e) => setItem(si, ii, 'unitFee', e.target.value)} />
                <span className="tot">{fmt(n(it.quantity) * n(it.unitFee), cur)}</span>
                <button className="im-rm" aria-label="Remove item" disabled={s.items.length === 1} onClick={() => setSections((p) => p.map((x, i) => (i === si ? { ...x, items: x.items.filter((_: any, j: number) => j !== ii) } : x)))}>✕</button>
              </div>))}
          </div>
          <button className="im-add" onClick={() => setSections((p) => p.map((x, i) => (i === si ? { ...x, items: [...x.items, blankItem()] } : x)))}><Plus size={13} /> Add item</button>
          <div className="im-hint" style={{ textAlign: 'right' }}>Sub-total {sections.length > 1 ? String.fromCharCode(65 + si) : ''}: <b>{fmt(totals.subs[si] || 0, cur)}</b></div>
        </div>))}
      <datalist id="im-svc">{(services.data || []).map((s) => <option key={s._id} value={s.name} />)}</datalist>
      <button className="im-add" onClick={() => setSections((p) => [...p, { name: '', items: [blankItem()] }])}><Plus size={13} /> Add section</button>

      {f.templateType === 'split' && <div className="im-card"><h4>Split between parties (payment instruction)</h4>
        {parties.map((p, i) => (
          <div key={i} style={{ display: 'grid', gap: 8, marginBottom: 12 }}>
            <div className="im-grid"><div className="im-field"><label>Party</label><input className="input" value={p.label} onChange={(e) => setParties((x) => x.map((y, j) => (j === i ? { ...y, label: e.target.value } : y)))} /></div>
              <div className="im-field"><label>Amount ({cur})</label><input className="input" type="number" min={0} step="any" value={p.amount} onChange={(e) => setParties((x) => x.map((y, j) => (j === i ? { ...y, amount: e.target.value } : y)))} /></div>
              <div className="im-field"><label>Paid by</label><select className="input" value={p.kind} onChange={(e) => setParties((x) => x.map((y, j) => (j === i ? { ...y, kind: e.target.value, wire: e.target.value === 'wire' && !y.wire.length ? WIRE_LABELS.map((l) => ({ label: l, value: '' })) : y.wire } : y)))}><option value="wire">International wire</option><option value="local">Local (account below)</option></select></div></div>
            {p.kind === 'wire' && <div className="im-grid">{p.wire.map((w: any, k: number) => <div className="im-field" key={k}><label>{w.label}</label><input className="input" value={w.value} onChange={(e) => setParties((x) => x.map((y, j) => (j === i ? { ...y, wire: y.wire.map((z: any, m: number) => (m === k ? { ...z, value: e.target.value } : z)) } : y)))} /></div>)}</div>}
          </div>))}
        <button className="im-add" onClick={() => setParties((x) => [...x, blankParty()])}><Plus size={13} /> Add party</button>
      </div>}

      <div className="im-field"><label>Notes (printed on the invoice)</label><textarea className="input" rows={2} value={f.notes} onChange={(e) => set('notes', e.target.value)} /></div>

      <div className="im-summary">
        <div className="r"><span>Total fee{sections.length > 1 ? ` (${sections.map((_, i) => String.fromCharCode(65 + i)).join('+')})` : ''}</span><b>{fmt(totals.sub, cur)}</b></div>
        {f.addVat && <div className="r"><span>VAT ({f.vatRate}%)</span><b>{fmt(totals.vat, cur)}</b></div>}
        <div className="r big"><span>Grand total ({cur})</span><span>{fmt(totals.total, cur)}</span></div>
        {foreign && totals.ngn > 0 && <div className="r"><span>NGN equivalent @ ₦{totals.rate.toLocaleString()}</span><b>{fmt(totals.ngn, 'NGN')}</b></div>}
      </div>
    </Shell>
  );
}

function Shell({ title, sub, onClose, children, foot }: { title: string; sub?: string; onClose: () => void; children: React.ReactNode; foot?: React.ReactNode }) {
  useEffect(() => { const h = (e: KeyboardEvent) => e.key === 'Escape' && onClose(); window.addEventListener('keydown', h); return () => window.removeEventListener('keydown', h); }, [onClose]);
  return (
    <AnimatePresence><motion.div className="im-overlay" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <motion.div className="im-modal" role="dialog" aria-modal="true" aria-label={title} initial={{ opacity: 0, y: 18, scale: 0.98 }} animate={{ opacity: 1, y: 0, scale: 1 }} transition={{ duration: 0.25 }}>
        <div className="im-head"><div><h2>{title}</h2>{sub && <small>{sub}</small>}</div><button className="im-x" onClick={onClose} aria-label="Close"><X size={18} /></button></div>
        <div className="im-body">{children}</div>
        {foot && <div className="im-foot">{foot}</div>}
      </motion.div></motion.div></AnimatePresence>
  );
}

/** Preview — Bill From / Bill To cards, adjustable dates, details table, amount in words and the invoice itself. */
function PreviewModal({ data, f, set, onBack, onRefresh, onCreate, busy, editing, onClose }: any) {
  const [issue, setIssue] = useState(f.issueDate), [due, setDue] = useState(f.dueDate);
  const dirty = issue !== f.issueDate || due !== f.dueDate;
  const cur = f.currency;
  return (
    <Shell title="Preview Invoice" sub="Check everything before it is saved." onClose={onClose}
      foot={<><button className="im-btn ghost" onClick={onBack}><ArrowLeft size={15} /> Back</button>{dirty && <button className="im-btn ghost" disabled={busy} onClick={() => { set('issueDate', issue); set('dueDate', due); onRefresh({ issueDate: issue, dueDate: due || undefined }); }}>Update dates</button>}
        <button className="im-btn primary" disabled={busy || dirty} onClick={onCreate}>{busy ? <Loader2 size={15} className="spin" /> : <Save size={15} />} {editing ? 'Save changes' : 'Create Invoice'}</button></>}>
      <div className="im-dates">
        <div className="im-field im-date"><label>Issue date</label><input className="input" type="date" value={issue} onChange={(e) => setIssue(e.target.value)} /><Calendar size={16} /></div>
        <div className="im-field im-date"><label>Due date</label><input className="input" type="date" value={due} onChange={(e) => setDue(e.target.value)} /><Calendar size={16} /></div>
      </div>
      <div className="im-parties">
        <div className="im-party"><h5>Bill from</h5><strong>Global SJX Limited</strong><p>Lekki Phase 1, Lagos</p><p>talk2us@globalsjxltd.com</p></div>
        <div className="im-party"><h5>Bill to</h5><strong>{data.client?.name}</strong>{data.client?.email && <p>{data.client.email}</p>}{data.client?.phone && <p>{data.client.phone}</p>}</div>
        <div className="im-party"><h5>Pay into</h5><strong>{data.bank?.bankName}</strong><p>{data.bank?.accountName}</p><p>{data.bank?.accountMasked}</p></div>
      </div>
      <div className="im-card"><table className="im-table"><tbody>
        <tr><th>Invoice type</th><td>{f.invoiceType}</td></tr>
        <tr><th>Currency</th><td>{cur}{cur !== 'NGN' ? ` · ₦${Number(data.exchangeRate).toLocaleString()} per ${cur} (${data.rateSource === 'manual' ? 'manual' : 'database'})` : ''}</td></tr>
        <tr><th>Sub-total</th><td>{fmt(data.subtotal, cur)}</td></tr>
        {f.addVat && <tr><th>VAT ({f.vatRate}%)</th><td>{fmt(data.vatAmount, cur)}</td></tr>}
        <tr><th>Grand total</th><td><b>{fmt(data.total, cur)}</b></td></tr>
        {cur !== 'NGN' && f.includeNaira && <tr><th>NGN equivalent</th><td>{fmt(data.totalNgn, 'NGN')}</td></tr>}
      </tbody></table></div>
      <div className="im-words"><b>Amount due (in words)</b>{data.inWords}</div>
      <iframe className="im-frame" title="Invoice preview" sandbox="" srcDoc={data.html} />
    </Shell>
  );
}
