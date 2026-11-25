import { useEffect, useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { BellOff, BellRing, Copy, ExternalLink, MapPin, Mic, Plus, Search, Video, Wand2 } from 'lucide-react';
import { api, apiErrorMessage, openProtectedFile } from '@/lib/api';
import { useApi } from '@/lib/useApi';
import { useToast } from '@/context/ToastContext';
import { useConfirm } from '@/context/ConfirmContext';
import { useQuickCreate } from '@/lib/useQuickCreate';
import { fdatetime, label } from '@/lib/format';
import { Badge, statusTone } from '@/components/ui/Badge';
import { RichTextRenderer } from '@/components/ui/RichText';
import { Empty, ErrorNote, Loading, PageHead, Tabs } from '@/components/ui/PageHead';
import { Modal } from '@/components/ui/Modal';
import { QuarterFilter } from '@/components/work/QuarterFilter';
import { RowActions } from '@/components/work/RowActions';
import { MeetingModal, PROVIDERS, providerLabel } from '@/components/work/MeetingModal';
import { FileUpload } from '@/components/work/FileUpload';

const nm = (v: any) => (v && typeof v === 'object' ? v.name || v.title : undefined);

function RecordingBox({ m, onChanged }: { m: any; onChanged: () => void }) {
  const { showError, showSuccess } = useToast();
  const rec = m.recording || {};
  const can = m.permissions?.manageRecording;
  const cancelled = !!rec.reminderCancelledAt;
  const past = new Date(m.date) < new Date();
  async function post(path: string, body?: any, ok?: string) {
    try { await api.post(`/meetings/${m._id}/recording${path}`, body); if (ok) showSuccess(ok); onChanged(); } catch (err) { showError(apiErrorMessage(err)); }
  }
  if (!rec.reminderEnabled && !(rec.uploads || []).length && !(past && can)) return null;
  return (
    <div className="callout" style={{ marginTop: 12 }}>
      <div className="flex-between" style={{ gap: 8, flexWrap: 'wrap' }}>
        <strong style={{ display: 'flex', gap: 6, alignItems: 'center' }}><Mic size={14} /> Recording</strong>
        <span>{rec.uploaded ? <Badge tone="success">Uploaded</Badge> : rec.reminderEnabled && !cancelled ? <Badge tone="gold">Reminders on</Badge> : cancelled ? <Badge tone="neutral">Reminders stopped</Badge> : <Badge tone="neutral">Not uploaded</Badge>}</span>
      </div>
      {(rec.uploads || []).map((u: any) => (
        <div key={u.url} style={{ marginTop: 6, fontSize: 13 }}><button type="button" className="chip" onClick={() => openProtectedFile(u.url, u.name)}>{u.name}</button></div>
      ))}
      {can && (
        <div className="row-gap" style={{ marginTop: 10 }}>
          <FileUpload kind="recording" multiple={false} label={rec.uploaded ? 'Upload another' : 'Upload recording'} onUploaded={async (f) => { for (const x of f) await post('', { name: x.name, url: x.url }, 'Recording uploaded — reminders stopped.'); }} />
          {rec.reminderEnabled && !rec.uploaded && !cancelled && <button className="btn btn-ghost btn-sm" onClick={() => post('/cancel-reminders', undefined, 'Reminders stopped.')}><BellOff size={14} /> Stop reminders</button>}
          {!rec.uploaded && cancelled && <button className="btn btn-ghost btn-sm" onClick={() => post('/resume-reminders', undefined, 'Reminders turned back on.')}><BellRing size={14} /> Resume reminders</button>}
        </div>
      )}
    </div>
  );
}

function Join({ m }: { m: any }) {
  const { showSuccess } = useToast();
  const pd = m.providerDetails || {};
  const url = pd.url || m.meetingLink;
  const copy = (txt: string) => { navigator.clipboard?.writeText(txt).then(() => showSuccess('Copied.')).catch(() => undefined); };
  if (m.provider === 'in_person') return m.location ? <span className="text-muted" style={{ fontSize: 13, display: 'inline-flex', gap: 5, alignItems: 'center' }}><MapPin size={13} /> {m.location}</span> : null;
  return (
    <div className="row-gap" style={{ fontSize: 13 }}>
      {url && <a href={url} target="_blank" rel="noopener noreferrer" className="btn btn-ghost btn-sm"><Video size={14} /> Join <ExternalLink size={11} /></a>}
      {pd.meetingId && <span className="chip" onClick={() => copy(pd.meetingId)} title="Copy ID">ID {pd.meetingId} <Copy size={11} /></span>}
      {pd.passcode && <span className="chip" onClick={() => copy(pd.passcode)} title="Copy passcode">Passcode {pd.passcode} <Copy size={11} /></span>}
      {pd.dialIn && <span className="text-muted">Dial-in {pd.dialIn}</span>}
    </div>
  );
}

export function Meetings() {
  const { showError, showSuccess } = useToast();
  const confirm = useConfirm();
  const [sp, setSp] = useSearchParams();
  const [tab, setTab] = useState<'upcoming' | 'past' | 'recordings' | 'all'>('upcoming');
  const [q, setQ] = useState('');
  const [quarter, setQuarter] = useState('');
  const [provider, setProvider] = useState('');
  const [editing, setEditing] = useState<any>(null);
  const [creating, setCreating] = useState(false);
  const [converting, setConverting] = useState<string | null>(null);
  const [stopFor, setStopFor] = useState<string | null>(null);

  const params = useMemo(() => {
    const p: Record<string, any> = {};
    if (tab === 'upcoming') p.upcoming = 'true';
    if (tab === 'recordings') p.needsRecording = 'true';
    if (q) p.q = q;
    if (quarter) p.quarter = quarter;
    if (provider) p.provider = provider;
    return p;
  }, [tab, q, quarter, provider]);
  const { data, loading, error, reload } = useApi<any[]>('/meetings', params);
  useQuickCreate(() => setCreating(true));

  // Deep links: "Stop these reminders" from e-mails, and ?open=<id> from other pages.
  useEffect(() => {
    const id = sp.get('meeting');
    if (id && sp.get('stop') === '1') { setStopFor(id); const n = new URLSearchParams(sp); n.delete('stop'); n.delete('meeting'); setSp(n, { replace: true }); }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const rows = useMemo(() => {
    let r = data || [];
    if (tab === 'past') r = r.filter((m) => new Date(m.date) < new Date()).reverse();
    if (tab === 'upcoming') r = r.filter((m) => m.status !== 'cancelled');
    return r;
  }, [data, tab]);

  async function confirmStop() {
    if (!stopFor) return;
    try { await api.post(`/meetings/${stopFor}/recording/cancel-reminders`); showSuccess('Recording reminders stopped.'); setStopFor(null); reload(); } catch (err) { showError(apiErrorMessage(err)); }
  }
  async function remove(m: any) {
    if (!(await confirm({ title: 'Delete meeting', message: `Delete “${m.title}”? Attendees of an upcoming meeting will be told it was cancelled.`, confirmLabel: 'Delete', danger: true }))) return;
    try { await api.delete(`/meetings/${m._id}`); showSuccess('Meeting deleted.'); reload(); } catch (err) { showError(apiErrorMessage(err)); }
  }
  async function convert(id: string) {
    setConverting(id);
    try { const res = await api.post(`/ai/meetings/${id}/convert-to-tasks`); showSuccess(res.data.data.reply); reload(); } catch (err) { showError(apiErrorMessage(err)); } finally { setConverting(null); }
  }

  return (
    <div>
      <PageHead title="Meetings" subtitle="Teams, Zoom, Zoho, Google Meet or in person — every meeting sends an e-mail invitation and an in-app notification."
        actions={<button className="btn btn-primary" onClick={() => setCreating(true)}><Plus size={16} /> New meeting</button>} />
      <Tabs value={tab} onChange={(k) => setTab(k as any)} tabs={[{ key: 'upcoming', label: 'Upcoming' }, { key: 'past', label: 'Past' }, { key: 'recordings', label: 'Recording needed' }, { key: 'all', label: 'All' }]} />
      <div className="filter-bar" style={{ marginTop: 16 }}>
        <div className="grow" style={{ position: 'relative' }}><Search size={15} style={{ position: 'absolute', left: 12, top: 12, color: 'var(--muted-2)' }} /><input className="input" style={{ paddingLeft: 34, width: '100%' }} placeholder="Search meetings…" value={q} onChange={(e) => setQ(e.target.value)} /></div>
        <QuarterFilter value={quarter} onChange={setQuarter} />
        <select className="input" value={provider} onChange={(e) => setProvider(e.target.value)}><option value="">Any platform</option>{PROVIDERS.map((p) => <option key={p.value} value={p.value}>{p.label}</option>)}</select>
      </div>
      <ErrorNote message={error} />
      {loading && !data ? <Loading /> : rows.length === 0 ? <Empty title="No meetings here" hint="Create one, or change the filters." /> : (
        <div className="stack">
          {rows.map((m) => (
            <div key={m._id} className="card">
              <div className="flex-between" style={{ gap: 10, alignItems: 'flex-start' }}>
                <div style={{ minWidth: 0 }}>
                  <strong style={{ fontSize: 15.5 }}>{m.title}</strong>
                  <div className="text-muted" style={{ fontSize: 12.5, marginTop: 2 }}>
                    {fdatetime(m.date)} · {m.durationMins || 60} min · {providerLabel(m.provider)}{m.organizerId ? ` · by ${nm(m.organizerId)}` : ''}{m.clientId ? ` · ${nm(m.clientId)}` : ''}
                  </div>
                </div>
                <div className="row-gap"><Badge tone={statusTone(m.status)}>{label(m.status)}</Badge>
                  <RowActions permissions={{ view: true, edit: m.permissions?.edit, delete: m.permissions?.delete }} onEdit={() => setEditing(m)} onDelete={() => remove(m)}
                    extra={[{ key: 'task', label: 'Open task', icon: <ExternalLink size={15} />, onClick: () => { window.location.href = `/tasks/${typeof m.taskId === 'object' ? m.taskId._id : m.taskId}`; }, hidden: !m.taskId }]} /></div>
              </div>
              {(m.description || m.agenda) && <div style={{ fontSize: 13, color: 'var(--muted)', margin: '10px 0' }}><RichTextRenderer content={m.description || m.agenda} /></div>}
              <div style={{ margin: '10px 0' }}><Join m={m} /></div>
              {m.taskId && <div className="text-muted" style={{ fontSize: 12 }}>About task: <Link to={`/tasks/${typeof m.taskId === 'object' ? m.taskId._id : m.taskId}`} style={{ textDecoration: 'underline' }}>{nm(m.taskId) || 'open task'}</Link></div>}
              {(m.participants?.length > 0 || m.externalParticipants?.length > 0) && (
                <div className="row-gap" style={{ marginTop: 10 }}>
                  {m.participants?.map((p: any) => <Badge key={p._id} tone="neutral">{p.name}</Badge>)}
                  {m.externalParticipants?.map((a: any, i: number) => <Badge key={i} tone="gold">{a.name || a.email} (external)</Badge>)}
                </div>
              )}
              {(m.attachments || []).length > 0 && <div className="row-gap" style={{ marginTop: 10 }}>{m.attachments.map((a: any) => <button key={a.url} type="button" className="chip" onClick={() => openProtectedFile(a.url, a.name)}>{a.name}</button>)}</div>}
              <RecordingBox m={m} onChanged={reload} />
              {m.actionItems?.length > 0 && (
                <div style={{ marginTop: 12 }}>
                  <div className="text-muted" style={{ fontSize: 12, marginBottom: 4 }}>Action items</div>
                  {m.actionItems.map((a: any, i: number) => <div key={i} style={{ fontSize: 13 }}>• {a.description} {a.convertedTaskId && <Badge tone="success">task created</Badge>}</div>)}
                  {m.actionItems.some((a: any) => !a.convertedTaskId) && <button className="btn btn-ghost btn-sm" style={{ marginTop: 8 }} onClick={() => convert(m._id)} disabled={converting === m._id}><Wand2 size={14} /> {converting === m._id ? 'Converting…' : 'Convert action items to tasks'}</button>}
                </div>
              )}
            </div>
          ))}
        </div>
      )}
      <MeetingModal open={creating} onClose={() => setCreating(false)} onSaved={reload} />
      <MeetingModal open={!!editing} meeting={editing} onClose={() => setEditing(null)} onSaved={reload} />
      <Modal open={!!stopFor} onClose={() => setStopFor(null)} title="Stop recording reminders?" footer={<><button className="btn btn-ghost" onClick={() => setStopFor(null)}>Keep them</button><button className="btn btn-primary" onClick={confirmStop}>Stop reminders</button></>}>
        <p style={{ fontSize: 14 }}>You will no longer be reminded to upload the recording for this meeting. You can turn the reminders back on from the meeting at any time.</p>
      </Modal>
    </div>
  );
}
