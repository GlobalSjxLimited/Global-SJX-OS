import { useEffect, useState } from 'react';
import { Copy, KeyRound, Mail, Plus, Send, Wand2 } from 'lucide-react';
import { api, apiErrorMessage } from '@/lib/api';
import { useApi } from '@/lib/useApi';
import { useToast } from '@/context/ToastContext';
import { useConfirm } from '@/context/ConfirmContext';
import { fdatetime, label } from '@/lib/format';
import { Badge, statusTone } from '@/components/ui/Badge';
import { Modal } from '@/components/ui/Modal';
import { TagInput } from '@/components/ui/TagInput';
import { Pagination } from '@/components/ui/Pagination';
import { Empty, ErrorNote, Loading, PageHead, Tabs } from '@/components/ui/PageHead';
import { RowActions } from '@/components/work/RowActions';
import { PeoplePicker } from '@/components/work/PeoplePicker';
import { SEVERITY_OPTIONS } from '@/components/work/SeverityBadge';
import { Link } from 'react-router-dom';

const idOf = (v: any) => (v && typeof v === 'object' ? String(v._id || '') : v ? String(v) : '');
const nm = (v: any) => (v && typeof v === 'object' ? v.name || v.title : undefined);
const BLANK = { name: '', active: true, keywords: ['task', 'training', 'audit'], matchMode: 'any', organisations: [] as string[], requireOrganisation: true, senderDomains: [] as string[], allowUnknownSenders: false, acknowledgeSender: false, defaultAssigneeId: '', defaultProjectId: '', defaultPriority: 'medium', defaultSeverity: 'minor', dueInDays: 7, notifyUserIds: [] as string[] };

function RuleModal({ open, rule, onClose, onSaved }: { open: boolean; rule: any | null; onClose: () => void; onSaved: () => void }) {
  const { showError, showSuccess } = useToast();
  const [f, setF] = useState<any>(BLANK);
  const [projects, setProjects] = useState<any[]>([]);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (!open) return;
    api.get('/projects').then((r) => setProjects(r.data.data)).catch(() => undefined);
    setF(rule ? { ...BLANK, ...rule, defaultAssigneeId: idOf(rule.defaultAssigneeId), defaultProjectId: idOf(rule.defaultProjectId), notifyUserIds: (rule.notifyUserIds || []).map(idOf) } : BLANK);
  }, [open, rule]);
  const set = (k: string, v: any) => setF((x: any) => ({ ...x, [k]: v }));
  async function save() {
    setBusy(true);
    try {
      const body = { name: f.name.trim(), active: f.active, keywords: f.keywords, matchMode: f.matchMode, organisations: f.organisations, requireOrganisation: f.requireOrganisation, senderDomains: f.senderDomains, allowUnknownSenders: f.allowUnknownSenders, acknowledgeSender: f.acknowledgeSender,
        defaultAssigneeId: f.defaultAssigneeId || undefined, defaultProjectId: f.defaultProjectId || undefined, defaultPriority: f.defaultPriority, defaultSeverity: f.defaultSeverity, dueInDays: Number(f.dueInDays) || 0, notifyUserIds: f.notifyUserIds };
      if (rule) await api.patch(`/intake/rules/${rule._id}`, body); else await api.post('/intake/rules', body);
      showSuccess('Rule saved.'); onClose(); onSaved();
    } catch (err) { showError(apiErrorMessage(err)); } finally { setBusy(false); }
  }
  return (
    <Modal open={open} onClose={onClose} size="wide" title={rule ? 'Edit rule' : 'New intake rule'} footer={<><button className="btn btn-ghost" onClick={onClose}>Cancel</button><button className="btn btn-primary" disabled={busy || !f.name?.trim() || !f.keywords?.length} onClick={save}>{busy ? 'Saving…' : 'Save rule'}</button></>}>
      <div className="form-grid">
        <div className="field full"><label>Rule name *</label><input className="input" value={f.name} onChange={(e) => set('name', e.target.value)} placeholder="e.g. Opex training requests" autoFocus /></div>
        <div className="field full"><label>Keywords — an e-mail must contain these in its subject or body *</label><TagInput value={f.keywords} onChange={(v) => set('keywords', v)} placeholder="Type a keyword and press Enter (task, training, audit…)" /></div>
        <div className="field"><label>Match</label><select className="input" value={f.matchMode} onChange={(e) => set('matchMode', e.target.value)}><option value="any">Any one of the keywords</option><option value="all">All of the keywords</option></select></div>
        <div className="field"><label style={{ display: 'flex', gap: 8, alignItems: 'center', marginTop: 28 }}><input type="checkbox" checked={f.active} onChange={(e) => set('active', e.target.checked)} /> Rule is active</label></div>
        <div className="field full"><label>Organisation names — the e-mail must mention one, or come from that organisation’s client contacts</label><TagInput value={f.organisations} onChange={(v) => set('organisations', v)} placeholder="e.g. Opex" /></div>
        <div className="field full"><label style={{ display: 'flex', gap: 8, alignItems: 'center' }}><input type="checkbox" checked={f.requireOrganisation} onChange={(e) => set('requireOrganisation', e.target.checked)} /> An organisation must match (when organisations are listed)</label></div>
        <div className="field full"><label>Only accept from these sender domains (optional)</label><TagInput value={f.senderDomains} onChange={(v) => set('senderDomains', v)} placeholder="e.g. opex.com" /></div>
        <div className="field"><label style={{ display: 'flex', gap: 8, alignItems: 'center' }}><input type="checkbox" checked={f.allowUnknownSenders} onChange={(e) => set('allowUnknownSenders', e.target.checked)} /> Accept senders we don’t know</label><small className="text-muted">Off = only staff and client contacts can create tasks.</small></div>
        <div className="field"><label style={{ display: 'flex', gap: 8, alignItems: 'center' }}><input type="checkbox" checked={f.acknowledgeSender} onChange={(e) => set('acknowledgeSender', e.target.checked)} /> Send the sender a confirmation e-mail</label></div>
        <div className="field"><label>Default severity</label><select className="input" value={f.defaultSeverity} onChange={(e) => set('defaultSeverity', e.target.value)}>{SEVERITY_OPTIONS.map((s) => <option key={s.value} value={s.value}>{s.label}</option>)}</select></div>
        <div className="field"><label>Default priority</label><select className="input" value={f.defaultPriority} onChange={(e) => set('defaultPriority', e.target.value)}>{['low', 'medium', 'high', 'urgent'].map((s) => <option key={s} value={s}>{label(s)}</option>)}</select></div>
        <div className="field"><label>Due in (days)</label><input className="input" type="number" min={0} max={365} value={f.dueInDays} onChange={(e) => set('dueInDays', e.target.value)} /></div>
        <div className="field"><label>Add to project</label><select className="input" value={f.defaultProjectId || ''} onChange={(e) => set('defaultProjectId', e.target.value)}><option value="">No project</option>{projects.map((p) => <option key={p._id} value={p._id}>{p.name}</option>)}</select></div>
        <div className="field full"><label>Assign to (otherwise the person who sent it, if they are staff)</label><PeoplePicker single value={f.defaultAssigneeId ? [f.defaultAssigneeId] : []} onChange={(ids) => set('defaultAssigneeId', ids[0] || '')} /></div>
        <div className="field full"><label>Also notify</label><PeoplePicker value={f.notifyUserIds} onChange={(ids) => set('notifyUserIds', ids)} /></div>
      </div>
    </Modal>
  );
}

function TestTool() {
  const { showError } = useToast();
  const [f, setF] = useState({ from: '', subject: '', text: '' });
  const [res, setRes] = useState<any>(null);
  const [busy, setBusy] = useState(false);
  async function run() { setBusy(true); try { setRes((await api.post('/intake/test', f)).data.data); } catch (err) { showError(apiErrorMessage(err)); } finally { setBusy(false); } }
  return (
    <div className="card">
      <h3 style={{ marginBottom: 4 }}>Test an e-mail</h3>
      <p className="text-muted" style={{ fontSize: 13, marginBottom: 12 }}>See exactly what would happen to a message — nothing is saved and no task is created.</p>
      <div className="form-grid">
        <div className="field"><label>From</label><input className="input" type="email" value={f.from} onChange={(e) => setF({ ...f, from: e.target.value })} placeholder="dele@opex.com" /></div>
        <div className="field"><label>Subject</label><input className="input" value={f.subject} onChange={(e) => setF({ ...f, subject: e.target.value })} placeholder="Training request for next month" /></div>
        <div className="field full"><label>Message</label><textarea className="input" rows={4} value={f.text} onChange={(e) => setF({ ...f, text: e.target.value })} /></div>
      </div>
      <button className="btn btn-primary btn-sm" style={{ marginTop: 10 }} disabled={busy || !f.from} onClick={run}><Wand2 size={14} /> {busy ? 'Checking…' : 'Check this e-mail'}</button>
      {res && (
        <div className={`callout ${res.outcome === 'task_created' ? 'ok' : 'warn'}`} style={{ marginTop: 12 }}>
          <strong>{res.outcome === 'task_created' ? 'This would create a task' : res.outcome === 'duplicate' ? 'Already processed' : 'This would be ignored'}</strong>
          {res.reason && <div>{res.reason}</div>}
          {res.title && <div>Task title: <strong>{res.title}</strong></div>}
          {Array.isArray(res.checks) && res.checks.length > 0 && <ul>{res.checks.map((c: any, i: number) => <li key={i}>{c.rule || c.name}: {c.passed ? `matched${c.keywords?.length ? ` (${c.keywords.join(', ')})` : ''}` : c.reason}</li>)}</ul>}
        </div>
      )}
    </div>
  );
}

export function Intake() {
  const { showError, showSuccess } = useToast();
  const confirm = useConfirm();
  const [tab, setTab] = useState('rules');
  const rules = useApi<any[]>('/intake/rules');
  const settings = useApi<any>('/intake/settings');
  const [logPage, setLogPage] = useState(1);
  const [outcome, setOutcome] = useState('');
  const log = useApi<any[]>(tab === 'log' ? '/intake/log' : null, { page: logPage, ...(outcome ? { outcome } : {}) });
  const [edit, setEdit] = useState<null | { rule: any | null }>(null);
  const [secret, setSecret] = useState<string | null>(null);
  const copy = (txt: string) => navigator.clipboard?.writeText(txt).then(() => showSuccess('Copied.')).catch(() => undefined);

  async function remove(r: any) {
    if (!(await confirm({ title: 'Delete rule', message: `Delete “${r.name}”?`, confirmLabel: 'Delete', danger: true }))) return;
    try { await api.delete(`/intake/rules/${r._id}`); rules.reload(); } catch (err) { showError(apiErrorMessage(err)); }
  }
  async function toggle(r: any) { try { await api.patch(`/intake/rules/${r._id}`, { active: !r.active }); rules.reload(); } catch (err) { showError(apiErrorMessage(err)); } }
  async function rotate() {
    if (!(await confirm({ title: 'Generate a new secret', message: 'The old secret stops working immediately. Update your mail provider afterwards.', confirmLabel: 'Generate' }))) return;
    try { setSecret((await api.post('/intake/settings/rotate-secret')).data.data.secret); settings.reload(); } catch (err) { showError(apiErrorMessage(err)); }
  }
  async function setEnabled(enabled: boolean) { try { await api.patch('/intake/settings', { enabled }); settings.reload(); } catch (err) { showError(apiErrorMessage(err)); } }
  async function force(entry: any) {
    try { const res = await api.post(`/intake/log/${entry._id}/create-task`, {}); showSuccess(res.data.data.outcome === 'task_created' ? 'Task created.' : res.data.data.reason || 'Nothing created.'); log.reload(); } catch (err) { showError(apiErrorMessage(err)); }
  }

  const s = settings.data;
  const ex = s?.webhookUrl ? `curl -X POST '${s.webhookUrl}' -H 'x-intake-secret: <your-secret>' -H 'Content-Type: application/json' -d '{"from":"dele@opex.com","subject":"Training task for Opex","text":"Please schedule the audit training."}'` : '';

  return (
    <div>
      <PageHead title="E-mail to tasks" subtitle="Turn incoming e-mails into tasks automatically — when they contain your keywords and mention (or come from) the right organisation."
        actions={<button className="btn btn-primary" onClick={() => setEdit({ rule: null })}><Plus size={16} /> New rule</button>} />
      <Tabs value={tab} onChange={setTab} tabs={[{ key: 'rules', label: 'Rules', count: rules.data?.length }, { key: 'log', label: 'Inbox log' }, { key: 'test', label: 'Test' }, { key: 'setup', label: 'Connect your mailbox' }]} />
      <div style={{ marginTop: 16 }}>
        {tab === 'rules' && (<>
          <ErrorNote message={rules.error} />
          {rules.loading && !rules.data ? <Loading /> : !rules.data?.length ? <Empty title="No rules yet" hint="Add one — for example keywords “task, training, audit” for the organisation “Opex”." icon={<Mail />} /> : (
            <div className="stack">{rules.data.map((r) => (
              <div key={r._id} className="card">
                <div className="flex-between" style={{ gap: 10, flexWrap: 'wrap' }}>
                  <div><strong style={{ fontSize: 15 }}>{r.name}</strong> {!r.active && <Badge tone="neutral">Paused</Badge>}
                    <div className="text-muted" style={{ fontSize: 12.5, marginTop: 2 }}>{r.matchedCount || 0} task{r.matchedCount === 1 ? '' : 's'} created</div></div>
                  <div className="row-gap"><label style={{ display: 'inline-flex', gap: 6, alignItems: 'center', fontSize: 13 }}><input type="checkbox" checked={r.active} onChange={() => toggle(r)} /> Active</label>
                    <RowActions permissions={{ view: true, edit: true, delete: true }} onEdit={() => setEdit({ rule: r })} onDelete={() => remove(r)} /></div>
                </div>
                <div className="row-gap" style={{ marginTop: 10 }}>
                  {r.keywords.map((k: string) => <span key={k} className="chip active">{k}</span>)}
                  <span className="text-muted" style={{ fontSize: 12 }}>({r.matchMode === 'all' ? 'all of these' : 'any of these'})</span>
                </div>
                <div className="text-muted" style={{ fontSize: 12.5, marginTop: 8 }}>
                  {r.organisations?.length ? <>Organisations: <strong>{r.organisations.join(', ')}</strong> · </> : null}
                  {r.senderDomains?.length ? <>Domains: {r.senderDomains.join(', ')} · </> : null}
                  Assign to: {nm(r.defaultAssigneeId) || 'sender'} · {nm(r.defaultProjectId) ? `Project: ${nm(r.defaultProjectId)} · ` : ''}Severity {label(r.defaultSeverity)} · due in {r.dueInDays} days
                </div>
              </div>))}</div>
          )}
        </>)}

        {tab === 'log' && (<>
          <div className="filter-bar"><select className="input" value={outcome} onChange={(e) => { setOutcome(e.target.value); setLogPage(1); }}><option value="">All messages</option><option value="task_created">Became tasks</option><option value="ignored">Ignored</option><option value="error">Errors</option></select></div>
          <ErrorNote message={log.error} />
          {log.loading && !log.data ? <Loading /> : !log.data?.length ? <Empty title="No messages yet" hint="Messages appear here as soon as they arrive." /> : (
            <div className="table-wrap"><table className="table"><thead><tr><th>Received</th><th>From</th><th>Subject</th><th>Result</th><th /></tr></thead>
              <tbody>{log.data.map((e) => (<tr key={e._id}><td>{fdatetime(e.createdAt)}</td><td>{e.fromName ? `${e.fromName} ` : ''}<span className="text-muted">{e.from}</span></td><td style={{ maxWidth: 280 }}>{e.subject || '—'}</td>
                <td><Badge tone={e.outcome === 'task_created' ? 'success' : e.outcome === 'error' ? 'danger' : statusTone('pending')}>{label(e.outcome)}</Badge>{e.taskId ? <> <Link to={`/tasks/${idOf(e.taskId)}`}>{nm(e.taskId) || 'Open task'}</Link></> : e.reason ? <div className="text-muted" style={{ fontSize: 12 }}>{e.reason}</div> : null}</td>
                <td>{!e.taskId && e.outcome !== 'task_created' && <button className="btn btn-ghost btn-sm" onClick={() => force(e)}><Send size={13} /> Create task anyway</button>}</td></tr>))}</tbody></table></div>
          )}
          {log.extra?.pagination && <Pagination page={log.extra.pagination.page} pages={log.extra.pagination.pages} total={log.extra.pagination.total} onChange={setLogPage} />}
        </>)}

        {tab === 'test' && <TestTool />}

        {tab === 'setup' && (
          <div className="stack">
            <div className="card">
              <div className="flex-between"><h3>Intake is {s?.enabled === false ? 'off' : 'on'}</h3><button className="btn btn-ghost btn-sm" onClick={() => setEnabled(s?.enabled === false)}>{s?.enabled === false ? 'Turn on' : 'Turn off'}</button></div>
              <p className="text-muted" style={{ fontSize: 13, marginTop: 4 }}>Forward or route a mailbox (for example tasks@yourcompany.com) to the web address below using your mail provider’s inbound e-mail feature (SendGrid Inbound Parse, Mailgun Routes, Postmark and similar), or call it from your own automation.</p>
              <div className="field" style={{ marginTop: 12 }}><label>Webhook address</label><div className="row-gap"><input className="input" style={{ flex: 1 }} readOnly value={s?.webhookUrl || ''} /><button className="btn btn-ghost btn-sm" onClick={() => s?.webhookUrl && copy(s.webhookUrl)}><Copy size={14} /> Copy</button></div></div>
              <div className="field" style={{ marginTop: 12 }}><label>Secret</label>
                <div className="row-gap"><span className="chip">{s?.secretHint ? `Ends ${s.secretHint}` : 'No secret yet'}</span><button className="btn btn-ghost btn-sm" onClick={rotate}><KeyRound size={14} /> {s?.secretHint ? 'Generate a new secret' : 'Generate secret'}</button>{s?.rotatedAt && <span className="text-muted" style={{ fontSize: 12 }}>Last changed {fdatetime(s.rotatedAt)}</span>}</div>
                <small className="text-muted">Send it in the <code>x-intake-secret</code> header (or add <code>?secret=…</code> to the address if your provider can’t set headers). It is shown only once when generated.</small></div>
              {s?.imapConfigured && <div className="callout ok" style={{ marginTop: 12 }}>A mailbox is also being read directly over IMAP (set by the server administrator).</div>}
            </div>
            {ex && <div className="card"><h4 style={{ marginBottom: 8 }}>Try it from a terminal</h4><pre style={{ whiteSpace: 'pre-wrap', wordBreak: 'break-all', fontSize: 12, background: 'var(--surface-2)', padding: 12, borderRadius: 10 }}>{ex}</pre><button className="btn btn-ghost btn-sm" onClick={() => copy(ex)}><Copy size={14} /> Copy</button></div>}
          </div>
        )}
      </div>
      <RuleModal open={!!edit} rule={edit?.rule || null} onClose={() => setEdit(null)} onSaved={rules.reload} />
      <Modal open={!!secret} onClose={() => setSecret(null)} title="Your new secret" footer={<button className="btn btn-primary" onClick={() => setSecret(null)}>I’ve saved it</button>}>
        <p style={{ fontSize: 13.5, marginBottom: 10 }}>Copy this now — it will not be shown again.</p>
        <div className="row-gap"><input className="input" style={{ flex: 1 }} readOnly value={secret || ''} onFocus={(e) => e.target.select()} /><button className="btn btn-ghost btn-sm" onClick={() => secret && copy(secret)}><Copy size={14} /> Copy</button></div>
      </Modal>
    </div>
  );
}
