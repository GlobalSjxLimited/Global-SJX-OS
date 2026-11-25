import { useState } from 'react';
import { KeyRound, ClipboardCheck, Users, RotateCcw } from 'lucide-react';
import { api, apiErrorMessage } from '@/lib/api';
import { useToast } from '@/context/ToastContext';
import { useConfirm } from '@/context/ConfirmContext';
import { useApi } from '@/lib/useApi';
import { PageHead, Tabs, Loading, ErrorNote, Empty } from '@/components/ui/PageHead';
import { Badge, statusTone } from '@/components/ui/Badge';
import { Modal } from '@/components/ui/Modal';
import { ModulePicker } from '@/components/ui/ModulePicker';
import { fdate, label } from '@/lib/format';

export function AccessControl() {
  const [tab, setTab] = useState<'roles' | 'users' | 'reviews'>('roles');
  return (
    <div className="page-enter">
      <PageHead title="Access control" subtitle="Decide which modules each role can see, grant exceptions per person, and review access regularly (ISO 27001 A.5.15 / A.5.18)." />
      <Tabs tabs={[{ key: 'roles', label: 'Roles ↔ modules' }, { key: 'users', label: 'Per-person overrides' }, { key: 'reviews', label: 'Access reviews' }]} value={tab} onChange={(k) => setTab(k as any)} />
      {tab === 'roles' && <Roles />}{tab === 'users' && <UserOverrides />}{tab === 'reviews' && <Reviews />}
    </div>
  );
}

function Roles() {
  const { showError, showSuccess } = useToast();
  const confirm = useConfirm();
  const cat = useApi<any>('/access/catalog');
  const roles = useApi<any[]>('/access/roles');
  const [sel, setSel] = useState<any>(null);
  const [mods, setMods] = useState<string[]>([]);
  const pick = (r: any) => { setSel(r); setMods(r.modules); };
  async function save() {
    try { await api.put(`/access/roles/${sel.role}`, { modules: mods }); showSuccess('Role updated. Users pick this up on their next request.'); setSel(null); roles.reload(); } catch (e) { showError(apiErrorMessage(e)); }
  }
  async function reset() {
    if (!(await confirm({ title: 'Reset to defaults?', message: `Modules for ${label(sel.role)} return to the built-in set.`, confirmLabel: 'Reset' }))) return;
    try { await api.delete(`/access/roles/${sel.role}`); showSuccess('Reset.'); setSel(null); roles.reload(); } catch (e) { showError(apiErrorMessage(e)); }
  }
  if (roles.loading || cat.loading) return <Loading />;
  return (
    <>
      <ErrorNote message={roles.error || cat.error} />
      <div className="table-wrap"><table className="data-table"><thead><tr><th>Role</th><th>Users</th><th>Modules</th><th>State</th></tr></thead>
        <tbody>{(roles.data || []).map((r) => <tr key={r.role} onClick={() => !r.locked && pick(r)} style={{ cursor: r.locked ? 'default' : 'pointer' }}>
          <td><strong>{label(r.role)}</strong></td><td>{r.users}</td><td>{r.modules.length}</td>
          <td>{r.locked ? <Badge>Fixed</Badge> : r.customised ? <Badge tone="gold">Customised</Badge> : <Badge tone="neutral">Default</Badge>}</td></tr>)}</tbody></table></div>
      {sel && cat.data && (
        <Modal open onClose={() => setSel(null)} title={`Modules for ${label(sel.role)}`} size="xwide"
          footer={<>{sel.customised && <button className="btn btn-ghost" onClick={reset}><RotateCcw size={14} /> Reset to default</button>}<button className="btn btn-primary" onClick={save}>Save</button></>}>
          <ModulePicker modules={cat.data.modules} value={mods} onChange={setMods} locked={cat.data.alwaysOn} disabledKeys={['super_admin', 'ceo'].includes(sel.role) ? [] : cat.data.adminOnly} />
          <p className="text-muted" style={{ fontSize: 12.5 }}>🔒 marks sensitive modules; they are highlighted in access reviews. The Access control module itself is reserved for the CEO and administrators.</p>
        </Modal>
      )}
    </>
  );
}

function UserOverrides() {
  const { showError, showSuccess } = useToast();
  const cat = useApi<any>('/access/catalog');
  const users = useApi<any[]>('/access/users');
  const [sel, setSel] = useState<any>(null);
  const [grant, setGrant] = useState<string[]>([]);
  const [deny, setDeny] = useState<string[]>([]);
  const open = (u: any) => { setSel(u); setGrant(u.moduleGrant || []); setDeny(u.moduleDeny || []); };
  async function save() {
    try { await api.put(`/access/users/${sel._id}`, { moduleGrant: grant, moduleDeny: deny }); showSuccess('Overrides saved.'); setSel(null); users.reload(); } catch (e) { showError(apiErrorMessage(e)); }
  }
  if (users.loading || cat.loading) return <Loading />;
  const defaults: string[] = sel ? cat.data?.defaults?.[sel.role] || [] : [];
  return (
    <>
      <ErrorNote message={users.error} />
      <div className="table-wrap"><table className="data-table"><thead><tr><th>Person</th><th>Role</th><th>Effective modules</th><th>Overrides</th><th>MFA</th></tr></thead>
        <tbody>{(users.data || []).map((u) => <tr key={u._id} onClick={() => open(u)}>
          <td><strong>{u.name}</strong><div className="text-muted" style={{ fontSize: 12 }}>{u.email}</div></td><td><Badge tone="accent">{label(u.role)}</Badge></td><td>{u.modules?.length}</td>
          <td>{u.moduleGrant?.length ? <Badge tone="success">+{u.moduleGrant.length}</Badge> : null} {u.moduleDeny?.length ? <Badge tone="danger">−{u.moduleDeny.length}</Badge> : null}{!u.moduleGrant?.length && !u.moduleDeny?.length && '—'}</td>
          <td>{u.mfaEnabled ? <Badge tone="success">On</Badge> : <Badge tone="danger">Off</Badge>}</td></tr>)}</tbody></table></div>
      {sel && cat.data && (
        <Modal open onClose={() => setSel(null)} title={`Overrides · ${sel.name}`} size="xwide" footer={<button className="btn btn-primary" onClick={save}>Save overrides</button>}>
          <div style={{ display: 'grid', gap: 18 }}>
            <ModulePicker title="Grant extra modules" modules={cat.data.modules} value={grant} onChange={setGrant} locked={[...cat.data.alwaysOn, ...defaults]} disabledKeys={['super_admin', 'ceo'].includes(sel.role) ? [] : cat.data.adminOnly} />
            <ModulePicker title="Deny modules the role normally has" modules={cat.data.modules.filter((m: any) => defaults.includes(m.key) && !cat.data.alwaysOn.includes(m.key))} value={deny} onChange={setDeny} />
          </div>
        </Modal>
      )}
    </>
  );
}

function Reviews() {
  const { showError, showSuccess } = useToast();
  const list = useApi<any[]>('/access/reviews');
  const [open, setOpen] = useState<string | null>(null);
  async function start() { try { const r = await api.post('/access/reviews', {}); showSuccess('Review started.'); list.reload(); setOpen(r.data.data._id); } catch (e) { showError(apiErrorMessage(e)); } }
  return (
    <>
      <div style={{ marginBottom: 12 }}><button className="btn btn-primary" onClick={start}><ClipboardCheck size={15} /> Start access review</button></div>
      <ErrorNote message={list.error} />
      {list.loading ? <Loading /> : !list.data?.length ? <Empty icon={<Users />} title="No access reviews yet" hint="Review who has what at least quarterly." /> : (
        <div className="table-wrap"><table className="data-table"><thead><tr><th>Ref</th><th>Title</th><th>Progress</th><th>Due</th><th>Status</th></tr></thead>
          <tbody>{list.data.map((r) => <tr key={r._id} onClick={() => setOpen(r._id)}><td className="mono">{r.reference}</td><td>{r.title}</td><td>{r.decided}/{r.total}</td><td>{fdate(r.dueDate)}</td><td><Badge tone={statusTone(r.status)}>{label(r.status)}</Badge></td></tr>)}</tbody></table></div>
      )}
      {open && <ReviewModal id={open} onClose={() => setOpen(null)} onChanged={list.reload} />}
    </>
  );
}

function ReviewModal({ id, onClose, onChanged }: { id: string; onClose: () => void; onChanged: () => void }) {
  const { showError, showSuccess } = useToast();
  const { data: rv, loading, reload } = useApi<any>(`/access/reviews/${id}`);
  async function decide(itemId: string, decision: string) {
    try { await api.patch(`/access/reviews/${id}/items/${itemId}`, { decision }); reload(); } catch (e) { showError(apiErrorMessage(e)); }
  }
  async function complete() {
    try { const r = await api.post(`/access/reviews/${id}/complete`, { apply: true }); showSuccess(`Review completed${r.data.data.removed ? ` — ${r.data.data.removed} login(s) removed` : ''}.`); reload(); onChanged(); } catch (e) { showError(apiErrorMessage(e)); }
  }
  return (
    <Modal open onClose={onClose} title={rv ? `${rv.reference} · ${rv.title}` : 'Access review'} size="xwide"
      footer={rv?.status === 'open' && <button className="btn btn-primary" onClick={complete}><KeyRound size={14} /> Complete & apply decisions</button>}>
      {loading && !rv ? <Loading /> : rv && (
        <div className="table-wrap"><table className="data-table" style={{ cursor: 'default' }}><thead><tr><th>Person</th><th>Role</th><th>Sensitive access</th><th>MFA</th><th>Last sign-in</th><th>Decision</th></tr></thead>
          <tbody>{rv.items.map((i: any) => <tr key={i._id} style={{ cursor: 'default' }}>
            <td><strong>{i.name}</strong><div className="text-muted" style={{ fontSize: 12 }}>{i.department}</div></td><td>{label(i.role)}</td>
            <td style={{ fontSize: 12 }}>{i.sensitiveModules?.length ? i.sensitiveModules.map(label).join(', ') : '—'}</td><td>{i.mfaEnabled ? 'On' : <Badge tone="danger">Off</Badge>}</td><td>{fdate(i.lastLoginAt)}</td>
            <td>{rv.status === 'open' ? <div className="seg">{['keep', 'reduce', 'remove'].map((d) => <button key={d} type="button" className={i.decision === d ? 'on' : ''} onClick={() => decide(i._id, d)}>{label(d)}</button>)}</div> : <Badge tone={statusTone(i.decision)}>{label(i.decision)}</Badge>}</td></tr>)}</tbody></table></div>
      )}
    </Modal>
  );
}
