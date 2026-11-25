import { useState } from 'react';
import { FileCheck2, FileText, Plus } from 'lucide-react';
import { api, apiErrorMessage, openProtectedFile } from '@/lib/api';
import { useToast } from '@/context/ToastContext';
import { useConfirm } from '@/context/ConfirmContext';
import { Badge } from '@/components/ui/Badge';
import { Modal } from '@/components/ui/Modal';
import { Discussion } from '@/components/discussion/Discussion';
import { FileUpload } from '@/components/work/FileUpload';
import { fdate, toInputDate } from '@/lib/format';

const STATUSES = [['draft', 'Draft'], ['sent', 'Sent for signature'], ['signed', 'Signed'], ['active', 'Active'], ['expired', 'Expired'], ['terminated', 'Terminated']];
const TONE: Record<string, any> = { draft: 'neutral', sent: 'gold', signed: 'accent', active: 'success', expired: 'neutral', terminated: 'danger' };
const size = (n: number) => (n >= 1048576 ? `${(n / 1048576).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1024))} KB`);

/** A client's contracts. The signed copy is an uploaded file (10 MB at most), and a contract cannot be marked signed or active without it. */
export function ContractsPanel({ clientId, contracts, canManage, onChanged }: { clientId: string; contracts: any[]; canManage: boolean; onChanged: () => void }) {
  const [edit, setEdit] = useState<any | null>(null);
  return (
    <div>
      {canManage && <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: 14 }}><button className="btn btn-primary btn-sm" onClick={() => setEdit({})}><Plus size={14} /> Add contract</button></div>}
      <div style={{ display: 'grid', gap: 12 }}>
        {(contracts || []).map((c) => (
          <button key={c._id} type="button" className="card flex-between" style={{ textAlign: 'left', cursor: 'pointer', width: '100%' }} onClick={() => setEdit(c)}>
            <div>
              <strong style={{ fontSize: 14 }}>{c.title}</strong>{c.reference && <span className="text-muted" style={{ fontSize: 12 }}> · {c.reference}</span>}
              <p style={{ fontSize: 12, color: 'var(--muted)', margin: '4px 0 0' }}>{fdate(c.startDate)} → {fdate(c.endDate)}</p>
              <p style={{ fontSize: 12, margin: '4px 0 0', color: c.signedDocument?.url ? 'var(--success, #2e9e6b)' : 'var(--gold)' }}>{c.signedDocument?.url ? <><FileCheck2 size={12} style={{ verticalAlign: -2 }} /> Signed copy attached ({size(c.signedDocument.size || 0)})</> : 'No signed copy yet'}</p>
            </div>
            <div style={{ textAlign: 'right' }}><div style={{ fontSize: 14, fontWeight: 600 }}>{c.currency} {(c.value || 0).toLocaleString()}</div><Badge tone={TONE[c.status]}>{STATUSES.find(([k]) => k === c.status)?.[1] || c.status}</Badge></div>
          </button>
        ))}
        {(!contracts || contracts.length === 0) && <p style={{ color: 'var(--muted)' }}>No contracts yet.{!canManage && ' Sales, Finance or leadership can add one.'}</p>}
      </div>
      {edit && <ContractModal clientId={clientId} contract={edit._id ? edit : null} canManage={canManage} onClose={() => setEdit(null)} onChanged={onChanged} />}
    </div>
  );
}

function ContractModal({ clientId, contract, canManage, onClose, onChanged }: { clientId: string; contract: any | null; canManage: boolean; onClose: () => void; onChanged: () => void }) {
  const { showError, showSuccess } = useToast();
  const confirm = useConfirm();
  const [c, setC] = useState<any>(contract);
  const [f, setF] = useState<any>({ title: contract?.title || '', reference: contract?.reference || '', value: contract?.value || 0, currency: contract?.currency || 'NGN', startDate: toInputDate(contract?.startDate), endDate: toInputDate(contract?.endDate), signedOn: toInputDate(contract?.signedOn), status: contract?.status || 'draft', signedByClient: contract?.signedByClient || '', signedByUs: contract?.signedByUs || '', notes: contract?.notes || '' });
  const [busy, setBusy] = useState(false);
  const set = (k: string, v: any) => setF((x: any) => ({ ...x, [k]: v }));
  const base = `/clients/${clientId}/contracts`;
  const needsFile = ['signed', 'active'].includes(f.status) && !c?.signedDocument?.url;
  const dateBad = f.startDate && f.endDate && f.endDate < f.startDate;
  const ro = !canManage;

  async function save() {
    setBusy(true);
    try {
      const body = { ...f, value: Number(f.value) || 0 };
      if (c?._id) { const r = await api.patch(`${base}/${c._id}`, body); setC(r.data.data); showSuccess('Contract saved.'); }
      else { const r = await api.post(base, body); setC(r.data.data); showSuccess('Contract created. Attach the signed copy next.'); }
      onChanged();
    } catch (e) { showError(apiErrorMessage(e)); } finally { setBusy(false); }
  }
  async function attach(files: Array<{ name: string; url: string }>) {
    if (!c?._id) return;
    try { const r = await api.post(`${base}/${c._id}/signed-document`, { name: files[0].name, url: files[0].url }); setC(r.data.data); showSuccess('Signed copy attached.'); onChanged(); } catch (e) { showError(apiErrorMessage(e)); }
  }
  async function detach() {
    if (!(await confirm({ title: 'Remove signed copy', message: 'Remove the attached file?', confirmLabel: 'Remove', danger: true }))) return;
    try { const r = await api.delete(`${base}/${c._id}/signed-document`); setC(r.data.data); onChanged(); } catch (e) { showError(apiErrorMessage(e)); }
  }
  async function remove() {
    if (!(await confirm({ title: 'Delete contract', message: `Delete “${c.title}”?`, confirmLabel: 'Delete', danger: true }))) return;
    try { await api.delete(`${base}/${c._id}`); showSuccess('Contract deleted.'); onChanged(); onClose(); } catch (e) { showError(apiErrorMessage(e)); }
  }

  return (
    <Modal open onClose={onClose} size="wide" title={c?._id ? c.title : 'New contract'}
      footer={<>{c?._id && canManage && <button className="btn btn-ghost" style={{ marginRight: 'auto' }} onClick={remove}>Delete</button>}<button className="btn btn-ghost" onClick={onClose}>Close</button>{canManage && <button className="btn btn-primary" disabled={busy || f.title.trim().length < 2 || !!dateBad || needsFile} onClick={save}>{busy ? 'Saving…' : c?._id ? 'Save changes' : 'Create contract'}</button>}</>}>
      <fieldset disabled={ro} style={{ border: 0, padding: 0, margin: 0, minWidth: 0 }}>
        <div className="form-grid">
          <div className="field full"><label htmlFor="ct-title">Contract title *</label><input id="ct-title" className="input" value={f.title} onChange={(e) => set('title', e.target.value)} /></div>
          <div className="field"><label htmlFor="ct-ref">Reference</label><input id="ct-ref" className="input" value={f.reference} onChange={(e) => set('reference', e.target.value)} /></div>
          <div className="field"><label htmlFor="ct-status">Status</label><select id="ct-status" className="input" value={f.status} onChange={(e) => set('status', e.target.value)}>{STATUSES.map(([k, l]) => <option key={k} value={k} disabled={['signed', 'active'].includes(k) && !c?.signedDocument?.url}>{l}{['signed', 'active'].includes(k) && !c?.signedDocument?.url ? ' (attach the signed copy first)' : ''}</option>)}</select></div>
          <div className="field"><label htmlFor="ct-val">Value</label><input id="ct-val" className="input" type="number" min={0} value={f.value} onChange={(e) => set('value', e.target.value)} /></div>
          <div className="field"><label htmlFor="ct-cur">Currency</label><select id="ct-cur" className="input" value={f.currency} onChange={(e) => set('currency', e.target.value)}>{['NGN', 'USD', 'GBP', 'EUR'].map((x) => <option key={x}>{x}</option>)}</select></div>
          <div className="field"><label htmlFor="ct-s">Start date</label><input id="ct-s" className="input" type="date" value={f.startDate} onChange={(e) => set('startDate', e.target.value)} /></div>
          <div className="field"><label htmlFor="ct-e">End date</label><input id="ct-e" className="input" type="date" min={f.startDate || undefined} value={f.endDate} onChange={(e) => set('endDate', e.target.value)} />{dateBad && <small role="alert" style={{ color: 'var(--danger)' }}>End date is before the start date.</small>}</div>
          <div className="field"><label htmlFor="ct-so">Signed on</label><input id="ct-so" className="input" type="date" value={f.signedOn} onChange={(e) => set('signedOn', e.target.value)} /></div>
          <div className="field"><label htmlFor="ct-sc">Signed for the client by</label><input id="ct-sc" className="input" value={f.signedByClient} onChange={(e) => set('signedByClient', e.target.value)} /></div>
          <div className="field"><label htmlFor="ct-su">Signed for us by</label><input id="ct-su" className="input" value={f.signedByUs} onChange={(e) => set('signedByUs', e.target.value)} /></div>
          <div className="field full"><label htmlFor="ct-n">Notes</label><textarea id="ct-n" className="input" rows={2} value={f.notes} onChange={(e) => set('notes', e.target.value)} /></div>
        </div>
      </fieldset>
      <div className="card" style={{ marginTop: 14 }}>
        <strong style={{ fontSize: 14 }}>Signed copy</strong>
        {!c?._id ? <p className="text-muted" style={{ fontSize: 13, margin: '6px 0 0' }}>Create the contract first, then attach the signed file.</p> : c.signedDocument?.url ? (
          <div className="flex-between" style={{ marginTop: 8, gap: 10 }}>
            <button type="button" className="btn btn-ghost btn-sm" onClick={() => openProtectedFile(c.signedDocument.url).catch((e) => showError(apiErrorMessage(e)))}><FileText size={14} /> {c.signedDocument.name}</button>
            <span className="text-muted" style={{ fontSize: 12 }}>{size(c.signedDocument.size || 0)} · {c.signedDocument.uploadedByName} · {fdate(c.signedDocument.uploadedAt)}</span>
            {canManage && <span className="row-gap"><FileUpload kind="document" multiple={false} label="Replace" accept=".pdf,.doc,.docx,.png,.jpg,.jpeg,.webp" onUploaded={attach} />{!['signed', 'active'].includes(c.status) && <button className="btn btn-ghost btn-sm" onClick={detach}>Remove</button>}</span>}
          </div>
        ) : (
          <div style={{ marginTop: 8 }}><p className="text-muted" style={{ fontSize: 13, margin: '0 0 8px' }}>PDF, Word document or a scan. 10 MB at most.</p>{canManage ? <FileUpload kind="document" multiple={false} label="Attach signed copy" accept=".pdf,.doc,.docx,.png,.jpg,.jpeg,.webp" onUploaded={attach} /> : <span className="text-muted">Nothing attached.</span>}</div>
        )}
      </div>
      {c?._id && <div className="card" style={{ marginTop: 14 }}><Discussion entityType="contract" entityId={c._id} scopeId={clientId} title="Contract conversation" /></div>}
    </Modal>
  );
}
