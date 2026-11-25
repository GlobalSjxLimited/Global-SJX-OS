import { Router } from 'express';
import { requireAuth } from '../middleware/auth';
import { requireRole } from '../middleware/rbac';
import { asyncHandler } from '../utils/asyncHandler';
import { ApiError } from '../utils/ApiError';
import { Course } from '../models/Course';
import { Enrollment } from '../models/Enrollment';
import { AssignmentSubmission } from '../models/AssignmentSubmission';
import { QuizAttempt } from '../models/QuizAttempt';
import { CoursePost } from '../models/CoursePost';
import { Notification } from '../models/Notification';
import { excludeDeleted } from '../utils/softDeletePlugin';
import { notifyMentions } from '../utils/mentions';

const router = Router();
router.use(requireAuth);

const manageCourse = requireRole('hr', 'coo', 'ceo');

async function findCourseOr404(courseId: string, orgId: string) {
  const course = await Course.findOne(excludeDeleted({ _id: courseId, organizationId: orgId }));
  if (!course) throw ApiError.notFound('Course not found');
  return course;
}

async function requireEnrolled(courseId: string, userId: string) {
  const enrollment = await Enrollment.findOne(excludeDeleted({ courseId, userId }));
  if (!enrollment) throw ApiError.forbidden('You must be enrolled in this course first.');
  return enrollment;
}

/* ---------------- Modules (content) ---------------- */

router.post(
  '/:courseId/modules',
  manageCourse,
  asyncHandler(async (req, res) => {
    const course = await findCourseOr404(req.params.courseId, req.user!.organizationId);
    course.modules.push(req.body);
    await course.save();
    res.status(201).json({ success: true, data: course.modules[course.modules.length - 1] });
  })
);

router.patch(
  '/:courseId/modules/:moduleId',
  manageCourse,
  asyncHandler(async (req, res) => {
    const course = await findCourseOr404(req.params.courseId, req.user!.organizationId);
    const mod = (course.modules as any).id(req.params.moduleId);
    if (!mod) throw ApiError.notFound('Module not found');
    Object.assign(mod, req.body);
    await course.save();
    res.json({ success: true, data: mod });
  })
);

router.delete(
  '/:courseId/modules/:moduleId',
  manageCourse,
  asyncHandler(async (req, res) => {
    const course = await findCourseOr404(req.params.courseId, req.user!.organizationId);
    (course.modules as any).pull({ _id: req.params.moduleId });
    await course.save();
    res.json({ success: true, data: { id: req.params.moduleId } });
  })
);

/* ---------------- Assignments ---------------- */

router.post(
  '/:courseId/assignments',
  manageCourse,
  asyncHandler(async (req, res) => {
    const course = await findCourseOr404(req.params.courseId, req.user!.organizationId);
    course.assignments.push(req.body);
    await course.save();
    const assignment = course.assignments[course.assignments.length - 1];

    // Notify everyone currently enrolled that a new assignment landed.
    const enrollments = await Enrollment.find(excludeDeleted({ courseId: course._id, status: { $in: ['enrolled', 'in_progress'] } }));
    await Promise.all(
      enrollments.map((e) =>
        Notification.create({
          organizationId: req.user!.organizationId,
          userId: e.userId,
          type: 'training',
          title: `New assignment: ${assignment.title}`,
          body: course.title,
          link: `/training/${course._id}`,
        })
      )
    );

    res.status(201).json({ success: true, data: assignment });
  })
);

router.patch(
  '/:courseId/assignments/:assignmentId',
  manageCourse,
  asyncHandler(async (req, res) => {
    const course = await findCourseOr404(req.params.courseId, req.user!.organizationId);
    const assignment = (course.assignments as any).id(req.params.assignmentId);
    if (!assignment) throw ApiError.notFound('Assignment not found');
    Object.assign(assignment, req.body);
    await course.save();
    res.json({ success: true, data: assignment });
  })
);

router.delete(
  '/:courseId/assignments/:assignmentId',
  manageCourse,
  asyncHandler(async (req, res) => {
    const course = await findCourseOr404(req.params.courseId, req.user!.organizationId);
    (course.assignments as any).pull({ _id: req.params.assignmentId });
    await course.save();
    res.json({ success: true, data: { id: req.params.assignmentId } });
  })
);

/* ---------------- Updates (course announcement feed) ---------------- */

router.post(
  '/:courseId/updates',
  manageCourse,
  asyncHandler(async (req, res) => {
    const course = await findCourseOr404(req.params.courseId, req.user!.organizationId);
    course.updates.push({ authorId: req.user!.id, body: req.body.body } as any);
    await course.save();
    const update = course.updates[course.updates.length - 1];

    const enrollments = await Enrollment.find(excludeDeleted({ courseId: course._id, status: { $in: ['enrolled', 'in_progress'] } }));
    await Promise.all(
      enrollments.map((e) =>
        Notification.create({
          organizationId: req.user!.organizationId,
          userId: e.userId,
          type: 'training',
          title: `Update posted: ${course.title}`,
          body: req.body.body,
          link: `/training/${course._id}`,
        })
      )
    );

    res.status(201).json({ success: true, data: update });
  })
);

router.delete(
  '/:courseId/updates/:updateId',
  manageCourse,
  asyncHandler(async (req, res) => {
    const course = await findCourseOr404(req.params.courseId, req.user!.organizationId);
    (course.updates as any).pull({ _id: req.params.updateId });
    await course.save();
    res.json({ success: true, data: { id: req.params.updateId } });
  })
);

/* ---------------- Course groups (group projects) ---------------- */

router.post(
  '/:courseId/groups',
  manageCourse,
  asyncHandler(async (req, res) => {
    const course = await findCourseOr404(req.params.courseId, req.user!.organizationId);
    course.courseGroups.push(req.body);
    await course.save();
    res.status(201).json({ success: true, data: course.courseGroups[course.courseGroups.length - 1] });
  })
);

router.patch(
  '/:courseId/groups/:groupId',
  manageCourse,
  asyncHandler(async (req, res) => {
    const course = await findCourseOr404(req.params.courseId, req.user!.organizationId);
    const group = (course.courseGroups as any).id(req.params.groupId);
    if (!group) throw ApiError.notFound('Course group not found');
    Object.assign(group, req.body);
    await course.save();
    res.json({ success: true, data: group });
  })
);

router.delete(
  '/:courseId/groups/:groupId',
  manageCourse,
  asyncHandler(async (req, res) => {
    const course = await findCourseOr404(req.params.courseId, req.user!.organizationId);
    (course.courseGroups as any).pull({ _id: req.params.groupId });
    await course.save();
    res.json({ success: true, data: { id: req.params.groupId } });
  })
);

/* ---------------- Assignment submissions & grading ---------------- */

router.get(
  '/:courseId/assignments/:assignmentId/submissions',
  asyncHandler(async (req, res) => {
    const isManager = ['hr', 'coo', 'ceo', 'super_admin'].includes(req.user!.role);
    const filter: Record<string, unknown> = excludeDeleted({
      organizationId: req.user!.organizationId,
      courseId: req.params.courseId,
      assignmentId: req.params.assignmentId,
    });
    if (!isManager) filter.userId = req.user!.id;
    const submissions = await AssignmentSubmission.find(filter).populate('userId', 'name avatarUrl').sort('-submittedAt');
    res.json({ success: true, data: submissions });
  })
);

router.post(
  '/:courseId/assignments/:assignmentId/submissions',
  asyncHandler(async (req, res) => {
    await requireEnrolled(req.params.courseId, req.user!.id);
    const course = await findCourseOr404(req.params.courseId, req.user!.organizationId);
    const assignment = (course.assignments as any).id(req.params.assignmentId);
    if (!assignment) throw ApiError.notFound('Assignment not found');

    const existing = await AssignmentSubmission.findOne(
      excludeDeleted({ courseId: course._id, assignmentId: assignment._id, userId: req.user!.id })
    );
    if (existing) {
      if (existing.status === 'graded') throw ApiError.conflict('This assignment has already been graded and can no longer be resubmitted.');
      existing.text = req.body.text;
      existing.fileUrls = req.body.fileUrls;
      existing.submittedAt = new Date();
      await existing.save();
      return res.json({ success: true, data: existing });
    }

    const submission = await AssignmentSubmission.create({
      organizationId: req.user!.organizationId,
      courseId: course._id,
      assignmentId: assignment._id,
      userId: req.user!.id,
      courseGroupId: req.body.courseGroupId,
      text: req.body.text,
      fileUrls: req.body.fileUrls,
    });
    res.status(201).json({ success: true, data: submission });
  })
);

router.patch(
  '/submissions/:id/grade',
  manageCourse,
  asyncHandler(async (req, res) => {
    const submission = await AssignmentSubmission.findOne(excludeDeleted({ _id: req.params.id, organizationId: req.user!.organizationId }));
    if (!submission) throw ApiError.notFound('Submission not found');
    submission.score = req.body.score;
    submission.feedback = req.body.feedback;
    submission.status = 'graded';
    submission.gradedById = req.user!.id as any;
    submission.gradedAt = new Date();
    await submission.save();

    await Notification.create({
      organizationId: req.user!.organizationId,
      userId: submission.userId,
      type: 'training',
      title: 'Your assignment was graded',
      body: req.body.feedback ? req.body.feedback.slice(0, 120) : `Score: ${req.body.score}`,
      link: `/training`,
    });

    res.json({ success: true, data: submission });
  })
);

/* ---------------- Discussion posts (visibility-aware) ---------------- */

async function isCourseManagerOrOwner(course: any, req: any): Promise<boolean> {
  return ['hr', 'coo', 'ceo', 'super_admin'].includes(req.user.role) || String(course.createdById) === req.user.id;
}

/** Whether `viewerId` can see `post`, given they are (or aren't) enrolled and may or may not be a course manager. */
function canSeePost(post: any, viewerId: string, isManager: boolean, myGroupIds: Set<string>): boolean {
  if (isManager) return true;
  if (String(post.authorId) === viewerId) return true;
  switch (post.visibility) {
    case 'public':
      return true;
    case 'private':
      return false; // only author + managers, both already handled above
    case 'user':
      return String(post.targetUserId) === viewerId;
    case 'group':
      return post.targetCourseGroupId ? myGroupIds.has(String(post.targetCourseGroupId)) : false;
    default:
      return false;
  }
}

router.get(
  '/:courseId/posts',
  asyncHandler(async (req, res) => {
    const course = await findCourseOr404(req.params.courseId, req.user!.organizationId);
    const isManager = await isCourseManagerOrOwner(course, req);

    if (!isManager) {
      await requireEnrolled(req.params.courseId, req.user!.id);
    }

    const myGroupIds = new Set(
      (course.courseGroups as any[])
        .filter((g: any) => (g.memberIds || []).some((m: any) => String(m) === req.user!.id))
        .map((g: any) => String(g._id))
    );

    const allPosts = await CoursePost.find(excludeDeleted({ organizationId: req.user!.organizationId, courseId: course._id }))
      .populate('authorId', 'name avatarUrl')
      .populate('targetUserId', 'name')
      .sort('createdAt');

    const visible = allPosts.filter((p) => canSeePost(p, req.user!.id, isManager, myGroupIds));

    // Nest replies under their parent for the frontend to render as a thread.
    const topLevel = visible.filter((p) => !p.parentPostId);
    const repliesByParent = new Map<string, any[]>();
    visible
      .filter((p) => p.parentPostId)
      .forEach((r) => {
        const key = String(r.parentPostId);
        if (!repliesByParent.has(key)) repliesByParent.set(key, []);
        repliesByParent.get(key)!.push(r);
      });

    const threaded = topLevel.map((p) => ({ ...p.toObject(), replies: repliesByParent.get(String(p._id)) || [] }));

    res.json({ success: true, data: threaded });
  })
);

router.post(
  '/:courseId/posts',
  asyncHandler(async (req, res) => {
    const course = await findCourseOr404(req.params.courseId, req.user!.organizationId);
    const isManager = await isCourseManagerOrOwner(course, req);
    if (!isManager) await requireEnrolled(req.params.courseId, req.user!.id);

    const { body, visibility = 'public', targetUserId, targetCourseGroupId } = req.body;
    if (visibility === 'user' && !targetUserId) throw ApiError.badRequest('targetUserId is required for user-visibility posts');
    if (visibility === 'group' && !targetCourseGroupId) throw ApiError.badRequest('targetCourseGroupId is required for group-visibility posts');

    const post = await CoursePost.create({
      organizationId: req.user!.organizationId,
      courseId: course._id,
      authorId: req.user!.id,
      body,
      visibility,
      targetUserId: visibility === 'user' ? targetUserId : undefined,
      targetCourseGroupId: visibility === 'group' ? targetCourseGroupId : undefined,
    });

    await notifyMentions({
      text: body,
      organizationId: req.user!.organizationId,
      actorId: req.user!.id,
      actorName: req.user!.name,
      title: `${req.user!.name} mentioned you in ${course.title}`,
      link: `/training/${course._id}`,
    });

    // A direct message to one person (visibility: 'user') gets a notification
    // even without an @mention — that's the whole point of targeting them.
    if (visibility === 'user' && targetUserId && targetUserId !== req.user!.id) {
      await Notification.create({
        organizationId: req.user!.organizationId,
        userId: targetUserId,
        type: 'training',
        title: `${req.user!.name} posted something just for you in ${course.title}`,
        body: body.slice(0, 140),
        link: `/training/${course._id}`,
      });
    }

    const populated = await post.populate('authorId', 'name avatarUrl');
    res.status(201).json({ success: true, data: { ...populated.toObject(), replies: [] } });
  })
);

router.post(
  '/:courseId/posts/:postId/replies',
  asyncHandler(async (req, res) => {
    const course = await findCourseOr404(req.params.courseId, req.user!.organizationId);
    const isManager = await isCourseManagerOrOwner(course, req);
    if (!isManager) await requireEnrolled(req.params.courseId, req.user!.id);

    const parent = await CoursePost.findOne(excludeDeleted({ _id: req.params.postId, courseId: course._id }));
    if (!parent) throw ApiError.notFound('Post not found');

    const reply = await CoursePost.create({
      organizationId: req.user!.organizationId,
      courseId: course._id,
      authorId: req.user!.id,
      body: req.body.body,
      parentPostId: parent._id,
      visibility: parent.visibility,
      targetUserId: parent.targetUserId,
      targetCourseGroupId: parent.targetCourseGroupId,
    });

    await notifyMentions({
      text: req.body.body,
      organizationId: req.user!.organizationId,
      actorId: req.user!.id,
      actorName: req.user!.name,
      title: `${req.user!.name} mentioned you in ${course.title}`,
      link: `/training/${course._id}`,
    });

    if (String(parent.authorId) !== req.user!.id) {
      await Notification.create({
        organizationId: req.user!.organizationId,
        userId: parent.authorId,
        type: 'training',
        title: `${req.user!.name} replied to your post in ${course.title}`,
        body: req.body.body.slice(0, 140),
        link: `/training/${course._id}`,
      });
    }

    const populated = await reply.populate('authorId', 'name avatarUrl');
    res.status(201).json({ success: true, data: populated });
  })
);

router.delete(
  '/:courseId/posts/:postId',
  asyncHandler(async (req, res) => {
    const course = await findCourseOr404(req.params.courseId, req.user!.organizationId);
    const post = await CoursePost.findOne(excludeDeleted({ _id: req.params.postId, courseId: course._id }));
    if (!post) throw ApiError.notFound('Post not found');
    const isManager = await isCourseManagerOrOwner(course, req);
    if (!isManager && String(post.authorId) !== req.user!.id) throw ApiError.forbidden('You can only delete your own posts.');
    await (post as any).softDelete(req.user!.id);
    res.json({ success: true, data: { id: req.params.postId, softDeleted: true } });
  })
);

/* ---------------- Quizzes ---------------- */

router.post(
  '/:courseId/quizzes',
  manageCourse,
  asyncHandler(async (req, res) => {
    const course = await findCourseOr404(req.params.courseId, req.user!.organizationId);
    course.quizzes.push(req.body);
    await course.save();
    const quiz = course.quizzes[course.quizzes.length - 1];

    const enrollments = await Enrollment.find(excludeDeleted({ courseId: course._id, status: { $in: ['enrolled', 'in_progress'] } }));
    await Promise.all(
      enrollments.map((e) =>
        Notification.create({
          organizationId: req.user!.organizationId,
          userId: e.userId,
          type: 'training',
          title: `New quiz: ${quiz.title}`,
          body: course.title,
          link: `/training/${course._id}`,
        })
      )
    );

    res.status(201).json({ success: true, data: quiz });
  })
);

router.patch(
  '/:courseId/quizzes/:quizId',
  manageCourse,
  asyncHandler(async (req, res) => {
    const course = await findCourseOr404(req.params.courseId, req.user!.organizationId);
    const quiz = (course.quizzes as any).id(req.params.quizId);
    if (!quiz) throw ApiError.notFound('Quiz not found');
    Object.assign(quiz, req.body);
    await course.save();
    res.json({ success: true, data: quiz });
  })
);

router.delete(
  '/:courseId/quizzes/:quizId',
  manageCourse,
  asyncHandler(async (req, res) => {
    const course = await findCourseOr404(req.params.courseId, req.user!.organizationId);
    (course.quizzes as any).pull({ _id: req.params.quizId });
    await course.save();
    res.json({ success: true, data: { id: req.params.quizId } });
  })
);

/** GET a quiz for taking it — strips correctIndex unless the requester is a manager or has already attempted it (so results can show what was right). */
router.get(
  '/:courseId/quizzes/:quizId',
  asyncHandler(async (req, res) => {
    const course = await findCourseOr404(req.params.courseId, req.user!.organizationId);
    const quiz = (course.quizzes as any).id(req.params.quizId);
    if (!quiz) throw ApiError.notFound('Quiz not found');
    const isManager = await isCourseManagerOrOwner(course, req);

    const existingAttempt = await QuizAttempt.findOne(excludeDeleted({ courseId: course._id, quizId: quiz._id, userId: req.user!.id }));

    if (isManager || existingAttempt) {
      return res.json({ success: true, data: { quiz, attempt: existingAttempt } });
    }

    const sanitized = { ...quiz.toObject(), questions: quiz.questions.map((q: any) => ({ text: q.text, options: q.options, points: q.points })) };
    res.json({ success: true, data: { quiz: sanitized, attempt: null } });
  })
);

router.post(
  '/:courseId/quizzes/:quizId/attempts',
  asyncHandler(async (req, res) => {
    await requireEnrolled(req.params.courseId, req.user!.id);
    const course = await findCourseOr404(req.params.courseId, req.user!.organizationId);
    const quiz = (course.quizzes as any).id(req.params.quizId);
    if (!quiz) throw ApiError.notFound('Quiz not found');

    const existing = await QuizAttempt.findOne(excludeDeleted({ courseId: course._id, quizId: quiz._id, userId: req.user!.id }));
    if (existing) throw ApiError.conflict('You have already attempted this quiz.');

    const answers: number[] = req.body.answers || [];
    let score = 0;
    let maxScore = 0;
    quiz.questions.forEach((q: any, i: number) => {
      maxScore += q.points;
      if (answers[i] === q.correctIndex) score += q.points;
    });

    const attempt = await QuizAttempt.create({
      organizationId: req.user!.organizationId,
      courseId: course._id,
      quizId: quiz._id,
      userId: req.user!.id,
      answers,
      score,
      maxScore,
    });

    res.status(201).json({ success: true, data: attempt });
  })
);

/* ---------------- Gradebook ---------------- */

router.get(
  '/:courseId/gradebook',
  manageCourse,
  asyncHandler(async (req, res) => {
    const course = await findCourseOr404(req.params.courseId, req.user!.organizationId);
    const enrollments = await Enrollment.find(excludeDeleted({ courseId: course._id })).populate('userId', 'name avatarUrl');
    const [submissions, attempts] = await Promise.all([
      AssignmentSubmission.find(excludeDeleted({ courseId: course._id })),
      QuizAttempt.find(excludeDeleted({ courseId: course._id })),
    ]);

    const rows = enrollments.map((e) => {
      const student = e.userId as any;
      const assignmentScores = course.assignments.map((a: any) => {
        const sub = submissions.find((s) => String(s.assignmentId) === String(a._id) && String(s.userId) === String(student._id));
        return { assignmentId: a._id, title: a.title, maxScore: a.maxScore, score: sub?.score ?? null, status: sub?.status ?? 'not_submitted' };
      });
      const quizScores = course.quizzes.map((q: any) => {
        const att = attempts.find((a) => String(a.quizId) === String(q._id) && String(a.userId) === String(student._id));
        return { quizId: q._id, title: q.title, maxScore: att?.maxScore ?? q.questions.reduce((s: number, qq: any) => s + qq.points, 0), score: att?.score ?? null };
      });
      return { userId: student._id, name: student.name, avatarUrl: student.avatarUrl, progressPercent: e.progressPercent, assignmentScores, quizScores };
    });

    res.json({ success: true, data: { assignments: course.assignments, quizzes: course.quizzes, rows } });
  })
);

/* ---------------- Progress tracking ---------------- */

router.post(
  '/:courseId/modules/:moduleId/complete',
  asyncHandler(async (req, res) => {
    const course = await findCourseOr404(req.params.courseId, req.user!.organizationId);
    const mod = (course.modules as any).id(req.params.moduleId);
    if (!mod) throw ApiError.notFound('Module not found');

    const enrollment = await Enrollment.findOne(excludeDeleted({ courseId: course._id, userId: req.user!.id }));
    if (!enrollment) throw ApiError.forbidden('You must be enrolled in this course first.');

    const already = enrollment.completedModuleIds.some((id) => String(id) === req.params.moduleId);
    if (already) {
      enrollment.completedModuleIds = enrollment.completedModuleIds.filter((id) => String(id) !== req.params.moduleId) as any;
    } else {
      enrollment.completedModuleIds.push(req.params.moduleId as any);
    }

    const totalModules = course.modules.length;
    enrollment.progressPercent = totalModules > 0 ? Math.round((enrollment.completedModuleIds.length / totalModules) * 100) : 0;
    if (enrollment.progressPercent === 100) {
      enrollment.status = 'completed';
      enrollment.completedAt = new Date();
    } else if (enrollment.progressPercent > 0) {
      enrollment.status = 'in_progress';
    }
    await enrollment.save();

    res.json({ success: true, data: enrollment });
  })
);

export default router;
