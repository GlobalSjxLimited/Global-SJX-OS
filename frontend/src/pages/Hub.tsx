import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { Pin, Cake, UserPlus, Lightbulb, Target, Plus, Award, CalendarDays, GraduationCap, ShieldAlert, BookOpen, MessageSquare, Video, Sparkles } from 'lucide-react';
import { api, apiErrorMessage } from '@/lib/api';
import { useAuth } from '@/context/AuthContext';
import { useToast } from '@/context/ToastContext';
import { Badge } from '@/components/ui/Badge';
import { Modal } from '@/components/ui/Modal';
import { Skeleton } from '@/components/ui/Feedback';
import { RichTextEditor, RichTextRenderer } from '@/components/ui/RichText';
import { can } from '@/lib/permissions';

const CATEGORY_TONE: Record<string, 'accent' | 'gold' | 'success' | 'neutral'> = { announcement: 'accent', news: 'neutral', policy: 'gold', recognition: 'success', event: 'accent' };
const CATEGORIES = ['announcement', 'news', 'policy', 'recognition', 'event'];
const REACTIONS = ['👍', '🎉', '❤️', '👏', '🚀'];
const VALUES = ['Excellence', 'Teamwork', 'Innovation', 'Integrity', 'Customer First'];

function CardTitle({ icon, children, to }: { icon: React.ReactNode; children: React.ReactNode; to?: string }) {
  return (
    <div className="flex-between" style={{ marginBottom: 14 }}>
      <h3 style={{ fontSize: 16, display: 'flex', alignItems: 'center', gap: 8 }}>{icon} {children}</h3>
      {to && <Link to={to} className="btn btn-ghost btn-sm">View all</Link>}
    </div>
  );
}
const Muted = ({ children }: { children: React.ReactNode }) => <p style={{ fontSize: 13, color: 'var(--muted)' }}>{children}</p>;

export function Hub() {
  const { user } = useAuth();
  const { showError, showSuccess } = useToast();
  const [data, setData] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState('all');
  const [modalOpen, setModalOpen] = useState(false);
  const [form, setForm] = useState<any>({ title: '', body: '', category: 'announcement', pinned: false });
  const [saving, setSaving] = useState(false);
  const [recOpen, setRecOpen] = useState(false);
  const [rec, setRec] = useState<any>({ toId: '', value: 'Teamwork', message: '' });
  const [people, setPeople] = useState<any[]>([]);
  const [openComments, setOpenComments] = useState<string | null>(null);
  const [commentText, setCommentText] = useState('');

  const canPost = can.manageEmployees(user?.role);

  useEffect(() => { load(); }, []);

  async function load() {
    try {
      const res = await api.get('/hub');
      setData(res.data.data);
    } catch (err) {
      showError(apiErrorMessage(err));
    } finally {
      setLoading(false);
    }
  }

  async function handlePost() {
    setSaving(true);
    try {
      await api.post('/hub/announcements', form);
      showSuccess('Posted to the Hub.');
      setModalOpen(false);
      setForm({ title: '', body: '', category: 'announcement', pinned: false });
      load();
    } catch (err) { showError(apiErrorMessage(err)); } finally { setSaving(false); }
  }

  async function react(id: string, emoji: string) {
    try {
      const res = await api.post(`/hub/announcements/${id}/react`, { emoji });
      setData((d: any) => ({ ...d, announcements: d.announcements.map((a: any) => (a._id === id ? { ...a, reactions: res.data.data.reactions } : a)) }));
    } catch (err) { showError(apiErrorMessage(err)); }
  }

  async function comment(id: string) {
    try {
      const res = await api.post(`/hub/announcements/${id}/comments`, { body: commentText });
      setData((d: any) => ({ ...d, announcements: d.announcements.map((a: any) => (a._id === id ? { ...a, comments: res.data.data.comments } : a)) }));
      setCommentText('');
    } catch (err) { showError(apiErrorMessage(err)); }
  }

  async function openRecognition() {
    setRecOpen(true);
    if (!people.length) {
      try { const r = await api.get('/employees', { params: { limit: 100 } }); setPeople(r.data.data.filter((p: any) => p._id !== user?.id)); } catch { /* ignore */ }
    }
  }

  async function sendRecognition() {
    try {
      await api.post('/hub/recognitions', rec);
      showSuccess('Recognition sent — they have been notified.');
      setRecOpen(false);
      setRec({ toId: '', value: 'Teamwork', message: '' });
      load();
    } catch (err) { showError(apiErrorMessage(err)); }
  }

  const announcements = useMemo(() => (data ? data.announcements.filter((a: any) => filter === 'all' || a.category === filter) : []), [data, filter]);

  if (loading || !data) return <Skeleton height={400} />;
  const first = user?.name?.split(' ')[0] || '';

  return (
    <div>
      <div className="card" style={{ marginBottom: 20, background: 'linear-gradient(135deg, var(--accent-soft), var(--gold-soft))', border: '1px solid var(--line-strong)' }}>
        <div className="flex-between" style={{ flexWrap: 'wrap', gap: 14 }}>
          <div>
            <h1 style={{ fontSize: 28 }}>Good {data.greetingPeriod}, {first}</h1>
            <p style={{ color: 'var(--muted)', fontSize: 14, marginTop: 4 }}>Here is what is happening across Global SJX today.</p>
          </div>
          <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
            <button className="btn btn-ghost" onClick={openRecognition}><Award size={15} /> Recognise a colleague</button>
            {canPost && <button className="btn btn-primary" onClick={() => setModalOpen(true)}><Plus size={16} /> Post announcement</button>}
          </div>
        </div>
        <div style={{ display: 'flex', gap: 28, marginTop: 18, flexWrap: 'wrap' }}>
          {[['Team members', data.stats.headcount], ['Active projects', data.stats.activeProjects], ['Open ideas', data.stats.openIdeas], ['Goals on track', data.stats.goalsOnTrack]].map(([l, v]) => (
            <div key={String(l)}><div style={{ fontFamily: 'Fraunces, serif', fontSize: 26, fontWeight: 600 }}>{v}</div><div style={{ fontSize: 12, color: 'var(--muted)' }}>{l}</div></div>
          ))}
        </div>
      </div>

      <div className="grid-2" style={{ gridTemplateColumns: 'minmax(0,1.5fr) minmax(0,1fr)' }}>
        <div style={{ display: 'grid', gap: 16, alignContent: 'start' }}>
          <div className="card">
            <div className="flex-between" style={{ marginBottom: 12, flexWrap: 'wrap', gap: 10 }}>
              <h3 style={{ fontSize: 16 }}>Company feed</h3>
              <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                {['all', ...CATEGORIES].map((c) => <button key={c} className={`chip ${filter === c ? 'active' : ''}`} onClick={() => setFilter(c)}>{c}</button>)}
              </div>
            </div>
            {announcements.length === 0 ? <Muted>Nothing posted here yet.</Muted> : (
              <div style={{ display: 'grid', gap: 18 }}>
                {announcements.map((a: any) => {
                  const counts: Record<string, number> = {};
                  (a.reactions || []).forEach((r: any) => { counts[r.emoji] = (counts[r.emoji] || 0) + 1; });
                  const mine = new Set((a.reactions || []).filter((r: any) => String(r.userId) === user?.id).map((r: any) => r.emoji));
                  return (
                    <div key={a._id} style={{ borderBottom: '1px solid var(--line)', paddingBottom: 16 }}>
                      <div className="flex-between" style={{ marginBottom: 6 }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                          {a.pinned && <Pin size={13} color="var(--gold)" />}
                          <strong style={{ fontSize: 15 }}>{a.title}</strong>
                        </div>
                        <Badge tone={CATEGORY_TONE[a.category] || 'neutral'}>{a.category}</Badge>
                      </div>
                      <div style={{ fontSize: 14, marginBottom: 8 }}><RichTextRenderer content={a.body} /></div>
                      <div style={{ fontSize: 11.5, color: 'var(--muted-2)', marginBottom: 8 }}>{a.authorId?.name} · {new Date(a.createdAt).toLocaleDateString()}</div>
                      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center' }}>
                        {REACTIONS.map((e) => (
                          <button key={e} className={`chip ${mine.has(e) ? 'active' : ''}`} onClick={() => react(a._id, e)} style={{ padding: '3px 9px' }}>{e}{counts[e] ? ` ${counts[e]}` : ''}</button>
                        ))}
                        <button className="chip" onClick={() => setOpenComments(openComments === a._id ? null : a._id)}><MessageSquare size={12} /> {a.comments?.length || 0}</button>
                      </div>
                      {openComments === a._id && (
                        <div style={{ marginTop: 12, display: 'grid', gap: 10 }}>
                          {(a.comments || []).map((c: any) => (
                            <div key={c._id} style={{ background: 'var(--surface-2)', borderRadius: 10, padding: '8px 12px' }}>
                              <div style={{ fontSize: 12, color: 'var(--muted)' }}><strong>{c.authorId?.name}</strong> · {new Date(c.createdAt).toLocaleString()}</div>
                              <RichTextRenderer content={c.body} />
                            </div>
                          ))}
                          <RichTextEditor value={commentText} onChange={setCommentText} placeholder="Write a comment…" compact />
                          <div><button className="btn btn-primary btn-sm" disabled={!commentText.replace(/<[^>]*>/g, '').trim()} onClick={() => comment(a._id)}>Comment</button></div>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          <div className="card">
            <CardTitle icon={<Award size={16} color="var(--success)" />}>Recognition wall</CardTitle>
            {data.recognitions.length === 0 ? <Muted>Be the first to recognise a colleague.</Muted> : (
              <div style={{ display: 'grid', gap: 12 }}>
                {data.recognitions.map((r: any) => (
                  <div key={r._id} style={{ display: 'flex', gap: 12 }}>
                    <div style={{ fontSize: 22 }}>🏆</div>
                    <div>
                      <div style={{ fontSize: 13.5 }}><strong>{r.fromId?.name}</strong> recognised <strong>{r.toId?.name}</strong> <Badge tone="success">{r.value}</Badge></div>
                      <div style={{ fontSize: 13, color: 'var(--muted)' }}>{r.message}</div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          <div className="grid-2">
            <div className="card">
              <CardTitle icon={<Lightbulb size={16} color="var(--gold)" />} to="/ideas">Trending ideas</CardTitle>
              {data.trendingIdeas.length === 0 ? <Muted>No ideas submitted yet.</Muted> : (
                <div style={{ display: 'grid', gap: 10 }}>
                  {data.trendingIdeas.map((idea: any) => (
                    <Link key={idea._id} to={`/ideas/${idea._id}`} className="flex-between"><span style={{ fontSize: 13.5 }}>{idea.title}</span><Badge tone="accent">{idea.votes?.length || 0}</Badge></Link>
                  ))}
                </div>
              )}
            </div>
            <div className="card">
              <CardTitle icon={<BookOpen size={16} color="var(--accent)" />} to="/knowledge">Latest knowledge</CardTitle>
              {data.latestArticles.length === 0 ? <Muted>No articles yet.</Muted> : (
                <div style={{ display: 'grid', gap: 10 }}>
                  {data.latestArticles.map((a: any) => (
                    <Link key={a._id} to={`/knowledge/${a._id}`}><div style={{ fontSize: 13.5 }}>{a.title}</div><div style={{ fontSize: 11.5, color: 'var(--muted-2)' }}>{(a.categories || []).join(' · ') || a.type}</div></Link>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>

        <div style={{ display: 'grid', gap: 16, alignContent: 'start' }}>
          <div className="card">
            <CardTitle icon={<CalendarDays size={16} color="var(--accent)" />} to="/meetings">My next 14 days</CardTitle>
            {data.upcomingMeetings.length === 0 ? <Muted>No meetings scheduled.</Muted> : (
              <div style={{ display: 'grid', gap: 10 }}>
                {data.upcomingMeetings.map((m: any) => (
                  <div key={m._id} className="flex-between">
                    <div><div style={{ fontSize: 13.5 }}>{m.title}</div><div style={{ fontSize: 11.5, color: 'var(--muted-2)' }}>{new Date(m.date).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' })}</div></div>
                    {m.meetingLink && /^https?:\/\//i.test(m.meetingLink) && <a className="btn btn-ghost btn-sm" href={m.meetingLink} target="_blank" rel="noopener noreferrer"><Video size={13} /> Join</a>}
                  </div>
                ))}
              </div>
            )}
          </div>

          {(data.expiringCertifications.length > 0 || data.certUpdates.length > 0) && (
            <div className="card">
              <CardTitle icon={<ShieldAlert size={16} color="var(--gold)" />} to="/certifications">My certifications</CardTitle>
              {data.expiringCertifications.map((c: any) => (
                <div key={c._id} className="flex-between" style={{ marginBottom: 8 }}><span style={{ fontSize: 13.5 }}>{c.name}</span><Badge tone={new Date(c.expiryDate) < new Date() ? 'danger' : 'gold'}>{new Date(c.expiryDate) < new Date() ? 'expired' : `expires ${new Date(c.expiryDate).toLocaleDateString()}`}</Badge></div>
              ))}
              {data.certUpdates.map((u: any) => (
                <div key={u._id} style={{ borderLeft: '3px solid var(--accent)', paddingLeft: 10, margin: '10px 0' }}>
                  <div style={{ fontSize: 13 }}><strong>{u.certificationName}</strong>: {u.title}</div>
                  <div style={{ fontSize: 11.5, color: 'var(--muted-2)' }}>{new Date(u.createdAt).toLocaleDateString()}{u.newDate ? ` · ${new Date(u.newDate).toLocaleDateString()}` : ''}</div>
                </div>
              ))}
            </div>
          )}

          <div className="card">
            <CardTitle icon={<GraduationCap size={16} color="var(--success)" />} to="/training">Learning</CardTitle>
            {data.myEnrollments.length > 0 && data.myEnrollments.map((e: any) => (
              <Link key={e._id} to={`/training/${e.courseId?._id}`} style={{ display: 'block', marginBottom: 10 }}>
                <div className="flex-between"><span style={{ fontSize: 13.5 }}>{e.courseId?.title}</span><span style={{ fontSize: 12, color: 'var(--muted)' }}>{e.progressPercent}%</span></div>
                <div style={{ height: 5, borderRadius: 10, background: 'var(--surface-3)', marginTop: 4 }}><div style={{ height: '100%', width: `${e.progressPercent}%`, background: 'var(--success)', borderRadius: 10 }} /></div>
              </Link>
            ))}
            {data.myEnrollments.length === 0 && <Muted>You are not enrolled in any course yet.</Muted>}
            {data.suggestedCourses.length > 0 && (
              <div style={{ marginTop: 12, paddingTop: 12, borderTop: '1px solid var(--line)' }}>
                <div style={{ fontSize: 12, color: 'var(--muted)', marginBottom: 6, display: 'flex', gap: 6, alignItems: 'center' }}><Sparkles size={12} /> Suggested for you</div>
                {data.suggestedCourses.map((c: any) => <Link key={c._id} to={`/training/${c._id}`} style={{ display: 'block', fontSize: 13, padding: '3px 0' }}>{c.title}</Link>)}
              </div>
            )}
          </div>

          <div className="card">
            <CardTitle icon={<Target size={16} color="var(--accent)" />} to="/goals">Company goals</CardTitle>
            {data.companyGoals.length === 0 ? <Muted>No company-level goals set.</Muted> : (
              <div style={{ display: 'grid', gap: 14 }}>
                {data.companyGoals.map((g: any) => (
                  <div key={g._id}>
                    <div className="flex-between" style={{ marginBottom: 6 }}><span style={{ fontSize: 13 }}>{g.title}</span><span style={{ fontSize: 12, color: 'var(--muted)' }}>{g.progressPercent}%</span></div>
                    <div style={{ height: 6, borderRadius: 10, background: 'var(--surface-3)' }}><div style={{ height: '100%', width: `${g.progressPercent}%`, background: 'linear-gradient(90deg,var(--accent),var(--gold))', borderRadius: 10 }} /></div>
                  </div>
                ))}
              </div>
            )}
          </div>

          {data.events.length > 0 && (
            <div className="card">
              <CardTitle icon={<CalendarDays size={16} color="var(--gold)" />}>Events</CardTitle>
              {data.events.map((e: any) => <div key={e._id} style={{ fontSize: 13.5, padding: '4px 0' }}>{e.title}</div>)}
            </div>
          )}

          <div className="grid-2" style={{ gridTemplateColumns: '1fr 1fr' }}>
            <div className="card">
              <CardTitle icon={<UserPlus size={16} color="var(--success)" />}>New faces</CardTitle>
              {data.newEmployees.length === 0 ? <Muted>No new joiners.</Muted> : data.newEmployees.map((e: any) => (<div key={e._id} style={{ marginBottom: 6 }}><div style={{ fontSize: 13.5 }}>{e.name}</div><div style={{ fontSize: 11.5, color: 'var(--muted-2)' }}>{e.jobTitle}</div></div>))}
            </div>
            <div className="card">
              <CardTitle icon={<Cake size={16} color="var(--gold)" />}>Birthdays</CardTitle>
              {data.birthdays.length === 0 ? <Muted>None in the next 30 days.</Muted> : data.birthdays.map((b: any) => (<div key={b.id} className="flex-between" style={{ marginBottom: 6 }}><span style={{ fontSize: 13.5 }}>{b.name}</span><span style={{ fontSize: 12, color: 'var(--muted-2)' }}>{new Date(b.nextBirthday).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}</span></div>))}
            </div>
          </div>
        </div>
      </div>

      <Modal open={modalOpen} onClose={() => setModalOpen(false)} title="Post an announcement" footer={<><button className="btn btn-ghost" onClick={() => setModalOpen(false)}>Cancel</button><button className="btn btn-primary" onClick={handlePost} disabled={saving || !form.title || !form.body.replace(/<[^>]*>/g, '').trim()}>{saving ? 'Posting…' : 'Post'}</button></>}>
        <div className="form-grid">
          <div className="field full"><label>Announcement title *</label><input className="input" value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} /></div>
          <div className="field full"><label>Message *</label><RichTextEditor value={form.body} onChange={(h) => setForm((f: any) => ({ ...f, body: h }))} /></div>
          <div className="field"><label>Category</label><select className="input" value={form.category} onChange={(e) => setForm({ ...form, category: e.target.value })}>{CATEGORIES.map((c) => <option key={c} value={c}>{c}</option>)}</select></div>
          <div className="field" style={{ flexDirection: 'row', alignItems: 'center', gap: 8, justifyContent: 'flex-end' }}><input type="checkbox" checked={form.pinned} onChange={(e) => setForm({ ...form, pinned: e.target.checked })} id="pinned" /><label htmlFor="pinned" style={{ margin: 0 }}>Pin to top</label></div>
        </div>
      </Modal>

      <Modal open={recOpen} onClose={() => setRecOpen(false)} title="Recognise a colleague" footer={<><button className="btn btn-ghost" onClick={() => setRecOpen(false)}>Cancel</button><button className="btn btn-primary" onClick={sendRecognition} disabled={!rec.toId || !rec.message.trim()}>Send recognition</button></>}>
        <div className="form-grid">
          <div className="field full"><label>Colleague *</label><select className="input" value={rec.toId} onChange={(e) => setRec({ ...rec, toId: e.target.value })}><option value="">Choose…</option>{people.map((p) => <option key={p._id} value={p._id}>{p.name}</option>)}</select></div>
          <div className="field full"><label>Company value</label><select className="input" value={rec.value} onChange={(e) => setRec({ ...rec, value: e.target.value })}>{VALUES.map((v) => <option key={v}>{v}</option>)}</select></div>
          <div className="field full"><label>Message *</label><textarea className="input" maxLength={600} value={rec.message} onChange={(e) => setRec({ ...rec, message: e.target.value })} /></div>
        </div>
      </Modal>
    </div>
  );
}
