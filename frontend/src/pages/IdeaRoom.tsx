import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Plus, ThumbsUp } from 'lucide-react';
import { RichTextEditor, RichTextRenderer } from '@/components/ui/RichText';
import { api, apiErrorMessage } from '@/lib/api';
import { Badge, statusTone } from '@/components/ui/Badge';
import { Modal } from '@/components/ui/Modal';
import { EmptyState, Skeleton } from '@/components/ui/Feedback';
import { useAuth } from '@/context/AuthContext';
import { useToast } from '@/context/ToastContext';
import { useQuickCreate } from '@/lib/useQuickCreate';

const STAGES = ['Submitted', 'Under Review', 'Approved', 'Prototype', 'Pilot', 'Launched', 'Rejected', 'Archived'];

export function IdeaRoom() {
  const navigate = useNavigate();
  const { user } = useAuth();
  const { showError, showSuccess } = useToast();
  const [ideas, setIdeas] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [modalOpen, setModalOpen] = useState(false);
  const [form, setForm] = useState<any>({ title: '', problem: '', proposedSolution: '', estimatedCost: 0, expectedRevenue: 0 });
  const [saving, setSaving] = useState(false);

  useEffect(() => { load(); }, []);

  useQuickCreate(() => setModalOpen(true));

  async function load() {
    setLoading(true);
    try {
      const res = await api.get('/ideas');
      setIdeas(res.data.data);
    } finally {
      setLoading(false);
    }
  }

  async function vote(id: string) {
    await api.post(`/ideas/${id}/vote`);
    load();
  }

  async function changeStage(id: string, stage: string) {
    await api.patch(`/ideas/${id}`, { stage });
    load();
  }

  async function handleCreate() {
    setSaving(true);
    try {
      await api.post('/ideas', form);
      setModalOpen(false);
      setForm({ title: '', problem: '', proposedSolution: '', estimatedCost: 0, expectedRevenue: 0 });
      load();
    } catch (err) {
      showError(apiErrorMessage(err));
    } finally {
      setSaving(false);
    }
  }

  return (
    <div>
      <div className="page-head">
        <div>
          <h1>Idea Room</h1>
          <p>Innovation pipeline — submit, vote and track ideas from spark to launch.</p>
        </div>
        <button className="btn btn-primary" onClick={() => setModalOpen(true)}><Plus size={16} /> Submit idea</button>
      </div>

      {loading ? <Skeleton height={300} /> : ideas.length === 0 ? <EmptyState message="No ideas submitted yet." /> : (
        <div className="grid-2">
          {ideas.map((idea) => {
            const hasVoted = idea.votes.includes(user?.id);
            return (
              <div key={idea._id} className="card card-hover" onClick={() => navigate(`/ideas/${idea._id}`)} style={{ cursor: 'pointer' }}>
                <div className="flex-between" style={{ marginBottom: 10 }}>
                  <Badge tone={statusTone(idea.stage)}>{idea.stage}</Badge>
                  {idea.aiScore && <Badge tone="gold">AI score {idea.aiScore.overall}/10</Badge>}
                </div>
                <h3 style={{ fontSize: 17, marginBottom: 8 }}>{idea.title}</h3>
                <div style={{ fontSize: 13, color: 'var(--muted)', marginBottom: 6 }}><strong>Problem:</strong><RichTextRenderer content={idea.problem} /></div>
                <div style={{ fontSize: 13, color: 'var(--muted)', marginBottom: 14 }}><strong>Solution:</strong><RichTextRenderer content={idea.proposedSolution} /></div>
                <div className="flex-between">
                  <button className="btn btn-ghost btn-sm" onClick={(e) => { e.stopPropagation(); vote(idea._id); }} style={{ color: hasVoted ? 'var(--accent)' : undefined, borderColor: hasVoted ? 'var(--accent)' : undefined }}>
                    <ThumbsUp size={14} /> {idea.votes.length}
                  </button>
                  <select className="input" style={{ width: 'auto', fontSize: 12 }} value={idea.stage} onClick={(e) => e.stopPropagation()} onChange={(e) => changeStage(idea._id, e.target.value)}>
                    {STAGES.map((s) => <option key={s} value={s}>{s}</option>)}
                  </select>
                </div>
              </div>
            );
          })}
        </div>
      )}

      <Modal
        open={modalOpen}
        onClose={() => setModalOpen(false)}
        title="Submit an idea"
        footer={
          <>
            <button className="btn btn-ghost" onClick={() => setModalOpen(false)}>Cancel</button>
            <button className="btn btn-primary" onClick={handleCreate} disabled={saving || !form.title}>{saving ? 'Submitting…' : 'Submit'}</button>
          </>
        }
      >
        <div className="form-grid">
          <div className="field full"><label>Idea title *</label><input className="input" value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} /></div>
          <div className="field full"><label>Problem *</label><RichTextEditor value={form.problem || ''} onChange={(h) => setForm((f: any) => ({ ...f, problem: h }))} /></div>
          <div className="field full"><label>Proposed solution *</label><RichTextEditor value={form.proposedSolution || ''} onChange={(h) => setForm((f: any) => ({ ...f, proposedSolution: h }))} /></div>
          <div className="field full"><label>Strategic alignment</label><RichTextEditor value={form.strategicAlignment || ''} onChange={(h) => setForm((f: any) => ({ ...f, strategicAlignment: h }))} /></div>
          <div className="field"><label>Estimated cost (₦)</label><input className="input" type="number" value={form.estimatedCost} onChange={(e) => setForm({ ...form, estimatedCost: Number(e.target.value) })} /></div>
          <div className="field"><label>Expected revenue (₦)</label><input className="input" type="number" value={form.expectedRevenue} onChange={(e) => setForm({ ...form, expectedRevenue: Number(e.target.value) })} /></div>
        </div>
      </Modal>
    </div>
  );
}
