import { Types } from 'mongoose';
import { Task } from '../models/Task';
import { Project } from '../models/Project';
import { Risk } from '../models/Risk';
import { Meeting } from '../models/Meeting';
import { Goal } from '../models/Goal';
import { User } from '../models/User';
import { excludeDeleted } from '../utils/softDeletePlugin';
import { AccessScope, isLeader, visibleTasksFilter } from './work.access';
import { overlapFilter, parseQuarter, rangeFromQuery, Range } from '../utils/quarter';
import { isDropped, isFinished, isOpenStatus } from '../config/taskStatus';

export interface WorkParams { quarter?: string; from?: string; to?: string; projectId?: string; ownerId?: string }

const DAY = 86400000;
const OPEN = (s: string) => isOpenStatus(s);

function taskFilter(orgId: string, p: WorkParams, scope?: AccessScope) {
  const and: Record<string, unknown>[] = [{ organizationId: new Types.ObjectId(orgId) }];
  if (p.projectId) and.push({ projectId: new Types.ObjectId(p.projectId) });
  if (p.ownerId) and.push({ ownerId: new Types.ObjectId(p.ownerId) });
  const range = rangeFromQuery(p as any);
  if (range) and.push(overlapFilter(range));
  // Interactive reports honour each person's visibility. Scheduled / engine reports never include confidential tasks.
  and.push(scope ? visibleTasksFilter(scope) : { confidential: { $ne: true } });
  return excludeDeleted({ $and: and });
}

export async function workSummary(orgId: string, p: WorkParams, scope?: AccessScope) {
  const now = new Date();
  const tasks: any[] = await Task.find(taskFilter(orgId, p, scope))
    .select('title ownerId approverId projectId milestoneId status severity priority dueDate endDate startDate parentTaskId approval completedAt createdAt source blocked')
    .limit(20000).lean();
  const [users, projects] = await Promise.all([
    User.find({ organizationId: orgId }).select('name role department').lean(),
    Project.find(excludeDeleted({ organizationId: orgId })).select('name status milestones projectManagerId team holdReason').lean(),
  ]);
  const uName = new Map(users.map((u: any) => [String(u._id), u.name]));
  const pName = new Map(projects.map((x: any) => [String(x._id), x.name]));

  const isOverdue = (t: any) => OPEN(t.status) && t.dueDate && new Date(t.dueDate) < now;
  const isHot = (t: any) => OPEN(t.status) && ['critical', 'show_stopper'].includes(t.severity);

  const totals = {
    assigned: tasks.length,
    tasks: tasks.filter((t) => !t.parentTaskId).length,
    subtasks: tasks.filter((t) => t.parentTaskId).length,
    todo: tasks.filter((t) => t.status === 'open').length,
    inProgress: tasks.filter((t) => t.status === 'in_progress').length,
    blocked: tasks.filter((t) => t.status === 'on_hold').length,
    delayed: tasks.filter((t) => t.status === 'delayed').length,
    toBeTested: tasks.filter((t) => t.status === 'to_be_tested').length,
    awaitingApproval: tasks.filter((t) => t.status === 'to_be_reviewed').length,
    done: tasks.filter((t) => isFinished(t.status)).length,
    cancelled: tasks.filter((t) => isDropped(t.status)).length,
    avgProgress: (() => { const live = tasks.filter((t) => isOpenStatus(t.status)); return live.length ? Math.round(live.reduce((n, t) => n + (t.percentComplete || 0), 0) / live.length) : 0; })(),
    overdue: tasks.filter(isOverdue).length,
    criticalOpen: tasks.filter(isHot).length,
    fromEmail: tasks.filter((t) => t.source === 'email').length,
  };
  const completionRate = totals.assigned ? Math.round((totals.done / totals.assigned) * 100) : 0;

  const byUserMap = new Map<string, any>();
  for (const t of tasks) {
    const id = String(t.ownerId);
    const r = byUserMap.get(id) || { userId: id, name: uName.get(id) || 'Unknown', assigned: 0, todo: 0, inProgress: 0, blocked: 0, awaitingApproval: 0, done: 0, overdue: 0, criticalOpen: 0 };
    r.assigned += 1;
    if (t.status === 'open') r.todo += 1;
    else if (['in_progress', 'to_be_tested', 'delayed'].includes(t.status)) r.inProgress += 1;
    else if (t.status === 'on_hold') r.blocked += 1;
    else if (t.status === 'to_be_reviewed') r.awaitingApproval += 1;
    else if (isFinished(t.status)) r.done += 1;
    if (isOverdue(t)) r.overdue += 1;
    if (isHot(t)) r.criticalOpen += 1;
    byUserMap.set(id, r);
  }
  const byUser = Array.from(byUserMap.values()).map((r) => ({ ...r, completionRate: r.assigned ? Math.round((r.done / r.assigned) * 100) : 0 })).sort((a, b) => b.assigned - a.assigned);

  const byProjectMap = new Map<string, any>();
  for (const t of tasks) {
    const id = t.projectId ? String(t.projectId) : 'none';
    const r = byProjectMap.get(id) || { projectId: id === 'none' ? null : id, name: id === 'none' ? 'No project' : pName.get(id) || 'Unknown', assigned: 0, done: 0, overdue: 0, awaitingApproval: 0, blocked: 0 };
    r.assigned += 1; if (isFinished(t.status)) r.done += 1; if (isOverdue(t)) r.overdue += 1; if (t.status === 'to_be_reviewed') r.awaitingApproval += 1; if (t.status === 'on_hold') r.blocked += 1;
    byProjectMap.set(id, r);
  }
  const bySeverity = ['show_stopper', 'critical', 'major', 'minor', 'trivial'].map((s) => ({ severity: s, total: tasks.filter((t) => t.severity === s).length, open: tasks.filter((t) => t.severity === s && OPEN(t.status)).length }));

  const awaiting = tasks.filter((t) => t.status === 'to_be_reviewed').map((t) => ({
    taskId: String(t._id), title: t.title, owner: uName.get(String(t.ownerId)), approver: uName.get(String(t.approverId)) || '—', approverId: t.approverId ? String(t.approverId) : null,
    project: t.projectId ? pName.get(String(t.projectId)) : null, severity: t.severity, submittedAt: t.approval?.submittedAt || null,
    waitingDays: t.approval?.submittedAt ? Math.floor((now.getTime() - new Date(t.approval.submittedAt).getTime()) / DAY) : 0,
  })).sort((a, b) => b.waitingDays - a.waitingDays);

  // Milestones: progress derived from their tasks.
  const topTasks = tasks.filter((t) => !t.parentTaskId);
  const memberOf = scope && !isLeader(scope.actor) ? new Set(scope.memberProjectIds) : null;
  const milestones: any[] = [];
  for (const pr of projects as any[]) {
    if (p.projectId && String(pr._id) !== p.projectId) continue;
    if (memberOf && !memberOf.has(String(pr._id))) continue;
    for (const m of pr.milestones || []) {
      const mt = topTasks.filter((t) => String(t.milestoneId) === String(m._id));
      const done = mt.filter((t) => isFinished(t.status)).length;
      milestones.push({ projectId: String(pr._id), project: pr.name, milestoneId: String(m._id), title: m.title, severity: m.severity, status: m.status, owner: uName.get(String(m.ownerId)) || null, endDate: m.endDate || m.dueDate || null, tasks: mt.length, done, percent: mt.length ? Math.round((done / mt.length) * 100) : 0, noTasks: mt.length === 0 });
    }
  }

  const riskFilter: Record<string, unknown> = { organizationId: orgId, status: { $ne: 'closed' } };
  if (p.projectId) riskFilter.relatedProjectId = p.projectId;
  const risks: any[] = await Risk.find(excludeDeleted(riskFilter)).select('title kind severity blocking relatedProjectId relatedTaskId relatedMilestoneId ownerId createdAt').lean();
  const openRisks = { total: risks.length, blocking: risks.filter((r) => r.blocking).length, critical: risks.filter((r) => r.severity === 'critical').length };

  const missingRecordings = await Meeting.countDocuments(excludeDeleted({ organizationId: orgId, 'recording.reminderEnabled': true, 'recording.uploaded': { $ne: true }, status: { $ne: 'cancelled' }, date: { $lt: now }, ...(p.projectId ? { projectId: p.projectId } : {}) }));

  const quarter = parseQuarter(p.quarter);
  const goalFilter: Record<string, unknown> = { organizationId: orgId };
  if (quarter) goalFilter.quarter = p.quarter!.toUpperCase().replace(/^(\d{4})[\s-]*Q/, '$1-Q');
  const goals: any[] = await Goal.find(excludeDeleted(goalFilter)).select('title ownerId quarter progressPercent status evidence verifiedAt').lean();

  return {
    params: p, generatedAt: now, totals: { ...totals, completionRate },
    byUser, byProject: Array.from(byProjectMap.values()).sort((a, b) => b.assigned - a.assigned), bySeverity,
    awaitingApproval: awaiting, milestones,
    risks: openRisks, meetingsMissingRecordings: missingRecordings,
    goals: { total: goals.length, completed: goals.filter((g) => g.status === 'completed').length, verified: goals.filter((g) => g.verifiedAt).length, avgProgress: goals.length ? Math.round(goals.reduce((s, g) => s + (g.progressPercent || 0), 0) / goals.length) : 0, atRisk: goals.filter((g) => g.status === 'at_risk').length },
  };
}

export type WorkSummary = Awaited<ReturnType<typeof workSummary>>;
export type { Range };

/* ---------------------------------------------------------------------------------------------------------
 * "My report": one person's own tasks and projects over a period they choose.
 * ------------------------------------------------------------------------------------------------------- */
export type ReportPeriod = 'daily' | 'weekly' | 'monthly' | 'quarterly' | 'custom';

/** Pure: turn a period choice into a start and end. `daily` is today, `weekly` the last 7 days, `monthly` this calendar month, `quarterly` this quarter, `custom` starts from the date given. */
export function periodRange(period: ReportPeriod, now = new Date(), from?: string, to?: string): { from: Date; to: Date } {
  const startOfDay = (d: Date) => new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
  const end = new Date(now);
  if (period === 'daily') return { from: startOfDay(now), to: end };
  if (period === 'weekly') return { from: new Date(startOfDay(now).getTime() - 6 * DAY), to: end };
  if (period === 'monthly') return { from: new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1)), to: end };
  if (period === 'quarterly') return { from: new Date(Date.UTC(now.getUTCFullYear(), Math.floor(now.getUTCMonth() / 3) * 3, 1)), to: end };
  const f = from ? new Date(from) : startOfDay(now);
  const t = to ? new Date(`${to}T23:59:59.999Z`) : end;
  if (Number.isNaN(+f) || Number.isNaN(+t)) throw new Error('Choose a valid start date');
  if (t < f) throw new Error('The end date is before the start date');
  return { from: f, to: t };
}

export async function myReport(orgId: string, userId: string, period: ReportPeriod, from?: string, to?: string) {
  const range = periodRange(period, new Date(), from, to);
  const inRange = (d: any) => !!d && new Date(d) >= range.from && new Date(d) <= range.to;
  const mine: any[] = await Task.find(excludeDeleted({ organizationId: orgId, $or: [{ ownerId: userId }, { coOwnerIds: userId }] }))
    .select('title projectId milestoneId status severity priority percentComplete dueDate endDate startDate createdAt updatedAt completedAt closedAt statusHistory parentTaskId')
    .sort('-updatedAt').limit(3000).lean();
  const projectIds = Array.from(new Set(mine.map((t) => String(t.projectId || '')).filter(Boolean)));
  const memberProjects: any[] = await Project.find(excludeDeleted({ organizationId: orgId, $or: [{ team: userId }, { projectManagerId: userId }, { _id: { $in: projectIds } }] })).select('name status health projectManagerId milestones').lean();
  const pName = new Map(memberProjects.map((p) => [String(p._id), p.name]));
  const now = new Date();
  const open = mine.filter((t) => isOpenStatus(t.status));
  const relevant = mine.filter((t) => isOpenStatus(t.status) || inRange(t.updatedAt) || inRange(t.completedAt) || inRange(t.createdAt));

  const byStatus: Record<string, number> = {};
  for (const t of relevant) byStatus[t.status] = (byStatus[t.status] || 0) + 1;

  // What I actually did in the period: my own status changes and progress moves, newest first.
  const activity: any[] = [];
  for (const t of mine) for (const h of t.statusHistory || []) if (String(h.byId) === userId && inRange(h.at)) activity.push({ taskId: String(t._id), task: t.title, project: t.projectId ? pName.get(String(t.projectId)) : null, from: h.from, to: h.to, percent: h.percent, comment: h.comment, at: h.at, device: h.device });
  activity.sort((a, b) => +new Date(b.at) - +new Date(a.at));

  const projects = memberProjects.map((p) => {
    const pt = mine.filter((t) => String(t.projectId) === String(p._id));
    const live = pt.filter((t) => isOpenStatus(t.status));
    const ms = (p.milestones || []).filter((m: any) => String(m.ownerId) === userId);
    return {
      projectId: String(p._id), name: p.name, status: p.status, health: p.health, iManage: String(p.projectManagerId) === userId,
      tasks: pt.length, done: pt.filter((t) => isFinished(t.status)).length, open: live.length, overdue: live.filter((t) => t.dueDate && new Date(t.dueDate) < now).length,
      avgProgress: live.length ? Math.round(live.reduce((n, t) => n + (t.percentComplete || 0), 0) / live.length) : (pt.length ? 100 : 0),
      myMilestones: ms.map((m: any) => ({ title: m.title, status: m.status, endDate: m.endDate || m.dueDate })),
    };
  }).filter((p) => p.tasks > 0 || p.iManage || p.myMilestones.length);
  const noProject = mine.filter((t) => !t.projectId);
  if (noProject.length) projects.push({ projectId: '', name: 'No project', status: '', health: '', iManage: false, tasks: noProject.length, done: noProject.filter((t) => isFinished(t.status)).length, open: noProject.filter((t) => isOpenStatus(t.status)).length, overdue: noProject.filter((t) => isOpenStatus(t.status) && t.dueDate && new Date(t.dueDate) < now).length, avgProgress: 0, myMilestones: [] });

  return {
    period, from: range.from, to: range.to,
    totals: {
      owned: mine.length, open: open.length, completedInPeriod: mine.filter((t) => isFinished(t.status) && inRange(t.completedAt)).length, createdInPeriod: mine.filter((t) => inRange(t.createdAt)).length,
      overdue: open.filter((t) => t.dueDate && new Date(t.dueDate) < now).length, dueInPeriod: open.filter((t) => inRange(t.dueDate)).length,
      avgProgress: open.length ? Math.round(open.reduce((n, t) => n + (t.percentComplete || 0), 0) / open.length) : 0, statusChanges: activity.length,
    },
    byStatus,
    tasks: relevant.slice(0, 300).map((t) => ({ _id: String(t._id), title: t.title, project: t.projectId ? pName.get(String(t.projectId)) || null : null, status: t.status, percent: t.percentComplete || 0, severity: t.severity, due: t.endDate || t.dueDate, completedAt: t.completedAt, overdue: isOpenStatus(t.status) && !!t.dueDate && new Date(t.dueDate) < now })),
    projects, activity: activity.slice(0, 200),
  };
}
