import { Router } from 'express';
import { requireAuth } from '../middleware/auth';
import { asyncHandler } from '../utils/asyncHandler';
import { ApiError } from '../utils/ApiError';
import { remindersFor, runRemindersForOrg } from '../services/reminders.service';
import { audit } from '../services/audit.service';

const router = Router();
router.use(requireAuth);

/** Everything that needs this person's attention right now. */
router.get('/', asyncHandler(async (req, res) => {
  const data = await remindersFor({ id: req.user!.id, organizationId: req.user!.organizationId, role: req.user!.role, modules: req.user!.modules || [] });
  res.json({ success: true, data });
}));

/** Admin-only manual trigger (the same job runs every morning). */
router.post('/run', asyncHandler(async (req, res) => {
  if (!['super_admin', 'ceo'].includes(req.user!.role)) throw ApiError.forbidden('Only the CEO or an administrator can run the reminder engine manually.');
  const sent = await runRemindersForOrg(req.user!.organizationId);
  await audit(req, 'reminders.run_manual', 'Reminder', undefined, { module: 'reminders', summary: `${sent} notification(s) sent` });
  res.json({ success: true, data: { sent } });
}));

export default router;
