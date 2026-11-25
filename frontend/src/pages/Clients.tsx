import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { AlertTriangle, Download, Plus, Search } from 'lucide-react';
import { api, apiErrorMessage } from '@/lib/api';
import { Badge, statusTone } from '@/components/ui/Badge';
import { Modal } from '@/components/ui/Modal';
import { EmptyState, TableSkeleton } from '@/components/ui/Feedback';
import { useToast } from '@/context/ToastContext';
import { useQuickCreate } from '@/lib/useQuickCreate';
import { useAuth } from '@/context/AuthContext';
import { can } from '@/lib/permissions';
import { exportCsv, isoDate } from '@/lib/exportCsv';
import { fdate } from '@/lib/format';

const INDUSTRIES = ['Banking & Financial Services', 'Insurance', 'Government', 'Healthcare', 'Manufacturing', 'Logistics', 'Technology & IT-Enabled Services', 'Other'];
const EMPTY = { name: '', email: '', phone: '', address: '', state: '', country: 'Nigeria', industry: '', status: 'active' };
const FIELD_LABEL: Record<string, string> = { name: 'Client name', email: 'E-mail', phone: 'Phone', address: 'Office address', state: 'State', country: 'Country' };

/** Same rules as the server (which has the last word). Returns one message per bad field. */
export function clientProblems(f: Record<string, string>): Record<string, string> {
  const p: Record<string, string> = {};
  for (const k of ['name', 'address', 'state', 'country']) if (!String(f[k] || '').trim()) p[k] = `${FIELD_LABEL[k]} is required`;
  if (!String(f.email || '').trim()) p.email = 'E-mail is required'; else if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(f.email.trim())) p.email = 'Enter a valid e-mail address';
  if (!String(f.phone || '').trim()) p.phone = 'Phone is required'; else if (!/^[+()\d][\d\s().-]{3,}$/.test(f.phone.trim()) || f.phone.replace(/\D/g, '').length < 5) p.phone = 'Enter a valid phone number';
  return p;
}

export function Clients() {
  const { user } = useAuth();
  const { showError, showSuccess } = useToast();
  const [clients, setClients] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [modalOpen, setModalOpen] = useState(false);
  const [form, setForm] = useState<any>(EMPTY);
  const [touched, setTouched] = useState(false);
  const [saving, setSaving] = useState(false);
  const [f, setF] = useState({ q: '', industry: '', status: '', state: '', country: '' });
  const canCreate = can.manageClients(user?.role);
  const problems = useMemo(() => clientProblems(form), [form]);

  useEffect(() => { load(); }, []);
  useQuickCreate(() => openNew());

  async function load() {
    setLoading(true);
    try { const res = await api.get('/clients'); setClients(res.data.data); } finally { setLoading(false); }
  }
  function openNew() { setForm(EMPTY); setTouched(false); setModalOpen(true); }

  async function handleCreate() {
    setTouched(true);
    if (Object.keys(problems).length) return;
    setSaving(true);
    try { await api.post('/clients', Object.fromEntries(Object.entries({ ...form, name: form.name.trim(), email: form.email.trim() }).filter(([, v]) => v !== ''))); showSuccess('Client created.'); setModalOpen(false); load(); }
    catch (err) { showError(apiErrorMessage(err)); } finally { setSaving(false); }
  }

  const states = useMemo(() => Array.from(new Set(clients.map((c) => c.state).filter(Boolean))).sort(), [clients]);
  const countries = useMemo(() => Array.from(new Set(clients.map((c) => c.country).filter(Boolean))).sort(), [clients]);
  const rows = useMemo(() => clients.filter((c) => {
    const q = f.q.trim().toLowerCase();
    return (!q || [c.name, c.email, c.phone, c.address].some((x) => String(x || '').toLowerCase().includes(q))) && (!f.industry || c.industry === f.industry) && (!f.status || c.status === f.status) && (!f.state || c.state === f.state) && (!f.country || c.country === f.country);
  }), [clients, f]);

  const err = (k: string) => touched && problems[k] ? <small style={{ color: 'var(--danger, #e5484d)' }} role="alert">{problems[k]}</small> : null;
  const bind = (k: string) => ({ value: form[k], onChange: (e: any) => setForm({ ...form, [k]: e.target.value }), 'aria-invalid': touched && !!problems[k] });

  return (
    <div>
      <div className="page-head">
        <div>
          <h1>Clients</h1>
          <p>Every organization Global SJX serves, with contracts, projects and revenue in one place.</p>
        </div>
        <div className="row-gap">
          <button className="btn btn-ghost" onClick={() => exportCsv('clients', [
            { label: 'Client', value: (c) => c.name }, { label: 'E-mail', value: (c) => c.email }, { label: 'Phone', value: (c) => c.phone }, { label: 'Office address', value: (c) => c.address }, { label: 'State', value: (c) => c.state }, { label: 'Country', value: (c) => c.country },
            { label: 'Industry', value: (c) => c.industry }, { label: 'Status', value: (c) => c.status }, { label: 'Account owner', value: (c) => c.accountOwnerId?.name }, { label: 'Revenue', value: (c) => c.revenue },
            { label: 'Date created', value: (c) => isoDate(c.createdAt) }, { label: 'Created by', value: (c) => c.createdBy?.name }, { label: 'Date modified', value: (c) => isoDate(c.updatedAt) }, { label: 'Modified by', value: (c) => c.updatedBy?.name },
          ], rows)}><Download size={15} /> Export</button>
          {canCreate && <button className="btn btn-primary" onClick={openNew}><Plus size={16} /> New client</button>}
        </div>
      </div>

      <div className="filter-bar">
        <div className="grow" style={{ position: 'relative' }}><Search size={15} style={{ position: 'absolute', left: 12, top: 12, color: 'var(--muted-2)' }} /><input className="input" style={{ paddingLeft: 34, width: '100%' }} placeholder="Search name, e-mail, phone, address…" value={f.q} onChange={(e) => setF({ ...f, q: e.target.value })} aria-label="Search clients" /></div>
        <select className="input" value={f.industry} onChange={(e) => setF({ ...f, industry: e.target.value })} aria-label="Industry"><option value="">Any industry</option>{INDUSTRIES.map((i) => <option key={i}>{i}</option>)}</select>
        <select className="input" value={f.status} onChange={(e) => setF({ ...f, status: e.target.value })} aria-label="Status"><option value="">Any status</option>{['prospect', 'active', 'inactive', 'churned'].map((s) => <option key={s}>{s}</option>)}</select>
        <select className="input" value={f.state} onChange={(e) => setF({ ...f, state: e.target.value })} aria-label="State"><option value="">Any state</option>{states.map((s) => <option key={s}>{s}</option>)}</select>
        <select className="input" value={f.country} onChange={(e) => setF({ ...f, country: e.target.value })} aria-label="Country"><option value="">Any country</option>{countries.map((s) => <option key={s}>{s}</option>)}</select>
      </div>

      {loading ? <TableSkeleton /> : rows.length === 0 ? <EmptyState message={clients.length ? 'No clients match these filters.' : 'No clients yet.'} /> : (
        <div className="table-wrap">
          <table className="data-table">
            <thead><tr><th>Client</th><th>Contact</th><th>Location</th><th>Industry</th><th>Account owner</th><th>Revenue</th><th>Status</th><th>Modified</th></tr></thead>
            <tbody>
              {rows.map((c) => (
                <tr key={c._id} onClick={() => (window.location.href = `/clients/${c._id}`)}>
                  <td><Link to={`/clients/${c._id}`} onClick={(e) => e.stopPropagation()} style={{ fontWeight: 600 }}>{c.name}</Link>
                    {c.missingFields?.length > 0 && <div style={{ fontSize: 11.5, color: 'var(--gold)' }} title={`Missing: ${c.missingFields.map((m: string) => FIELD_LABEL[m]).join(', ')}`}><AlertTriangle size={11} style={{ verticalAlign: -1 }} /> Profile incomplete</div>}</td>
                  <td style={{ fontSize: 12.5 }}>{c.email || '—'}<div className="text-muted">{c.phone || ''}</div></td>
                  <td style={{ fontSize: 12.5 }}>{[c.state, c.country].filter(Boolean).join(', ') || '—'}</td>
                  <td>{c.industry || '—'}</td>
                  <td>{c.accountOwnerId?.name || '—'}</td>
                  <td>₦{(c.revenue || 0).toLocaleString()}</td>
                  <td><Badge tone={statusTone(c.status)}>{c.status}</Badge></td>
                  <td style={{ fontSize: 12 }} title={c.updatedBy?.name ? `by ${c.updatedBy.name}${c.updatedFrom?.device ? ` · ${c.updatedFrom.device}` : ''}` : undefined}>{fdate(c.updatedAt)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <Modal
        open={modalOpen}
        onClose={() => setModalOpen(false)}
        title="New client"
        footer={<><button className="btn btn-ghost" onClick={() => setModalOpen(false)}>Cancel</button><button className="btn btn-primary" onClick={handleCreate} disabled={saving}>{saving ? 'Creating…' : 'Create client'}</button></>}
      >
        <div className="form-grid">
          <div className="field full"><label htmlFor="cl-name">Organization name *</label><input id="cl-name" className="input" {...bind('name')} />{err('name')}</div>
          <div className="field"><label htmlFor="cl-email">E-mail *</label><input id="cl-email" type="email" className="input" {...bind('email')} placeholder="accounts@client.com" />{err('email')}</div>
          <div className="field"><label htmlFor="cl-phone">Phone *</label><input id="cl-phone" type="tel" className="input" {...bind('phone')} placeholder="+234 801 234 5678" />{err('phone')}</div>
          <div className="field full"><label htmlFor="cl-address">Office address *</label><input id="cl-address" className="input" {...bind('address')} />{err('address')}</div>
          <div className="field"><label htmlFor="cl-state">State *</label><input id="cl-state" className="input" {...bind('state')} placeholder="Lagos" />{err('state')}</div>
          <div className="field"><label htmlFor="cl-country">Country *</label><input id="cl-country" className="input" {...bind('country')} />{err('country')}</div>
          <div className="field"><label htmlFor="cl-industry">Industry</label>
            <select id="cl-industry" className="input" {...bind('industry')}><option value="">—</option>{INDUSTRIES.map((i) => <option key={i} value={i}>{i}</option>)}</select></div>
          <div className="field"><label htmlFor="cl-status">Status</label>
            <select id="cl-status" className="input" {...bind('status')}>{['prospect', 'active', 'inactive'].map((s) => <option key={s}>{s}</option>)}</select></div>
        </div>
      </Modal>
    </div>
  );
}
