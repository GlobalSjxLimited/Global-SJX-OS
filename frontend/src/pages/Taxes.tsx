import { useState } from 'react';
import { Receipt, Download, Plus } from 'lucide-react';
import { api, apiErrorMessage } from '@/lib/api';
import { useToast } from '@/context/ToastContext';
import { useApi } from '@/lib/useApi';
import { PageHead, Tabs, Empty, Loading, ErrorNote } from '@/components/ui/PageHead';
import { Badge, statusTone } from '@/components/ui/Badge';
import { Modal } from '@/components/ui/Modal';
import { money, fdate, label, saveBlob, filenameFrom } from '@/lib/format';

const NATURES = ['output_vat', 'input_vat', 'wht_withheld_by_us', 'wht_credit'];
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

export function Taxes() {
  const [tab, setTab] = useState<'return' | 'records' | 'rates'>('return');
  return (
    <div className="page-enter">
      <PageHead title="Taxes" subtitle="VAT and withholding tax — generated from invoices and expenses so returns reconcile to source documents." />
      <Tabs tabs={[{ key: 'return', label: 'Tax return' }, { key: 'records', label: 'Records' }, { key: 'rates', label: 'Rates' }]} value={tab} onChange={(k) => setTab(k as any)} />
      {tab === 'return' && <Return />}{tab === 'records' && <Records />}{tab === 'rates' && <Rates />}
    </div>
  );
}

function Return() {
  const [year, setYear] = useState(new Date().getFullYear());
  const { data, loading, error } = useApi<any>('/taxes/return', { year });
  return (
    <>
      <div style={{ marginBottom: 14 }}><input className="input" type="number" style={{ width: 110 }} value={year} onChange={(e) => setYear(Number(e.target.value))} /></div>
      <ErrorNote message={error} />
      {loading && !data ? <Loading /> : data && (
        <>
          <div className="stat-grid" style={{ marginBottom: 16 }}>
            <div className="stat-card"><div className="stat-label"><span>Output VAT</span></div><div className="stat-value">{money(data.outputVat)}</div></div>
            <div className="stat-card"><div className="stat-label"><span>Input VAT</span></div><div className="stat-value">{money(data.inputVat)}</div></div>
            <div className="stat-card"><div className="stat-label"><span>VAT payable</span></div><div className="stat-value">{money(data.vatPayable)}</div><div className="stat-sub">{money(data.vatUnremitted)} not yet remitted</div></div>
            <div className="stat-card"><div className="stat-label"><span>WHT to remit</span></div><div className="stat-value">{money(data.whtUnremitted)}</div></div>
          </div>
          <div className="table-wrap"><table className="data-table" style={{ cursor: 'default' }}><thead><tr><th>Month</th><th>Output VAT</th><th>Input VAT</th><th>Net VAT</th><th>WHT withheld</th><th>WHT credits</th></tr></thead>
            <tbody>{data.byMonth.map((m: any) => <tr key={m.month} style={{ cursor: 'default' }}><td>{MONTHS[m.month - 1]}</td><td>{money(m.outputVat)}</td><td>{money(m.inputVat)}</td><td>{money(m.outputVat - m.inputVat)}</td><td>{money(m.whtWithheld)}</td><td>{money(m.whtCredit)}</td></tr>)}</tbody></table></div>
        </>
      )}
    </>
  );
}

function Records() {
  const { showError, showSuccess } = useToast();
  const [nature, setNature] = useState('');
  const [status, setStatus] = useState('');
  const [year, setYear] = useState('');
  const { data, loading, error, reload } = useApi<any[]>('/taxes/records', { nature: nature || undefined, status: status || undefined, year: year || undefined });
  const [sel, setSel] = useState<string[]>([]);
  const [pay, setPay] = useState<string | null>(null);
  const [create, setCreate] = useState(false);
  const [f, setF] = useState<any>({ nature: 'input_vat', baseAmount: '', rate: 7.5, partyName: '', sourceRef: '' });
  async function markPaid() { try { await api.post('/taxes/records/mark-paid', { ids: sel, paymentRef: pay }); showSuccess('Marked as remitted.'); setSel([]); setPay(null); reload(); } catch (e) { showError(apiErrorMessage(e)); } }
  async function exportCsv() { try { const r = await api.get('/taxes/export.csv', { params: { year: year || undefined }, responseType: 'blob' }); saveBlob(r.data, filenameFrom(r.headers['content-disposition'], 'tax-records.csv')); } catch (e) { showError(apiErrorMessage(e)); } }
  async function addManual() { try { await api.post('/taxes/records', f); showSuccess('Record added.'); setCreate(false); reload(); } catch (e) { showError(apiErrorMessage(e)); } }
  const remittable = (data || []).filter((r) => r.status === 'unpaid' && ['output_vat', 'wht_withheld_by_us'].includes(r.nature));
  return (
    <>
      <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', marginBottom: 14 }}>
        <select className="input" style={{ maxWidth: 200 }} value={nature} onChange={(e) => setNature(e.target.value)}><option value="">All kinds</option>{NATURES.map((n) => <option key={n} value={n}>{label(n)}</option>)}</select>
        <select className="input" style={{ maxWidth: 150 }} value={status} onChange={(e) => setStatus(e.target.value)}><option value="">Any status</option><option value="unpaid">Unpaid</option><option value="paid">Paid</option><option value="void">Void</option></select>
        <input className="input" style={{ maxWidth: 110 }} type="number" placeholder="Year" value={year} onChange={(e) => setYear(e.target.value)} />
        <button className="btn btn-ghost" onClick={exportCsv}><Download size={14} /> CSV</button>
        <button className="btn btn-ghost" onClick={() => setCreate(true)}><Plus size={14} /> Manual record</button>
        {sel.length > 0 && <button className="btn btn-primary" onClick={() => setPay('')}>Mark {sel.length} remitted</button>}
      </div>
      <ErrorNote message={error} />
      {loading && !data ? <Loading /> : !data?.length ? <Empty icon={<Receipt />} title="No tax records" /> : (
        <div className="table-wrap"><table className="data-table" style={{ cursor: 'default' }}><thead><tr><th /><th>ID</th><th>Date</th><th>Kind</th><th>Party</th><th>Source</th><th>Base</th><th>Rate</th><th>Amount</th><th>Status</th></tr></thead>
          <tbody>{data.map((r) => <tr key={r._id} style={{ cursor: 'default' }}>
            <td>{remittable.includes(r) && <input type="checkbox" checked={sel.includes(r._id)} onChange={() => setSel(sel.includes(r._id) ? sel.filter((x) => x !== r._id) : [...sel, r._id])} />}</td>
            <td className="mono">{r.taxId}</td><td>{fdate(r.transDate)}</td><td>{label(r.nature)}</td><td>{r.partyName || '—'}</td><td>{r.sourceRef || label(r.sourceType)}</td><td>{money(r.baseAmount)}</td><td>{r.rate}%</td><td>{money(r.amount)}</td><td><Badge tone={statusTone(r.status === 'paid' ? 'done' : r.status)}>{label(r.status)}</Badge></td></tr>)}</tbody></table></div>
      )}
      {pay !== null && <Modal open onClose={() => setPay(null)} title="Mark as remitted" footer={<><button className="btn btn-ghost" onClick={() => setPay(null)}>Cancel</button><button className="btn btn-primary" onClick={markPaid}>Confirm</button></>}>
        <div className="field"><label>Payment reference (e.g. FIRS receipt no.)</label><input className="input" value={pay} onChange={(e) => setPay(e.target.value)} /></div></Modal>}
      {create && <Modal open onClose={() => setCreate(false)} title="Manual tax record" footer={<><button className="btn btn-ghost" onClick={() => setCreate(false)}>Cancel</button><button className="btn btn-primary" onClick={addManual}>Add</button></>}>
        <div className="grid-2">
          <div className="field"><label>Kind</label><select className="input" value={f.nature} onChange={(e) => setF({ ...f, nature: e.target.value })}>{NATURES.map((n) => <option key={n} value={n}>{label(n)}</option>)}</select></div>
          <div className="field"><label>Base amount (NGN)</label><input className="input" type="number" value={f.baseAmount} onChange={(e) => setF({ ...f, baseAmount: e.target.value })} /></div>
          <div className="field"><label>Rate %</label><input className="input" type="number" value={f.rate} onChange={(e) => setF({ ...f, rate: e.target.value })} /></div>
          <div className="field"><label>Party</label><input className="input" value={f.partyName} onChange={(e) => setF({ ...f, partyName: e.target.value })} /></div>
        </div></Modal>}
    </>
  );
}

function Rates() {
  const { showError, showSuccess } = useToast();
  const fx = useApi<any[]>('/rates/exchange');
  const tax = useApi<any[]>('/rates/tax');
  const [rate, setRate] = useState({ currency: 'USD', rate: '', source: 'CBN' });
  const [tr, setTr] = useState({ kind: 'VAT', name: '', rate: '', isDefault: false });
  async function addFx() { try { await api.post('/rates/exchange', rate); showSuccess('Rate added.'); setRate({ ...rate, rate: '' }); fx.reload(); } catch (e) { showError(apiErrorMessage(e)); } }
  async function addTax() { try { await api.post('/rates/tax', tr); showSuccess('Tax rate added.'); setTr({ ...tr, name: '', rate: '' }); tax.reload(); } catch (e) { showError(apiErrorMessage(e)); } }
  return (
    <div className="grid-2" style={{ alignItems: 'start' }}>
      <div className="card" style={{ display: 'grid', gap: 10 }}>
        <strong>Exchange rates (NGN per unit)</strong>
        <div style={{ display: 'flex', gap: 8 }}>
          <select className="input" style={{ width: 90 }} value={rate.currency} onChange={(e) => setRate({ ...rate, currency: e.target.value })}>{['USD', 'GBP', 'EUR'].map((c) => <option key={c}>{c}</option>)}</select>
          <input className="input" type="number" placeholder="Rate" value={rate.rate} onChange={(e) => setRate({ ...rate, rate: e.target.value })} />
          <button className="btn btn-primary" onClick={addFx}>Add</button></div>
        {fx.loading ? <Loading rows={2} /> : <ul style={{ fontSize: 13, paddingLeft: 18, margin: 0 }}>{(fx.data || []).slice(0, 12).map((r) => <li key={r._id}>{fdate(r.rateDate)} — 1 {r.currency} = {money(r.rate)} {r.status === 'active' && <Badge tone="success">current</Badge>}</li>)}</ul>}
      </div>
      <div className="card" style={{ display: 'grid', gap: 10 }}>
        <strong>VAT / WHT rates</strong>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <select className="input" style={{ width: 90 }} value={tr.kind} onChange={(e) => setTr({ ...tr, kind: e.target.value })}>{['VAT', 'WHT', 'OTHER'].map((c) => <option key={c}>{c}</option>)}</select>
          <input className="input" style={{ flex: 1, minWidth: 120 }} placeholder="Name" value={tr.name} onChange={(e) => setTr({ ...tr, name: e.target.value })} />
          <input className="input" style={{ width: 80 }} type="number" placeholder="%" value={tr.rate} onChange={(e) => setTr({ ...tr, rate: e.target.value })} />
          <button className="btn btn-primary" onClick={addTax}>Add</button></div>
        {tax.loading ? <Loading rows={2} /> : <ul style={{ fontSize: 13, paddingLeft: 18, margin: 0 }}>{(tax.data || []).map((r) => <li key={r._id}>{r.kind} · {r.name} — {r.rate}% {r.isDefault && <Badge tone="accent">default</Badge>} {r.status !== 'active' && <Badge>inactive</Badge>}</li>)}</ul>}
      </div>
    </div>
  );
}
