import { Task } from '../models/Task';
import { Project } from '../models/Project';
import { Goal } from '../models/Goal';
import { Meeting } from '../models/Meeting';
import { excludeDeleted } from '../utils/softDeletePlugin';
import { notifyWork } from './work.notify';
import { parseQuarter, quarterOf } from '../utils/quarter';
import { TERMINAL } from '../config/taskStatus';

const DAY = 86400000;
const oid = (v: unknown) => (v == null ? '' : String((v as any)._id || v));
const ymd = (d = new Date()) => d.toISOString().slice(0, 10);
const week = (d = new Date()) => `${d.getUTCFullYear()}-W${Math.floor((+d - Date.UTC(d.getUTCFullYear(), 0, 1)) / (7 * DAY))}`;

export type Item = { type: string; severity: 'info' | 'warning' | 'high' | 'critical'; title: string; detail?: string; due?: Date | null; link: string };

/** Daily job: due-soon / overdue tasks, approvals waiting, milestones due, goals nearing quarter end. Each message is de-duplicated. */
export async function workRemindersRun(orgId: string): Promise<number> {
  let sent = 0;
  const now = new Date();
  const soon = new Date(now.getTime() + DAY + 3600000);

  // Tasks due within a day (once each) and overdue (first day, then weekly).
  const tasks: any[] = await Task.find(excludeDeleted({ organizationId: orgId, status: { $nin: [...TERMINAL, 'to_be_reviewed', 'on_hold'] }, dueDate: { $lt: soon } })).select('title ownerId coOwnerIds dueDate severity status confidential creatorId').limit(2000).lean();
  for (const t of tasks) {
    const overdue = new Date(t.dueDate) < now;
    const key = overdue ? `taskdue:${t._id}:od:${week()}` : `taskdue:${t._id}:soon`;
    const hot = ['critical', 'show_stopper'].includes(t.severity);
    sent += await notifyWork({
      organizationId: orgId, userIds: [oid(t.ownerId), ...(t.coOwnerIds || []).map(oid)], title: overdue ? `Overdue: ${t.title}` : `Due soon: ${t.title}`,
      summary: overdue ? `"${t.title}" was due on ${new Date(t.dueDate).toLocaleDateString('en-GB')}.` : `"${t.title}" is due ${new Date(t.dueDate).toLocaleDateString('en-GB')}.`,
      rows: [['Task', t.title], ['Severity', String(t.severity).replace(/_/g, ' ')]], link: `/tasks/${t._id}`, cta: 'Open task', severity: overdue ? (hot ? 'high' : 'warning') : 'info', dedupeKey: key, email: true,
    });
  }

  // Approvals waiting: ping the approver every 3 days.
  const waiting: any[] = await Task.find(excludeDeleted({ organizationId: orgId, status: 'to_be_reviewed', approverId: { $exists: true } })).select('title approverId approval').lean();
  for (const t of waiting) {
    const since = t.approval?.submittedAt ? new Date(t.approval.submittedAt) : now;
    const age = Math.floor((now.getTime() - since.getTime()) / DAY);
    if (age < 2) continue;
    sent += await notifyWork({ organizationId: orgId, userIds: [oid(t.approverId)], title: `Still waiting for your approval: ${t.title}`, summary: `"${t.title}" has been waiting ${age} days for approval.`, link: `/tasks/${t._id}`, cta: 'Review and approve', severity: age >= 5 ? 'high' : 'warning', dedupeKey: `taskappr:${t._id}:${Math.floor(age / 3)}` });
  }

  // Milestones: due in 3 days or less, and milestones waiting for approval.
  const projects: any[] = await Project.find(excludeDeleted({ organizationId: orgId, status: { $in: ['active', 'planning'] } })).select('name projectManagerId milestones').lean();
  for (const p of projects) for (const m of p.milestones || []) {
    const end = m.endDate || m.dueDate;
    if (end && !['completed'].includes(m.status) && new Date(end).getTime() - now.getTime() < 3 * DAY && new Date(end) > new Date(now.getTime() - 14 * DAY)) {
      const to = Array.from(new Set([oid(m.ownerId), oid(p.projectManagerId)].filter(Boolean)));
      sent += await notifyWork({ organizationId: orgId, userIds: to, title: `Milestone ${new Date(end) < now ? 'overdue' : 'due soon'}: ${m.title}`, summary: `The milestone "${m.title}" on ${p.name} ${new Date(end) < now ? 'is overdue' : 'is due within 3 days'}.`, rows: [['Milestone title', m.title], ['Project title', p.name], ['Severity', m.severity]], link: `/projects/${p._id}`, type: 'project', severity: new Date(end) < now ? 'high' : 'warning', dedupeKey: `msdue:${m._id}:${new Date(end) < now ? week() : 'soon'}` });
    }
    if (m.status === 'awaiting_approval' && m.approverId) {
      const age = m.approval?.submittedAt ? Math.floor((now.getTime() - new Date(m.approval.submittedAt).getTime()) / DAY) : 0;
      if (age >= 2) sent += await notifyWork({ organizationId: orgId, userIds: [oid(m.approverId)], title: `Milestone waiting for approval: ${m.title}`, summary: `"${m.title}" on ${p.name} has been waiting ${age} days.`, link: `/projects/${p._id}`, type: 'project', severity: 'warning', dedupeKey: `msappr:${m._id}:${Math.floor(age / 3)}` });
    }
  }

  // Goals: two weeks before the quarter ends, owners with unfinished goals get a nudge (once per goal per quarter).
  const q = parseQuarter(quarterOf(now))!;
  if (q.to.getTime() - now.getTime() <= 14 * DAY) {
    const goals: any[] = await Goal.find(excludeDeleted({ organizationId: orgId, quarter: quarterOf(now), status: { $ne: 'completed' } })).select('title ownerId progressPercent').lean();
    for (const g of goals) sent += await notifyWork({ organizationId: orgId, userIds: [oid(g.ownerId)], title: `Goal closes soon: ${g.title}`, summary: `The quarter ends ${q.to.toLocaleDateString('en-GB')} and "${g.title}" is at ${g.progressPercent || 0}%. Update your progress and attach evidence.`, link: '/goals', type: 'goal', severity: 'warning', dedupeKey: `goalend:${g._id}:${quarterOf(now)}` });
  }
  return sent;
}

/** What is urgent for one person right now (Reminders page + dashboard badge). */
export async function workFor(user: { id: string; organizationId: string }): Promise<Item[]> {
  const out: Item[] = [];
  const now = new Date();
  const [mine, approvals, noRec, goals] = await Promise.all([
    Task.find(excludeDeleted({ organizationId: user.organizationId, $or: [{ ownerId: user.id }, { coOwnerIds: user.id }], status: { $nin: [...TERMINAL, 'to_be_reviewed', 'on_hold'] }, dueDate: { $lt: new Date(now.getTime() + 2 * DAY) } })).select('title dueDate severity').limit(30).lean(),
    Task.find(excludeDeleted({ organizationId: user.organizationId, $or: [{ approverId: user.id }, { reviewerId: user.id }], status: 'to_be_reviewed' })).select('title approval').limit(30).lean(),
    Meeting.find(excludeDeleted({ organizationId: user.organizationId, $or: [{ organizerId: user.id }, { 'recording.recorderId': user.id }], 'recording.reminderEnabled': true, 'recording.uploaded': { $ne: true }, 'recording.reminderCancelledAt': { $exists: false }, status: { $ne: 'cancelled' }, date: { $lt: now } })).select('title date').limit(20).lean(),
    Goal.find(excludeDeleted({ organizationId: user.organizationId, ownerId: user.id, quarter: quarterOf(now), status: { $ne: 'completed' } })).select('title progressPercent').lean(),
  ]);
  for (const t of mine as any[]) out.push({ type: 'task', severity: new Date(t.dueDate) < now ? (['critical', 'show_stopper'].includes(t.severity) ? 'critical' : 'high') : 'warning', title: `${new Date(t.dueDate) < now ? 'Overdue' : 'Due soon'}: ${t.title}`, due: t.dueDate, link: `/tasks/${t._id}` });
  for (const t of approvals as any[]) out.push({ type: 'approval', severity: 'warning', title: `Approve: ${t.title}`, detail: 'Submitted with evidence', due: t.approval?.submittedAt, link: `/tasks/${t._id}` });
  for (const m of noRec as any[]) out.push({ type: 'meeting', severity: 'warning', title: `Upload the recording: ${m.title}`, due: m.date, link: `/meetings?meeting=${m._id}` });
  for (const g of goals as any[]) out.push({ type: 'goal', severity: 'info', title: `Goal in progress: ${g.title}`, detail: `${g.progressPercent || 0}%`, link: '/goals' });
  return out;
}
