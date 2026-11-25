import { useEffect, useMemo, useState } from 'react';
import { Mic } from 'lucide-react';
import { api, apiErrorMessage } from '@/lib/api';
import { useToast } from '@/context/ToastContext';
import { Modal } from '@/components/ui/Modal';
import { RichTextEditor } from '@/components/ui/RichText';
import { PeoplePicker, Person, usePeople } from './PeoplePicker';
import { FileUpload } from './FileUpload';
import './work.css';

export const PROVIDERS = [
  { value: 'teams', label: 'Microsoft Teams' },
  { value: 'zoom', label: 'Zoom' },
  { value: 'zoho', label: 'Zoho Meeting' },
  { value: 'google_meet', label: 'Google Meet' },
  { value: 'other', label: 'Other link' },
  { value: 'in_person', label: 'In person' },
];
const ROLES = [
  { value: 'ceo', label: 'CEO' }, { value: 'coo', label: 'COO' }, { value: 'finance', label: 'Finance' }, { value: 'hr', label: 'HR' },
  { value: 'sales', label: 'Sales' }, { value: 'project_manager', label: 'Project managers' }, { value: 'engineer', label: 'Engineers / developers' }, { value: 'employee', label: 'General employees' },
];
export const providerLabel = (p?: string) => PROVIDERS.find((x) => x.value === p)?.label || p || '';

const idOf = (v: any) => (v && typeof v === 'object' ? String(v._id || '') : v ? String(v) : '');
const toLocalInput = (d?: string | Date) => { const x = d ? new Date(d) : new Date(Date.now() + 3600000); x.setSeconds(0, 0); const p = (n: number) => String(n).padStart(2, '0'); return `${x.getFullYear()}-${p(x.getMonth() + 1)}-${p(x.getDate())}T${p(x.getHours())}:${p(x.getMinutes())}`; };

interface Props {
  open: boolean;
  onClose: () => void;
  onSaved: () => void;
  meeting?: any | null;
  /** Context the meeting is created for — its title is used as the default (still editable). */
  context?: { taskId?: string; milestoneId?: string; projectId?: string; title?: string; kind?: 'Task' | 'Subtask' | 'Milestone' };
}

export function MeetingModal({ open, onClose, onSaved, meeting, context }: Props) {
  const { showError, showSuccess } = useToast();
  const editing = !!meeting;
  const people = usePeople();
  const [raw, setF] = useState<any>({});
  // Defaults keep the very first render (before the open-effect has filled the form) safe.
  const f = useMemo(() => ({ title: '', durationMins: 60, provider: 'teams', participants: [], attachments: [], inviteRoles: [], inviteDepartments: [], inviteGroupIds: [], ...raw }), [raw]);
  const [teamPeople, setTeamPeople] = useState<Person[] | undefined>();
  const [externals, setExternals] = useState('');
  const [groups, setGroups] = useState<any[]>([]);
  const [departments, setDepartments] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!open) return;
    api.get('/groups').then((r) => setGroups(r.data.data || [])).catch(() => setGroups([]));
    if (meeting) {
      const pd = meeting.providerDetails || {};
      setF({
        title: meeting.title || '', date: toLocalInput(meeting.date), durationMins: meeting.durationMins || 60, provider: meeting.provider || 'teams',
        meetingId: pd.meetingId || '', passcode: pd.passcode || '', url: pd.url || meeting.meetingLink || '', dialIn: pd.dialIn || '', host: pd.host || '', location: meeting.location || '',
        description: meeting.description || meeting.agenda || '', participants: (meeting.participants || []).map(idOf), attachments: meeting.attachments || [],
        inviteProjectTeam: false, inviteRoles: [], inviteDepartments: [], inviteGroupIds: [], recordingReminder: !!meeting.recording?.reminderEnabled, recorderId: idOf(meeting.recording?.recorderId), note: '',
      });
      setExternals((meeting.externalParticipants || []).map((x: any) => (x.name ? `${x.name} <${x.email}>` : x.email)).join(', '));
    } else {
      setF({
        title: context?.title || '', date: toLocalInput(), durationMins: 60, provider: 'teams', meetingId: '', passcode: '', url: '', dialIn: '', host: '', location: '',
        description: '', participants: [], attachments: [], inviteProjectTeam: !!context?.projectId, inviteRoles: [], inviteDepartments: [], inviteGroupIds: [], recordingReminder: false, recorderId: '', note: '',
      });
      setExternals('');
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, meeting]);

  useEffect(() => {
    if (!open) return;
    const pid = meeting ? idOf(meeting.projectId) : context?.projectId;
    if (!pid) { setTeamPeople(undefined); return; }
    api.get(`/projects/${pid}`).then((r) => {
      const pr = r.data.data.project || {};
      const ids = new Set<string>([...(pr.team || []).map(idOf), idOf(pr.projectManagerId)]);
      setTeamPeople(people.filter((p) => ids.has(p._id)));
    }).catch(() => setTeamPeople(undefined));
  }, [open, meeting, context?.projectId, people]);

  useEffect(() => { setDepartments(Array.from(new Set(people.map((p) => p.department).filter(Boolean) as string[])).sort()); }, [people]);

  const set = (k: string, v: any) => setF((x: any) => ({ ...x, [k]: v }));
  const virtual = ['teams', 'zoom', 'zoho', 'google_meet', 'other'].includes(f.provider);
  const parsed = useMemo(() => externals.split(/[,;\n]+/).map((s) => s.trim()).filter(Boolean).map((s) => {
    const m = /^(.*?)<([^>]+)>$/.exec(s);
    return m ? { name: m[1].trim() || undefined, email: m[2].trim() } : { email: s };
  }), [externals]);
  const badEmails = parsed.filter((p) => !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(p.email));
  const joinOk = f.provider === 'in_person' ? !!f.location?.trim() : f.provider === 'other' ? !!f.url?.trim() : !!(f.url?.trim() || f.meetingId?.trim());
  const defaultTitle = context?.title || meeting?.title || '';

  async function save() {
    setBusy(true);
    try {
      const body: any = {
        title: f.title?.trim() || undefined, date: new Date(f.date).toISOString(), durationMins: Number(f.durationMins) || 60, provider: f.provider,
        providerDetails: virtual ? { meetingId: f.meetingId || undefined, passcode: f.passcode || undefined, url: f.url || undefined, dialIn: f.dialIn || undefined, host: f.host || undefined } : undefined,
        location: f.provider === 'in_person' ? f.location : undefined, description: f.description || undefined, attachments: f.attachments,
        participants: f.participants, externalParticipants: parsed, recordingReminder: f.recordingReminder, recorderId: f.recorderId || undefined, note: f.note || undefined,
      };
      if (!editing) {
        Object.assign(body, { taskId: context?.taskId, milestoneId: context?.milestoneId, projectId: context?.projectId, inviteProjectTeam: f.inviteProjectTeam, inviteRoles: f.inviteRoles, inviteDepartments: f.inviteDepartments, inviteGroupIds: f.inviteGroupIds });
      }
      if (editing) await api.patch(`/meetings/${meeting._id}`, body); else await api.post('/meetings', body);
      showSuccess(editing ? 'Meeting updated — attendees have been notified.' : 'Meeting created — invitations sent by e-mail and in the app.');
      onClose(); onSaved();
    } catch (err) { showError(apiErrorMessage(err)); } finally { setBusy(false); }
  }

  return (
    <Modal open={open} onClose={onClose} size="xwide" title={editing ? 'Edit meeting' : context?.kind ? `New meeting for this ${context.kind.toLowerCase()}` : 'New meeting'}
      footer={<><button className="btn btn-ghost" onClick={onClose}>Cancel</button><button className="btn btn-primary" disabled={busy || !(f.title?.trim() || defaultTitle) || !joinOk || badEmails.length > 0} onClick={save}>{busy ? 'Sending…' : editing ? 'Save & notify' : 'Create & send invitations'}</button></>}>
      <div className="form-grid">
        <div className="field full">
          <label>Meeting title *</label>
          <input className="input" value={f.title || ''} placeholder={defaultTitle || 'What is this meeting about?'} onChange={(e) => set('title', e.target.value)} />
          {context?.title && !editing && <small className="text-muted">Taken from the {context.kind?.toLowerCase() || 'item'} — change it if you like.</small>}
        </div>
        <div className="field"><label>Starts *</label><input className="input" type="datetime-local" value={f.date || ''} onChange={(e) => set('date', e.target.value)} /></div>
        <div className="field"><label>Duration (minutes)</label><input className="input" type="number" min={5} max={1440} step={5} value={f.durationMins || 60} onChange={(e) => set('durationMins', e.target.value)} /></div>

        <div className="field full">
          <label>Where will it happen? *</label>
          <div className="provider-grid">{PROVIDERS.map((p) => <button type="button" key={p.value} className={f.provider === p.value ? 'on' : ''} onClick={() => set('provider', p.value)}>{p.label}</button>)}</div>
        </div>
        {virtual && (<>
          <div className="field"><label>Meeting link {f.provider === 'other' ? '*' : ''}</label><input className="input" value={f.url || ''} onChange={(e) => set('url', e.target.value)} placeholder="https://…" /></div>
          <div className="field"><label>Meeting ID</label><input className="input" value={f.meetingId || ''} onChange={(e) => set('meetingId', e.target.value)} /></div>
          <div className="field"><label>Passcode</label><input className="input" value={f.passcode || ''} onChange={(e) => set('passcode', e.target.value)} autoComplete="off" /></div>
          <div className="field"><label>Dial-in number (optional)</label><input className="input" value={f.dialIn || ''} onChange={(e) => set('dialIn', e.target.value)} /></div>
          {!joinOk && <div className="callout warn full" style={{ gridColumn: '1 / -1' }}>Add the link or the meeting ID (and passcode, if there is one) so people can join.</div>}
        </>)}
        {f.provider === 'in_person' && <div className="field full"><label>Location *</label><input className="input" value={f.location || ''} onChange={(e) => set('location', e.target.value)} /></div>}

        <div className="field full"><label>Description / agenda</label><RichTextEditor value={f.description || ''} onChange={(h) => set('description', h)} minHeight={100} compact /></div>

        <div className="field full">
          <label>People in the organisation{teamPeople ? ' (project team shown first)' : ''}</label>
          <PeoplePicker value={f.participants} onChange={(ids) => set('participants', ids)} options={undefined} placeholder="Search colleagues…" />
          {!editing && context?.projectId && (
            <label style={{ display: 'flex', gap: 8, alignItems: 'center', marginTop: 8, fontSize: 13 }}><input type="checkbox" checked={!!f.inviteProjectTeam} onChange={(e) => set('inviteProjectTeam', e.target.checked)} /> Invite the whole project team{teamPeople ? ` (${teamPeople.length})` : ''}</label>
          )}
        </div>
        {!editing && (
          <>
            <div className="field full"><label>Invite everyone in a role</label>
              <div className="row-gap">{ROLES.map((r) => (
                <button type="button" key={r.value} className={`chip ${f.inviteRoles.includes(r.value) ? 'active' : ''}`} onClick={() => set('inviteRoles', f.inviteRoles.includes(r.value) ? f.inviteRoles.filter((x: string) => x !== r.value) : [...f.inviteRoles, r.value])}>{r.label}</button>
              ))}</div>
            </div>
            <div className="field"><label>Invite whole departments</label>
              <select multiple className="input" style={{ minHeight: 84 }} value={f.inviteDepartments} onChange={(e) => set('inviteDepartments', Array.from(e.target.selectedOptions).map((o) => o.value))}>
                {departments.map((d) => <option key={d} value={d}>{d}</option>)}
              </select>
            </div>
            <div className="field"><label>Invite groups</label>
              <select multiple className="input" style={{ minHeight: 84 }} value={f.inviteGroupIds} onChange={(e) => set('inviteGroupIds', Array.from(e.target.selectedOptions).map((o) => o.value))}>
                {groups.map((g: any) => <option key={g._id} value={g._id}>{g.name}</option>)}
              </select>
            </div>
          </>
        )}
        <div className="field full">
          <label>People outside the organisation (e-mail addresses, comma separated — “Name &lt;email&gt;” also works)</label>
          <textarea className="input" rows={2} value={externals} onChange={(e) => setExternals(e.target.value)} placeholder="ade@client.com, Tola Ade <tola@partner.com>" />
          {badEmails.length > 0 && <small style={{ color: '#e5484d' }}>Check: {badEmails.map((b) => b.email).join(', ')}</small>}
        </div>

        <div className="field full">
          <label>Attachments</label>
          <div className="row-gap">
            <FileUpload onUploaded={(files) => set('attachments', [...(f.attachments || []), ...files.map((u) => ({ name: u.name, url: u.url }))])} label="Attach files" />
            {(f.attachments || []).map((a: any, i: number) => <span key={a.url} className="chip active">{a.name}<button type="button" aria-label="Remove" style={{ background: 'none', border: 0, color: 'inherit', cursor: 'pointer' }} onClick={() => set('attachments', f.attachments.filter((_: any, j: number) => j !== i))}>×</button></span>)}
          </div>
        </div>

        <div className="field full">
          <div className="callout">
            <label style={{ display: 'flex', gap: 8, alignItems: 'center', fontWeight: 600 }}><input type="checkbox" checked={!!f.recordingReminder} onChange={(e) => set('recordingReminder', e.target.checked)} /> <Mic size={15} /> Remind me to record this meeting</label>
            <small className="text-muted">A reminder goes out 5 minutes before it starts. If no recording is uploaded, you get a reminder every day from the next morning until you upload it — and you can stop them at any time (the e-mail has a link).</small>
            {f.recordingReminder && (
              <div style={{ marginTop: 10 }}>
                <label style={{ fontSize: 12.5 }}>Who should be reminded? (defaults to the organiser)</label>
                <PeoplePicker single value={f.recorderId ? [f.recorderId] : []} onChange={(ids) => set('recorderId', ids[0] || '')} />
              </div>
            )}
          </div>
        </div>
        {editing && <div className="field full"><label>Note to attendees about this change (optional)</label><input className="input" value={f.note || ''} onChange={(e) => set('note', e.target.value)} /></div>}
      </div>
    </Modal>
  );
}
