import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Plus, UserPlus, KeyRound, ShieldOff, ShieldAlert, Award, GraduationCap, MonitorSmartphone, LogOut, Trash2, Mail, Copy, Check } from 'lucide-react';
import { api, apiErrorMessage } from '@/lib/api';
import { useAuth } from '@/context/AuthContext';
import { useToast } from '@/context/ToastContext';
import { useConfirm } from '@/context/ConfirmContext';
import { useApi } from '@/lib/useApi';
import { PageHead, Empty, Loading, ErrorNote, Kv } from '@/components/ui/PageHead';
import { DepartmentHeadsModal } from '@/components/work/DepartmentHeadsModal';
import { Badge, statusTone } from '@/components/ui/Badge';
import { Modal } from '@/components/ui/Modal';
import { Pagination } from '@/components/ui/Pagination';
import { ModulePicker } from '@/components/ui/ModulePicker';
import { fdate, fdatetime, label } from '@/lib/format';

const DEPARTMENTS = ['Executive', 'Cybersecurity', 'Payments', 'Cloud & Infrastructure', 'Digital Transformation', 'Advisory', 'Sales', 'HR', 'Finance', 'Marketing', 'Operations', 'IT & Governance', 'Risk & Compliance', 'Academy'];
const ROLES = ['super_admin', 'ceo', 'coo', 'finance', 'hr', 'sales', 'project_manager', 'engineer', 'employee'];

export function Employees() {
  const { user } = useAuth();
  const hr = ['hr', 'coo', 'ceo', 'super_admin'].includes(user?.role || '');
  const [page, setPage] = useState(1);
  const [q, setQ] = useState('');
  const [status, setStatus] = useState('');
  const [wizard, setWizard] = useState(false);
  const [heads, setHeads] = useState(false);
  const [openId, setOpenId] = useState<string | null>(null);
  const { data, extra, loading, error, reload } = useApi<any[]>('/employees', { page, q: q || undefined, status: status || undefined });
  useEffect(() => setPage(1), [q, status]);

  return (
    <div className="page-enter">
      <PageHead title="Employees" subtitle="People, logins, access, account information, certifications and training."
        actions={<><button className="btn btn-ghost" onClick={() => setHeads(true)}>Department heads</button>{hr && <button className="btn btn-primary" onClick={() => setWizard(true)}><UserPlus size={16} /> New employee</button>}</>} />
      {heads && <DepartmentHeadsModal onClose={() => setHeads(false)} />}
      <div style={{ display: 'flex', gap: 10, marginBottom: 14, flexWrap: 'wrap' }}>
        <input className="input" style={{ maxWidth: 260 }} placeholder="Search by name" value={q} onChange={(e) => setQ(e.target.value)} />
        <select className="input" style={{ maxWidth: 200 }} value={status} onChange={(e) => setStatus(e.target.value)}>
          <option value="">All</option><option value="active">Active</option><option value="no_login">No login yet</option><option value="offboarded">Offboarded</option>
        </select>
      </div>
      <ErrorNote message={error} />
      {loading && !data ? <Loading /> : !data?.length ? <Empty icon={<Plus />} title="No employees found" /> : (
        <div className="table-wrap"><table className="data-table">
          <thead><tr><th>Name</th><th>Job title</th><th>Department</th><th>Role</th><th>Login</th><th>MFA</th><th>Status</th></tr></thead>
          <tbody>{data.map((e) => (
            <tr key={e._id} onClick={() => setOpenId(e._id)}>
              <td><strong>{e.name}</strong><div className="text-muted" style={{ fontSize: 12 }}>{e.email}</div></td>
              <td>{e.jobTitle || '—'}</td><td>{e.department || '—'}</td><td><Badge tone="accent">{label(e.role)}</Badge></td>
              <td>{e.loginEnabled === false ? <Badge tone="gold">No login</Badge> : <Badge tone="success">Enabled</Badge>}</td>
              <td>{e.mfaEnabled ? <Badge tone="success">On</Badge> : <Badge tone="danger">Off</Badge>}</td>
              <td><Badge tone={statusTone(e.employmentStatus)}>{label(e.employmentStatus || 'active')}</Badge></td>
            </tr>))}</tbody></table></div>
      )}
      {extra?.pagination && <Pagination page={extra.pagination.page} pages={extra.pagination.pages} total={extra.pagination.total} onChange={setPage} />}
      {wizard && <Wizard onClose={() => setWizard(false)} onDone={() => { reload(); }} />}
      {openId && <Profile id={openId} hr={hr} onClose={() => setOpenId(null)} onChanged={reload} />}
    </div>
  );
}

/* ------------------------------ Credentials reveal -------------------------- */
function PasswordOnce({ password, emailed, onClose }: { password?: string; emailed?: boolean; onClose: () => void }) {
  const [copied, setCopied] = useState(false);
  return (
    <Modal open onClose={onClose} title="Credentials" footer={<button className="btn btn-primary" onClick={onClose}>Done</button>}>
      {emailed && <div className="banner ok"><Mail size={16} /> The sign-in details were e-mailed to the employee.</div>}
      {password && (
        <div style={{ display: 'grid', gap: 10 }}>
          <div className="banner warn"><ShieldAlert size={16} /> Shown <strong>once only</strong>. Copy it now and share it through a secure channel. The employee must change it at first sign-in.</div>
          <div className="card mono" style={{ fontSize: 18, letterSpacing: '.04em', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <span>{password}</span>
            <button className="icon-btn" aria-label="Copy" onClick={() => { navigator.clipboard?.writeText(password); setCopied(true); setTimeout(() => setCopied(false), 2000); }}>{copied ? <Check /> : <Copy />}</button>
          </div>
        </div>
      )}
    </Modal>
  );
}

/* ----------------------------- Onboarding wizard ---------------------------- */
const blankCert = { name: '', provider: '', dateObtained: '', expiryDate: '' };
function Wizard({ onClose, onDone }: { onClose: () => void; onDone: () => void }) {
  const { user } = useAuth();
  const { showError, showSuccess } = useToast();
  const cat = useApi<any>('/access/catalog');
  const mgrs = useApi<any[]>('/employees/directory/list');
  const [step, setStep] = useState(0);
  const [busy, setBusy] = useState(false);
  const [f, setF] = useState<any>({ name: '', email: '', phone: '', jobTitle: '', department: '', role: 'employee', managerId: '', employmentType: 'full_time', employeeNo: '', dateJoined: new Date().toISOString().slice(0, 10), address: '' });
  const [createLogin, setCreateLogin] = useState<boolean | null>(null);
  const [delivery, setDelivery] = useState<'email' | 'show'>('email');
  const [grant, setGrant] = useState<string[]>([]);
  const [deny, setDeny] = useState<string[]>([]);
  const [bank, setBank] = useState({ bankName: '', accountName: '', accountNumber: '' });
  const [certs, setCerts] = useState<any[]>([]);
  const [result, setResult] = useState<any>(null);
  const privileged = ['super_admin', 'ceo'].includes(user?.role || '');
  const roleOptions = ROLES.filter((r) => privileged || !['super_admin', 'ceo'].includes(r));
  const defaults: string[] = cat.data?.defaults?.[f.role] || [];
  const steps = ['Details', 'Sign-in', 'Role & access', 'Account info', 'Certifications', 'Review'];
  const set = (k: string, v: any) => setF((p: any) => ({ ...p, [k]: v }));

  function next() {
    if (step === 0 && (!f.name.trim() || !/^\S+@\S+\.\S+$/.test(f.email))) return showError('Enter the full name and a valid e-mail.');
    if (step === 1 && createLogin === null) return showError('Choose whether to create credentials.');
    setStep(step + 1);
  }
  async function submit() {
    setBusy(true);
    try {
      const body: any = { ...f, managerId: f.managerId || undefined, createLogin: !!createLogin, delivery, moduleGrant: grant, moduleDeny: deny,
        certifications: certs.filter((c) => c.name && c.provider && c.dateObtained) };
      if (bank.accountNumber || bank.bankName) body.bankAccount = bank;
      const res = await api.post('/employees', body);
      showSuccess('Employee created.');
      onDone();
      if (res.data.credentials) setResult(res.data.credentials); else onClose();
    } catch (err) { showError(apiErrorMessage(err)); } finally { setBusy(false); }
  }
  if (result) return <PasswordOnce password={result.temporaryPassword} emailed={result.emailed} onClose={onClose} />;

  return (
    <Modal open onClose={onClose} title="New employee" size="wide"
      footer={<>
        {step > 0 && <button className="btn btn-ghost" onClick={() => setStep(step - 1)}>Back</button>}
        {step < steps.length - 1 ? <button className="btn btn-primary" onClick={next}>Continue</button> : <button className="btn btn-primary" disabled={busy} onClick={submit}>{busy ? 'Creating…' : 'Create employee'}</button>}
      </>}>
      <div className="tabs" style={{ marginBottom: 16 }}>{steps.map((s, i) => <span key={s} className={`tab ${i === step ? 'active' : ''}`} style={{ cursor: 'default', opacity: i > step ? 0.5 : 1 }}>{i + 1}. {s}</span>)}</div>

      {step === 0 && (
        <div className="grid-2">
          <div className="field"><label>Full name *</label><input className="input" value={f.name} onChange={(e) => set('name', e.target.value)} /></div>
          <div className="field"><label>Work e-mail *</label><input className="input" type="email" value={f.email} onChange={(e) => set('email', e.target.value)} /></div>
          <div className="field"><label>Phone</label><input className="input" value={f.phone} onChange={(e) => set('phone', e.target.value)} /></div>
          <div className="field"><label>Employee no.</label><input className="input" value={f.employeeNo} onChange={(e) => set('employeeNo', e.target.value)} /></div>
          <div className="field"><label>Job title</label><input className="input" value={f.jobTitle} onChange={(e) => set('jobTitle', e.target.value)} /></div>
          <div className="field"><label>Department</label><select className="input" value={f.department} onChange={(e) => set('department', e.target.value)}><option value="">—</option>{DEPARTMENTS.map((d) => <option key={d}>{d}</option>)}</select></div>
          <div className="field"><label>Reports to</label><select className="input" value={f.managerId} onChange={(e) => set('managerId', e.target.value)}><option value="">—</option>{(mgrs.data || []).map((m) => <option key={m._id} value={m._id}>{m.name}</option>)}</select></div>
          <div className="field"><label>Employment type</label><select className="input" value={f.employmentType} onChange={(e) => set('employmentType', e.target.value)}>{['full_time', 'part_time', 'contract', 'intern'].map((t) => <option key={t} value={t}>{label(t)}</option>)}</select></div>
          <div className="field"><label>Date joined</label><input className="input" type="date" value={f.dateJoined} onChange={(e) => set('dateJoined', e.target.value)} /></div>
          <div className="field"><label>Address</label><input className="input" value={f.address} onChange={(e) => set('address', e.target.value)} /></div>
        </div>
      )}

      {step === 1 && (
        <div style={{ display: 'grid', gap: 12 }}>
          <p style={{ margin: 0 }}><strong>Should we create sign-in credentials for {f.name || 'this employee'}?</strong></p>
          <label className={`card ${createLogin === true ? 'selected' : ''}`} style={{ cursor: 'pointer', display: 'flex', gap: 10 }}><input type="radio" checked={createLogin === true} onChange={() => setCreateLogin(true)} />
            <span><strong>Yes — create a login</strong><br /><span className="text-muted" style={{ fontSize: 13 }}>A strong temporary password is generated. They must change it at first sign-in.</span></span></label>
          <label className={`card ${createLogin === false ? 'selected' : ''}`} style={{ cursor: 'pointer', display: 'flex', gap: 10 }}><input type="radio" checked={createLogin === false} onChange={() => setCreateLogin(false)} />
            <span><strong>No — record only</strong><br /><span className="text-muted" style={{ fontSize: 13 }}>Keep them on the register (for expenses, certifications, training) with no access. You can create a login later.</span></span></label>
          {createLogin && (
            <div className="field"><label>How should the temporary password be delivered?</label>
              <select className="input" value={delivery} onChange={(e) => setDelivery(e.target.value as any)}><option value="email">E-mail it to the employee</option><option value="show">Show it to me once</option></select></div>
          )}
        </div>
      )}

      {step === 2 && (
        <div style={{ display: 'grid', gap: 14 }}>
          <div className="field"><label>System role {createLogin === false && <span className="text-muted">(applies if a login is created later)</span>}</label>
            <select className="input" value={f.role} onChange={(e) => { set('role', e.target.value); setGrant([]); setDeny([]); }}>{roleOptions.map((r) => <option key={r} value={r}>{label(r)}</option>)}</select></div>
          <p className="text-muted" style={{ margin: 0, fontSize: 13 }}>This role gives access to {defaults.length || '…'} modules by default. Tick extra modules to <strong>grant</strong>, or remove ones to <strong>deny</strong>, for this person only.</p>
          {cat.data && (
            <>
              <ModulePicker title="Extra modules to grant" modules={cat.data.modules} value={grant} onChange={setGrant}
                locked={[...cat.data.alwaysOn, ...defaults]} disabledKeys={privileged && ['super_admin', 'ceo'].includes(f.role) ? [] : cat.data.adminOnly} />
              <ModulePicker title="Modules to deny (override role)" modules={cat.data.modules.filter((m: any) => defaults.includes(m.key) && !cat.data.alwaysOn.includes(m.key))} value={deny} onChange={setDeny} />
            </>
          )}
        </div>
      )}

      {step === 3 && (
        <div style={{ display: 'grid', gap: 10 }}>
          <div className="banner"><ShieldAlert size={16} /> The account number is encrypted at rest and shown masked; every reveal is audited. Optional — the employee can add it later.</div>
          <div className="grid-2">
            <div className="field"><label>Bank</label><input className="input" value={bank.bankName} onChange={(e) => setBank({ ...bank, bankName: e.target.value })} /></div>
            <div className="field"><label>Account name</label><input className="input" value={bank.accountName} onChange={(e) => setBank({ ...bank, accountName: e.target.value })} /></div>
            <div className="field"><label>Account number</label><input className="input mono" inputMode="numeric" autoComplete="off" value={bank.accountNumber} onChange={(e) => setBank({ ...bank, accountNumber: e.target.value })} /></div>
          </div>
        </div>
      )}

      {step === 4 && (
        <div style={{ display: 'grid', gap: 10 }}>
          {certs.map((c, i) => (
            <div key={i} className="card" style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(150px,1fr))', gap: 8, alignItems: 'end' }}>
              <div className="field" style={{ margin: 0 }}><label>Certification</label><input className="input" value={c.name} onChange={(e) => setCerts(certs.map((x, j) => j === i ? { ...x, name: e.target.value } : x))} /></div>
              <div className="field" style={{ margin: 0 }}><label>Provider</label><input className="input" value={c.provider} onChange={(e) => setCerts(certs.map((x, j) => j === i ? { ...x, provider: e.target.value } : x))} /></div>
              <div className="field" style={{ margin: 0 }}><label>Obtained</label><input className="input" type="date" value={c.dateObtained} onChange={(e) => setCerts(certs.map((x, j) => j === i ? { ...x, dateObtained: e.target.value } : x))} /></div>
              <div className="field" style={{ margin: 0 }}><label>Expires</label><input className="input" type="date" value={c.expiryDate} onChange={(e) => setCerts(certs.map((x, j) => j === i ? { ...x, expiryDate: e.target.value } : x))} /></div>
              <button className="icon-btn" aria-label="Remove" onClick={() => setCerts(certs.filter((_, j) => j !== i))}><Trash2 /></button>
            </div>
          ))}
          <div><button className="btn btn-ghost" onClick={() => setCerts([...certs, { ...blankCert }])}><Award size={14} /> Add certification</button></div>
          <p className="text-muted" style={{ fontSize: 12.5, margin: 0 }}>Expiring certificates trigger automatic reminders. Training is assigned from the Training page after creation.</p>
        </div>
      )}

      {step === 5 && (
        <Kv rows={[
          ['Name', f.name], ['E-mail', f.email], ['Title / dept', `${f.jobTitle || '—'} · ${f.department || '—'}`], ['Role', label(f.role)],
          ['Login', createLogin ? `Create — ${delivery === 'email' ? 'e-mail password' : 'show password once'}` : 'Not created'],
          ['Extra modules', grant.length ? grant.join(', ') : 'None'], ['Denied modules', deny.length ? deny.join(', ') : 'None'],
          ['Account info', bank.accountNumber ? `${bank.bankName || 'Bank'} · ••••${bank.accountNumber.slice(-4)}` : 'Not provided'],
          ['Certifications', certs.filter((c) => c.name).length],
        ]} />
      )}
    </Modal>
  );
}

/* --------------------------------- Profile ---------------------------------- */
function Profile({ id, hr, onClose, onChanged }: { id: string; hr: boolean; onClose: () => void; onChanged: () => void }) {
  const { user } = useAuth();
  const { showError, showSuccess } = useToast();
  const confirm = useConfirm();
  const { data, loading, error, reload } = useApi<any>(`/employees/${id}/profile`);
  const [full, setFull] = useState<any>(null);
  const [editBank, setEditBank] = useState(false);
  const [bank, setBank] = useState({ bankName: '', accountName: '', accountNumber: '' });
  const [creds, setCreds] = useState<any>(null);
  const e = data?.employee;
  const self = id === user?.id;

  async function call(fn: () => Promise<any>, ok?: string, after?: (r: any) => void) {
    try { const r = await fn(); if (ok) showSuccess(ok); after?.(r); reload(); onChanged(); } catch (err) { showError(apiErrorMessage(err)); }
  }
  const showCreds = (r: any) => setCreds(r.data.data);

  return (
    <Modal open onClose={onClose} title={e?.name || 'Employee'} size="xwide"
      footer={hr && e && !self && (
        <>
          {!e.loginEnabled ? <button className="btn btn-primary" onClick={() => call(() => api.post(`/employees/${id}/credentials`, { delivery: 'email' }), 'Login created.', showCreds)}><KeyRound size={14} /> Create credentials</button>
            : <>
              <button className="btn btn-ghost" onClick={async () => { if (await confirm({ title: 'Reset password?', message: 'All their sessions end and a new temporary password is issued.', confirmLabel: 'Reset' })) call(() => api.post(`/employees/${id}/reset-password`, { delivery: 'email' }), 'Password reset.', showCreds); }}><KeyRound size={14} /> Reset password</button>
              <button className="btn btn-danger" onClick={async () => { if (await confirm({ title: 'Revoke access?', message: 'They are signed out everywhere and can no longer log in.', danger: true, confirmLabel: 'Revoke' })) call(() => api.post(`/employees/${id}/revoke-access`), 'Access revoked.'); }}><ShieldOff size={14} /> Revoke access</button>
            </>}
          {e.employmentStatus !== 'offboarded' && <Link className="btn btn-ghost" to={`/offboarding?start=${id}`}><LogOut size={14} /> Offboard…</Link>}
        </>
      )}>
      {loading && !data ? <Loading /> : error ? <ErrorNote message={error} /> : e && (
        <div style={{ display: 'grid', gap: 18 }}>
          <div className="grid-2">
            <Kv rows={[['E-mail', e.email], ['Phone', e.phone], ['Title', e.jobTitle], ['Department', e.department], ['Reports to', e.managerId?.name], ['Joined', fdate(e.dateJoined)], ['Type', label(e.employmentType)], ['Employee no.', e.employeeNo]]} />
            <Kv rows={[['Role', <Badge tone="accent">{label(e.role)}</Badge>], ['Login', e.loginEnabled ? <Badge tone="success">Enabled</Badge> : <Badge tone="gold">None</Badge>], ['MFA', e.mfaEnabled ? <Badge tone="success">On</Badge> : <Badge tone="danger">Off</Badge>], ['Last sign-in', fdatetime(e.lastLoginAt)], ['Password changed', fdate(e.passwordChangedAt)], ['Status', label(e.employmentStatus || 'active')]]} />
          </div>

          <section className="card" style={{ display: 'grid', gap: 8 }}>
            <div className="flex-between"><strong>Account information</strong>
              <span style={{ display: 'flex', gap: 8 }}>
                {e.bankAccount?.hasAccountNumber && data.canRevealAccount && !full && <button className="btn btn-ghost btn-sm" onClick={() => call(() => api.post(`/employees/${id}/reveal-account`), undefined, (r) => setFull(r.data.data))}><ShieldAlert size={13} /> Reveal (audited)</button>}
                {(self || data.canRevealAccount) && <button className="btn btn-ghost btn-sm" onClick={() => { setBank({ bankName: e.bankAccount?.bankName || '', accountName: e.bankAccount?.accountName || '', accountNumber: '' }); setEditBank(true); }}>Edit</button>}
              </span></div>
            {e.bankAccount?.bankName || e.bankAccount?.accountMasked ? <div style={{ fontSize: 13.5 }}>{e.bankAccount.bankName} · {e.bankAccount.accountName} · <span className="mono">{full ? full.accountNumber : e.bankAccount.accountMasked}</span></div> : <span className="text-muted" style={{ fontSize: 13 }}>No account information on file.</span>}
          </section>

          <section>
            <strong style={{ display: 'flex', gap: 6, alignItems: 'center' }}><Award size={15} /> Certifications {data.certSummary.expired > 0 && <Badge tone="danger">{data.certSummary.expired} expired</Badge>}{data.certSummary.expiring30 > 0 && <Badge tone="gold">{data.certSummary.expiring30} expiring</Badge>}</strong>
            {!data.certifications.length ? <p className="text-muted" style={{ fontSize: 13 }}>None recorded.</p> : (
              <div className="table-wrap"><table className="data-table" style={{ cursor: 'default' }}><thead><tr><th>Certification</th><th>Provider</th><th>Obtained</th><th>Expires</th></tr></thead>
                <tbody>{data.certifications.map((c: any) => <tr key={c._id} style={{ cursor: 'default' }}><td>{c.name}</td><td>{c.provider}</td><td>{fdate(c.dateObtained)}</td><td>{c.expiryDate ? <Badge tone={new Date(c.expiryDate) < new Date() ? 'danger' : 'neutral'}>{fdate(c.expiryDate)}</Badge> : '—'}</td></tr>)}</tbody></table></div>
            )}
          </section>

          <section>
            <strong style={{ display: 'flex', gap: 6, alignItems: 'center' }}><GraduationCap size={15} /> Training</strong>
            {!data.trainings.length ? <p className="text-muted" style={{ fontSize: 13 }}>No enrolments.</p> : (
              <div className="table-wrap"><table className="data-table" style={{ cursor: 'default' }}><thead><tr><th>Course</th><th>Category</th><th>Progress</th><th>Status</th></tr></thead>
                <tbody>{data.trainings.map((t: any) => <tr key={t._id} style={{ cursor: 'default' }}><td>{t.courseId?.title}</td><td>{t.courseId?.category}</td><td>{t.progress ?? 0}%</td><td><Badge tone={statusTone(t.status)}>{label(t.status)}</Badge></td></tr>)}</tbody></table></div>
            )}
          </section>

          {data.modules && <section><strong>Module access ({data.modules.length})</strong><div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginTop: 6 }}>{data.modules.map((m: string) => <Badge key={m}>{label(m)}</Badge>)}</div></section>}

          {data.sessions?.length > 0 && <section><strong style={{ display: 'flex', gap: 6, alignItems: 'center' }}><MonitorSmartphone size={15} /> Active sessions</strong>
            <ul style={{ fontSize: 13, paddingLeft: 18 }}>{data.sessions.map((s: any) => <li key={s._id}>{s.device} · {s.browser} · {s.ip} · last seen {fdatetime(s.lastSeenAt)}</li>)}</ul></section>}
          {data.activity?.length > 0 && <section><strong>Recent activity</strong>
            <ul style={{ fontSize: 12.5, paddingLeft: 18, color: 'var(--muted)' }}>{data.activity.map((a: any) => <li key={a._id}>{fdatetime(a.createdAt)} — {a.summary || a.action}</li>)}</ul></section>}
        </div>
      )}

      {editBank && (
        <Modal open onClose={() => setEditBank(false)} title="Account information" footer={<><button className="btn btn-ghost" onClick={() => setEditBank(false)}>Cancel</button><button className="btn btn-primary" onClick={() => call(() => api.put(`/employees/${id}/bank-account`, bank), 'Saved.', () => { setEditBank(false); setFull(null); })}>Save</button></>}>
          <div className="field"><label>Bank</label><input className="input" value={bank.bankName} onChange={(x) => setBank({ ...bank, bankName: x.target.value })} /></div>
          <div className="field"><label>Account name</label><input className="input" value={bank.accountName} onChange={(x) => setBank({ ...bank, accountName: x.target.value })} /></div>
          <div className="field"><label>Account number (leave blank to keep)</label><input className="input mono" autoComplete="off" value={bank.accountNumber} onChange={(x) => setBank({ ...bank, accountNumber: x.target.value })} /></div>
        </Modal>
      )}
      {creds && <PasswordOnce password={creds.temporaryPassword} emailed={creds.emailed} onClose={() => setCreds(null)} />}
    </Modal>
  );
}
