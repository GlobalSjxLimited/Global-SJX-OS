import { useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { AlertTriangle, ArrowRightLeft, BellRing, CheckCircle2, ClipboardCheck, FileDown, LogOut, Plus, ShieldOff, UserMinus, XCircle } from 'lucide-react';
import { api, apiErrorMessage } from '@/lib/api';
import { useAuth } from '@/context/AuthContext';
import { useToast } from '@/context/ToastContext';
import { useConfirm } from '@/context/ConfirmContext';
import { useApi } from '@/lib/useApi';
import { PageHead, Tabs, Empty, Loading, ErrorNote, Kv } from '@/components/ui/PageHead';
import { Badge } from '@/components/ui/Badge';
import { Modal } from '@/components/ui/Modal';
import { fdate, fdatetime, filenameFrom, label, saveBlob, toInputDate } from '@/lib/format';

const CASE_TYPES = ['resignation', 'termination', 'contract_end', 'retirement', 'transfer_out', 'other'];
const ITEM_TONE: Record<string, any> = { pending: 'neutral', submitted: 'gold', reclaimed: 'success', transferred: 'success', not_applicable: 'neutral', exception_requested: 'gold', exception_approved: 'accent', written_off: 'danger' };
const ITEM_LABEL: Record<string, string> = { pending: 'Not yet returned', submitted: 'Awaiting verification', reclaimed: 'Reclaimed', transferred: 'Handed over', not_applicable: 'Not applicable', exception_requested: 'Exception requested', exception_approved: 'Exception approved', written_off: 'Written off' };
const KIND_LABEL: Record<string, string> = { asset: 'Assets', task: 'Tasks', approval: 'Approvals', project: 'Projects', goal: 'Goals', risk: 'Risks', access: 'Access & accounts', knowledge: 'Knowledge hand-over', personal_equipment: 'Personal equipment', physical_info: 'Physical information', credential: 'Keys & cards', other: 'Other' };
const TRANSFER = ['task', 'approval', 'project', 'goal', 'risk'];
const DONE = ['reclaimed', 'transferred', 'not_applicable', 'written_off'];
const MEDIUM_LABEL: Record<string, string> = { physical: 'Physical', digital: 'Digital', both: 'Physical & digital', na: '—' };

const daysTo = (d: string) => Math.ceil((new Date(d).getTime() - Date.now()) / 86400000);
const dueTone = (c: any) => (c.status !== 'open' ? 'neutral' : daysTo(c.lastWorkingDay) < 0 ? 'danger' : daysTo(c.lastWorkingDay) <= 7 ? 'gold' : 'neutral');
const dueText = (c: any) => { const d = daysTo(c.lastWorkingDay); return c.status !== 'open' ? label(c.status) : d < 0 ? `${-d}d past last day` : d === 0 ? 'Last day today' : `${d}d left`; };

export function Offboarding() {
  const [params, setParams] = useSearchParams();
  const { user } = useAuth();
  const [tab, setTab] = useState('open');
  const [startFor, setStartFor] = useState<string | null>(params.get('start'));
  const [starting, setStarting] = useState(!!params.get('start'));
  const [openId, setOpenId] = useState<string | null>(params.get('case'));
  const cases = useApi<any[]>('/offboarding', tab === 'open' ? { status: 'open' } : tab === 'cleared' ? { status: 'cleared' } : undefined);
  const queue = useApi<any[]>('/offboarding/queue');
  const reload = () => { cases.reload(); queue.reload(); };
  useEffect(() => { if (params.get('start') || params.get('case')) setParams({}, { replace: true }); /* eslint-disable-next-line */ }, []);
  const q = queue.data || [];
  return (
    <div className="page-enter">
      <PageHead title="Offboarding & return of assets"
        subtitle="Everything assigned to a leaver — assets, tasks, approvals, projects, access — is listed, handed back or reassigned, verified by HR / IT, and access is switched off (ISO 27001 A.5.11, A.5.18, A.6.5 · POL-5013, POL-5016)."
        actions={<button className="btn btn-primary" onClick={() => { setStartFor(null); setStarting(true); }}><UserMinus size={16} /> Start offboarding</button>} />
      <Tabs value={tab} onChange={setTab} tabs={[{ key: 'open', label: 'Open cases' }, { key: 'queue', label: 'Awaiting verification', count: q.length }, { key: 'cleared', label: 'Cleared' }, { key: 'all', label: 'All' }]} />
      <ErrorNote message={cases.error || queue.error} />
      {tab === 'queue' ? (
        queue.loading && !queue.data ? <Loading /> : !q.length ? <Empty icon={<ClipboardCheck />} title="Nothing waiting for you" hint="When a leaver declares an item returned, it appears here for you to verify and record its condition." /> : (
          <div className="table-wrap"><table className="data-table"><thead><tr><th>Leaver</th><th>Item</th><th>Medium</th><th>Declared</th><th>Waiting since</th><th>Last day</th></tr></thead>
            <tbody>{q.map((r) => <tr key={`${r.caseId}-${r.itemId}`} onClick={() => setOpenId(r.caseId)}>
              <td><strong>{r.employeeName}</strong><div className="text-muted mono" style={{ fontSize: 12 }}>{r.reference}</div></td>
              <td>{r.label}<div className="text-muted" style={{ fontSize: 12 }}>{label(r.kind)}</div></td><td>{MEDIUM_LABEL[r.medium] || '—'}</td>
              <td>{r.status === 'exception_requested' ? <Badge tone="gold">Exception request</Badge> : r.purchase ? <Badge tone="accent">Purchase</Badge> : r.declaredCondition ? label(r.declaredCondition) : '—'}</td>
              <td>{fdate(r.since)}</td><td>{fdate(r.lastWorkingDay)}</td></tr>)}</tbody></table></div>)
      ) : cases.loading && !cases.data ? <Loading /> : !cases.data?.length ? <Empty icon={<LogOut />} title="No cases here" hint="Start an offboarding 30 days before someone leaves so they can return everything by their last day." /> : (
        <div className="table-wrap"><table className="data-table"><thead><tr><th>Case</th><th>Leaver</th><th>Type</th><th>Last day</th><th>Progress</th><th>Awaiting you</th><th>Access</th></tr></thead>
          <tbody>{cases.data.map((c) => <tr key={c._id} onClick={() => setOpenId(c._id)}>
            <td className="mono">{c.reference}</td><td><strong>{c.employeeName}</strong><div className="text-muted" style={{ fontSize: 12 }}>{c.department || c.jobTitle || ''}</div></td>
            <td>{label(c.type)}</td><td>{fdate(c.lastWorkingDay)} <Badge tone={dueTone(c)}>{dueText(c)}</Badge></td>
            <td style={{ minWidth: 150 }}><Progress p={c.progress} /></td>
            <td>{c.progress?.awaitingApproval ? <Badge tone="gold">{c.progress.awaitingApproval} to verify</Badge> : c.progress?.exceptions ? <Badge tone="gold">{c.progress.exceptions} exception</Badge> : '—'}</td>
            <td>{c.access?.revokedAt ? <Badge tone="success">Switched off</Badge> : <Badge>Active</Badge>}</td></tr>)}</tbody></table></div>
      )}
      {starting && <StartModal initial={startFor} onClose={() => setStarting(false)} onStarted={(id) => { setStarting(false); reload(); setOpenId(id); }} />}
      {openId && <CaseModal id={openId} me={user?.id || ''} role={user?.role || ''} onClose={() => setOpenId(null)} onChanged={reload} />}
    </div>
  );
}

function Progress({ p }: { p?: any }) {
  if (!p) return null;
  return <div><div style={{ height: 6, background: 'var(--border)', borderRadius: 4, overflow: 'hidden' }}><div style={{ width: `${p.percent}%`, height: '100%', background: p.percent === 100 ? 'var(--success, #2e9e6b)' : 'var(--accent, #C22FD4)' }} /></div><div className="text-muted" style={{ fontSize: 11.5, marginTop: 3 }}>{p.done} of {p.total} · {p.percent}%</div></div>;
}

/* ------------------------------ start a case ------------------------------ */
function StartModal({ initial, onClose, onStarted }: { initial: string | null; onClose: () => void; onStarted: (id: string) => void }) {
  const { showError, showSuccess } = useToast();
  const people = useApi<any[]>('/employees/directory/list');
  const inThirty = toInputDate(new Date(Date.now() + 30 * 86400000));
  const [f, setF] = useState<any>({ employeeId: initial || '', type: 'resignation', lastWorkingDay: inThirty, reason: '', immediate: false });
  const set = (k: string, v: any) => setF((p: any) => ({ ...p, [k]: v }));
  async function save() {
    try { const r = await api.post('/offboarding', { ...f, lastWorkingDay: f.immediate ? toInputDate(new Date()) : f.lastWorkingDay }); showSuccess(`${r.data.data.reference} opened — the leaver has been told what to return.`); onStarted(r.data.data._id); }
    catch (e) { showError(apiErrorMessage(e)); }
  }
  return (
    <Modal open onClose={onClose} title="Start offboarding" footer={<><button className="btn btn-ghost" onClick={onClose}>Cancel</button><button className="btn btn-primary" disabled={!f.employeeId} onClick={save}>Open case</button></>}>
      <div style={{ display: 'grid', gap: 12 }}>
        <p className="text-muted" style={{ fontSize: 13, margin: 0 }}>A checklist is built automatically from everything assigned to this person: assets, open tasks, approvals, projects, goals and risks, plus the policy items (keys, papers, personal equipment, knowledge hand-over) and their accounts. The leaver receives the Return Asset Form.</p>
        <div className="field"><label>Employee *</label><select className="input" value={f.employeeId} onChange={(e) => set('employeeId', e.target.value)}><option value="">Select person…</option>{(people.data || []).map((p) => <option key={p._id} value={p._id}>{p.name}{p.jobTitle ? ` — ${p.jobTitle}` : ''}</option>)}</select></div>
        <div className="grid-2">
          <div className="field"><label>Reason for leaving</label><select className="input" value={f.type} onChange={(e) => set('type', e.target.value)}>{CASE_TYPES.map((t) => <option key={t} value={t}>{label(t)}</option>)}</select></div>
          <div className="field"><label>Last working day *</label><input className="input" type="date" disabled={f.immediate} value={f.immediate ? toInputDate(new Date()) : f.lastWorkingDay} onChange={(e) => set('lastWorkingDay', e.target.value)} /></div>
        </div>
        <label style={{ display: 'flex', gap: 8, alignItems: 'center', fontSize: 13 }}><input type="checkbox" checked={f.immediate} onChange={(e) => set('immediate', e.target.checked)} /> Immediate exit — access is switched off straight away (summary dismissal, security risk)</label>
        <div className="field"><label>Note</label><input className="input" value={f.reason} onChange={(e) => set('reason', e.target.value)} placeholder="Optional" /></div>
      </div>
    </Modal>
  );
}

/* --------------------------------- the case -------------------------------- */
type Mode = 'reclaim' | 'reject' | 'transfer' | 'na' | 'exception' | 'purchase' | 'writeoff' | 'escalate';
function CaseModal({ id, me, role, onClose, onChanged }: { id: string; me: string; role: string; onClose: () => void; onChanged: () => void }) {
  const { showError, showSuccess } = useToast();
  const confirm = useConfirm();
  const { data: c, loading, error, reload } = useApi<any>(`/offboarding/${id}`);
  const [act, setAct] = useState<{ mode: Mode; item: any } | null>(null);
  const [bulk, setBulk] = useState(false);
  const [adding, setAdding] = useState(false);
  const [clearing, setClearing] = useState(false);
  const [cancelling, setCancelling] = useState(false);
  const top = ['super_admin', 'ceo'].includes(role); const leader = top || role === 'coo';
  const self = c && c.employeeId === me;
  const done = () => { reload(); onChanged(); };
  async function call(fn: () => Promise<any>, ok: string) { try { await fn(); showSuccess(ok); done(); } catch (e) { showError(apiErrorMessage(e)); } }
  async function pdf() { try { const r = await api.get(`/offboarding/${id}/record.pdf`, { responseType: 'blob' }); saveBlob(r.data, filenameFrom(r.headers['content-disposition'], `${c.reference}.pdf`)); } catch (e) { showError(apiErrorMessage(e)); } }
  const groups = useMemo(() => { const m = new Map<string, any[]>(); (c?.items || []).forEach((i: any) => { if (!m.has(i.kind)) m.set(i.kind, []); m.get(i.kind)!.push(i); }); return Array.from(m.entries()); }, [c]);
  const open = c?.status === 'open';
  return (
    <Modal open onClose={onClose} title={c ? `${c.reference} · ${c.employeeName}` : 'Offboarding'} size="xwide"
      footer={c && open && !self ? <>
        <button className="btn btn-ghost" onClick={pdf}><FileDown size={14} /> Return record</button>
        <button className="btn btn-ghost" onClick={() => setCancelling(true)}><XCircle size={14} /> Cancel case</button>
        <button className="btn btn-primary" onClick={() => setClearing(true)}><CheckCircle2 size={14} /> Clear leaver</button>
      </> : c ? <button className="btn btn-ghost" onClick={pdf}><FileDown size={14} /> Return record (PDF)</button> : undefined}>
      {loading && !c ? <Loading /> : error ? <ErrorNote message={error} /> : c && (
        <div style={{ display: 'grid', gap: 16 }}>
          {self && <div className="card" style={{ borderLeft: '3px solid var(--gold)' }}>Four-eyes control: this is your own offboarding, so someone else must verify and clear it.</div>}
          <div className="grid-2">
            <Kv rows={[['Leaver', c.employeeName], ['Department', c.department], ['Reason', label(c.type)], ['Last working day', <>{fdate(c.lastWorkingDay)} <Badge tone={dueTone(c)}>{dueText(c)}</Badge></>], ['Opened by', `${c.initiatedByName || '—'} · ${fdate(c.createdAt)}`]]} />
            <Kv rows={[['Status', <Badge tone={c.status === 'cleared' ? 'success' : c.status === 'cancelled' ? 'neutral' : 'gold'}>{label(c.status)}</Badge>], ['Progress', <Progress p={c.progress} />],
              ['Inventory signed', c.inventory?.declaredAt ? <Badge tone="success">{fdate(c.inventory.declaredAt)}</Badge> : <Badge tone="gold">Not yet</Badge>],
              ['Access', c.access?.revokedAt ? <Badge tone="success">Switched off {fdate(c.access.revokedAt)}</Badge> : <Badge tone="danger">Still active</Badge>], ['Cleared', c.clearedAt ? `${fdate(c.clearedAt)} by ${c.clearedByName}${c.clearedWithExceptions ? ' (with exceptions)' : ''}` : '—']]} />
          </div>
          {open && !self && (
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              <button className="btn btn-ghost btn-sm" onClick={() => setBulk(true)}><ArrowRightLeft size={13} /> Reassign all work</button>
              <button className="btn btn-ghost btn-sm" onClick={() => setAdding(true)}><Plus size={13} /> Add item</button>
              <button className="btn btn-ghost btn-sm" onClick={() => call(() => api.post(`/offboarding/${id}/remind`, {}), 'Reminder sent to the leaver.')}><BellRing size={13} /> Remind leaver</button>
              <button className="btn btn-ghost btn-sm" onClick={() => call(() => api.post(`/offboarding/${id}/refresh`, {}), 'Checklist refreshed.')}>Refresh checklist{c.unlisted ? ` (+${c.unlisted} new)` : ''}</button>
              {!c.access?.revokedAt && <button className="btn btn-danger btn-sm" onClick={async () => { if (await confirm({ title: 'Switch off access now?', message: `${c.employeeName} is signed out everywhere, their account is deactivated and module access is removed. Make sure they have completed their return form first.`, danger: true, confirmLabel: 'Switch off access' })) call(() => api.post(`/offboarding/${id}/access/revoke`, {}), 'Access switched off.'); }}><ShieldOff size={13} /> Switch off access</button>}
            </div>
          )}
          {open && c.blockers?.length > 0 && <div className="card" style={{ background: 'var(--surface-2)' }}><strong style={{ fontSize: 13 }}><AlertTriangle size={13} style={{ verticalAlign: -2 }} /> Before this can be cleared</strong><ul style={{ margin: '6px 0 0', paddingLeft: 18, fontSize: 12.5, color: 'var(--muted)' }}>{c.blockers.map((b: string, i: number) => <li key={i}>{b}</li>)}</ul></div>}
          {groups.map(([kind, items]) => (
            <div key={kind}>
              <strong style={{ fontSize: 13 }}>{KIND_LABEL[kind] || label(kind)} <span className="text-muted">({items.filter((i: any) => DONE.includes(i.status)).length}/{items.length})</span></strong>
              <div className="table-wrap" style={{ marginTop: 6 }}><table className="data-table"><tbody>{items.map((it: any) => (
                <tr key={it._id} style={{ cursor: 'default' }}>
                  <td style={{ width: '42%' }}><strong style={{ fontWeight: 600 }}>{it.label}</strong>{it.detail && <div className="text-muted" style={{ fontSize: 12 }}>{it.detail}</div>}
                    {it.rejectedNote && it.status === 'pending' && <div style={{ fontSize: 12, color: 'var(--danger, #d6455d)' }}>Sent back: {it.rejectedNote}</div>}
                    {it.exception?.reason && <div className="text-muted" style={{ fontSize: 12 }}>Exception: {it.exception.reason}{it.exception.decision ? ` — ${it.exception.decision}` : ''}</div>}
                    {it.purchase?.requested && <div className="text-muted" style={{ fontSize: 12 }}>Wants to buy this{it.purchase.agreedPrice != null ? ` at ${it.purchase.agreedPrice}` : ''}{it.purchase.approvedAt ? ' — approved' : ''}</div>}</td>
                  <td style={{ width: 150 }}><Badge tone={ITEM_TONE[it.status]}>{ITEM_LABEL[it.status] || label(it.status)}</Badge></td>
                  <td style={{ fontSize: 12.5 }}>
                    {it.medium && it.medium !== 'na' && <div>{MEDIUM_LABEL[it.verifiedMedium || it.declaredMedium || it.medium]}{it.requiresWipe ? ' · data wipe required' : ''}</div>}
                    {it.submittedAt && <div className="text-muted">Declared {fdate(it.submittedAt)}{it.declaredCondition ? ` · ${label(it.declaredCondition)}` : ''}{it.dataRemoved ? ' · data removed' : ''}</div>}
                    {it.decidedAt && <div className="text-muted">{it.condition ? `${label(it.condition)} · ` : ''}{it.dataWipeVerified ? `wipe verified (${it.wipeMethod || '—'}) · ` : ''}{it.decidedByName} {fdate(it.decidedAt)}</div>}
                    {it.transferToName && <div className="text-muted">→ {it.transferToName}</div>}
                    {it.submittedNote && <div className="text-muted">“{it.submittedNote}”</div>}
                  </td>
                  <td style={{ textAlign: 'right', whiteSpace: 'nowrap' }}>{open && !self && !DONE.includes(it.status) && (
                    <div style={{ display: 'flex', gap: 6, justifyContent: 'flex-end', flexWrap: 'wrap' }}>
                      {TRANSFER.includes(it.kind)
                        ? <button className="btn btn-primary btn-sm" onClick={() => setAct({ mode: 'transfer', item: it })}>Reassign</button>
                        : it.status === 'exception_requested' ? <button className="btn btn-primary btn-sm" onClick={() => setAct({ mode: 'exception', item: it })}>Decide exception</button>
                        : it.purchase?.requested && !it.purchase.approvedAt ? <button className="btn btn-primary btn-sm" onClick={() => setAct({ mode: 'purchase', item: it })}>Decide purchase</button>
                        : it.kind === 'access' ? null : <button className="btn btn-primary btn-sm" onClick={() => setAct({ mode: 'reclaim', item: it })}>{it.status === 'submitted' ? 'Verify & accept' : 'Mark reclaimed'}</button>}
                      {it.status === 'submitted' && !TRANSFER.includes(it.kind) && <button className="btn btn-ghost btn-sm" onClick={() => setAct({ mode: 'reject', item: it })}>Send back</button>}
                      <button className="btn btn-ghost btn-sm" onClick={() => setAct({ mode: 'na', item: it })}>N/A</button>
                      {it.kind === 'asset' && leader && <button className="btn btn-ghost btn-sm" onClick={() => setAct({ mode: 'writeoff', item: it })}>Write off</button>}
                      {it.status === 'pending' && isOverdue(c) && it.kind === 'asset' && <button className="btn btn-ghost btn-sm" onClick={() => setAct({ mode: 'escalate', item: it })}>Escalate</button>}
                    </div>)}
                    {it.kind === 'access' && it.status === 'pending' && open && !self && <button className="btn btn-ghost btn-sm" onClick={() => setAct({ mode: 'reclaim', item: it })}>Confirm done</button>}
                  </td>
                </tr>))}</tbody></table></div>
            </div>
          ))}
          <div><strong style={{ fontSize: 13 }}>Timeline (kept for 5 years)</strong>
            <ul style={{ fontSize: 12.5, color: 'var(--muted)', paddingLeft: 18 }}>{[...(c.timeline || [])].reverse().slice(0, 40).map((t: any, i: number) => <li key={i}>{fdatetime(t.at)} — {t.byName || 'System'}: {label(t.action)}{t.note ? ` (${t.note})` : ''}</li>)}</ul></div>
        </div>
      )}
      {act && c && <ItemAction caseId={id} mode={act.mode} item={act.item} onClose={() => setAct(null)} onDone={() => { setAct(null); done(); }} />}
      {bulk && c && <BulkTransfer caseId={id} name={c.employeeName} onClose={() => setBulk(false)} onDone={() => { setBulk(false); done(); }} />}
      {adding && <AddItem caseId={id} onClose={() => setAdding(false)} onDone={() => { setAdding(false); done(); }} />}
      {cancelling && <CancelModal caseId={id} onClose={() => setCancelling(false)} onDone={() => { setCancelling(false); done(); }} />}
      {clearing && c && <ClearModal c={c} top={top} onClose={() => setClearing(false)} onDone={() => { setClearing(false); done(); }} />}
    </Modal>
  );
}
const isOverdue = (c: any) => c.status === 'open' && daysTo(c.lastWorkingDay) < 0;

function ItemAction({ caseId, mode, item, onClose, onDone }: { caseId: string; mode: Mode; item: any; onClose: () => void; onDone: () => void }) {
  const { showError, showSuccess } = useToast();
  const people = useApi<any[]>(mode === 'transfer' ? '/employees/directory/list' : null);
  const isAsset = item.kind === 'asset' || item.requiresWipe;
  const [f, setF] = useState<any>({ condition: item.declaredCondition && item.declaredCondition !== 'lost' ? item.declaredCondition : 'good', medium: item.declaredMedium || (item.medium !== 'na' ? item.medium : 'physical'), dataWipeVerified: false, wipeMethod: '', wipeReference: '', accessoriesComplete: true, note: '', toUserId: '', decision: 'approved', newDueDate: '', approve: true, dataTransferred: false, agreedPrice: '' });
  const set = (k: string, v: any) => setF((p: any) => ({ ...p, [k]: v }));
  const base = `/offboarding/${caseId}/items/${item._id}`;
  const cfg: Record<Mode, { title: string; cta: string; path: string; body: () => any; ok: string }> = {
    reclaim: { title: item.kind === 'access' ? 'Confirm access item done' : 'Verify & record reclaim', cta: item.kind === 'access' ? 'Confirm' : 'Accept as reclaimed', path: '/reclaim', ok: 'Recorded as reclaimed.',
      body: () => (item.kind === 'access' ? { condition: 'good', medium: 'digital', note: f.note } : { condition: f.condition, medium: f.medium, dataWipeVerified: item.requiresWipe ? f.dataWipeVerified : undefined, wipeMethod: f.wipeMethod || undefined, wipeReference: f.wipeReference || undefined, accessoriesComplete: item.kind === 'asset' && f.medium === 'physical' ? f.accessoriesComplete : undefined, note: f.note || undefined }) },
    reject: { title: 'Send back to the leaver', cta: 'Send back', path: '/reject', ok: 'Sent back to the leaver.', body: () => ({ note: f.note }) },
    transfer: { title: 'Reassign to someone else', cta: 'Reassign', path: '/transfer', ok: 'Reassigned — the new owner has been notified.', body: () => ({ toUserId: f.toUserId, note: f.note || undefined }) },
    na: { title: 'Mark not applicable', cta: 'Mark N/A', path: '/not-applicable', ok: 'Marked not applicable.', body: () => ({ reason: f.note }) },
    exception: { title: 'Decide the exception request', cta: 'Record decision', path: '/exception/decide', ok: 'Decision recorded.', body: () => ({ decision: f.decision, note: f.note || undefined, newDueDate: f.decision === 'approved' && f.newDueDate ? f.newDueDate : undefined }) },
    purchase: { title: 'Decide the purchase', cta: 'Record decision', path: '/purchase/decide', ok: 'Decision recorded.', body: () => ({ approve: f.approve, dataTransferred: f.dataTransferred, dataWipeVerified: f.dataWipeVerified, wipeMethod: f.wipeMethod || undefined, wipeReference: f.wipeReference || undefined, agreedPrice: f.agreedPrice === '' ? undefined : Number(f.agreedPrice), note: f.note || undefined }) },
    writeoff: { title: 'Write off — not recovered', cta: 'Write off & open incident', path: '/write-off', ok: 'Written off; an incident has been opened.', body: () => ({ reason: f.note }) },
    escalate: { title: 'Escalate a missing item', cta: 'Escalate', path: '/escalate', ok: 'Escalated to leadership.', body: () => ({ note: f.note }) },
  };
  const c = cfg[mode];
  async function save() { try { await api.post(`${base}${c.path}`, c.body()); showSuccess(c.ok); onDone(); } catch (e) { showError(apiErrorMessage(e)); } }
  const noteLabel = { reclaim: 'Note (required if damaged or accessories missing)', reject: 'What is wrong? *', transfer: 'Hand-over note', na: 'Why does this not apply? *', exception: 'Decision note', purchase: 'Note', writeoff: 'What was done to recover it, and why can it not be recovered? *', escalate: 'What have you tried? *' }[mode];
  return (
    <Modal open onClose={onClose} title={c.title} footer={<><button className="btn btn-ghost" onClick={onClose}>Cancel</button><button className={mode === 'writeoff' ? 'btn btn-danger' : 'btn btn-primary'} onClick={save}>{c.cta}</button></>}>
      <div style={{ display: 'grid', gap: 12 }}>
        <div className="card" style={{ background: 'var(--surface-2)' }}><strong>{item.label}</strong>{item.detail && <div className="text-muted" style={{ fontSize: 12.5 }}>{item.detail}</div>}
          {item.submittedAt && <div style={{ fontSize: 12.5, marginTop: 4 }}>The leaver says: {item.declaredCondition ? label(item.declaredCondition) : 'returned'}{item.dataRemoved ? ', data removed' : ''}{item.submittedNote ? ` — “${item.submittedNote}”` : ''}</div>}
          {item.exception?.reason && mode === 'exception' && <div style={{ fontSize: 12.5, marginTop: 4 }}>Reason given: “{item.exception.reason}”{item.exception.requestedDueDate ? ` · asks until ${fdate(item.exception.requestedDueDate)}` : ''}</div>}</div>
        {mode === 'reclaim' && item.kind !== 'access' && <>
          <div className="grid-2">
            <div className="field"><label>Condition *</label><select className="input" value={f.condition} onChange={(e) => set('condition', e.target.value)}><option value="good">Good — working, undamaged</option><option value="fair">Fair — minor wear</option><option value="damaged">Damaged (goes to maintenance)</option></select></div>
            <div className="field"><label>Physical or digital</label><select className="input" value={f.medium} onChange={(e) => set('medium', e.target.value)}><option value="physical">Physical</option><option value="digital">Digital</option><option value="both">Both</option></select></div>
          </div>
          {item.requiresWipe && <div className="card" style={{ display: 'grid', gap: 8, borderLeft: '3px solid var(--gold)' }}>
            <label style={{ display: 'flex', gap: 8, alignItems: 'flex-start', fontSize: 13 }}><input type="checkbox" checked={f.dataWipeVerified} onChange={(e) => set('dataWipeVerified', e.target.checked)} /> <span>I verified that all personal and company data was securely erased with approved wiping software (policy 2.2).</span></label>
            <div className="grid-2"><div className="field"><label>Wipe method / tool {f.dataWipeVerified && '*'}</label><input className="input" value={f.wipeMethod} onChange={(e) => set('wipeMethod', e.target.value)} placeholder="e.g. BitLocker crypto-erase, DBAN" /></div><div className="field"><label>Certificate / ticket ref.</label><input className="input" value={f.wipeReference} onChange={(e) => set('wipeReference', e.target.value)} /></div></div></div>}
          {item.kind === 'asset' && f.medium !== 'digital' && <label style={{ display: 'flex', gap: 8, alignItems: 'center', fontSize: 13 }}><input type="checkbox" checked={f.accessoriesComplete} onChange={(e) => set('accessoriesComplete', e.target.checked)} /> All original accessories returned (charger, cables, bag, licence media)</label>}
        </>}
        {mode === 'transfer' && <div className="field"><label>Reassign to *</label><select className="input" value={f.toUserId} onChange={(e) => set('toUserId', e.target.value)}><option value="">Select person…</option>{(people.data || []).map((p) => <option key={p._id} value={p._id}>{p.name}</option>)}</select></div>}
        {mode === 'exception' && <><div className="field"><label>Decision</label><select className="input" value={f.decision} onChange={(e) => set('decision', e.target.value)}><option value="approved">Approve — allow more time</option><option value="denied">Deny — must be returned</option></select></div>
          {f.decision === 'approved' && <div className="field"><label>New deadline</label><input className="input" type="date" value={f.newDueDate} onChange={(e) => set('newDueDate', e.target.value)} /></div>}</>}
        {mode === 'purchase' && <>
          <div className="field"><label>Decision</label><select className="input" value={f.approve ? 'y' : 'n'} onChange={(e) => set('approve', e.target.value === 'y')}><option value="y">Approve the purchase</option><option value="n">Decline</option></select></div>
          {f.approve && <div className="card" style={{ display: 'grid', gap: 8 }}>
            <label style={{ display: 'flex', gap: 8, fontSize: 13 }}><input type="checkbox" checked={f.dataTransferred} onChange={(e) => set('dataTransferred', e.target.checked)} /> All company information has been transferred off the device</label>
            <label style={{ display: 'flex', gap: 8, fontSize: 13 }}><input type="checkbox" checked={f.dataWipeVerified} onChange={(e) => set('dataWipeVerified', e.target.checked)} /> Securely erased and verified</label>
            <div className="grid-2"><div className="field"><label>Wipe method</label><input className="input" value={f.wipeMethod} onChange={(e) => set('wipeMethod', e.target.value)} /></div><div className="field"><label>Agreed price</label><input className="input" type="number" min="0" value={f.agreedPrice} onChange={(e) => set('agreedPrice', e.target.value)} /></div></div></div>}</>}
        <div className="field"><label>{noteLabel}</label><textarea className="input" rows={3} value={f.note} onChange={(e) => set('note', e.target.value)} /></div>
        {isAsset && mode === 'writeoff' && <p className="text-muted" style={{ fontSize: 12.5, margin: 0 }}>The asset is retired from the register and a “lost device” incident is opened automatically.</p>}
      </div>
    </Modal>
  );
}

function BulkTransfer({ caseId, name, onClose, onDone }: { caseId: string; name: string; onClose: () => void; onDone: () => void }) {
  const { showError, showSuccess } = useToast();
  const people = useApi<any[]>('/employees/directory/list');
  const [to, setTo] = useState(''); const [note, setNote] = useState(''); const [kinds, setKinds] = useState<string[]>(TRANSFER);
  async function save() { try { const r = await api.post(`/offboarding/${caseId}/bulk-transfer`, { toUserId: to, kinds, note: note || undefined }); showSuccess(`Reassigned ${r.data.moved ?? 0} item(s).`); onDone(); } catch (e) { showError(apiErrorMessage(e)); } }
  return (
    <Modal open onClose={onClose} title={`Reassign ${name}'s work`} footer={<><button className="btn btn-ghost" onClick={onClose}>Cancel</button><button className="btn btn-primary" disabled={!to || !kinds.length} onClick={save}>Reassign</button></>}>
      <div style={{ display: 'grid', gap: 12 }}>
        <div className="field"><label>New owner *</label><select className="input" value={to} onChange={(e) => setTo(e.target.value)}><option value="">Select person…</option>{(people.data || []).map((p) => <option key={p._id} value={p._id}>{p.name}</option>)}</select></div>
        <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>{TRANSFER.map((k) => <label key={k} style={{ display: 'flex', gap: 6, fontSize: 13 }}><input type="checkbox" checked={kinds.includes(k)} onChange={(e) => setKinds(e.target.checked ? [...kinds, k] : kinds.filter((x) => x !== k))} /> {KIND_LABEL[k]}</label>)}</div>
        <div className="field"><label>Note for the new owner</label><textarea className="input" rows={2} value={note} onChange={(e) => setNote(e.target.value)} /></div>
        <p className="text-muted" style={{ fontSize: 12.5, margin: 0 }}>Assets are not moved this way — each one has to be handed back, checked and wiped.</p>
      </div>
    </Modal>
  );
}

function AddItem({ caseId, onClose, onDone }: { caseId: string; onClose: () => void; onDone: () => void }) {
  const { showError, showSuccess } = useToast();
  const [f, setF] = useState<any>({ kind: 'other', label: '', detail: '', medium: 'physical', requiresWipe: false });
  const set = (k: string, v: any) => setF((p: any) => ({ ...p, [k]: v }));
  async function save() { try { await api.post(`/offboarding/${caseId}/items`, f); showSuccess('Item added.'); onDone(); } catch (e) { showError(apiErrorMessage(e)); } }
  return (
    <Modal open onClose={onClose} title="Add an item to the checklist" footer={<><button className="btn btn-ghost" onClick={onClose}>Cancel</button><button className="btn btn-primary" disabled={f.label.trim().length < 2} onClick={save}>Add</button></>}>
      <div style={{ display: 'grid', gap: 12 }}>
        <div className="grid-2"><div className="field"><label>Kind</label><select className="input" value={f.kind} onChange={(e) => set('kind', e.target.value)}>{['credential', 'physical_info', 'personal_equipment', 'knowledge', 'other'].map((k) => <option key={k} value={k}>{KIND_LABEL[k]}</option>)}</select></div>
          <div className="field"><label>Physical or digital</label><select className="input" value={f.medium} onChange={(e) => set('medium', e.target.value)}><option value="physical">Physical</option><option value="digital">Digital</option><option value="both">Both</option><option value="na">Not applicable</option></select></div></div>
        <div className="field"><label>What must be returned? *</label><input className="input" value={f.label} onChange={(e) => set('label', e.target.value)} /></div>
        <div className="field"><label>Details</label><input className="input" value={f.detail} onChange={(e) => set('detail', e.target.value)} /></div>
        <label style={{ display: 'flex', gap: 8, fontSize: 13 }}><input type="checkbox" checked={f.requiresWipe} onChange={(e) => set('requiresWipe', e.target.checked)} /> Holds data — erase and verify before accepting</label>
      </div>
    </Modal>
  );
}

function ClearModal({ c, top, onClose, onDone }: { c: any; top: boolean; onClose: () => void; onDone: () => void }) {
  const { showError, showSuccess } = useToast();
  const [note, setNote] = useState(''); const [force, setForce] = useState(false);
  const blocked = c.blockers?.length > 0;
  async function save() { try { await api.post(`/offboarding/${c._id}/clear`, { note: note || undefined, force: force || undefined }); showSuccess('Leaver cleared. The record is kept for 5 years.'); onDone(); } catch (e) { showError(apiErrorMessage(e)); } }
  return (
    <Modal open onClose={onClose} title="Clear the leaver" footer={<><button className="btn btn-ghost" onClick={onClose}>Cancel</button><button className="btn btn-primary" disabled={(blocked && !force) || (force && note.trim().length < 5)} onClick={save}>Clear</button></>}>
      <div style={{ display: 'grid', gap: 12 }}>
        {!blocked ? <p style={{ margin: 0, fontSize: 13.5 }}>Everything is returned, handed over or documented, and the inventory is signed. Clearing finalises the record and switches off any access that is still active.</p> : <>
          <div className="card" style={{ borderLeft: '3px solid var(--danger, #d6455d)' }}><strong style={{ fontSize: 13 }}>Not ready</strong><ul style={{ margin: '6px 0 0', paddingLeft: 18, fontSize: 12.5 }}>{c.blockers.map((b: string, i: number) => <li key={i}>{b}</li>)}</ul></div>
          {top ? <label style={{ display: 'flex', gap: 8, fontSize: 13 }}><input type="checkbox" checked={force} onChange={(e) => setForce(e.target.checked)} /> Clear anyway, recording that it was cleared with open items (CEO / administrator only)</label> : <p className="text-muted" style={{ margin: 0, fontSize: 12.5 }}>Resolve these first, or ask the CEO or an administrator to clear with exceptions.</p>}</>}
        <div className="field"><label>Note {force && '*'}</label><textarea className="input" rows={3} value={note} onChange={(e) => setNote(e.target.value)} /></div>
      </div>
    </Modal>
  );
}

function CancelModal({ caseId, onClose, onDone }: { caseId: string; onClose: () => void; onDone: () => void }) {
  const { showError, showSuccess } = useToast();
  const [reason, setReason] = useState('');
  async function save() { try { await api.post(`/offboarding/${caseId}/cancel`, { reason }); showSuccess('Case cancelled.'); onDone(); } catch (e) { showError(apiErrorMessage(e)); } }
  return (
    <Modal open onClose={onClose} title="Cancel this offboarding" footer={<><button className="btn btn-ghost" onClick={onClose}>Keep case</button><button className="btn btn-danger" disabled={reason.trim().length < 3} onClick={save}>Cancel case</button></>}>
      <p className="text-muted" style={{ fontSize: 13, marginTop: 0 }}>Use this only if the person is staying. Their access is not changed by cancelling.</p>
      <div className="field"><label>Why is it cancelled? *</label><input className="input" value={reason} onChange={(e) => setReason(e.target.value)} /></div>
    </Modal>
  );
}
