import { useEffect, useState } from 'react';
import { Plus, Search, Globe, User as UserIcon, Lock } from 'lucide-react';
import { api, apiErrorMessage } from '@/lib/api';
import { useAuth } from '@/context/AuthContext';
import { useToast } from '@/context/ToastContext';
import { Badge, statusTone } from '@/components/ui/Badge';
import { Modal } from '@/components/ui/Modal';
import { EmptyState, TableSkeleton } from '@/components/ui/Feedback';
import { RichTextEditor, RichTextRenderer } from '@/components/ui/RichText';
import { useQuickCreate } from '@/lib/useQuickCreate';
import { RecordPanel } from '@/components/record/RecordPanel';
import { ExportButton } from '@/components/ui/ExportButton';

const STATUSES = ['open', 'in_progress', 'waiting_on_client', 'resolved', 'closed'];
const PRIORITIES = ['low', 'medium', 'high', 'critical'];
const CATEGORIES = ['general', 'technical', 'billing', 'access', 'academy_beta'];

export function Tickets() {
  const { user } = useAuth();
  const { showError, showSuccess } = useToast();
  const manage = !!user && ['super_admin', 'ceo'].includes(user.role); // only CEO + administrators may act on tickets
  const [tickets, setTickets] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [q, setQ] = useState('');
  const [source, setSource] = useState('');
  const [status, setStatus] = useState('');
  const [createOpen, setCreateOpen] = useState(false);
  const [form, setForm] = useState<any>({ subject: '', description: '', category: 'general', priority: 'medium' });
  const [saving, setSaving] = useState(false);
  const [detail, setDetail] = useState<any | null>(null);
  const [reply, setReply] = useState('');
  const [internal, setInternal] = useState(false);

  useQuickCreate(() => setCreateOpen(true));

  useEffect(() => {
    const t = setTimeout(load, q ? 300 : 0);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [q, source, status]);

  async function load() {
    setLoading(true);
    try {
      const res = await api.get('/tickets', { params: { ...(q ? { q } : {}), ...(source ? { source } : {}), ...(status ? { status } : {}) } });
      setTickets(res.data.data);
    } catch (err) {
      showError(apiErrorMessage(err));
    } finally {
      setLoading(false);
    }
  }

  async function open(id: string) {
    try {
      const res = await api.get(`/tickets/${id}`);
      setDetail(res.data.data);
      setReply('');
      setInternal(false);
    } catch (err) {
      showError(apiErrorMessage(err));
    }
  }

  async function create() {
    setSaving(true);
    try {
      await api.post('/tickets', { ...form, description: form.description });
      showSuccess('Ticket submitted. The CEO and administrators have been notified.');
      setCreateOpen(false);
      setForm({ subject: '', description: '', category: 'general', priority: 'medium' });
      load();
    } catch (err) {
      showError(apiErrorMessage(err));
    } finally {
      setSaving(false);
    }
  }

  async function updateField(patch: Record<string, string>) {
    try {
      await api.patch(`/tickets/${detail._id}`, patch);
      setDetail({ ...detail, ...patch });
      load();
    } catch (err) {
      showError(apiErrorMessage(err));
    }
  }

  async function sendReply() {
    try {
      await api.post(`/tickets/${detail._id}/replies`, { body: reply, internal });
      showSuccess(internal ? 'Internal note saved.' : 'Reply sent.');
      await open(detail._id);
      load();
    } catch (err) {
      showError(apiErrorMessage(err));
    }
  }

  const requesterLabel = (t: any) => t.requesterName || t.requesterId?.name || '—';

  return (
    <div>
      <div className="page-head">
        <div>
          <h1>Support Desk</h1>
          <p>Website enquiries and internal requests. {manage ? 'You can respond to and update every ticket.' : 'You can read tickets; only the CEO and administrators can respond or change them.'}</p>
        </div>
        <div className="row-gap"><ExportButton endpoint="/tickets" params={{ ...(q ? { q } : {}), ...(source ? { source } : {}), ...(status ? { status } : {}) }} filename="tickets" columns={[{ label: 'Subject', value: (r) => r.subject }, { label: 'From', value: (r) => r.requesterId?.name || r.requesterName }, { label: 'E-mail', value: (r) => r.requesterEmail }, { label: 'Source', value: (r) => r.source }, { label: 'Category', value: (r) => r.category }, { label: 'Priority', value: (r) => r.priority }, { label: 'Status', value: (r) => r.status }, { label: 'Assignee', value: (r) => r.assigneeId?.name }]} />
        <button className="btn btn-primary" onClick={() => setCreateOpen(true)}><Plus size={16} /> New ticket</button></div>
      </div>

      <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', marginBottom: 16 }}>
        <div className="topbar-search" style={{ maxWidth: 320 }}>
          <Search />
          <input placeholder="Search subject, name or email…" value={q} onChange={(e) => setQ(e.target.value)} />
        </div>
        <select className="input" style={{ maxWidth: 170 }} value={source} onChange={(e) => setSource(e.target.value)}>
          <option value="">All sources</option>
          <option value="website">Website</option>
          <option value="internal">Internal</option>
        </select>
        <select className="input" style={{ maxWidth: 190 }} value={status} onChange={(e) => setStatus(e.target.value)}>
          <option value="">All statuses</option>
          {STATUSES.map((s) => <option key={s} value={s}>{s.replace(/_/g, ' ')}</option>)}
        </select>
      </div>

      <div className="table-wrap">
        {loading ? (
          <TableSkeleton cols={5} />
        ) : tickets.length === 0 ? (
          <EmptyState message="No tickets match." />
        ) : (
          <table className="data-table">
            <thead><tr><th>Subject</th><th>From</th><th>Source</th><th>Priority</th><th>Status</th><th>Received</th></tr></thead>
            <tbody>
              {tickets.map((t) => (
                <tr key={t._id} onClick={() => open(t._id)}>
                  <td>{t.subject}</td>
                  <td>{requesterLabel(t)}</td>
                  <td>{t.source === 'website' ? <Badge tone="gold"><Globe size={11} style={{ marginRight: 4 }} />Website</Badge> : <Badge tone="neutral"><UserIcon size={11} style={{ marginRight: 4 }} />Internal</Badge>}</td>
                  <td><Badge tone={statusTone(t.priority)}>{t.priority}</Badge></td>
                  <td><Badge tone={statusTone(t.status)}>{String(t.status).replace(/_/g, ' ')}</Badge></td>
                  <td>{new Date(t.createdAt).toLocaleDateString()}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      <Modal
        open={createOpen}
        onClose={() => setCreateOpen(false)}
        title="New support ticket"
        footer={
          <>
            <button className="btn btn-ghost" onClick={() => setCreateOpen(false)}>Cancel</button>
            <button className="btn btn-primary" onClick={create} disabled={saving || form.subject.trim().length < 3 || form.description.replace(/<[^>]*>/g, '').trim().length < 3}>{saving ? 'Submitting…' : 'Submit'}</button>
          </>
        }
      >
        <div className="form-grid">
          <div className="field full"><label>Subject *</label><input className="input" value={form.subject} onChange={(e) => setForm({ ...form, subject: e.target.value })} /></div>
          <div className="field"><label>Category</label><select className="input" value={form.category} onChange={(e) => setForm({ ...form, category: e.target.value })}>{CATEGORIES.map((c) => <option key={c} value={c}>{c.replace(/_/g, ' ')}</option>)}</select></div>
          <div className="field"><label>Priority</label><select className="input" value={form.priority} onChange={(e) => setForm({ ...form, priority: e.target.value })}>{PRIORITIES.map((c) => <option key={c} value={c}>{c}</option>)}</select></div>
          <div className="field full"><label>Description *</label><RichTextEditor value={form.description} onChange={(html) => setForm((f: any) => ({ ...f, description: html }))} /></div>
        </div>
      </Modal>

      <Modal open={!!detail} onClose={() => setDetail(null)} title={detail?.subject || 'Ticket'}>
        {detail && (
          <div style={{ display: 'grid', gap: 16 }}>
            <dl className="kv">
              <dt>From</dt><dd>{requesterLabel(detail)}{detail.requesterEmail && <> · <a href={`mailto:${detail.requesterEmail}`} style={{ color: 'var(--accent)' }}>{detail.requesterEmail}</a></>}</dd>
              <dt>Source</dt><dd>{detail.source === 'website' ? 'Website contact form' : 'Internal'}</dd>
              <dt>Category</dt><dd>{String(detail.category).replace(/_/g, ' ')}</dd>
              <dt>Received</dt><dd>{new Date(detail.createdAt).toLocaleString()}</dd>
              <dt>Status</dt>
              <dd>{manage ? (
                <select className="input" value={detail.status} onChange={(e) => updateField({ status: e.target.value })}>{STATUSES.map((s) => <option key={s} value={s}>{s.replace(/_/g, ' ')}</option>)}</select>
              ) : <Badge tone={statusTone(detail.status)}>{String(detail.status).replace(/_/g, ' ')}</Badge>}</dd>
              <dt>Priority</dt>
              <dd>{manage ? (
                <select className="input" value={detail.priority} onChange={(e) => updateField({ priority: e.target.value })}>{PRIORITIES.map((s) => <option key={s} value={s}>{s}</option>)}</select>
              ) : <Badge tone={statusTone(detail.priority)}>{detail.priority}</Badge>}</dd>
            </dl>

            <div className="card" style={{ background: 'var(--surface-2)' }}><RichTextRenderer content={detail.description} /></div>

            {(detail.replies || []).map((r: any) => (
              <div key={r._id} className="card" style={{ background: r.internal ? 'var(--gold-soft)' : 'var(--surface)' }}>
                <div style={{ fontSize: 12, color: 'var(--muted)', marginBottom: 6, display: 'flex', gap: 8, alignItems: 'center' }}>
                  <strong>{r.authorId?.name}</strong> · {new Date(r.createdAt).toLocaleString()}
                  {r.internal && <Badge tone="gold"><Lock size={10} style={{ marginRight: 3 }} />Internal note</Badge>}
                </div>
                <RichTextRenderer content={r.body} />
              </div>
            ))}

            {manage ? (
              <div style={{ display: 'grid', gap: 10 }}>
                <RichTextEditor value={reply} onChange={setReply} placeholder="Write a reply…" compact />
                <label style={{ fontSize: 12.5, display: 'flex', gap: 8, alignItems: 'center', color: 'var(--muted)' }}>
                  <input type="checkbox" checked={internal} onChange={(e) => setInternal(e.target.checked)} /> Internal note (not sent to the requester)
                </label>
                <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
                  <button className="btn btn-primary" onClick={sendReply} disabled={!reply.replace(/<[^>]*>/g, '').trim()}>{internal ? 'Save note' : 'Send reply'}</button>
                </div>
              </div>
            ) : (
              <p style={{ fontSize: 12.5, color: 'var(--muted)', display: 'flex', gap: 8, alignItems: 'center' }}><Lock size={13} /> Only administrators and the CEO can respond to or update this ticket.</p>
            )}
            <RecordPanel entityType="ticket" entityId={detail._id} doc={detail} kinds={['other']} />
          </div>
        )}
      </Modal>
    </div>
  );
}
