import { Router } from 'express';
import { requireAuth } from '../middleware/auth';
import { requireRole } from '../middleware/rbac';
import { getHub, createAnnouncement, updateAnnouncement, deleteAnnouncement, reactAnnouncement, commentAnnouncement, createRecognition } from '../controllers/hub.controller';

const router = Router();
router.use(requireAuth);

router.get('/', getHub);
router.post('/announcements/:id/react', reactAnnouncement);
router.post('/announcements/:id/comments', commentAnnouncement);
router.post('/recognitions', requireRole('super_admin', 'ceo', 'coo', 'finance', 'hr', 'sales', 'project_manager', 'engineer', 'employee'), createRecognition);
router.post('/announcements', requireRole('hr', 'coo', 'ceo'), createAnnouncement);
router.patch('/announcements/:id', requireRole('hr', 'coo', 'ceo'), updateAnnouncement);
router.delete('/announcements/:id', requireRole('hr', 'coo', 'ceo'), deleteAnnouncement);

export default router;
