import { useEffect, useMemo, useState } from 'react';
import { Download, Plus, Search } from 'lucide-react';
import { api, apiErrorMessage } from '@/lib/api';
import { useAuth } from '@/context/AuthContext';
import { useToast } from '@/context/ToastContext';
import { useConfirm } from '@/context/ConfirmContext';
import { can } from '@/lib/permissions';
import { Badge, statusTone } from '@/components/ui/Badge';
import { Modal } from '@/components/ui/Modal';
import { EmptyState, TableSkeleton } from '@/components/ui/Feedback';
import { Pagination } from '@/components/ui/Pagination';
import { RowActions } from '@/components/work/RowActions';
import { RecordPanel } from '@/components/record/RecordPanel';
import { ContactsEditor, ContactRow, contactProblem } from '@/components/sales/ContactsEditor';
import { exportCsv, isoDate } from '@/lib/exportCsv';
import { fdate, toInputDate } from '@/lib/format';

const LEVELS = ['Registered', 'Silver', 'Gold', 'Platinum', 'Strategic'];
const EMPTY = { name: '', email: '', phone: '', address: '', website: '', startDate: '', partnerLevel: 'Registered', products: '', performanceRating: 4, revenue: 0, renewalDate: '', status: 'active' };
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

export function Vendors() {
  const { user } = useAuth();
  const { showError, showSuccess } = useToast();
  const confirm = useConfirm();
  const manage = can.manageVendorsSponsors(user?.role);
  const [rows, setRows] = useState<any[]>([]); const [loading, setLoading] = useState(true); const [page, setPage] = useState(1); const [pg, setPg] = useState<any>(null);
  const [f, setF] = useState({ q: '', partnerLevel: '', status: '', createdFrom: '', createdTo: '' });
  const [modal, setModal] = useState<null | { vendor?: any; view?: boolean }>(null);
  const params = useMemo(() => Object.fromEntries(Object.entries(f).filter(([, v]) => v)), [f]);

  async function load() {
    setLoading(true);
    try { const r = await api.get('/vendors', { params: { page, limit: 20, ...params } }); setRows(r.data.data); setPg(r.data.pagination); } catch (e) { showError(apiErrorMessage(e)); } finally { setLoading(false); }
  }
  useEffect(() => { const t = setTimeout(load, f.q ? 300 : 0); return () => clearTimeout(t); /* eslint-disable-next-line */ }, [page, params]);
  useEffect(() => setPage(1), [params]);

  async function doExport() {
    try {
      const all: any[] = [];
      for (let p = 1; p <= 30; p++) { const r = await api.get('/vendors', { params: { page: p, limit: 100, ...params } }); all.push(...r.data.data); if (p >= (r.data.pagination?.pages || 1)) break; }
      const main = (v: any) => (v.contacts || []).find((c: any) => c.isPrimary) || (v.contacts || [])[0] || {};
      exportCsv('vendors', [
        { label: 'Vendor', value: (v) => v.name }, { label: 'Partner level', value: (v) => v.partnerLevel }, { label: 'E-mail', value: (v) => v.email }, { label: 'Phone', value: (v) => v.phone }, { label: 'Address', value: (v) => v.address }, { label: 'Website', value: (v) => v.website },
        { label: 'Main contact', value: (v) => main(v).name }, { label: 'Contact e-mail', value: (v) => main(v).email }, { label: 'Contact phone', value: (v) => main(v).phone }, { label: 'Products', value: (v) => (v.products || []).join('; ') },
        { label: 'Partnership start', value: (v) => isoDate(v.startDate) }, { label: 'Renewal', value: (v) => isoDate(v.renewalDate) }, { label: 'Rating', value: (v) => v.performanceRating }, { label: 'Status', value: (v) => v.status },
        { label: 'Date created', value: (v) => isoDate(v.createdAt) }, { label: 'Created by', value: (v) => v.createdBy?.name }, { label: 'Date modified', value: (v) => isoDate(v.updatedAt) }, { label: 'Modified by', value: (v) => v.updatedBy?.name },
      ], all);
    } catch (e) { showError(apiErrorMessage(e)); }
  }
  async function remove(v: any) {
    if (!(await confirm({ title: 'Delete vendor', message: `Delete “${v.name}”? It is archived and an administrator can restore it.`, confirmLabel: 'Delete', danger: true }))) return;
    try { await api.delete(`/vendors/${v._id}`); showSuccess('Vendor deleted.'); load(); } catch (e) { showError(apiErrorMessage(e)); }
  }

  return (
    <div>
      <div className="page-head"><div><h1>Vendors</h1><p>Technology partners: contacts, products, partner level, contracts and performance.</p></div>
        <div className="row-gap"><button className="btn btn-ghost" onClick={doExport}><Download size={15} /> Export</button><button className="btn btn-primary" disabled={!manage} onClick={() => setModal({})}><Plus size={16} /> New vendor</button></div></div>
      <div className="filter-bar">
        <div className="grow" style={{ position: 'relative' }}><Search size={15} style={{ position: 'absolute', left: 12, top: 12, color: 'var(--muted-2)' }} /><input className="input" style={{ paddingLeft: 34, width: '100%' }} placeholder="Search vendor, contact, product…" value={f.q} onChange={(e) => setF({ ...f, q: e.target.value })} aria-label="Search vendors" /></div>
        <select className="input" aria-label="Partner level" value={f.partnerLevel} onChange={(e) => setF({ ...f, partnerLevel: e.target.value })}><option value="">Any level</option>{LEVELS.map((l) => <option key={l}>{l}</option>)}</select>
        <select className="input" aria-label="Status" value={f.status} onChange={(e) => setF({ ...f, status: e.target.value })}><option value="">Any status</option><option>active</option><option>inactive</option></select>
        <label style={{ fontSize: 12.5 }}>Created from <input className="input" type="date" style={{ width: 'auto' }} value={f.createdFrom} onChange={(e) => setF({ ...f, createdFrom: e.target.value })} /></label>
        <label style={{ fontSize: 12.5 }}>to <input className="input" type="date" style={{ width: 'auto' }} value={f.createdTo} onChange={(e) => setF({ ...f, createdTo: e.target.value })} /></label>
      </div>
      <div className="table-wrap">{loading ? <TableSkeleton cols={7} /> : rows.length === 0 ? <EmptyState message="No vendors match." /> : (
        <table className="data-table"><thead><tr><th>Vendor</th><th>Contact</th><th>Partner level</th><th>Products</th><th>Partner since</th><th>Rating</th><th>Status</th><th>Modified</th><th style={{ width: 44 }} /></tr></thead>
          <tbody>{rows.map((v) => { const c = (v.contacts || []).find((x: any) => x.isPrimary) || (v.contacts || [])[0]; return (
            <tr key={v._id} onClick={() => setModal({ vendor: v, view: true })} style={{ cursor: 'pointer' }}>
              <td><strong>{v.name}</strong><div className="text-muted" style={{ fontSize: 12 }}>{v.email || v.phone || ''}</div></td>
              <td style={{ fontSize: 12.5 }}>{c ? <>{c.name}<div className="text-muted">{c.email || c.phone || ''}</div></> : '—'}</td>
              <td><Badge tone={statusTone(v.partnerLevel)}>{v.partnerLevel}</Badge></td><td style={{ fontSize: 12.5 }}>{(v.products || []).join(', ') || '—'}</td><td>{fdate(v.startDate)}</td><td>{v.performanceRating || 0} / 5</td>
              <td><Badge tone={statusTone(v.status)}>{v.status}</Badge></td><td style={{ fontSize: 12 }} title={v.updatedBy?.name ? `by ${v.updatedBy.name}${v.updatedFrom?.device ? ` · ${v.updatedFrom.device}` : ''}` : undefined}>{fdate(v.updatedAt)}</td>
              <td onClick={(e) => e.stopPropagation()}><RowActions permissions={{ view: true, edit: manage, delete: manage }} onView={() => setModal({ vendor: v, view: true })} onEdit={() => setModal({ vendor: v })} onDelete={() => remove(v)} /></td></tr>); })}</tbody></table>
      )}</div>
      {pg && <Pagination page={pg.page} pages={pg.pages} total={pg.total} onChange={setPage} />}
      {modal && <VendorModal vendor={modal.vendor} view={!!modal.view} canEdit={manage} onClose={() => setModal(null)} onSaved={load} />}
    </div>
  );
}

function VendorModal({ vendor, view, canEdit, onClose, onSaved }: { vendor?: any; view: boolean; canEdit: boolean; onClose: () => void; onSaved: () => void }) {
  const { showError, showSuccess } = useToast();
  const [ro, setRo] = useState(view || !canEdit);
  const [f, setF] = useState<any>(vendor ? { ...EMPTY, ...vendor, products: (vendor.products || []).join(', '), startDate: toInputDate(vendor.startDate), renewalDate: toInputDate(vendor.renewalDate), email: vendor.email || '', phone: vendor.phone || '', address: vendor.address || '', website: vendor.website || '' } : EMPTY);
  const [contacts, setContacts] = useState<ContactRow[]>((vendor?.contacts || []).map((c: any) => ({ ...c })));
  const [touched, setTouched] = useState(false); const [busy, setBusy] = useState(false);
  const set = (k: string, v: any) => setF((x: any) => ({ ...x, [k]: v }));
  const cp = contacts.map(contactProblem).find(Boolean);
  const problems: string[] = [];
  if (f.name.trim().length < 2) problems.push('Vendor name is required.');
  if (f.email && !EMAIL.test(f.email.trim())) problems.push('Enter a valid vendor e-mail address.');
  if (!f.email.trim() && !f.phone.trim() && !contacts.some((c) => c.email || c.phone)) problems.push('Add contact details: an e-mail or phone for the vendor, or a contact person with theirs.');
  if (cp) problems.push(cp);

  async function save() {
    setTouched(true);
    if (problems.length) return;
    setBusy(true);
    try {
      const body = { name: f.name.trim(), email: f.email.trim(), phone: f.phone.trim(), address: f.address.trim(), website: f.website.trim(), startDate: f.startDate || undefined, renewalDate: f.renewalDate || undefined, partnerLevel: f.partnerLevel, products: f.products.split(',').map((x: string) => x.trim()).filter(Boolean), performanceRating: Number(f.performanceRating) || 1, revenue: Number(f.revenue) || 0, status: f.status, contacts: contacts.map((c) => ({ name: c.name.trim(), title: c.title || undefined, email: c.email || '', phone: c.phone || undefined, isPrimary: !!c.isPrimary })) };
      if (vendor) await api.patch(`/vendors/${vendor._id}`, body); else await api.post('/vendors', body);
      showSuccess(vendor ? 'Vendor saved.' : 'Vendor created.'); onSaved(); onClose();
    } catch (e) { showError(apiErrorMessage(e)); } finally { setBusy(false); }
  }
  return (
    <Modal open onClose={onClose} size="wide" title={vendor ? (ro ? vendor.name : `Edit ${vendor.name}`) : 'New vendor'}
      footer={ro ? <><button className="btn btn-ghost" onClick={onClose}>Close</button>{canEdit && <button className="btn btn-primary" onClick={() => setRo(false)}>Edit</button>}</> : <><button className="btn btn-ghost" onClick={onClose}>Cancel</button><button className="btn btn-primary" disabled={busy} onClick={save}>{busy ? 'Saving…' : 'Save'}</button></>}>
      <fieldset disabled={ro} style={{ border: 0, padding: 0, margin: 0, minWidth: 0 }}>
        <div className="form-grid">
          <div className="field full"><label htmlFor="v-name">Vendor name *</label><input id="v-name" className="input" value={f.name} onChange={(e) => set('name', e.target.value)} /></div>
          <div className="field"><label htmlFor="v-email">Company e-mail</label><input id="v-email" className="input" type="email" value={f.email} onChange={(e) => set('email', e.target.value)} /></div>
          <div className="field"><label htmlFor="v-phone">Company phone</label><input id="v-phone" className="input" type="tel" value={f.phone} onChange={(e) => set('phone', e.target.value)} /></div>
          <div className="field full"><label htmlFor="v-addr">Address</label><input id="v-addr" className="input" value={f.address} onChange={(e) => set('address', e.target.value)} /></div>
          <div className="field"><label htmlFor="v-web">Website</label><input id="v-web" className="input" value={f.website} onChange={(e) => set('website', e.target.value)} /></div>
          <div className="field"><label htmlFor="v-start">Partner since</label><input id="v-start" className="input" type="date" value={f.startDate} onChange={(e) => set('startDate', e.target.value)} /></div>
          <div className="field"><label htmlFor="v-level">Partner level</label><select id="v-level" className="input" value={f.partnerLevel} onChange={(e) => set('partnerLevel', e.target.value)}>{LEVELS.map((l) => <option key={l}>{l}</option>)}</select></div>
          <div className="field"><label htmlFor="v-status">Status</label><select id="v-status" className="input" value={f.status} onChange={(e) => set('status', e.target.value)}><option>active</option><option>inactive</option></select></div>
          <div className="field full"><label htmlFor="v-prod">Products (comma separated)</label><input id="v-prod" className="input" value={f.products} onChange={(e) => set('products', e.target.value)} /></div>
          <div className="field"><label htmlFor="v-rate">Performance rating (1 to 5)</label><input id="v-rate" className="input" type="number" min={1} max={5} value={f.performanceRating} onChange={(e) => set('performanceRating', e.target.value)} /></div>
          <div className="field"><label htmlFor="v-ren">Renewal date</label><input id="v-ren" className="input" type="date" value={f.renewalDate} onChange={(e) => set('renewalDate', e.target.value)} /></div>
          <div className="field full"><label>Contact people</label><ContactsEditor roles={false} value={contacts} onChange={setContacts} /></div>
        </div>
      </fieldset>
      {touched && problems.length > 0 && <div className="callout danger" role="alert" style={{ marginTop: 12 }}><ul style={{ margin: 0, paddingLeft: 18 }}>{problems.map((p) => <li key={p}>{p}</li>)}</ul></div>}
      {vendor && <RecordPanel entityType="vendor" entityId={vendor._id} doc={vendor} kinds={['contract', 'proposal', 'invoice', 'other']} canAddFiles={canEdit} />}
    </Modal>
  );
}
