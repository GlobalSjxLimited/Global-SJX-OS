import { Router } from 'express';
import { z } from 'zod';
import { requireAuth } from '../middleware/auth';
import { asyncHandler } from '../utils/asyncHandler';
import { ApiError } from '../utils/ApiError';
import { Meeting, MEETING_PROVIDERS } from '../models/Meeting';
import { Task } from '../models/Task';
import { Project } from '../models/Project';
import { User } from '../models/User';
import { Group } from '../models/Group';
import { excludeDeleted } from '../utils/softDeletePlugin';
import { escapeRegex } from '../utils/escapeRegex';
import { audit } from '../services/audit.service';
import { canViewTask, isLeader, isTopLeader, loadScope, oid } from '../services/work.access';
import { isVirtual, sendMeetingMessages, uploadRemindersStart } from '../services/meeting.service';
import { overlapFilter, rangeFromQuery } from '../utils/quarter';

const router = Router();
router.use(requireAuth);

const blank = (v: unknown) => (v === '' || v === null ? undefined : v);
const oidStr = z.preprocess(blank, z.string().regex(/^[a-f\d]{24}$/i, 'Invalid id').optional());
const idList = z.array(z.string().regex(/^[a-f\d]{24}$/i)).max(300);
const urlIn = z.string().min(1).max(500).refine((u) => /^(\/api\/uploads\/|https?:\/\/)/i.test(u), 'Must be an uploaded file or an http(s) link');
const httpUrl = z.preprocess(blank, z.string().url().max(500).refine((u) => /^https?:\/\//i.test(u), 'Must start with http(s)://').optional());

const detailsSchema = z.object({
  meetingId: z.string().trim().max(100).optional(),
  passcode: z.string().trim().max(100).optional(),
  url: httpUrl,
  dialIn: z.string().trim().max(200).optional(),
  host: z.string().trim().max(200).optional(),
}).partial();

const bodySchema = z.object({
  title: z.string().trim().max(300).optional(), // defaults from the task / milestone
  date: z.coerce.date(),
  durationMins: z.coerce.number().int().min(5).max(1440).default(60),
  provider: z.enum(MEETING_PROVIDERS),
  providerDetails: detailsSchema.optional(),
  location: z.string().trim().max(300).optional(),
  agenda: z.string().max(20000).optional(),
  description: z.string().max(20000).optional(),
  attachments: z.array(z.object({ name: z.string().max(200), url: urlIn })).max(15).optional(),
  taskId: oidStr, milestoneId: oidStr, projectId: oidStr, clientId: oidStr,
  participants: idList.default([]),
  inviteProjectTeam: z.boolean().default(false),
  inviteRoles: z.array(z.string().max(40)).max(20).default([]),
  inviteDepartments: z.array(z.string().max(80)).max(20).default([]),
  inviteGroupIds: idList.default([]),
  externalParticipants: z.array(z.object({ name: z.string().trim().max(120).optional(), email: z.string().email().max(200) })).max(50).default([]),
  recordingReminder: z.boolean().default(false),
  recorderId: oidStr,
  note: z.string().max(1000).optional(),
});

function checkProvider(provider: string, pd: any, location?: string) {
  const hasJoin = !!(pd?.url || pd?.meetingId);
  if (provider === 'in_person') { if (!location) throw ApiError.badRequest('Enter the location for an in-person meeting'); return; }
  if (isVirtual(provider) && !hasJoin) throw ApiError.badRequest('Add the meeting link or the meeting ID (and passcode, if there is one) so people can join');
  if (provider === 'other' && !pd?.url) throw ApiError.badRequest('Add the link to join this meeting');
}

const actor = (req: any) => ({ id: req.user.id, role: req.user.role, organizationId: req.user.organizationId });
const involved = (req: any, m: any) => oid(m.organizerId) === req.user.id || (m.participants || []).some((p: any) => oid(p) === req.user.id) || oid(m.recording?.recorderId) === req.user.id;
const canManage = (req: any, m: any) => oid(m.organizerId) === req.user.id || isLeader(actor(req));
const present = (req: any, m: any) => {
  const o = typeof m.toObject === 'function' ? m.toObject() : { ...m };
  // Passcodes and join details are only for people who are part of the meeting.
  if (!involved(req, m) && !isLeader(actor(req))) o.providerDetails = { host: o.providerDetails?.host };
  if (!involved(req, m) && !isLeader(actor(req))) o.meetingLink = undefined;
  return { ...o, permissions: { view: true, edit: canManage(req, m), delete: canManage(req, m), manageRecording: canManage(req, m) || involved(req, m) } };
};

/** Resolve the context (task / milestone) a meeting hangs off, enforcing task visibility. */
async function resolveContext(req: any, d: { taskId?: string; milestoneId?: string; projectId?: string; clientId?: string }) {
  const orgId = req.user.organizationId;
  let title: string | undefined; let task: any = null; let projectId = d.projectId; let milestoneId = d.milestoneId; let clientId = d.clientId;
  if (d.taskId) {
    task = await Task.findOne(excludeDeleted({ _id: d.taskId, organizationId: orgId }));
    if (!task) throw ApiError.notFound('Task not found');
    const scope = await loadScope(actor(req));
    if (!canViewTask(scope, task)) throw ApiError.notFound('Task not found');
    title = task.title;
    projectId = projectId || (task.projectId ? String(task.projectId) : undefined);
    milestoneId = milestoneId || (task.milestoneId ? String(task.milestoneId) : undefined);
    clientId = clientId || (task.clientId ? String(task.clientId) : undefined);
  }
  if (projectId) {
    const p = await Project.findOne(excludeDeleted({ _id: projectId, organizationId: orgId })).select('milestones team projectManagerId clientId');
    if (!p) throw ApiError.badRequest('Project not found');
    if (milestoneId) {
      const ms: any = p.milestones.id(milestoneId);
      if (!ms) throw ApiError.badRequest('That milestone is not part of the project');
      if (!title) title = ms.title;
    }
    clientId = clientId || (p.clientId ? String(p.clientId) : undefined);
    return { title, task, projectId, milestoneId, clientId, project: p };
  }
  return { title, task, projectId, milestoneId, clientId, project: null };
}

/* -------------------------------- list / get -------------------------------- */
router.get('/', asyncHandler(async (req, res) => {
  const q = req.query as Record<string, string>;
  const and: Record<string, unknown>[] = [{ organizationId: req.user!.organizationId }];
  for (const k of ['clientId', 'projectId', 'taskId', 'milestoneId', 'status', 'provider'] as const) if (q[k]) and.push({ [k]: q[k] });
  if (q.upcoming === 'true') and.push({ date: { $gte: new Date() } });
  if (q.scope === 'mine') and.push({ $or: [{ organizerId: req.user!.id }, { participants: req.user!.id }] });
  if (q.needsRecording === 'true') and.push({ 'recording.reminderEnabled': true, 'recording.uploaded': { $ne: true }, date: { $lt: new Date() }, status: { $ne: 'cancelled' } });
  if (q.q) and.push({ title: { $regex: escapeRegex(q.q), $options: 'i' } });
  const range = rangeFromQuery(q);
  if (range) and.push({ date: { $gte: range.from, $lte: range.to } });
  const meetings = await Meeting.find(excludeDeleted({ $and: and })).populate('participants', 'name avatarUrl').populate('clientId', 'name').populate('organizerId', 'name').sort(q.sort || 'date').limit(Math.min(Number(q.limit) || 500, 1000));

  // Meetings about a confidential task are only listed for people in the meeting and top leadership.
  const taskIds = meetings.map((m) => m.taskId).filter(Boolean);
  const conf = taskIds.length ? new Set((await Task.find({ _id: { $in: taskIds }, confidential: true }).select('_id')).map((t) => String(t._id))) : new Set<string>();
  const visible = meetings.filter((m) => !m.taskId || !conf.has(String(m.taskId)) || involved(req, m) || isTopLeader(actor(req)));
  res.json({ success: true, data: visible.map((m) => present(req, m)) });
}));

router.get('/:id', asyncHandler(async (req, res) => {
  const meeting = await Meeting.findOne(excludeDeleted({ _id: req.params.id, organizationId: req.user!.organizationId }))
    .populate('participants', 'name avatarUrl email').populate('clientId', 'name').populate('projectId', 'name').populate('taskId', 'title confidential')
    .populate('organizerId', 'name').populate('recording.recorderId', 'name').populate('invitedViaGroupIds', 'name').populate('actionItems.assigneeId', 'name');
  if (!meeting) throw ApiError.notFound('Meeting not found');
  const t: any = meeting.taskId;
  if (t?.confidential && !involved(req, meeting) && !isTopLeader(actor(req))) throw ApiError.notFound('Meeting not found');
  res.json({ success: true, data: { ...present(req, meeting), recordingRemindersStartAt: meeting.recording?.reminderEnabled ? uploadRemindersStart(meeting.date) : undefined } });
}));

/* ---------------------------------- create ---------------------------------- */
router.post('/', asyncHandler(async (req, res) => {
  const d = bodySchema.parse(req.body);
  const orgId = req.user!.organizationId;
  const ctx = await resolveContext(req, d);
  const title = (d.title || ctx.title || '').trim();
  if (!title) throw ApiError.badRequest('Meeting title is required');
  checkProvider(d.provider, d.providerDetails, d.location);
  if (ctx.task?.confidential && d.externalParticipants.length) throw ApiError.badRequest('This meeting is about a confidential task, so people outside the organisation cannot be invited');

  // Who is invited: picked people, the project team, roles, departments, groups.
  const resolved = new Set<string>(d.participants);
  if (d.inviteProjectTeam && ctx.project) { ctx.project.team.forEach((u: any) => resolved.add(String(u))); resolved.add(String(ctx.project.projectManagerId)); }
  if (d.inviteRoles.length || d.inviteDepartments.length) {
    const or: Record<string, unknown>[] = [];
    if (d.inviteRoles.length) or.push({ role: { $in: d.inviteRoles } });
    if (d.inviteDepartments.length) or.push({ department: { $in: d.inviteDepartments } });
    (await User.find({ organizationId: orgId, isActive: true, $or: or }).select('_id')).forEach((u) => resolved.add(String(u._id)));
  }
  if (d.inviteGroupIds.length) (await Group.find({ _id: { $in: d.inviteGroupIds }, organizationId: orgId })).forEach((g) => (g.memberIds || []).forEach((m) => resolved.add(String(m))));
  resolved.delete(req.user!.id);
  // Only people in this organisation can be invited as colleagues.
  const valid = resolved.size ? await User.find({ _id: { $in: Array.from(resolved) }, organizationId: orgId, isActive: true }).select('_id') : [];
  const participants = valid.map((u) => String(u._id));
  if (ctx.task?.confidential) {
    // Confidential task: only people who can already see the task may be added.
    for (const uid of participants) {
      const u = await User.findById(uid).select('role organizationId');
      const sc = await loadScope({ id: uid, role: u!.role, organizationId: String(u!.organizationId) });
      if (!canViewTask(sc, ctx.task)) throw ApiError.badRequest('This meeting is about a confidential task. You can only invite people who already have access to it.');
    }
  }
  if (d.recorderId && !(await User.exists({ _id: d.recorderId, organizationId: orgId, isActive: true }))) throw ApiError.badRequest('The person who records was not found');

  const meeting = await Meeting.create({
    organizationId: orgId, organizerId: req.user!.id, title,
    date: d.date, durationMins: d.durationMins, provider: d.provider, providerDetails: d.providerDetails, meetingLink: d.providerDetails?.url, location: d.location,
    agenda: d.agenda, description: d.description, attachments: d.attachments,
    taskId: ctx.task?._id, milestoneId: ctx.milestoneId, projectId: ctx.projectId, clientId: ctx.clientId,
    participants, externalParticipants: d.externalParticipants,
    invitedViaRoles: d.inviteRoles, invitedViaDepartments: d.inviteDepartments, invitedViaGroupIds: d.inviteGroupIds,
    recording: { reminderEnabled: d.recordingReminder, recorderId: d.recorderId, uploaded: false },
  });
  await audit(req, 'meeting.created', 'Meeting', String(meeting._id), { module: 'meetings', summary: `Scheduled meeting "${title}"`, meta: { provider: d.provider, participants: participants.length, external: d.externalParticipants.length, taskId: ctx.task?._id, recordingReminder: d.recordingReminder } });

  // Always notify + e-mail (with a calendar invite). The organiser gets a confirmation copy too.
  const notified = await sendMeetingMessages(meeting, { kind: 'invite', userIds: [...participants, req.user!.id], emails: d.externalParticipants as any, note: d.note });
  if (ctx.task) {
    ctx.task.activityHistory.push({ actorId: req.user!.id as any, action: 'meeting_scheduled', meta: { meetingId: meeting._id, title, date: d.date } });
    await ctx.task.save();
  }
  res.status(201).json({ success: true, data: meeting, notifiedCount: notified });
}));

/* ---------------------------------- update ---------------------------------- */
const patchSchema = bodySchema.partial().extend({ status: z.enum(['scheduled', 'completed', 'cancelled']).optional(), notes: z.string().max(50000).optional(), decisions: z.array(z.string().max(1000)).max(50).optional(), actionItems: z.array(z.object({ description: z.string().min(1).max(500), assigneeId: oidStr, dueDate: z.preprocess(blank, z.coerce.date().optional()) })).max(50).optional() });

router.patch('/:id', asyncHandler(async (req, res) => {
  const meeting = await Meeting.findOne(excludeDeleted({ _id: req.params.id, organizationId: req.user!.organizationId }));
  if (!meeting) throw ApiError.notFound('Meeting not found');
  if (!canManage(req, meeting)) throw ApiError.forbidden('Only the organiser or leadership can change this meeting');
  const d = patchSchema.parse(req.body);
  const orgId = req.user!.organizationId;

  const before = { date: +new Date(meeting.date), provider: meeting.provider, details: JSON.stringify(meeting.providerDetails || {}), location: meeting.location, title: meeting.title, duration: meeting.durationMins };
  if (d.provider || d.providerDetails || d.location !== undefined) {
    checkProvider(d.provider || meeting.provider, { ...(meeting.providerDetails as any)?.toObject?.(), ...(d.providerDetails || {}) }, d.location ?? meeting.location ?? undefined);
  }
  const prevParticipants = new Set((meeting.participants || []).map(String));
  const prevExternal = new Set((meeting.externalParticipants || []).map((e: any) => String(e.email).toLowerCase()));

  const simple = ['title', 'date', 'durationMins', 'provider', 'location', 'agenda', 'description', 'attachments', 'status', 'notes', 'decisions', 'actionItems'] as const;
  for (const k of simple) if ((d as any)[k] !== undefined) (meeting as any)[k] = (d as any)[k];
  if (d.providerDetails) { meeting.providerDetails = { ...(meeting.providerDetails as any)?.toObject?.(), ...d.providerDetails } as any; meeting.meetingLink = d.providerDetails.url ?? meeting.meetingLink; }
  if (d.externalParticipants) meeting.set('externalParticipants', d.externalParticipants);
  if (d.participants || d.inviteProjectTeam !== undefined) {
    const list = new Set<string>(d.participants ?? (meeting.participants || []).map(String));
    list.delete(req.user!.id);
    const valid = await User.find({ _id: { $in: Array.from(list) }, organizationId: orgId, isActive: true }).select('_id');
    meeting.set('participants', valid.map((u) => u._id));
  }
  if (d.recordingReminder !== undefined) {
    meeting.recording = { ...((meeting.recording as any)?.toObject?.() || {}), reminderEnabled: d.recordingReminder } as any;
    if (d.recordingReminder) { (meeting.recording as any).reminderCancelledAt = undefined; (meeting.recording as any).reminderCancelledById = undefined; }
  }
  if (d.recorderId) (meeting.recording as any).recorderId = d.recorderId;
  await meeting.save();
  await audit(req, 'meeting.updated', 'Meeting', String(meeting._id), { module: 'meetings', summary: `Updated meeting "${meeting.title}"`, meta: { fields: Object.keys(d) } });

  const changedSchedule = before.date !== +new Date(meeting.date) || before.provider !== meeting.provider || before.details !== JSON.stringify(meeting.providerDetails || {}) || before.location !== meeting.location || before.title !== meeting.title || before.duration !== meeting.durationMins;
  const nowParticipants = (meeting.participants || []).map(String);
  const nowExternal = (meeting.externalParticipants || []) as any[];
  if (d.status === 'cancelled') {
    await sendMeetingMessages(meeting, { kind: 'cancel', userIds: nowParticipants, emails: nowExternal });
  } else {
    const newUsers = nowParticipants.filter((p) => !prevParticipants.has(p));
    const newExternal = nowExternal.filter((e) => !prevExternal.has(String(e.email).toLowerCase()));
    if (newUsers.length || newExternal.length) await sendMeetingMessages(meeting, { kind: 'invite', userIds: newUsers, emails: newExternal });
    if (changedSchedule) await sendMeetingMessages(meeting, { kind: 'update', userIds: nowParticipants.filter((p) => prevParticipants.has(p)), emails: nowExternal.filter((e) => prevExternal.has(String(e.email).toLowerCase())) });
  }
  res.json({ success: true, data: present(req, meeting) });
}));

router.delete('/:id', asyncHandler(async (req, res) => {
  const meeting = await Meeting.findOne(excludeDeleted({ _id: req.params.id, organizationId: req.user!.organizationId }));
  if (!meeting) throw ApiError.notFound('Meeting not found');
  if (!canManage(req, meeting)) throw ApiError.forbidden('Only the organiser or leadership can delete this meeting');
  const wasFuture = new Date(meeting.date) > new Date() && meeting.status === 'scheduled';
  await (meeting as any).softDelete(req.user!.id);
  if (wasFuture) await sendMeetingMessages(meeting, { kind: 'cancel', userIds: (meeting.participants || []).map(String), emails: (meeting.externalParticipants || []) as any });
  await audit(req, 'meeting.deleted', 'Meeting', String(meeting._id), { module: 'meetings', severity: 'medium', summary: `Deleted meeting "${meeting.title}"` });
  res.json({ success: true, data: { id: req.params.id, softDeleted: true } });
}));

router.post('/:id/restore', asyncHandler(async (req, res) => {
  const meeting = await Meeting.findOne({ _id: req.params.id, organizationId: req.user!.organizationId, isDeleted: true });
  if (!meeting) throw ApiError.notFound('Deleted meeting not found');
  if (!canManage(req, meeting)) throw ApiError.forbidden('Only the organiser or leadership can restore this meeting');
  await (meeting as any).restore();
  res.json({ success: true, data: meeting });
}));

/* ------------------------------ recording flow ------------------------------ */
async function loadForRecording(req: any) {
  const meeting = await Meeting.findOne(excludeDeleted({ _id: req.params.id, organizationId: req.user.organizationId }));
  if (!meeting) throw ApiError.notFound('Meeting not found');
  if (!canManage(req, meeting) && !involved(req, meeting)) throw ApiError.forbidden('Only people in this meeting can manage its recording');
  return meeting;
}

/** Stop the "upload the recording" reminders. The e-mail's "Stop these reminders" link lands on a page that calls this. */
router.post('/:id/recording/cancel-reminders', asyncHandler(async (req, res) => {
  const meeting = await loadForRecording(req);
  (meeting.recording as any).reminderCancelledAt = new Date();
  (meeting.recording as any).reminderCancelledById = req.user!.id;
  await meeting.save();
  await audit(req, 'meeting.recording_reminders_cancelled', 'Meeting', String(meeting._id), { module: 'meetings', summary: `Stopped recording reminders for "${meeting.title}"` });
  res.json({ success: true, data: { cancelled: true } });
}));

router.post('/:id/recording/resume-reminders', asyncHandler(async (req, res) => {
  const meeting = await loadForRecording(req);
  const rec: any = meeting.recording;
  rec.reminderEnabled = true; rec.reminderCancelledAt = undefined; rec.reminderCancelledById = undefined; rec.resumeBase = rec.reminderCount || 0; // a fresh run of up to 30 more reminders
  await meeting.save();
  res.json({ success: true, data: { resumed: true } });
}));

router.post('/:id/recording', asyncHandler(async (req, res) => {
  const meeting = await loadForRecording(req);
  const d = z.object({ name: z.string().min(1).max(200), url: urlIn }).parse(req.body);
  const rec: any = meeting.recording;
  rec.uploads.push({ name: d.name, url: d.url, uploadedById: req.user!.id, uploadedAt: new Date() });
  rec.uploaded = true;
  await meeting.save();
  // The recording also lives on the task / milestone the meeting was about.
  if (meeting.taskId) {
    await Task.updateOne({ _id: meeting.taskId }, { $push: { documents: { name: d.name, url: d.url, kind: 'recording', note: `Recording of "${meeting.title}"`, uploadedById: req.user!.id, uploadedAt: new Date() } } });
  }
  if (meeting.projectId && meeting.milestoneId) {
    const proj = await Project.findById(meeting.projectId);
    const ms: any = proj?.milestones.id(meeting.milestoneId);
    if (proj && ms) { ms.documents.push({ name: d.name, url: d.url, kind: 'recording', note: `Recording of "${meeting.title}"`, uploadedById: req.user!.id, uploadedAt: new Date() }); await proj.save(); }
  }
  await audit(req, 'meeting.recording_uploaded', 'Meeting', String(meeting._id), { module: 'meetings', summary: `Recording uploaded for "${meeting.title}"` });
  res.status(201).json({ success: true, data: rec.uploads[rec.uploads.length - 1] });
}));

export default router;
