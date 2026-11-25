import { useEffect, useState } from 'react';
import { Award, Bell, Download, FileCheck2, Plus, Trash2, ExternalLink } from 'lucide-react';
import { ResourcePage } from '@/components/ui/ResourcePage';
import { Modal } from '@/components/ui/Modal';
import { Badge } from '@/components/ui/Badge';
import { EmptyState } from '@/components/ui/Feedback';
import { RichTextEditor, RichTextRenderer } from '@/components/ui/RichText';
import { api, apiErrorMessage } from '@/lib/api';
import { useAuth } from '@/context/AuthContext';
import { useToast } from '@/context/ToastContext';
import { useConfirm } from '@/context/ConfirmContext';
import { Tabs } from '@/components/ui/PageHead';
import { FileUpload } from '@/components/work/FileUpload';
import { useApi } from '@/lib/useApi';
import { fdate, saveBlob, filenameFrom } from '@/lib/format';
import { openProtectedFile } from '@/lib/api';
import '@/components/work/work.css';

const UPDATE_TYPES: Array<{ value: string; label: string }> = [
  { value: 'exam_postponed', label: 'Exam postponed' },
  { value: 'exam_scheduled', label: 'Exam scheduled' },
  { value: 'meeting', label: 'Meeting' },
  { value: 'training_attached', label: 'New training attached' },
  { value: 'renewal', label: 'Renewal' },
  { value: 'general', label: 'General update' },
];
const TONE: Record<string, 'gold' | 'accent' | 'success' | 'neutral'> = {
  exam_postponed: 'gold', exam_scheduled: 'accent', meeting: 'accent', training_attached: 'success', renewal: 'success', general: 'neutral',
};
const EDITORS = ['hr', 'coo', 'ceo', 'super_admin'];

export function Certifications() {
  const { user } = useAuth();
  const canPost = !!user && EDITORS.includes(user.role);
  const [target, setTarget] = useState<any | null>(null);
  const [fileTarget, setFileTarget] = useState<any | null>(null);
  const [version, setVersion] = useState(0);
  const [tab, setTab] = useState<'records' | 'earned'>('records');

  return (
    <>
      <div style={{ display: tab === 'records' ? undefined : 'none' }}>
      <ResourcePage
        title="Certifications"
        description="Employee certifications with expiry tracking, certificate files, automated renewal alerts and an update feed for exam changes, meetings and attached trainings."
        endpoint="/certifications"
        createLabel="New certification"
        refreshKey={version}
        headerExtra={<Tabs value={tab} onChange={(k) => setTab(k as any)} tabs={[{ key: 'records', label: 'Certifications' }, { key: 'earned', label: 'Earned from work' }]} />}
        columns={[
          { key: 'name', label: 'Certification' },
          { key: 'employeeId.name', label: 'Employee' },
          { key: 'provider', label: 'Provider' },
          { key: 'expiryDate', label: 'Expires', render: (r) => (r.expiryDate ? new Date(r.expiryDate).toLocaleDateString() : '—') },
          { key: 'certificateFile', label: 'Certificate', render: (r) => (r.certificateFile?.url ? <Badge tone="success">On file</Badge> : <span className="text-muted">None</span>) },
          { key: 'status', label: 'Status', badge: true },
        ]}
        rowActions={(row) => (
          <span style={{ display: 'inline-flex', gap: 6 }}>
            <button className="btn btn-ghost btn-sm" onClick={() => setFileTarget(row)}><FileCheck2 size={13} /> Certificate</button>
            <button className="btn btn-ghost btn-sm" onClick={() => setTarget(row)}>
              <Bell size={13} /> Updates{row.updates?.length ? ` (${row.updates.length})` : ''}
            </button>
          </span>
        )}
        fields={[
          { name: 'name', label: 'Certification name', type: 'text', required: true, full: true },
          { name: 'provider', label: 'Provider', type: 'text', required: true },
          { name: 'employeeId', label: 'Employee', type: 'select', optionsEndpoint: '/employees', required: true },
          { name: 'dateObtained', label: 'Date obtained', type: 'date', required: true },
          { name: 'expiryDate', label: 'Expiry date', type: 'date' },
          { name: 'cost', label: 'Cost', type: 'number' },
        ]}
      />
      </div>
      {tab === 'earned' && (
        <div>
          <div className="page-head"><div><h1>Certifications</h1><p>Certificates issued when your tasks, milestones and goals were approved. Download any of them as a PDF.</p></div></div>
          <Tabs value={tab} onChange={(k) => setTab(k as any)} tabs={[{ key: 'records', label: 'Certifications' }, { key: 'earned', label: 'Earned from work' }]} />
          <Earned />
        </div>
      )}
      {target && <UpdatesModal cert={target} canPost={canPost} onClose={() => setTarget(null)} onChanged={() => setVersion((v) => v + 1)} />}
      {fileTarget && <CertificateFileModal cert={fileTarget} canManage={canPost || String(fileTarget.employeeId?._id || fileTarget.employeeId) === user?.id} onClose={() => setFileTarget(null)} onChanged={() => setVersion((v) => v + 1)} />}
    </>
  );
}

function Earned() {
  const { showError } = useToast();
  const { data, loading, error } = useApi<any[]>('/certifications/earned/list');
  const [busy, setBusy] = useState<string | null>(null);
  async function download(c: any) {
    setBusy(c.id);
    try {
      const res = await api.get(c.path, { responseType: 'blob' });
      saveBlob(res.data, filenameFrom(res.headers['content-disposition'], `certificate-${c.certificateNo}.pdf`));
    } catch (err) { showError(apiErrorMessage(err)); } finally { setBusy(null); }
  }
  if (loading && !data) return <p className="text-muted">Loading…</p>;
  if (error) return <EmptyState message={error} />;
  if (!data?.length) return <EmptyState message="No certificates yet. They are issued when an approver signs off a task, milestone or goal." />;
  return (
    <div style={{ display: 'grid', gap: 10 }}>
      {data.map((c) => (
        <div key={c.id} className="cert-card">
          <span className="cert-ico"><Award size={20} /></span>
          <div className="cert-main">
            <strong>{c.title}</strong>
            <small>{c.kind}{c.project ? ` · ${c.project}` : ''}{c.recipient ? ` · ${c.recipient}` : ''} · {c.date ? fdate(c.date) : ''} · {c.certificateNo}{c.ribbon ? ` · ${c.ribbon}` : ''}</small>
          </div>
          <button className="btn btn-ghost btn-sm" disabled={busy === c.id} onClick={() => download(c)}><Download size={14} /> {busy === c.id ? 'Preparing…' : 'Download PDF'}</button>
        </div>
      ))}
    </div>
  );
}

function CertificateFileModal({ cert, canManage, onClose, onChanged }: { cert: any; canManage: boolean; onClose: () => void; onChanged: () => void }) {
  const { showError, showSuccess } = useToast();
  const confirm = useConfirm();
  const [file, setFile] = useState<any>(cert.certificateFile?.url ? cert.certificateFile : null);

  async function attach(files: Array<{ url: string; name: string; mimeType: string; size: number }>) {
    const f = files[0]; if (!f) return;
    try {
      const res = await api.put(`/certifications/${cert._id}/certificate-file`, f);
      setFile(res.data.data); showSuccess('Certificate uploaded.'); onChanged();
    } catch (err) { showError(apiErrorMessage(err)); }
  }
  async function remove() {
    if (!(await confirm({ title: 'Remove certificate file', message: 'Remove the uploaded certificate from this record?', confirmLabel: 'Remove', danger: true }))) return;
    try { await api.delete(`/certifications/${cert._id}/certificate-file`); setFile(null); onChanged(); } catch (err) { showError(apiErrorMessage(err)); }
  }
  async function download() {
    try { await openProtectedFile(file.url, file.name); } catch (err) { showError(apiErrorMessage(err)); }
  }
  return (
    <Modal open onClose={onClose} title={`${cert.name} — certificate`} footer={<button className="btn btn-ghost" onClick={onClose}>Close</button>}>
      {file ? (
        <div className="cert-card">
          <span className="cert-ico"><Award size={20} /></span>
          <div className="cert-main"><strong>{file.name}</strong><small>{file.uploadedAt ? `Uploaded ${fdate(file.uploadedAt)}` : 'On file'}{file.size ? ` · ${(file.size / 1024).toFixed(0)} KB` : ''}</small></div>
          <button className="btn btn-primary btn-sm" onClick={download}><Download size={14} /> Download</button>
        </div>
      ) : (
        <EmptyState message="No certificate has been uploaded for this record yet." />
      )}
      {canManage && (
        <div style={{ marginTop: 14, display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
          <FileUpload multiple={false} small={false} label={file ? 'Replace certificate' : 'Upload certificate'} accept=".pdf,.png,.jpg,.jpeg,.webp,.doc,.docx" onUploaded={attach} />
          {file && <button className="btn btn-ghost btn-sm" onClick={remove}><Trash2 size={14} /> Remove</button>}
          <span className="text-muted" style={{ fontSize: 12 }}>PDF, image or Word file, up to 20 MB.</span>
        </div>
      )}
    </Modal>
  );
}

function UpdatesModal({ cert, canPost, onClose, onChanged }: { cert: any; canPost: boolean; onClose: () => void; onChanged: () => void }) {
  const { showError, showSuccess } = useToast();
  const confirm = useConfirm();
  const [updates, setUpdates] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [adding, setAdding] = useState(false);
  const [saving, setSaving] = useState(false);
  const [courses, setCourses] = useState<any[]>([]);
  const [meetings, setMeetings] = useState<any[]>([]);
  const [form, setForm] = useState<any>({ type: 'general', title: '', body: '', newDate: '', courseId: '', meetingId: '', linkLabel: '', linkUrl: '' });

  useEffect(() => {
    load();
    if (canPost) {
      api.get('/courses', { params: { limit: 100 } }).then((r) => setCourses(r.data.data)).catch(() => undefined);
      api.get('/meetings').then((r) => setMeetings(r.data.data || [])).catch(() => undefined);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cert._id]);

  async function load() {
    setLoading(true);
    try {
      const res = await api.get(`/certifications/${cert._id}/updates`);
      setUpdates(res.data.data);
    } catch (err) {
      showError(apiErrorMessage(err));
    } finally {
      setLoading(false);
    }
  }

  async function post() {
    setSaving(true);
    try {
      const links = form.linkUrl ? [{ label: form.linkLabel || form.linkUrl, url: form.linkUrl }] : [];
      const res = await api.post(`/certifications/${cert._id}/updates`, {
        type: form.type,
        title: form.title || UPDATE_TYPES.find((t) => t.value === form.type)?.label,
        body: form.body,
        newDate: form.newDate || undefined,
        courseId: form.type === 'training_attached' ? form.courseId || undefined : undefined,
        meetingId: form.type === 'meeting' ? form.meetingId || undefined : undefined,
        links,
      });
      setUpdates(res.data.data);
      setAdding(false);
      setForm({ type: 'general', title: '', body: '', newDate: '', courseId: '', meetingId: '', linkLabel: '', linkUrl: '' });
      showSuccess(`${cert.employeeId?.name || 'The employee'} has been notified.`);
      onChanged();
    } catch (err) {
      showError(apiErrorMessage(err));
    } finally {
      setSaving(false);
    }
  }

  async function remove(id: string) {
    if (!(await confirm({ title: 'Remove update', message: 'Remove this update from the feed?', confirmLabel: 'Remove', danger: true }))) return;
    try {
      const res = await api.delete(`/certifications/${cert._id}/updates/${id}`);
      setUpdates(res.data.data);
      onChanged();
    } catch (err) {
      showError(apiErrorMessage(err));
    }
  }

  return (
    <Modal
      open
      onClose={onClose}
      title={`${cert.name} — updates`}
      footer={
        adding ? (
          <>
            <button className="btn btn-ghost" onClick={() => setAdding(false)}>Cancel</button>
            <button className="btn btn-primary" onClick={post} disabled={saving}>{saving ? 'Posting…' : 'Post & notify'}</button>
          </>
        ) : (
          <>
            <button className="btn btn-ghost" onClick={onClose}>Close</button>
            {canPost && <button className="btn btn-primary" onClick={() => setAdding(true)}><Plus size={15} /> Add update</button>}
          </>
        )
      }
    >
      {adding ? (
        <div className="form-grid">
          <div className="field">
            <label>Type</label>
            <select className="input" value={form.type} onChange={(e) => setForm({ ...form, type: e.target.value })}>
              {UPDATE_TYPES.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
            </select>
          </div>
          <div className="field"><label>{form.type === 'exam_postponed' ? 'New exam date' : form.type === 'meeting' ? 'Meeting date' : 'Relevant date'}</label><input className="input" type="date" value={form.newDate} onChange={(e) => setForm({ ...form, newDate: e.target.value })} /></div>
          <div className="field full"><label>Headline</label><input className="input" placeholder={UPDATE_TYPES.find((t) => t.value === form.type)?.label} value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} /></div>
          {form.type === 'training_attached' && (
            <div className="field full">
              <label>Attach training course</label>
              <select className="input" value={form.courseId} onChange={(e) => setForm({ ...form, courseId: e.target.value })}>
                <option value="">Select a course…</option>
                {courses.map((c) => <option key={c._id} value={c._id}>{c.title}</option>)}
              </select>
            </div>
          )}
          {form.type === 'meeting' && (
            <div className="field full">
              <label>Link a meeting</label>
              <select className="input" value={form.meetingId} onChange={(e) => setForm({ ...form, meetingId: e.target.value })}>
                <option value="">Select a meeting…</option>
                {meetings.map((m) => <option key={m._id} value={m._id}>{m.title} — {new Date(m.date).toLocaleDateString()}</option>)}
              </select>
            </div>
          )}
          <div className="field full"><label>Details</label><RichTextEditor value={form.body} onChange={(html) => setForm((f: any) => ({ ...f, body: html }))} /></div>
          <div className="field"><label>Link label</label><input className="input" value={form.linkLabel} onChange={(e) => setForm({ ...form, linkLabel: e.target.value })} /></div>
          <div className="field"><label>Link URL</label><input className="input" placeholder="https://" value={form.linkUrl} onChange={(e) => setForm({ ...form, linkUrl: e.target.value })} /></div>
        </div>
      ) : loading ? (
        <p style={{ color: 'var(--muted)' }}>Loading…</p>
      ) : updates.length === 0 ? (
        <EmptyState message="No updates yet. Exam changes, meetings and attached trainings will appear here." />
      ) : (
        <div style={{ display: 'grid', gap: 14 }}>
          {updates.map((u) => (
            <div key={u._id} style={{ borderLeft: '3px solid var(--accent)', paddingLeft: 14 }}>
              <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
                <Badge tone={TONE[u.type] || 'neutral'}>{String(u.type).replace(/_/g, ' ')}</Badge>
                <strong style={{ fontSize: 14 }}>{u.title}</strong>
                {canPost && <button className="icon-btn" style={{ width: 26, height: 26, marginLeft: 'auto' }} onClick={() => remove(u._id)} aria-label="Remove update"><Trash2 size={13} /></button>}
              </div>
              <div style={{ fontSize: 12, color: 'var(--muted-2)', margin: '2px 0 6px' }}>
                {u.authorId?.name} · {new Date(u.createdAt).toLocaleString()} {u.newDate && <>· date: <strong>{new Date(u.newDate).toLocaleDateString()}</strong></>}
              </div>
              <RichTextRenderer content={u.body} />
              <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', fontSize: 12.5 }}>
                {u.courseId?.title && <span>📚 Training: <strong>{u.courseId.title}</strong></span>}
                {u.meetingId?.title && <span>🗓 Meeting: <strong>{u.meetingId.title}</strong> ({new Date(u.meetingId.date).toLocaleDateString()})</span>}
                {(u.links || []).map((l: any, i: number) => (
                  <a key={i} href={l.url} target="_blank" rel="noopener noreferrer" style={{ color: 'var(--accent)', display: 'inline-flex', gap: 4, alignItems: 'center' }}><ExternalLink size={12} /> {l.label}</a>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}
    </Modal>
  );
}
