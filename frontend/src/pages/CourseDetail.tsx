import { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import { Plus, FileText, Clock, Users2, Megaphone, Layers, ExternalLink, CheckCircle2, MessageSquare, Trash2, HelpCircle, X } from 'lucide-react';
import { RichTextEditor, RichTextRenderer } from '@/components/ui/RichText';
import { api, apiErrorMessage } from '@/lib/api';
import { Badge, statusTone } from '@/components/ui/Badge';
import { Modal } from '@/components/ui/Modal';
import { Skeleton, EmptyState } from '@/components/ui/Feedback';
import { useAuth } from '@/context/AuthContext';
import { useToast } from '@/context/ToastContext';
import { can } from '@/lib/permissions';
import { MentionTextarea, MentionText } from '@/components/ui/MentionTextarea';

const TABS = ['Overview', 'Content', 'Assignments', 'Quizzes', 'Discussion', 'Groups', 'Students', 'Gradebook', 'Updates'];

export function CourseDetail() {
  const { id } = useParams();
  const { user } = useAuth();
  const { showError, showSuccess } = useToast();
  const [course, setCourse] = useState<any>(null);
  const [enrolled, setEnrolled] = useState(false);
  const [myEnrollment, setMyEnrollment] = useState<any>(null);
  const [enrolledStudents, setEnrolledStudents] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState('Overview');
  const [saving, setSaving] = useState(false);

  const manage = can.manageAcademyCourses(user?.role) || course?.createdById === user?.id;

  const [moduleModalOpen, setModuleModalOpen] = useState(false);
  const [moduleForm, setModuleForm] = useState<any>({ title: '', description: '', contentUrl: '', body: '' });

  const [assignmentModalOpen, setAssignmentModalOpen] = useState(false);
  const [assignmentForm, setAssignmentForm] = useState<any>({ title: '', description: '', dueDate: '', maxScore: 100, resourceUrls: [] as Array<{ url: string; name: string }> });
  const [uploadingResource, setUploadingResource] = useState(false);

  const [submissionModalOpen, setSubmissionModalOpen] = useState<string | null>(null);
  const [submissionForm, setSubmissionForm] = useState<any>({ text: '', fileUrls: [] as Array<{ url: string; name: string }> });
  const [uploadingSubmission, setUploadingSubmission] = useState(false);

  const [gradingAssignmentId, setGradingAssignmentId] = useState<string | null>(null);
  const [submissions, setSubmissions] = useState<any[]>([]);
  const [gradeDrafts, setGradeDrafts] = useState<Record<string, { score: string; feedback: string }>>({});

  const [groupModalOpen, setGroupModalOpen] = useState(false);
  const [groupForm, setGroupForm] = useState<any>({ name: '', memberIds: [] as string[] });

  const [updateBody, setUpdateBody] = useState('');

  const [posts, setPosts] = useState<any[]>([]);
  const [postBody, setPostBody] = useState('');
  const [postVisibility, setPostVisibility] = useState<'public' | 'private' | 'user' | 'group'>('public');
  const [postTargetUserId, setPostTargetUserId] = useState('');
  const [postTargetGroupId, setPostTargetGroupId] = useState('');
  const [replyDrafts, setReplyDrafts] = useState<Record<string, string>>({});
  const [postingDiscussion, setPostingDiscussion] = useState(false);

  const [quizModalOpen, setQuizModalOpen] = useState(false);
  const [quizForm, setQuizForm] = useState<any>({ title: '', description: '', dueDate: '', questions: [] as any[] });
  const [takingQuizId, setTakingQuizId] = useState<string | null>(null);
  const [quizTaking, setQuizTaking] = useState<any>(null); // { quiz, attempt }
  const [quizAnswers, setQuizAnswers] = useState<number[]>([]);
  const [submittingQuiz, setSubmittingQuiz] = useState(false);

  const [gradebook, setGradebook] = useState<any>(null);
  const [addStudentId, setAddStudentId] = useState('');
  const [addingStudent, setAddingStudent] = useState(false);
  const [allEmployees, setAllEmployees] = useState<any[]>([]);
  const [courseEnrollments, setCourseEnrollments] = useState<any[]>([]);

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  async function load() {
    setLoading(true);
    try {
      const [courseRes, myEnrollmentRes] = await Promise.all([
        api.get(`/courses/${id}`),
        api.get('/enrollments', { params: { courseId: id, userId: user?.id } }),
      ]);
      setCourse(courseRes.data.data);
      setEnrolled(myEnrollmentRes.data.data.length > 0);
      setMyEnrollment(myEnrollmentRes.data.data[0] || null);

      if (can.manageAcademyCourses(user?.role) || courseRes.data.data.createdById === user?.id) {
        const [allEnrollments, employeesRes] = await Promise.all([
          api.get('/enrollments', { params: { courseId: id } }),
          api.get('/employees', { params: { limit: 200 } }),
        ]);
        setEnrolledStudents(allEnrollments.data.data.map((e: any) => e.userId).filter(Boolean));
        setCourseEnrollments(allEnrollments.data.data);
        setAllEmployees(employeesRes.data.data);
      }
    } catch (err) {
      showError(apiErrorMessage(err));
    } finally {
      setLoading(false);
    }
  }

  async function addStudent() {
    if (!addStudentId) return;
    setAddingStudent(true);
    try {
      await api.post('/enrollments', { courseId: id, userId: addStudentId });
      showSuccess('Student enrolled.');
      setAddStudentId('');
      load();
    } catch (err) {
      showError(apiErrorMessage(err));
    } finally {
      setAddingStudent(false);
    }
  }

  async function removeStudent(enrollmentId: string) {
    try {
      await api.delete(`/enrollments/${enrollmentId}`);
      showSuccess('Student removed.');
      load();
    } catch (err) {
      showError(apiErrorMessage(err));
    }
  }

  async function handleEnroll() {
    try {
      await api.post('/enrollments', { courseId: id });
      showSuccess('Enrolled!');
      load();
    } catch (err) {
      showError(apiErrorMessage(err));
    }
  }

  async function addModule() {
    setSaving(true);
    try {
      await api.post(`/courses/${id}/modules`, moduleForm);
      showSuccess('Module added.');
      setModuleModalOpen(false);
      setModuleForm({ title: '', description: '', contentUrl: '', body: '' });
      load();
    } catch (err) {
      showError(apiErrorMessage(err));
    } finally {
      setSaving(false);
    }
  }

  async function addAssignment() {
    setSaving(true);
    try {
      await api.post(`/courses/${id}/assignments`, assignmentForm);
      showSuccess('Assignment created and students notified.');
      setAssignmentModalOpen(false);
      setAssignmentForm({ title: '', description: '', dueDate: '', maxScore: 100, resourceUrls: [] });
      load();
    } catch (err) {
      showError(apiErrorMessage(err));
    } finally {
      setSaving(false);
    }
  }

  async function handleSubmissionFiles(files: FileList) {
    setUploadingSubmission(true);
    try {
      const body = new FormData();
      Array.from(files).forEach((f) => body.append('files', f));
      const res = await api.post('/uploads/multi', body, { headers: { 'Content-Type': 'multipart/form-data' } });
      const uploaded = res.data.data.map((u: any) => ({ url: u.url, name: u.originalName }));
      setSubmissionForm((f: any) => ({ ...f, fileUrls: [...f.fileUrls, ...uploaded] }));
    } catch (err) {
      showError(apiErrorMessage(err));
    } finally {
      setUploadingSubmission(false);
    }
  }

  async function handleResourceFiles(files: FileList) {
    setUploadingResource(true);
    try {
      const body = new FormData();
      Array.from(files).forEach((f) => body.append('files', f));
      const res = await api.post('/uploads/multi', body, { headers: { 'Content-Type': 'multipart/form-data' } });
      const uploaded = res.data.data.map((u: any) => ({ url: u.url, name: u.originalName }));
      setAssignmentForm((f: any) => ({ ...f, resourceUrls: [...f.resourceUrls, ...uploaded] }));
    } catch (err) {
      showError(apiErrorMessage(err));
    } finally {
      setUploadingResource(false);
    }
  }

  async function submitAssignment(assignmentId: string) {
    setSaving(true);
    try {
      await api.post(`/courses/${id}/assignments/${assignmentId}/submissions`, submissionForm);
      showSuccess('Submitted.');
      setSubmissionModalOpen(null);
      setSubmissionForm({ text: '', fileUrls: [] });
    } catch (err) {
      showError(apiErrorMessage(err));
    } finally {
      setSaving(false);
    }
  }

  async function openGrading(assignmentId: string) {
    setGradingAssignmentId(assignmentId);
    const res = await api.get(`/courses/${id}/assignments/${assignmentId}/submissions`);
    setSubmissions(res.data.data);
    const drafts: Record<string, { score: string; feedback: string }> = {};
    res.data.data.forEach((s: any) => (drafts[s._id] = { score: s.score ?? '', feedback: s.feedback ?? '' }));
    setGradeDrafts(drafts);
  }

  async function saveGrade(submissionId: string) {
    const draft = gradeDrafts[submissionId];
    try {
      await api.patch(`/courses/submissions/${submissionId}/grade`, { score: Number(draft.score), feedback: draft.feedback });
      showSuccess('Graded.');
      if (gradingAssignmentId) openGrading(gradingAssignmentId);
    } catch (err) {
      showError(apiErrorMessage(err));
    }
  }

  async function createGroup() {
    setSaving(true);
    try {
      await api.post(`/courses/${id}/groups`, groupForm);
      showSuccess('Group created.');
      setGroupModalOpen(false);
      setGroupForm({ name: '', memberIds: [] });
      load();
    } catch (err) {
      showError(apiErrorMessage(err));
    } finally {
      setSaving(false);
    }
  }

  async function postUpdate() {
    if (!updateBody.trim()) return;
    try {
      await api.post(`/courses/${id}/updates`, { body: updateBody });
      showSuccess('Posted.');
      setUpdateBody('');
      load();
    } catch (err) {
      showError(apiErrorMessage(err));
    }
  }

  async function loadPosts() {
    try {
      const res = await api.get(`/courses/${id}/posts`);
      setPosts(res.data.data);
    } catch (err) {
      showError(apiErrorMessage(err));
    }
  }

  async function submitPost() {
    if (!postBody.trim()) return;
    setPostingDiscussion(true);
    try {
      await api.post(`/courses/${id}/posts`, {
        body: postBody,
        visibility: postVisibility,
        targetUserId: postVisibility === 'user' ? postTargetUserId : undefined,
        targetCourseGroupId: postVisibility === 'group' ? postTargetGroupId : undefined,
      });
      showSuccess('Posted.');
      setPostBody('');
      setPostVisibility('public');
      setPostTargetUserId('');
      setPostTargetGroupId('');
      loadPosts();
    } catch (err) {
      showError(apiErrorMessage(err));
    } finally {
      setPostingDiscussion(false);
    }
  }

  async function submitReply(postId: string) {
    const body = replyDrafts[postId];
    if (!body?.trim()) return;
    try {
      await api.post(`/courses/${id}/posts/${postId}/replies`, { body });
      setReplyDrafts({ ...replyDrafts, [postId]: '' });
      loadPosts();
    } catch (err) {
      showError(apiErrorMessage(err));
    }
  }

  async function deletePost(postId: string) {
    try {
      await api.delete(`/courses/${id}/posts/${postId}`);
      loadPosts();
    } catch (err) {
      showError(apiErrorMessage(err));
    }
  }

  function addQuizQuestion() {
    setQuizForm((f: any) => ({ ...f, questions: [...f.questions, { text: '', options: ['', ''], correctIndex: 0, points: 1 }] }));
  }

  function updateQuizQuestion(i: number, patch: any) {
    setQuizForm((f: any) => {
      const questions = [...f.questions];
      questions[i] = { ...questions[i], ...patch };
      return { ...f, questions };
    });
  }

  function updateQuizOption(qi: number, oi: number, value: string) {
    setQuizForm((f: any) => {
      const questions = [...f.questions];
      const options = [...questions[qi].options];
      options[oi] = value;
      questions[qi] = { ...questions[qi], options };
      return { ...f, questions };
    });
  }

  function addQuizOption(qi: number) {
    setQuizForm((f: any) => {
      const questions = [...f.questions];
      questions[qi] = { ...questions[qi], options: [...questions[qi].options, ''] };
      return { ...f, questions };
    });
  }

  function removeQuizQuestion(i: number) {
    setQuizForm((f: any) => ({ ...f, questions: f.questions.filter((_: any, idx: number) => idx !== i) }));
  }

  async function createQuiz() {
    setSaving(true);
    try {
      await api.post(`/courses/${id}/quizzes`, quizForm);
      showSuccess('Quiz created and students notified.');
      setQuizModalOpen(false);
      setQuizForm({ title: '', description: '', dueDate: '', questions: [] });
      load();
    } catch (err) {
      showError(apiErrorMessage(err));
    } finally {
      setSaving(false);
    }
  }

  async function openQuiz(quizId: string) {
    setTakingQuizId(quizId);
    try {
      const res = await api.get(`/courses/${id}/quizzes/${quizId}`);
      setQuizTaking(res.data.data);
      setQuizAnswers(new Array(res.data.data.quiz.questions.length).fill(-1));
    } catch (err) {
      showError(apiErrorMessage(err));
    }
  }

  async function submitQuiz() {
    if (!takingQuizId) return;
    setSubmittingQuiz(true);
    try {
      const res = await api.post(`/courses/${id}/quizzes/${takingQuizId}/attempts`, { answers: quizAnswers });
      showSuccess(`Submitted — scored ${res.data.data.score}/${res.data.data.maxScore}.`);
      openQuiz(takingQuizId);
    } catch (err) {
      showError(apiErrorMessage(err));
    } finally {
      setSubmittingQuiz(false);
    }
  }

  async function loadGradebook() {
    try {
      const res = await api.get(`/courses/${id}/gradebook`);
      setGradebook(res.data.data);
    } catch (err) {
      showError(apiErrorMessage(err));
    }
  }

  async function toggleModuleComplete(moduleId: string) {
    try {
      await api.post(`/courses/${id}/modules/${moduleId}/complete`);
      load();
    } catch (err) {
      showError(apiErrorMessage(err));
    }
  }

  function toggleGroupMember(userId: string) {
    setGroupForm((f: any) => ({
      ...f,
      memberIds: f.memberIds.includes(userId) ? f.memberIds.filter((v: string) => v !== userId) : [...f.memberIds, userId],
    }));
  }

  if (loading || !course) return <Skeleton height={300} />;

  return (
    <div>
      <div className="page-head">
        <div>
          <div style={{ display: 'flex', gap: 10, marginBottom: 8 }}>
            <Badge tone="accent">{course.category}</Badge>
            <Badge tone="neutral">{course.type}</Badge>
          </div>
          <h1>{course.title}</h1>
          <p>{course.provider} {course.instructor && `· ${course.instructor}`}</p>
        </div>
        {!enrolled && <button className="btn btn-primary" onClick={handleEnroll}>Enroll</button>}
        {enrolled && <Badge tone="success"><CheckCircle2 size={12} style={{ marginRight: 4, display: 'inline' }} /> Enrolled</Badge>}
      </div>

      <div className="stat-grid" style={{ marginBottom: 26 }}>
        <div className="stat-card"><div className="stat-label"><span>Duration</span></div><div className="stat-value" style={{ fontSize: 22 }}>{course.durationHours}h</div></div>
        <div className="stat-card"><div className="stat-label"><span>Price</span></div><div className="stat-value" style={{ fontSize: 22 }}>{course.currency} {course.cost?.toLocaleString()}</div></div>
        <div className="stat-card"><div className="stat-label"><span>Delivery</span></div><div className="stat-value" style={{ fontSize: 22, textTransform: 'capitalize' }}>{course.deliveryMode}</div></div>
        <div className="stat-card"><div className="stat-label"><span>Enrolled</span></div><div className="stat-value">{enrolledStudents.length || '—'}{course.maxStudents ? ` / ${course.maxStudents}` : ''}</div></div>
      </div>

      <div className="tabs">
        {(manage ? TABS : TABS.filter((t) => !['Students', 'Gradebook'].includes(t))).map((t) => (
          <div
            key={t}
            className={`tab ${tab === t ? 'active' : ''}`}
            onClick={() => {
              setTab(t);
              if (t === 'Discussion' && posts.length === 0) loadPosts();
              if (t === 'Gradebook' && !gradebook) loadGradebook();
            }}
          >
            {t}
          </div>
        ))}
      </div>

      {tab === 'Overview' && (
        <div className="card">
          <RichTextRenderer content={course.description || 'No description provided.'} />
        </div>
      )}

      {tab === 'Content' && (
        <div>
          {manage && (
            <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: 14 }}>
              <button className="btn btn-primary btn-sm" onClick={() => setModuleModalOpen(true)}><Plus size={14} /> Add module</button>
            </div>
          )}
          {course.modules?.length === 0 ? (
            <EmptyState message="No content added yet." icon={<Layers />} />
          ) : (
            <div style={{ display: 'grid', gap: 12 }}>
              {enrolled && !manage && course.modules.length > 0 && (
                <div style={{ marginBottom: 4 }}>
                  <div className="flex-between" style={{ marginBottom: 6 }}>
                    <span style={{ fontSize: 12.5, color: 'var(--muted)' }}>Your progress</span>
                    <span style={{ fontSize: 12.5, color: 'var(--muted)' }}>{myEnrollment?.progressPercent || 0}%</span>
                  </div>
                  <div style={{ height: 6, borderRadius: 10, background: 'var(--surface-3)' }}>
                    <div style={{ height: '100%', width: `${myEnrollment?.progressPercent || 0}%`, background: 'linear-gradient(90deg,var(--accent),var(--gold))', borderRadius: 10 }} />
                  </div>
                </div>
              )}
              {course.modules.map((m: any, i: number) => {
                const isDone = myEnrollment?.completedModuleIds?.some((cid: string) => cid === m._id);
                return (
                  <div key={m._id} className="card">
                    <div className="flex-between" style={{ marginBottom: 6 }}>
                      <div style={{ fontSize: 12, color: 'var(--muted-2)' }}>Module {i + 1}</div>
                      {enrolled && !manage && (
                        <button className="btn btn-ghost btn-sm" onClick={() => toggleModuleComplete(m._id)} style={{ color: isDone ? 'var(--success)' : undefined }}>
                          <CheckCircle2 size={13} /> {isDone ? 'Completed' : 'Mark complete'}
                        </button>
                      )}
                    </div>
                    <h4 style={{ fontSize: 15, marginBottom: 8 }}>{m.title}</h4>
                    {m.description && <div style={{ marginBottom: 8 }}><RichTextRenderer content={m.description} /></div>}
                    {m.body && <div style={{ marginBottom: 8 }}><RichTextRenderer content={m.body} /></div>}
                    {m.contentUrl && (
                      <a href={m.contentUrl} target="_blank" rel="noopener noreferrer" style={{ fontSize: 12.5, color: 'var(--accent)', display: 'inline-flex', alignItems: 'center', gap: 5 }}>
                        <ExternalLink size={12} /> Open resource
                      </a>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}

      {tab === 'Assignments' && (
        <div>
          {manage && (
            <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: 14 }}>
              <button className="btn btn-primary btn-sm" onClick={() => setAssignmentModalOpen(true)}><Plus size={14} /> New assignment</button>
            </div>
          )}
          {course.assignments?.length === 0 ? (
            <EmptyState message="No assignments yet." icon={<FileText />} />
          ) : (
            <div style={{ display: 'grid', gap: 12 }}>
              {course.assignments.map((a: any) => (
                <div key={a._id} className="card">
                  <div className="flex-between" style={{ marginBottom: 8 }}>
                    <strong style={{ fontSize: 14.5 }}>{a.title}</strong>
                    {a.dueDate && <span style={{ fontSize: 12, color: 'var(--muted)', display: 'flex', alignItems: 'center', gap: 5 }}><Clock size={12} /> Due {new Date(a.dueDate).toLocaleDateString()}</span>}
                  </div>
                  {a.description && <div style={{ marginBottom: 12 }}><RichTextRenderer content={a.description} /></div>}
                  {a.resourceUrls?.length > 0 && (
                    <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', marginBottom: 12 }}>
                      {a.resourceUrls.map((f: any, i: number) => (
                        <a key={i} href={f.url} target="_blank" rel="noopener noreferrer" style={{ fontSize: 12, color: 'var(--accent)', display: 'flex', alignItems: 'center', gap: 4 }}>
                          <ExternalLink size={11} /> {f.name}
                        </a>
                      ))}
                    </div>
                  )}
                  <div style={{ display: 'flex', gap: 10 }}>
                    {enrolled && !manage && (
                      <button className="btn btn-ghost btn-sm" onClick={() => setSubmissionModalOpen(a._id)}>Submit</button>
                    )}
                    {manage && (
                      <button className="btn btn-ghost btn-sm" onClick={() => openGrading(a._id)}>View submissions</button>
                    )}
                  </div>

                  {gradingAssignmentId === a._id && (
                    <div style={{ marginTop: 16, borderTop: '1px solid var(--line)', paddingTop: 16, display: 'grid', gap: 12 }}>
                      {submissions.length === 0 && <p style={{ fontSize: 13, color: 'var(--muted)' }}>No submissions yet.</p>}
                      {submissions.map((s) => (
                        <div key={s._id} style={{ background: 'var(--surface-2)', borderRadius: 10, padding: 12 }}>
                          <div className="flex-between" style={{ marginBottom: 6 }}>
                            <strong style={{ fontSize: 13 }}>{s.userId?.name}</strong>
                            <Badge tone={statusTone(s.status)}>{s.status}</Badge>
                          </div>
                          {s.text && <p style={{ fontSize: 13, marginBottom: 6 }}>{s.text}</p>}
                          {s.fileUrls?.map((f: any, fi: number) => (
                            <a key={fi} href={f.url} target="_blank" rel="noopener noreferrer" style={{ fontSize: 12, color: 'var(--accent)', display: 'block' }}>{f.name || 'View attached file'}</a>
                          ))}
                          <div style={{ display: 'flex', gap: 8, marginTop: 10 }}>
                            <input
                              className="input"
                              type="number"
                              placeholder="Score"
                              style={{ width: 90 }}
                              value={gradeDrafts[s._id]?.score ?? ''}
                              onChange={(e) => setGradeDrafts({ ...gradeDrafts, [s._id]: { ...gradeDrafts[s._id], score: e.target.value } })}
                            />
                            <input
                              className="input"
                              placeholder="Feedback"
                              style={{ flex: 1 }}
                              value={gradeDrafts[s._id]?.feedback ?? ''}
                              onChange={(e) => setGradeDrafts({ ...gradeDrafts, [s._id]: { ...gradeDrafts[s._id], feedback: e.target.value } })}
                            />
                            <button className="btn btn-primary btn-sm" onClick={() => saveGrade(s._id)}>Save</button>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {tab === 'Quizzes' && (
        <div>
          {manage && (
            <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: 14 }}>
              <button className="btn btn-primary btn-sm" onClick={() => setQuizModalOpen(true)}><Plus size={14} /> New quiz</button>
            </div>
          )}
          {course.quizzes?.length === 0 ? (
            <EmptyState message="No quizzes yet." icon={<HelpCircle />} />
          ) : (
            <div style={{ display: 'grid', gap: 12 }}>
              {course.quizzes.map((q: any) => (
                <div key={q._id} className="card">
                  <div className="flex-between" style={{ marginBottom: 8 }}>
                    <strong style={{ fontSize: 14.5 }}>{q.title}</strong>
                    {q.dueDate && <span style={{ fontSize: 12, color: 'var(--muted)', display: 'flex', alignItems: 'center', gap: 5 }}><Clock size={12} /> Due {new Date(q.dueDate).toLocaleDateString()}</span>}
                  </div>
                  {q.description && <div style={{ marginBottom: 12 }}><RichTextRenderer content={q.description} /></div>}
                  <div style={{ fontSize: 12, color: 'var(--muted-2)', marginBottom: 10 }}>{q.questions?.length || 0} question{q.questions?.length === 1 ? '' : 's'}</div>
                  {enrolled && <button className="btn btn-ghost btn-sm" onClick={() => openQuiz(q._id)}>Open quiz</button>}
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {tab === 'Discussion' && (
        <div>
          <div className="card" style={{ marginBottom: 16 }}>
            <div style={{ marginBottom: 10 }}>
              <MentionTextarea value={postBody} onChange={setPostBody} placeholder="Ask a question, share an update… type @ to tag someone" rows={3} />
            </div>
            <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'center' }}>
              <select className="input" style={{ width: 'auto' }} value={postVisibility} onChange={(e) => setPostVisibility(e.target.value as any)}>
                <option value="public">Visible to everyone enrolled</option>
                <option value="private">Only me & instructors</option>
                <option value="user">A specific person</option>
                <option value="group">A course group</option>
              </select>
              {postVisibility === 'user' && (
                <select className="input" style={{ width: 'auto' }} value={postTargetUserId} onChange={(e) => setPostTargetUserId(e.target.value)}>
                  <option value="">Choose a person…</option>
                  {enrolledStudents.map((s) => <option key={s._id} value={s._id}>{s.name}</option>)}
                </select>
              )}
              {postVisibility === 'group' && (
                <select className="input" style={{ width: 'auto' }} value={postTargetGroupId} onChange={(e) => setPostTargetGroupId(e.target.value)}>
                  <option value="">Choose a group…</option>
                  {course.courseGroups?.map((g: any) => <option key={g._id} value={g._id}>{g.name}</option>)}
                </select>
              )}
              <button className="btn btn-primary btn-sm" onClick={submitPost} disabled={postingDiscussion || !postBody.trim()} style={{ marginLeft: 'auto' }}>
                {postingDiscussion ? 'Posting…' : 'Post'}
              </button>
            </div>
          </div>

          {posts.length === 0 ? (
            <EmptyState message="No discussion yet — be the first to post." icon={<MessageSquare />} />
          ) : (
            <div style={{ display: 'grid', gap: 14 }}>
              {posts.map((p: any) => (
                <div key={p._id} className="card">
                  <div className="flex-between" style={{ marginBottom: 8 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                      <strong style={{ fontSize: 13.5 }}>{p.authorId?.name}</strong>
                      {p.visibility !== 'public' && (
                        <Badge tone="gold">
                          {p.visibility === 'private' ? 'Instructors only' : p.visibility === 'user' ? `To ${p.targetUserId?.name || 'one person'}` : 'Group only'}
                        </Badge>
                      )}
                    </div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                      <span style={{ fontSize: 11.5, color: 'var(--muted-2)' }}>{new Date(p.createdAt).toLocaleString()}</span>
                      {(manage || p.authorId?._id === user?.id) && (
                        <button className="icon-btn" style={{ width: 26, height: 26 }} onClick={() => deletePost(p._id)} aria-label="Delete post"><Trash2 size={12} /></button>
                      )}
                    </div>
                  </div>
                  <p style={{ fontSize: 13.5, marginBottom: 10 }}><MentionText text={p.body} /></p>

                  {p.replies?.length > 0 && (
                    <div style={{ display: 'grid', gap: 10, marginLeft: 20, paddingLeft: 14, borderLeft: '2px solid var(--line)', marginBottom: 10 }}>
                      {p.replies.map((r: any) => (
                        <div key={r._id}>
                          <div className="flex-between" style={{ marginBottom: 4 }}>
                            <strong style={{ fontSize: 12.5 }}>{r.authorId?.name}</strong>
                            <span style={{ fontSize: 11, color: 'var(--muted-2)' }}>{new Date(r.createdAt).toLocaleString()}</span>
                          </div>
                          <p style={{ fontSize: 13 }}><MentionText text={r.body} /></p>
                        </div>
                      ))}
                    </div>
                  )}

                  <div style={{ display: 'flex', gap: 8 }}>
                    <input
                      className="input"
                      placeholder="Reply…"
                      value={replyDrafts[p._id] || ''}
                      onChange={(e) => setReplyDrafts({ ...replyDrafts, [p._id]: e.target.value })}
                      onKeyDown={(e) => e.key === 'Enter' && submitReply(p._id)}
                    />
                    <button className="btn btn-ghost btn-sm" onClick={() => submitReply(p._id)}>Reply</button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {tab === 'Groups' && (
        <div>
          {manage && (
            <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: 14 }}>
              <button className="btn btn-primary btn-sm" onClick={() => setGroupModalOpen(true)}><Plus size={14} /> New group</button>
            </div>
          )}
          {course.courseGroups?.length === 0 ? (
            <EmptyState message="No group projects set up yet." icon={<Users2 />} />
          ) : (
            <div className="grid-3">
              {course.courseGroups.map((g: any) => (
                <div key={g._id} className="card">
                  <h4 style={{ fontSize: 15, marginBottom: 10 }}>{g.name}</h4>
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                    {(g.memberIds || []).map((m: string) => {
                      const student = enrolledStudents.find((s) => s._id === m);
                      return <Badge key={m} tone="neutral">{student?.name || 'Member'}</Badge>;
                    })}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {tab === 'Students' && manage && (
        <div>
          <div className="card" style={{ marginBottom: 16 }}>
            <div style={{ display: 'flex', gap: 8 }}>
              <select className="input" value={addStudentId} onChange={(e) => setAddStudentId(e.target.value)}>
                <option value="">Choose an employee to enroll…</option>
                {allEmployees
                  .filter((e) => !enrolledStudents.some((s) => s._id === e._id))
                  .map((e) => <option key={e._id} value={e._id}>{e.name} — {e.jobTitle || e.role}</option>)}
              </select>
              <button className="btn btn-primary btn-sm" onClick={addStudent} disabled={addingStudent || !addStudentId} style={{ flexShrink: 0 }}>
                {addingStudent ? 'Adding…' : 'Enroll'}
              </button>
            </div>
          </div>
          {courseEnrollments.length === 0 ? (
            <EmptyState message="No students enrolled yet." icon={<Users2 />} />
          ) : (
            <div className="table-wrap">
              <table className="data-table">
                <thead><tr><th>Student</th><th>Status</th><th>Progress</th><th></th></tr></thead>
                <tbody>
                  {courseEnrollments.map((e: any) => (
                    <tr key={e._id}>
                      <td>{e.userId?.name}</td>
                      <td><Badge tone={statusTone(e.status)}>{e.status.replace('_', ' ')}</Badge></td>
                      <td>{e.progressPercent}%</td>
                      <td style={{ width: 40 }}>
                        <button className="icon-btn" style={{ width: 30, height: 30 }} onClick={() => removeStudent(e._id)} aria-label="Remove student"><Trash2 size={13} /></button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {tab === 'Gradebook' && manage && (
        <div>
          {!gradebook ? (
            <Skeleton height={200} />
          ) : gradebook.rows.length === 0 ? (
            <EmptyState message="No students enrolled yet." icon={<FileText />} />
          ) : (
            <div className="table-wrap">
              <table className="data-table">
                <thead>
                  <tr>
                    <th>Student</th>
                    {gradebook.assignments.map((a: any) => <th key={a._id}>{a.title}</th>)}
                    {gradebook.quizzes.map((q: any) => <th key={q._id}>{q.title}</th>)}
                    <th>Progress</th>
                  </tr>
                </thead>
                <tbody>
                  {gradebook.rows.map((row: any) => (
                    <tr key={row.userId}>
                      <td>{row.name}</td>
                      {row.assignmentScores.map((s: any) => (
                        <td key={s.assignmentId}>{s.score !== null ? `${s.score}/${s.maxScore}` : <span style={{ color: 'var(--muted-2)' }}>—</span>}</td>
                      ))}
                      {row.quizScores.map((s: any) => (
                        <td key={s.quizId}>{s.score !== null ? `${s.score}/${s.maxScore}` : <span style={{ color: 'var(--muted-2)' }}>—</span>}</td>
                      ))}
                      <td>{row.progressPercent}%</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {tab === 'Updates' && (
        <div>
          {manage && (
            <div className="card" style={{ marginBottom: 16 }}>
              <div style={{ display: 'flex', gap: 8 }}>
                <input className="input" placeholder="Post an update to everyone enrolled…" value={updateBody} onChange={(e) => setUpdateBody(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && postUpdate()} />
                <button className="btn btn-primary btn-sm" onClick={postUpdate}><Megaphone size={14} /> Post</button>
              </div>
            </div>
          )}
          {course.updates?.length === 0 ? (
            <EmptyState message="No updates posted yet." icon={<Megaphone />} />
          ) : (
            <div style={{ display: 'grid', gap: 12 }}>
              {course.updates.slice().reverse().map((u: any) => (
                <div key={u._id} className="card">
                  <div style={{ marginBottom: 8 }}><RichTextRenderer content={u.body} /></div>
                  <span style={{ fontSize: 11.5, color: 'var(--muted-2)' }}>{new Date(u.createdAt).toLocaleString()}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      <Modal
        open={moduleModalOpen}
        onClose={() => setModuleModalOpen(false)}
        title="Add content module"
        footer={<><button className="btn btn-ghost" onClick={() => setModuleModalOpen(false)}>Cancel</button><button className="btn btn-primary" onClick={addModule} disabled={saving || !moduleForm.title}>{saving ? 'Adding…' : 'Add'}</button></>}
      >
        <div className="form-grid">
          <div className="field full"><label>Module title *</label><input className="input" value={moduleForm.title} onChange={(e) => setModuleForm({ ...moduleForm, title: e.target.value })} /></div>
          <div className="field full"><label>Description</label><input className="input" value={moduleForm.description} onChange={(e) => setModuleForm({ ...moduleForm, description: e.target.value })} /></div>
          <div className="field full"><label>Content (text)</label><RichTextEditor value={moduleForm.body || ''} onChange={(h) => setModuleForm((f: any) => ({ ...f, body: h }))} /></div>
          <div className="field full"><label>Resource link (optional)</label><input className="input" placeholder="Link to a slide deck, video, doc…" value={moduleForm.contentUrl} onChange={(e) => setModuleForm({ ...moduleForm, contentUrl: e.target.value })} /></div>
        </div>
      </Modal>

      <Modal
        open={assignmentModalOpen}
        onClose={() => setAssignmentModalOpen(false)}
        title="New assignment"
        footer={<><button className="btn btn-ghost" onClick={() => setAssignmentModalOpen(false)}>Cancel</button><button className="btn btn-primary" onClick={addAssignment} disabled={saving || !assignmentForm.title}>{saving ? 'Creating…' : 'Create & notify'}</button></>}
      >
        <div className="form-grid">
          <div className="field full"><label>Assignment title *</label><input className="input" value={assignmentForm.title} onChange={(e) => setAssignmentForm({ ...assignmentForm, title: e.target.value })} /></div>
          <div className="field full"><label>Description</label><RichTextEditor value={assignmentForm.description || ''} onChange={(h) => setAssignmentForm((f: any) => ({ ...f, description: h }))} /></div>
          <div className="field"><label>Due date</label><input className="input" type="date" value={assignmentForm.dueDate} onChange={(e) => setAssignmentForm({ ...assignmentForm, dueDate: e.target.value })} /></div>
          <div className="field"><label>Max score</label><input className="input" type="number" value={assignmentForm.maxScore} onChange={(e) => setAssignmentForm({ ...assignmentForm, maxScore: Number(e.target.value) })} /></div>
          <div className="field full">
            <label>Attach resource files (optional — instructions, templates…)</label>
            <input className="input" type="file" multiple onChange={(e) => e.target.files && handleResourceFiles(e.target.files)} disabled={uploadingResource} />
            {uploadingResource && <div style={{ fontSize: 12, color: 'var(--muted)', marginTop: 4 }}>Uploading…</div>}
            {assignmentForm.resourceUrls.length > 0 && (
              <div style={{ marginTop: 6, display: 'grid', gap: 4 }}>
                {assignmentForm.resourceUrls.map((f: any, i: number) => <div key={i} style={{ fontSize: 12, color: 'var(--success)' }}>{f.name} attached</div>)}
              </div>
            )}
          </div>
        </div>
      </Modal>

      <Modal
        open={!!submissionModalOpen}
        onClose={() => setSubmissionModalOpen(null)}
        title="Submit assignment"
        footer={<><button className="btn btn-ghost" onClick={() => setSubmissionModalOpen(null)}>Cancel</button><button className="btn btn-primary" onClick={() => submissionModalOpen && submitAssignment(submissionModalOpen)} disabled={saving || uploadingSubmission}>{saving ? 'Submitting…' : 'Submit'}</button></>}
      >
        <div className="form-grid">
          <div className="field full"><label>Your answer</label><textarea className="input" rows={5} value={submissionForm.text} onChange={(e) => setSubmissionForm({ ...submissionForm, text: e.target.value })} /></div>
          <div className="field full">
            <label>Attach files (optional)</label>
            <input className="input" type="file" multiple onChange={(e) => e.target.files && handleSubmissionFiles(e.target.files)} disabled={uploadingSubmission} />
            {uploadingSubmission && <div style={{ fontSize: 12, color: 'var(--muted)', marginTop: 4 }}>Uploading…</div>}
            {submissionForm.fileUrls.length > 0 && (
              <div style={{ marginTop: 6, display: 'grid', gap: 4 }}>
                {submissionForm.fileUrls.map((f: any, i: number) => (
                  <div key={i} style={{ fontSize: 12, color: 'var(--success)' }}>{f.name} attached</div>
                ))}
              </div>
            )}
          </div>
        </div>
      </Modal>

      <Modal
        open={groupModalOpen}
        onClose={() => setGroupModalOpen(false)}
        title="New group project"
        footer={<><button className="btn btn-ghost" onClick={() => setGroupModalOpen(false)}>Cancel</button><button className="btn btn-primary" onClick={createGroup} disabled={saving || !groupForm.name}>{saving ? 'Creating…' : 'Create group'}</button></>}
      >
        <div className="form-grid">
          <div className="field full"><label>Group name *</label><input className="input" value={groupForm.name} onChange={(e) => setGroupForm({ ...groupForm, name: e.target.value })} /></div>
          <div className="field full">
            <label>Members (from enrolled students)</label>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, maxHeight: 160, overflowY: 'auto', border: '1px solid var(--line-strong)', borderRadius: 10, padding: 10 }}>
              {enrolledStudents.map((s) => (
                <button
                  key={s._id}
                  type="button"
                  onClick={() => toggleGroupMember(s._id)}
                  className="badge"
                  style={{ cursor: 'pointer', border: '1px solid var(--line-strong)', background: groupForm.memberIds.includes(s._id) ? 'var(--accent)' : 'var(--surface-2)', color: groupForm.memberIds.includes(s._id) ? '#fff' : 'var(--text)' }}
                >
                  {s.name}
                </button>
              ))}
              {enrolledStudents.length === 0 && <span style={{ fontSize: 12, color: 'var(--muted-2)' }}>No students enrolled yet.</span>}
            </div>
          </div>
        </div>
      </Modal>

      <Modal
        open={quizModalOpen}
        onClose={() => setQuizModalOpen(false)}
        title="New quiz"
        footer={<><button className="btn btn-ghost" onClick={() => setQuizModalOpen(false)}>Cancel</button><button className="btn btn-primary" onClick={createQuiz} disabled={saving || !quizForm.title || quizForm.questions.length === 0}>{saving ? 'Creating…' : 'Create & notify'}</button></>}
      >
        <div className="form-grid">
          <div className="field full"><label>Quiz title *</label><input className="input" value={quizForm.title} onChange={(e) => setQuizForm({ ...quizForm, title: e.target.value })} /></div>
          <div className="field full"><label>Description</label><RichTextEditor value={quizForm.description || ''} onChange={(h) => setQuizForm((f: any) => ({ ...f, description: h }))} /></div>
          <div className="field full"><label>Due date</label><input className="input" type="date" value={quizForm.dueDate} onChange={(e) => setQuizForm({ ...quizForm, dueDate: e.target.value })} /></div>

          <div className="field full">
            <div className="flex-between" style={{ marginBottom: 10 }}>
              <label style={{ margin: 0 }}>Questions</label>
              <button type="button" className="btn btn-ghost btn-sm" onClick={addQuizQuestion}><Plus size={13} /> Add question</button>
            </div>
            <div style={{ display: 'grid', gap: 14 }}>
              {quizForm.questions.map((q: any, qi: number) => (
                <div key={qi} style={{ background: 'var(--surface-2)', borderRadius: 10, padding: 12 }}>
                  <div style={{ display: 'flex', gap: 8, marginBottom: 8 }}>
                    <input className="input" placeholder={`Question ${qi + 1}`} value={q.text} onChange={(e) => updateQuizQuestion(qi, { text: e.target.value })} />
                    <button type="button" className="icon-btn" style={{ width: 36, height: 36, flexShrink: 0 }} onClick={() => removeQuizQuestion(qi)} aria-label="Remove question"><X size={13} /></button>
                  </div>
                  <div style={{ display: 'grid', gap: 6, marginBottom: 8 }}>
                    {q.options.map((opt: string, oi: number) => (
                      <div key={oi} style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                        <input type="radio" checked={q.correctIndex === oi} onChange={() => updateQuizQuestion(qi, { correctIndex: oi })} />
                        <input className="input" placeholder={`Option ${oi + 1}`} value={opt} onChange={(e) => updateQuizOption(qi, oi, e.target.value)} style={{ flex: 1 }} />
                      </div>
                    ))}
                  </div>
                  <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                    <button type="button" className="btn btn-ghost btn-sm" onClick={() => addQuizOption(qi)}>+ Option</button>
                    <span style={{ fontSize: 11.5, color: 'var(--muted-2)' }}>Select the radio button next to the correct answer</span>
                  </div>
                </div>
              ))}
              {quizForm.questions.length === 0 && <p style={{ fontSize: 12.5, color: 'var(--muted-2)' }}>Add at least one question.</p>}
            </div>
          </div>
        </div>
      </Modal>

      <Modal
        open={!!takingQuizId}
        onClose={() => { setTakingQuizId(null); setQuizTaking(null); }}
        title={quizTaking?.quiz?.title || 'Quiz'}
        footer={
          !quizTaking?.attempt ? (
            <>
              <button className="btn btn-ghost" onClick={() => { setTakingQuizId(null); setQuizTaking(null); }}>Cancel</button>
              <button className="btn btn-primary" onClick={submitQuiz} disabled={submittingQuiz || quizAnswers.some((a) => a === -1)}>{submittingQuiz ? 'Submitting…' : 'Submit quiz'}</button>
            </>
          ) : (
            <button className="btn btn-primary" onClick={() => { setTakingQuizId(null); setQuizTaking(null); }}>Close</button>
          )
        }
      >
        {quizTaking && (
          <div style={{ display: 'grid', gap: 16 }}>
            {quizTaking.attempt && (
              <div className="card" style={{ borderColor: 'var(--accent)' }}>
                <strong style={{ fontSize: 15 }}>Your score: {quizTaking.attempt.score} / {quizTaking.attempt.maxScore}</strong>
              </div>
            )}
            {quizTaking.quiz.questions.map((q: any, qi: number) => (
              <div key={qi}>
                <p style={{ fontSize: 13.5, fontWeight: 600, marginBottom: 8 }}>{qi + 1}. {q.text}</p>
                <div style={{ display: 'grid', gap: 6 }}>
                  {q.options.map((opt: string, oi: number) => {
                    const isMine = quizTaking.attempt?.answers?.[qi] === oi;
                    const isCorrect = quizTaking.attempt && q.correctIndex === oi;
                    return (
                      <label key={oi} style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, color: quizTaking.attempt ? (isCorrect ? 'var(--success)' : isMine ? 'var(--danger)' : 'var(--text)') : 'var(--text)' }}>
                        {quizTaking.attempt ? (
                          <span style={{ width: 14 }}>{isMine ? '●' : ''}</span>
                        ) : (
                          <input
                            type="radio"
                            checked={quizAnswers[qi] === oi}
                            onChange={() => setQuizAnswers((prev) => prev.map((v, i) => (i === qi ? oi : v)))}
                          />
                        )}
                        {opt}
                      </label>
                    );
                  })}
                </div>
              </div>
            ))}
          </div>
        )}
      </Modal>
    </div>
  );
}
