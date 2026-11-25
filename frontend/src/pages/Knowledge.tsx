import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Search, Plus, BookOpen, Globe } from 'lucide-react';
import { api, apiErrorMessage } from '@/lib/api';
import { Badge } from '@/components/ui/Badge';
import { Modal } from '@/components/ui/Modal';
import { EmptyState, Skeleton } from '@/components/ui/Feedback';
import { RichTextEditor } from '@/components/ui/RichText';
import { TagInput } from '@/components/ui/TagInput';
import { useToast } from '@/context/ToastContext';
import { useQuickCreate } from '@/lib/useQuickCreate';

export const KB_TYPES = ['SOP', 'Policy', 'Technical Documentation', 'Project Lesson', 'Case Study', 'Proposal Template', 'Training Material', 'General'];
const blank = { title: '', type: 'General', summary: '', content: '', categories: [] as string[], tags: [] as string[] };

export function Knowledge() {
  const navigate = useNavigate();
  const { showError, showSuccess } = useToast();
  const [articles, setArticles] = useState<any[]>([]);
  const [categories, setCategories] = useState<Array<{ name: string; count: number }>>([]);
  const [q, setQ] = useState('');
  const [category, setCategory] = useState('');
  const [mine, setMine] = useState(false);
  const [website, setWebsite] = useState(false);
  const [loading, setLoading] = useState(true);
  const [modalOpen, setModalOpen] = useState(false);
  const [form, setForm] = useState<any>(blank);
  const [saving, setSaving] = useState(false);

  useEffect(() => { const t = setTimeout(load, q ? 300 : 0); return () => clearTimeout(t); /* eslint-disable-next-line */ }, [q, category, mine, website]);
  useEffect(() => { loadCategories(); }, []);
  useQuickCreate(() => setModalOpen(true));

  async function loadCategories() {
    try { setCategories((await api.get('/knowledge/categories')).data.data); } catch { /* optional */ }
  }

  async function load() {
    setLoading(true);
    try {
      const res = await api.get('/knowledge', { params: { ...(q ? { q } : {}), ...(category ? { category } : {}), ...(mine ? { mine: 'true' } : {}), ...(website ? { website: 'true' } : {}) } });
      setArticles(res.data.data);
    } catch (err) { showError(apiErrorMessage(err)); } finally { setLoading(false); }
  }

  async function handleCreate() {
    setSaving(true);
    try {
      await api.post('/knowledge', { ...form, status: 'approved' });
      showSuccess('Article published.');
      setModalOpen(false);
      setForm(blank);
      load();
      loadCategories();
    } catch (err) { showError(apiErrorMessage(err)); } finally { setSaving(false); }
  }

  const contentEmpty = !form.content.replace(/<[^>]*>/g, '').trim() && !/<img/i.test(form.content);

  return (
    <div>
      <div className="page-head">
        <div>
          <h1>Knowledge Base</h1>
          <p>SOPs, policies, technical docs, lessons and case studies — searchable company knowledge with rich formatting and website publishing.</p>
        </div>
        <button className="btn btn-primary" onClick={() => setModalOpen(true)}><Plus size={16} /> New article</button>
      </div>

      <div style={{ display: 'flex', gap: 12, marginBottom: 14, flexWrap: 'wrap', alignItems: 'center' }}>
        <div className="topbar-search" style={{ maxWidth: 380 }}><Search /><input placeholder="Search title, summary, tags or category…" value={q} onChange={(e) => setQ(e.target.value)} /></div>
        <button className={`chip ${mine ? 'active' : ''}`} onClick={() => setMine(!mine)}>My contributions</button>
        <button className={`chip ${website ? 'active' : ''}`} onClick={() => setWebsite(!website)}><Globe size={12} /> On website</button>
      </div>

      <div className="pill-tabs">
        <button className={`chip ${category === '' ? 'active' : ''}`} onClick={() => setCategory('')}>All categories</button>
        {categories.map((c) => <button key={c.name} className={`chip ${category === c.name ? 'active' : ''}`} onClick={() => setCategory(c.name)}>{c.name} · {c.count}</button>)}
      </div>

      {loading ? <Skeleton height={200} /> : articles.length === 0 ? <EmptyState message="No articles found." icon={<BookOpen />} /> : (
        <div className="grid-3">
          {articles.map((a) => (
            <div key={a._id} className="card card-hover" onClick={() => navigate(`/knowledge/${a._id}`)} style={{ cursor: 'pointer' }}>
              <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                <Badge tone="accent">{a.type}</Badge>
                {a.publishedToWebsite && <Badge tone="gold"><Globe size={10} style={{ marginRight: 3 }} />Website</Badge>}
                {a.status !== 'approved' && <Badge tone="neutral">{a.status}</Badge>}
              </div>
              <h3 style={{ fontSize: 16, margin: '10px 0 6px' }}>{a.title}</h3>
              {a.summary && <p style={{ fontSize: 13, color: 'var(--muted)', marginBottom: 8, display: '-webkit-box', WebkitLineClamp: 3, WebkitBoxOrient: 'vertical', overflow: 'hidden' }}>{a.summary}</p>}
              <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 10 }}>
                {(a.categories || []).slice(0, 3).map((t: string) => <Badge key={t} tone="success">{t}</Badge>)}
                {(a.tags || []).slice(0, 2).map((t: string) => <Badge key={t} tone="neutral">{t}</Badge>)}
              </div>
              <div className="flex-between">
                <span style={{ fontSize: 12, color: 'var(--muted-2)' }}>{a.authorId?.name}</span>
                <span style={{ fontSize: 12, color: 'var(--muted-2)' }}>{a.viewCount} views</span>
              </div>
            </div>
          ))}
        </div>
      )}

      <Modal
        open={modalOpen}
        onClose={() => setModalOpen(false)}
        title="New knowledge article"
        footer={<><button className="btn btn-ghost" onClick={() => setModalOpen(false)}>Cancel</button><button className="btn btn-primary" onClick={handleCreate} disabled={saving || !form.title || contentEmpty}>{saving ? 'Saving…' : 'Publish'}</button></>}
      >
        <div className="form-grid">
          <div className="field full"><label>Article title *</label><input className="input" value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} /></div>
          <div className="field full"><label>Type</label><select className="input" value={form.type} onChange={(e) => setForm({ ...form, type: e.target.value })}>{KB_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}</select></div>
          <div className="field full"><label>Categories (add as many as you like)</label><TagInput value={form.categories} onChange={(v) => setForm({ ...form, categories: v })} suggestions={categories.map((c) => c.name)} placeholder="Type a category and press Enter" /></div>
          <div className="field full"><label>Tags</label><TagInput value={form.tags} onChange={(v) => setForm({ ...form, tags: v })} placeholder="onboarding, payments…" /></div>
          <div className="field full"><label>Short summary (shown on cards and the website)</label><textarea className="input" maxLength={300} value={form.summary} onChange={(e) => setForm({ ...form, summary: e.target.value })} /></div>
          <div className="field full"><label>Content *</label><RichTextEditor value={form.content} onChange={(h) => setForm((f: any) => ({ ...f, content: h }))} minHeight={220} /></div>
        </div>
      </Modal>
    </div>
  );
}
