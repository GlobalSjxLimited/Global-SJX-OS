import { useEffect, useState } from 'react';
import { ShieldCheck, CheckCircle2, XCircle, Plus, ClipboardCheck, RefreshCw } from 'lucide-react';
import { api, apiErrorMessage } from '@/lib/api';
import { useAuth } from '@/context/AuthContext';
import { useToast } from '@/context/ToastContext';
import { Badge } from '@/components/ui/Badge';
import { Modal } from '@/components/ui/Modal';
import { EmptyState, Skeleton } from '@/components/ui/Feedback';
import { RichTextEditor, RichTextRenderer } from '@/components/ui/RichText';
import { StatCard } from '@/components/ui/StatCard';

type Tab = 'overview' | 'controls' | 'requirements' | 'suppliers' | 'environment' | 'audit' | 'privacy';
const TABS: Array<{ id: Tab; label: string }> = [
  { id: 'overview', label: 'Overview' },
  { id: 'controls', label: 'Controls register' },
  { id: 'requirements', label: 'Security requirements' },
  { id: 'suppliers', label: 'Outsourced development' },
  { id: 'environment', label: 'Environments' },
  { id: 'audit', label: 'Audit log' },
  { id: 'privacy', label: 'Privacy & consent' },
];
const MANAGERS = ['super_admin', 'ceo', 'coo'];
const statusTone = (s: string): 'success' | 'gold' | 'neutral' | 'danger' | 'accent' =>
  ({ implemented: 'success', in_progress: 'gold', not_started: 'danger', not_applicable: 'neutral', approved: 'success', verified: 'success', submitted: 'accent', draft: 'neutral', rejected: 'danger', active: 'success', onboarding: 'gold', under_review: 'gold', terminated: 'neutral', low: 'success', medium: 'gold', high: 'danger' } as any)[s] || 'neutral';
const fmt = (d?: string) => (d ? new Date(d).toLocaleDateString() : '—');

export function Security() {
  const { user } = useAuth();
  const manager = !!user && MANAGERS.includes(user.role);
  const [tab, setTab] = useState<Tab>('overview');

  return (
    <div>
      <div className="page-head">
        <div>
          <h1>Information Security</h1>
          <p>Secure-development controls (ISO/IEC 27001:2022), security requirements, supplier oversight, environment separation and audit trail.</p>
        </div>
      </div>
      <div className="tabs">
        {TABS.filter((t) => manager || !['audit', 'privacy'].includes(t.id)).map((t) => (
          <button key={t.id} className={`tab ${tab === t.id ? 'active' : ''}`} onClick={() => setTab(t.id)}>{t.label}</button>
        ))}
      </div>
      {tab === 'overview' && <Overview />}
      {tab === 'controls' && <Controls manager={manager} />}
      {tab === 'requirements' && <Requirements manager={manager} userId={user?.id || ''} />}
      {tab === 'suppliers' && <Suppliers manager={manager} />}
      {tab === 'environment' && <Environment />}
      {tab === 'audit' && manager && <Audit />}
      {tab === 'privacy' && manager && <Privacy />}
    </div>
  );
}

/* ------------------------------ Overview ------------------------------ */
function Overview() {
  const { user, refreshUser } = useAuth();
  const { showError, showSuccess } = useToast();
  const [s, setS] = useState<any>(null);
  useEffect(() => { api.get('/security/summary').then((r) => setS(r.data.data)).catch((e) => showError(apiErrorMessage(e))); /* eslint-disable-next-line */ }, []);
  if (!s) return <Skeleton height={240} />;
  const pct = (a: number, b: number) => (b ? Math.round((a / b) * 100) : 0);

  async function acknowledge() {
    try {
      await api.post('/auth/acknowledge-security-policy');
      await refreshUser();
      showSuccess('Thank you — your acknowledgement has been recorded.');
    } catch (e) { showError(apiErrorMessage(e)); }
  }

  return (
    <div style={{ display: 'grid', gap: 20 }}>
      <div className="stat-grid">
        <StatCard label="Control coverage" value={s.controls.coveragePct} suffix="%" sub={`${s.controls.implemented} of ${s.controls.total} implemented`} />
        <StatCard label="Enforced in code" value={s.controls.automated} sub="automated controls" />
        <StatCard label="Reviews overdue" value={s.controls.reviewsDue} sub="controls past review date" />
        <StatCard label="Requirements awaiting approval" value={s.requirements.pendingApproval} sub={`${s.requirements.approved} approved`} />
        <StatCard label="Outsourced suppliers" value={s.suppliers.total} sub={`${s.suppliers.highRisk} high risk · ${s.suppliers.reviewsDue} reviews due`} />
        <StatCard label="Staff with MFA" value={pct(s.people.mfaEnabled, s.people.staff)} suffix="%" sub={`${s.people.mfaEnabled} of ${s.people.staff}`} />
      </div>
      <div className="grid-2">
        <div className="card">
          <h3 style={{ fontSize: 16, marginBottom: 8 }}>Policy acknowledgement</h3>
          <p style={{ fontSize: 13, color: 'var(--muted)', marginBottom: 12 }}>
            {s.people.policyAcknowledged} of {s.people.staff} staff have acknowledged the Information Security Policy.
          </p>
          {user?.securityAcknowledgedAt ? (
            <Badge tone="success">You acknowledged this on {fmt(user.securityAcknowledgedAt)}</Badge>
          ) : (
            <button className="btn btn-primary" onClick={acknowledge}><ShieldCheck size={15} /> I have read and accept the policy</button>
          )}
        </div>
        <div className="card">
          <h3 style={{ fontSize: 16, marginBottom: 8 }}>What is enforced automatically</h3>
          <ul style={{ fontSize: 13, color: 'var(--muted)', lineHeight: 1.8, paddingLeft: 18, listStyle: 'disc' }}>
            <li>Strict CSP, HSTS and security headers; request IDs on every call</li>
            <li>NoSQL-injection / prototype-pollution input sanitising</li>
            <li>Mass-assignment protection and role-escalation guards</li>
            <li>12-character password policy, lockout and session revocation</li>
            <li>Upload allow-list (no SVG, extension + MIME match)</li>
            <li>Production refuses to start with weak secrets or dev databases</li>
          </ul>
        </div>
      </div>
    </div>
  );
}

/* ------------------------------ Controls ------------------------------ */
function Controls({ manager }: { manager: boolean }) {
  const { showError, showSuccess } = useToast();
  const [rows, setRows] = useState<any[] | null>(null);
  const [q, setQ] = useState('');
  const [detail, setDetail] = useState<any | null>(null);
  const [adding, setAdding] = useState(false);
  const [form, setForm] = useState<any>({ ref: '', title: '', statement: '', domain: 'Secure Development', status: 'in_progress', implementation: '' });
  const [review, setReview] = useState<any>({ outcome: 'effective', notes: '', nextReviewMonths: 6 });
  const [evidence, setEvidence] = useState({ label: '', url: '' });

  useEffect(() => { load(); /* eslint-disable-next-line */ }, [q]);
  async function load() {
    try {
      const r = await api.get('/security/controls', { params: q ? { q } : {} });
      setRows(r.data.data);
      if (detail) setDetail(r.data.data.find((c: any) => c._id === detail._id) || null);
    } catch (e) { showError(apiErrorMessage(e)); }
  }
  async function create() {
    try { await api.post('/security/controls', form); setAdding(false); showSuccess('Control added.'); load(); } catch (e) { showError(apiErrorMessage(e)); }
  }
  async function setStatus(status: string) {
    try { await api.patch(`/security/controls/${detail._id}`, { status }); load(); } catch (e) { showError(apiErrorMessage(e)); }
  }
  async function submitReview() {
    try { await api.post(`/security/controls/${detail._id}/review`, review); showSuccess('Review recorded.'); setReview({ outcome: 'effective', notes: '', nextReviewMonths: 6 }); load(); } catch (e) { showError(apiErrorMessage(e)); }
  }
  async function addEvidence() {
    try { await api.post(`/security/controls/${detail._id}/evidence`, evidence); setEvidence({ label: '', url: '' }); load(); } catch (e) { showError(apiErrorMessage(e)); }
  }
  async function seedBaseline() {
    try { const r = await api.post('/security/controls/seed-baseline'); showSuccess(`${r.data.data.created} baseline controls added.`); load(); } catch (e) { showError(apiErrorMessage(e)); }
  }

  if (!rows) return <Skeleton height={240} />;
  return (
    <div>
      <div style={{ display: 'flex', gap: 12, marginBottom: 16, flexWrap: 'wrap', alignItems: 'center' }}>
        <input className="input" style={{ maxWidth: 300 }} placeholder="Search controls…" value={q} onChange={(e) => setQ(e.target.value)} />
        <div style={{ flex: 1 }} />
        {manager && <button className="btn btn-ghost" onClick={seedBaseline}><RefreshCw size={14} /> Add missing baseline controls</button>}
        {manager && <button className="btn btn-primary" onClick={() => setAdding(true)}><Plus size={15} /> New control</button>}
      </div>
      {rows.length === 0 ? <EmptyState message="No controls yet." /> : (
        <div className="table-wrap">
          <table className="data-table">
            <thead><tr><th>Ref</th><th>Control</th><th>Domain</th><th>Status</th><th>Enforcement</th><th>Next review</th></tr></thead>
            <tbody>
              {rows.map((c) => (
                <tr key={c._id} onClick={() => setDetail(c)}>
                  <td style={{ whiteSpace: 'nowrap', fontWeight: 600 }}>{c.ref}</td>
                  <td>{c.title}</td>
                  <td>{c.domain}</td>
                  <td><Badge tone={statusTone(c.status)}>{c.status.replace(/_/g, ' ')}</Badge></td>
                  <td>{c.automated ? <Badge tone="accent">In code</Badge> : <Badge tone="neutral">Procedure</Badge>}</td>
                  <td style={{ color: c.nextReviewAt && new Date(c.nextReviewAt) < new Date() ? 'var(--danger)' : undefined }}>{fmt(c.nextReviewAt)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <Modal open={!!detail} onClose={() => setDetail(null)} title={detail ? `${detail.ref} — ${detail.title}` : ''}>
        {detail && (
          <div style={{ display: 'grid', gap: 16 }}>
            <blockquote style={{ borderLeft: '3px solid var(--accent)', paddingLeft: 12, fontSize: 13.5, color: 'var(--muted)' }}>{detail.statement}</blockquote>
            <div>
              <div style={{ fontSize: 12.5, fontWeight: 600, marginBottom: 6 }}>How it is implemented</div>
              <RichTextRenderer content={detail.implementation || '<p>Not yet documented.</p>'} />
            </div>
            <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
              <span style={{ fontSize: 12.5, color: 'var(--muted)' }}>Status</span>
              {manager ? (
                <select className="input" style={{ maxWidth: 190 }} value={detail.status} onChange={(e) => setStatus(e.target.value)}>
                  {['not_started', 'in_progress', 'implemented', 'not_applicable'].map((s) => <option key={s} value={s}>{s.replace(/_/g, ' ')}</option>)}
                </select>
              ) : <Badge tone={statusTone(detail.status)}>{detail.status.replace(/_/g, ' ')}</Badge>}
              <span style={{ fontSize: 12.5, color: 'var(--muted)' }}>Last reviewed {fmt(detail.lastReviewedAt)} · next {fmt(detail.nextReviewAt)}</span>
            </div>
            <div>
              <div style={{ fontSize: 12.5, fontWeight: 600, marginBottom: 6 }}>Evidence</div>
              {(detail.evidence || []).length === 0 ? <p style={{ fontSize: 13, color: 'var(--muted)' }}>No evidence attached yet.</p> : (
                <ul style={{ fontSize: 13, paddingLeft: 18, listStyle: 'disc' }}>
                  {detail.evidence.map((e: any) => <li key={e._id}>{e.url ? <a href={e.url} target="_blank" rel="noopener noreferrer" style={{ color: 'var(--accent)' }}>{e.label}</a> : e.label} <span style={{ color: 'var(--muted-2)' }}>· {fmt(e.at)}</span></li>)}
                </ul>
              )}
              {(
                <div style={{ display: 'flex', gap: 8, marginTop: 8, flexWrap: 'wrap' }}>
                  <input className="input" style={{ flex: 1, minWidth: 140 }} placeholder="Evidence label" value={evidence.label} onChange={(e) => setEvidence({ ...evidence, label: e.target.value })} />
                  <input className="input" style={{ flex: 1, minWidth: 140 }} placeholder="https:// link (optional)" value={evidence.url} onChange={(e) => setEvidence({ ...evidence, url: e.target.value })} />
                  <button className="btn btn-ghost btn-sm" onClick={addEvidence} disabled={!evidence.label}>Add</button>
                </div>
              )}
            </div>
            <div>
              <div style={{ fontSize: 12.5, fontWeight: 600, marginBottom: 6 }}>Review history</div>
              {(detail.reviews || []).length === 0 ? <p style={{ fontSize: 13, color: 'var(--muted)' }}>No reviews recorded.</p> : [...detail.reviews].reverse().map((r: any) => (
                <div key={r._id} style={{ fontSize: 13, marginBottom: 6 }}><Badge tone={r.outcome === 'effective' ? 'success' : r.outcome === 'ineffective' ? 'danger' : 'gold'}>{r.outcome.replace(/_/g, ' ')}</Badge> {r.reviewerId?.name} · {fmt(r.at)} {r.notes && <span style={{ color: 'var(--muted)' }}>— {r.notes}</span>}</div>
              ))}
              {manager && (
                <div style={{ display: 'grid', gap: 8, marginTop: 10, padding: 12, border: '1px solid var(--line)', borderRadius: 10 }}>
                  <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                    <select className="input" style={{ maxWidth: 200 }} value={review.outcome} onChange={(e) => setReview({ ...review, outcome: e.target.value })}>
                      <option value="effective">Effective</option><option value="partially_effective">Partially effective</option><option value="ineffective">Ineffective</option>
                    </select>
                    <select className="input" style={{ maxWidth: 170 }} value={review.nextReviewMonths} onChange={(e) => setReview({ ...review, nextReviewMonths: e.target.value })}>
                      {[3, 6, 12].map((m) => <option key={m} value={m}>Next review in {m} months</option>)}
                    </select>
                  </div>
                  <input className="input" placeholder="Review notes" value={review.notes} onChange={(e) => setReview({ ...review, notes: e.target.value })} />
                  <div><button className="btn btn-primary btn-sm" onClick={submitReview}><ClipboardCheck size={14} /> Record review</button></div>
                </div>
              )}
            </div>
          </div>
        )}
      </Modal>

      <Modal open={adding} onClose={() => setAdding(false)} title="New control" footer={<><button className="btn btn-ghost" onClick={() => setAdding(false)}>Cancel</button><button className="btn btn-primary" onClick={create} disabled={!form.ref || !form.title || !form.statement}>Add control</button></>}>
        <div className="form-grid">
          <div className="field"><label>Reference *</label><input className="input" placeholder="A.8.xx" value={form.ref} onChange={(e) => setForm({ ...form, ref: e.target.value })} /></div>
          <div className="field"><label>Domain</label><select className="input" value={form.domain} onChange={(e) => setForm({ ...form, domain: e.target.value })}>{['Secure Development', 'Access Control', 'Operations', 'Data Protection', 'Supplier', 'Privacy', 'Resilience'].map((d) => <option key={d}>{d}</option>)}</select></div>
          <div className="field full"><label>Control title *</label><input className="input" value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} /></div>
          <div className="field full"><label>Control statement *</label><textarea className="input" value={form.statement} onChange={(e) => setForm({ ...form, statement: e.target.value })} /></div>
          <div className="field full"><label>Implementation</label><RichTextEditor value={form.implementation} onChange={(h) => setForm((f: any) => ({ ...f, implementation: h }))} /></div>
        </div>
      </Modal>
    </div>
  );
}

/* ---------------------------- Requirements ---------------------------- */
function Requirements({ manager, userId }: { manager: boolean; userId: string }) {
  const { showError, showSuccess } = useToast();
  const [rows, setRows] = useState<any[] | null>(null);
  const [adding, setAdding] = useState(false);
  const [form, setForm] = useState<any>({ application: '', kind: 'develop', title: '', description: '', category: 'other', priority: 'must' });
  const [decision, setDecision] = useState<any | null>(null);
  const [note, setNote] = useState('');

  useEffect(() => { load(); }, []);
  async function load() {
    try { setRows((await api.get('/security/requirements')).data.data); } catch (e) { showError(apiErrorMessage(e)); }
  }
  async function create() {
    try { await api.post('/security/requirements', form); setAdding(false); setForm({ application: '', kind: 'develop', title: '', description: '', category: 'other', priority: 'must' }); load(); } catch (e) { showError(apiErrorMessage(e)); }
  }
  async function act(id: string, action: string, body: any = {}) {
    try { await api.post(`/security/requirements/${id}/${action}`, body); load(); setDecision(null); setNote(''); showSuccess('Done.'); } catch (e) { showError(apiErrorMessage(e)); }
  }
  async function verify(id: string) {
    const evidence = window.prompt('Verification evidence (test result, report link, PR…)');
    if (evidence) act(id, 'verify', { evidence });
  }

  if (!rows) return <Skeleton height={200} />;
  return (
    <div>
      <p style={{ fontSize: 13, color: 'var(--muted)', maxWidth: 760, marginBottom: 14 }}>
        Security requirements must be identified, specified and <strong>approved</strong> before an application is developed or acquired (A.5.8 / A.8.26). The requester cannot approve their own requirement.
      </p>
      <div style={{ marginBottom: 14 }}><button className="btn btn-primary" onClick={() => setAdding(true)}><Plus size={15} /> New requirement</button></div>
      {rows.length === 0 ? <EmptyState message="No security requirements yet." /> : (
        <div className="table-wrap">
          <table className="data-table">
            <thead><tr><th>Application</th><th>Requirement</th><th>Type</th><th>Priority</th><th>Status</th><th></th></tr></thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r._id} style={{ cursor: 'default' }}>
                  <td>{r.application}</td>
                  <td><strong>{r.title}</strong><div style={{ fontSize: 12, color: 'var(--muted)' }}>{String(r.category).replace(/_/g, ' ')}{r.approvedById?.name ? ` · approved by ${r.approvedById.name}` : ''}</div></td>
                  <td>{r.kind}</td>
                  <td>{r.priority}</td>
                  <td><Badge tone={statusTone(r.status)}>{r.status}</Badge></td>
                  <td style={{ whiteSpace: 'nowrap' }}>
                    {['draft', 'rejected'].includes(r.status) && (r.requestedById?._id === userId || manager) && <button className="btn btn-ghost btn-sm" onClick={() => act(r._id, 'submit')}>Submit</button>}
                    {r.status === 'submitted' && manager && r.requestedById?._id !== userId && <button className="btn btn-primary btn-sm" onClick={() => setDecision(r)}>Decide</button>}
                    {r.status === 'approved' && <button className="btn btn-ghost btn-sm" onClick={() => verify(r._id)}>Verify</button>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <Modal open={adding} onClose={() => setAdding(false)} title="New security requirement" footer={<><button className="btn btn-ghost" onClick={() => setAdding(false)}>Cancel</button><button className="btn btn-primary" onClick={create} disabled={!form.application || !form.title}>Save draft</button></>}>
        <div className="form-grid">
          <div className="field"><label>Application / system *</label><input className="input" value={form.application} onChange={(e) => setForm({ ...form, application: e.target.value })} /></div>
          <div className="field"><label>Develop or acquire</label><select className="input" value={form.kind} onChange={(e) => setForm({ ...form, kind: e.target.value })}><option value="develop">Develop</option><option value="acquire">Acquire</option></select></div>
          <div className="field full"><label>Requirement *</label><input className="input" value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} /></div>
          <div className="field"><label>Category</label><select className="input" value={form.category} onChange={(e) => setForm({ ...form, category: e.target.value })}>{['authentication', 'authorisation', 'data_protection', 'logging', 'availability', 'privacy', 'integration', 'other'].map((c) => <option key={c} value={c}>{c.replace(/_/g, ' ')}</option>)}</select></div>
          <div className="field"><label>Priority</label><select className="input" value={form.priority} onChange={(e) => setForm({ ...form, priority: e.target.value })}><option value="must">Must</option><option value="should">Should</option><option value="could">Could</option></select></div>
          <div className="field full"><label>Specification</label><RichTextEditor value={form.description} onChange={(h) => setForm((f: any) => ({ ...f, description: h }))} /></div>
        </div>
      </Modal>

      <Modal open={!!decision} onClose={() => setDecision(null)} title="Approve or reject requirement" footer={decision && <><button className="btn btn-ghost" onClick={() => act(decision._id, 'decision', { decision: 'reject', note })}><XCircle size={14} /> Reject</button><button className="btn btn-primary" onClick={() => act(decision._id, 'decision', { decision: 'approve', note })}><CheckCircle2 size={14} /> Approve</button></>}>
        {decision && (<><h4 style={{ fontSize: 16 }}>{decision.application}: {decision.title}</h4><RichTextRenderer content={decision.description} /><div className="field"><label>Decision note</label><textarea className="input" value={note} onChange={(e) => setNote(e.target.value)} /></div></>)}
      </Modal>
    </div>
  );
}

/* ------------------------------ Suppliers ------------------------------ */
function Suppliers({ manager }: { manager: boolean }) {
  const { showError, showSuccess } = useToast();
  const [rows, setRows] = useState<any[] | null>(null);
  const [adding, setAdding] = useState(false);
  const blank = { supplier: '', scope: '', contractRef: '', securityClausesInPlace: false, codeEscrowOrOwnership: false, securityTestingEvidence: false, rightToAudit: false, ndaSigned: false, riskRating: 'medium', status: 'onboarding' };
  const [form, setForm] = useState<any>(blank);

  useEffect(() => { load(); }, []);
  async function load() { try { setRows((await api.get('/security/suppliers')).data.data); } catch (e) { showError(apiErrorMessage(e)); } }
  async function create() { try { await api.post('/security/suppliers', form); setAdding(false); setForm(blank); load(); } catch (e) { showError(apiErrorMessage(e)); } }
  async function review(id: string) {
    const findings = window.prompt('Review findings (optional)') ?? '';
    try { await api.post(`/security/suppliers/${id}/review`, { findings, nextReviewMonths: 6 }); showSuccess('Review recorded.'); load(); } catch (e) { showError(apiErrorMessage(e)); }
  }
  const flags: Array<[string, string]> = [['securityClausesInPlace', 'Security clauses in contract'], ['ndaSigned', 'NDA signed'], ['rightToAudit', 'Right to audit'], ['codeEscrowOrOwnership', 'Code ownership / escrow'], ['securityTestingEvidence', 'Security testing evidence']];
  if (!rows) return <Skeleton height={200} />;
  return (
    <div>
      <p style={{ fontSize: 13, color: 'var(--muted)', maxWidth: 760, marginBottom: 14 }}>Outsourced system development must be directed, monitored and reviewed (A.8.30). Every supplier has an owner, a risk rating and a next-review date.</p>
      {manager && <div style={{ marginBottom: 14 }}><button className="btn btn-primary" onClick={() => setAdding(true)}><Plus size={15} /> Register supplier</button></div>}
      {rows.length === 0 ? <EmptyState message="No outsourced development suppliers registered." /> : (
        <div className="grid-2">
          {rows.map((s) => (
            <div key={s._id} className="card">
              <div className="flex-between"><h3 style={{ fontSize: 16 }}>{s.supplier}</h3><Badge tone={statusTone(s.status)}>{s.status.replace(/_/g, ' ')}</Badge></div>
              <p style={{ fontSize: 13, color: 'var(--muted)', margin: '6px 0 10px' }}>{s.scope}{s.contractRef ? ` · ${s.contractRef}` : ''}</p>
              <div style={{ display: 'grid', gap: 4, fontSize: 12.5 }}>
                {flags.map(([k, l]) => <div key={k} className={s[k] ? 'check-ok' : 'check-bad'} style={{ display: 'flex', gap: 6, alignItems: 'center' }}>{s[k] ? <CheckCircle2 size={13} /> : <XCircle size={13} />} {l}</div>)}
              </div>
              <div className="flex-between" style={{ marginTop: 12, fontSize: 12.5 }}>
                <span>Risk <Badge tone={statusTone(s.riskRating)}>{s.riskRating}</Badge></span>
                <span style={{ color: s.nextReviewAt && new Date(s.nextReviewAt) < new Date() ? 'var(--danger)' : 'var(--muted)' }}>Next review {fmt(s.nextReviewAt)}</span>
              </div>
              {manager && <button className="btn btn-ghost btn-sm" style={{ marginTop: 10 }} onClick={() => review(s._id)}>Record review</button>}
            </div>
          ))}
        </div>
      )}
      <Modal open={adding} onClose={() => setAdding(false)} title="Register outsourced development supplier" footer={<><button className="btn btn-ghost" onClick={() => setAdding(false)}>Cancel</button><button className="btn btn-primary" onClick={create} disabled={!form.supplier || !form.scope}>Save</button></>}>
        <div className="form-grid">
          <div className="field full"><label>Supplier *</label><input className="input" value={form.supplier} onChange={(e) => setForm({ ...form, supplier: e.target.value })} /></div>
          <div className="field full"><label>Scope of work *</label><input className="input" value={form.scope} onChange={(e) => setForm({ ...form, scope: e.target.value })} /></div>
          <div className="field"><label>Contract reference</label><input className="input" value={form.contractRef} onChange={(e) => setForm({ ...form, contractRef: e.target.value })} /></div>
          <div className="field"><label>Risk rating</label><select className="input" value={form.riskRating} onChange={(e) => setForm({ ...form, riskRating: e.target.value })}><option>low</option><option>medium</option><option>high</option></select></div>
          <div className="field full" style={{ display: 'grid', gap: 6 }}>
            {flags.map(([k, l]) => <label key={k} style={{ display: 'flex', gap: 8, fontSize: 13, color: 'var(--text)' }}><input type="checkbox" checked={!!form[k]} onChange={(e) => setForm({ ...form, [k]: e.target.checked })} /> {l}</label>)}
          </div>
        </div>
      </Modal>
    </div>
  );
}

/* ----------------------------- Environments ----------------------------- */
function Environment() {
  const { showError } = useToast();
  const [e, setE] = useState<any>(null);
  useEffect(() => { api.get('/security/environment').then((r) => setE(r.data.data)).catch((x) => showError(apiErrorMessage(x))); /* eslint-disable-next-line */ }, []);
  if (!e) return <Skeleton height={200} />;
  return (
    <div style={{ display: 'grid', gap: 18 }}>
      <div className="card">
        <div className="flex-between"><h3 style={{ fontSize: 16 }}>This deployment</h3><Badge tone={e.appEnv === 'production' ? 'danger' : e.appEnv === 'staging' ? 'gold' : 'accent'}>{e.appEnv}</Badge></div>
        <dl className="kv" style={{ marginTop: 12 }}><dt>Database</dt><dd>{e.database || '—'}</dd><dt>NODE_ENV</dt><dd>{e.nodeEnv}</dd></dl>
      </div>
      <div className="card">
        <h3 style={{ fontSize: 16, marginBottom: 10 }}>Separation & hardening checks (A.8.31)</h3>
        {e.checks.map((c: any) => (
          <div key={c.id} style={{ display: 'flex', gap: 10, padding: '8px 0', borderTop: '1px solid var(--line)', alignItems: 'center' }}>
            {c.ok ? <CheckCircle2 size={17} className="check-ok" /> : <XCircle size={17} className="check-bad" />}
            <div style={{ flex: 1 }}><div style={{ fontSize: 13.5 }}>{c.label}</div><div style={{ fontSize: 12, color: 'var(--muted)' }}>{c.detail}</div></div>
          </div>
        ))}
      </div>
      <p style={{ fontSize: 12.5, color: 'var(--muted)' }}>Development and test data are synthetic. Production data is never copied to non-production environments (A.8.33).</p>
    </div>
  );
}

/* ------------------------------ Audit log ------------------------------ */
function Audit() {
  const { showError } = useToast();
  const [rows, setRows] = useState<any[] | null>(null);
  const [action, setAction] = useState('');
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);
  useEffect(() => {
    const t = setTimeout(async () => {
      try { const r = await api.get('/security/audit-log', { params: { action: action || undefined, page, limit: 50 } }); setRows(r.data.data); setTotal(r.data.meta.total); } catch (e) { showError(apiErrorMessage(e)); }
    }, 250);
    return () => clearTimeout(t);
    // eslint-disable-next-line
  }, [action, page]);
  return (
    <div>
      <div style={{ display: 'flex', gap: 10, marginBottom: 14, flexWrap: 'wrap' }}>
        <select className="input" style={{ maxWidth: 260 }} value={action} onChange={(e) => { setAction(e.target.value); setPage(1); }}>
          <option value="">All events</option>
          {['auth.login', 'auth.login_failed', 'auth.account_locked', 'auth.mfa', 'auth.password_changed', 'auth.sessions_revoked', 'security.', 'ticket.', 'knowledge.', 'certification.'].map((a) => <option key={a} value={a}>{a}</option>)}
        </select>
        <span style={{ fontSize: 12.5, color: 'var(--muted)', alignSelf: 'center' }}>{total} events</span>
      </div>
      {!rows ? <Skeleton height={200} /> : rows.length === 0 ? <EmptyState message="No events." /> : (
        <div className="table-wrap">
          <table className="data-table">
            <thead><tr><th>When</th><th>Who</th><th>Event</th><th>Entity</th></tr></thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r._id} style={{ cursor: 'default' }}>
                  <td style={{ whiteSpace: 'nowrap' }}>{new Date(r.createdAt).toLocaleString()}</td>
                  <td>{r.actorId?.name || '—'}</td>
                  <td><code>{r.action}</code></td>
                  <td>{r.entityType}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <div style={{ display: 'flex', gap: 8, marginTop: 12, justifyContent: 'flex-end' }}>
        <button className="btn btn-ghost btn-sm" disabled={page <= 1} onClick={() => setPage(page - 1)}>Previous</button>
        <button className="btn btn-ghost btn-sm" disabled={page * 50 >= total} onClick={() => setPage(page + 1)}>Next</button>
      </div>
    </div>
  );
}

/* ----------------------------- Privacy/consent ----------------------------- */
function Privacy() {
  const { showError } = useToast();
  const [d, setD] = useState<any>(null);
  useEffect(() => { api.get('/security/consents').then((r) => setD(r.data.data)).catch((e) => showError(apiErrorMessage(e))); /* eslint-disable-next-line */ }, []);
  if (!d) return <Skeleton height={160} />;
  return (
    <div style={{ display: 'grid', gap: 18 }}>
      <div className="stat-grid">
        <StatCard label="Consent decisions" value={d.total} sub="recorded" />
        <StatCard label="Accepted preferences" value={d.preferences} sub="cookies" />
        <StatCard label="Accepted analytics" value={d.analytics} sub="cookies" />
        <StatCard label="Accepted marketing" value={d.marketing} sub="cookies" />
      </div>
      <div className="table-wrap">
        <table className="data-table">
          <thead><tr><th>When</th><th>Source</th><th>Version</th><th>Preferences</th><th>Analytics</th><th>Marketing</th></tr></thead>
          <tbody>
            {d.recent.map((r: any) => (
              <tr key={r._id} style={{ cursor: 'default' }}>
                <td>{new Date(r.createdAt).toLocaleString()}</td><td>{r.source}</td><td>{r.policyVersion}</td>
                <td>{r.preferences ? '✔' : '—'}</td><td>{r.analytics ? '✔' : '—'}</td><td>{r.marketing ? '✔' : '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
