import { Router } from 'express';
import { requireAuth } from '../middleware/auth';
import { asyncHandler } from '../utils/asyncHandler';
import { ApiError } from '../utils/ApiError';
import { Notification } from '../models/Notification';

const router = Router();
router.use(requireAuth);

router.get(
  '/',
  asyncHandler(async (req, res) => {
    const notifications = await Notification.find({ organizationId: req.user!.organizationId, userId: req.user!.id }).sort('-createdAt').limit(50);
    const unreadCount = await Notification.countDocuments({ organizationId: req.user!.organizationId, userId: req.user!.id, isRead: false });
    res.json({ success: true, data: notifications, unreadCount });
  })
);

router.patch(
  '/:id/read',
  asyncHandler(async (req, res) => {
    const notification = await Notification.findOneAndUpdate(
      { _id: req.params.id, userId: req.user!.id, organizationId: req.user!.organizationId },
      { isRead: true },
      { new: true }
    );
    if (!notification) throw ApiError.notFound('Notification not found');
    res.json({ success: true, data: notification });
  })
);

router.post(
  '/read-all',
  asyncHandler(async (req, res) => {
    await Notification.updateMany({ organizationId: req.user!.organizationId, userId: req.user!.id, isRead: false }, { isRead: true });
    res.json({ success: true, data: { updated: true } });
  })
);

export default router;
