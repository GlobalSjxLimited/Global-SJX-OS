import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Plus, Clock, Users2 } from 'lucide-react';
import { api, apiErrorMessage } from '@/lib/api';
import { Badge } from '@/components/ui/Badge';
import { Modal } from '@/components/ui/Modal';
import { EmptyState, Skeleton } from '@/components/ui/Feedback';
import { useToast } from '@/context/ToastContext';
import { useAuth } from '@/context/AuthContext';
import { can } from '@/lib/permissions';

const CATEGORIES = ['Cybersecurity', 'Cloud', 'IT Infrastructure', 'Payments', 'Software Development', 'Data', 'AI', 'Project Management', 'IT Governance', 'Quality Assurance'];
const CURRENCIES = ['NGN', 'USD', 'GBP', 'EUR'];

const emptyForm = () => ({
  title: '', category: '', type: 'internal', provider: '', durationHours: 4,
  cost: 0, currency: 'NGN', deliveryMode: 'virtual', maxStudents: '',
});

export function Training() {
  const navigate = useNavigate();
  const { user } = useAuth();
  const { showError, showSuccess } = useToast();
  const [courses, setCourses] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [modalOpen, setModalOpen] = useState(false);
  const [form, setForm] = useState<any>(emptyForm());
  const [saving, setSaving] = useState(false);
  const [enrolling, setEnrolling] = useState<string | null>(null);

  const canCreate = can.manageAcademyCourses(user?.role);

  useEffect(() => { load(); }, []);

  async function load() {
    setLoading(true);
    try {
      const res = await api.get('/courses');
      setCourses(res.data.data);
    } finally {
      setLoading(false);
    }
  }

  async function enroll(courseId: string) {
    setEnrolling(courseId);
    try {
      await api.post('/enrollments', { courseId });
      showSuccess('Enrolled! Track progress from My Work.');
    } catch (err) {
      showError(apiErrorMessage(err));
    } finally {
      setEnrolling(null);
    }
  }

  async function handleCreate() {
    setSaving(true);
    try {
      await api.post('/courses', { ...form, maxStudents: form.maxStudents ? Number(form.maxStudents) : undefined, createdById: user?.id });
      showSuccess('Course created.');
      setModalOpen(false);
      setForm(emptyForm());
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
          <h1>Training</h1>
          <p>Internal, external, vendor and Academy courses for the Global SJX team.</p>
        </div>
        {canCreate && <button className="btn btn-primary" onClick={() => setModalOpen(true)}><Plus size={16} /> New course</button>}
      </div>

      {loading ? <Skeleton height={200} /> : courses.length === 0 ? <EmptyState message="No courses published yet." /> : (
        <div className="grid-3">
          {courses.map((c) => (
            <div key={c._id} className="card card-hover" onClick={() => navigate(`/training/${c._id}`)} style={{ cursor: 'pointer' }}>
              <div className="flex-between" style={{ marginBottom: 12 }}>
                <Badge tone="accent">{c.category}</Badge>
                <Badge tone="neutral">{c.type}</Badge>
              </div>
              <h3 style={{ fontSize: 16, marginBottom: 8 }}>{c.title}</h3>
              <p style={{ fontSize: 12.5, color: 'var(--muted)', marginBottom: 14 }}>{c.provider}</p>
              {c.maxStudents && (
                <div style={{ fontSize: 12, color: 'var(--muted-2)', display: 'flex', alignItems: 'center', gap: 5, marginBottom: 10 }}>
                  <Users2 size={12} /> Capacity: {c.maxStudents}
                </div>
              )}
              <div className="flex-between">
                <span style={{ fontSize: 12, color: 'var(--muted-2)', display: 'flex', alignItems: 'center', gap: 6 }}><Clock size={13} /> {c.durationHours}h</span>
                <button className="btn btn-ghost btn-sm" onClick={(e) => { e.stopPropagation(); enroll(c._id); }} disabled={enrolling === c._id}>
                  {enrolling === c._id ? 'Enrolling…' : 'Enroll'}
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      <Modal
        open={modalOpen}
        onClose={() => setModalOpen(false)}
        title="New course"
        footer={
          <>
            <button className="btn btn-ghost" onClick={() => setModalOpen(false)}>Cancel</button>
            <button className="btn btn-primary" onClick={handleCreate} disabled={saving || !form.title}>{saving ? 'Creating…' : 'Create'}</button>
          </>
        }
      >
        <div className="form-grid">
          <div className="field full"><label>Training title *</label><input className="input" value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} /></div>
          <div className="field">
            <label>Category</label>
            <select className="input" value={form.category} onChange={(e) => setForm({ ...form, category: e.target.value })}>
              <option value="">—</option>
              {CATEGORIES.map((c) => <option key={c} value={c}>{c}</option>)}
            </select>
          </div>
          <div className="field">
            <label>Type</label>
            <select className="input" value={form.type} onChange={(e) => setForm({ ...form, type: e.target.value })}>
              {['internal', 'external', 'vendor', 'academy'].map((t) => <option key={t} value={t}>{t}</option>)}
            </select>
          </div>
          <div className="field"><label>Provider</label><input className="input" value={form.provider || ''} onChange={(e) => setForm({ ...form, provider: e.target.value })} /></div>
          <div className="field"><label>Duration (hours)</label><input className="input" type="number" value={form.durationHours} onChange={(e) => setForm({ ...form, durationHours: Number(e.target.value) })} /></div>
          <div className="field">
            <label>Delivery mode</label>
            <select className="input" value={form.deliveryMode} onChange={(e) => setForm({ ...form, deliveryMode: e.target.value })}>
              <option value="virtual">Virtual</option>
              <option value="physical">In person</option>
              <option value="hybrid">Hybrid</option>
            </select>
          </div>
          <div className="field"><label>Max participants (optional)</label><input className="input" type="number" placeholder="Unlimited" value={form.maxStudents} onChange={(e) => setForm({ ...form, maxStudents: e.target.value })} /></div>
          <div className="field">
            <label>Currency</label>
            <select className="input" value={form.currency} onChange={(e) => setForm({ ...form, currency: e.target.value })}>
              {CURRENCIES.map((c) => <option key={c} value={c}>{c}</option>)}
            </select>
          </div>
          <div className="field"><label>Cost</label><input className="input" type="number" value={form.cost} onChange={(e) => setForm({ ...form, cost: Number(e.target.value) })} /></div>
        </div>
      </Modal>
    </div>
  );
}
