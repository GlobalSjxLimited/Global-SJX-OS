import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { School, Plus, Share2, Users2, Video, MapPin, Layers } from 'lucide-react';
import { RichTextEditor, RichTextRenderer } from '@/components/ui/RichText';
import { api, apiErrorMessage } from '@/lib/api';
import { Badge } from '@/components/ui/Badge';
import { Modal } from '@/components/ui/Modal';
import { EmptyState, Skeleton } from '@/components/ui/Feedback';
import { useAuth } from '@/context/AuthContext';
import { useToast } from '@/context/ToastContext';
import { can } from '@/lib/permissions';
import { AcademyBetaBanner, BetaPill } from '@/components/ui/AcademyBeta';

const CATEGORIES = ['Cybersecurity', 'Cloud', 'IT Infrastructure', 'Payments', 'Software Development', 'Data', 'AI', 'Project Management', 'IT Governance', 'Quality Assurance'];
const CURRENCIES = ['NGN', 'USD', 'GBP', 'EUR'];

const emptyForm = () => ({
  title: '', description: '', category: 'AI', provider: 'Global SJX Academy', instructor: '',
  durationHours: 8, cost: 0, currency: 'NGN', deliveryMode: 'virtual', maxStudents: '',
  type: 'academy', isPublicOnAcademy: true, status: 'published',
});

export function Academy() {
  const navigate = useNavigate();
  const { user } = useAuth();
  const { showError, showSuccess } = useToast();
  const [courses, setCourses] = useState<any[]>([]);
  const [stats, setStats] = useState<Record<string, { enrolledCount: number; seatsRemaining: number | null }>>({});
  const [loading, setLoading] = useState(true);
  const [modalOpen, setModalOpen] = useState(false);
  const [form, setForm] = useState<any>(emptyForm());
  const [saving, setSaving] = useState(false);

  const canCreate = can.manageAcademyCourses(user?.role);

  useEffect(() => { load(); }, []);

  async function load() {
    setLoading(true);
    try {
      const res = await api.get('/courses', { params: { type: 'academy' } });
      setCourses(res.data.data);
      const entries = await Promise.all(
        res.data.data.map(async (c: any) => {
          try {
            const s = await api.get(`/academy/courses/${c._id}/stats`);
            return [c._id, s.data.data];
          } catch {
            return [c._id, { enrolledCount: 0, seatsRemaining: null }];
          }
        })
      );
      setStats(Object.fromEntries(entries));
    } finally {
      setLoading(false);
    }
  }

  async function handleCreate() {
    setSaving(true);
    try {
      await api.post('/courses', { ...form, maxStudents: form.maxStudents ? Number(form.maxStudents) : undefined, createdById: user?.id });
      showSuccess('Academy offering created.');
      setModalOpen(false);
      setForm(emptyForm());
      load();
    } catch (err) {
      showError(apiErrorMessage(err));
    } finally {
      setSaving(false);
    }
  }

  async function shareCourse(courseId: string) {
    const url = `${window.location.origin}/academy/public/${courseId}`;
    try {
      await navigator.clipboard.writeText(url);
      showSuccess('Public link copied to clipboard.');
    } catch {
      showError(`Copy failed — link: ${url}`);
    }
  }

  return (
    <div>
      <div className="page-head">
        <div>
          <h1 style={{ display: 'flex', alignItems: 'center', gap: 10 }}><School size={22} color="var(--gold)" /> Global SJX Academy <BetaPill /></h1>
          <p>Practical technology training — sellable to external organizations, tracked the same way internally.</p>
        </div>
        {canCreate && <button className="btn btn-primary" onClick={() => setModalOpen(true)}><Plus size={16} /> New offering</button>}
      </div>

      <AcademyBetaBanner />

      {loading ? <Skeleton height={200} /> : courses.length === 0 ? (
        <EmptyState message={canCreate ? "No Academy offerings yet — create the first one." : "No Academy offerings published yet."} />
      ) : (
        <div className="grid-3">
          {courses.map((c) => {
            const s = stats[c._id];
            return (
              <div key={c._id} className="card card-hover" onClick={() => navigate(`/academy/${c._id}`)} style={{ cursor: 'pointer' }}>
                <div className="flex-between" style={{ marginBottom: 10 }}>
                  <Badge tone="gold">{c.category}</Badge>
                  <Badge tone="neutral">
                    {c.deliveryMode === 'virtual' ? <Video size={11} style={{ marginRight: 4, display: 'inline' }} /> : c.deliveryMode === 'physical' ? <MapPin size={11} style={{ marginRight: 4, display: 'inline' }} /> : <Layers size={11} style={{ marginRight: 4, display: 'inline' }} />}
                    {c.deliveryMode}
                  </Badge>
                </div>
                <h3 style={{ fontSize: 17, marginBottom: 8 }}>{c.title}</h3>
                <div style={{ fontSize: 13, color: 'var(--muted)', marginBottom: 16, maxHeight: 84, overflow: 'hidden' }}><RichTextRenderer content={c.description || 'Hands-on, instructor-guided training delivered by Global SJX Academy.'} /></div>

                <div className="flex-between" style={{ marginBottom: 10 }}>
                  <span style={{ fontSize: 14, fontWeight: 600 }}>{c.currency} {c.cost?.toLocaleString()}</span>
                  <span style={{ fontSize: 12, color: 'var(--muted-2)' }}>{c.durationHours}h</span>
                </div>

                {s && (
                  <div style={{ fontSize: 12, color: 'var(--muted)', display: 'flex', alignItems: 'center', gap: 5, marginBottom: 14 }}>
                    <Users2 size={13} /> {s.enrolledCount} enrolled{s.seatsRemaining !== null ? ` · ${s.seatsRemaining} seats left` : ' · unlimited seats'}
                  </div>
                )}

                <button className="btn btn-ghost btn-sm" style={{ width: '100%', justifyContent: 'center' }} onClick={(e) => { e.stopPropagation(); shareCourse(c._id); }}>
                  <Share2 size={13} /> Copy public share link
                </button>
              </div>
            );
          })}
        </div>
      )}

      <Modal
        open={modalOpen}
        onClose={() => setModalOpen(false)}
        title="New Academy offering"
        footer={
          <>
            <button className="btn btn-ghost" onClick={() => setModalOpen(false)}>Cancel</button>
            <button className="btn btn-primary" onClick={handleCreate} disabled={saving || !form.title}>{saving ? 'Creating…' : 'Create & publish'}</button>
          </>
        }
      >
        <div className="form-grid">
          <div className="field full"><label>Course title *</label><input className="input" value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} /></div>
          <div className="field full"><label>Description</label><RichTextEditor value={form.description || ''} onChange={(h) => setForm((f: any) => ({ ...f, description: h }))} /></div>
          <div className="field">
            <label>Category</label>
            <select className="input" value={form.category} onChange={(e) => setForm({ ...form, category: e.target.value })}>
              {CATEGORIES.map((c) => <option key={c} value={c}>{c}</option>)}
            </select>
          </div>
          <div className="field"><label>Instructor</label><input className="input" value={form.instructor} onChange={(e) => setForm({ ...form, instructor: e.target.value })} /></div>
          <div className="field"><label>Duration (hours)</label><input className="input" type="number" value={form.durationHours} onChange={(e) => setForm({ ...form, durationHours: Number(e.target.value) })} /></div>
          <div className="field">
            <label>Delivery mode</label>
            <select className="input" value={form.deliveryMode} onChange={(e) => setForm({ ...form, deliveryMode: e.target.value })}>
              <option value="virtual">Virtual</option>
              <option value="physical">In person</option>
              <option value="hybrid">Hybrid</option>
            </select>
          </div>
          <div className="field"><label>Max students (optional)</label><input className="input" type="number" placeholder="Unlimited" value={form.maxStudents} onChange={(e) => setForm({ ...form, maxStudents: e.target.value })} /></div>
          <div className="field">
            <label>Currency</label>
            <select className="input" value={form.currency} onChange={(e) => setForm({ ...form, currency: e.target.value })}>
              {CURRENCIES.map((c) => <option key={c} value={c}>{c}</option>)}
            </select>
          </div>
          <div className="field full"><label>Price</label><input className="input" type="number" value={form.cost} onChange={(e) => setForm({ ...form, cost: Number(e.target.value) })} /></div>
        </div>
      </Modal>
    </div>
  );
}
