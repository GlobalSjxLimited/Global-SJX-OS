import { useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { ShieldAlert, Plus, Clock, Send } from 'lucide-react';
import { api, apiErrorMessage } from '@/lib/api';
import { useToast } from '@/context/ToastContext';
import { useApi } from '@/lib/useApi';
import { PageHead, Empty, Loading, ErrorNote, Kv } from '@/components/ui/PageHead';
import { Badge, statusTone } from '@/components/ui/Badge';
import { Modal } from '@/components/ui/Modal';
import { Pagination } from '@/components/ui/Pagination';
import { fdatetime, label } from '@/lib/format';
import { RecordPanel } from '@/components/record/RecordPanel';
import { ExportButton } from '@/components/ui/ExportButton';

const CATEGORIES = ['malware', 'phishing', 'unauthorised_access', 'data_loss', 'lost_device', 'service_outage', 'policy_violation', 'physical', 'supplier', 'other'];
const STATUSES = ['reported', 'triage', 'contained', 'eradicated', 'recovered', 'closed'];

/** Open to every signed-in person — reporting an incident is everyone's duty (ISO 27001 A.6.8). */
export function ReportIncident() {
  const { showError, showSuccess } = useToast();
  const navigate = useNavigate();
  const [f, setF] = useState<any>({ title: '', description: '', category: 'other', severity: 'medium', isPersonalDataBreach: false, subjectsAffected: '', riskToRights: 'risk' });
  const [busy, setBusy] = useState(false);
  const set = (k: string, v: any) => setF((p: any) => ({ ...p, [k]: v }));
  async function submit() {
    if (!f.title.trim()) return showError('Say briefly what happened.');
    setBusy(true);
    try { const r = await api.post('/incidents/report', { ...f, subjectsAffected: Number(f.subjectsAffected) || 0 }); showSuccess(`Reported as ${r.data.data.reference}. The security team has been alerted.`); navigate('/'); }
    catch (err) { showError(apiErrorMessage(err)); } finally { setBusy(false); }
  }
  return (
    <div className="page-enter" style={{ maxWidth: 720 }}>
      <PageHead title="Report a security incident" subtitle="Lost laptop, phishing e-mail, suspicious access, data sent to the wrong person — report it straight away. You will not be blamed for reporting in good faith." />
      <div className="card" style={{ display: 'grid', gap: 12 }}>
        <div className="field"><label>What happened? *</label><input className="input" value={f.title} onChange={(e) => set('title', e.target.value)} /></div>
        <div className="field"><label>Details (what, when, which systems or data, what you did)</label><textarea className="input" rows={5} value={f.description} onChange={(e) => set('description', e.target.value)} /></div>
        <div className="grid-2">
          <div className="field"><label>Type</label><select className="input" value={f.category} onChange={(e) => set('category', e.target.value)}>{CATEGORIES.map((c) => <option key={c} value={c}>{label(c)}</option>)}</select></div>
          <div className="field"><label>How serious does it look?</label><select className="input" value={f.severity} onChange={(e) => set('severity', e.target.value)}>{['low', 'medium', 'high', 'critical'].map((c) => <option key={c} value={c}>{label(c)}</option>)}</select></div>
        </div>
        <label style={{ display: 'flex', gap: 8, fontSize: 14 }}><input type="checkbox" checked={f.isPersonalDataBreach} onChange={(e) => set('isPersonalDataBreach', e.target.checked)} /> Personal data (clients, staff, learners) may have been exposed, lost or accessed</label>
        {f.isPersonalDataBreach && <div className="banner warn">The 72-hour regulator-notification clock starts now. The data-protection team has been told to act.</div>}
        <div><button className="btn btn-primary" disabled={busy} onClick={submit}><Send size={15} /> {busy ? 'Sending…' : 'Submit report'}</button></div>
      </div>
    </div>
  );
}

export function Incidents() {
  const [params, setParams] = useSearchParams();
  const [page, setPage] = useState(1);
  const [status, setStatus] = useState('');
  const [sev, setSev] = useState('');
  const [open, setOpen] = useState<string | null>(params.get('incident'));
  const navigate = useNavigate();
  const { data, extra, loading, error, reload } = useApi<any[]>('/incidents', { page, status: status || undefined, severity: sev || undefined });
  return (
    <div className="page-enter">
      <PageHead title="Incidents" subtitle="Security incident register — triage, containment, root cause, lessons learned and breach notification."
        actions={<><ExportButton endpoint="/incidents" params={{ status: status || undefined, severity: sev || undefined }} filename="incidents" columns={[{ label: 'Reference', value: (r) => r.reference }, { label: 'Title', value: (r) => r.title }, { label: 'Category', value: (r) => r.category }, { label: 'Severity', value: (r) => r.severity }, { label: 'Status', value: (r) => r.status }, { label: 'Personal data breach', value: (r) => (r.isPersonalDataBreach ? 'Yes' : 'No') }, { label: 'Detected', value: (r) => r.detectedAt }]} /><button className="btn btn-primary" onClick={() => navigate('/report-incident')}><Plus size={15} /> Report incident</button></>} />
      <div style={{ display: 'flex', gap: 10, marginBottom: 14 }}>
        <select className="input" style={{ maxWidth: 190 }} value={status} onChange={(e) => { setStatus(e.target.value); setPage(1); }}><option value="">All statuses</option>{STATUSES.map((s) => <option key={s} value={s}>{label(s)}</option>)}</select>
        <select className="input" style={{ maxWidth: 170 }} value={sev} onChange={(e) => { setSev(e.target.value); setPage(1); }}><option value="">All severities</option>{['low', 'medium', 'high', 'critical'].map((s) => <option key={s} value={s}>{label(s)}</option>)}</select>
      </div>
      <ErrorNote message={error} />
      {loading && !data ? <Loading /> : !data?.length ? <Empty icon={<ShieldAlert />} title="No incidents recorded" /> : (
        <div className="table-wrap"><table className="data-table">
          <thead><tr><th>Ref</th><th>Incident</th><th>Type</th><th>Severity</th><th>Status</th><th>Breach clock</th><th>Assignee</th><th>Detected</th></tr></thead>
          <tbody>{data.map((i) => {
            const hrs = i.isPersonalDataBreach && !i.breach?.regulatorNotified && i.breach?.regulatorDeadline ? Math.round((new Date(i.breach.regulatorDeadline).getTime() - Date.now()) / 3600000) : null;
            return (
              <tr key={i._id} onClick={() => setOpen(i._id)}>
                <td className="mono">{i.reference}</td><td style={{ fontWeight: 600 }}>{i.title}</td><td>{label(i.category)}</td>
                <td><Badge tone={statusTone(i.severity)}>{label(i.severity)}</Badge></td><td><Badge tone={statusTone(i.status)}>{label(i.status)}</Badge></td>
                <td>{i.isPersonalDataBreach ? (i.breach?.regulatorNotified ? <Badge tone="success">Notified</Badge> : <Badge tone="danger"><Clock size={11} /> {hrs! < 0 ? `${-hrs!}h overdue` : `${hrs}h left`}</Badge>) : '—'}</td>
                <td>{i.assigneeId?.name || '—'}</td><td>{fdatetime(i.detectedAt)}</td>
              </tr>);
          })}</tbody></table></div>
      )}
      {extra?.pagination && <Pagination page={extra.pagination.page} pages={extra.pagination.pages} total={extra.pagination.total} onChange={setPage} />}
      {open && <IncidentDetail id={open} onClose={() => { setOpen(null); if (params.get('incident')) { params.delete('incident'); setParams(params, { replace: true }); } }} onChanged={reload} />}
    </div>
  );
}

function IncidentDetail({ id, onClose, onChanged }: { id: string; onClose: () => void; onChanged: () => void }) {
  const { showError, showSuccess } = useToast();
  const { data: inc, loading, reload } = useApi<any>(`/incidents/${id}`);
  const [note, setNote] = useState('');
  const [rc, setRc] = useState<{ rootCause?: string; lessonsLearned?: string }>({});
  const [action, setAction] = useState('');
  async function patch(body: any, ok = 'Updated.') {
    try { await api.patch(`/incidents/${id}`, body); showSuccess(ok); setNote(''); setAction(''); reload(); onChanged(); } catch (err) { showError(apiErrorMessage(err)); }
  }
  return (
    <Modal open onClose={onClose} title={inc ? `${inc.reference} · ${inc.title}` : 'Incident'} size="xwide">
      {loading && !inc ? <Loading /> : inc && (
        <div style={{ display: 'grid', gap: 16 }}>
          <div className="grid-2">
            <Kv rows={[['Severity', <Badge tone={statusTone(inc.severity)}>{label(inc.severity)}</Badge>], ['Type', label(inc.category)], ['Reported by', inc.reportedById?.name], ['Detected', fdatetime(inc.detectedAt)], ['Contained', fdatetime(inc.containedAt)], ['Resolved', fdatetime(inc.resolvedAt)]]} />
            <div style={{ display: 'grid', gap: 8 }}>
              <div className="field" style={{ margin: 0 }}><label>Status</label>
                <select className="input" value={inc.status} onChange={(e) => patch({ status: e.target.value, rootCause: rc.rootCause, lessonsLearned: rc.lessonsLearned }, 'Status updated.')}>{STATUSES.map((s) => <option key={s} value={s}>{label(s)}</option>)}</select></div>
              {!inc.isPersonalDataBreach && <button className="btn btn-ghost btn-sm" onClick={() => patch({ isPersonalDataBreach: true }, 'Flagged — 72h clock started.')}><ShieldAlert size={13} /> Flag as personal data breach</button>}
            </div>
          </div>
          {inc.description && <p style={{ whiteSpace: 'pre-wrap', fontSize: 14, margin: 0 }}>{inc.description}</p>}
          {inc.isPersonalDataBreach && (
            <div className="card" style={{ borderLeft: '3px solid var(--danger)', display: 'grid', gap: 8 }}>
              <strong>Personal data breach</strong>
              <div style={{ fontSize: 13 }}>Regulator deadline: <strong>{fdatetime(inc.breach?.regulatorDeadline)}</strong> · Risk: {label(inc.breach?.riskToRights)} · Subjects affected: {inc.breach?.subjectsAffected}</div>
              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                {!inc.breach?.regulatorNotified ? <button className="btn btn-primary btn-sm" onClick={() => patch({ breach: { regulatorNotified: true } }, 'Regulator notification recorded.')}>Record regulator notified</button> : <Badge tone="success">Regulator notified {fdatetime(inc.breach.regulatorNotifiedAt)}</Badge>}
                {!inc.breach?.subjectsNotified ? <button className="btn btn-ghost btn-sm" onClick={() => patch({ breach: { subjectsNotified: true } }, 'Recorded.')}>Record individuals notified</button> : <Badge tone="success">Individuals notified</Badge>}
              </div>
            </div>
          )}
          <div className="grid-2">
            <div className="field"><label>Root cause</label><textarea className="input" rows={3} defaultValue={inc.rootCause} onChange={(e) => setRc({ ...rc, rootCause: e.target.value })} /></div>
            <div className="field"><label>Lessons learned</label><textarea className="input" rows={3} defaultValue={inc.lessonsLearned} onChange={(e) => setRc({ ...rc, lessonsLearned: e.target.value })} /></div>
          </div>
          <div><button className="btn btn-ghost btn-sm" onClick={() => patch(rc, 'Saved.')}>Save root cause & lessons</button></div>
          <div>
            <strong style={{ fontSize: 13 }}>Corrective actions</strong>
            {(inc.actions || []).map((a: any) => <label key={a._id} style={{ display: 'flex', gap: 8, fontSize: 13.5, padding: '3px 0' }}><input type="checkbox" checked={a.done} onChange={() => patch({ toggleAction: a._id }, 'Updated.')} /> <span style={{ textDecoration: a.done ? 'line-through' : 'none' }}>{a.text}</span></label>)}
            <div style={{ display: 'flex', gap: 8, marginTop: 6 }}><input className="input" placeholder="Add an action…" value={action} onChange={(e) => setAction(e.target.value)} /><button className="btn btn-ghost" disabled={!action.trim()} onClick={() => patch({ addAction: { text: action } }, 'Action added.')}>Add</button></div>
          </div>
          <div>
            <strong style={{ fontSize: 13 }}>Timeline</strong>
            <ul style={{ fontSize: 12.5, color: 'var(--muted)', paddingLeft: 18 }}>{[...inc.timeline].reverse().map((t: any, i: number) => <li key={i}>{fdatetime(t.at)} — {t.byName}: {t.text}</li>)}</ul>
            <div style={{ display: 'flex', gap: 8 }}><input className="input" placeholder="Add a note to the timeline…" value={note} onChange={(e) => setNote(e.target.value)} /><button className="btn btn-ghost" disabled={!note.trim()} onClick={() => patch({ note })}>Add note</button></div>
          </div>
          <RecordPanel entityType="incident" entityId={id} doc={inc} kinds={['other']} />
        </div>
      )}
    </Modal>
  );
}
