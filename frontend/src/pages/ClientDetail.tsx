import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { Plus } from 'lucide-react';
import { api, apiErrorMessage } from '@/lib/api';
import { Badge, statusTone } from '@/components/ui/Badge';
import { AuditStamp } from '@/components/ui/AuditStamp';
import { Skeleton } from '@/components/ui/Feedback';
import { Modal } from '@/components/ui/Modal';
import { useAuth } from '@/context/AuthContext';
import { useToast } from '@/context/ToastContext';
import { can } from '@/lib/permissions';
import { ContractsPanel } from '@/components/client/ContractsPanel';
import { ProjectModal } from '@/components/work/ProjectModal';
import { RecordPanel } from '@/components/record/RecordPanel';

const TABS = ['Overview', 'Contacts', 'Contracts', 'Projects', 'Opportunities', 'Support', 'Meetings', 'Notes'];

export function ClientDetail() {
  const { id } = useParams();
  const { user } = useAuth();
  const { showError, showSuccess } = useToast();
  const [data, setData] = useState<any>(null);
  const [tab, setTab] = useState('Overview');
  const [loading, setLoading] = useState(true);
  const [summary, setSummary] = useState<string | null>(null);
  const [note, setNote] = useState('');

  const [contactModalOpen, setContactModalOpen] = useState(false);
  const [contactForm, setContactForm] = useState<any>({ name: '', title: '', email: '', phone: '', isPrimary: false });
  const [projectModal, setProjectModal] = useState(false);
  const [saving, setSaving] = useState(false);

  const canManageContracts = can.manageContracts(user?.role);
  const canManageProjects = can.manageProjects(user?.role);

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  async function load() {
    // Only the first load shows the skeleton; later reloads keep the page (and any open window) in place.
    if (!data) setLoading(true);
    try {
      const res = await api.get(`/clients/${id}`);
      setData(res.data.data);
    } finally {
      setLoading(false);
    }
  }

  async function getAiSummary() {
    const res = await api.post('/ai/ask', { message: 'summarize our relationship with this client', clientId: id });
    setSummary(res.data.data.reply);
  }

  async function addNote() {
    if (!note.trim()) return;
    await api.post(`/clients/${id}/communications`, { type: 'note', summary: note });
    setNote('');
    load();
  }

  async function addContact() {
    setSaving(true);
    try {
      await api.post(`/clients/${id}/contacts`, contactForm);
      showSuccess('Contact added.');
      setContactModalOpen(false);
      setContactForm({ name: '', title: '', email: '', phone: '', isPrimary: false });
      load();
    } catch (err) {
      showError(apiErrorMessage(err));
    } finally {
      setSaving(false);
    }
  }

  if (loading || !data) return <Skeleton height={300} />;

  const { client, projects, opportunities, tickets, meetings } = data;

  return (
    <div>
      <div className="page-head">
        <div>
          <Badge tone={statusTone(client.status)}>{client.status}</Badge>
          <h1 style={{ marginTop: 8 }}>{client.name}</h1>
          <p>{client.industry} · {[client.state, client.country].filter(Boolean).join(', ')}</p>
          {(client.email || client.phone || client.address) && <p style={{ fontSize: 13 }}>{[client.email, client.phone, client.address].filter(Boolean).join(' · ')}</p>}
          <AuditStamp doc={client} />
        </div>
        <button className="btn btn-ghost" onClick={getAiSummary}>AI relationship summary</button>
      </div>

      {summary && <div className="card" style={{ marginBottom: 20, borderColor: 'var(--accent)' }}><p style={{ fontSize: 13.5 }}>{summary}</p></div>}

      <div className="stat-grid" style={{ marginBottom: 26 }}>
        <div className="stat-card"><div className="stat-label"><span>Lifetime revenue</span></div><div className="stat-value" style={{ fontSize: 22 }}>₦{client.revenue.toLocaleString()}</div></div>
        <div className="stat-card"><div className="stat-label"><span>Projects</span></div><div className="stat-value">{projects.length}</div></div>
        <div className="stat-card"><div className="stat-label"><span>Open opportunities</span></div><div className="stat-value">{opportunities.length}</div></div>
        <div className="stat-card"><div className="stat-label"><span>Support tickets</span></div><div className="stat-value">{tickets.length}</div></div>
      </div>

      <div className="tabs">
        {TABS.map((t) => <div key={t} className={`tab ${tab === t ? 'active' : ''}`} onClick={() => setTab(t)}>{t}</div>)}
      </div>

      {tab === 'Overview' && (
        <div className="card">
          <h4 style={{ fontSize: 13, color: 'var(--muted-2)', marginBottom: 10 }}>Add a note</h4>
          <div style={{ display: 'flex', gap: 8, marginBottom: 20 }}>
            <input className="input" placeholder="Log a call, email or note…" value={note} onChange={(e) => setNote(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && addNote()} />
            <button className="btn btn-primary btn-sm" onClick={addNote}>Log</button>
          </div>
          <h4 style={{ fontSize: 13, color: 'var(--muted-2)', marginBottom: 10 }}>Communication history</h4>
          <div style={{ display: 'grid', gap: 10 }}>
            {(client.communications || []).slice().reverse().map((c: any, i: number) => (
              <div key={i} style={{ fontSize: 13, borderBottom: '1px solid var(--line)', paddingBottom: 10 }}>
                <Badge tone="neutral">{c.type}</Badge>
                <p style={{ marginTop: 6, color: 'var(--muted)' }}>{c.summary}</p>
              </div>
            ))}
            {(!client.communications || client.communications.length === 0) && <p style={{ fontSize: 13, color: 'var(--muted)' }}>No communications logged yet.</p>}
          </div>
        </div>
      )}

      {tab === 'Contacts' && (
        <div>
          <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: 14 }}>
            <button className="btn btn-primary btn-sm" onClick={() => setContactModalOpen(true)}><Plus size={14} /> Add contact</button>
          </div>
          <div className="grid-2">
            {client.contacts?.map((c: any, i: number) => (
              <div key={i} className="card">
                <div className="flex-between"><strong style={{ fontSize: 14 }}>{c.name}</strong>{c.isPrimary && <Badge tone="accent">primary</Badge>}</div>
                <p style={{ fontSize: 13, color: 'var(--muted)', marginTop: 6 }}>{c.title}</p>
                <p style={{ fontSize: 13, color: 'var(--muted)' }}>{c.email} {c.phone && `· ${c.phone}`}</p>
              </div>
            ))}
            {(!client.contacts || client.contacts.length === 0) && <p style={{ color: 'var(--muted)' }}>No contacts yet.</p>}
          </div>
        </div>
      )}

      {tab === 'Contracts' && <ContractsPanel clientId={client._id} contracts={client.contracts || []} canManage={canManageContracts} onChanged={load} />}

      {tab === 'Projects' && (
        <div>
          {canManageProjects && (
            <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: 14 }}>
              <button className="btn btn-primary btn-sm" onClick={() => setProjectModal(true)}><Plus size={14} /> New project for {client.name}</button>
            </div>
          )}
          <div className="grid-3">
            {projects.map((p: any) => (
              <a key={p._id} href={`/projects/${p._id}`} className="card card-hover">
                <div style={{ fontSize: 14, fontWeight: 600, marginBottom: 8 }}>{p.name}</div>
                <Badge tone={statusTone(p.health)}>{p.health.replace('_', ' ')}</Badge>
              </a>
            ))}
            {projects.length === 0 && <p style={{ color: 'var(--muted)' }}>No projects yet.</p>}
          </div>
        </div>
      )}

      {tab === 'Opportunities' && (
        <div style={{ display: 'grid', gap: 12 }}>
          {opportunities.map((o: any) => (
            <div key={o._id} className="card flex-between">
              <span style={{ fontSize: 14 }}>{o.title}</span>
              <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
                <span style={{ fontSize: 13, color: 'var(--muted)' }}>₦{o.value.toLocaleString()}</span>
                <Badge tone={statusTone(o.stage)}>{o.stage}</Badge>
              </div>
            </div>
          ))}
          {opportunities.length === 0 && <p style={{ color: 'var(--muted)' }}>No open opportunities.</p>}
        </div>
      )}

      {tab === 'Support' && (
        <div style={{ display: 'grid', gap: 12 }}>
          {tickets.map((t: any) => (
            <div key={t._id} className="card flex-between">
              <span style={{ fontSize: 14 }}>{t.subject}</span>
              <Badge tone={statusTone(t.status)}>{t.status.replace('_', ' ')}</Badge>
            </div>
          ))}
          {tickets.length === 0 && <p style={{ color: 'var(--muted)' }}>No support tickets.</p>}
        </div>
      )}

      {tab === 'Notes' && <div className="card"><RecordPanel entityType="client" entityId={client._id} doc={client} /></div>}

      {tab === 'Meetings' && (
        <div style={{ display: 'grid', gap: 12 }}>
          {meetings.map((m: any) => (
            <div key={m._id} className="card flex-between">
              <span style={{ fontSize: 14 }}>{m.title}</span>
              <span style={{ fontSize: 12, color: 'var(--muted)' }}>{new Date(m.date).toLocaleDateString()}</span>
            </div>
          ))}
          {meetings.length === 0 && <p style={{ color: 'var(--muted)' }}>No meetings recorded.</p>}
        </div>
      )}

      <Modal
        open={contactModalOpen}
        onClose={() => setContactModalOpen(false)}
        title="Add contact"
        footer={
          <>
            <button className="btn btn-ghost" onClick={() => setContactModalOpen(false)}>Cancel</button>
            <button className="btn btn-primary" onClick={addContact} disabled={saving || !contactForm.name.trim() || (!!contactForm.email && !/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(contactForm.email.trim()))}>{saving ? 'Saving…' : 'Add contact'}</button>
          </>
        }
      >
        <div className="form-grid">
          <div className="field full"><label>Name *</label><input className="input" value={contactForm.name} onChange={(e) => setContactForm({ ...contactForm, name: e.target.value })} /></div>
          <div className="field"><label>Job title</label><input className="input" value={contactForm.title} onChange={(e) => setContactForm({ ...contactForm, title: e.target.value })} /></div>
          <div className="field"><label>Email</label><input className="input" type="email" value={contactForm.email} onChange={(e) => setContactForm({ ...contactForm, email: e.target.value })} /></div>
          <div className="field"><label>Phone</label><input className="input" value={contactForm.phone} onChange={(e) => setContactForm({ ...contactForm, phone: e.target.value })} /></div>
          <div className="field" style={{ flexDirection: 'row', alignItems: 'center', gap: 8, display: 'flex' }}>
            <input type="checkbox" id="isPrimary" checked={contactForm.isPrimary} onChange={(e) => setContactForm({ ...contactForm, isPrimary: e.target.checked })} />
            <label htmlFor="isPrimary" style={{ margin: 0 }}>Primary contact</label>
          </div>
        </div>
      </Modal>

      <ProjectModal open={projectModal} defaults={{ clientId: client._id }} onClose={() => setProjectModal(false)} onSaved={load} />
    </div>
  );
}
