import { Router } from 'express';
import { z } from 'zod';
import { requireAuth } from '../middleware/auth';
import { asyncHandler } from '../utils/asyncHandler';
import { ApiError } from '../utils/ApiError';
import { Goal } from '../models/Goal';
import { User } from '../models/User';
import { excludeDeleted } from '../utils/softDeletePlugin';
import { escapeRegex } from '../utils/escapeRegex';
import { audit } from '../services/audit.service';
import { notifyWork } from '../services/work.notify';
import { isLeader, oid } from '../services/work.access';
import { certificateNumber } from '../services/approval.service';
import { certificatePdf } from '../services/certificate.service';
import { normaliseQuarter, parseQuarter, quarterOf } from '../utils/quarter';

const router = Router();
router.use(requireAuth);

const blank = (v: unknown) => (v === '' || v === null ? undefined : v);
const oidStr = z.preprocess(blank, z.string().regex(/^[a-f\d]{24}$/i, 'Invalid id').optional());
const dateIn = z.preprocess(blank, z.coerce.date().optional());
const urlIn = z.string().min(1).max(500).refine((u) => /^(\/api\/uploads\/|https?:\/\/)/i.test(u), 'Must be an uploaded file or an http(s) link');

const krIn = z.object({ _id: oidStr, description: z.string().trim().min(1).max(300), targetValue: z.coerce.number().min(0).default(100), currentValue: z.coerce.number().min(0).optional(), unit: z.string().max(20).optional() });

const body = z.object({
  title: z.string().trim().min(1, 'Goal title is required').max(300),
  description: z.string().max(20000).optional(),
  level: z.enum(['company', 'department', 'team', 'employee']),
  department: z.string().max(100).optional(),
  ownerId: oidStr,
  parentGoalId: oidStr,
  quarter: z.preprocess(blank, z.string().max(20).optional()),
  startDate: dateIn,
  endDate: dateIn,
  keyResults: z.array(krIn).max(20).optional(),
  // owner-only:
  progressPercent: z.coerce.number().min(0).max(100).optional(),
  status: z.enum(['not_started', 'on_track', 'at_risk', 'completed']).optional(),
  completionNote: z.string().max(5000).optional(),
});
const OWNER_ONLY = ['progressPercent', 'status', 'completionNote'] as const;

const actor = (req: any) => ({ id: req.user.id, role: req.user.role, organizationId: req.user.organizationId });
const isOwner = (req: any, g: any) => oid(g.ownerId) === req.user.id;
const perms = (req: any, g: any) => ({ view: true, updateProgress: isOwner(req, g), edit: isOwner(req, g) || oid(g.createdById) === req.user.id || isLeader(actor(req)), delete: oid(g.createdById) === req.user.id || isOwner(req, g) || isLeader(actor(req)), verify: !isOwner(req, g) && (oid(g.createdById) === req.user.id || isLeader(actor(req))) });

const krProgress = (krs: any[]) => (krs.length ? Math.round((krs.reduce((s, k) => s + (k.targetValue > 0 ? Math.min(k.currentValue / k.targetValue, 1) : 0), 0) / krs.length) * 100) : undefined);

function fillQuarter(d: { quarter?: string; startDate?: Date; endDate?: Date }) {
  const q = d.quarter ? normaliseQuarter(d.quarter) : undefined;
  if (d.quarter && !q) throw ApiError.badRequest('Quarter must look like 2026-Q4');
  const range = parseQuarter(q);
  return { quarter: q, startDate: d.startDate ?? range?.from, endDate: d.endDate ?? range?.to };
}

router.get('/', asyncHandler(async (req, res) => {
  const q = req.query as Record<string, string>;
  const and: Record<string, unknown>[] = [{ organizationId: req.user!.organizationId }];
  for (const k of ['level', 'status', 'ownerId', 'department'] as const) if (q[k]) and.push({ [k]: q[k] });
  if (q.scope === 'mine') and.push({ ownerId: req.user!.id });
  if (q.quarter) {
    const nq = normaliseQuarter(q.quarter);
    if (nq) and.push({ quarter: nq });
  }
  if (q.q) and.push({ title: { $regex: escapeRegex(q.q), $options: 'i' } });
  const page = Math.max(parseInt(q.page, 10) || 1, 1);
  const limit = Math.min(Math.max(parseInt(q.limit, 10) || 20, 1), 100);
  const filter = excludeDeleted({ $and: and });
  const [items, total] = await Promise.all([
    Goal.find(filter).select('-progressLog').populate('ownerId', 'name').sort('-quarter -createdAt').skip((page - 1) * limit).limit(limit),
    Goal.countDocuments(filter),
  ]);
  res.json({ success: true, data: items.map((g) => ({ ...g.toObject(), permissions: perms(req, g) })), pagination: { page, limit, total, pages: Math.ceil(total / limit) } });
}));

router.get('/:id', asyncHandler(async (req, res) => {
  const g = await Goal.findOne(excludeDeleted({ _id: req.params.id, organizationId: req.user!.organizationId })).populate('ownerId', 'name').populate('verifiedById', 'name').populate('parentGoalId', 'title').populate('progressLog.byId', 'name');
  if (!g) throw ApiError.notFound('Goal not found');
  res.json({ success: true, data: { ...g.toObject(), permissions: perms(req, g) } });
}));

router.post('/', asyncHandler(async (req, res) => {
  const d = body.parse(req.body);
  const orgId = req.user!.organizationId;
  const ownerId = d.ownerId || req.user!.id;
  if (!(await User.exists({ _id: ownerId, organizationId: orgId, isActive: true }))) throw ApiError.badRequest('Goal owner was not found');
  const dates = fillQuarter({ ...d, quarter: d.quarter || quarterOf() });
  if (dates.startDate && dates.endDate && dates.endDate < dates.startDate) throw ApiError.badRequest('End date cannot be before the start date');
  // Only the owner ever moves progress. Someone setting a goal for another person defines it; the owner reports on it.
  const goal = await Goal.create({
    organizationId: orgId, createdById: req.user!.id, ownerId,
    title: d.title, description: d.description, level: d.level, department: d.department, parentGoalId: d.parentGoalId,
    ...dates,
    keyResults: (d.keyResults || []).map((k) => ({ description: k.description, targetValue: k.targetValue, unit: k.unit, currentValue: ownerId === req.user!.id ? k.currentValue ?? 0 : 0 })),
    status: 'not_started', progressPercent: 0,
  });
  await audit(req, 'goal.created', 'Goal', String(goal._id), { module: 'goals', summary: `Created goal "${goal.title}"`, meta: { ownerId } });
  if (ownerId !== req.user!.id) await notifyWork({ organizationId: orgId, userIds: [ownerId], title: `New goal for you: ${goal.title}`, summary: `${req.user!.name} set the goal "${goal.title}" for you (${goal.quarter}). Only you can update its progress.`, rows: [['Goal title', goal.title], ['Quarter', goal.quarter], ['Level', goal.level]], link: '/goals', type: 'goal', cta: 'Open goals' });
  res.status(201).json({ success: true, data: goal });
}));

router.patch('/:id', asyncHandler(async (req, res) => {
  const g = await Goal.findOne(excludeDeleted({ _id: req.params.id, organizationId: req.user!.organizationId }));
  if (!g) throw ApiError.notFound('Goal not found');
  const p = perms(req, g);
  if (!p.edit) throw ApiError.forbidden('You cannot edit this goal');
  const d = body.partial().parse(req.body);

  // The rule: only the owner changes progress, status and the completion note.
  const ownerOnly = OWNER_ONLY.filter((k) => (d as any)[k] !== undefined && (d as any)[k] !== (g as any)[k]);
  if (ownerOnly.length && !p.updateProgress) throw ApiError.forbidden(`Only the goal owner (${(await User.findById(g.ownerId).select('name'))?.name || 'the owner'}) can change ${ownerOnly.join(' / ').replace('progressPercent', 'progress')}`);

  if (d.ownerId && d.ownerId !== oid(g.ownerId)) {
    if (!(await User.exists({ _id: d.ownerId, organizationId: req.user!.organizationId, isActive: true }))) throw ApiError.badRequest('Goal owner was not found');
    if (!p.edit || p.updateProgress === false && oid(g.createdById) !== req.user!.id && !isLeader(actor(req))) throw ApiError.forbidden('Only the creator, the current owner or leadership can transfer a goal');
  }
  if (g.status === 'completed' && d.status && d.status !== 'completed') throw ApiError.badRequest('A completed goal is locked');

  const dates = d.quarter !== undefined || d.startDate || d.endDate ? fillQuarter({ quarter: d.quarter ?? g.quarter ?? undefined, startDate: d.startDate, endDate: d.endDate }) : {};
  const { keyResults, ...rest } = d as any;
  for (const [k, v] of Object.entries({ ...rest, ...dates })) if (v !== undefined) (g as any)[k] = v;
  const startCheck = g.startDate; const endCheck = g.endDate;
  if (startCheck && endCheck && endCheck < startCheck) throw ApiError.badRequest('End date cannot be before the start date');

  if (keyResults) {
    const existing = new Map((g.keyResults as any[]).map((k) => [String(k._id), k]));
    g.set('keyResults', keyResults.map((k: any) => {
      const old = k._id ? existing.get(String(k._id)) : undefined;
      // Non-owners cannot move a key result's current value.
      const current = p.updateProgress ? k.currentValue ?? old?.currentValue ?? 0 : old?.currentValue ?? 0;
      return { ...(old ? { _id: old._id } : {}), description: k.description, targetValue: k.targetValue, unit: k.unit || old?.unit || '%', currentValue: current };
    }));
    if (p.updateProgress && d.progressPercent === undefined) {
      const calc = krProgress(g.keyResults as any[]);
      if (calc !== undefined) g.progressPercent = calc;
    }
  }
  if (p.updateProgress && (d.progressPercent !== undefined || keyResults)) {
    g.progressLog.push({ value: g.progressPercent, note: d.completionNote, byId: req.user!.id as any, at: new Date() } as any);
    if (g.status === 'not_started' && g.progressPercent > 0) g.status = 'on_track';
  }
  if (d.status === 'completed' && g.status === 'completed') {
    if (!(g.evidence as any[]).length) throw ApiError.badRequest('Attach evidence that the goal was achieved before marking it completed');
    g.progressPercent = 100;
    g.completedAt = g.completedAt || new Date();
  }
  await g.save();
  await audit(req, 'goal.updated', 'Goal', String(g._id), { module: 'goals', summary: `Updated goal "${g.title}"`, meta: { fields: Object.keys(d), progress: g.progressPercent, status: g.status } });
  if (d.status === 'completed') {
    const people = [oid(g.createdById)].filter((x) => x && x !== req.user!.id);
    if (people.length) await notifyWork({ organizationId: req.user!.organizationId, userIds: people, title: `Goal completed: ${g.title}`, summary: `${req.user!.name} marked the goal "${g.title}" as completed with ${(g.evidence as any[]).length} piece(s) of evidence.`, rows: [['Goal title', g.title], ['Quarter', g.quarter]], note: g.completionNote ?? undefined, link: '/goals', type: 'goal', cta: 'Review and verify' });
  }
  res.json({ success: true, data: { ...g.toObject(), permissions: perms(req, g) } });
}));

router.post('/:id/evidence', asyncHandler(async (req, res) => {
  const g = await Goal.findOne(excludeDeleted({ _id: req.params.id, organizationId: req.user!.organizationId }));
  if (!g) throw ApiError.notFound('Goal not found');
  if (!isOwner(req, g)) throw ApiError.forbidden('Only the goal owner can attach evidence');
  if (g.verifiedAt) throw ApiError.badRequest('This goal has been verified and is locked');
  const d = z.object({ name: z.string().min(1).max(200), url: urlIn, kind: z.enum(['file', 'image', 'link', 'recording', 'evidence']).optional(), note: z.string().max(1000).optional() }).parse(req.body);
  g.evidence.push({ ...d, kind: d.kind || 'evidence', uploadedById: req.user!.id } as any);
  await g.save();
  await audit(req, 'goal.evidence_added', 'Goal', String(g._id), { module: 'goals', summary: `Evidence "${d.name}" added to goal "${g.title}"` });
  res.status(201).json({ success: true, data: g.evidence[g.evidence.length - 1] });
}));

router.delete('/:id/evidence/:evidenceId', asyncHandler(async (req, res) => {
  const g = await Goal.findOne(excludeDeleted({ _id: req.params.id, organizationId: req.user!.organizationId }));
  if (!g) throw ApiError.notFound('Goal not found');
  if (!isOwner(req, g)) throw ApiError.forbidden('Only the goal owner can remove evidence');
  if (g.verifiedAt) throw ApiError.badRequest('This goal has been verified and is locked');
  const ev: any = g.evidence.id(req.params.evidenceId);
  if (!ev) throw ApiError.notFound('Evidence not found');
  ev.deleteOne();
  await g.save();
  await audit(req, 'goal.evidence_removed', 'Goal', String(g._id), { module: 'goals', severity: 'medium', summary: `Evidence removed from goal "${g.title}"` });
  res.json({ success: true, data: { ok: true } });
}));

/** Someone other than the owner (creator or leadership) confirms the evidence is genuine — only then is a certificate issued. */
router.post('/:id/verify', asyncHandler(async (req, res) => {
  const g = await Goal.findOne(excludeDeleted({ _id: req.params.id, organizationId: req.user!.organizationId }));
  if (!g) throw ApiError.notFound('Goal not found');
  if (!perms(req, g).verify) throw ApiError.forbidden('Only the goal creator or leadership — never the owner — can verify a goal');
  if (g.status !== 'completed') throw ApiError.badRequest('The owner has not marked this goal completed yet');
  if (!(g.evidence as any[]).length) throw ApiError.badRequest('There is no evidence to verify');
  g.verifiedById = req.user!.id as any;
  g.verifiedAt = new Date();
  g.certificateNo = g.certificateNo || certificateNumber('GOAL');
  await g.save();
  await audit(req, 'goal.verified', 'Goal', String(g._id), { module: 'goals', summary: `Verified goal "${g.title}"` });
  await notifyWork({ organizationId: req.user!.organizationId, userIds: [oid(g.ownerId)], title: `Goal verified: ${g.title}`, summary: `${req.user!.name} verified your evidence for "${g.title}".`, rows: [['Certificate no.', g.certificateNo]], link: '/goals', type: 'goal' });
  res.json({ success: true, data: g });
}));

router.get('/:id/certificate', asyncHandler(async (req, res) => {
  const g = await Goal.findOne(excludeDeleted({ _id: req.params.id, organizationId: req.user!.organizationId }));
  if (!g) throw ApiError.notFound('Goal not found');
  if (!g.verifiedAt || !g.certificateNo) throw ApiError.badRequest('A certificate is issued once the goal has been verified');
  const [owner, verifier] = await Promise.all([User.findById(g.ownerId).select('name'), User.findById(g.verifiedById).select('name')]);
  const pdf = await certificatePdf({ kind: 'Goal', title: g.title, recipient: owner?.name || 'Goal owner', approver: verifier?.name || 'Verifier', certificateNo: g.certificateNo, ribbon: g.quarter ? `Goal achieved · ${g.quarter}` : 'Goal achieved', completedAt: g.completedAt, approvedAt: g.verifiedAt, evidenceCount: (g.evidence as any[]).length, note: g.completionNote ?? undefined });
  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', `attachment; filename="certificate-${g.certificateNo}.pdf"`);
  res.send(pdf);
}));

router.delete('/:id', asyncHandler(async (req, res) => {
  const g = await Goal.findOne(excludeDeleted({ _id: req.params.id, organizationId: req.user!.organizationId }));
  if (!g) throw ApiError.notFound('Goal not found');
  if (!perms(req, g).delete) throw ApiError.forbidden('You cannot delete this goal');
  await (g as any).softDelete(req.user!.id);
  await audit(req, 'goal.deleted', 'Goal', String(g._id), { module: 'goals', severity: 'medium', summary: `Deleted goal "${g.title}"` });
  res.json({ success: true, data: { id: req.params.id, softDeleted: true } });
}));

router.post('/:id/restore', asyncHandler(async (req, res) => {
  const g = await Goal.findOne({ _id: req.params.id, organizationId: req.user!.organizationId, isDeleted: true });
  if (!g) throw ApiError.notFound('Deleted goal not found');
  if (!isLeader(actor(req)) && oid(g.createdById) !== req.user!.id) throw ApiError.forbidden('You cannot restore this goal');
  await (g as any).restore();
  res.json({ success: true, data: g });
}));

export default router;
