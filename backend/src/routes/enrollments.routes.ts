import { Router } from 'express';
import { requireAuth } from '../middleware/auth';
import { requireRole } from '../middleware/rbac';
import { asyncHandler } from '../utils/asyncHandler';
import { ApiError } from '../utils/ApiError';
import { Enrollment } from '../models/Enrollment';
import { Course } from '../models/Course';
import { excludeDeleted } from '../utils/softDeletePlugin';

const router = Router();
router.use(requireAuth);

router.get(
  '/',
  asyncHandler(async (req, res) => {
    const { courseId, userId, status } = req.query as Record<string, string>;
    let filter: Record<string, unknown> = { organizationId: req.user!.organizationId };
    if (courseId) filter.courseId = courseId;
    if (userId) filter.userId = userId;
    if (status) filter.status = status;
    filter = excludeDeleted(filter);
    const enrollments = await Enrollment.find(filter).populate('courseId').populate('userId', 'name avatarUrl');
    res.json({ success: true, data: enrollments });
  })
);

router.get(
  '/:id',
  asyncHandler(async (req, res) => {
    const enrollment = await Enrollment.findOne(excludeDeleted({ _id: req.params.id, organizationId: req.user!.organizationId })).populate('courseId').populate('userId', 'name avatarUrl');
    if (!enrollment) throw ApiError.notFound('Enrollment not found');
    res.json({ success: true, data: enrollment });
  })
);

router.post(
  '/',
  asyncHandler(async (req, res) => {
    // Anyone can enroll themselves (userId defaults to the requester); enrolling
    // someone else requires HR/COO/CEO — matches the same authoring group that
    // manages courses in the first place.
    const targetUserId = req.body.userId || req.user!.id;
    if (targetUserId !== req.user!.id && !['hr', 'coo', 'ceo', 'super_admin'].includes(req.user!.role)) {
      throw ApiError.forbidden('You can only enroll yourself in a course.');
    }

    const course = await Course.findOne(excludeDeleted({ _id: req.body.courseId, organizationId: req.user!.organizationId }));
    if (!course) throw ApiError.notFound('Course not found');

    if (course.maxStudents) {
      const currentCount = await Enrollment.countDocuments(excludeDeleted({ courseId: course._id, status: { $in: ['enrolled', 'in_progress', 'completed'] } }));
      if (currentCount >= course.maxStudents) throw ApiError.conflict('This course is at capacity.');
    }

    const existing = await Enrollment.findOne(excludeDeleted({ courseId: course._id, userId: targetUserId }));
    if (existing) throw ApiError.conflict('Already enrolled in this course.');

    const enrollment = await Enrollment.create({
      organizationId: req.user!.organizationId,
      courseId: course._id,
      userId: targetUserId,
      status: 'enrolled',
      startedAt: new Date(),
    });
    res.status(201).json({ success: true, data: enrollment });
  })
);

router.patch(
  '/:id',
  asyncHandler(async (req, res) => {
    const enrollment = await Enrollment.findOne(excludeDeleted({ _id: req.params.id, organizationId: req.user!.organizationId }));
    if (!enrollment) throw ApiError.notFound('Enrollment not found');
    // Students can update their own progress; only admins can touch someone else's record.
    if (String(enrollment.userId) !== req.user!.id && !['hr', 'coo', 'ceo', 'super_admin'].includes(req.user!.role)) {
      throw ApiError.forbidden('You can only update your own enrollment.');
    }
    Object.assign(enrollment, req.body);
    if (req.body.status === 'completed' && !enrollment.completedAt) enrollment.completedAt = new Date();
    await enrollment.save();
    res.json({ success: true, data: enrollment });
  })
);

router.delete(
  '/:id',
  requireRole('hr', 'coo', 'ceo'),
  asyncHandler(async (req, res) => {
    const enrollment = await Enrollment.findOne(excludeDeleted({ _id: req.params.id, organizationId: req.user!.organizationId }));
    if (!enrollment) throw ApiError.notFound('Enrollment not found');
    await (enrollment as any).softDelete(req.user!.id);
    res.json({ success: true, data: { id: req.params.id, softDeleted: true } });
  })
);

export default router;
