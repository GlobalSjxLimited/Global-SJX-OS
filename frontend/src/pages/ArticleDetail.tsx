import { useEffect, useState } from 'react';
import { useParams, useNavigate, Link } from 'react-router-dom';
import { Pencil, Trash2, Eye } from 'lucide-react';
import { api, apiErrorMessage } from '@/lib/api';
import { Badge } from '@/components/ui/Badge';
import { Modal } from '@/components/ui/Modal';
import { Skeleton } from '@/components/ui/Feedback';
import { useAuth } from '@/context/AuthContext';
import { useToast } from '@/context/ToastContext';
import { useConfirm } from '@/context/ConfirmContext';

const TYPES = ['SOP', 'Policy', 'Technical Documentation', 'Project Lesson', 'Case Study', 'Proposal Template', 'Training Material', 'General'];

export function ArticleDetail() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { user } = useAuth();
  const { showError, showSuccess } = useToast();
  const confirm = useConfirm();
  const [article, setArticle] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [editOpen, setEditOpen] = useState(false);
  const [form, setForm] = useState<any>({ title: '', type: 'General', content: '', tagsInput: '' });
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  async function load() {
    setLoading(true);
    try {
      const res = await api.get(`/knowledge/${id}`);
      setArticle(res.data.data);
    } catch (err) {
      showError(apiErrorMessage(err));
    } finally {
      setLoading(false);
    }
  }

  const canManage = article && (article.authorId?._id === user?.id || ['hr', 'coo', 'ceo', 'super_admin'].includes(user?.role || ''));

  function openEdit() {
    setForm({ title: article.title, type: article.type, content: article.content, tagsInput: (article.tags || []).join(', ') });
    setEditOpen(true);
  }

  async function saveEdit() {
    setSaving(true);
    try {
      const tags = form.tagsInput.split(',').map((t: string) => t.trim()).filter(Boolean);
      await api.patch(`/knowledge/${id}`, { title: form.title, type: form.type, content: form.content, tags });
      showSuccess('Article updated.');
      setEditOpen(false);
      load();
    } catch (err) {
      showError(apiErrorMessage(err));
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete() {
    const ok = await confirm({ title: 'Delete article', message: `Delete "${article.title}"? It can be restored by an administrator.`, confirmLabel: 'Delete', danger: true });
    if (!ok) return;
    try {
      await api.delete(`/knowledge/${id}`);
      showSuccess('Article deleted.');
      navigate('/knowledge');
    } catch (err) {
      showError(apiErrorMessage(err));
    }
  }

  if (loading || !article) return <Skeleton height={400} />;

  return (
    <div>
      <div className="page-head">
        <div>
          <Badge tone="accent">{article.type}</Badge>
          <h1 style={{ marginTop: 10 }}>{article.title}</h1>
          <p style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
            <span>By {article.authorId?.name} · {new Date(article.createdAt).toLocaleDateString()}</span>
            <span style={{ display: 'flex', alignItems: 'center', gap: 4 }}><Eye size={13} /> {article.viewCount} views</span>
          </p>
        </div>
        {canManage && (
          <div style={{ display: 'flex', gap: 10 }}>
            <button className="btn btn-ghost" onClick={openEdit}><Pencil size={14} /> Edit</button>
            <button className="btn btn-danger" onClick={handleDelete}><Trash2 size={14} /> Delete</button>
          </div>
        )}
      </div>

      {article.tags?.length > 0 && (
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 20 }}>
          {article.tags.map((t: string) => <Badge key={t} tone="neutral">{t}</Badge>)}
        </div>
      )}

      <div className="card" style={{ marginBottom: 20 }}>
        <div style={{ fontSize: 15, lineHeight: 1.7, whiteSpace: 'pre-wrap' }}>{article.content}</div>
      </div>

      <Link to="/knowledge" className="btn btn-ghost">Back to Knowledge Base</Link>

      <Modal
        open={editOpen}
        onClose={() => setEditOpen(false)}
        title="Edit article"
        footer={<><button className="btn btn-ghost" onClick={() => setEditOpen(false)}>Cancel</button><button className="btn btn-primary" onClick={saveEdit} disabled={saving || !form.title || !form.content}>{saving ? 'Saving…' : 'Save changes'}</button></>}
      >
        <div className="form-grid">
          <div className="field full"><label>Article title *</label><input className="input" value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} /></div>
          <div className="field full">
            <label>Type</label>
            <select className="input" value={form.type} onChange={(e) => setForm({ ...form, type: e.target.value })}>
              {TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
            </select>
          </div>
          <div className="field full"><label>Tags (comma separated)</label><input className="input" value={form.tagsInput} onChange={(e) => setForm({ ...form, tagsInput: e.target.value })} /></div>
          <div className="field full"><label>Content *</label><textarea className="input" rows={8} value={form.content} onChange={(e) => setForm({ ...form, content: e.target.value })} /></div>
        </div>
      </Modal>
    </div>
  );
}
