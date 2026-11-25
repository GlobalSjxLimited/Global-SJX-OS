import { Router } from 'express';
import { requireAuth } from '../middleware/auth';
import { requireRole } from '../middleware/rbac';
import { asyncHandler } from '../utils/asyncHandler';
import { automationChecks } from '../jobs/automationJobs';

const router = Router();
router.use(requireAuth);

router.post(
  '/run',
  requireRole('super_admin', 'coo', 'ceo'),
  asyncHandler(async (_req, res) => {
    await automationChecks.runAllChecks();
    res.json({ success: true, data: { message: 'Automation checks executed' } });
  })
);

export default router;
