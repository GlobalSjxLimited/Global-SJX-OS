import { useState } from 'react';
import { Landmark, Plus, ShieldAlert, CheckCircle2 } from 'lucide-react';
import { api, apiErrorMessage } from '@/lib/api';
import { useAuth } from '@/context/AuthContext';
import { useToast } from '@/context/ToastContext';
import { useConfirm } from '@/context/ConfirmContext';
import { useApi } from '@/lib/useApi';
import { PageHead, Empty, Loading, ErrorNote } from '@/components/ui/PageHead';
import { Badge, statusTone } from '@/components/ui/Badge';
import { Modal } from '@/components/ui/Modal';
import { label } from '@/lib/format';

export function BankAccounts() {
  const { user } = useAuth();
  const { showError, showSuccess } = useToast();
  const confirm = useConfirm();
  const manage = !!user?.modules?.includes('bank_accounts') || user?.role === 'super_admin';
  const { data, loading, error, reload } = useApi<any[]>('/bank-accounts');
  const [create, setCreate] = useState(false);
  const [f, setF] = useState<any>({ bankName: '', accountName: '', accountNumber: '', currency: 'NGN', accountType: 'current' });
  const [shown, setShown] = useState<Record<string, string>>({});
  async function save() { try { await api.post('/bank-accounts', f); showSuccess('Added — awaiting approval by a second person.'); setCreate(false); setF({ ...f, accountNumber: '' }); reload(); } catch (e) { showError(apiErrorMessage(e)); } }
  async function approve(id: string) { try { await api.post(`/bank-accounts/${id}/approve`); showSuccess('Approved.'); reload(); } catch (e) { showError(apiErrorMessage(e)); } }
  async function reveal(id: string) { try { const r = await api.post(`/bank-accounts/${id}/reveal`); setShown({ ...shown, [id]: r.data.data.accountNumber }); setTimeout(() => setShown((s) => { const n = { ...s }; delete n[id]; return n; }), 20000); } catch (e) { showError(apiErrorMessage(e)); } }
  async function remove(id: string) { if (!(await confirm({ title: 'Remove account?', message: 'It can no longer be used on new invoices.', danger: true, confirmLabel: 'Remove' }))) return; try { await api.delete(`/bank-accounts/${id}`); reload(); } catch (e) { showError(apiErrorMessage(e)); } }
  return (
    <div className="page-enter">
      <PageHead title="Company bank accounts" subtitle="Numbers are encrypted at rest. New accounts need approval from a second person before they can appear on an invoice."
        actions={manage && <button className="btn btn-primary" onClick={() => setCreate(true)}><Plus size={15} /> Add account</button>} />
      <ErrorNote message={error} />
      {loading && !data ? <Loading /> : !data?.length ? <Empty icon={<Landmark />} title="No bank accounts yet" /> : (
        <div className="table-wrap"><table className="data-table" style={{ cursor: 'default' }}><thead><tr><th>Bank</th><th>Account name</th><th>Number</th><th>Currency</th><th>Status</th><th /></tr></thead>
          <tbody>{data.map((b) => <tr key={b._id} style={{ cursor: 'default' }}><td><strong>{b.bankName}</strong></td><td>{b.accountName}</td>
            <td className="mono">{shown[b._id] || `••••••${b.accountLast4}`}</td><td>{b.currency}</td><td><Badge tone={statusTone(b.status)}>{label(b.status)}</Badge></td>
            <td style={{ whiteSpace: 'nowrap' }}>{manage && <>
              {b.status === 'pending' && <button className="btn btn-primary btn-sm" onClick={() => approve(b._id)}><CheckCircle2 size={13} /> Approve</button>}
              <button className="btn btn-ghost btn-sm" onClick={() => reveal(b._id)}><ShieldAlert size={13} /> Reveal</button>
              <button className="btn btn-ghost btn-sm" onClick={() => remove(b._id)}>Remove</button></>}</td></tr>)}</tbody></table></div>
      )}
      {create && <Modal open onClose={() => setCreate(false)} title="Add bank account" footer={<><button className="btn btn-ghost" onClick={() => setCreate(false)}>Cancel</button><button className="btn btn-primary" onClick={save}>Add</button></>}>
        <div className="grid-2">
          <div className="field"><label>Bank *</label><input className="input" value={f.bankName} onChange={(e) => setF({ ...f, bankName: e.target.value })} /></div>
          <div className="field"><label>Account name *</label><input className="input" value={f.accountName} onChange={(e) => setF({ ...f, accountName: e.target.value })} /></div>
          <div className="field"><label>Account number *</label><input className="input mono" autoComplete="off" value={f.accountNumber} onChange={(e) => setF({ ...f, accountNumber: e.target.value })} /></div>
          <div className="field"><label>Currency</label><select className="input" value={f.currency} onChange={(e) => setF({ ...f, currency: e.target.value })}>{['NGN', 'USD', 'GBP', 'EUR'].map((c) => <option key={c}>{c}</option>)}</select></div>
        </div></Modal>}
    </div>
  );
}
