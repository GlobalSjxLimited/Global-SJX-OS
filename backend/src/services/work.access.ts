import { Types } from 'mongoose';
import { Project } from '../models/Project';
import { excludeDeleted } from '../utils/softDeletePlugin';
import { isOpenStatus, canClose } from '../config/taskStatus';

export interface Actor { id: string; role: string; organizationId: string }

/** CEO / super_admin see everything (including confidential); COO sees everything that is not confidential unless involved. */
export const isTopLeader = (a: Actor) => a.role === 'super_admin' || a.role === 'ceo';
export const isLeader = (a: Actor) => isTopLeader(a) || a.role === 'coo';

export interface AccessScope {
  actor: Actor;
  memberProjectIds: string[]; // projects I belong to (as member or PM)
  managedProjectIds: string[]; // projects I manage
}

export async function loadScope(actor: Actor): Promise<AccessScope> {
  const projects = await Project.find(excludeDeleted({ organizationId: actor.organizationId, $or: [{ team: actor.id }, { projectManagerId: actor.id }] })).select('_id projectManagerId').lean();
  return {
    actor,
    memberProjectIds: projects.map((p: any) => String(p._id)),
    managedProjectIds: projects.filter((p: any) => String(p.projectManagerId) === actor.id).map((p: any) => String(p._id)),
  };
}

const oid = (v: unknown) => (v == null ? '' : String((v as any)._id || v));
const involved = (t: any, me: string) => [t.ownerId, t.creatorId, t.approverId, t.reviewerId, t.testerId].some((x) => oid(x) === me) || (t.coOwnerIds || []).some((x: any) => oid(x) === me) || (t.sharedWith || []).some((x: any) => oid(x) === me);

/** Mongo fragment: tasks this person is an owner of (primary or co-owner). */
export const ownedBy = (id: string | Types.ObjectId) => ({ $or: [{ ownerId: id }, { coOwnerIds: id }] });

/** In-memory version of the visibility rule (used on a single loaded task). */
export function canViewTask(scope: AccessScope, t: any): boolean {
  const me = scope.actor.id;
  if (isTopLeader(scope.actor)) return true;
  if (involved(t, me)) return true;
  const pid = oid(t.projectId);
  if (pid && scope.managedProjectIds.includes(pid)) return true; // project manager sees everything in their project
  if (t.confidential) return false;
  if (isLeader(scope.actor)) return true;
  return !!pid && scope.memberProjectIds.includes(pid);
}

/** Mongo version of the same rule, for list queries. Keep the two in lock-step. */
export function visibleTasksFilter(scope: AccessScope): Record<string, unknown> {
  const me = new Types.ObjectId(scope.actor.id);
  if (isTopLeader(scope.actor)) return {};
  const mine = [{ ownerId: me }, { coOwnerIds: me }, { creatorId: me }, { approverId: me }, { reviewerId: me }, { testerId: me }, { sharedWith: me }];
  const managed = scope.managedProjectIds.map((x) => new Types.ObjectId(x));
  const member = scope.memberProjectIds.map((x) => new Types.ObjectId(x));
  const or: Record<string, unknown>[] = [...mine];
  if (managed.length) or.push({ projectId: { $in: managed } });
  if (isLeader(scope.actor)) or.push({ confidential: { $ne: true } });
  else if (member.length) or.push({ confidential: { $ne: true }, projectId: { $in: member } });
  return { $or: or };
}

export interface TaskPermissions { view: boolean; edit: boolean; delete: boolean; share: boolean; approve: boolean; submit: boolean; manage: boolean; isOwner: boolean; close: boolean; isReviewer: boolean }

/** What the signed-in person may do with this task — the UI uses this to build the View / Edit / Delete dropdown. Never trust the client to compute it. */
export function taskPermissions(scope: AccessScope, t: any): TaskPermissions {
  const me = scope.actor.id;
  const view = canViewTask(scope, t);
  const pid = oid(t.projectId);
  const isOwner = oid(t.ownerId) === me || (t.coOwnerIds || []).some((x: any) => oid(x) === me);
  const isCreator = oid(t.creatorId) === me;
  const isApprover = oid(t.approverId) === me;
  const isReviewer = isApprover || oid(t.reviewerId) === me;
  const isPM = !!pid && scope.managedProjectIds.includes(pid);
  const manage = view && (isCreator || isPM || isApprover || isLeader(scope.actor));
  const open = isOpenStatus(t.status);
  return {
    view,
    isOwner,
    manage,
    edit: view && (manage || isOwner),
    delete: view && (isCreator || isPM || isLeader(scope.actor)),
    share: view && !t.confidential,
    isReviewer,
    submit: view && open && t.status !== 'to_be_reviewed' && (isOwner || manage),
    approve: view && t.status === 'to_be_reviewed' && !isOwner && (isReviewer || isPM || isTopLeader(scope.actor) || (isLeader(scope.actor) && !t.approverId)),
    /** only the project owner (or the creator of a stand-alone task) can close */
    close: view && ['complete', 'closed'].includes(t.status) && canClose({ userId: me, projectManagerId: isPM ? me : undefined, creatorId: oid(t.creatorId), hasProject: !!pid, role: scope.actor.role }),
  };
}

export const pickIds = (list: unknown[] | undefined) => Array.from(new Set((list || []).map(oid).filter(Boolean)));
export { oid };
