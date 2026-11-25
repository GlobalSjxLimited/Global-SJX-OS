import { useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Eye, EyeOff, GraduationCap, MailWarning, Play, Plus, Send, ShieldAlert, Square, Trash2 } from 'lucide-react';
import { api, apiErrorMessage } from '@/lib/api';
import { useAuth } from '@/context/AuthContext';
import { useToast } from '@/context/ToastContext';
import { useApi } from '@/lib/useApi';
import { PageHead, Tabs, ErrorNote, Loading, Empty } from '@/components/ui/PageHead';
import { Badge } from '@/components/ui/Badge';
import { Modal } from '@/components/ui/Modal';
import { AwarenessLeaderboard } from '@/components/awareness/Leaderboard';
import { fdatetime, label } from '@/lib/format';

const DEPARTMENTS = ['Executive', 'Cybersecurity', 'Payments', 'Cloud & Infrastructure', 'Digital Transformation', 'Advisory', 'Sales', 'HR', 'Finance', 'Marketing', 'Operations', 'IT & Governance', 'Risk & Compliance', 'Academy'];
const ROLES = ['super_admin', 'ceo', 'coo', 'finance', 'hr', 'sales', 'project_manager', 'engineer', 'employee'];
const EXTERNAL = ['client', 'vendor', 'training_customer'];
const roleLabel = (r: string) => ({ ceo: 'CEO', coo: 'COO', hr: 'HR' } as Record<string, string>)[r] || label(r);

export function Awareness() {
  const { user } = useAuth();
  const [sp, setSp] = useSearchParams();
  const isManager = !!user && (user.role === 'super_admin' || (user.modules || []).includes('isms'));
  const tab = sp.get('tab') || 'quiz';
  if (user && EXTERNAL.includes(user.role)) return <Empty title="Security awareness is for staff" />;
  const tabs = [{ key: 'quiz', label: 'My quiz' }, { key: 'board', label: 'Leaderboard' }, { key: 'report', label: 'Report an email' }, ...(isManager ? [{ key: 'admin', label: 'Manage (ISMS team)' }] : [])];
  return (
    <div className="page-enter">
      <PageHead title="Security Awareness" subtitle="Short questions for your role, quizzes, a place to report suspicious emails, and the company leaderboard. Everyone starts at zero each month." />
      <Tabs value={tab} onChange={(t) => setSp({ tab: t }, { replace: true })} tabs={tabs} />
      <div style={{ marginTop: 14 }}>
        {tab === 'quiz' ? <MyQuiz /> : tab === 'board' ? <AwarenessLeaderboard /> : tab === 'report' ? <ReportEmail /> : tab === 'admin' && isManager ? <Admin /> : null}
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ my quiz */
function MyQuiz() {
  const { data, reload } = useApi<any>('/awareness/me');
  const { showError } = useToast();
  const [qs, setQs] = useState<any[]>([]); const [i, setI] = useState(0); const [picked, setPicked] = useState<number | null>(null); const [res, setRes] = useState<any>(null);
  const [score, setScore] = useState({ ok: 0, pts: 0 }); const [done, setDone] = useState(false); const [busy, setBusy] = useState(false);

  async function start() {
    setBusy(true);
    try { const r = await api.post('/awareness/quiz/start', { count: 5 }); const list = r.data.data.questions; if (!list.length) { showError('No questions are available for your role yet'); return; } setQs(list); setI(0); setPicked(null); setRes(null); setScore({ ok: 0, pts: 0 }); setDone(false); }
    catch (e) { showError(apiErrorMessage(e)); } finally { setBusy(false); }
  }
  async function choose(n: number) {
    if (picked !== null) return;
    setPicked(n);
    try { const r = await api.post(`/awareness/quiz/${qs[i].serveId}/answer`, { choice: n }); setRes(r.data.data); setScore((s) => ({ ok: s.ok + (r.data.data.correct ? 1 : 0), pts: s.pts + r.data.data.points })); }
    catch (e) { showError(apiErrorMessage(e)); setPicked(null); }
  }
  function next() { if (i + 1 >= qs.length) { setDone(true); reload(); } else { setI(i + 1); setPicked(null); setRes(null); } }
  async function hide(h: boolean) { try { await api.put('/awareness/me/leaderboard', { hide: h }); reload(); } catch (e) { showError(apiErrorMessage(e)); } }

  const q = qs[i];
  return (
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(300px,1fr))', gap: 16, alignItems: 'start' }}>
      <section className="card">
        {!qs.length || done ? (
          <>
            <h2 style={{ fontSize: 16, marginTop: 0, display: 'flex', gap: 8, alignItems: 'center' }}><GraduationCap size={17} /> {done ? 'Quiz finished' : 'Take a 5-question quiz'}</h2>
            {done ? <p>You got <b>{score.ok} of {qs.length}</b> right and earned <b>{score.pts}</b> points.</p> : <p className="text-muted" style={{ fontSize: 13.5 }}>Questions are picked for your role and lean towards topics you have found harder. Correct answers earn 5, 10 or 15 points, with a small bonus for streaks (up to 60 quiz points a day).</p>}
            <button className="btn btn-primary" disabled={busy} onClick={start}><Play size={14} /> {done ? 'Another quiz' : 'Start quiz'}</button>
          </>
        ) : (
          <>
            <div className="flex-between text-muted" style={{ fontSize: 12.5, marginBottom: 6 }}><span>Question {i + 1} of {qs.length} · {q.topic.replace(/_/g, ' ')}</span><span>+{q.points} pts</span></div>
            <div className="aw-bar" style={{ marginBottom: 12 }}><span style={{ width: `${(i / qs.length) * 100}%` }} /></div>
            <div className="aw-q">{q.text}</div>
            {q.options.map((o: string, n: number) => <button key={n} className={`aw-opt ${res ? (n === res.correctIndex ? 'right' : n === picked ? 'wrong' : '') : ''}`} disabled={picked !== null} onClick={() => choose(n)}>{o}</button>)}
            {res && (<>
              <div className="aw-expl"><b>{res.correct ? 'Correct.' : 'Not quite.'}</b> {res.explanation}{res.policyRef ? <span className="text-muted"> ({res.policyRef})</span> : null}</div>
              <div className="aw-foot">{res.correct && <span className="aw-pts">+{res.points} pts{res.capped ? ' (daily limit reached)' : ''}</span>}<button className="btn btn-primary" onClick={next}>{i + 1 >= qs.length ? 'Finish' : 'Next'}</button></div>
            </>)}
          </>
        )}
      </section>

      <section className="card">
        <h2 style={{ fontSize: 16, marginTop: 0 }}>My progress</h2>
        {!data ? <Loading rows={2} /> : (
          <>
            <div className="text-muted" style={{ fontSize: 13.5 }}>{data.answered} answered · {data.answered ? Math.round((data.correct / data.answered) * 100) : 0}% correct · phishing simulations: {data.phish.received} received, {data.phish.reported} reported, {data.phish.clicked} clicked</div>
            <div style={{ marginTop: 10, display: 'grid', gap: 8 }}>
              {data.topics.length ? data.topics.map((t: any) => (
                <div key={t.topic}><div className="flex-between" style={{ fontSize: 13 }}><span>{label(t.topic)}</span><span className="text-muted">{t.accuracy}% of {t.answered}</span></div><div className="aw-bar"><span style={{ width: `${t.accuracy}%` }} /></div></div>)) : <span className="text-muted" style={{ fontSize: 13 }}>Answer a few questions to see your strengths.</span>}
            </div>
            <div style={{ marginTop: 14 }}>
              <button className="btn btn-ghost" onClick={() => hide(!data.hideFromLeaderboard)}>{data.hideFromLeaderboard ? <><Eye size={14} /> Show me on the leaderboard</> : <><EyeOff size={14} /> Hide me from the leaderboard</>}</button>
              <div className="text-muted" style={{ fontSize: 12, marginTop: 4 }}>Questions still appear if you hide; only your name on the board is removed.</div>
            </div>
          </>)}
      </section>
    </div>
  );
}

/* ------------------------------------------------------------------ report a suspicious email */
function ReportEmail() {
  const { showError } = useToast();
  const [f, setF] = useState({ subject: '', sender: '', details: '' }); const [out, setOut] = useState<any>(null); const [busy, setBusy] = useState(false);
  async function send() {
    setBusy(true);
    try { const r = await api.post('/awareness/report-phish', f); setOut(r.data.data); setF({ subject: '', sender: '', details: '' }); } catch (e) { showError(apiErrorMessage(e)); } finally { setBusy(false); }
  }
  return (
    <section className="card" style={{ maxWidth: 640 }}>
      <h2 style={{ fontSize: 16, marginTop: 0, display: 'flex', gap: 8, alignItems: 'center' }}><MailWarning size={17} /> Report a suspicious email</h2>
      <p className="text-muted" style={{ fontSize: 13.5 }}>Got something odd? Do not click or reply. Tell us the subject line and who it claims to be from. If it is one of our own practice exercises you earn points for spotting it; if it is real, security is alerted and an incident is logged.</p>
      {out && <div className="aw-expl" style={{ borderLeftColor: 'var(--success)' }}>{out.message} <b className="aw-pts">+{out.points} pts</b></div>}
      <div className="field"><label>Subject line *</label><input className="input" value={f.subject} onChange={(e) => setF({ ...f, subject: e.target.value })} /></div>
      <div className="field"><label>Sender (name or address)</label><input className="input" value={f.sender} onChange={(e) => setF({ ...f, sender: e.target.value })} /></div>
      <div className="field"><label>Anything else (did you click or open anything?)</label><textarea className="input" rows={3} value={f.details} onChange={(e) => setF({ ...f, details: e.target.value })} /></div>
      <button className="btn btn-primary" disabled={busy || f.subject.trim().length < 3} onClick={send}><Send size={14} /> Report</button>
    </section>
  );
}

/* ------------------------------------------------------------------ manager area */
function Admin() {
  const [sec, setSec] = useState<'overview' | 'questions' | 'phish'>('overview');
  return (
    <div>
      <div className="chips" style={{ marginBottom: 12 }}>
        <button className={`chip ${sec === 'overview' ? 'active' : ''}`} onClick={() => setSec('overview')}>Overview</button>
        <button className={`chip ${sec === 'questions' ? 'active' : ''}`} onClick={() => setSec('questions')}>Question bank</button>
        <button className={`chip ${sec === 'phish' ? 'active' : ''}`} onClick={() => setSec('phish')}>Phishing simulations</button>
      </div>
      {sec === 'overview' ? <Overview /> : sec === 'questions' ? <QuestionBank /> : <Phishing />}
    </div>
  );
}

const pct = (v: number | null | undefined) => (v === null || v === undefined ? '—' : `${Math.round(v * 100)}%`);

function Overview() {
  const { data, loading, error } = useApi<any>('/awareness/stats');
  if (loading && !data) return <Loading />;
  return (
    <div>
      <ErrorNote message={error} />
      <div className="stat-grid" style={{ marginBottom: 14 }}>
        <div className="stat-card"><div className="stat-label"><span>Participation (30 days)</span></div><div className="stat-value">{pct(data?.participation)}</div></div>
        <div className="stat-card"><div className="stat-label"><span>Quiz accuracy (90 days)</span></div><div className="stat-value">{pct(data?.accuracy)}</div></div>
        <div className="stat-card"><div className="stat-label"><span>Phishing: did not click</span></div><div className="stat-value">{pct(data?.phishResilience)}</div></div>
        <div className="stat-card"><div className="stat-label"><span>Phishing: reported</span></div><div className="stat-value">{pct(data?.phishReportRate)}</div></div>
      </div>
      <section className="card">
        <h2 style={{ fontSize: 15, marginTop: 0 }}>Topics, weakest first (last 90 days)</h2>
        {data?.topics?.length ? data.topics.map((t: any) => <div key={t.topic} style={{ marginBottom: 8 }}><div className="flex-between" style={{ fontSize: 13 }}><span>{label(t.topic)}</span><span className="text-muted">{t.accuracy}% of {t.answered} answers</span></div><div className="aw-bar"><span style={{ width: `${t.accuracy}%` }} /></div></div>) : <span className="text-muted">No answers yet.</span>}
        <p className="text-muted" style={{ fontSize: 12.5, marginBottom: 0 }}>These figures feed the ISMS metrics (link a metric to “phish_resilience”, “awareness_quiz_accuracy” or “awareness_participation”). Topics under 60% with 8+ answers also appear as suggested risks.</p>
      </section>
    </div>
  );
}

function QuestionBank() {
  const { data, loading, error, reload } = useApi<any>('/awareness/questions');
  const { showError, showSuccess } = useToast();
  const [topic, setTopic] = useState(''); const [edit, setEdit] = useState<any>(null);
  const blank = { text: '', options: ['', '', '', ''], correctIndex: 0, explanation: '', topic: 'phishing', difficulty: 'medium', roles: [] as string[], policyRef: '' };
  async function save() {
    try {
      const b = { ...edit, options: edit.options.map((o: string) => o.trim()).filter(Boolean), policyRef: edit.policyRef || undefined };
      if (edit._id) await api.patch(`/awareness/questions/${edit._id}`, b); else await api.post('/awareness/questions', b);
      showSuccess('Saved'); setEdit(null); reload();
    } catch (e) { showError(apiErrorMessage(e)); }
  }
  async function toggle(q: any) { try { await api.patch(`/awareness/questions/${q._id}`, { active: !q.active }); reload(); } catch (e) { showError(apiErrorMessage(e)); } }
  async function remove(q: any) { try { await api.delete(`/awareness/questions/${q._id}`); reload(); } catch (e) { showError(apiErrorMessage(e)); } }
  if (loading && !data) return <Loading />;
  const list: any[] = (data?.questions || []).filter((q: any) => !topic || q.topic === topic);
  return (
    <div>
      <ErrorNote message={error} />
      <div className="flex-between" style={{ marginBottom: 10, gap: 8, flexWrap: 'wrap' }}>
        <div className="chips"><button className={`chip ${!topic ? 'active' : ''}`} onClick={() => setTopic('')}>All ({data?.questions.length})</button>{(data?.topics || []).map((t: string) => <button key={t} className={`chip ${topic === t ? 'active' : ''}`} onClick={() => setTopic(t)}>{label(t)}</button>)}</div>
        <button className="btn btn-primary" onClick={() => setEdit({ ...blank })}><Plus size={14} /> New question</button>
      </div>
      <div className="table-wrap"><table className="data-table"><thead><tr><th>Question</th><th>Topic</th><th>For roles</th><th>Level</th><th>Answered</th><th /></tr></thead><tbody>
        {list.map((q) => (
          <tr key={q._id} style={q.active ? undefined : { opacity: 0.5 }}>
            <td style={{ maxWidth: 420 }}>{q.text}</td><td>{label(q.topic)}</td><td>{q.roles?.length ? q.roles.map(roleLabel).join(', ') : 'Everyone'}</td><td>{q.difficulty}</td><td>{q.answered}{q.accuracy !== null ? ` · ${q.accuracy}%` : ''}</td>
            <td style={{ whiteSpace: 'nowrap' }}>
              <button className="btn btn-ghost" onClick={() => setEdit({ ...q, options: [...q.options, '', '', '', ''].slice(0, Math.max(4, q.options.length)) })}>Edit</button>
              <button className="btn btn-ghost" onClick={() => toggle(q)}>{q.active ? 'Switch off' : 'Switch on'}</button>
              <button className="btn btn-ghost" aria-label="Delete" onClick={() => remove(q)}><Trash2 size={14} /></button>
            </td></tr>))}
      </tbody></table></div>
      <Modal open={!!edit} onClose={() => setEdit(null)} title={edit?._id ? 'Edit question' : 'New question'} footer={<><button className="btn btn-ghost" onClick={() => setEdit(null)}>Cancel</button><button className="btn btn-primary" onClick={save}>Save</button></>}>
        {edit && (<div style={{ display: 'grid', gap: 10 }}>
          <div className="field"><label>Question *</label><textarea className="input" rows={2} value={edit.text} onChange={(e) => setEdit({ ...edit, text: e.target.value })} /></div>
          {edit.options.map((o: string, n: number) => (
            <div key={n} style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
              <input type="radio" name="correct" checked={edit.correctIndex === n} onChange={() => setEdit({ ...edit, correctIndex: n })} aria-label={`Option ${n + 1} is correct`} />
              <input className="input" placeholder={`Answer ${n + 1}${n < 2 ? ' *' : ''}`} value={o} onChange={(e) => { const op = [...edit.options]; op[n] = e.target.value; setEdit({ ...edit, options: op }); }} />
            </div>))}
          <div className="text-muted" style={{ fontSize: 12 }}>Select the radio button next to the correct answer. The order is shuffled for each person.</div>
          <div className="field"><label>Explanation shown after answering *</label><textarea className="input" rows={2} value={edit.explanation} onChange={(e) => setEdit({ ...edit, explanation: e.target.value })} /></div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
            <div className="field"><label>Topic</label><select className="input" value={edit.topic} onChange={(e) => setEdit({ ...edit, topic: e.target.value })}>{(data?.topics || []).map((t: string) => <option key={t} value={t}>{label(t)}</option>)}</select></div>
            <div className="field"><label>Difficulty (points 5/10/15)</label><select className="input" value={edit.difficulty} onChange={(e) => setEdit({ ...edit, difficulty: e.target.value })}><option value="easy">easy</option><option value="medium">medium</option><option value="hard">hard</option></select></div>
          </div>
          <div className="field"><label>Policy it relates to (optional)</label><input className="input" value={edit.policyRef || ''} onChange={(e) => setEdit({ ...edit, policyRef: e.target.value })} /></div>
          <div className="field"><label>Show only to these roles (none ticked = everyone)</label><div className="chips">{ROLES.map((r) => <button type="button" key={r} className={`chip ${edit.roles.includes(r) ? 'active' : ''}`} onClick={() => setEdit({ ...edit, roles: edit.roles.includes(r) ? edit.roles.filter((x: string) => x !== r) : [...edit.roles, r] })}>{roleLabel(r)}</button>)}</div></div>
        </div>)}
      </Modal>
    </div>
  );
}

function Phishing() {
  const camps = useApi<any[]>('/awareness/phish/campaigns');
  const tpls = useApi<any[]>('/awareness/phish/templates');
  const { showError, showSuccess } = useToast();
  const [make, setMake] = useState<any>(null); const [preview, setPreview] = useState<any>(null); const [view, setView] = useState<string | null>(null);

  async function previewAudience(f: any) { try { const r = await api.post('/awareness/phish/audience-preview', f.audience); setPreview(r.data.data); } catch (e) { showError(apiErrorMessage(e)); } }
  async function create() {
    try { await api.post('/awareness/phish/campaigns', make); setMake(null); setPreview(null); showSuccess('Draft created – review it, then launch'); camps.reload(); } catch (e) { showError(apiErrorMessage(e)); }
  }
  async function act(id: string, what: 'launch' | 'end') { try { await api.post(`/awareness/phish/campaigns/${id}/${what}`); showSuccess(what === 'launch' ? 'Launched – emails sent' : 'Ended'); camps.reload(); } catch (e) { showError(apiErrorMessage(e)); } }
  async function del(id: string) { try { await api.delete(`/awareness/phish/campaigns/${id}`); camps.reload(); } catch (e) { showError(apiErrorMessage(e)); } }
  const toggleIn = (k: 'roles' | 'departments', v: string) => { const a = make.audience[k]; const n = { ...make, audience: { ...make.audience, [k]: a.includes(v) ? a.filter((x: string) => x !== v) : [...a, v] } }; setMake(n); setPreview(null); };

  return (
    <div>
      <div className="card" style={{ marginBottom: 12, fontSize: 13.5 }}>
        <b><ShieldAlert size={14} style={{ verticalAlign: -2 }} /> Authorised exercises only.</b> Simulations send harmless practice emails to our own staff. They never ask for a password or show a login form; a click only leads to an explanation of the warning signs. Management must authorise each exercise (ISO 27001 A.6.3), and it closes by itself after 7 days.
      </div>
      <div className="flex-between" style={{ marginBottom: 10 }}><h2 style={{ fontSize: 15, margin: 0 }}>Simulations</h2><button className="btn btn-primary" onClick={() => { setMake({ name: '', templateKey: tpls.data?.[0]?.key || 'pwd-expiry', audience: { roles: [], departments: [], userIds: [] }, authorisedBy: '', authorisedNote: '', confirmAuthorised: false }); setPreview(null); }}><Plus size={14} /> New simulation</button></div>
      <ErrorNote message={camps.error} />
      {camps.loading && !camps.data ? <Loading /> : !camps.data?.length ? <Empty title="No simulations yet" hint="Create one, pick a template and an audience, and launch when management has agreed." /> : (
        <div className="table-wrap"><table className="data-table"><thead><tr><th>Name</th><th>Status</th><th>Sent</th><th>Clicked</th><th>Reported</th><th>Authorised by</th><th /></tr></thead><tbody>
          {camps.data.map((c) => (
            <tr key={c._id}><td>{c.name}</td><td><Badge tone={c.status === 'running' ? 'gold' : c.status === 'ended' ? 'success' : 'neutral'}>{c.status}</Badge></td><td>{c.targetCount || '—'}{c.undelivered ? <span className="text-muted"> ({c.undelivered} not emailed)</span> : null}</td><td>{c.clicked}</td><td>{c.reported}</td><td>{c.authorisedBy}</td>
              <td style={{ whiteSpace: 'nowrap' }}>
                {c.status === 'draft' && <><button className="btn btn-primary" onClick={() => act(c._id, 'launch')}><Play size={14} /> Launch</button><button className="btn btn-ghost" aria-label="Delete draft" onClick={() => del(c._id)}><Trash2 size={14} /></button></>}
                {c.status === 'running' && <button className="btn btn-ghost" onClick={() => act(c._id, 'end')}><Square size={14} /> End now</button>}
                {c.status !== 'draft' && <button className="btn btn-ghost" onClick={() => setView(c._id)}>Results</button>}
              </td></tr>))}
        </tbody></table></div>)}

      <Modal open={!!make} onClose={() => setMake(null)} title="New phishing simulation" size="wide" footer={<><button className="btn btn-ghost" onClick={() => setMake(null)}>Cancel</button><button className="btn btn-primary" disabled={!make || make.name.length < 3 || make.authorisedBy.length < 3 || !make.confirmAuthorised} onClick={create}>Create draft</button></>}>
        {make && (<div style={{ display: 'grid', gap: 10 }}>
          <div className="field"><label>Name *</label><input className="input" value={make.name} onChange={(e) => setMake({ ...make, name: e.target.value })} placeholder="e.g. Q4 password-expiry exercise" /></div>
          <div className="field"><label>Template</label>
            <select className="input" value={make.templateKey} onChange={(e) => setMake({ ...make, templateKey: e.target.value })}>{(tpls.data || []).map((t) => <option key={t.key} value={t.key}>{t.name} ({t.difficulty})</option>)}</select>
            {(() => { const t = tpls.data?.find((x) => x.key === make.templateKey); return t ? <div className="text-muted" style={{ fontSize: 12.5, marginTop: 4 }}>Subject: “{t.subject}” · red flags taught: {t.redFlags.join('; ')}</div> : null; })()}
          </div>
          <div className="field"><label>Audience (nothing ticked = all staff)</label>
            <div className="chips" style={{ marginBottom: 6 }}>{ROLES.map((r) => <button type="button" key={r} className={`chip ${make.audience.roles.includes(r) ? 'active' : ''}`} onClick={() => toggleIn('roles', r)}>{roleLabel(r)}</button>)}</div>
            <div className="chips">{DEPARTMENTS.map((d) => <button type="button" key={d} className={`chip ${make.audience.departments.includes(d) ? 'active' : ''}`} onClick={() => toggleIn('departments', d)}>{d}</button>)}</div>
            <div style={{ marginTop: 6 }}><button type="button" className="btn btn-ghost" onClick={() => previewAudience(make)}>Count people</button> {preview && <span className="text-muted" style={{ fontSize: 13 }}>{preview.count} people{preview.sample.length ? `, e.g. ${preview.sample.slice(0, 4).join(', ')}` : ''}</span>}</div>
          </div>
          <div className="field"><label>Authorised by (name and position) *</label><input className="input" value={make.authorisedBy} onChange={(e) => setMake({ ...make, authorisedBy: e.target.value })} /></div>
          <div className="field"><label>Note (reference to the approval, optional)</label><input className="input" value={make.authorisedNote} onChange={(e) => setMake({ ...make, authorisedNote: e.target.value })} /></div>
          <label style={{ display: 'flex', gap: 8, alignItems: 'flex-start', fontSize: 13.5 }}><input type="checkbox" checked={make.confirmAuthorised} onChange={(e) => setMake({ ...make, confirmAuthorised: e.target.checked })} /> I confirm management has authorised this exercise and that it is aimed only at our own staff.</label>
        </div>)}
      </Modal>
      {view && <Results id={view} onClose={() => setView(null)} />}
    </div>
  );
}

function Results({ id, onClose }: { id: string; onClose: () => void }) {
  const { data, loading, error } = useApi<any>(`/awareness/phish/campaigns/${id}/results`);
  return (
    <Modal open onClose={onClose} title={data ? `Results: ${data.campaign.name}` : 'Results'} size="wide" footer={<button className="btn btn-primary" onClick={onClose}>Close</button>}>
      <ErrorNote message={error} />
      {loading && !data ? <Loading /> : data && (
        <div style={{ display: 'grid', gap: 12 }}>
          <div className="stat-grid">
            <div className="stat-card"><div className="stat-label"><span>Sent</span></div><div className="stat-value">{data.totals.targets}</div></div>
            <div className="stat-card"><div className="stat-label"><span>Clicked</span></div><div className="stat-value" style={data.totals.clickRate >= 25 ? { color: 'var(--danger)' } : undefined}>{data.totals.clickRate}%</div></div>
            <div className="stat-card"><div className="stat-label"><span>Reported</span></div><div className="stat-value">{data.totals.reportRate}%</div></div>
          </div>
          <div className="table-wrap"><table className="data-table"><thead><tr><th>Department</th><th>People</th><th>Clicked</th><th>Reported</th></tr></thead><tbody>{data.departments.map((d: any) => <tr key={d.name}><td>{d.name}</td><td>{d.targets}</td><td>{d.clicked} ({d.clickRate}%)</td><td>{d.reported}</td></tr>)}</tbody></table></div>
          <details><summary style={{ cursor: 'pointer' }}>Individual results ({data.people.length}) – for coaching, not for blame</summary>
            <div className="table-wrap"><table className="data-table"><thead><tr><th>Name</th><th>Department</th><th>Outcome</th><th>When</th></tr></thead><tbody>
              {data.people.map((p: any, n: number) => <tr key={n}><td>{p.name}{p.repeatClicker ? <Badge tone="gold">repeat</Badge> : null}</td><td>{p.department}</td><td><Badge tone={p.outcome === 'reported' ? 'success' : p.outcome === 'clicked' ? 'danger' : 'neutral'}>{p.outcome}</Badge></td><td>{fdatetime(p.reportedAt || p.clickedAt)}</td></tr>)}
            </tbody></table></div>
          </details>
        </div>)}
    </Modal>
  );
}
