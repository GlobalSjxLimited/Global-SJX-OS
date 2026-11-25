import { useState } from 'react';
import { CheckCircle2, ClipboardSignature, Clock, Hourglass, PackageCheck, ShoppingBag } from 'lucide-react';
import { api, apiErrorMessage } from '@/lib/api';
import { useToast } from '@/context/ToastContext';
import { useApi } from '@/lib/useApi';
import { PageHead, Empty, Loading, ErrorNote } from '@/components/ui/PageHead';
import { Badge } from '@/components/ui/Badge';
import { Modal } from '@/components/ui/Modal';
import { fdate, label } from '@/lib/format';

const DONE = ['reclaimed', 'transferred', 'not_applicable', 'written_off'];
const HANDBACK = ['asset', 'personal_equipment', 'physical_info', 'credential', 'knowledge', 'other'];
const TRANSFER = ['task', 'approval', 'project', 'goal', 'risk'];
const KIND: Record<string, string> = { asset: 'Company equipment & software', task: 'Tasks to hand over', approval: 'Approvals to hand over', project: 'Projects you manage', goal: 'Goals you own', risk: 'Risks you own', access: 'Accounts & access', knowledge: 'Knowledge hand-over', personal_equipment: 'Your own devices used for work', physical_info: 'Paper & physical information', credential: 'Keys, cards & tokens', other: 'Other' };
const STATUS: Record<string, [string, any]> = { pending: ['To do', 'neutral'], submitted: ['Waiting for HR / IT to verify', 'gold'], reclaimed: ['Accepted', 'success'], transferred: ['Handed over', 'success'], not_applicable: ['Not applicable', 'neutral'], exception_requested: ['Exception requested', 'gold'], exception_approved: ['Extra time granted', 'accent'], written_off: ['Written off', 'danger'] };

/** The leaver's own page: the Return Asset Form (POL-5013 §2.2, 2.4, 2.5, 2.6). */
export function MyOffboarding() {
  const { data: c, loading, error, reload } = useApi<any>('/offboarding/mine');
  const { showError, showSuccess } = useToast();
  const [sub, setSub] = useState<any | null>(null);
  const [exc, setExc] = useState<any | null>(null);
  const [buy, setBuy] = useState<any | null>(null);
  const [signing, setSigning] = useState(false);
  if (loading && !c) return <Loading />;
  if (error) return <ErrorNote message={error} />;
  if (!c) return <div className="page-enter"><PageHead title="My offboarding" /><Empty icon={<PackageCheck />} title="Nothing to return" hint="You have no open offboarding. If you are leaving, HR will start it and everything you need to hand back will appear here." /></div>;
  const open = c.status === 'open';
  const items: any[] = c.items.filter((i: any) => i.required !== false);
  const mine = items.filter((i) => i.kind !== 'access' || !/login|module/i.test(i.label));
  const todo = mine.filter((i) => i.status === 'pending' || (i.status === 'exception_approved' && false));
  const allDeclared = mine.every((i) => DONE.includes(i.status) || ['submitted', 'exception_requested', 'exception_approved'].includes(i.status));
  const left = Math.ceil((new Date(c.lastWorkingDay).getTime() - Date.now()) / 86400000);
  const groups = Array.from(mine.reduce((m: Map<string, any[]>, i) => m.set(i.kind, [...(m.get(i.kind) || []), i]), new Map<string, any[]>()).entries());
  async function inventory(note: string) { try { await api.post('/offboarding/mine/inventory', { confirm: true, note: note || undefined }); showSuccess('Inventory signed. Thank you.'); setSigning(false); reload(); } catch (e) { showError(apiErrorMessage(e)); } }
  return (
    <div className="page-enter">
      <PageHead title="My offboarding — Return Asset Form" subtitle={`${c.reference} · last working day ${fdate(c.lastWorkingDay)}`} />
      <div className="card" style={{ borderLeft: `3px solid ${left < 0 ? 'var(--danger, #d6455d)' : 'var(--gold)'}`, marginBottom: 16, display: 'grid', gap: 6 }}>
        <strong>{!open ? `Your offboarding is ${c.status}.` : left < 0 ? 'Your last working day has passed — return everything now.' : left === 0 ? 'Today is your last working day.' : `${left} day${left === 1 ? '' : 's'} until your last working day.`}</strong>
        <div style={{ fontSize: 13, color: 'var(--muted)' }}>Company assets must be returned in good working condition, with all accessories, and with your personal data securely erased. Anything not returned by your last day may be treated as stolen. Work you hold is handed over by HR — you only need to add a short note. {open && 'Your access ends on your last working day, so complete this form before then.'}</div>
        <div style={{ fontSize: 13 }}>{mine.filter((i) => DONE.includes(i.status)).length} of {mine.length} items closed · {mine.filter((i) => i.status === 'submitted').length} waiting for verification · {todo.length} still to do</div>
      </div>
      {groups.map(([kind, list]) => (
        <div key={kind} style={{ marginBottom: 16 }}>
          <strong style={{ fontSize: 13.5 }}>{KIND[kind] || label(kind)}</strong>
          <div className="table-wrap" style={{ marginTop: 6 }}><table className="data-table"><tbody>{list.map((it: any) => (
            <tr key={it._id} style={{ cursor: 'default' }}>
              <td style={{ width: '46%' }}><strong style={{ fontWeight: 600 }}>{it.label}</strong>{it.detail && <div className="text-muted" style={{ fontSize: 12 }}>{it.detail}</div>}
                {it.rejectedNote && it.status === 'pending' && <div style={{ fontSize: 12.5, color: 'var(--danger, #d6455d)' }}>HR sent this back: {it.rejectedNote}</div>}
                {it.exception?.decision === 'denied' && <div style={{ fontSize: 12.5, color: 'var(--danger, #d6455d)' }}>Your exception request was declined{it.exception.note ? `: ${it.exception.note}` : '.'}</div>}
                {it.exception?.decision === 'approved' && it.exception.newDueDate && <div style={{ fontSize: 12.5 }}>Extra time until {fdate(it.exception.newDueDate)}</div>}
                {it.requiresWipe && !DONE.includes(it.status) && <div className="text-muted" style={{ fontSize: 12 }}>Erase all data with approved wiping software before you hand it in.</div>}</td>
              <td style={{ width: 200 }}><Badge tone={STATUS[it.status]?.[1]}>{STATUS[it.status]?.[0] || label(it.status)}</Badge>{it.transferToName && <div className="text-muted" style={{ fontSize: 12 }}>→ {it.transferToName}</div>}{it.condition && <div className="text-muted" style={{ fontSize: 12 }}>Condition: {label(it.condition)}</div>}</td>
              <td style={{ textAlign: 'right' }}>{open && !DONE.includes(it.status) && it.status !== 'submitted' && !(it.kind === 'access') && (
                <div style={{ display: 'flex', gap: 6, justifyContent: 'flex-end', flexWrap: 'wrap' }}>
                  <button className="btn btn-primary btn-sm" onClick={() => setSub(it)}>{TRANSFER.includes(it.kind) ? 'Add hand-over note' : it.kind === 'knowledge' ? 'Submit hand-over' : 'I have returned this'}</button>
                  {HANDBACK.includes(it.kind) && it.status !== 'exception_requested' && <button className="btn btn-ghost btn-sm" onClick={() => setExc(it)}><Clock size={13} /> Can't return in time</button>}
                  {it.kind === 'asset' && !it.purchase?.requested && <button className="btn btn-ghost btn-sm" onClick={() => setBuy(it)}><ShoppingBag size={13} /> I'd like to buy it</button>}
                </div>)}
                {it.status === 'submitted' && <span className="text-muted" style={{ fontSize: 12.5 }}><Hourglass size={12} style={{ verticalAlign: -2 }} /> With HR / IT</span>}
              </td>
            </tr>))}</tbody></table></div>
        </div>
      ))}
      <div className="card" style={{ display: 'flex', gap: 12, alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap' }}>
        <div><strong><ClipboardSignature size={15} style={{ verticalAlign: -3 }} /> Inventory declaration</strong>
          <div style={{ fontSize: 13, color: 'var(--muted)' }}>{c.inventory?.declaredAt ? `Signed on ${fdate(c.inventory.declaredAt)}.` : 'Sign to confirm that the list above is everything you hold and that you have returned or handed it all over.'}</div></div>
        {c.inventory?.declaredAt ? <Badge tone="success"><CheckCircle2 size={12} /> Signed</Badge> : <button className="btn btn-primary" disabled={!open || !allDeclared} title={allDeclared ? '' : 'Declare every item first'} onClick={() => setSigning(true)}>Sign inventory</button>}
      </div>
      {sub && <SubmitModal item={sub} onClose={() => setSub(null)} onDone={() => { setSub(null); reload(); }} />}
      {exc && <ExceptionModal item={exc} onClose={() => setExc(null)} onDone={() => { setExc(null); reload(); }} />}
      {buy && <PurchaseModal item={buy} onClose={() => setBuy(null)} onDone={() => { setBuy(null); reload(); }} />}
      {signing && <SignModal onClose={() => setSigning(false)} onSign={inventory} />}
    </div>
  );
}

function SubmitModal({ item, onClose, onDone }: { item: any; onClose: () => void; onDone: () => void }) {
  const { showError, showSuccess } = useToast();
  const handback = HANDBACK.includes(item.kind) && item.kind !== 'knowledge';
  const [f, setF] = useState<any>({ condition: 'good', medium: item.medium !== 'na' ? item.medium : 'physical', dataRemoved: false, note: '' });
  const set = (k: string, v: any) => setF((p: any) => ({ ...p, [k]: v }));
  async function save() {
    try { await api.post(`/offboarding/mine/items/${item._id}/submit`, { condition: item.kind === 'asset' ? f.condition : undefined, medium: handback ? f.medium : undefined, dataRemoved: item.requiresWipe ? f.dataRemoved : undefined, note: f.note || undefined }); showSuccess('Sent to HR / IT to verify.'); onDone(); }
    catch (e) { showError(apiErrorMessage(e)); }
  }
  return (
    <Modal open onClose={onClose} title={handback ? 'Declare as returned' : 'Hand-over note'} footer={<><button className="btn btn-ghost" onClick={onClose}>Cancel</button><button className="btn btn-primary" onClick={save}>Submit</button></>}>
      <div style={{ display: 'grid', gap: 12 }}>
        <div className="card" style={{ background: 'var(--surface-2)' }}><strong>{item.label}</strong>{item.detail && <div className="text-muted" style={{ fontSize: 12.5 }}>{item.detail}</div>}</div>
        {item.kind === 'asset' && <div className="field"><label>Condition *</label><select className="input" value={f.condition} onChange={(e) => set('condition', e.target.value)}><option value="good">Good — working, undamaged</option><option value="fair">Fair — minor wear</option><option value="damaged">Damaged</option></select></div>}
        {handback && <div className="field"><label>How are you returning it?</label><select className="input" value={f.medium} onChange={(e) => set('medium', e.target.value)}><option value="physical">Physical — handed in</option><option value="digital">Digital — transferred / uploaded</option><option value="both">Both</option></select></div>}
        {item.requiresWipe && <label style={{ display: 'flex', gap: 8, alignItems: 'flex-start', fontSize: 13 }}><input type="checkbox" checked={f.dataRemoved} onChange={(e) => set('dataRemoved', e.target.checked)} /> <span>I have securely erased my personal data and any company data using approved wiping software. I understand IT will verify this.</span></label>}
        <div className="field"><label>{handback ? (f.condition === 'damaged' ? 'Describe the damage *' : 'Note (e.g. where you left it, anything missing)') : 'Where things stand, what the next person must know *'}</label><textarea className="input" rows={4} value={f.note} onChange={(e) => set('note', e.target.value)} /></div>
      </div>
    </Modal>
  );
}

function ExceptionModal({ item, onClose, onDone }: { item: any; onClose: () => void; onDone: () => void }) {
  const { showError, showSuccess } = useToast();
  const [reason, setReason] = useState(''); const [due, setDue] = useState('');
  async function save() { try { await api.post(`/offboarding/mine/items/${item._id}/exception`, { reason, requestedDueDate: due || undefined }); showSuccess('Request sent to HR / IT.'); onDone(); } catch (e) { showError(apiErrorMessage(e)); } }
  return (
    <Modal open onClose={onClose} title="Request an exception" footer={<><button className="btn btn-ghost" onClick={onClose}>Cancel</button><button className="btn btn-primary" disabled={reason.trim().length < 10} onClick={save}>Send request</button></>}>
      <div style={{ display: 'grid', gap: 12 }}>
        <p className="text-muted" style={{ fontSize: 13, margin: 0 }}>Only for extenuating circumstances (illness, travel, equipment held by a third party…). HR / IT will review it. “{item.label}”</p>
        <div className="field"><label>What stops you returning it? *</label><textarea className="input" rows={4} value={reason} onChange={(e) => setReason(e.target.value)} /></div>
        <div className="field"><label>When can you return it?</label><input className="input" type="date" value={due} onChange={(e) => setDue(e.target.value)} /></div>
      </div>
    </Modal>
  );
}

function PurchaseModal({ item, onClose, onDone }: { item: any; onClose: () => void; onDone: () => void }) {
  const { showError, showSuccess } = useToast();
  const [price, setPrice] = useState(''); const [note, setNote] = useState('');
  async function save() { try { await api.post(`/offboarding/mine/items/${item._id}/purchase`, { agreedPrice: price === '' ? undefined : Number(price), note: note || undefined }); showSuccess('Request sent. Do not wipe the device yet — IT will move company data off it first.'); onDone(); } catch (e) { showError(apiErrorMessage(e)); } }
  return (
    <Modal open onClose={onClose} title="Request to buy this equipment" footer={<><button className="btn btn-ghost" onClick={onClose}>Cancel</button><button className="btn btn-primary" onClick={save}>Send request</button></>}>
      <div style={{ display: 'grid', gap: 12 }}>
        <p className="text-muted" style={{ fontSize: 13, margin: 0 }}>Ownership transfers only after IT has copied all company information off the device, erased it, and verified the erase. “{item.label}”</p>
        <div className="field"><label>Price you propose (optional)</label><input className="input" type="number" min="0" value={price} onChange={(e) => setPrice(e.target.value)} /></div>
        <div className="field"><label>Note</label><textarea className="input" rows={3} value={note} onChange={(e) => setNote(e.target.value)} /></div>
      </div>
    </Modal>
  );
}

function SignModal({ onClose, onSign }: { onClose: () => void; onSign: (note: string) => void }) {
  const [ok, setOk] = useState(false); const [note, setNote] = useState('');
  return (
    <Modal open onClose={onClose} title="Sign the inventory" footer={<><button className="btn btn-ghost" onClick={onClose}>Cancel</button><button className="btn btn-primary" disabled={!ok} onClick={() => onSign(note)}>Sign</button></>}>
      <div style={{ display: 'grid', gap: 12 }}>
        <label style={{ display: 'flex', gap: 8, alignItems: 'flex-start', fontSize: 13.5 }}><input type="checkbox" checked={ok} onChange={(e) => setOk(e.target.checked)} /> <span>I confirm that the list on this page is a complete inventory of the company assets, information and access in my possession, and that I have returned or handed over everything on it. I understand that anything not returned may be treated as stolen.</span></label>
        <div className="field"><label>Anything else HR should know</label><textarea className="input" rows={3} value={note} onChange={(e) => setNote(e.target.value)} /></div>
      </div>
    </Modal>
  );
}
