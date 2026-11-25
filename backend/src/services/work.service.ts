import { Task } from '../models/Task';
import { Risk } from '../models/Risk';
import { Project } from '../models/Project';
import { excludeDeleted } from '../utils/softDeletePlugin';
import { isFinished } from '../config/taskStatus';

/** A task becomes "blocked" while an open blocking risk/blocker is linked to it, and returns to in-progress when the last one closes. */
export async function syncTaskBlocked(taskId: unknown): Promise<void> {
  if (!taskId) return;
  const task = await Task.findOne(excludeDeleted({ _id: taskId }));
  if (!task || ['complete', 'closed', 'cancelled', 'abandoned', 'to_be_reviewed'].includes(task.status)) return;
  const open = await Risk.countDocuments(excludeDeleted({ relatedTaskId: task._id, blocking: true, status: { $ne: 'closed' } }));
  if (open > 0 && !task.blocked) {
    task.blocked = true;
    if (task.status !== 'on_hold') {
      task.activityHistory.push({ action: 'blocked', meta: { from: task.status, openBlockers: open } } as any);
      task.status = 'on_hold';
      (task as any).hold = { reason: 'blocked_by_risk', note: `${open} open blocking risk${open === 1 ? '' : 's'}`, since: new Date() };
    }
    await task.save();
  } else if (open === 0 && task.blocked) {
    task.blocked = false;
    if (task.status === 'on_hold' && (task as any).hold?.reason === 'blocked_by_risk') {
      task.status = 'in_progress';
      task.activityHistory.push({ action: 'unblocked' } as any);
    }
    await task.save();
  }
}

export async function syncMilestoneBlocked(projectId: unknown, milestoneId: unknown): Promise<void> {
  if (!projectId || !milestoneId) return;
  const project = await Project.findOne(excludeDeleted({ _id: projectId }));
  const m: any = project?.milestones.id(milestoneId as any);
  if (!project || !m || ['completed', 'awaiting_approval'].includes(m.status)) return;
  const open = await Risk.countDocuments(excludeDeleted({ relatedMilestoneId: milestoneId, blocking: true, status: { $ne: 'closed' } }));
  if (open > 0 && !m.blocked) { m.blocked = true; m.status = 'blocked'; await project.save(); }
  else if (open === 0 && m.blocked) { m.blocked = false; if (m.status === 'blocked') m.status = 'in_progress'; await project.save(); }
}

/** Milestone progress comes from its tasks, so "what was done, by whom" is always traceable. */
export async function milestoneStats(organizationId: string, projectId: unknown, milestoneId: unknown) {
  const tasks = await Task.find(excludeDeleted({ organizationId, projectId, milestoneId, parentTaskId: { $exists: false } })).select('status ownerId title endDate dueDate severity').lean();
  const done = tasks.filter((t: any) => isFinished(t.status)).length;
  return { total: tasks.length, done, open: tasks.length - done, percent: tasks.length ? Math.round((done / tasks.length) * 100) : 0 };
}
