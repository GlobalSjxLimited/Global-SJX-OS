import { Router } from 'express';
import { z } from 'zod';
import { requireAuth } from '../middleware/auth';
import { asyncHandler } from '../utils/asyncHandler';
import { ApiError } from '../utils/ApiError';
import { Risk, RISK_LEVELS } from '../models/Risk';
import { Project } from '../models/Project';
import { Task } from '../models/Task';
import { User } from '../models/User';
import { excludeDeleted } from '../utils/softDeletePlugin';
import { escapeRegex } from '../utils/escapeRegex';
import { audit } from '../services/audit.service';
import { oid } from '../services/work.access';
import { syncMilestoneBlocked, syncTaskBlocked } from '../services/work.service';
import { parseQuarter, rangeFromQuery } from '../utils/quarter';

const router = Router();
router.use(requireAuth);

const blank = (v: unknown) => (v === '' || v === null ? undefined : v);
const oidStr = z.preprocess(blank, z.string().regex(/^[a-f\d]{24}$/i, 'Invalid id').optional());
const dateIn = z.preprocess(blank, z.coerce.date().optional());

const body = z.object({
  title: z.string().trim().min(1, 'Risk title is required').max(300),
  description: z.string().max(10000).optional(),
  kind: z.enum(['risk', 'blocker', 'issue']).optional(),
  category: z.enum(['project', 'financial', 'operational', 'security', 'compliance', 'reputational']).optional(),
  severity: z.enum(RISK_LEVELS).optional(),
  impact: z.enum(RISK_LEVELS).optional(),
  blocking: z.boolean().optional(),
  status: z.enum(['open', 'mitigating', 'closed']).optional(),
  mitigationPlan: z.string().max(20000).optional(),
  ownerId: oidStr,
  relatedProjectId: oidStr,
  relatedMilestoneId: oidStr,
  relatedTaskId: oidStr,
  relatedClientId: oidStr,
  startDate: dateIn,
  endDate: dateIn,
});

const MANAGERS = new Set(['super_admin', 'ceo', 'coo', 'finance', 'project_manager']);
const canWrite = (req: any, r: any) => MANAGERS.has(req.user.role) || [r.ownerId, r.raisedById].some((x) => oid(x) === req.user.id);

async function resolveLinks(orgId: string, d: { relatedProjectId?: string; relatedMilestoneId?: string; relatedTaskId?: string; ownerId?: string }) {
  if (d.ownerId && !(await User.exists({ _id: d.ownerId, organizationId: orgId, isActive: true }))) throw ApiError.badRequest('Risk owner was not found');
  let projectId = d.relatedProjectId;
  if (d.relatedTaskId) {
    const t = await Task.findOne(excludeDeleted({ _id: d.relatedTaskId, organizationId: orgId })).select('projectId milestoneId');
    if (!t) throw ApiError.badRequest('Task not found');
    projectId = projectId || (t.projectId ? String(t.projectId) : undefined);
    d.relatedMilestoneId = d.relatedMilestoneId || (t.milestoneId ? String(t.milestoneId) : undefined);
  }
  if (projectId) {
    const p = await Project.findOne(excludeDeleted({ _id: projectId, organizationId: orgId })).select('milestones');
    if (!p) throw ApiError.badRequest('Project not found');
    if (d.relatedMilestoneId && !p.milestones.id(d.relatedMilestoneId)) throw ApiError.badRequest('That milestone is not part of the project');
  } else if (d.relatedMilestoneId) throw ApiError.badRequest('Choose a project for the milestone');
  return { ...d, relatedProjectId: projectId };
}

router.get('/', asyncHandler(async (req, res) => {
  const q = req.query as Record<string, string>;
  const and: Record<string, unknown>[] = [{ organizationId: req.user!.organizationId }];
  for (const k of ['status', 'kind', 'severity', 'impact', 'category', 'ownerId'] as const) if (q[k]) and.push({ [k]: q[k] });
  if (q.projectId) and.push({ relatedProjectId: q.projectId });
  if (q.taskId) and.push({ relatedTaskId: q.taskId });
  if (q.milestoneId) and.push({ relatedMilestoneId: q.milestoneId });
  if (q.blocking === 'true') and.push({ blocking: true, status: { $ne: 'closed' } });
  if (q.q) and.push({ $or: ['title', 'description'].map((f) => ({ [f]: { $regex: escapeRegex(q.q), $options: 'i' } })) });
  const range = parseQuarter(q.quarter) || rangeFromQuery(q);
  if (range) and.push({ identifiedAt: { $gte: range.from, $lte: range.to } });
  const page = Math.max(parseInt(q.page, 10) || 1, 1);
  const limit = Math.min(Math.max(parseInt(q.limit, 10) || 20, 1), 100);
  const filter = excludeDeleted({ $and: and });
  const [items, total] = await Promise.all([
    Risk.find(filter).populate('ownerId', 'name').populate('relatedProjectId', 'name').populate('relatedTaskId', 'title').sort(q.sort || '-blocking -createdAt').skip((page - 1) * limit).limit(limit),
    Risk.countDocuments(filter),
  ]);
  res.json({ success: true, data: items.map((r) => ({ ...r.toObject(), permissions: { edit: canWrite(req, r), delete: canWrite(req, r), view: true } })), pagination: { page, limit, total, pages: Math.ceil(total / limit) } });
}));

router.get('/:id', asyncHandler(async (req, res) => {
  const r = await Risk.findOne(excludeDeleted({ _id: req.params.id, organizationId: req.user!.organizationId })).populate('ownerId', 'name').populate('raisedById', 'name').populate('relatedProjectId', 'name').populate('relatedTaskId', 'title');
  if (!r) throw ApiError.notFound('Risk not found');
  res.json({ success: true, data: { ...r.toObject(), permissions: { edit: canWrite(req, r), delete: canWrite(req, r), view: true } } });
}));

router.post('/', asyncHandler(async (req, res) => {
  const d = body.parse(req.body);
  const links = await resolveLinks(req.user!.organizationId, d);
  const risk = await Risk.create({ ...d, ...links, blocking: d.blocking || d.kind === 'blocker', organizationId: req.user!.organizationId, raisedById: req.user!.id, ownerId: d.ownerId || req.user!.id });
  await Promise.all([syncTaskBlocked(risk.relatedTaskId), syncMilestoneBlocked(risk.relatedProjectId, risk.relatedMilestoneId)]);
  await audit(req, 'risk.created', 'Risk', String(risk._id), { module: 'risks', summary: `Logged ${risk.kind} "${risk.title}"`, meta: { severity: risk.severity, blocking: risk.blocking } });
  res.status(201).json({ success: true, data: risk });
}));

router.patch('/:id', asyncHandler(async (req, res) => {
  const risk = await Risk.findOne(excludeDeleted({ _id: req.params.id, organizationId: req.user!.organizationId }));
  if (!risk) throw ApiError.notFound('Risk not found');
  if (!canWrite(req, risk)) throw ApiError.forbidden('Only the risk owner, the person who raised it or a manager can change it');
  const d = body.partial().parse(req.body);
  const links = await resolveLinks(req.user!.organizationId, { relatedProjectId: d.relatedProjectId ?? oid(risk.relatedProjectId), relatedMilestoneId: d.relatedMilestoneId ?? oid(risk.relatedMilestoneId), relatedTaskId: d.relatedTaskId ?? oid(risk.relatedTaskId), ownerId: d.ownerId });
  Object.assign(risk, Object.fromEntries(Object.entries(d).filter(([, v]) => v !== undefined)), { relatedProjectId: links.relatedProjectId || undefined, relatedMilestoneId: links.relatedMilestoneId || undefined });
  if (d.status === 'closed' && !risk.resolvedAt) risk.resolvedAt = new Date();
  if (d.status && d.status !== 'closed') risk.resolvedAt = undefined;
  await risk.save();
  await Promise.all([syncTaskBlocked(risk.relatedTaskId), syncMilestoneBlocked(risk.relatedProjectId, risk.relatedMilestoneId)]);
  await audit(req, 'risk.updated', 'Risk', String(risk._id), { module: 'risks', summary: `Updated risk "${risk.title}"`, meta: { fields: Object.keys(d) } });
  res.json({ success: true, data: risk });
}));

router.delete('/:id', asyncHandler(async (req, res) => {
  const risk = await Risk.findOne(excludeDeleted({ _id: req.params.id, organizationId: req.user!.organizationId }));
  if (!risk) throw ApiError.notFound('Risk not found');
  if (!canWrite(req, risk)) throw ApiError.forbidden('You cannot delete this risk');
  await (risk as any).softDelete(req.user!.id);
  await Promise.all([syncTaskBlocked(risk.relatedTaskId), syncMilestoneBlocked(risk.relatedProjectId, risk.relatedMilestoneId)]);
  await audit(req, 'risk.deleted', 'Risk', String(risk._id), { module: 'risks', severity: 'medium', summary: `Deleted risk "${risk.title}"` });
  res.json({ success: true, data: { id: req.params.id, softDeleted: true } });
}));

router.post('/:id/restore', asyncHandler(async (req, res) => {
  const risk = await Risk.findOne({ _id: req.params.id, organizationId: req.user!.organizationId, isDeleted: true });
  if (!risk) throw ApiError.notFound('Deleted risk not found');
  if (!MANAGERS.has(req.user!.role)) throw ApiError.forbidden('Only a manager can restore a risk');
  await (risk as any).restore();
  res.json({ success: true, data: risk });
}));

export default router;
