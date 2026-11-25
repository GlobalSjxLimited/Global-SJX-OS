import { Router } from 'express';
import { requireAuth } from '../middleware/auth';
import { ask, meetingNotesToTasks, riskFromOverdueMilestones } from '../controllers/ai.controller';

const router = Router();
router.use(requireAuth);

router.post('/ask', ask);
router.post('/meetings/:meetingId/convert-to-tasks', meetingNotesToTasks);
router.post('/automation/overdue-milestone-risks', riskFromOverdueMilestones);

export default router;
