import { Task } from '../models/Task';
import { Project } from '../models/Project';
import { User } from '../models/User';
import { excludeDeleted } from '../utils/softDeletePlugin';
import { ApiError } from '../utils/ApiError';
import {
  DROPPED, HOLD_LABEL, STATUS_LABEL, TERMINAL, TaskStatus, canClose, escalationLevel, isDropped, isFinished, isTerminal, normaliseStatus, transitionProblems,
} from '../config/taskStatus';
import { resolveApprover, submissionProblems } from './approval.service';
import { Risk } from '../models/Risk';
import { loadEntity, postComment, Actor } from './discussion.service';
import { notifyWork, taskRows } from './work.notify';
import { oid } from './work.access';
import { logger } from '../utils/logger';

const DAY = 86400000;
const uniq = (a: Array<string | undefined | null>) => Array.from(new Set(a.filter(Boolean) as string[]));
export const ownersOf = (t: any): string[] => uniq([oid(t.ownerId), ...(t.coOwnerIds || []).map(oid)]);

/** Everyone who works on, sponsors or follows the task — and the whole project team when it belongs to a project. */
export async function taskAudience(t: any): Promise<string[]> {
  let proj: string[] = [];
  if (t.projectId && !t.confidential) {
    const p: any = await Project.findById(t.projectId).select('projectManagerId team milestones');
    if (p) {
      proj = [oid(p.projectManagerId), ...(p.team || []).map(oid)];
      const m = t.milestoneId ? p.milestones.id(t.milestoneId) : null;
      if (m) proj.push(oid(m.ownerId), oid(m.approverId));
    }
  }
  return uniq([...ownersOf(t), oid(t.creatorId), oid(t.approverId), oid(t.reviewerId), oid(t.testerId), ...(t.sharedWith || []).map(oid), ...proj]);
}

/** People who head the department of a task (or of its owner). */
export async function departmentHeads(orgId: string, t: any): Promise<string[]> {
  let dept = t.department as string | undefined;
  if (!dept) dept = (await User.findById(t.ownerId).select('department'))?.department as string | undefined;
  if (!dept) return [];
  const heads = await User.find({ organizationId: orgId, isActive: true, headOfDepartments: dept }).select('_id');
  return heads.map((h: any) => String(h._id));
}

/** Who a finished task goes to: named approver, department head, the owner's manager, the project manager, then HR / CEO. */
export async function resolveReviewer(orgId: string, t: any): Promise<string | null> {
  const owners = ownersOf(t);
  const notOwner = (id?: string) => !!id && !owners.includes(id);
  if (notOwner(oid(t.approverId))) return oid(t.approverId);
  for (const h of await departmentHeads(orgId, t)) if (notOwner(h)) return h;
  const owner: any = await User.findById(t.ownerId).select('managerId');
  if (owner?.managerId && notOwner(oid(owner.managerId))) {
    const m = await User.findOne({ _id: owner.managerId, isActive: true }).select('_id');
    if (m) return String(m._id);
  }
  return resolveApprover({ organizationId: orgId, ownerId: oid(t.ownerId), approverId: undefined, creatorId: t.creatorId, projectId: t.projectId });
}

/** Escalation chain by level: 1 manager + project manager, 2 + department head + COO, 3 + CEO. */
export async function escalationRecipients(orgId: string, t: any, level: number): Promise<string[]> {
  const out: string[] = [...ownersOf(t)];
  const owner: any = await User.findById(t.ownerId).select('managerId');
  if (level >= 1) {
    out.push(oid(owner?.managerId));
    if (t.projectId) { const p: any = await Project.findById(t.projectId).select('projectManagerId'); out.push(oid(p?.projectManagerId)); }
    out.push(oid(t.creatorId));
  }
  if (level >= 2) {
    out.push(...(await departmentHeads(orgId, t)));
    out.push(...(await User.find({ organizationId: orgId, isActive: true, role: 'coo' }).select('_id')).map((u: any) => String(u._id)));
  }
  if (level >= 3) out.push(...(await User.find({ organizationId: orgId, isActive: true, role: { $in: ['ceo'] } }).select('_id')).map((u: any) => String(u._id)));
  return uniq(out);
}

export interface ChangeInput {
  task: any;
  actor: Actor;
  to: TaskStatus;
  comment: string;
  percent?: number;
  hold?: { reason?: string; awaitingUserId?: string; note?: string; createLinkedTask?: boolean; linkedTitle?: string };
  newDate?: Date;
  testerId?: string;
  from?: { ip?: string; device?: string };
  /** the approver deciding on a review may move it on */
  isReviewer?: boolean;
  /** the task's manager (creator / approver / project manager / leadership) */
  isManager?: boolean;
  evidenceAdded?: number;
}

/** Resolves who has the right to close this task. */
export async function actorMayClose(t: any, actor: Actor): Promise<boolean> {
  let pm: string | undefined;
  if (t.projectId) { const p: any = await Project.findById(t.projectId).select('projectManagerId'); pm = oid(p?.projectManagerId); }
  return canClose({ userId: actor.id, projectManagerId: pm, creatorId: oid(t.creatorId), hasProject: !!t.projectId, role: actor.role });
}

const bump = (t: any, ch: ChangeInput, from: string, to: string) => {
  t.statusHistory.push({ from, to, percent: t.percentComplete, comment: ch.comment, byId: ch.actor.id, byName: ch.actor.name, at: new Date(), ip: ch.from?.ip, device: ch.from?.device });
  t.activityHistory.push({ actorId: ch.actor.id, action: 'status_changed', meta: { from, to } });
};

/**
 * The one place a task's status changes. Checks the rules, applies the side-effects (hold → linked task, delayed → escalation,
 * to be reviewed → routed to the head, closed → only the project owner), writes the comment into the thread and tells the audience.
 * `task` must already be loaded and the caller must have checked the person may edit it.
 */
export async function changeStatus(ch: ChangeInput): Promise<any> {
  const { task: t, actor } = ch;
  const orgId = actor.organizationId;
  const from = (normaliseStatus(t.status) || 'open') as TaskStatus;
  const to = ch.to;
  const evidenceCount = (t.evidence?.length || 0) + (ch.evidenceAdded || 0);

  const hasHold = !!ch.hold?.reason && (ch.hold.reason !== 'awaiting_person' || !!ch.hold.awaitingUserId);
  const problems = transitionProblems({ from, to, comment: ch.comment, percent: ch.percent, evidenceCount, hasHoldReason: hasHold, newDate: ch.newDate });
  if (problems.length) throw new ApiError(422, problems[0], { problems });

  // ----- who may do what
  if (from === 'to_be_reviewed' && !ch.isReviewer && !['to_be_tested'].includes(to) && to !== 'cancelled') {
    if (to === 'complete' || to === 'in_progress') throw ApiError.forbidden('Only the reviewer can approve this task or send it back.');
  }
  if (to === 'complete' && from !== 'to_be_reviewed') {
    if (t.requireEvidence || (t.acceptanceCriteria || []).length) throw ApiError.badRequest('This task needs evidence and a review. Send it for review; the reviewer completes it.');
    if (!ch.isManager) throw ApiError.forbidden('Only the task manager can mark it complete without a review.');
  }
  if (to === 'closed' && !(await actorMayClose(t, actor))) throw ApiError.forbidden('Only the project owner can close a task. Ask them to close it.');
  if (to === 'cancelled' && !ch.isManager) throw ApiError.forbidden('Only the task manager can cancel a task. You can mark it abandoned with an explanation.');
  if (!isTerminal(to) || to === 'complete' || to === 'closed') {
    const open = to === 'complete' || to === 'closed' || to === 'to_be_reviewed'
      ? await Task.countDocuments(excludeDeleted({ parentTaskId: t._id, status: { $nin: TERMINAL } })) : 0;
    if (open) throw ApiError.badRequest(`${open} subtask${open === 1 ? ' is' : 's are'} still open. Finish or close them first.`);
  }

  const wasHeld = from === 'on_hold' && t.hold?.linkedTaskId;
  let extraRecipients: string[] = [];
  let summaryExtra = '';

  // ----- status specific effects
  if (to === 'on_hold') {
    let awaiting = ch.hold?.awaitingUserId;
    let awaitingName = '';
    if (ch.hold?.reason === 'awaiting_ceo') {
      const ceo: any = await User.findOne({ organizationId: orgId, role: 'ceo', isActive: true }).select('_id');
      if (!ceo) throw ApiError.badRequest('No CEO account was found to wait for.');
      awaiting = String(ceo._id);
    }
    if (awaiting) {
      const u = await User.findOne({ _id: awaiting, organizationId: orgId, isActive: true }).select('name');
      if (!u) throw ApiError.badRequest('The person you are waiting for was not found.');
      if (ownersOf(t).includes(awaiting)) throw ApiError.badRequest('You cannot wait for yourself.');
      awaitingName = u.name;
    }
    t.hold = { reason: ch.hold!.reason, note: ch.hold!.note, awaitingUserId: awaiting, since: new Date(), linkedTaskId: t.hold?.linkedTaskId };
    if (awaiting && ch.hold!.createLinkedTask !== false && !t.hold.linkedTaskId) {
      const due = new Date(Date.now() + 3 * DAY);
      const linked: any = await Task.create({
        organizationId: orgId, title: (ch.hold!.linkedTitle || `Needed for: ${t.title}`).slice(0, 300),
        description: `<p>${actor.name} is waiting on you before "<b>${String(t.title).replace(/[<>&]/g, '')}</b>" can continue.</p><p>${ch.comment.replace(/[<>&]/g, '')}</p>`,
        ownerId: awaiting, creatorId: actor.id, approverId: actor.id, projectId: t.projectId, milestoneId: t.milestoneId, clientId: t.clientId, priority: t.priority === 'low' ? 'medium' : t.priority,
        severity: t.severity, status: 'open', startDate: new Date(), endDate: due, dueDate: due, unblocksTaskId: t._id, confidential: t.confidential, tags: ['waiting-on-you'],
        activityHistory: [{ actorId: actor.id, action: 'created', meta: { unblocks: String(t._id) } }],
        statusHistory: [{ from: '', to: 'open', comment: `Created because "${t.title}" is waiting on this.`, byId: actor.id, byName: actor.name, at: new Date() }],
      });
      t.hold.linkedTaskId = linked._id;
      await notifyWork({ organizationId: orgId, userIds: [awaiting], title: `${actor.name} is waiting on you`, summary: `A task was created for you because "${t.title}" cannot continue without you.`, rows: taskRows(linked, [['Waiting task', t.title]]), note: ch.comment, link: `/tasks/${linked._id}`, cta: 'Open task', severity: 'warning', type: 'task', entity: { type: 'task', id: String(linked._id) } });
      summaryExtra = ` Waiting for ${awaitingName}; a task was created for them.`;
    } else if (awaiting) {
      extraRecipients = [awaiting];
    }
    t.blocked = true;
  } else {
    if (from === 'on_hold') { t.blocked = false; t.hold = { ...(t.hold?.toObject?.() ?? t.hold ?? {}), since: undefined }; }
  }

  if (to === 'delayed') {
    t.delay = { since: new Date(), originalDate: t.delay?.originalDate || t.dueDate || t.endDate, newDate: ch.newDate, previousStatus: from, auto: false, level: 1, escalatedAt: new Date(), notified: [] };
    if (ch.newDate) { t.endDate = ch.newDate; t.dueDate = ch.newDate; }
    const rec = await escalationRecipients(orgId, t, 1);
    t.delay.notified = rec as any;
    extraRecipients = rec;
    summaryExtra = ` Escalated${ch.newDate ? ` — new date ${ch.newDate.toISOString().slice(0, 10)}` : ''}.`;
  } else if (from === 'delayed') {
    t.delay = { ...(t.delay?.toObject?.() ?? t.delay ?? {}), level: 0 };
  }

  if (to === 'to_be_reviewed') {
    const openChildren = await Task.countDocuments(excludeDeleted({ parentTaskId: t._id, status: { $nin: TERMINAL } }));
    const sub = submissionProblems({ requireEvidence: t.requireEvidence, evidenceCount, criteria: t.acceptanceCriteria as any, openChildren });
    const blockers = await Risk.countDocuments(excludeDeleted({ relatedTaskId: t._id, blocking: true, status: { $ne: 'closed' } }));
    if (blockers) sub.push(`${blockers} blocking risk${blockers === 1 ? ' is' : 's are'} still open on this task.`);
    if (sub.length) throw new ApiError(422, 'This task is not ready to send for review', { problems: sub });
    const reviewer = await resolveReviewer(orgId, t);
    if (!reviewer) throw ApiError.badRequest('No reviewer could be found. Ask an administrator to set an approver or a department head.');
    t.reviewerId = reviewer; t.approverId = reviewer;
    t.percentComplete = 100;
    t.approval = { status: 'pending', submittedById: actor.id, submittedAt: new Date(), completionNote: ch.comment };
    extraRecipients = [reviewer];
    const rv: any = await User.findById(reviewer).select('name');
    summaryExtra = ` Sent to ${rv?.name || 'the reviewer'} for review.`;
  }
  if (to === 'to_be_tested') {
    if (ch.testerId) t.testerId = ch.testerId;
    t.percentComplete = 100;
    extraRecipients = uniq([ch.testerId, oid(t.testerId)]);
  }
  if (to === 'in_progress') {
    if (ch.percent !== undefined) t.percentComplete = Math.max(0, Math.min(99, Math.round(ch.percent)));
    else if (t.percentComplete >= 100 || isFinished(from)) t.percentComplete = 90;
    if (from === 'to_be_reviewed') t.approval = { ...(t.approval?.toObject?.() ?? t.approval ?? {}), status: 'rejected', decidedById: actor.id, decidedAt: new Date(), decisionNote: ch.comment };
  }
  if (to === 'open') t.percentComplete = Math.min(t.percentComplete || 0, 0);
  if (to === 'complete') {
    t.percentComplete = 100; t.completedAt = new Date();
  }
  if (to === 'closed') { t.percentComplete = 100; t.closedAt = new Date(); t.closedById = actor.id; if (!t.completedAt) t.completedAt = new Date(); }
  if (isDropped(to)) { t.completedAt = undefined; }
  if (isTerminal(from) && !isTerminal(to)) { t.completedAt = undefined; t.closedAt = undefined; t.closedById = undefined; }

  bump(t, ch, from, to);
  t.status = to;
  await t.save();

  // ----- the status comment lives in the thread; it tells the audience
  const entity = await loadEntity(actor, 'task', String(t._id));
  const label = to === 'on_hold' && t.hold?.reason ? `${STATUS_LABEL[to]} — ${HOLD_LABEL[t.hold.reason as keyof typeof HOLD_LABEL] || ''}` : STATUS_LABEL[to];
  await postComment({
    actor, entity, kind: 'status', status: { from, to, percent: t.percentComplete }, body: ch.comment, notify: 'all', from: ch.from, extraRecipients,
    attachments: undefined,
  });
  if (summaryExtra) {
    await postComment({ actor, entity, kind: 'system', body: `Status: ${STATUS_LABEL[from]} → ${label}.${summaryExtra}`, silent: true, from: ch.from });
  }

  // when a task someone was waiting on ends, release the waiting task
  if (isTerminal(to)) await onTaskEnded(t, actor, ch.from);
  if (wasHeld && to !== 'on_hold') {
    const waited: any = await Task.findById(t.hold?.linkedTaskId).select('status');
    void waited;
  }
  return t;
}

/** A task that another was waiting on has ended: finished → resume the waiting task; dropped → warn its owner. */
export async function onTaskEnded(ended: any, actor: Actor, from?: { ip?: string; device?: string }) {
  if (!ended.unblocksTaskId) return;
  const waiting: any = await Task.findOne(excludeDeleted({ _id: ended.unblocksTaskId, organizationId: actor.organizationId }));
  if (!waiting || waiting.status !== 'on_hold') return;
  const owners = ownersOf(waiting);
  const entity = await loadEntity({ ...actor, role: 'super_admin' }, 'task', String(waiting._id));
  if (isFinished(ended.status)) {
    waiting.status = 'in_progress'; waiting.blocked = false; waiting.hold = { ...(waiting.hold?.toObject?.() ?? waiting.hold ?? {}), since: undefined, linkedTaskId: undefined };
    waiting.statusHistory.push({ from: 'on_hold', to: 'in_progress', percent: waiting.percentComplete, comment: `"${ended.title}" was completed, so work can continue.`, byName: 'System', at: new Date() });
    waiting.activityHistory.push({ action: 'resumed', meta: { because: String(ended._id) } });
    await waiting.save();
    await postComment({ actor, entity, kind: 'system', body: `Resumed: "${ended.title}" was completed by ${actor.name}, so this task is back in progress.`, notify: 'none', from });
    await notifyWork({ organizationId: actor.organizationId, userIds: owners, title: `You can continue: ${waiting.title}`, summary: `"${ended.title}" is done, so "${waiting.title}" is back in progress.`, link: `/tasks/${waiting._id}`, cta: 'Open task', type: 'task', severity: 'info', entity: { type: 'task', id: String(waiting._id) } });
  } else if (DROPPED.includes(ended.status)) {
    await postComment({ actor, entity, kind: 'system', body: `"${ended.title}" was ${ended.status}, so this task is still waiting. Decide what to do next.`, notify: 'none', from });
    await notifyWork({ organizationId: actor.organizationId, userIds: owners, title: `Waiting task was ${ended.status}`, summary: `"${ended.title}" was ${ended.status}. "${waiting.title}" is still on hold.`, link: `/tasks/${waiting._id}`, cta: 'Open task', type: 'task', severity: 'warning', entity: { type: 'task', id: String(waiting._id) } });
  }
}

/** Daily: flag overdue work as delayed and push the escalation up as it gets older. */
export async function runTaskEscalations(now = new Date()) {
  const late: any[] = await Task.find(excludeDeleted({ status: { $in: ['open', 'in_progress', 'delayed', 'to_be_tested'] }, dueDate: { $lt: now } })).limit(2000);
  let flagged = 0, escalated = 0;
  for (const t of late) {
    try {
      const orgId = String(t.organizationId);
      const daysLate = Math.floor((now.getTime() - new Date(t.dueDate).getTime()) / DAY);
      const level = escalationLevel(daysLate);
      if (!level) continue;
      const system: Actor = { id: oid(t.creatorId) || oid(t.ownerId), name: 'System', role: 'super_admin', organizationId: orgId };
      if (t.status !== 'delayed') {
        const prev = t.status;
        t.delay = { since: now, originalDate: t.dueDate, previousStatus: prev, auto: true, level: 0, notified: [] };
        t.statusHistory.push({ from: prev, to: 'delayed', percent: t.percentComplete, comment: `Past its due date by ${daysLate} day${daysLate === 1 ? '' : 's'}.`, byName: 'System', at: now });
        t.status = 'delayed'; flagged += 1;
      }
      if ((t.delay?.level || 0) >= level) { await t.save(); continue; }
      const rec = await escalationRecipients(orgId, t, level);
      t.delay.level = level; t.delay.escalatedAt = now; t.delay.notified = rec as any;
      await t.save();
      const entity = await loadEntity(system, 'task', String(t._id)).catch(() => null);
      if (entity) await postComment({ actor: system, entity, kind: 'system', body: `Escalated to level ${level}: ${daysLate} day${daysLate === 1 ? '' : 's'} late.`, notify: 'none' });
      await notifyWork({
        organizationId: orgId, userIds: rec, title: `Escalation level ${level}: ${t.title}`, summary: `"${t.title}" is ${daysLate} day${daysLate === 1 ? '' : 's'} late.`,
        rows: taskRows(t), link: `/tasks/${t._id}`, cta: 'Open task', severity: level >= 2 ? 'high' : 'warning', type: 'task', dedupeKey: `task-esc:${t._id}:${level}`, entity: { type: 'task', id: String(t._id) },
      });
      escalated += 1;
    } catch (err) { logger.error({ err, task: String(t._id) }, 'task escalation failed'); }
  }
  return { flagged, escalated };
}
