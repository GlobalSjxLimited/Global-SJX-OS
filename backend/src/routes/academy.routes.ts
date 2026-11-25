import { Router } from 'express';
import { asyncHandler } from '../utils/asyncHandler';
import { ApiError } from '../utils/ApiError';
import { attachUserIfPresent, requireAuth } from '../middleware/auth';
import { Course } from '../models/Course';
import { Enrollment } from '../models/Enrollment';
import { Organization } from '../models/Organization';

const router = Router();

/**
 * Public course landing page — deliberately NOT behind requireAuth, since the
 * whole point is a link an admin can share with someone outside the company.
 * Only returns courses that are explicitly marked isPublicOnAcademy and
 * published; nothing else about the organization is exposed.
 */
router.get(
  '/public/:id',
  attachUserIfPresent,
  asyncHandler(async (req, res) => {
    const course = await Course.findOne({ _id: req.params.id, isPublicOnAcademy: true, status: 'published' });
    if (!course) throw ApiError.notFound('This course is not available for public viewing.');

    const [org, enrolledCount] = await Promise.all([
      Organization.findById(course.organizationId).select('name logoUrl'),
      Enrollment.countDocuments({ courseId: course._id, status: { $in: ['enrolled', 'in_progress', 'completed'] } }),
    ]);

    res.json({
      success: true,
      data: {
        course,
        organization: org ? { name: org.name, logoUrl: org.logoUrl } : null,
        enrolledCount,
        seatsRemaining: course.maxStudents ? Math.max(course.maxStudents - enrolledCount, 0) : null,
      },
    });
  })
);

router.get(
  '/courses/:id/stats',
  requireAuth,
  asyncHandler(async (req, res) => {
    const course = await Course.findOne({ _id: req.params.id, organizationId: req.user!.organizationId });
    if (!course) throw ApiError.notFound('Course not found');
    const enrolledCount = await Enrollment.countDocuments({ courseId: course._id, status: { $in: ['enrolled', 'in_progress', 'completed'] } });
    res.json({ success: true, data: { enrolledCount, seatsRemaining: course.maxStudents ? Math.max(course.maxStudents - enrolledCount, 0) : null } });
  })
);

export default router;
