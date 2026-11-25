import { Router } from 'express';
import { requireAuth } from '../middleware/auth';
import { requireModule } from '../middleware/modules';
import { asyncHandler } from '../utils/asyncHandler';
import { ApiError } from '../utils/ApiError';
import { loadScope } from '../services/work.access';
import { myReport, ReportPeriod, workSummary } from '../services/workReports.service';
import { parseQuarter } from '../utils/quarter';
import { Project } from '../models/Project';
import { Task } from '../models/Task';
import { excludeDeleted } from '../utils/softDeletePlugin';

const router = Router();
router.use(requireAuth);

const ID = /^[a-f\d]{24}$/i;

router.get('/summary', requireModule('work_reports'), asyncHandler(async (req, res) => {
  const q = req.query as Record<string, string>;
  if (q.quarter && !parseQuarter(q.quarter)) throw ApiError.badRequest('Quarter must look like 2026-Q4');
  if (q.projectId && !ID.test(q.projectId)) throw ApiError.badRequest('Invalid project');
  if (q.ownerId && !ID.test(q.ownerId)) throw ApiError.badRequest('Invalid person');
  const scope = await loadScope({ id: req.user!.id, role: req.user!.role, organizationId: req.user!.organizationId });
  const data = await workSummary(req.user!.organizationId, { quarter: q.quarter, from: q.from, to: q.to, projectId: q.projectId, ownerId: q.ownerId }, scope);
  res.json({ success: true, data });
}));

/** My own tasks and projects over a period I choose (daily, weekly, monthly, quarterly, or from a date). Needs no module: it only ever shows the signed-in person's own work. */
router.get('/mine', asyncHandler(async (req, res) => {
  const q = req.query as Record<string, string>;
  const period = (['daily', 'weekly', 'monthly', 'quarterly', 'custom'].includes(q.period) ? q.period : 'weekly') as ReportPeriod;
  try { res.json({ success: true, data: await myReport(req.user!.organizationId, req.user!.id, period, q.from, q.to) }); }
  catch (e: any) { if (/date/i.test(String(e?.message))) throw ApiError.badRequest(e.message); throw e; }
}));

/** Everything waiting on me to approve — used by the Tasks page banner and the sidebar badge. */
router.get('/my-approvals', asyncHandler(async (req, res) => {
  const tasks = await Task.find(excludeDeleted({ organizationId: req.user!.organizationId, status: 'to_be_reviewed', $or: [{ approverId: req.user!.id }, { reviewerId: req.user!.id }] })).select('title ownerId projectId severity approval').populate('ownerId', 'name').populate('projectId', 'name').sort('approval.submittedAt');
  const projects = await Project.find(excludeDeleted({ organizationId: req.user!.organizationId, 'milestones.status': 'awaiting_approval', 'milestones.approverId': req.user!.id })).select('name milestones');
  const milestones = projects.flatMap((p: any) => p.milestones.filter((m: any) => m.status === 'awaiting_approval' && String(m.approverId) === req.user!.id).map((m: any) => ({ projectId: p._id, project: p.name, milestoneId: m._id, title: m.title, severity: m.severity, submittedAt: m.approval?.submittedAt })));
  res.json({ success: true, data: { tasks, milestones, count: tasks.length + milestones.length } });
}));

export default router;
