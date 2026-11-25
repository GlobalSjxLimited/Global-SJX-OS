import mongoose from 'mongoose';
import { Discussion, ENTITY_TYPES, EntityType, REACTIONS } from '../models/Discussion';
import { Task } from '../models/Task';
import { Project } from '../models/Project';
import { User } from '../models/User';
import { excludeDeleted } from '../utils/softDeletePlugin';
import { ApiError } from '../utils/ApiError';
import { extractMentionedUserIds } from '../utils/mentions';
import { canViewTask, isLeader, loadScope, oid, taskPermissions } from './work.access';
import { notifyWork } from './work.notify';

/** Which module a person needs to take part in a thread, and where it lives in the app. */
const META: Record<string, { module?: string; model?: string; link: (id: string, scope?: string) => string; ownerFields: string[]; label: string }> = {
  task: { link: (id) => `/tasks/${id}`, ownerFields: [], label: 'task' },
  project: { link: (id) => `/projects/${id}`, ownerFields: [], label: 'project' },
  milestone: { link: (_id, scope) => `/projects/${scope}`, ownerFields: [], label: 'milestone' },
  client: { module: 'clients', model: 'Client', link: (id) => `/clients/${id}`, ownerFields: ['accountOwnerId'], label: 'client' },
  contract: { module: 'clients', model: 'Client', link: (_id, scope) => `/clients/${scope}`, ownerFields: ['accountOwnerId'], label: 'contract' },
  opportunity: { module: 'sales', model: 'Opportunity', link: (id) => `/sales?opportunity=${id}`, ownerFields: ['salespersonId'], label: 'opportunity' },
  vendor: { module: 'vendors', model: 'Vendor', link: () => '/vendors', ownerFields: [], label: 'vendor' },
  campaign: { module: 'marketing', model: 'Campaign', link: (id) => `/marketing?campaign=${id}`, ownerFields: ['ownerId'], label: 'campaign' },
  lead: { module: 'marketing', model: 'Lead', link: () => '/marketing?tab=leads', ownerFields: [], label: 'lead' },
  expense: { module: 'expenses', model: 'ExpenseClaim', link: (id) => `/expenses?claim=${id}`, ownerFields: ['submittedById'], label: 'expense' },
  invoice: { module: 'invoices', model: 'Invoice', link: (id) => `/invoices?invoice=${id}`, ownerFields: ['createdById'], label: 'invoice' },
  sponsor: { module: 'sponsors', model: 'Sponsor', link: () => '/sponsors', ownerFields: [], label: 'sponsor' },
  risk: { module: 'risks', model: 'Risk', link: () => '/risks', ownerFields: ['ownerId', 'raisedById'], label: 'risk' },
  goal: { module: 'goals', model: 'Goal', link: () => '/goals', ownerFields: ['ownerId'], label: 'goal' },
  ticket: { module: 'tickets', model: 'Ticket', link: () => '/tickets', ownerFields: ['requesterId', 'assigneeId'], label: 'ticket' },
  asset: { module: 'assets', model: 'Asset', link: () => '/assets', ownerFields: ['assignedToId'], label: 'asset' },
  incident: { module: 'incidents', model: 'Incident', link: (id) => `/incidents?incident=${id}`, ownerFields: ['assigneeId', 'reportedById'], label: 'incident' },
  document: { module: 'documents', model: 'Document', link: () => '/documents', ownerFields: [], label: 'document' },
  post: { module: 'knowledge', model: 'KnowledgeArticle', link: (id) => `/knowledge/${id}`, ownerFields: [], label: 'article' },
};

export interface Actor { id: string; name: string; role: string; organizationId: string; modules?: string[] }
export interface EntityCtx { type: EntityType; id: string; scopeId?: string; title: string; link: string; label: string; canManage: boolean; canView: boolean; audience: string[]; doc: any }

const nameOf = (d: any) => d?.title || d?.name || d?.label || d?.reference || d?.invoiceNo || 'item';

/** Loads the thing being discussed and works out who may join and who should hear about it. Throws 404 when they may not see it. */
export async function loadEntity(actor: Actor, type: string, id: string, scopeId?: string): Promise<EntityCtx> {
  if (!(ENTITY_TYPES as readonly string[]).includes(type)) throw ApiError.badRequest('Unknown item type');
  if (!/^[a-f\d]{24}$/i.test(id)) throw ApiError.notFound('Not found');
  const meta = META[type];
  const org = actor.organizationId;
  const has = (m?: string) => !m || actor.role === 'super_admin' || (actor.modules || []).includes(m) || (m === 'expenses' && (actor.modules || []).includes('expense_approvals'));
  const base = { type: type as EntityType, id, label: meta.label };

  if (type === 'task') {
    const t: any = await Task.findOne(excludeDeleted({ _id: id, organizationId: org }));
    if (!t) throw ApiError.notFound('Not found');
    const scope = await loadScope({ id: actor.id, role: actor.role, organizationId: org });
    if (!canViewTask(scope, t)) throw ApiError.notFound('Not found');
    const perms = taskPermissions(scope, t);
    let proj: string[] = [];
    if (t.projectId && !t.confidential) { const p: any = await Project.findById(t.projectId).select('projectManagerId team'); if (p) proj = [oid(p.projectManagerId), ...(p.team || []).map(oid)]; }
    const audience = uniq([oid(t.ownerId), ...(t.coOwnerIds || []).map(oid), oid(t.creatorId), oid(t.approverId), oid(t.reviewerId), ...(t.sharedWith || []).map(oid), ...proj]);
    return { ...base, title: t.title, link: meta.link(id), canManage: perms.manage, canView: true, audience, doc: t };
  }
  if (type === 'project' || type === 'milestone') {
    const pid = type === 'project' ? id : scopeId;
    if (!pid || !/^[a-f\d]{24}$/i.test(pid)) throw ApiError.badRequest('Project is required for a milestone thread');
    const p: any = await Project.findOne(excludeDeleted({ _id: pid, organizationId: org }));
    if (!p) throw ApiError.notFound('Not found');
    const member = [oid(p.projectManagerId), ...(p.team || []).map(oid)].includes(actor.id);
    if (!member && !isLeader({ id: actor.id, role: actor.role, organizationId: org })) throw ApiError.notFound('Not found');
    let title = p.name; const aud = [oid(p.projectManagerId), ...(p.team || []).map(oid)];
    if (type === 'milestone') { const m = p.milestones.id(id); if (!m) throw ApiError.notFound('Not found'); title = `${p.name} · ${m.title}`; aud.push(oid(m.ownerId), oid(m.approverId)); }
    return { ...base, scopeId: pid, title, link: meta.link(id, pid), canManage: oid(p.projectManagerId) === actor.id || isLeader({ id: actor.id, role: actor.role, organizationId: org }), canView: true, audience: uniq(aud), doc: p };
  }
  if (!has(meta.module)) throw ApiError.forbidden('Your role does not include access to this area.');
  const Model = mongoose.models[meta.model!];
  if (!Model) throw ApiError.notFound('Not found');
  const lookupId = type === 'contract' ? scopeId : id;
  if (!lookupId || !/^[a-f\d]{24}$/i.test(lookupId)) throw ApiError.badRequest('Parent record is required');
  const d: any = await Model.findOne({ _id: lookupId, organizationId: org, isDeleted: { $ne: true } });
  if (!d) throw ApiError.notFound('Not found');
  if (type === 'contract' && !(d.contracts || []).some((c: any) => String(c._id) === id)) throw ApiError.notFound('Not found');
  // Some records are private to a few people even for someone who has the module. Hide them the same way the module's own screens do.
  if (type === 'expense') {
    const own = oid(d.submittedById) === actor.id;
    const approver = actor.role === 'super_admin' || (actor.modules || []).includes('expense_approvals');
    if (!own && !(approver && d.status !== 'draft')) throw ApiError.notFound('Not found');
  }
  if (type === 'ticket' && ['client', 'vendor', 'training_customer'].includes(actor.role) && oid(d.requesterId) !== actor.id) throw ApiError.notFound('Not found');
  const owners = meta.ownerFields.map((f) => oid(d[f]));
  const audience = uniq([...owners, oid(d.createdBy?.id)]);
  return { ...base, scopeId: type === 'contract' ? lookupId : undefined, title: nameOf(d), link: meta.link(id, lookupId), canManage: isLeader({ id: actor.id, role: actor.role, organizationId: org }) || owners.includes(actor.id), canView: true, audience, doc: d };
}

const uniq = (a: string[]) => Array.from(new Set(a.filter(Boolean)));

export function summariseReactions(list: any[], me: string) {
  const out: Record<string, { count: number; mine: boolean; names: string[] }> = {};
  for (const r of list || []) {
    const o = (out[r.emoji] ||= { count: 0, mine: false, names: [] });
    o.count += 1; if (String(r.userId) === me) o.mine = true; if (r.name && o.names.length < 8) o.names.push(r.name);
  }
  return out;
}

export function presentComment(c: any, actor: Actor, canManage: boolean) {
  const o = typeof c.toObject === 'function' ? c.toObject() : c;
  const mine = oid(o.authorId) === actor.id;
  const leader = isLeader({ id: actor.id, role: actor.role, organizationId: actor.organizationId });
  const base = {
    _id: o._id, parentId: o.parentId || null, kind: o.kind, authorId: o.authorId, authorName: o.authorName, createdAt: o.createdAt, editedAt: o.editedAt, editedByName: o.editedByName,
    status: o.status, deleted: !!o.isDeleted, from: o.from,
  };
  if (o.isDeleted) return { ...base, body: '', attachments: [], reactions: {}, mentions: [], canEdit: false, canDelete: false };
  return {
    ...base, body: o.body, attachments: o.attachments || [], mentions: o.mentions || [], awareness: o.awareness || [], reactions: summariseReactions(o.reactions, actor.id),
    canEdit: mine && o.kind !== 'system',
    canDelete: o.kind !== 'system' && (o.kind === 'status' ? leader : mine || canManage || leader),
  };
}

export const mentionToken = (name: string, id: string) => `@[${name}](${id})`;

interface PostInput {
  actor: Actor; entity: EntityCtx; body: string; parentId?: string; kind?: 'comment' | 'status' | 'system';
  status?: { from?: string; to?: string; percent?: number }; notify?: 'none' | 'mentioned' | 'all'; awareness?: string[]; attachments?: Array<{ name: string; url: string; kind?: string }>;
  from?: { ip?: string; device?: string }; silent?: boolean; extraRecipients?: string[];
}

/** Writes one comment and sends the right notifications. Used by the thread API and by workflows (status changes). */
export async function postComment(i: PostInput) {
  const { actor, entity } = i;
  let parent: any = null;
  if (i.parentId) {
    parent = await Discussion.findOne({ _id: i.parentId, organizationId: actor.organizationId, entityType: entity.type, entityId: entity.id });
    if (!parent) throw ApiError.badRequest('The comment you are replying to no longer exists');
  }
  const mentions = extractMentionedUserIds(i.body).filter((x) => /^[a-f\d]{24}$/i.test(x));
  const awareness = uniq(i.awareness || []).filter((x) => x !== actor.id);
  const c: any = await Discussion.create({
    organizationId: actor.organizationId, entityType: entity.type, entityId: entity.id, scopeId: entity.scopeId, parentId: parent?._id, kind: i.kind || 'comment', body: i.body,
    status: i.status, authorId: actor.id, authorName: actor.name, mentions, awareness, notify: i.notify || 'mentioned', attachments: i.attachments, from: i.from,
  });
  if (i.silent || i.notify === 'none') return c;

  const heard = new Set<string>();
  const send = async (ids: string[], title: string, summary: string, opts: { email?: boolean; type?: string } = {}) => {
    const fresh = ids.filter((x) => x && x !== actor.id && !heard.has(x));
    fresh.forEach((x) => heard.add(x));
    if (!fresh.length) return;
    await notifyWork({ organizationId: actor.organizationId, userIds: fresh, title, summary, note: i.body.replace(/@\[([^\]]+)\]\([a-f\d]{24}\)/g, '@$1').slice(0, 400), link: entity.link, cta: `Open ${entity.label}`, email: !!opts.email, type: opts.type || 'comment', entity: { type: entity.type, id: entity.id } });
  };
  const subject = `${entity.label} "${entity.title}"`;
  await send(mentions, `${actor.name} tagged you`, `${actor.name} tagged you on ${subject}.`, { email: true, type: 'mention' });
  if (parent && oid(parent.authorId) !== actor.id) await send([oid(parent.authorId)], 'New reply to your comment', `${actor.name} replied to your comment on ${subject}.`);
  if (i.notify === 'all') await send(entity.audience, i.kind === 'status' ? `Status changed: ${entity.title}` : `New comment on ${entity.title}`, `${actor.name} ${i.kind === 'status' ? 'changed the status of' : 'commented on'} ${subject}.`);
  if (i.extraRecipients?.length) await send(i.extraRecipients, `Update on ${entity.title}`, `${actor.name} ${i.kind === 'status' ? 'changed the status of' : 'commented on'} ${subject}.`);
  if (awareness.length) await send(awareness, `For your awareness: ${entity.title}`, `${actor.name} tagged you to make you aware of ${subject}.`);
  return c;
}

/** Add people to a task's followers so a tag actually gives them access (never for confidential tasks). */
export async function grantAwareness(actor: Actor, entity: EntityCtx, ids: string[]) {
  if (entity.type !== 'task' || !ids.length) return;
  const t = entity.doc;
  const known = new Set<string>([oid(t.ownerId), oid(t.creatorId), ...(t.coOwnerIds || []).map(oid), ...(t.sharedWith || []).map(oid)]);
  const add = ids.filter((x) => !known.has(x));
  if (!add.length) return;
  if (t.confidential) throw ApiError.badRequest('This task is confidential, so you cannot tag people who do not already have access.');
  const users = await User.find({ _id: { $in: add }, organizationId: actor.organizationId, isActive: true }).select('_id');
  t.set('sharedWith', [...(t.sharedWith || []).map(oid), ...users.map((u: any) => String(u._id))]);
  await t.save();
}

export { REACTIONS };
