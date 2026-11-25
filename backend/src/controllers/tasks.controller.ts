import { Request, Response } from 'express';
import { z } from 'zod';
import { asyncHandler } from '../utils/asyncHandler';
import { ApiError } from '../utils/ApiError';
import { Task, SEVERITIES } from '../models/Task';
import { FINISHED, HOLD_REASONS, OPEN_FILTER, STATUS_LABEL, TASK_STATUSES, TERMINAL, isFinished, isOpenStatus, nextStatuses, normaliseStatus } from '../config/taskStatus';
import { toCsv } from '../utils/csv';
import { changeStatus, ownersOf, resolveReviewer, taskAudience } from '../services/taskWorkflow.service';
import { loadEntity, postComment } from '../services/discussion.service';
import { deviceLabel } from '../utils/requestContext';
import { Project } from '../models/Project';
import { Risk, RISK_LEVELS } from '../models/Risk';
import { Meeting } from '../models/Meeting';
import { User } from '../models/User';
import { excludeDeleted } from '../utils/softDeletePlugin';
import { escapeRegex } from '../utils/escapeRegex';
import { audit } from '../services/audit.service';
import { sendMail } from '../services/email.service';
import { callout, esc, fmtDate, kvTable, renderEmail } from '../services/mail.templates';
import { notifyWork, taskRows } from '../services/work.notify';
import { canViewTask, isLeader, loadScope, ownedBy, taskPermissions, visibleTasksFilter, oid, AccessScope } from '../services/work.access';
import { certificateNumber, resolveApprover, ribbonFor, submissionProblems } from '../services/approval.service';
import { certificatePdf } from '../services/certificate.service';
import { syncTaskBlocked } from '../services/work.service';
import { overlapFilter, rangeFromQuery } from '../utils/quarter';
import { logger } from '../utils/logger';

/* ----------------------------------------------------------------------------
 * Validation
 * -------------------------------------------------------------------------- */
const blank = (v: unknown) => (v === '' || v === null ? undefined : v);
const oidStr = z.preprocess(blank, z.string().regex(/^[a-f\d]{24}$/i, 'Invalid id').optional());
const dateIn = z.preprocess(blank, z.coerce.date().optional());
const criterionIn = z.union([z.string().min(1).max(300), z.object({ text: z.string().min(1).max(300), met: z.boolean().optional() })]);
const urlIn = z.string().min(1).max(500).refine((u) => /^(\/api\/uploads\/|https?:\/\/)/i.test(u), 'Must be an uploaded file or an http(s) link');
const docIn = z.object({
  name: z.string().min(1).max(200),
  url: urlIn,
  kind: z.enum(['file', 'recording', 'image', 'link', 'evidence']).optional(),
  note: z.string().max(1000).optional(),
});

const baseFields = {
  title: z.string().trim().min(1, 'Task title is required').max(300),
  description: z.string().max(20000).optional(),
  ownerId: oidStr,
  /** everyone doing the work; the first is the primary owner */
  ownerIds: z.array(z.string().regex(/^[a-f\d]{24}$/i)).max(15).optional(),
  approverId: oidStr,
  testerId: oidStr,
  priority: z.enum(['low', 'medium', 'high', 'urgent']).optional(),
  severity: z.enum(SEVERITIES).optional(),
  startDate: dateIn,
  endDate: dateIn,
  dueDate: dateIn,
  projectId: oidStr,
  milestoneId: oidStr,
  clientId: oidStr,
  parentTaskId: oidStr,
  department: z.string().max(100).optional(),
  confidential: z.boolean().optional(),
  requireEvidence: z.boolean().optional(),
  acceptanceCriteria: z.array(criterionIn).max(30).optional(),
  tags: z.array(z.string().max(60)).max(20).optional(),
  dependencies: z.array(z.string().regex(/^[a-f\d]{24}$/i)).max(30).optional(),
  reminderAt: dateIn,
  recurrence: z.object({ isRecurring: z.boolean(), frequency: z.enum(['daily', 'weekly', 'monthly']).optional(), nextRunDate: dateIn }).optional(),
};
/** Every task starts with a comment — even "open" has to say why it exists. */
const createSchema = z.object({ ...baseFields, status: z.enum(['open', 'in_progress']).optional(), statusComment: z.string().trim().min(3, 'Add a comment: why is this task being opened?').max(5000), notifyAudience: z.boolean().optional() });
/** Status changes go through POST /:id/status so a comment is always recorded. */
const updateSchema = z.object({ ...baseFields }).partial();
const statusSchema = z.object({
  status: z.enum(TASK_STATUSES),
  comment: z.string().trim().min(3, 'Write a comment explaining this status change').max(5000),
  percent: z.number().min(0).max(100).optional(),
  hold: z.object({ reason: z.enum(HOLD_REASONS), awaitingUserId: oidStr, note: z.string().max(1000).optional(), createLinkedTask: z.boolean().optional(), linkedTitle: z.string().max(300).optional() }).optional(),
  newDate: dateIn,
  testerId: oidStr,
  evidence: z.array(docIn).max(10).optional(),
  notifyAudience: z.boolean().optional(),
});

/** Fields a plain assignee may change on their own task. Everything else needs the creator / approver / PM / leadership. */
const OWNER_FIELDS = new Set(['description', 'tags', 'reminderAt', 'recurrence', 'testerId']);
const SEV_NEEDS_EVIDENCE = new Set(['major', 'critical', 'show_stopper']);

const link = (id: unknown) => `/tasks/${id}`;
const needsApproval = (t: any) => !!t.requireEvidence || (t.acceptanceCriteria || []).length > 0;

async function scopeFor(req: Request): Promise<AccessScope> {
  return loadScope({ id: req.user!.id, role: req.user!.role, organizationId: req.user!.organizationId });
}

async function loadTask(req: Request, opts: { deleted?: boolean } = {}) {
  const base = { _id: req.params.id, organizationId: req.user!.organizationId };
  const task = await Task.findOne(opts.deleted ? { ...base, isDeleted: true } : excludeDeleted(base));
  if (!task) throw ApiError.notFound('Task not found');
  const scope = await scopeFor(req);
  // Hide the existence of tasks the person may not see.
  if (!canViewTask(scope, task)) throw ApiError.notFound('Task not found');
  return { task, scope, perms: taskPermissions(scope, task) };
}

async function assertActiveUser(orgId: string, userId?: string, label = 'User') {
  if (!userId) return;
  const u = await User.findOne({ _id: userId, organizationId: orgId, isActive: true }).select('_id');
  if (!u) throw ApiError.badRequest(`${label} was not found in your organisation`);
}

async function validateLinks(orgId: string, d: { projectId?: string; milestoneId?: string; parentTaskId?: string; clientId?: string }) {
  let project: any = null;
  if (d.projectId) {
    project = await Project.findOne(excludeDeleted({ _id: d.projectId, organizationId: orgId }));
    if (!project) throw ApiError.badRequest('Project not found');
  }
  if (d.milestoneId) {
    if (!project) throw ApiError.badRequest('Choose the project before choosing a milestone');
    if (!project.milestones.id(d.milestoneId)) throw ApiError.badRequest('That milestone does not belong to the selected project');
  }
  let parent: any = null;
  if (d.parentTaskId) {
    parent = await Task.findOne(excludeDeleted({ _id: d.parentTaskId, organizationId: orgId }));
    if (!parent) throw ApiError.badRequest('Parent task not found');
    if (parent.parentTaskId) throw ApiError.badRequest('A subtask cannot have its own subtasks — add it to the parent task instead');
  }
  return { project, parent };
}

function checkDates(start?: Date, end?: Date) {
  if (start && end && end < start) throw ApiError.badRequest('End date cannot be before the start date');
}

const toCriteria = (list?: Array<string | { text: string; met?: boolean }>) => (list || []).map((c) => (typeof c === 'string' ? { text: c, met: false } : { text: c.text, met: !!c.met }));

/** Keep dueDate and endDate in step: older reminders and screens read dueDate, new screens read endDate. */
function syncDates(target: any, patch: { startDate?: Date; endDate?: Date; dueDate?: Date }) {
  if (patch.startDate !== undefined) target.startDate = patch.startDate;
  const end = patch.endDate ?? patch.dueDate;
  if (end !== undefined) { target.endDate = end; target.dueDate = end; }
}

function presentTask(task: any, scope: AccessScope) {
  const o = typeof task.toObject === 'function' ? task.toObject() : task;
  const status = normaliseStatus(o.status) || 'open';
  return { ...o, status, statusLabel: STATUS_LABEL[status], nextStatuses: nextStatuses(status), permissions: taskPermissions(scope, o) };
}

/* ----------------------------------------------------------------------------
 * List / board / detail
 * -------------------------------------------------------------------------- */
function listFilter(req: Request, scope: AccessScope) {
  const q = req.query as Record<string, string>;
  const mine = q.scope === 'mine' || q.view === 'mine';
  const and: Record<string, unknown>[] = [{ organizationId: req.user!.organizationId }];

  if (mine) and.push(ownedBy(req.user!.id)); // my tasks include subtasks, and tasks I share with other owners
  else if (q.includeSubtasks !== 'true') and.push({ parentTaskId: { $exists: false } });
  if (q.parentTaskId) and.push({ parentTaskId: q.parentTaskId });

  for (const k of ['projectId', 'milestoneId', 'clientId', 'priority', 'severity', 'department'] as const) if (q[k]) and.push({ [k]: q[k] });
  if (q.ownerId) and.push(ownedBy(q.ownerId));
  if (q.status) {
    if (q.status === 'active') and.push({ status: OPEN_FILTER });
    else if (q.status === 'finished') and.push({ status: { $in: FINISHED } });
    else and.push({ status: { $in: q.status.split(',').map((x) => normaliseStatus(x.trim())).filter(Boolean) } });
  }
  if (q.awaitingMyApproval === 'true' || q.awaitingMyReview === 'true') and.push({ status: 'to_be_reviewed', $or: [{ approverId: req.user!.id }, { reviewerId: req.user!.id }] });
  if (q.overdue === 'true') and.push({ status: OPEN_FILTER, dueDate: { $lt: new Date() } });
  if (q.q) and.push({ $or: [{ title: { $regex: escapeRegex(q.q), $options: 'i' } }, { tags: { $regex: escapeRegex(q.q), $options: 'i' } }] });
  if (q.createdFrom || q.createdTo) and.push({ createdAt: { ...(q.createdFrom ? { $gte: new Date(q.createdFrom) } : {}), ...(q.createdTo ? { $lte: new Date(`${q.createdTo}T23:59:59.999Z`) } : {}) } });
  if (q.updatedFrom) and.push({ updatedAt: { $gte: new Date(q.updatedFrom) } });
  const range = rangeFromQuery(q);
  if (range) and.push(overlapFilter(range));
  and.push(visibleTasksFilter(scope));
  return excludeDeleted({ $and: and });
}

export const listTasks = asyncHandler(async (req: Request, res: Response) => {
  const q = req.query as Record<string, string>;
  const scope = await scopeFor(req);
  const sort = q.sort === 'due' ? 'dueDate' : q.sort === 'updated' ? '-updatedAt' : q.sort === 'progress' ? '-percentComplete' : '-createdAt';
  const tasks = await Task.find(listFilter(req, scope))
    .select('-activityHistory -comments.body -statusHistory')
    .populate('ownerId', 'name avatarUrl')
    .populate('coOwnerIds', 'name avatarUrl')
    .populate('approverId', 'name')
    .populate('projectId', 'name')
    .populate('clientId', 'name')
    .populate('parentTaskId', 'title')
    .sort(sort)
    .limit(Math.min(Number(q.limit) || 500, 1000));

  res.json({ success: true, data: tasks.map((t) => presentTask(t, scope)) });
});

/** Same filters as the list, as a spreadsheet. */
export const exportTasks = asyncHandler(async (req: Request, res: Response) => {
  const scope = await scopeFor(req);
  const tasks: any[] = await Task.find(listFilter(req, scope)).populate('ownerId', 'name').populate('coOwnerIds', 'name').populate('projectId', 'name').populate('clientId', 'name').populate('approverId', 'name').sort('-createdAt').limit(5000).lean();
  const D = (d: any) => (d ? new Date(d).toISOString().slice(0, 10) : '');
  const rows = tasks.map((t) => ({
    title: t.title, status: STATUS_LABEL[(normaliseStatus(t.status) || 'open') as keyof typeof STATUS_LABEL], percent: t.percentComplete ?? 0, owners: [t.ownerId?.name, ...(t.coOwnerIds || []).map((u: any) => u.name)].filter(Boolean).join('; '),
    project: t.projectId?.name || '', client: t.clientId?.name || '', priority: t.priority, severity: t.severity, start: D(t.startDate), due: D(t.endDate || t.dueDate), reviewer: t.approverId?.name || '',
    created: D(t.createdAt), createdBy: t.createdBy?.name || '', modified: D(t.updatedAt), modifiedBy: t.updatedBy?.name || '', modifiedFrom: [t.updatedFrom?.device, t.updatedFrom?.ip].filter(Boolean).join(' '),
  }));
  const cols = [['title', 'Task'], ['status', 'Status'], ['percent', '% complete'], ['owners', 'Owners'], ['project', 'Project'], ['client', 'Client'], ['priority', 'Priority'], ['severity', 'Severity'], ['start', 'Start date'], ['due', 'Due date'], ['reviewer', 'Reviewer'], ['created', 'Date created'], ['createdBy', 'Created by'], ['modified', 'Date modified'], ['modifiedBy', 'Modified by'], ['modifiedFrom', 'Modified from']].map(([key, label]) => ({ key, label }));
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', 'attachment; filename="tasks.csv"');
  res.send(toCsv(cols, rows));
});

export const getTask = asyncHandler(async (req: Request, res: Response) => {
  const { task, scope } = await loadTask(req);
  await task.populate([
    { path: 'ownerId', select: 'name avatarUrl email jobTitle' },
    { path: 'coOwnerIds', select: 'name avatarUrl jobTitle' },
    { path: 'reviewerId', select: 'name' },
    { path: 'testerId', select: 'name' },
    { path: 'hold.awaitingUserId', select: 'name' },
    { path: 'closedById', select: 'name' },
    { path: 'creatorId', select: 'name' },
    { path: 'approverId', select: 'name' },
    { path: 'sharedWith', select: 'name' },
    { path: 'projectId', select: 'name projectManagerId team status' },
    { path: 'clientId', select: 'name' },
    { path: 'comments.authorId', select: 'name avatarUrl' },
    { path: 'comments.requestedFromId', select: 'name' },
    { path: 'parentTaskId', select: 'title' },
    { path: 'evidence.uploadedById', select: 'name' },
    { path: 'documents.uploadedById', select: 'name' },
    { path: 'approval.decidedById', select: 'name' },
    { path: 'approval.submittedById', select: 'name' },
  ]);
  const orgId = req.user!.organizationId;
  const [subtasks, risks, meetings, linked, blocking] = await Promise.all([
    Task.find(excludeDeleted({ parentTaskId: task._id })).populate('ownerId', 'name').sort('createdAt'),
    Risk.find(excludeDeleted({ organizationId: orgId, relatedTaskId: task._id })).populate('ownerId', 'name').sort('-createdAt'),
    Meeting.find(excludeDeleted({ organizationId: orgId, taskId: task._id })).select('title date provider status recording.uploaded recording.reminderEnabled').sort('-date'),
    (task as any).hold?.linkedTaskId ? Task.findById((task as any).hold.linkedTaskId).select('title status ownerId').populate('ownerId', 'name') : null,
    (task as any).unblocksTaskId ? Task.findById((task as any).unblocksTaskId).select('title status').lean() : null,
  ]);
  let milestone: any = null;
  const proj: any = task.projectId;
  if (proj && task.milestoneId) {
    const full = await Project.findById(proj._id).select('milestones');
    const m: any = full?.milestones.id(task.milestoneId);
    if (m) milestone = { _id: m._id, title: m.title, severity: m.severity, status: m.status };
  }
  const o: any = presentTask(task, scope);
  // Open update requests = requests with no later update from the person asked.
  const openRequests = (o.comments || []).filter((c: any) => c.kind === 'update_request' && !(o.comments || []).some((u: any) => u.kind === 'update' && oid(u.authorId) === oid(c.requestedFromId) && new Date(u.createdAt) > new Date(c.createdAt))).length;
  res.json({
    success: true,
    data: { ...o, waitingOnTask: linked, unblocksTask: blocking, subtasks: subtasks.map((s) => presentTask(s, scope)).filter((s: any) => s.permissions.view), risks, meetings, milestone, openUpdateRequests: openRequests, needsApproval: needsApproval(o) },
  });
});

export const kanbanBoard = asyncHandler(async (req: Request, res: Response) => {
  const scope = await scopeFor(req);
  const and: Record<string, unknown>[] = [{ organizationId: req.user!.organizationId }, { parentTaskId: { $exists: false } }, visibleTasksFilter(scope)];
  if (req.query.projectId) and.push({ projectId: req.query.projectId });
  if (req.query.scope === 'mine') and.push(ownedBy(req.user!.id));
  const range = rangeFromQuery(req.query as any);
  if (range) and.push(overlapFilter(range));
  const tasks = await Task.find(excludeDeleted({ $and: and })).select('-activityHistory -comments').populate('ownerId', 'name avatarUrl').populate('coOwnerIds', 'name').sort('priority');
  const board = Object.fromEntries(TASK_STATUSES.map((c) => [c, tasks.filter((t) => normaliseStatus(t.status) === c).map((t) => presentTask(t, scope))]));
  res.json({ success: true, data: board });
});

/* ----------------------------------------------------------------------------
 * Create / update / delete
 * -------------------------------------------------------------------------- */
/** Resolve the owner list: first = primary owner, the rest are co-owners. Everyone must be an active person in the organisation. */
async function resolveOwners(orgId: string, d: { ownerId?: string; ownerIds?: string[] }, fallback: string): Promise<{ ownerId: string; coOwnerIds: string[] }> {
  const list = Array.from(new Set([...(d.ownerIds?.length ? d.ownerIds : d.ownerId ? [d.ownerId] : [fallback])]));
  const found = await User.find({ _id: { $in: list }, organizationId: orgId, isActive: true }).select('_id');
  if (found.length !== list.length) throw ApiError.badRequest('One or more owners were not found in your organisation');
  return { ownerId: list[0], coOwnerIds: list.slice(1) };
}

/** Tell the project / milestone team (and everyone following the task) about a task event. Respects each person's notification settings. */
async function tellAudience(req: Request, task: any, title: string, summary: string, opts: { exclude?: string[]; email?: boolean; note?: string } = {}) {
  const everyone = (await taskAudience(task)).filter((x) => x !== req.user!.id && !(opts.exclude || []).includes(x));
  if (!everyone.length) return;
  await notifyWork({
    organizationId: req.user!.organizationId, userIds: everyone, title, summary, note: opts.note, rows: taskRows(task, [['By', req.user!.name]]), link: link(task._id), cta: 'Open task',
    type: 'task', category: 'task_updates', email: !!opts.email, entity: { type: 'task', id: String(task._id) },
  });
}

export const createTask = asyncHandler(async (req: Request, res: Response) => {
  const d = createSchema.parse(req.body);
  const orgId = req.user!.organizationId;
  const me = req.user!.id;
  const { project, parent } = await validateLinks(orgId, d);
  const owners = await resolveOwners(orgId, d, me);
  await assertActiveUser(orgId, d.approverId, 'Approver');
  const end = d.endDate ?? d.dueDate;
  checkDates(d.startDate, end);

  const severity = d.severity || 'minor';
  const status = d.status || 'open';
  const task = new Task({
    organizationId: orgId,
    title: d.title,
    description: d.description,
    ownerId: owners.ownerId,
    coOwnerIds: owners.coOwnerIds,
    creatorId: me,
    approverId: d.approverId,
    testerId: d.testerId,
    department: d.department,
    priority: d.priority || 'medium',
    severity,
    status,
    percentComplete: 0,
    projectId: parent?.projectId || d.projectId,
    milestoneId: parent?.milestoneId || d.milestoneId,
    clientId: d.clientId || parent?.clientId || project?.clientId,
    parentTaskId: d.parentTaskId,
    confidential: parent ? !!parent.confidential : !!d.confidential,
    dependencies: d.dependencies,
    tags: d.tags,
    reminderAt: d.reminderAt,
    recurrence: d.recurrence,
    acceptanceCriteria: toCriteria(d.acceptanceCriteria),
    requireEvidence: d.requireEvidence ?? (SEV_NEEDS_EVIDENCE.has(severity) || !!d.milestoneId),
    activityHistory: [{ actorId: me, action: 'created' }],
    statusHistory: [{ from: '', to: status, percent: 0, comment: d.statusComment, byId: me, byName: req.user!.name, at: new Date(), ip: req.ip, device: deviceLabel(String(req.headers['user-agent'] || '')) }],
  });
  syncDates(task, { startDate: d.startDate, endDate: d.endDate, dueDate: d.dueDate });
  await task.save();
  await audit(req, 'task.created', 'Task', String(task._id), { module: 'tasks', summary: `Created task "${task.title}"`, meta: { owners: [owners.ownerId, ...owners.coOwnerIds], parentTaskId: d.parentTaskId, confidential: task.confidential } });

  // The opening comment is the first entry in the task's thread.
  const actor = { id: me, name: req.user!.name, role: req.user!.role, organizationId: orgId, modules: req.user!.modules };
  const entity = await loadEntity(actor, 'task', String(task._id));
  await postComment({ actor, entity, kind: 'status', status: { from: '', to: status, percent: 0 }, body: d.statusComment, notify: 'none', from: { ip: req.ip, device: deviceLabel(String(req.headers['user-agent'] || '')) } });

  // Owners hear it as an assignment; the rest of the project / milestone hears it as news.
  const creator = req.user!.name;
  const assignees = [owners.ownerId, ...owners.coOwnerIds].filter((x) => x !== me);
  if (assignees.length) {
    await notifyWork({
      organizationId: orgId, userIds: assignees, title: task.parentTaskId ? 'A subtask was assigned to you' : 'A task was assigned to you',
      summary: `${creator} assigned you "${task.title}"${owners.coOwnerIds.length ? ` together with ${owners.coOwnerIds.length} other${owners.coOwnerIds.length === 1 ? '' : 's'}` : ''}.`, rows: taskRows(task, [['Project', project?.name], ['Assigned by', creator]]), note: d.statusComment, link: link(task._id), cta: 'Open task',
      severity: ['critical', 'show_stopper'].includes(severity) ? 'high' : 'info', type: 'task', entity: { type: 'task', id: String(task._id) },
    });
  }
  if (d.notifyAudience !== false) await tellAudience(req, task, `New task: ${task.title}`, `${creator} created "${task.title}"${project ? ` in ${project.name}` : ''}.`, { exclude: assignees, note: d.statusComment });
  res.status(201).json({ success: true, data: task });
});

const WATCHED = ['title', 'description', 'priority', 'severity', 'startDate', 'endDate', 'dueDate', 'projectId', 'milestoneId', 'department', 'approverId', 'testerId'];

export const updateTask = asyncHandler(async (req: Request, res: Response) => {
  const { task, perms } = await loadTask(req);
  if (!perms.edit) throw ApiError.forbidden('You do not have permission to edit this task');
  if ((req.body || {}).status !== undefined) throw ApiError.badRequest('Change the status with the status action so a comment is recorded.');
  const d = updateSchema.parse(req.body);
  const orgId = req.user!.organizationId;

  if (!perms.manage) {
    const blocked = Object.keys(d).filter((k) => (d as any)[k] !== undefined && !OWNER_FIELDS.has(k));
    if (blocked.length) throw ApiError.forbidden(`Only the task creator, approver, project manager or leadership can change: ${blocked.join(', ')}`);
  }
  const prevOwners = ownersOf(task);

  if (d.approverId) await assertActiveUser(orgId, d.approverId, 'Approver');
  if (d.projectId !== undefined || d.milestoneId !== undefined || d.parentTaskId !== undefined) {
    await validateLinks(orgId, { projectId: d.projectId ?? oid(task.projectId), milestoneId: d.milestoneId ?? (d.projectId ? undefined : oid(task.milestoneId)), parentTaskId: d.parentTaskId });
  }
  checkDates(d.startDate ?? (task.startDate as any), d.endDate ?? d.dueDate ?? (task.endDate as any));

  const before: Record<string, any> = {};
  for (const k of WATCHED) before[k] = String(oid((task as any)[k]) || (task as any)[k] || '');
  const { startDate, endDate, dueDate, acceptanceCriteria, ownerId, ownerIds, ...rest } = d as any;
  for (const [k, v] of Object.entries(rest)) if (v !== undefined) (task as any)[k] = v;
  if (ownerId !== undefined || ownerIds !== undefined) {
    const o = await resolveOwners(orgId, { ownerId, ownerIds }, oid(task.ownerId));
    task.ownerId = o.ownerId as any; task.set('coOwnerIds', o.coOwnerIds);
  }
  if (acceptanceCriteria) task.set('acceptanceCriteria', toCriteria(acceptanceCriteria));
  syncDates(task, { startDate, endDate, dueDate });
  if (d.confidential === true) task.set('sharedWith', []); // confidential tasks lose their share list

  const nowOwners = ownersOf(task);
  const added = nowOwners.filter((x) => !prevOwners.includes(x));
  const removed = prevOwners.filter((x) => !nowOwners.includes(x));
  if (added.length || removed.length) task.activityHistory.push({ actorId: req.user!.id as any, action: 'owners_changed', meta: { added, removed } } as any);
  const changed = WATCHED.filter((k) => before[k] !== String(oid((task as any)[k]) || (task as any)[k] || ''));
  await task.save();
  if (d.confidential === true) {
    // Subtasks follow their parent's confidentiality.
    await Task.updateMany({ parentTaskId: task._id }, { $set: { confidential: true, sharedWith: [] } });
  }
  await audit(req, 'task.updated', 'Task', String(task._id), { module: 'tasks', summary: `Updated task "${task.title}"`, meta: { fields: Object.keys(d) } });

  const me = req.user!.id;
  const newcomers = added.filter((x) => x !== me);
  if (newcomers.length) await notifyWork({ organizationId: orgId, userIds: newcomers, title: 'You were added to a task', summary: `${req.user!.name} added you as an owner of "${task.title}".`, rows: taskRows(task), link: link(task._id), cta: 'Open task', type: 'task', entity: { type: 'task', id: String(task._id) } });
  if (removed.filter((x) => x !== me).length) await notifyWork({ organizationId: orgId, userIds: removed.filter((x) => x !== me), title: 'You were removed from a task', summary: `${req.user!.name} removed you from "${task.title}".`, link: link(task._id), email: false, type: 'task', entity: { type: 'task', id: String(task._id) } });
  if (changed.length) await tellAudience(req, task, `Task updated: ${task.title}`, `${req.user!.name} changed ${changed.map((c) => c.replace(/([A-Z])/g, ' $1').toLowerCase()).join(', ')} on "${task.title}".`, { exclude: newcomers });
  res.json({ success: true, data: task });
});

/** Move a task to another status. Always needs a comment; some statuses need more (hold reason, new date, evidence, the right person). */
export const changeTaskStatus = asyncHandler(async (req: Request, res: Response) => {
  const { task, perms } = await loadTask(req);
  const d = statusSchema.parse(req.body);
  if (!perms.edit && !perms.isReviewer) throw ApiError.forbidden('You do not have permission to change this task');
  const actor = { id: req.user!.id, name: req.user!.name, role: req.user!.role, organizationId: req.user!.organizationId, modules: req.user!.modules };
  if (d.evidence?.length) {
    for (const e of d.evidence) task.evidence.push({ ...e, kind: e.kind || 'evidence', uploadedById: req.user!.id } as any);
  }
  await changeStatus({
    task, actor, to: d.status, comment: d.comment, percent: d.percent, hold: d.hold as any, newDate: d.newDate, testerId: d.testerId,
    from: { ip: req.ip, device: deviceLabel(String(req.headers['user-agent'] || '')) }, isReviewer: perms.isReviewer || perms.approve, isManager: perms.manage, evidenceAdded: d.evidence?.length || 0,
  });
  await audit(req, 'task.status_changed', 'Task', String(task._id), { module: 'tasks', summary: `"${task.title}" → ${STATUS_LABEL[d.status]}`, meta: { to: d.status } });
  res.json({ success: true, data: presentTask(task, await scopeFor(req)) });
});

/** Move the progress bar. Reaching 100% sends the task for review. */
export const setProgress = asyncHandler(async (req: Request, res: Response) => {
  const { task, perms } = await loadTask(req);
  if (!perms.edit) throw ApiError.forbidden('Only the people doing this work can update its progress');
  const d = z.object({ percent: z.number().min(0).max(100), comment: z.string().trim().max(5000).optional() }).parse(req.body);
  if (!['open', 'in_progress', 'delayed', 'to_be_tested'].includes(task.status)) throw ApiError.badRequest(`Progress cannot be changed while a task is ${STATUS_LABEL[task.status as keyof typeof STATUS_LABEL].toLowerCase()}.`);
  const actor = { id: req.user!.id, name: req.user!.name, role: req.user!.role, organizationId: req.user!.organizationId, modules: req.user!.modules };
  const from = { ip: req.ip, device: deviceLabel(String(req.headers['user-agent'] || '')) };
  if (d.percent >= 100) {
    await changeStatus({ task, actor, to: 'to_be_reviewed', comment: d.comment || 'Finished — sent for review.', percent: 100, from, isManager: perms.manage, isReviewer: false });
    return res.json({ success: true, data: { movedToReview: true, task: presentTask(task, await scopeFor(req)) } });
  }
  if (task.status === 'open' || task.status === 'delayed') {
    await changeStatus({ task, actor, to: 'in_progress', comment: d.comment || `Started — ${Math.round(d.percent)}% done.`, percent: d.percent, from, isManager: perms.manage, isReviewer: false });
  } else {
    const prev = task.percentComplete || 0;
    task.percentComplete = Math.round(d.percent);
    task.statusHistory.push({ from: task.status, to: task.status, percent: task.percentComplete, comment: d.comment || `Progress ${prev}% → ${task.percentComplete}%`, byId: req.user!.id as any, byName: req.user!.name, at: new Date(), ip: from.ip, device: from.device } as any);
    task.activityHistory.push({ actorId: req.user!.id as any, action: 'progress', meta: { from: prev, to: task.percentComplete } } as any);
    await task.save();
    if (d.comment) { const entity = await loadEntity(actor, 'task', String(task._id)); await postComment({ actor, entity, kind: 'status', status: { from: 'in_progress', to: 'in_progress', percent: task.percentComplete }, body: d.comment, notify: 'mentioned', from }); }
  }
  res.json({ success: true, data: { movedToReview: false, task: presentTask(task, await scopeFor(req)) } });
});

export const deleteTask = asyncHandler(async (req: Request, res: Response) => {
  const { task, perms } = await loadTask(req);
  if (!perms.delete) throw ApiError.forbidden('You do not have permission to delete this task');
  await (task as any).softDelete(req.user!.id);
  const subtasks = await Task.find(excludeDeleted({ parentTaskId: task._id }));
  await Promise.all(subtasks.map((s: any) => s.softDelete(req.user!.id)));
  await audit(req, 'task.deleted', 'Task', String(task._id), { module: 'tasks', severity: 'medium', summary: `Deleted task "${task.title}"`, meta: { subtasks: subtasks.length } });
  res.json({ success: true, data: { id: req.params.id, softDeleted: true, subtasksDeleted: subtasks.length } });
});

export const restoreTask = asyncHandler(async (req: Request, res: Response) => {
  const task = await Task.findOne({ _id: req.params.id, organizationId: req.user!.organizationId, isDeleted: true });
  if (!task) throw ApiError.notFound('Deleted task not found');
  const scope = await scopeFor(req);
  const perms = taskPermissions(scope, task);
  if (!perms.delete && !isLeader(scope.actor)) throw ApiError.forbidden('You do not have permission to restore this task');
  await (task as any).restore();
  await audit(req, 'task.restored', 'Task', String(task._id), { module: 'tasks', summary: `Restored task "${task.title}"` });
  res.json({ success: true, data: task });
});

/* ----------------------------------------------------------------------------
 * Comments, updates and update requests
 * -------------------------------------------------------------------------- */
const commentSchema = z.object({ body: z.string().trim().min(1, 'Write something first').max(5000), attachments: z.array(z.object({ name: z.string().max(200), url: urlIn })).max(10).optional() });

function interestedPeople(task: any, exclude: string): string[] {
  return Array.from(new Set([oid(task.creatorId), oid(task.approverId), oid(task.reviewerId), ...ownersOf(task), ...(task.sharedWith || []).map(oid)].filter((x) => x && x !== exclude)));
}

export const addComment = asyncHandler(async (req: Request, res: Response) => {
  const { task } = await loadTask(req);
  const d = commentSchema.parse(req.body);
  const actor = { id: req.user!.id, name: req.user!.name, role: req.user!.role, organizationId: req.user!.organizationId, modules: req.user!.modules };
  const entity = await loadEntity(actor, 'task', String(task._id));
  const c = await postComment({ actor, entity, body: d.body, attachments: d.attachments, notify: 'all', from: { ip: req.ip, device: deviceLabel(String(req.headers['user-agent'] || '')) } });
  res.status(201).json({ success: true, data: c });
});

/** A progress update ("what has been done, by whom, latest"). Optionally moves the task along. */
export const postUpdate = asyncHandler(async (req: Request, res: Response) => {
  const { task, perms } = await loadTask(req);
  if (!perms.edit && !perms.isOwner) throw ApiError.forbidden('Only people working on this task can post updates');
  const d = commentSchema.extend({ blocker: z.boolean().optional() }).parse(req.body);
  const c = { authorId: req.user!.id, body: d.body, kind: d.blocker ? 'blocker' : 'update', attachments: d.attachments };
  task.comments.push(c as any);
  task.activityHistory.push({ actorId: req.user!.id as any, action: d.blocker ? 'blocker_reported' : 'update_posted' } as any);
  if (task.status === 'open') { task.status = 'in_progress'; task.statusHistory.push({ from: 'open', to: 'in_progress', percent: task.percentComplete, comment: 'Started — first update posted.', byId: req.user!.id as any, byName: req.user!.name, at: new Date() } as any); }
  await task.save();

  // Anyone who asked this person for an update gets it by e-mail; the task's other stakeholders get an in-app note.
  const requesters = Array.from(new Set(task.comments.filter((x: any) => x.kind === 'update_request' && oid(x.requestedFromId) === req.user!.id && x !== c).map((x: any) => oid(x.authorId)).filter((x: string) => x && x !== req.user!.id)));
  if (requesters.length) await notifyWork({ organizationId: req.user!.organizationId, userIds: requesters, title: `Update on "${task.title}"`, summary: `${req.user!.name} posted the update you asked for.`, rows: taskRows(task), note: d.body, link: link(task._id), cta: 'Read update', dedupeKey: `taskupd:${task._id}:${req.user!.id}:${Math.floor(Date.now() / 600000)}` });
  const others = interestedPeople(task, req.user!.id).filter((x) => !requesters.includes(x));
  if (others.length) await notifyWork({ organizationId: req.user!.organizationId, userIds: others, title: d.blocker ? 'Blocker reported on a task' : 'Task update', summary: `${req.user!.name} ${d.blocker ? 'reported a blocker on' : 'posted an update on'} "${task.title}".`, note: d.body, noteTone: d.blocker ? 'warn' : 'info', link: link(task._id), email: !!d.blocker });
  res.status(201).json({ success: true, data: task.comments[task.comments.length - 1] });
});

export const requestUpdate = asyncHandler(async (req: Request, res: Response) => {
  const { task } = await loadTask(req);
  const d = z.object({ userId: oidStr, message: z.string().trim().max(1000).optional() }).parse(req.body);
  const target = d.userId || oid(task.ownerId);
  if (target === req.user!.id) throw ApiError.badRequest('You cannot ask yourself for an update');
  await assertActiveUser(req.user!.organizationId, target, 'Person');
  // The person asked must be able to see the task — we never expose a task through an update request.
  const targetUser = await User.findById(target).select('role organizationId');
  const targetScope = await loadScope({ id: target, role: targetUser!.role, organizationId: String(targetUser!.organizationId) });
  if (!canViewTask(targetScope, task)) throw ApiError.badRequest(task.confidential ? 'This task is confidential and cannot be shared with that person' : 'That person does not have access to this task. Share it with them first.');

  task.comments.push({ authorId: req.user!.id, body: d.message || 'Could you post a quick update on this?', kind: 'update_request', requestedFromId: target } as any);
  task.activityHistory.push({ actorId: req.user!.id as any, action: 'update_requested', meta: { from: target } } as any);
  await task.save();
  const sent = await notifyWork({
    organizationId: req.user!.organizationId, userIds: [target], title: `Update requested: ${task.title}`,
    summary: `${req.user!.name} is asking for an update on "${task.title}".`, rows: taskRows(task, [['Requested by', req.user!.name]]), note: d.message, link: link(task._id), cta: 'Post update',
    dedupeKey: `taskreq:${task._id}:${target}:${Math.floor(Date.now() / 600000)}`, // at most one nudge per person per task every 10 minutes
  });
  res.status(201).json({ success: true, data: { notified: sent > 0, message: sent > 0 ? 'Update requested.' : 'They were already asked a few minutes ago — the request is recorded on the task.' } });
});

/* ----------------------------------------------------------------------------
 * Share (in-app or e-mail) — never for confidential tasks
 * -------------------------------------------------------------------------- */
export const shareTask = asyncHandler(async (req: Request, res: Response) => {
  const { task, perms } = await loadTask(req);
  if (task.confidential) throw ApiError.forbidden('Confidential tasks cannot be shared');
  if (!perms.share) throw ApiError.forbidden('You cannot share this task');
  const d = z.object({
    userIds: z.array(z.string().regex(/^[a-f\d]{24}$/i)).max(25).default([]),
    emails: z.array(z.string().email().max(200)).max(10).default([]),
    via: z.enum(['app', 'email', 'both']).default('both'),
    message: z.string().trim().max(1000).optional(),
  }).parse(req.body);
  if (!d.userIds.length && !d.emails.length) throw ApiError.badRequest('Choose at least one person or e-mail address');
  if (d.via === 'app' && d.emails.length) throw ApiError.badRequest('People outside the app can only be reached by e-mail');
  const orgId = req.user!.organizationId;

  const users = await User.find({ _id: { $in: d.userIds }, organizationId: orgId, isActive: true }).select('name email');
  if (users.length !== new Set(d.userIds).size) throw ApiError.badRequest('One or more people were not found');
  const ids = users.map((u) => String(u._id));

  // Sharing in-app gives the person read access to this task.
  const already = new Set((task.sharedWith || []).map(oid));
  ids.forEach((i) => already.add(i));
  task.set('sharedWith', Array.from(already));
  task.activityHistory.push({ actorId: req.user!.id as any, action: 'shared', meta: { users: ids.length, emails: d.emails.length, via: d.via } } as any);
  await task.save();

  const rows = taskRows(task, [['Shared by', req.user!.name], ['Assigned to', (await User.findById(task.ownerId).select('name'))?.name]]);
  if (d.via !== 'email' && ids.length) {
    await notifyWork({ organizationId: orgId, userIds: ids, title: 'A task was shared with you', summary: `${req.user!.name} shared "${task.title}" with you.`, note: d.message, rows, link: link(task._id), cta: 'Open task', email: d.via === 'both' });
  } else if (d.via === 'email' && ids.length) {
    await notifyWork({ organizationId: orgId, userIds: ids, title: 'A task was shared with you', summary: `${req.user!.name} shared "${task.title}" with you.`, note: d.message, rows, link: link(task._id), cta: 'Open task', type: 'task', email: true });
  }
  // People outside the system get a read-only summary — no link into the app, no confidential detail.
  if (d.emails.length) {
    const m = renderEmail({ title: `Task shared: ${task.title}`, intro: esc(`${req.user!.name} shared a task with you.`), body: `${kvTable(rows)}${d.message ? callout(esc(d.message).replace(/\n/g, '<br>')) : ''}` });
    await Promise.all(d.emails.map((to) => sendMail({ to, subject: `Task shared: ${task.title}`, html: m.html, attachments: m.attachments }).catch((err) => logger.warn({ err, to }, 'task share e-mail failed'))));
  }
  await audit(req, 'task.shared', 'Task', String(task._id), { module: 'tasks', summary: `Shared task "${task.title}"`, meta: { users: ids.length, externalEmails: d.emails.length, via: d.via } });
  res.json({ success: true, data: { sharedWith: ids.length, emailed: d.emails.length } });
});

export const unshareTask = asyncHandler(async (req: Request, res: Response) => {
  const { task, perms } = await loadTask(req);
  if (!perms.manage) throw ApiError.forbidden('Only the creator, approver, project manager or leadership can remove access');
  task.set('sharedWith', (task.sharedWith || []).filter((x: any) => oid(x) !== req.params.userId));
  await task.save();
  await audit(req, 'task.unshared', 'Task', String(task._id), { module: 'tasks', summary: `Removed shared access on "${task.title}"` });
  res.json({ success: true, data: { ok: true } });
});

/* ----------------------------------------------------------------------------
 * Documents (files, recordings, images, links) and evidence
 * -------------------------------------------------------------------------- */
export const addDocument = asyncHandler(async (req: Request, res: Response) => {
  const { task, perms } = await loadTask(req);
  if (!perms.edit && task.confidential) throw ApiError.forbidden('You cannot add documents to this task');
  const d = docIn.parse(req.body);
  task.documents.push({ ...d, kind: d.kind || 'file', uploadedById: req.user!.id } as any);
  task.activityHistory.push({ actorId: req.user!.id as any, action: 'document_added', meta: { name: d.name, kind: d.kind } } as any);
  await task.save();
  await audit(req, 'task.document_added', 'Task', String(task._id), { module: 'tasks', summary: `Added ${d.kind || 'file'} "${d.name}" to "${task.title}"` });
  res.status(201).json({ success: true, data: task.documents[task.documents.length - 1] });
});

export const removeDocument = asyncHandler(async (req: Request, res: Response) => {
  const { task, perms } = await loadTask(req);
  const doc: any = task.documents.id(req.params.docId);
  if (!doc) throw ApiError.notFound('Document not found');
  if (!perms.manage && oid(doc.uploadedById) !== req.user!.id) throw ApiError.forbidden('Only the uploader or a task manager can remove this');
  doc.deleteOne();
  await task.save();
  await audit(req, 'task.document_removed', 'Task', String(task._id), { module: 'tasks', summary: `Removed document from "${task.title}"` });
  res.json({ success: true, data: { ok: true } });
});

export const addEvidence = asyncHandler(async (req: Request, res: Response) => {
  const { task, perms } = await loadTask(req);
  if (!perms.edit) throw ApiError.forbidden('Only the people doing this work can attach evidence');
  if (['complete', 'closed', 'to_be_reviewed'].includes(task.status)) throw ApiError.badRequest('Evidence is locked while the task is awaiting approval or done');
  const d = docIn.parse(req.body);
  task.evidence.push({ ...d, kind: d.kind || 'evidence', uploadedById: req.user!.id } as any);
  task.activityHistory.push({ actorId: req.user!.id as any, action: 'evidence_added', meta: { name: d.name } } as any);
  await task.save();
  await audit(req, 'task.evidence_added', 'Task', String(task._id), { module: 'tasks', summary: `Evidence "${d.name}" added to "${task.title}"` });
  res.status(201).json({ success: true, data: task.evidence[task.evidence.length - 1] });
});

export const removeEvidence = asyncHandler(async (req: Request, res: Response) => {
  const { task, perms } = await loadTask(req);
  if (['complete', 'closed', 'to_be_reviewed'].includes(task.status)) throw ApiError.badRequest('Evidence is locked while the task is awaiting approval or done');
  const ev: any = task.evidence.id(req.params.evidenceId);
  if (!ev) throw ApiError.notFound('Evidence not found');
  if (!perms.manage && oid(ev.uploadedById) !== req.user!.id) throw ApiError.forbidden('Only the uploader or a task manager can remove this');
  ev.deleteOne();
  await task.save();
  await audit(req, 'task.evidence_removed', 'Task', String(task._id), { module: 'tasks', severity: 'medium', summary: `Evidence removed from "${task.title}"` });
  res.json({ success: true, data: { ok: true } });
});

export const setCriterion = asyncHandler(async (req: Request, res: Response) => {
  const { task, perms } = await loadTask(req);
  if (!perms.edit) throw ApiError.forbidden('You cannot change this task');
  if (['complete', 'closed', 'to_be_reviewed'].includes(task.status) && !perms.approve) throw ApiError.badRequest('Criteria are locked while the task awaits approval');
  const { met } = z.object({ met: z.boolean() }).parse(req.body);
  const c: any = task.acceptanceCriteria.id(req.params.criterionId);
  if (!c) throw ApiError.notFound('Criterion not found');
  c.met = met;
  task.activityHistory.push({ actorId: req.user!.id as any, action: met ? 'criterion_met' : 'criterion_unmet', meta: { text: c.text } } as any);
  await task.save();
  res.json({ success: true, data: c });
});

/* ----------------------------------------------------------------------------
 * Submit → approve / reject
 * -------------------------------------------------------------------------- */
export const submitTask = asyncHandler(async (req: Request, res: Response) => {
  const { task, perms } = await loadTask(req);
  if (!perms.submit) throw ApiError.forbidden('You cannot submit this task');
  const { note } = z.object({ note: z.string().trim().max(5000).optional() }).parse(req.body);
  const actor = { id: req.user!.id, name: req.user!.name, role: req.user!.role, organizationId: req.user!.organizationId, modules: req.user!.modules };
  await changeStatus({ task, actor, to: 'to_be_reviewed', comment: note && note.length >= 3 ? note : 'Finished — submitted for review with evidence.', percent: 100, from: { ip: req.ip, device: deviceLabel(String(req.headers['user-agent'] || '')) }, isManager: perms.manage, isReviewer: false });
  await audit(req, 'task.submitted', 'Task', String(task._id), { module: 'tasks', summary: `Submitted "${task.title}" for review`, meta: { reviewer: oid(task.reviewerId), evidence: task.evidence.length } });
  res.json({ success: true, data: task });
});

export const approveTask = asyncHandler(async (req: Request, res: Response) => {
  const { task, perms } = await loadTask(req);
  if (!perms.approve) throw ApiError.forbidden('Only the reviewer can approve this task, and never the person who did the work');
  const { note, ribbon } = z.object({ note: z.string().trim().max(2000).optional(), ribbon: z.string().trim().max(60).optional() }).parse(req.body);
  const problems = submissionProblems({ requireEvidence: task.requireEvidence, evidenceCount: task.evidence.length, criteria: task.acceptanceCriteria as any });
  if (problems.length) throw new ApiError(422, 'This task no longer meets its completion rules', { problems });
  const end = task.endDate || task.dueDate;
  const onTime = !end || new Date() <= new Date(new Date(end).getTime() + 86400000);
  task.approval = {
    ...(task.approval as any)?.toObject?.() ?? {},
    status: 'approved', decidedById: req.user!.id as any, decidedAt: new Date(), decisionNote: note,
    certificateNo: certificateNumber('TASK'), ribbon: ribbon || ribbonFor({ severity: task.severity, onTime, evidenceCount: task.evidence.length }),
  } as any;
  const actor = { id: req.user!.id, name: req.user!.name, role: req.user!.role, organizationId: req.user!.organizationId, modules: req.user!.modules };
  await changeStatus({ task, actor, to: 'complete', comment: note && note.length >= 3 ? note : 'Reviewed and approved.', from: { ip: req.ip, device: deviceLabel(String(req.headers['user-agent'] || '')) }, isReviewer: true, isManager: perms.manage });
  task.activityHistory.push({ actorId: req.user!.id as any, action: 'approved', meta: { certificateNo: (task.approval as any).certificateNo } } as any);
  await task.save();
  await audit(req, 'task.approved', 'Task', String(task._id), { module: 'tasks', summary: `Approved "${task.title}"`, meta: { certificateNo: (task.approval as any).certificateNo } });
  const people = Array.from(new Set([...ownersOf(task), oid(task.creatorId)].filter((x) => x && x !== req.user!.id)));
  if (people.length) await notifyWork({ organizationId: req.user!.organizationId, userIds: people, title: `Approved: ${task.title}`, summary: `${req.user!.name} approved "${task.title}". It is now complete; the project owner can close it.`, rows: taskRows(task, [['Ribbon', (task.approval as any).ribbon], ['Certificate no.', (task.approval as any).certificateNo]]), note, link: link(task._id), cta: 'View certificate', type: 'task' });
  res.json({ success: true, data: task });
});

export const rejectTask = asyncHandler(async (req: Request, res: Response) => {
  const { task, perms } = await loadTask(req);
  if (!perms.approve) throw ApiError.forbidden('Only the reviewer can send this task back');
  const { note } = z.object({ note: z.string().trim().min(3, 'Tell them what needs to change').max(2000) }).parse(req.body);
  const actor = { id: req.user!.id, name: req.user!.name, role: req.user!.role, organizationId: req.user!.organizationId, modules: req.user!.modules };
  await changeStatus({ task, actor, to: 'in_progress', comment: note, percent: 90, from: { ip: req.ip, device: deviceLabel(String(req.headers['user-agent'] || '')) }, isReviewer: true, isManager: perms.manage });
  await audit(req, 'task.sent_back', 'Task', String(task._id), { module: 'tasks', summary: `Sent "${task.title}" back for more work` });
  res.json({ success: true, data: task });
});

export const taskCertificate = asyncHandler(async (req: Request, res: Response) => {
  const { task } = await loadTask(req);
  const a: any = { ...((task.approval as any)?.toObject?.() ?? task.approval ?? {}) };
  const completed = isFinished(task.status);
  if (a.status !== 'approved' || !a.certificateNo) {
    // Work finished before approvals existed (or without needing them) still gets a certificate — just not an "approved by" one.
    if (!completed) throw ApiError.badRequest('A certificate is issued once the task is completed. Submit it for approval first if it needs sign-off.');
    a.certificateNo = a.certificateNo || `SJX-TASK-${new Date(task.completedAt || Date.now()).getUTCFullYear()}-${String(task._id).slice(-6).toUpperCase()}`;
    a.ribbon = a.ribbon || 'Completed';
    a.decidedAt = a.decidedAt || task.completedAt;
  }
  const [owner, approver, project] = await Promise.all([
    User.findById(task.ownerId).select('name'),
    User.findById(a.decidedById).select('name'),
    task.projectId ? Project.findById(task.projectId).select('name') : null,
  ]);
  const pdf = await certificatePdf({ kind: 'Task', title: task.title, recipient: owner?.name || 'Team member', approver: approver?.name || 'Approver', project: (project as any)?.name, certificateNo: a.certificateNo, ribbon: a.ribbon, completedAt: task.completedAt, approvedAt: a.decidedAt, evidenceCount: task.evidence.length, note: a.decisionNote });
  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', `attachment; filename="certificate-${a.certificateNo}.pdf"`);
  res.send(pdf);
});

/* ----------------------------------------------------------------------------
 * Risks / blockers raised from a task
 * -------------------------------------------------------------------------- */
export const raiseTaskRisk = asyncHandler(async (req: Request, res: Response) => {
  const { task } = await loadTask(req);
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
  await assertActiveUser(req.user!.organizationId, d.ownerId, 'Risk owner');
  const proj: any = task.projectId ? await Project.findById(task.projectId).select('projectManagerId name') : null;
  const risk = await Risk.create({
    organizationId: req.user!.organizationId, ...d, blocking: d.blocking || d.kind === 'blocker',
    category: 'project', relatedTaskId: task._id, relatedProjectId: task.projectId, relatedMilestoneId: task.milestoneId,
    raisedById: req.user!.id, ownerId: d.ownerId || proj?.projectManagerId || task.ownerId,
  });
  task.activityHistory.push({ actorId: req.user!.id as any, action: 'risk_raised', meta: { title: d.title, blocking: risk.blocking } } as any);
  await task.save();
  await syncTaskBlocked(task._id);
  await audit(req, 'risk.created', 'Risk', String(risk._id), { module: 'risks', summary: `${d.kind} "${d.title}" raised on task "${task.title}"`, meta: { blocking: risk.blocking, severity: d.severity } });
  const people = interestedPeople(task, req.user!.id).concat(proj ? [oid(proj.projectManagerId)] : []).filter((x) => x && x !== req.user!.id);
  if (people.length) await notifyWork({ organizationId: req.user!.organizationId, userIds: Array.from(new Set(people)), title: `${risk.blocking ? 'Blocker' : 'Risk'} raised: ${d.title}`, summary: `${req.user!.name} raised a ${d.kind} on "${task.title}".`, rows: [['Risk title', d.title], ['Severity', d.severity], ['Impact', d.impact], ['Halting the task', risk.blocking ? 'Yes' : 'No']], note: d.description, noteTone: risk.blocking ? 'danger' : 'warn', link: link(task._id), cta: 'Open task', severity: risk.blocking ? 'high' : 'warning', type: 'risk' });
  res.status(201).json({ success: true, data: risk });
});
