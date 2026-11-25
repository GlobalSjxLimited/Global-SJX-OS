import PDFDocument from 'pdfkit';
import { Types } from 'mongoose';
import { Asset } from '../models/Asset';
import { Goal } from '../models/Goal';
import { Incident } from '../models/Governance';
import { nextNumber, UserSession } from '../models/Access';
import { Offboarding, DONE_STATUSES, RETURN_KINDS, TRANSFER_KINDS } from '../models/Offboarding';
import { Project } from '../models/Project';
import { Risk } from '../models/Risk';
import { Task } from '../models/Task';
import { User } from '../models/User';
import { appendEvent } from '../utils/assetAudit';
import { excludeDeleted } from '../utils/softDeletePlugin';
import { ApiError } from '../utils/ApiError';
import { logActivity } from '../models/ActivityLog';
import { usersWithModule } from './access.service';
import { notifyWork } from './work.notify';
import { dataTable, esc, fmtDate } from './mail.templates';
import { LOGO_PATH } from './mail.templates';
import { logger } from '../utils/logger';
import { OPEN_FILTER } from '../config/taskStatus';

export type By = { id: string; name: string; role: string };
const oid = (v: any) => String(v?._id || v || '');
const label = (s?: string) => (s ? s.replace(/_/g, ' ').replace(/^./, (c) => c.toUpperCase()) : '');
const DAY = 86400000;

/* ------------------------------ pure helpers ------------------------------- */
export const isDone = (it: any) => (DONE_STATUSES as readonly string[]).includes(it.status);
export const isHandback = (kind: string) => (RETURN_KINDS as readonly string[]).includes(kind);
export const isHandover = (kind: string) => (TRANSFER_KINDS as readonly string[]).includes(kind);

/** Physical vs digital, and whether data must be wiped, for an asset category. */
export function mediumForCategory(category?: string): { medium: 'physical' | 'digital' | 'both' | 'na'; requiresWipe: boolean } {
  switch (category) {
    case 'hardware': return { medium: 'physical', requiresWipe: true };
    case 'network': return { medium: 'physical', requiresWipe: true };
    case 'facilities': return { medium: 'physical', requiresWipe: false };
    case 'information': return { medium: 'digital', requiresWipe: true };
    case 'software': case 'cloud': return { medium: 'digital', requiresWipe: false };
    case 'people': return { medium: 'digital', requiresWipe: false };
    default: return { medium: 'both', requiresWipe: false };
  }
}

export interface ReclaimInput { condition?: string; medium?: string; dataWipeVerified?: boolean; wipeMethod?: string; wipeReference?: string; accessoriesComplete?: boolean; note?: string }
/** Returns the problems that stop an item being accepted as reclaimed (Return of Asset Policy 2.2). */
export function reclaimProblems(item: { kind: string; requiresWipe?: boolean; medium?: string }, i: ReclaimInput): string[] {
  const p: string[] = [];
  const conds = ['good', 'fair', 'damaged'];
  if (!i.condition || !conds.includes(i.condition)) p.push('Record the condition of the item: good, fair or damaged (a lost item is written off by leadership instead).');
  if (i.condition === 'damaged' && !i.note?.trim()) p.push('Describe the damage in the note.');
  if (item.requiresWipe) {
    if (!i.dataWipeVerified) p.push('Confirm that all data on it was securely erased and verified before accepting it back.');
    else if (!i.wipeMethod?.trim()) p.push('Say how the data was erased (approved wiping software / method).');
  }
  if (item.kind === 'asset' && item.medium === 'physical' && i.accessoriesComplete === false && !i.note?.trim()) p.push('Some accessories are missing — say which in the note.');
  return p;
}

export interface Progress { total: number; done: number; awaitingApproval: number; pendingFromLeaver: number; exceptions: number; overdue: number; percent: number }
export function progressOf(c: any, now = new Date()): Progress {
  const items: any[] = (c.items || []).filter((i: any) => i.required !== false);
  const done = items.filter(isDone).length;
  const lwd = c.lastWorkingDay ? new Date(c.lastWorkingDay) : null;
  const past = !!lwd && lwd.getTime() + DAY <= now.getTime();
  const open = items.filter((i) => !isDone(i));
  return {
    total: items.length, done,
    awaitingApproval: items.filter((i) => i.status === 'submitted').length,
    pendingFromLeaver: items.filter((i) => i.status === 'pending' && isHandback(i.kind)).length,
    exceptions: items.filter((i) => i.status === 'exception_requested').length,
    overdue: past ? open.filter((i) => i.status !== 'exception_approved').length : 0,
    percent: items.length ? Math.round((done / items.length) * 100) : 100,
  };
}

/** Why the case cannot be cleared yet. Empty = ready. */
export function clearanceBlockers(c: any): string[] {
  const out: string[] = [];
  for (const i of c.items || []) {
    if (i.required === false || isDone(i) || i.status === 'exception_approved') continue;
    out.push(`${String(i.label).toLowerCase().startsWith(label(i.kind).toLowerCase()) ? '' : `${label(i.kind)}: `}${i.label} — ${i.status === 'submitted' ? 'awaiting HR/admin verification' : i.status === 'exception_requested' ? 'exception awaiting decision' : 'not yet returned / handed over'}`);
  }
  if (!c.inventory?.declaredAt) out.push('The leaver has not signed the inventory declaration (policy 2.5).');
  return out;
}

/* ------------------------------- checklist --------------------------------- */
export async function buildChecklist(organizationId: string, userId: string, existing: any[] = []): Promise<any[]> {
  const has = new Set(existing.filter((i) => i.refId).map((i) => `${i.kind}:${oid(i.refId)}`));
  const items: any[] = [];
  const push = (it: any) => { if (it.refId && has.has(`${it.kind}:${oid(it.refId)}`)) return; items.push({ source: 'auto', required: true, status: 'pending', history: [], ...it }); };

  const assets: any[] = await Asset.find(excludeDeleted({ organizationId, assignedToId: userId, lifecycleStatus: { $nin: ['disposed'] } })).select('assetId title category classification serialNumber makeModel').limit(300).lean();
  for (const a of assets) {
    const m = mediumForCategory(a.category);
    push({ kind: 'asset', refId: a._id, refCode: a.assetId, label: `${a.assetId} · ${a.title}`, detail: [a.makeModel, a.serialNumber && `S/N ${a.serialNumber}`, a.classification].filter(Boolean).join(' · '), medium: m.medium, requiresWipe: m.requiresWipe });
  }
  const tasks: any[] = await Task.find(excludeDeleted({ organizationId, $or: [{ ownerId: userId }, { coOwnerIds: userId }], status: OPEN_FILTER })).select('title projectId parentTaskId status endDate dueDate').limit(500).lean();
  for (const t of tasks) push({ kind: 'task', refId: t._id, label: `${t.parentTaskId ? 'Subtask' : 'Task'}: ${t.title}`, detail: `${label(t.status)}${t.endDate || t.dueDate ? ` · due ${fmtDate(t.endDate || t.dueDate)}` : ''}`, medium: 'na' });
  const approvals: any[] = await Task.find(excludeDeleted({ organizationId, $or: [{ approverId: userId }, { reviewerId: userId }], status: OPEN_FILTER })).select('title status').limit(200).lean();
  for (const t of approvals) push({ kind: 'approval', refId: t._id, label: `Approver on: ${t.title}`, detail: `${label(t.status)} — someone else must sign this off`, medium: 'na' });
  const projects: any[] = await Project.find(excludeDeleted({ organizationId, projectManagerId: userId, status: { $nin: ['completed', 'cancelled'] } })).select('name status').lean();
  for (const p of projects) push({ kind: 'project', refId: p._id, label: `Project manager of: ${p.name}`, detail: label(p.status), medium: 'na' });
  const goals: any[] = await Goal.find(excludeDeleted({ organizationId, ownerId: userId, status: { $ne: 'completed' } })).select('title quarter').lean();
  for (const g of goals) push({ kind: 'goal', refId: g._id, label: `Goal: ${g.title}`, detail: g.quarter, medium: 'na' });
  const risks: any[] = await Risk.find(excludeDeleted({ organizationId, ownerId: userId, status: { $ne: 'closed' } })).select('title kind severity').lean();
  for (const r of risks) push({ kind: 'risk', refId: r._id, label: `${label(r.kind)}: ${r.title}`, detail: `severity ${r.severity}`, medium: 'na' });

  if (!existing.some((i) => i.source === 'policy')) {
    const pol = (kind: string, lab: string, detail: string, medium: string, extra: any = {}) => items.push({ source: 'policy', required: true, status: 'pending', history: [], kind, label: lab, detail, medium, ...extra });
    pol('credential', 'ID / access cards, keys and authentication hardware', 'Fingerprint scanners, hardware tokens, keys, identification and authorisation cards (policy 2.1).', 'physical');
    pol('physical_info', 'Physical copies of company information', 'Written or printed papers containing company information (policy 2.1).', 'physical');
    pol('personal_equipment', 'Company data on personal equipment', 'If you used your own phone / laptop for work: transfer anything relevant to us, then securely erase it (policy 2.3.2).', 'digital', { requiresWipe: true });
    pol('knowledge', 'Hand-over of knowledge important to operations', 'Document anything only you know — procedures, passwords held in the vault, client history — and hand it over (policy 2.3.3).', 'digital');
    pol('access', 'System login and active sessions', 'Disabled automatically on the last working day.', 'digital', { required: true });
    pol('access', 'Module access grants and overrides', 'Cleared automatically on the last working day.', 'digital', { required: true });
    pol('access', 'Third-party, cloud and shared accounts', 'Remove the leaver from vendor portals, shared mailboxes and any account whose password they knew; rotate those passwords.', 'digital');
  }
  return items;
}

/* ------------------------------ access revoke ------------------------------- */
export async function revokeAccess(c: any, by: By | null, method: 'scheduled' | 'manual' | 'immediate'): Promise<void> {
  const user: any = await User.findOne({ _id: c.employeeId, organizationId: c.organizationId });
  if (!user) return;
  const before = { grants: (user.moduleGrant || []).length, denies: (user.moduleDeny || []).length };
  user.isActive = false;
  user.loginEnabled = false;
  user.employmentStatus = 'offboarded';
  user.offboardedAt = new Date();
  user.offboardReason = (c.reason || label(c.type)).slice(0, 300);
  user.tokenVersion = (user.tokenVersion || 0) + 1;
  user.moduleGrant = [];
  user.moduleDeny = [];
  await user.save();
  const ended = await UserSession.updateMany({ userId: user._id, isActive: true }, { isActive: false, terminatedAt: new Date(), terminationReason: 'Offboarded' });
  c.access = { revokedAt: new Date(), revokedById: by?.id, revokedByName: by?.name || 'System (last working day)', method, summary: `Login disabled, ${(ended as any).modifiedCount ?? ''} session(s) ended, ${before.grants + before.denies} module override(s) cleared` };
  for (const i of c.items) {
    if (i.kind === 'access' && i.source === 'policy' && /login|module/i.test(i.label) && !isDone(i)) {
      i.status = 'reclaimed'; i.condition = 'not_applicable'; i.decidedByName = by?.name || 'System'; i.decidedAt = new Date(); i.decisionNote = 'Revoked automatically';
      i.history.push({ at: new Date(), byName: i.decidedByName, action: 'access_revoked', note: c.access.summary });
    }
  }
  c.timeline.push({ at: new Date(), byId: by?.id, byName: by?.name || 'System', action: 'access_revoked', note: c.access.summary });
  await logActivity({ organizationId: String(c.organizationId), actorId: by?.id, actorName: by?.name || 'System', action: 'employee.offboarded', entityType: 'User', entityId: String(user._id), severity: 'high', module: 'employees', summary: `${user.name} offboarded (${method}) — login revoked, sessions ended, module grants cleared` } as any);
}

/* --------------------------------- create ---------------------------------- */
export async function startOffboarding(opts: { organizationId: string; employeeId: string; by: By; lastWorkingDay: Date; type?: string; reason?: string; immediate?: boolean }) {
  const user: any = await User.findOne({ _id: opts.employeeId, organizationId: opts.organizationId });
  if (!user) throw ApiError.notFound('Employee not found');
  const existing = await Offboarding.findOne({ organizationId: opts.organizationId, employeeId: opts.employeeId, status: 'open' });
  if (existing) throw ApiError.conflict(`An offboarding case (${existing.reference}) is already open for ${user.name}.`);
  const items = await buildChecklist(opts.organizationId, opts.employeeId);
  const c: any = new Offboarding({
    organizationId: opts.organizationId,
    reference: await nextNumber(opts.organizationId, 'OFF', { yearly: true, pad: 4 }),
    employeeId: user._id, employeeName: user.name, employeeEmail: user.email, department: user.department, jobTitle: user.jobTitle, managerId: user.managerId,
    type: opts.type || 'resignation', reason: opts.reason?.slice(0, 500), lastWorkingDay: opts.lastWorkingDay,
    initiatedById: opts.by.id, initiatedByName: opts.by.name, items,
    timeline: [{ at: new Date(), byId: opts.by.id, byName: opts.by.name, action: 'opened', note: `${label(opts.type || 'resignation')} · last working day ${fmtDate(opts.lastWorkingDay)} · ${items.length} items to account for` }],
  });
  if (opts.immediate) await revokeAccess(c, opts.by, 'immediate');
  await c.save();
  await notifyStart(c);
  await logActivity({ organizationId: opts.organizationId, actorId: opts.by.id, actorName: opts.by.name, action: 'offboarding.opened', entityType: 'Offboarding', entityId: String(c._id), severity: 'high', module: 'offboarding', summary: `${c.reference} ${user.name} — ${items.length} items` } as any);
  return c;
}

async function approvers(organizationId: string, excludeId?: string) {
  return (await usersWithModule(organizationId, 'offboarding')).filter((u) => String(u._id) !== excludeId);
}

async function notifyStart(c: any) {
  const org = String(c.organizationId);
  const rows = c.items.filter((i: any) => isHandback(i.kind) || i.kind === 'task').slice(0, 40).map((i: any) => [esc(label(i.kind)), esc(i.label), esc(i.medium === 'na' ? '—' : label(i.medium))]);
  const table = dataTable(['Type', 'Item', 'Medium'], rows);
  const when = fmtDate(c.lastWorkingDay);
  await notifyWork({
    organizationId: org, userIds: [oid(c.employeeId)], type: 'offboarding', severity: 'warning',
    title: `Return of Asset Form — please return everything by ${when}`,
    summary: `Your last working day is ${when}. Everything issued to you must be returned (or handed over) on or before that day, in good working condition, with accessories, and with your personal data wiped.`,
    rows: [['Reference', c.reference], ['Last working day', when]],
    extraHtml: `${table}<p style="font-size:13px">Open your return form to declare each item, say whether you are returning it physically or digitally, and sign the inventory. Items not returned in time may be treated as stolen and may lead to legal action (Return of Asset Policy 2.4).</p>`,
    link: '/my-offboarding', cta: 'Open my return form',
  });
  const staff = await approvers(org, oid(c.employeeId));
  const recipients = new Set(staff.map((u) => String(u._id)));
  if (c.managerId) recipients.add(oid(c.managerId));
  await notifyWork({
    organizationId: org, userIds: Array.from(recipients), type: 'offboarding', severity: 'warning',
    title: `Offboarding opened: ${c.employeeName} leaves ${when}`,
    summary: `${c.employeeName} (${c.jobTitle || c.department || 'staff'}) is leaving. ${c.items.filter((i: any) => i.kind === 'asset').length} asset(s) and ${c.items.filter((i: any) => ['task', 'approval', 'project', 'goal', 'risk'].includes(i.kind)).length} work item(s) must be reclaimed or reassigned.`,
    rows: [['Reference', c.reference], ['Last working day', when], ['Type', label(c.type)]],
    link: `/offboarding?case=${c._id}`, cta: 'Open the case',
  });
}

/* ----------------------------- item side effects ---------------------------- */
const hist = (by: By | null, action: string, note?: string) => ({ at: new Date(), byId: by?.id, byName: by?.name || 'System', action, note });

export async function applyReclaim(c: any, item: any, by: By, input: ReclaimInput & { evidence?: any[] }) {
  const problems = reclaimProblems(item, input);
  if (problems.length) throw ApiError.badRequest(problems.join(' '), problems);
  item.status = 'reclaimed';
  item.condition = input.condition;
  item.verifiedMedium = (['physical', 'digital', 'both'].includes(input.medium || '') ? input.medium : item.declaredMedium || item.medium) as any;
  item.dataWipeVerified = !!input.dataWipeVerified;
  item.wipeMethod = input.wipeMethod?.slice(0, 200);
  item.wipeReference = input.wipeReference?.slice(0, 120);
  item.accessoriesComplete = input.accessoriesComplete;
  item.decidedById = by.id; item.decidedByName = by.name; item.decidedAt = new Date(); item.decisionNote = input.note?.slice(0, 500);
  if (input.evidence?.length) item.evidence.push(...input.evidence.slice(0, 10).map((e: any) => ({ name: String(e.name || 'evidence').slice(0, 120), url: String(e.url || '') })));
  item.history.push(hist(by, 'reclaimed', `${label(input.condition)} · ${label(item.verifiedMedium)}${input.dataWipeVerified ? ' · data wipe verified' : ''}${input.note ? ` — ${input.note}` : ''}`));

  if (item.kind === 'asset' && item.refId) {
    const a: any = await Asset.findOne({ _id: item.refId, organizationId: c.organizationId });
    if (a) {
      const holder = oid(a.assignedToId);
      if (holder === oid(c.employeeId)) a.assignedToId = undefined;
      a.conditionOnReturn = { condition: input.condition, medium: item.verifiedMedium, dataWipeVerified: !!input.dataWipeVerified, at: new Date(), byName: by.name, notes: input.note };
      if (input.condition === 'damaged' && !['in_disposal', 'disposed'].includes(a.lifecycleStatus)) { a.lifecycleStatus = 'under_maintenance'; a.maintenanceStatus = 'Returned damaged — assess repair or disposal'; }
      a.updatedBy = by.name;
      await a.save();
      await appendEvent({ asset: a, action: 'returned', actor: by, changes: [{ field: 'assignedTo', from: c.employeeName, to: '' }, { field: 'condition', from: '', to: input.condition }], note: `Reclaimed on leaving (${c.reference}) · ${item.verifiedMedium}${input.dataWipeVerified ? ' · data wipe verified' : ''}` });
    }
  }
}

export async function applyTransfer(c: any, item: any, to: any, by: By, note?: string) {
  if (!isHandover(item.kind) && item.kind !== 'asset') throw ApiError.badRequest('This item is handed back, not reassigned.');
  if (oid(to._id) === oid(c.employeeId)) throw ApiError.badRequest('Choose someone other than the leaver.');
  if (!to.isActive) throw ApiError.badRequest('The new owner must be an active employee.');
  const org = String(c.organizationId);
  const tag = `${c.reference}: handed over from ${c.employeeName} to ${to.name}${note ? ` — ${note}` : ''}`;
  if (item.kind === 'task') {
    const t: any = await Task.findOne({ _id: item.refId, organizationId: org });
    if (t) { t.ownerId = to._id; t.comments.push({ authorId: by.id, body: tag, kind: 'update' }); await t.save(); }
  } else if (item.kind === 'approval') {
    const t: any = await Task.findOne({ _id: item.refId, organizationId: org });
    if (t) { t.approverId = to._id; t.comments.push({ authorId: by.id, body: `${c.reference}: approver changed from ${c.employeeName} to ${to.name}`, kind: 'update' }); await t.save(); }
  } else if (item.kind === 'project') {
    const p: any = await Project.findOne({ _id: item.refId, organizationId: org });
    if (p) { p.projectManagerId = to._id; if (!(p.team || []).some((m: any) => oid(m) === oid(to._id))) p.team.push(to._id); await p.save(); }
  } else if (item.kind === 'goal') {
    await Goal.updateOne({ _id: item.refId, organizationId: org }, { ownerId: to._id });
  } else if (item.kind === 'risk') {
    await Risk.updateOne({ _id: item.refId, organizationId: org }, { ownerId: to._id });
  } else if (item.kind === 'asset') {
    const a: any = await Asset.findOne({ _id: item.refId, organizationId: org });
    if (a) { a.assignedToId = to._id; a.updatedBy = by.name; await a.save(); await appendEvent({ asset: a, action: 'assigned', actor: by, changes: [{ field: 'assignedTo', from: c.employeeName, to: to.name }], note: `Reassigned on leaving (${c.reference})` }); }
  }
  item.status = 'transferred'; item.transferToId = to._id; item.transferToName = to.name; item.transferredAt = new Date();
  item.decidedById = by.id; item.decidedByName = by.name; item.decidedAt = new Date(); item.decisionNote = note?.slice(0, 500);
  item.history.push(hist(by, 'transferred', `to ${to.name}${note ? ` — ${note}` : ''}`));
  await notifyWork({ organizationId: org, userIds: [oid(to._id)], type: 'offboarding', title: `Handed over to you: ${item.label.replace(/^[A-Za-z ]+: /, '')}`, summary: `${by.name} reassigned this from ${c.employeeName} (leaving ${fmtDate(c.lastWorkingDay)}) to you.`, rows: [['Item', item.label], ['Reference', c.reference]], link: item.kind === 'project' ? `/projects/${item.refId}` : item.kind === 'goal' ? '/goals' : item.kind === 'risk' ? '/risks' : item.kind === 'asset' ? '/assets' : `/tasks/${item.refId}` });
}

/** Leadership writes off an item that cannot be recovered; a lost / unrecovered asset opens a security incident. */
export async function writeOff(c: any, item: any, by: By, reason: string) {
  if (!reason?.trim()) throw ApiError.badRequest('Give the reason it cannot be recovered.');
  item.status = 'written_off'; item.condition = 'lost'; item.decidedById = by.id; item.decidedByName = by.name; item.decidedAt = new Date(); item.decisionNote = reason.slice(0, 500);
  item.history.push(hist(by, 'written_off', reason));
  if (item.kind === 'asset' && item.refId) {
    const a: any = await Asset.findOne({ _id: item.refId, organizationId: c.organizationId });
    if (a) {
      if (oid(a.assignedToId) === oid(c.employeeId)) a.assignedToId = undefined;
      a.lifecycleStatus = 'retired'; a.maintenanceStatus = 'LOST / not returned on leaving'; a.updatedBy = by.name;
      a.conditionOnReturn = { condition: 'lost', at: new Date(), byName: by.name, notes: reason };
      await a.save();
      await appendEvent({ asset: a, action: 'written_off', actor: by, note: `Not recovered from ${c.employeeName} (${c.reference}): ${reason}` });
      const inc: any = await Incident.create({
        organizationId: c.organizationId, reference: await nextNumber(String(c.organizationId), 'INC', { yearly: true, pad: 4 }),
        title: `Asset not returned by leaver: ${a.assetId} ${a.title}`, description: `<p>${esc(c.employeeName)} left on ${esc(fmtDate(c.lastWorkingDay))} without returning ${esc(a.title)} (${esc(a.assetId)}, classified ${esc(a.classification)}).</p><p>${esc(reason)}</p>`,
        category: 'lost_device', severity: ['Confidential', 'Restricted'].includes(a.classification) ? 'high' : 'medium', reportedById: by.id, affectedAssetIds: [a._id],
        timeline: [{ at: new Date(), byId: by.id, byName: by.name, text: `Opened automatically from offboarding ${c.reference}` }],
      });
      item.history.push(hist(by, 'incident_opened', inc.reference));
    }
  }
}

/* ---------------------------- notifications / jobs --------------------------- */
export async function nudgeLeaver(c: any, why: string, severity: 'info' | 'warning' | 'high' = 'warning', dedupeKey?: string) {
  const p = progressOf(c);
  await notifyWork({
    organizationId: String(c.organizationId), userIds: [oid(c.employeeId)], type: 'offboarding', severity, dedupeKey,
    title: `Return of assets — ${p.pendingFromLeaver} item(s) still to declare`, summary: why,
    rows: [['Reference', c.reference], ['Last working day', fmtDate(c.lastWorkingDay)], ['Still to declare', p.pendingFromLeaver]], link: '/my-offboarding', cta: 'Open my return form',
  });
}

/** Daily: revoke access on the last working day, remind the leaver (14/7/3/1 days), escalate unreturned items, chase unverified submissions. */
export async function runOffboardingJobs(now = new Date()): Promise<{ revoked: number; reminded: number; escalated: number }> {
  const out = { revoked: 0, reminded: 0, escalated: 0 };
  const cases: any[] = await Offboarding.find({ status: 'open' });
  const today = now.toISOString().slice(0, 10);
  for (const c of cases) {
    try {
      const org = String(c.organizationId);
      const lwdEnd = new Date(c.lastWorkingDay).getTime() + DAY;
      if (!c.access?.revokedAt && lwdEnd <= now.getTime()) {
        await revokeAccess(c, null, 'scheduled'); await c.save(); out.revoked++;
        await notifyWork({ organizationId: org, userIds: (await approvers(org, oid(c.employeeId))).map((u) => String(u._id)), type: 'offboarding', title: `Access revoked: ${c.employeeName}`, summary: `${c.employeeName}'s last working day has passed. Login was disabled automatically.`, rows: [['Reference', c.reference], ['Outstanding items', progressOf(c).total - progressOf(c).done]], link: `/offboarding?case=${c._id}` });
      }
      const p = progressOf(c, now);
      const daysLeft = Math.ceil((new Date(c.lastWorkingDay).getTime() - now.getTime()) / DAY);
      if (!c.access?.revokedAt && p.pendingFromLeaver > 0 && [14, 7, 3, 1, 0].includes(daysLeft)) {
        await nudgeLeaver(c, daysLeft > 0 ? `${daysLeft} day(s) until your last working day. Please declare and return what is listed.` : 'Today is your last working day — return everything and sign your inventory.', daysLeft <= 1 ? 'high' : 'warning', `off-nudge:${c._id}:${daysLeft}`);
        out.reminded++;
      }
      const staff = (await approvers(org, oid(c.employeeId))).map((u) => String(u._id));
      if (p.overdue > 0) {
        await notifyWork({ organizationId: org, userIds: staff, type: 'offboarding', severity: 'high', dedupeKey: `off-overdue:${c._id}:${today}`, title: `Unreturned items: ${c.employeeName} (${p.overdue})`, summary: `The deadline has passed and ${p.overdue} item(s) are still outstanding. Items not returned in time may be considered stolen and may result in legal action (policy 2.4). Chase the leaver or write the item off.`, rows: [['Reference', c.reference], ['Left on', fmtDate(c.lastWorkingDay)]], link: `/offboarding?case=${c._id}`, cta: 'Open the case' });
        out.escalated++;
      }
      const stale = c.items.filter((i: any) => i.status === 'submitted' && i.submittedAt && now.getTime() - new Date(i.submittedAt).getTime() > 2 * DAY);
      if (stale.length) await notifyWork({ organizationId: org, userIds: staff, type: 'offboarding', dedupeKey: `off-stale:${c._id}:${today}`, title: `${stale.length} return(s) waiting for your verification — ${c.employeeName}`, summary: 'Submitted more than two days ago. Verify the condition and mark each item reclaimed.', rows: [['Reference', c.reference]], link: `/offboarding?case=${c._id}` });
    } catch (err) { logger.error({ err, case: String(c._id) }, 'offboarding job failed for a case'); }
  }
  return out;
}

/* ------------------------------- return record PDF -------------------------- */
const INK = '#1c1727', MUTED = '#6b6478', MAGENTA = '#C22FD4';
const dt = (x?: any) => (x ? new Date(x).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' }) : '—');
export function returnRecordPdf(c: any): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: 'A4', margins: { top: 48, left: 44, right: 44, bottom: 56 }, info: { Title: `Return of Asset record ${c.reference}`, Author: 'GLOBAL SJX OS' } });
    const chunks: Buffer[] = [];
    doc.on('data', (x) => chunks.push(x)); doc.on('end', () => resolve(Buffer.concat(chunks))); doc.on('error', reject);
    const W = doc.page.width - 88;
    try { doc.image(LOGO_PATH, 44, 40, { height: 40 }); } catch { /* optional */ }
    doc.fillColor(MAGENTA).font('Helvetica-Bold').fontSize(9).text('GLOBAL SJX LIMITED · ISMS CONTROLLED RECORD', 96, 44, { characterSpacing: 1 });
    doc.fillColor(INK).font('Times-Bold').fontSize(21).text('Return of Asset Record', 96, 58);
    doc.fillColor(MUTED).font('Helvetica').fontSize(9).text(`GSJX-ISMS/POL-5013 · ${c.reference}`, 96, 82);
    let y = 112;
    const kv = (k: string, v: string, x: number, w: number) => { doc.fillColor(MUTED).font('Helvetica').fontSize(8).text(k.toUpperCase(), x, y, { width: w, characterSpacing: .6 }); doc.fillColor(INK).font('Helvetica-Bold').fontSize(10.5).text(v || '—', x, y + 11, { width: w }); };
    kv('Employee', c.employeeName, 44, 180); kv('Position', [c.jobTitle, c.department].filter(Boolean).join(' · '), 232, 180); kv('Last working day', dt(c.lastWorkingDay), 420, 130);
    y += 38; kv('Type', label(c.type), 44, 180); kv('Opened by', c.initiatedByName || '—', 232, 180); kv('Status', label(c.status) + (c.clearedWithExceptions ? ' (with exceptions)' : ''), 420, 130);
    y += 38; kv('Access revoked', c.access?.revokedAt ? `${dt(c.access.revokedAt)} · ${c.access.revokedByName || ''}` : 'Not yet', 44, 370); kv('Inventory declared', c.inventory?.declaredAt ? dt(c.inventory.declaredAt) : 'Not declared', 420, 130);
    y += 44;
    doc.moveTo(44, y).lineTo(44 + W, y).strokeColor('#e4dcec').stroke(); y += 10;
    const cols = [{ t: 'Item', w: 190 }, { t: 'Medium', w: 52 }, { t: 'Outcome', w: 78 }, { t: 'Condition', w: 56 }, { t: 'Verified by', w: 76 }, { t: 'Date', w: 54 }];
    const header = () => { let x = 44; doc.rect(44, y - 3, W, 16).fill('#f6effa'); cols.forEach((col) => { doc.fillColor('#4a2a55').font('Helvetica-Bold').fontSize(8).text(col.t.toUpperCase(), x + 3, y + 1, { width: col.w - 4, lineBreak: false }); x += col.w; }); y += 18; };
    header();
    for (const i of c.items) {
      const outcome = i.status === 'transferred' ? `Handed to ${i.transferToName || '—'}` : label(i.status);
      const cells = [`${label(i.kind)} — ${i.label}`, i.verifiedMedium && i.verifiedMedium !== 'na' ? label(i.verifiedMedium) : i.medium && i.medium !== 'na' ? label(i.medium) : '—', outcome + (i.dataWipeVerified ? ' · wiped' : ''), i.condition && i.condition !== 'not_applicable' ? label(i.condition) : '—', i.decidedByName || '—', dt(i.decidedAt)];
      const h = Math.max(...cells.map((t, n) => doc.font('Helvetica').fontSize(8.5).heightOfString(String(t), { width: cols[n].w - 6 }))) + 8;
      if (y + h > doc.page.height - 90) { doc.addPage(); y = 48; header(); }
      let x = 44; doc.font('Helvetica').fontSize(8.5).fillColor(INK);
      cells.forEach((t, n) => { doc.text(String(t), x + 3, y, { width: cols[n].w - 6 }); x += cols[n].w; });
      y += h; doc.moveTo(44, y - 3).lineTo(44 + W, y - 3).strokeColor('#efe9f5').lineWidth(.5).stroke();
    }
    if (y > doc.page.height - 170) { doc.addPage(); y = 48; }
    y += 14;
    doc.fillColor(MUTED).font('Helvetica-Oblique').fontSize(8.5).text(c.inventory?.statement || 'No inventory statement was recorded.', 44, y, { width: W });
    y = doc.y + 6;
    if (c.clearanceNote) { doc.fillColor(INK).font('Helvetica').fontSize(9).text(`Clearance note: ${c.clearanceNote}`, 44, y, { width: W }); y = doc.y + 6; }
    y += 18;
    const sig = (x: number, who: string, name: string, date?: any) => { doc.moveTo(x, y + 26).lineTo(x + 150, y + 26).strokeColor('#9a92a6').lineWidth(.6).stroke(); doc.fillColor(INK).font('Helvetica-Bold').fontSize(9).text(name || ' ', x, y + 30, { width: 160 }); doc.fillColor(MUTED).font('Helvetica').fontSize(8).text(`${who}${date ? ` · ${dt(date)}` : ''}`, x, y + 42, { width: 170 }); };
    sig(44, 'Employee (leaver)', c.employeeName, c.inventory?.declaredAt); sig(230, 'Verified / cleared by', c.clearedByName || '', c.clearedAt);
    doc.fillColor(MUTED).font('Helvetica').fontSize(7.5).text('Record retained for 5 years under the Control of Management System Records Procedure. A printed copy is uncontrolled.', 44, doc.page.height - 44, { width: W, align: 'center', lineBreak: false });
    doc.end();
  });
}

export const toId = (v: string) => new Types.ObjectId(v);
