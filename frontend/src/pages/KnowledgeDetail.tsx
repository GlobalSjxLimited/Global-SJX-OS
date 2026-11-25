import { useEffect, useState } from 'react';
import { useParams, useNavigate, Link } from 'react-router-dom';
import { Eye, Pencil, Trash2, FolderKanban, Globe, EyeOff, Reply, MessageSquare } from 'lucide-react';
import { api, apiErrorMessage } from '@/lib/api';
import { Badge } from '@/components/ui/Badge';
import { Skeleton } from '@/components/ui/Feedback';
import { RichTextEditor, RichTextRenderer } from '@/components/ui/RichText';
import { TagInput } from '@/components/ui/TagInput';
import { useAuth } from '@/context/AuthContext';
import { useToast } from '@/context/ToastContext';
import { useConfirm } from '@/context/ConfirmContext';
import { KB_TYPES } from './Knowledge';

const STATUSES = ['draft', 'approved', 'archived'];
const MANAGER_ROLES = ['hr', 'coo', 'ceo', 'super_admin'];
const PUBLISHER_ROLES = ['ceo', 'super_admin']; // CEO + administrators push to the website

export function KnowledgeDetail() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { user } = useAuth();
  const { showError, showSuccess } = useToast();
  const confirm = useConfirm();

  const [article, setArticle] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState(false);
  const [form, setForm] = useState<any>(null);
  const [saving, setSaving] = useState(false);
  const [projects, setProjects] = useState<any[]>([]);
  const [allCategories, setAllCategories] = useState<string[]>([]);
  const [comment, setComment] = useState('');
  const [replyTo, setReplyTo] = useState<string | null>(null);

  useEffect(() => {
    load();
    api.get('/projects').then((res) => setProjects(res.data.data)).catch(() => undefined);
    api.get('/knowledge/categories').then((r) => setAllCategories(r.data.data.map((c: any) => c.name))).catch(() => undefined);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  async function load() {
    setLoading(true);
    try { setArticle((await api.get(`/knowledge/${id}`)).data.data); } catch (err) { showError(apiErrorMessage(err)); } finally { setLoading(false); }
  }

  const canEdit = article && user && (article.authorId?._id === user.id || MANAGER_ROLES.includes(user.role));
  const canPublish = !!user && PUBLISHER_ROLES.includes(user.role);

  function startEdit() {
    setForm({ title: article.title, type: article.type, summary: article.summary || '', content: article.content, categories: article.categories || [], tags: article.tags || [], status: article.status, relatedProjectId: article.relatedProjectId || '' });
    setEditing(true);
  }

  async function saveEdit() {
    setSaving(true);
    try {
      await api.patch(`/knowledge/${id}`, { ...form, relatedProjectId: form.relatedProjectId || undefined });
      showSuccess('Article updated.');
      setEditing(false);
      load();
    } catch (err) { showError(apiErrorMessage(err)); } finally { setSaving(false); }
  }

  async function togglePublish() {
    const publish = !article.publishedToWebsite;
    const ok = await confirm({
      title: publish ? 'Publish to the website' : 'Remove from the website',
      message: publish ? `"${article.title}" will become visible to anyone on the public Global SJX website (Insights). Continue?` : `"${article.title}" will no longer be visible on the website.`,
      confirmLabel: publish ? 'Publish' : 'Remove',
      danger: !publish,
    });
    if (!ok) return;
    try { await api.post(`/knowledge/${id}/publish`, { publish }); showSuccess(publish ? 'Published to the website.' : 'Removed from the website.'); load(); } catch (err) { showError(apiErrorMessage(err)); }
  }

  async function handleDelete() {
    const ok = await confirm({ title: 'Delete article', message: `Delete "${article.title}"? It will be archived and can be restored by an administrator.`, confirmLabel: 'Delete', danger: true });
    if (!ok) return;
    try { await api.delete(`/knowledge/${id}`); showSuccess('Article deleted.'); navigate('/knowledge'); } catch (err) { showError(apiErrorMessage(err)); }
  }

  async function postComment() {
    try {
      const res = await api.post(`/knowledge/${id}/comments`, { body: comment, parentId: replyTo || undefined });
      setArticle(res.data.data ? { ...article, comments: res.data.data.comments } : article);
      setComment('');
      setReplyTo(null);
    } catch (err) { showError(apiErrorMessage(err)); }
  }

  async function deleteComment(cid: string) {
    try { await api.delete(`/knowledge/${id}/comments/${cid}`); load(); } catch (err) { showError(apiErrorMessage(err)); }
  }

  if (loading || !article) return <Skeleton height={400} />;

  const relatedProject = projects.find((p) => p._id === article.relatedProjectId);
  const top = (article.comments || []).filter((c: any) => !c.parentId);
  const repliesOf = (cid: string) => (article.comments || []).filter((c: any) => String(c.parentId) === String(cid));

  function CommentView({ c, depth }: { c: any; depth: number }) {
    return (
      <div style={{ marginLeft: depth ? 24 : 0, borderLeft: depth ? '2px solid var(--line)' : 'none', paddingLeft: depth ? 12 : 0 }}>
        <div style={{ background: 'var(--surface-2)', borderRadius: 10, padding: '10px 14px' }}>
          <div style={{ fontSize: 12, color: 'var(--muted)', marginBottom: 4 }}><strong>{c.authorId?.name}</strong> · {new Date(c.createdAt).toLocaleString()}</div>
          <RichTextRenderer content={c.body} />
          <div style={{ display: 'flex', gap: 10, marginTop: 4 }}>
            {depth === 0 && <button className="btn btn-ghost btn-sm" onClick={() => setReplyTo(c._id)}><Reply size={12} /> Reply</button>}
            {(c.authorId?._id === user?.id || PUBLISHER_ROLES.includes(user?.role || '') || MANAGER_ROLES.includes(user?.role || '')) && (
              <button className="btn btn-ghost btn-sm" onClick={() => deleteComment(c._id)}><Trash2 size={12} /></button>
            )}
          </div>
        </div>
        {depth === 0 && repliesOf(c._id).map((r: any) => <div key={r._id} style={{ marginTop: 8 }}><CommentView c={r} depth={1} /></div>)}
      </div>
    );
  }

  return (
    <div>
      <div className="page-head">
        <div>
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
            <Badge tone="accent">{article.type}</Badge>
            {article.publishedToWebsite && <Badge tone="gold"><Globe size={10} style={{ marginRight: 3 }} />Live on website</Badge>}
            {(article.categories || []).map((c: string) => <Badge key={c} tone="success">{c}</Badge>)}
          </div>
          <h1 style={{ marginTop: 10 }}>{article.title}</h1>
          <p style={{ display: 'flex', alignItems: 'center', gap: 14, flexWrap: 'wrap' }}>
            <span>{article.authorId?.name} · {new Date(article.createdAt).toLocaleDateString()}</span>
            <span style={{ display: 'flex', alignItems: 'center', gap: 5 }}><Eye size={13} /> {article.viewCount} views</span>
            {article.status !== 'approved' && <Badge tone={article.status === 'draft' ? 'neutral' : 'gold'}>{article.status}</Badge>}
          </p>
        </div>
        {!editing && (
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            {canPublish && (
              <button className="btn btn-ghost" onClick={togglePublish} disabled={article.status !== 'approved'} title={article.status !== 'approved' ? 'Only approved articles can be published' : undefined}>
                {article.publishedToWebsite ? <><EyeOff size={14} /> Unpublish from website</> : <><Globe size={14} /> Push to website</>}
              </button>
            )}
            {canEdit && <button className="btn btn-ghost" onClick={startEdit}><Pencil size={14} /> Edit</button>}
            {canEdit && <button className="btn btn-danger" onClick={handleDelete}><Trash2 size={14} /> Delete</button>}
          </div>
        )}
      </div>

      {!editing ? (
        <div style={{ maxWidth: 820, display: 'grid', gap: 20 }}>
          <div className="card">
            <div style={{ fontSize: 15, marginBottom: 20 }}><RichTextRenderer content={article.content} /></div>
            {article.tags?.length > 0 && <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 16 }}>{article.tags.map((t: string) => <Badge key={t} tone="neutral">{t}</Badge>)}</div>}
            {relatedProject && (
              <Link to={`/projects/${relatedProject._id}`} style={{ fontSize: 13, color: 'var(--accent)', display: 'inline-flex', alignItems: 'center', gap: 6, borderTop: '1px solid var(--line)', paddingTop: 14 }}>
                <FolderKanban size={14} /> Related project: {relatedProject.name}
              </Link>
            )}
          </div>

          <div className="card">
            <h3 style={{ fontSize: 16, marginBottom: 14, display: 'flex', gap: 8, alignItems: 'center' }}><MessageSquare size={16} /> Discussion ({(article.comments || []).length})</h3>
            <div style={{ display: 'grid', gap: 12, marginBottom: 16 }}>
              {top.length === 0 && <p style={{ fontSize: 13, color: 'var(--muted)' }}>No comments yet — start the conversation.</p>}
              {top.map((c: any) => <CommentView key={c._id} c={c} depth={0} />)}
            </div>
            {replyTo && <div style={{ fontSize: 12.5, color: 'var(--muted)', marginBottom: 6 }}>Replying to a comment · <button className="btn btn-ghost btn-sm" onClick={() => setReplyTo(null)}>Cancel</button></div>}
            <RichTextEditor value={comment} onChange={setComment} placeholder="Add a comment or reply…" compact />
            <div style={{ marginTop: 10 }}><button className="btn btn-primary" onClick={postComment} disabled={!comment.replace(/<[^>]*>/g, '').trim()}>{replyTo ? 'Post reply' : 'Post comment'}</button></div>
          </div>
        </div>
      ) : (
        <div className="card" style={{ maxWidth: 820 }}>
          <div className="form-grid">
            <div className="field full"><label>Article title *</label><input className="input" value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} /></div>
            <div className="field"><label>Type</label><select className="input" value={form.type} onChange={(e) => setForm({ ...form, type: e.target.value })}>{KB_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}</select></div>
            <div className="field"><label>Status</label><select className="input" value={form.status} onChange={(e) => setForm({ ...form, status: e.target.value })}>{STATUSES.map((s) => <option key={s} value={s}>{s}</option>)}</select></div>
            <div className="field full"><label>Categories</label><TagInput value={form.categories} onChange={(v) => setForm({ ...form, categories: v })} suggestions={allCategories} placeholder="Add a category" /></div>
            <div className="field full"><label>Tags</label><TagInput value={form.tags} onChange={(v) => setForm({ ...form, tags: v })} /></div>
            <div className="field full"><label>Related project (optional)</label><select className="input" value={form.relatedProjectId} onChange={(e) => setForm({ ...form, relatedProjectId: e.target.value })}><option value="">None</option>{projects.map((p) => <option key={p._id} value={p._id}>{p.name}</option>)}</select></div>
            <div className="field full"><label>Summary</label><textarea className="input" maxLength={300} value={form.summary} onChange={(e) => setForm({ ...form, summary: e.target.value })} /></div>
            <div className="field full"><label>Content *</label><RichTextEditor value={form.content} onChange={(h) => setForm((f: any) => ({ ...f, content: h }))} minHeight={260} /></div>
          </div>
          <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end', marginTop: 18 }}>
            <button className="btn btn-ghost" onClick={() => setEditing(false)}>Cancel</button>
            <button className="btn btn-primary" onClick={saveEdit} disabled={saving || !form.title}>{saving ? 'Saving…' : 'Save changes'}</button>
          </div>
        </div>
      )}

      <Link to="/knowledge" className="btn btn-ghost" style={{ marginTop: 20, justifyContent: 'center', maxWidth: 200 }}>Back to Knowledge Base</Link>
    </div>
  );
}
