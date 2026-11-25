import { Request, Response } from 'express';
import { z } from 'zod';
import { asyncHandler } from '../utils/asyncHandler';
import { ApiError } from '../utils/ApiError';
import { Project } from '../models/Project';
import { SEVERITIES, Task } from '../models/Task';
import { Risk, RISK_LEVELS } from '../models/Risk';
import { Meeting } from '../models/Meeting';
import { Document } from '../models/Document';
import { User } from '../models/User';
import { excludeDeleted } from '../utils/softDeletePlugin';
import { escapeRegex } from '../utils/escapeRegex';
import { audit } from '../services/audit.service';
import { notifyWork } from '../services/work.notify';
import { certificateNumber, resolveApprover, ribbonFor, submissionProblems } from '../services/approval.service';
import { certificatePdf } from '../services/certificate.service';
import { isLeader, isTopLeader, oid, loadScope, visibleTasksFilter } from '../services/work.access';
import { milestoneStats, syncMilestoneBlocked } from '../services/work.service';
import { overlapFilter, rangeFromQuery } from '../utils/quarter';
import { OPEN_FILTER, isFinished, isOpenStatus } from '../config/taskStatus';

const blank = (v: unknown) => (v === '' || v === null ? undefined : v);
const oidStr = z.preprocess(blank, z.string().regex(/^[a-f\d]{24}$/i, 'Invalid id').optional());
const dateIn = z.preprocess(blank, z.coerce.date().optional());
const urlIn = z.string().min(1).max(500).refine((u) => /^(\/api\/uploads\/|https?:\/\/)/i.test(u), 'Must be an uploaded file or an http(s) link');
const docIn = z.object({ name: z.string().min(1).max(200), url: urlIn, kind: z.enum(['file', 'recording', 'image', 'link', 'evidence']).optional(), note: z.string().max(1000).optional() });

import { PROJECT_STATUSES, PROJECT_ENDING, projectStatusProblems } from '../config/projectStatus';
import { loadEntity, postComment } from '../services/discussion.service';
import { deviceLabel } from '../utils/requestContext';
const HOLD = new Set(['on_hold', 'paused']);
const PROJECT_ENDING_SET = new Set(PROJECT_ENDING);

const projectBody = z.object({
  name: z.string().trim().min(1, 'Project title is required').max(200),
  overview: z.string().max(50000).optional(),
  clientId: oidStr,
  practice: z.string().max(100).optional(),
  projectManagerId: oidStr,
  team: z.array(z.string().regex(/^[a-f\d]{24}$/i)).max(200).optional(),
  budget: z.coerce.number().min(0).optional(),
  revenue: z.coerce.number().min(0).optional(),
  currency: z.string().max(5).optional(),
  startDate: dateIn,
  endDate: dateIn, // optional — ongoing projects have no end date
  status: z.enum(PROJECT_STATUSES).optional(),
  holdReason: z.string().trim().max(2000).optional(),
  /** why the status is changing — required for every status change */
  statusComment: z.string().trim().max(5000).optional(),
  force: z.boolean().optional(),
  health: z.enum(['on_track', 'at_risk', 'off_track']).optional(),
});

const link = (id: unknown) => `/projects/${id}`;
const isManager = (req: Request, p: any) => isLeader({ id: req.user!.id, role: req.user!.role, organizationId: req.user!.organizationId }) || oid(p.projectManagerId) === req.user!.id || req.user!.role === 'project_manager';

async function findProject(req: Request) {
  const project = await Project.findOne(excludeDeleted({ _id: req.params.id, organizationId: req.user!.organizationId }));
  if (!project) throw ApiError.notFound('Project not found');
  return project;
}

/* ------------------------------- list / get ------------------------------- */
export const listProjects = asyncHandler(async (req: Request, res: Response) => {
  const { status, clientId, projectManagerId, q } = req.query as Record<string, string>;
  const and: Record<string, unknown>[] = [{ organizationId: req.user!.organizationId }];
  if (status) and.push({ status });
  if (clientId) and.push({ clientId });
  if (projectManagerId) and.push({ projectManagerId });
  if (q) and.push({ name: { $regex: escapeRegex(q), $options: 'i' } });
  const range = rangeFromQuery(req.query as any);
  if (range) and.push(overlapFilter(range, { due: 'endDate' }));

  const projects = await Project.find(excludeDeleted({ $and: and }))
    .populate('clientId', 'name logoUrl')
    .populate('projectManagerId', 'name avatarUrl')
    .sort('-createdAt');
  const manager = (p: any) => isManager(req, p);
  res.json({ success: true, data: projects.map((p) => ({ ...p.toObject(), permissions: { edit: manager(p), delete: manager(p), view: true } })) });
});

export const getProject = asyncHandler(async (req: Request, res: Response) => {
  const project = await Project.findOne(excludeDeleted({ _id: req.params.id, organizationId: req.user!.organizationId }))
    .populate('clientId')
    .populate('projectManagerId', 'name avatarUrl email')
    .populate('team', 'name avatarUrl jobTitle')
    .populate('milestones.ownerId', 'name')
    .populate('milestones.approverId', 'name')
    .populate('milestones.updates.authorId', 'name avatarUrl')
    .populate('comments.authorId', 'name avatarUrl')
    .populate('statusHistory.byId', 'name');
  if (!project) throw ApiError.notFound('Project not found');

  const orgId = req.user!.organizationId;
  const scope = await loadScope({ id: req.user!.id, role: req.user!.role, organizationId: orgId });
  const [tasks, risks, meetings, documents] = await Promise.all([
    Task.find(excludeDeleted({ $and: [{ organizationId: orgId, projectId: project._id }, visibleTasksFilter(scope)] }))
      .select('-activityHistory -comments').populate('ownerId', 'name avatarUrl').populate('parentTaskId', 'title').sort('createdAt'),
    Risk.find(excludeDeleted({ organizationId: orgId, relatedProjectId: project._id })).populate('ownerId', 'name').populate('relatedTaskId', 'title').sort('-createdAt'),
    Meeting.find(excludeDeleted({ organizationId: orgId, projectId: project._id })).select('title date provider status taskId milestoneId recording.uploaded recording.reminderEnabled').sort('-date'),
    Document.find(excludeDeleted({ organizationId: orgId, relatedProjectId: project._id })),
  ]);

  const top = tasks.filter((t: any) => !t.parentTaskId);
  const taskStats = {
    total: top.length,
    done: top.filter((t) => isFinished(t.status)).length,
    overdue: top.filter((t) => t.dueDate && t.dueDate < new Date() && isOpenStatus(t.status)).length,
    awaitingApproval: top.filter((t) => t.status === 'to_be_reviewed').length,
    blocked: top.filter((t) => t.status === 'on_hold').length,
    delayed: top.filter((t) => t.status === 'delayed').length,
    avgProgress: (() => { const live = top.filter((t) => isOpenStatus(t.status)); return live.length ? Math.round(live.reduce((n: number, t: any) => n + (t.percentComplete || 0), 0) / live.length) : 0; })(),
  };

  // Each milestone's progress is derived from the tasks assigned to it.
  const milestones = project.milestones.map((m: any) => {
    const mt = top.filter((t: any) => oid(t.milestoneId) === String(m._id));
    const done = mt.filter((t) => isFinished(t.status)).length;
    return {
      ...m.toObject(),
      tasks: { total: mt.length, done, open: mt.length - done, percent: mt.length ? Math.round((done / mt.length) * 100) : 0 },
      openRisks: risks.filter((r: any) => oid(r.relatedMilestoneId) === String(m._id) && r.status !== 'closed').length,
    };
  });

  const projObj: any = project.toObject();
  projObj.milestones = milestones;
  const canManage = isManager(req, project);
  res.json({ success: true, data: { project: projObj, tasks, risks, meetings, documents, taskStats, permissions: { edit: canManage, delete: canManage, manageMilestones: canManage } } });
});

/* --------------------------- create / update / delete --------------------------- */
async function assertUsers(orgId: string, ids: Array<string | undefined>) {
  const wanted = Array.from(new Set(ids.filter(Boolean) as string[]));
  if (!wanted.length) return;
  const found = await User.countDocuments({ _id: { $in: wanted }, organizationId: orgId, isActive: true });
  if (found !== wanted.length) throw ApiError.badRequest('One or more selected people were not found in your organisation');
}

export const createProject = asyncHandler(async (req: Request, res: Response) => {
  const d = projectBody.parse(req.body);
  const orgId = req.user!.organizationId;
  if (d.startDate && d.endDate && d.endDate < d.startDate) throw ApiError.badRequest('End date cannot be before the start date');
  const pm = d.projectManagerId || req.user!.id;
  await assertUsers(orgId, [pm, ...(d.team || [])]);
  if (d.status && HOLD.has(d.status) && !d.holdReason) throw ApiError.badRequest('Say why the project is on hold or paused');
  const project = await Project.create({ ...d, projectManagerId: pm, organizationId: orgId, heldAt: d.status && HOLD.has(d.status) ? new Date() : undefined });
  await audit(req, 'project.created', 'Project', String(project._id), { module: 'projects', summary: `Created project "${project.name}"` });
  res.status(201).json({ success: true, data: project });
});

export const updateProject = asyncHandler(async (req: Request, res: Response) => {
  const project = await findProject(req);
  let statusNote: { from: string; to: string; why: string } | null = null;
  const d = projectBody.partial().parse(req.body);
  const orgId = req.user!.organizationId;
  const start = d.startDate ?? project.startDate; const end = d.endDate ?? project.endDate;
  if (start && end && end < start) throw ApiError.badRequest('End date cannot be before the start date');
  await assertUsers(orgId, [d.projectManagerId, ...(d.team || [])]);

  const prev = project.status;
  const me = { id: req.user!.id, name: req.user!.name, role: req.user!.role, organizationId: orgId, modules: req.user!.modules };
  const fromInfo = { ip: req.ip, device: deviceLabel(String(req.headers['user-agent'] || '')) };
  if (d.status && d.status !== prev) {
    const isOwner = oid(project.projectManagerId) === req.user!.id || ['super_admin', 'ceo'].includes(req.user!.role);
    const openTasks = PROJECT_ENDING_SET.has(d.status) ? await Task.countDocuments(excludeDeleted({ organizationId: orgId, projectId: project._id, status: OPEN_FILTER })) : 0;
    const problems = projectStatusProblems({ from: prev, to: d.status, comment: d.statusComment || d.holdReason, holdReason: d.holdReason, isOwner, openTasks, force: d.force });
    if (problems.length) {
      if (problems[0].startsWith('Only')) {
        // Say who CAN do it and how to ask, instead of a bare "forbidden".
        const owner: any = await User.findById(project.projectManagerId).select('name');
        const who = owner?.name ? `${owner.name} (the project owner)` : 'the project owner';
        throw new ApiError(403, `Only ${who} can move a project to "${d.status.replace(/_/g, ' ')}". Use "Request closure" on this page and they will be asked to decide.`, { problems, ownerId: oid(project.projectManagerId), ownerName: owner?.name, canRequest: true });
      }
      throw new ApiError(422, problems[0], { problems });
    }
    const why = (d.statusComment || d.holdReason || '').trim();
    project.statusHistory.push({ from: prev, to: d.status, reason: d.holdReason, comment: why, byId: req.user!.id as any, byName: req.user!.name, at: new Date(), ip: fromInfo.ip, device: fromInfo.device } as any);
    if (HOLD.has(d.status)) { project.holdReason = d.holdReason || why; project.heldAt = new Date(); }
    else { project.holdReason = undefined; project.heldAt = undefined; }
    statusNote = { from: prev, to: d.status, why };
  } else if (d.holdReason !== undefined && HOLD.has(project.status)) {
    project.holdReason = d.holdReason;
  }
  const { holdReason: _hr, statusComment: _sc, force: _f, ...rest } = d as any;
  for (const [k, v] of Object.entries(rest)) if (v !== undefined) (project as any)[k] = v;
  await project.save();
  await audit(req, 'project.updated', 'Project', String(project._id), { module: 'projects', summary: `Updated project "${project.name}"`, meta: { fields: Object.keys(d), statusFrom: prev, statusTo: project.status } });

  if (statusNote) {
    const entity = await loadEntity(me, 'project', String(project._id));
    await postComment({ actor: me, entity, kind: 'status', status: { from: statusNote.from, to: statusNote.to }, body: statusNote.why, notify: 'all', from: fromInfo });
  }
  if (d.status && d.status !== prev && HOLD.has(d.status)) {
    const people = Array.from(new Set([oid(project.projectManagerId), ...project.team.map(oid)])).filter((x) => x && x !== req.user!.id);
    await notifyWork({ organizationId: orgId, userIds: people, title: `Project ${d.status === 'paused' ? 'paused' : 'on hold'}: ${project.name}`, summary: `${req.user!.name} put "${project.name}" ${d.status === 'paused' ? 'on pause' : 'on hold'}.`, rows: [['Project title', project.name], ['Reason', d.holdReason]], link: link(project._id), cta: 'See why', type: 'project', severity: 'warning' });
  }
  res.json({ success: true, data: project });
});

export const deleteProject = asyncHandler(async (req: Request, res: Response) => {
  const project = await findProject(req);
  const openTaskCount = await Task.countDocuments(excludeDeleted({ organizationId: req.user!.organizationId, projectId: project._id, status: OPEN_FILTER }));
  if (openTaskCount > 0 && req.query.force !== 'true') {
    throw ApiError.conflict(`This project has ${openTaskCount} open task(s). Resolve or reassign them first, or pass ?force=true to archive anyway.`);
  }
  await (project as any).softDelete(req.user!.id);
  await audit(req, 'project.deleted', 'Project', String(project._id), { module: 'projects', severity: 'medium', summary: `Deleted project "${project.name}"` });
  res.json({ success: true, data: { id: req.params.id, softDeleted: true } });
});

export const restoreProject = asyncHandler(async (req: Request, res: Response) => {
  const project = await Project.findOne({ _id: req.params.id, organizationId: req.user!.organizationId, isDeleted: true });
  if (!project) throw ApiError.notFound('Deleted project not found');
  await (project as any).restore();
  res.json({ success: true, data: project });
});

/* ------------------------- comments / issues on a project ------------------------- */
export const addProjectComment = asyncHandler(async (req: Request, res: Response) => {
  const project = await findProject(req);
  const d = z.object({ body: z.string().trim().min(1).max(5000), kind: z.enum(['comment', 'blocker', 'update']).default('comment') }).parse(req.body);
  project.comments.push({ authorId: req.user!.id, body: d.body, kind: d.kind } as any);
  await project.save();
  res.status(201).json({ success: true, data: project.comments[project.comments.length - 1] });
});

/**
 * "Why is this project on hold?" — one view that pulls together the stated reason, the hold history,
 * the comments/issues raised, every open risk or blocker (project, milestone and task level) and
 * everything that is currently blocked.
 */
export const holdReport = asyncHandler(async (req: Request, res: Response) => {
  const project = await Project.findOne(excludeDeleted({ _id: req.params.id, organizationId: req.user!.organizationId }))
    .populate('statusHistory.byId', 'name').populate('comments.authorId', 'name').populate('projectManagerId', 'name');
  if (!project) throw ApiError.notFound('Project not found');
  const orgId = req.user!.organizationId;
  const scope = await loadScope({ id: req.user!.id, role: req.user!.role, organizationId: orgId });
  const [risks, blockedTasks] = await Promise.all([
    Risk.find(excludeDeleted({ organizationId: orgId, relatedProjectId: project._id, status: { $ne: 'closed' } })).populate('ownerId', 'name').populate('raisedById', 'name').populate('relatedTaskId', 'title').sort('-blocking -createdAt'),
    Task.find(excludeDeleted({ $and: [{ organizationId: orgId, projectId: project._id, status: 'on_hold' }, visibleTasksFilter(scope)] })).select('title severity ownerId endDate').populate('ownerId', 'name'),
  ]);
  const milestoneTitle = (id: unknown) => (project.milestones.id(id as any) as any)?.title;
  const hist: any[] = (project.statusHistory as any[]) || [];
  const lastHold = [...hist].reverse().find((h) => HOLD.has(h.to));
  res.json({
    success: true,
    data: {
      project: { _id: project._id, name: project.name, status: project.status, health: project.health, projectManager: (project.projectManagerId as any)?.name },
      reason: project.holdReason || lastHold?.reason || null,
      since: project.heldAt || lastHold?.at || null,
      heldBy: lastHold?.byId?.name || null,
      history: hist.map((h) => ({ from: h.from, to: h.to, reason: h.reason, by: h.byId?.name, at: h.at })).reverse(),
      comments: ((project.comments as any[]) || []).filter((c) => c.kind !== 'update').map((c) => ({ _id: c._id, body: c.body, kind: c.kind, by: c.authorId?.name, at: c.createdAt })).reverse(),
      risks: risks.map((r: any) => ({
        _id: r._id, title: r.title, kind: r.kind, severity: r.severity, impact: r.impact, blocking: r.blocking, status: r.status, owner: r.ownerId?.name, raisedBy: r.raisedById?.name,
        appliesTo: r.relatedTaskId ? `Task: ${r.relatedTaskId.title}` : r.relatedMilestoneId ? `Milestone: ${milestoneTitle(r.relatedMilestoneId) || '—'}` : 'Project',
        mitigationPlan: r.mitigationPlan, createdAt: r.createdAt,
      })),
      blockedMilestones: project.milestones.filter((m: any) => m.status === 'blocked' || m.blocked).map((m: any) => ({ _id: m._id, title: m.title, severity: m.severity })),
      blockedTasks: blockedTasks.map((t: any) => ({ _id: t._id, title: t.title, severity: t.severity, owner: t.ownerId?.name })),
    },
  });
});

/* -------------------------------- milestones -------------------------------- */
const milestoneBody = z.object({
  title: z.string().trim().min(1, 'Milestone title is required').max(300),
  description: z.string().max(10000).optional(),
  severity: z.enum(SEVERITIES).optional(),
  ownerId: oidStr,
  approverId: oidStr,
  startDate: dateIn,
  endDate: dateIn,
  dueDate: dateIn,
  status: z.enum(['pending', 'in_progress', 'blocked']).optional(), // completion goes through submit → approve
  requireEvidence: z.boolean().optional(),
  acceptanceCriteria: z.array(z.union([z.string().min(1).max(300), z.object({ text: z.string().min(1).max(300), met: z.boolean().optional() })])).max(30).optional(),
});
const crit = (list?: Array<string | { text: string; met?: boolean }>) => (list || []).map((c) => (typeof c === 'string' ? { text: c, met: false } : { text: c.text, met: !!c.met }));

function applyMilestone(m: any, d: Partial<z.infer<typeof milestoneBody>>) {
  const { startDate, endDate, dueDate, acceptanceCriteria, ...rest } = d as any;
  for (const [k, v] of Object.entries(rest)) if (v !== undefined) m[k] = v;
  if (startDate !== undefined) m.startDate = startDate;
  const end = endDate ?? dueDate;
  if (end !== undefined) { m.endDate = end; m.dueDate = end; }
  if (acceptanceCriteria) m.acceptanceCriteria = crit(acceptanceCriteria);
}

export const addMilestone = asyncHandler(async (req: Request, res: Response) => {
  const project = await findProject(req);
  if (!isManager(req, project)) throw ApiError.forbidden('Only the project manager or leadership can add milestones');
  const d = milestoneBody.parse(req.body);
  if (d.startDate && (d.endDate ?? d.dueDate) && (d.endDate ?? d.dueDate)! < d.startDate) throw ApiError.badRequest('End date cannot be before the start date');
  await assertUsers(req.user!.organizationId, [d.ownerId, d.approverId]);
  const m: any = project.milestones.create({ title: d.title });
  applyMilestone(m, d);
  project.milestones.push(m);
  await project.save();
  await audit(req, 'milestone.created', 'Project', String(project._id), { module: 'projects', summary: `Added milestone "${d.title}" to "${project.name}"` });
  if (d.ownerId && d.ownerId !== req.user!.id) await notifyWork({ organizationId: req.user!.organizationId, userIds: [d.ownerId], title: 'You own a new milestone', summary: `${req.user!.name} made you owner of the milestone "${d.title}" on ${project.name}.`, rows: [['Milestone title', d.title], ['Project title', project.name], ['Severity', d.severity || 'major']], link: link(project._id), type: 'project', cta: 'Open project' });
  res.status(201).json({ success: true, data: m, hint: 'Assign at least one task to this milestone so its progress can be tracked.' });
});

function findMilestone(project: any, id: string) {
  const m = project.milestones.id(id);
  if (!m) throw ApiError.notFound('Milestone not found');
  return m;
}

export const updateMilestone = asyncHandler(async (req: Request, res: Response) => {
  const project = await findProject(req);
  const m: any = findMilestone(project, req.params.milestoneId);
  const manager = isManager(req, project);
  const mine = oid(m.ownerId) === req.user!.id;
  if (!manager && !mine) throw ApiError.forbidden('Only the milestone owner, project manager or leadership can change this milestone');
  const d = milestoneBody.partial().parse(req.body);
  if (!manager) {
    const bad = Object.keys(d).filter((k) => (d as any)[k] !== undefined && !['status', 'description'].includes(k));
    if (bad.length) throw ApiError.forbidden(`Only the project manager can change: ${bad.join(', ')}`);
  }
  if (['completed', 'awaiting_approval'].includes(m.status)) throw ApiError.badRequest('This milestone is awaiting approval or complete. Ask the approver to send it back first.');
  await assertUsers(req.user!.organizationId, [d.ownerId, d.approverId]);
  applyMilestone(m, d);
  await project.save();
  await audit(req, 'milestone.updated', 'Project', String(project._id), { module: 'projects', summary: `Updated milestone "${m.title}"`, meta: { fields: Object.keys(d) } });
  res.json({ success: true, data: m });
});

export const deleteMilestone = asyncHandler(async (req: Request, res: Response) => {
  const project = await findProject(req);
  if (!isManager(req, project)) throw ApiError.forbidden('Only the project manager or leadership can delete milestones');
  const m: any = findMilestone(project, req.params.milestoneId);
  const tasks = await Task.countDocuments(excludeDeleted({ projectId: project._id, milestoneId: m._id }));
  if (tasks && req.query.force !== 'true') throw ApiError.conflict(`${tasks} task(s) are assigned to this milestone. Move them first, or pass ?force=true to detach them.`);
  if (tasks) await Task.updateMany({ projectId: project._id, milestoneId: m._id }, { $unset: { milestoneId: 1 } });
  m.deleteOne();
  await project.save();
  await audit(req, 'milestone.deleted', 'Project', String(project._id), { module: 'projects', severity: 'medium', summary: `Deleted milestone "${m.title}"` });
  res.json({ success: true, data: { ok: true } });
});

export const milestoneUpdate = asyncHandler(async (req: Request, res: Response) => {
  const project = await findProject(req);
  const m: any = findMilestone(project, req.params.milestoneId);
  const d = z.object({ body: z.string().trim().min(1).max(5000), kind: z.enum(['update', 'comment', 'blocker']).default('update') }).parse(req.body);
  m.updates.push({ authorId: req.user!.id, body: d.body, kind: d.kind });
  await project.save();
  const people = Array.from(new Set([oid(project.projectManagerId), oid(m.ownerId), oid(m.approverId)])).filter((x) => x && x !== req.user!.id);
  if (people.length) await notifyWork({ organizationId: req.user!.organizationId, userIds: people, title: `Milestone ${d.kind}: ${m.title}`, summary: `${req.user!.name} posted ${d.kind === 'blocker' ? 'a blocker' : 'an update'} on the milestone "${m.title}".`, note: d.body, link: link(project._id), type: 'project', email: d.kind === 'blocker' });
  res.status(201).json({ success: true, data: m.updates[m.updates.length - 1] });
});

export const milestoneEvidence = asyncHandler(async (req: Request, res: Response) => {
  const project = await findProject(req);
  const m: any = findMilestone(project, req.params.milestoneId);
  if (!isManager(req, project) && oid(m.ownerId) !== req.user!.id) throw ApiError.forbidden('Only the milestone owner or project manager can attach evidence');
  if (['completed', 'awaiting_approval'].includes(m.status)) throw ApiError.badRequest('Evidence is locked while the milestone awaits approval or is complete');
  const d = docIn.parse(req.body);
  m.evidence.push({ ...d, kind: d.kind || 'evidence', uploadedById: req.user!.id });
  await project.save();
  await audit(req, 'milestone.evidence_added', 'Project', String(project._id), { module: 'projects', summary: `Evidence "${d.name}" added to milestone "${m.title}"` });
  res.status(201).json({ success: true, data: m.evidence[m.evidence.length - 1] });
});

export const milestoneCriterion = asyncHandler(async (req: Request, res: Response) => {
  const project = await findProject(req);
  const m: any = findMilestone(project, req.params.milestoneId);
  if (!isManager(req, project) && oid(m.ownerId) !== req.user!.id) throw ApiError.forbidden('Only the milestone owner or project manager can tick criteria');
  if (['completed', 'awaiting_approval'].includes(m.status)) throw ApiError.badRequest('Criteria are locked while the milestone awaits approval');
  const { met } = z.object({ met: z.boolean() }).parse(req.body);
  const c = m.acceptanceCriteria.id(req.params.criterionId);
  if (!c) throw ApiError.notFound('Criterion not found');
  c.met = met;
  await project.save();
  res.json({ success: true, data: c });
});

export const submitMilestone = asyncHandler(async (req: Request, res: Response) => {
  const project = await findProject(req);
  const m: any = findMilestone(project, req.params.milestoneId);
  if (!isManager(req, project) && oid(m.ownerId) !== req.user!.id) throw ApiError.forbidden('Only the milestone owner or project manager can submit it');
  if (['completed', 'awaiting_approval'].includes(m.status)) throw ApiError.badRequest('Already submitted');
  const { note } = z.object({ note: z.string().trim().max(5000).optional() }).parse(req.body);
  const stats = await milestoneStats(req.user!.organizationId, project._id, m._id);
  const problems: string[] = [];
  if (stats.total === 0) problems.push('This milestone has no tasks. Assign tasks to it so progress and ownership can be tracked.');
  problems.push(...submissionProblems({ requireEvidence: m.requireEvidence, evidenceCount: m.evidence.length, criteria: m.acceptanceCriteria, openChildren: stats.open, childLabel: 'task' }));
  const blockers = await Risk.countDocuments(excludeDeleted({ relatedMilestoneId: m._id, blocking: true, status: { $ne: 'closed' } }));
  if (blockers) problems.push(`${blockers} blocking risk${blockers === 1 ? ' is' : 's are'} still open on this milestone.`);
  if (problems.length) throw new ApiError(422, 'This milestone is not ready to submit', { problems });

  const approver = await resolveApprover({ organizationId: req.user!.organizationId, ownerId: oid(m.ownerId) || req.user!.id, approverId: m.approverId, creatorId: project.projectManagerId, projectId: project._id });
  if (!approver) throw ApiError.badRequest('No approver could be found. Set an approver on this milestone.');
  m.approverId = approver;
  m.status = 'awaiting_approval';
  m.approval = { status: 'pending', submittedById: req.user!.id, submittedAt: new Date(), completionNote: note };
  m.updates.push({ authorId: req.user!.id, body: note || 'Submitted for approval with evidence.', kind: 'completion' });
  await project.save();
  await audit(req, 'milestone.submitted', 'Project', String(project._id), { module: 'projects', summary: `Submitted milestone "${m.title}" for approval` });
  await notifyWork({ organizationId: req.user!.organizationId, userIds: [approver], title: `Approval needed: milestone ${m.title}`, summary: `${req.user!.name} submitted the milestone "${m.title}" on ${project.name}.`, rows: [['Milestone title', m.title], ['Project title', project.name], ['Tasks done', `${stats.done}/${stats.total}`], ['Evidence items', m.evidence.length]], note, link: link(project._id), cta: 'Review and approve', type: 'project', severity: 'warning' });
  res.json({ success: true, data: m });
});

function mayApprove(req: Request, project: any, m: any) {
  const me = req.user!.id;
  if (oid(m.ownerId) === me) return false; // never your own work
  return oid(m.approverId) === me || oid(project.projectManagerId) === me || isTopLeader({ id: me, role: req.user!.role, organizationId: req.user!.organizationId });
}

export const approveMilestone = asyncHandler(async (req: Request, res: Response) => {
  const project = await findProject(req);
  const m: any = findMilestone(project, req.params.milestoneId);
  if (m.status !== 'awaiting_approval') throw ApiError.badRequest('This milestone is not awaiting approval');
  if (!mayApprove(req, project, m)) throw ApiError.forbidden('Only the approver can approve this milestone, and never the owner of the work');
  const { note, ribbon } = z.object({ note: z.string().trim().max(2000).optional(), ribbon: z.string().trim().max(60).optional() }).parse(req.body);
  const end = m.endDate || m.dueDate;
  const onTime = !end || new Date() <= new Date(new Date(end).getTime() + 86400000);
  m.status = 'completed';
  m.completedAt = new Date();
  m.approval = { ...(m.approval?.toObject?.() ?? {}), status: 'approved', decidedById: req.user!.id, decidedAt: new Date(), decisionNote: note, certificateNo: certificateNumber('MILE'), ribbon: ribbon || ribbonFor({ severity: m.severity, onTime, evidenceCount: m.evidence.length }) };
  await project.save();
  await audit(req, 'milestone.approved', 'Project', String(project._id), { module: 'projects', summary: `Approved milestone "${m.title}"` });
  const people = Array.from(new Set([oid(m.ownerId), oid(project.projectManagerId)])).filter((x) => x && x !== req.user!.id);
  if (people.length) await notifyWork({ organizationId: req.user!.organizationId, userIds: people, title: `Milestone approved: ${m.title}`, summary: `${req.user!.name} approved the milestone "${m.title}".`, rows: [['Ribbon', m.approval.ribbon], ['Certificate no.', m.approval.certificateNo]], note, link: link(project._id), type: 'project' });
  res.json({ success: true, data: m });
});

export const rejectMilestone = asyncHandler(async (req: Request, res: Response) => {
  const project = await findProject(req);
  const m: any = findMilestone(project, req.params.milestoneId);
  if (m.status !== 'awaiting_approval') throw ApiError.badRequest('This milestone is not awaiting approval');
  if (!mayApprove(req, project, m)) throw ApiError.forbidden('Only the approver can send this milestone back');
  const { note } = z.object({ note: z.string().trim().min(3, 'Tell them what needs to change').max(2000) }).parse(req.body);
  m.status = 'in_progress';
  m.approval = { ...(m.approval?.toObject?.() ?? {}), status: 'rejected', decidedById: req.user!.id, decidedAt: new Date(), decisionNote: note };
  m.updates.push({ authorId: req.user!.id, body: note, kind: 'update' });
  await project.save();
  await audit(req, 'milestone.sent_back', 'Project', String(project._id), { module: 'projects', summary: `Sent milestone "${m.title}" back` });
  const people = Array.from(new Set([oid(m.ownerId), oid(project.projectManagerId)])).filter((x) => x && x !== req.user!.id);
  if (people.length) await notifyWork({ organizationId: req.user!.organizationId, userIds: people, title: `Milestone sent back: ${m.title}`, summary: `${req.user!.name} sent the milestone "${m.title}" back with feedback.`, note, noteTone: 'warn', link: link(project._id), type: 'project', severity: 'warning' });
  res.json({ success: true, data: m });
});

export const milestoneCertificate = asyncHandler(async (req: Request, res: Response) => {
  const project = await findProject(req);
  const m: any = findMilestone(project, req.params.milestoneId);
  const ap: any = { ...(m.approval?.toObject?.() ?? m.approval ?? {}) };
  if (ap.status !== 'approved' || !ap.certificateNo) {
    // Milestones completed before approvals existed still get a certificate (without an "approved by" signatory).
    if (m.status !== 'completed') throw ApiError.badRequest('A certificate is issued once the milestone is completed. Submit it for approval first if it needs sign-off.');
    ap.certificateNo = ap.certificateNo || `SJX-MILE-${new Date(m.completedAt || m.endDate || Date.now()).getUTCFullYear()}-${String(m._id).slice(-6).toUpperCase()}`;
    ap.ribbon = ap.ribbon || 'Completed';
    ap.decidedAt = ap.decidedAt || m.completedAt || m.endDate;
  }
  const [owner, approver] = await Promise.all([User.findById(m.ownerId || project.projectManagerId).select('name'), ap.decidedById ? User.findById(ap.decidedById).select('name') : null]);
  const pdf = await certificatePdf({ kind: 'Milestone', title: m.title, recipient: owner?.name || 'Project team', approver: approver?.name || 'Recorded completion', project: project.name, certificateNo: ap.certificateNo, ribbon: ap.ribbon, completedAt: m.completedAt || m.endDate, approvedAt: ap.decidedAt, evidenceCount: (m.evidence || []).length, note: ap.decisionNote });
  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', `attachment; filename="certificate-${ap.certificateNo}.pdf"`);
  res.send(pdf);
});

export const raiseMilestoneRisk = asyncHandler(async (req: Request, res: Response) => {
  const project = await findProject(req);
  const m: any = findMilestone(project, req.params.milestoneId);
  const d = z.object({
    title: z.string().trim().min(1, 'Risk title is required').max(300),
    kind: z.enum(['risk', 'blocker', 'issue']).default('risk'),
    description: z.string().max(5000).optional(),
    severity: z.enum(RISK_LEVELS).default('medium'),
    impact: z.enum(RISK_LEVELS).default('medium'),
    blocking: z.boolean().default(false),
    mitigationPlan: z.string().max(10000).optional(),
    ownerId: oidStr,
  }).parse(req.body);
  const risk = await Risk.create({ organizationId: req.user!.organizationId, ...d, blocking: d.blocking || d.kind === 'blocker', category: 'project', relatedProjectId: project._id, relatedMilestoneId: m._id, raisedById: req.user!.id, ownerId: d.ownerId || m.ownerId || project.projectManagerId });
  await syncMilestoneBlocked(project._id, m._id);
  await audit(req, 'risk.created', 'Risk', String(risk._id), { module: 'risks', summary: `${d.kind} "${d.title}" raised on milestone "${m.title}"`, meta: { blocking: risk.blocking } });
  const people = Array.from(new Set([oid(project.projectManagerId), oid(m.ownerId)])).filter((x) => x && x !== req.user!.id);
  if (people.length) await notifyWork({ organizationId: req.user!.organizationId, userIds: people, title: `${risk.blocking ? 'Blocker' : 'Risk'} on milestone: ${d.title}`, summary: `${req.user!.name} raised a ${d.kind} on the milestone "${m.title}".`, rows: [['Risk title', d.title], ['Severity', d.severity], ['Halting the milestone', risk.blocking ? 'Yes' : 'No']], note: d.description, noteTone: risk.blocking ? 'danger' : 'warn', link: link(project._id), type: 'risk', severity: risk.blocking ? 'high' : 'warning' });
  res.status(201).json({ success: true, data: risk });
});

/** A risk / blocker / issue against the project as a whole. */
export const raiseProjectRisk = asyncHandler(async (req: Request, res: Response) => {
  const project = await findProject(req);
  const d = z.object({
    title: z.string().trim().min(1, 'Risk title is required').max(300),
    kind: z.enum(['risk', 'blocker', 'issue']).default('risk'),
    description: z.string().max(5000).optional(),
    severity: z.enum(RISK_LEVELS).default('medium'),
    impact: z.enum(RISK_LEVELS).default('medium'),
    blocking: z.boolean().default(false),
    mitigationPlan: z.string().max(10000).optional(),
    ownerId: oidStr,
  }).parse(req.body);
  const risk = await Risk.create({ organizationId: req.user!.organizationId, ...d, blocking: d.blocking || d.kind === 'blocker', category: 'project', relatedProjectId: project._id, raisedById: req.user!.id, ownerId: d.ownerId || project.projectManagerId || req.user!.id });
  await audit(req, 'risk.created', 'Risk', String(risk._id), { module: 'risks', summary: `${d.kind} "${d.title}" raised on project "${project.name}"`, meta: { blocking: risk.blocking } });
  const people = [oid(project.projectManagerId)].filter((x) => x && x !== req.user!.id);
  if (people.length) await notifyWork({ organizationId: req.user!.organizationId, userIds: people, title: `${risk.blocking ? 'Blocker' : 'Risk'} on project: ${d.title}`, summary: `${req.user!.name} raised a ${d.kind} on the project "${project.name}".`, rows: [['Project', project.name], ['Severity', d.severity]], link: link(project._id), cta: 'Open project', severity: risk.blocking ? 'warning' : 'info' });
  res.status(201).json({ success: true, data: risk });
});


/** A team member who cannot close the project asks the owner to. It lands in the project conversation, tagged to the owner. */
export const requestProjectClosure = asyncHandler(async (req: Request, res: Response) => {
  const project = await findProject(req);
  const b = z.object({ to: z.enum(['closure', 'inactive']), comment: z.string().trim().min(3, 'Say why the project should be closed') }).parse(req.body);
  const ownerId = oid(project.projectManagerId);
  if (!ownerId) throw ApiError.badRequest('This project has no owner to ask');
  if (ownerId === req.user!.id) throw ApiError.badRequest('You own this project, so you can change its status yourself.');
  const me = { id: req.user!.id, name: req.user!.name, role: req.user!.role, organizationId: req.user!.organizationId, modules: req.user!.modules };
  const entity = await loadEntity(me, 'project', String(project._id));
  const label = b.to === 'closure' ? 'close this project' : 'make this project inactive';
  await postComment({ actor: me, entity, body: `Request: please ${label}. ${b.comment}`, awareness: [ownerId], notify: 'all', from: { ip: req.ip, device: deviceLabel(String(req.headers['user-agent'] || '')) } });
  await audit(req, 'project.closure_requested', 'Project', String(project._id), { module: 'projects', summary: `${req.user!.name} asked the owner to ${label}` });
  res.json({ success: true, data: { ok: true } });
});
