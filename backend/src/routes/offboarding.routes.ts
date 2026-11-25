import { Router } from 'express';
import { z } from 'zod';
import { requireAuth } from '../middleware/auth';
import { requireModule } from '../middleware/modules';
import { asyncHandler } from '../utils/asyncHandler';
import { ApiError } from '../utils/ApiError';
import { audit } from '../services/audit.service';
import { Asset } from '../models/Asset';
import { Offboarding, CASE_TYPES, CONDITIONS, ITEM_KINDS, MEDIA } from '../models/Offboarding';
import { User } from '../models/User';
import { excludeDeleted, } from '../utils/softDeletePlugin';
import { usersWithModule } from '../services/access.service';
import { notifyWork } from '../services/work.notify';
import { fmtDate } from '../services/mail.templates';
import { appendEvent } from '../utils/assetAudit';
import {
  applyReclaim, applyTransfer, buildChecklist, clearanceBlockers, isDone, isHandback, progressOf, returnRecordPdf, revokeAccess, startOffboarding, writeOff, By,
} from '../services/offboarding.service';

const router = Router();
router.use(requireAuth);

const oid = (v: any) => String(v?._id || v || '');
const label = (s?: string) => (s ? s.replace(/_/g, ' ').replace(/^./, (c) => c.toUpperCase()) : '');
const who = (req: any): By => ({ id: req.user.id, name: req.user.name, role: req.user.role });
const LEADERS = ['super_admin', 'ceo', 'coo'];
const TOP = ['super_admin', 'ceo'];
const evidenceZ = z.array(z.object({ name: z.string().max(200).optional(), url: z.string().max(500) })).max(10).optional();

async function loadCase(req: any, id = req.params.id) {
  const c: any = await Offboarding.findOne({ _id: id, organizationId: req.user.organizationId });
  if (!c) throw ApiError.notFound('Offboarding case not found');
  return c;
}
function item(c: any, id: string) {
  const it = c.items.id(id);
  if (!it) throw ApiError.notFound('Item not found');
  return it;
}
const present = (c: any) => {
  const o = c.toObject ? c.toObject() : c;
  return { ...o, progress: progressOf(o), blockers: clearanceBlockers(o) };
};
async function staffIds(org: string, exclude?: string) {
  return (await usersWithModule(org, 'offboarding')).map((u) => String(u._id)).filter((i) => i !== exclude);
}
function notLeaver(req: any, c: any) {
  if (oid(c.employeeId) === req.user.id) throw ApiError.forbidden('Four-eyes control: you cannot verify or approve your own offboarding.');
}
const hist = (by: By, action: string, note?: string) => ({ at: new Date(), byId: by.id, byName: by.name, action, note });

/* =============================== the leaver =============================== */
router.get('/mine', asyncHandler(async (req, res) => {
  const c: any = await Offboarding.findOne({ organizationId: req.user!.organizationId, employeeId: req.user!.id, status: { $in: ['open', 'cleared'] } }).sort({ createdAt: -1 });
  res.json({ success: true, data: c ? present(c) : null });
}));

async function myOpenCase(req: any) {
  const c: any = await Offboarding.findOne({ organizationId: req.user.organizationId, employeeId: req.user.id, status: 'open' });
  if (!c) throw ApiError.notFound('You have no open offboarding case.');
  return c;
}
const leaverEditable = (it: any) => {
  if (it.kind === 'access' && /login|module/i.test(it.label)) throw ApiError.badRequest('This is handled automatically on your last working day.');
  if (isDone(it)) throw ApiError.conflict('This item has already been closed.');
  if (it.status === 'submitted') throw ApiError.conflict('This item is already waiting for HR / admin to verify.');
};

router.post('/mine/items/:itemId/submit', asyncHandler(async (req, res) => {
  const b = z.object({
    condition: z.enum(['good', 'fair', 'damaged']).optional(), medium: z.enum(['physical', 'digital', 'both']).optional(),
    dataRemoved: z.boolean().optional(), note: z.string().max(1000).optional(), evidence: evidenceZ,
  }).parse(req.body || {});
  const c = await myOpenCase(req);
  const it = item(c, req.params.itemId);
  leaverEditable(it);
  const handback = isHandback(it.kind);
  if (handback && it.kind === 'asset' && !b.condition) throw ApiError.badRequest('Say what condition it is in.');
  if (it.requiresWipe && !b.dataRemoved) throw ApiError.badRequest('Confirm that you have securely deleted your personal data and any company data before handing this device back (an approved wiping tool must be used).');
  if (!handback && !b.note?.trim()) throw ApiError.badRequest('Write a short hand-over note so whoever takes this over knows where things stand.');
  it.status = 'submitted'; it.submittedAt = new Date(); it.submittedNote = b.note?.slice(0, 1000);
  it.declaredCondition = b.condition; it.declaredMedium = b.medium || (it.medium !== 'na' ? it.medium : undefined); it.dataRemoved = b.dataRemoved;
  if (b.evidence?.length) it.evidence.push(...b.evidence.map((e) => ({ name: e.name || 'evidence', url: e.url })));
  it.exception && it.exception.decision === 'denied' && (it.exception.decision = undefined);
  it.history.push(hist(who(req), 'submitted', [b.condition && `condition ${b.condition}`, b.medium && b.medium, b.dataRemoved && 'data removed', b.note].filter(Boolean).join(' · ')));
  c.timeline.push(hist(who(req), 'item_submitted', it.label));
  await c.save();
  await notifyWork({ organizationId: oid(c.organizationId), userIds: await staffIds(oid(c.organizationId), req.user!.id), type: 'offboarding', dedupeKey: `off-sub:${c._id}:${new Date().toISOString().slice(0, 13)}`,
    title: `Awaiting your verification: ${c.employeeName} returned items`, summary: `${c.employeeName} has declared "${it.label}" and possibly other items as returned. Check the item and record its condition (physical or digital).`,
    rows: [['Reference', c.reference], ['Awaiting verification', progressOf(c).awaitingApproval]], link: `/offboarding?case=${c._id}`, cta: 'Verify returns' });
  res.json({ success: true, data: present(c) });
}));

router.post('/mine/items/:itemId/exception', asyncHandler(async (req, res) => {
  const b = z.object({ reason: z.string().trim().min(10, 'Explain the extenuating circumstances (at least a sentence).').max(1000), requestedDueDate: z.string().optional() }).parse(req.body || {});
  const c = await myOpenCase(req);
  const it = item(c, req.params.itemId);
  leaverEditable(it);
  it.status = 'exception_requested';
  it.exception = { reason: b.reason, requestedAt: new Date(), requestedDueDate: b.requestedDueDate ? new Date(b.requestedDueDate) : undefined, decision: 'pending' };
  it.history.push(hist(who(req), 'exception_requested', b.reason));
  c.timeline.push(hist(who(req), 'exception_requested', it.label));
  await c.save();
  await notifyWork({ organizationId: oid(c.organizationId), userIds: await staffIds(oid(c.organizationId), req.user!.id), type: 'offboarding', severity: 'warning', title: `Return exception requested: ${c.employeeName}`, summary: `${c.employeeName} cannot return "${it.label}" in time.`, note: b.reason, rows: [['Reference', c.reference]], link: `/offboarding?case=${c._id}`, cta: 'Decide' });
  res.json({ success: true, data: present(c) });
}));

router.post('/mine/items/:itemId/purchase', asyncHandler(async (req, res) => {
  const b = z.object({ agreedPrice: z.number().min(0).optional(), note: z.string().max(500).optional() }).parse(req.body || {});
  const c = await myOpenCase(req);
  const it = item(c, req.params.itemId);
  leaverEditable(it);
  if (it.kind !== 'asset') throw ApiError.badRequest('Only an asset can be purchased.');
  it.status = 'submitted'; it.submittedAt = new Date(); it.submittedNote = b.note;
  it.purchase = { requested: true, requestedAt: new Date(), agreedPrice: b.agreedPrice, currency: 'NGN' };
  it.history.push(hist(who(req), 'purchase_requested', b.note));
  await c.save();
  await notifyWork({ organizationId: oid(c.organizationId), userIds: await staffIds(oid(c.organizationId), req.user!.id), type: 'offboarding', title: `${c.employeeName} wants to buy ${it.label}`, summary: 'Before ownership can transfer, all company information must be moved off the device and the device securely wiped and verified (policy 2.3.1).', rows: [['Reference', c.reference]], link: `/offboarding?case=${c._id}` });
  res.json({ success: true, data: present(c) });
}));

router.post('/mine/inventory', asyncHandler(async (req, res) => {
  const b = z.object({ note: z.string().max(1000).optional(), confirm: z.literal(true, { errorMap: () => ({ message: 'Tick the confirmation to sign the inventory.' }) }) }).parse(req.body || {});
  const c = await myOpenCase(req);
  const open = c.items.filter((i: any) => i.required !== false && i.status === 'pending' && isHandback(i.kind) && !(i.kind === 'access' && /login|module/i.test(i.label)));
  if (open.length) throw ApiError.badRequest(`Declare every item first — ${open.length} still to go (or request an exception).`);
  c.inventory = { declaredAt: new Date(), declaredById: req.user!.id, note: b.note, statement: `I, ${c.employeeName}, confirm that the items listed above are all the Global SJX Limited assets, information and access in my possession at the time of leaving, and that I have returned or handed over each of them as declared.` };
  c.timeline.push(hist(who(req), 'inventory_signed'));
  await c.save();
  await notifyWork({ organizationId: oid(c.organizationId), userIds: await staffIds(oid(c.organizationId), req.user!.id), type: 'offboarding', title: `${c.employeeName} signed the inventory declaration`, summary: 'Verify the submitted items and clear the case.', rows: [['Reference', c.reference]], link: `/offboarding?case=${c._id}` });
  res.json({ success: true, data: present(c) });
}));

/* ============================ HR / administrators ============================ */
router.use(requireModule('offboarding'));

router.get('/', asyncHandler(async (req, res) => {
  const { status, q } = req.query as Record<string, string>;
  const f: any = { organizationId: req.user!.organizationId };
  if (status) f.status = status;
  if (q) f.employeeName = { $regex: String(q).replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), $options: 'i' };
  const cases = await Offboarding.find(f).sort({ lastWorkingDay: 1 }).limit(300);
  res.json({ success: true, data: cases.map((c: any) => { const o = present(c); delete (o as any).items; delete (o as any).timeline; return { ...o, itemCount: c.items.length }; }) });
}));

router.get('/queue', asyncHandler(async (req, res) => {
  const cases: any[] = await Offboarding.find({ organizationId: req.user!.organizationId, status: 'open' });
  const rows: any[] = [];
  for (const c of cases) for (const i of c.items) if (['submitted', 'exception_requested'].includes(i.status)) rows.push({ caseId: c._id, reference: c.reference, employeeName: c.employeeName, lastWorkingDay: c.lastWorkingDay, itemId: i._id, kind: i.kind, label: i.label, status: i.status, medium: i.declaredMedium || i.medium, declaredCondition: i.declaredCondition, since: i.submittedAt || i.exception?.requestedAt, purchase: !!i.purchase?.requested });
  rows.sort((a, b) => +new Date(a.since || 0) - +new Date(b.since || 0));
  res.json({ success: true, data: rows });
}));

router.post('/', asyncHandler(async (req, res) => {
  const b = z.object({
    employeeId: z.string().regex(/^[a-f0-9]{24}$/), lastWorkingDay: z.string(), type: z.enum(CASE_TYPES).default('resignation'), reason: z.string().max(500).optional(), immediate: z.boolean().optional(),
  }).parse(req.body || {});
  if (b.employeeId === req.user!.id) throw ApiError.forbidden('You cannot offboard yourself.');
  const target: any = await User.findOne({ _id: b.employeeId, organizationId: req.user!.organizationId });
  if (!target) throw ApiError.notFound('Employee not found');
  if (TOP.includes(target.role) && !TOP.includes(req.user!.role)) throw ApiError.forbidden('Only the CEO or an administrator can offboard this user.');
  if (!target.isActive) throw ApiError.badRequest('This person is already deactivated.');
  const lwd = new Date(b.lastWorkingDay);
  if (Number.isNaN(+lwd)) throw ApiError.badRequest('Enter a valid last working day.');
  const earliest = new Date(); earliest.setHours(0, 0, 0, 0);
  if (lwd < earliest && !b.immediate) throw ApiError.badRequest('The last working day cannot be in the past — use “immediate exit” instead.');
  const c = await startOffboarding({ organizationId: req.user!.organizationId, employeeId: b.employeeId, by: who(req), lastWorkingDay: b.immediate ? new Date() : lwd, type: b.type, reason: b.reason, immediate: b.immediate });
  await audit(req, 'offboarding.opened', 'Offboarding', String(c._id), { module: 'offboarding', severity: 'high', summary: `${c.reference} ${c.employeeName}` });
  res.status(201).json({ success: true, data: present(c) });
}));

router.get('/:id', asyncHandler(async (req, res) => {
  const c = await loadCase(req);
  const fresh = c.status === 'open' ? await buildChecklist(oid(c.organizationId), oid(c.employeeId), c.items.map((i: any) => i.toObject())) : [];
  res.json({ success: true, data: { ...present(c), unlisted: fresh.filter((i) => i.source === 'auto').length } });
}));

/** Pick up anything assigned to the leaver after the case was opened. */
router.post('/:id/refresh', asyncHandler(async (req, res) => {
  const c = await loadCase(req);
  if (c.status !== 'open') throw ApiError.conflict('This case is closed.');
  const fresh = (await buildChecklist(oid(c.organizationId), oid(c.employeeId), c.items.map((i: any) => i.toObject()))).filter((i) => i.source === 'auto');
  fresh.forEach((i) => c.items.push(i));
  if (fresh.length) c.timeline.push(hist(who(req), 'refreshed', `${fresh.length} newly assigned item(s) added`));
  await c.save();
  res.json({ success: true, data: present(c), added: fresh.length });
}));

router.post('/:id/items', asyncHandler(async (req, res) => {
  const b = z.object({ kind: z.enum(ITEM_KINDS).default('other'), label: z.string().trim().min(2).max(200), detail: z.string().max(500).optional(), medium: z.enum(MEDIA).default('physical'), requiresWipe: z.boolean().optional() }).parse(req.body || {});
  const c = await loadCase(req);
  if (c.status !== 'open') throw ApiError.conflict('This case is closed.');
  c.items.push({ ...b, source: 'manual', required: true, status: 'pending', history: [hist(who(req), 'added')] });
  c.timeline.push(hist(who(req), 'item_added', b.label));
  await c.save();
  res.status(201).json({ success: true, data: present(c) });
}));

router.post('/:id/items/:itemId/reclaim', asyncHandler(async (req, res) => {
  const b = z.object({ condition: z.string().optional(), medium: z.string().optional(), dataWipeVerified: z.boolean().optional(), wipeMethod: z.string().max(200).optional(), wipeReference: z.string().max(120).optional(), accessoriesComplete: z.boolean().optional(), note: z.string().max(500).optional(), evidence: evidenceZ }).parse(req.body || {});
  const c = await loadCase(req); notLeaver(req, c);
  if (c.status !== 'open') throw ApiError.conflict('This case is closed.');
  const it = item(c, req.params.itemId);
  if (isDone(it)) throw ApiError.conflict('Already closed.');
  if (!isHandback(it.kind)) throw ApiError.badRequest('This is handed over to someone else — use “Reassign”.');
  if (it.purchase?.requested) throw ApiError.badRequest('The employee asked to buy this — decide the purchase instead.');
  await applyReclaim(c, it, who(req), { ...b, evidence: b.evidence as any });
  c.timeline.push(hist(who(req), 'reclaimed', `${it.label} · ${b.condition}`));
  await c.save();
  await audit(req, 'offboarding.item_reclaimed', 'Offboarding', String(c._id), { module: 'offboarding', severity: 'medium', summary: `${c.reference}: ${it.label} reclaimed (${b.condition})` });
  res.json({ success: true, data: present(c) });
}));

router.post('/:id/items/:itemId/reject', asyncHandler(async (req, res) => {
  const b = z.object({ note: z.string().trim().min(3, 'Say what is wrong so the leaver can fix it.').max(500) }).parse(req.body || {});
  const c = await loadCase(req); notLeaver(req, c);
  const it = item(c, req.params.itemId);
  if (!['submitted', 'exception_requested'].includes(it.status)) throw ApiError.conflict('Nothing to send back.');
  const wasException = it.status === 'exception_requested';
  it.status = 'pending'; it.rejectedNote = b.note; if (wasException && it.exception) it.exception.decision = 'denied';
  if (it.purchase) it.purchase.requested = false;
  it.history.push(hist(who(req), 'sent_back', b.note));
  c.timeline.push(hist(who(req), 'sent_back', `${it.label}: ${b.note}`));
  await c.save();
  await notifyWork({ organizationId: oid(c.organizationId), userIds: [oid(c.employeeId)], type: 'offboarding', severity: 'warning', title: `Sent back: ${it.label}`, summary: `${req.user!.name} could not accept this return.`, note: b.note, noteTone: 'warn', rows: [['Reference', c.reference]], link: '/my-offboarding', cta: 'Fix it' });
  res.json({ success: true, data: present(c) });
}));

router.post('/:id/items/:itemId/transfer', asyncHandler(async (req, res) => {
  const b = z.object({ toUserId: z.string().regex(/^[a-f0-9]{24}$/), note: z.string().max(500).optional() }).parse(req.body || {});
  const c = await loadCase(req); notLeaver(req, c);
  if (c.status !== 'open') throw ApiError.conflict('This case is closed.');
  const it = item(c, req.params.itemId);
  if (isDone(it)) throw ApiError.conflict('Already closed.');
  const to: any = await User.findOne({ _id: b.toUserId, organizationId: req.user!.organizationId, isActive: true }).select('name isActive');
  if (!to) throw ApiError.badRequest('New owner not found.');
  await applyTransfer(c, it, to, who(req), b.note);
  c.timeline.push(hist(who(req), 'transferred', `${it.label} → ${to.name}`));
  await c.save();
  await audit(req, 'offboarding.item_transferred', 'Offboarding', String(c._id), { module: 'offboarding', summary: `${c.reference}: ${it.label} → ${to.name}` });
  res.json({ success: true, data: present(c) });
}));

router.post('/:id/bulk-transfer', asyncHandler(async (req, res) => {
  const b = z.object({ toUserId: z.string().regex(/^[a-f0-9]{24}$/), kinds: z.array(z.enum(['task', 'approval', 'project', 'goal', 'risk'])).min(1), note: z.string().max(500).optional() }).parse(req.body || {});
  const c = await loadCase(req); notLeaver(req, c);
  if (c.status !== 'open') throw ApiError.conflict('This case is closed.');
  const to: any = await User.findOne({ _id: b.toUserId, organizationId: req.user!.organizationId, isActive: true }).select('name isActive');
  if (!to) throw ApiError.badRequest('New owner not found.');
  let n = 0;
  for (const it of c.items) if (b.kinds.includes(it.kind) && !isDone(it)) { await applyTransfer(c, it, to, who(req), b.note); n++; }
  c.timeline.push(hist(who(req), 'bulk_transfer', `${n} item(s) → ${to.name}`));
  await c.save();
  res.json({ success: true, data: present(c), moved: n });
}));

router.post('/:id/items/:itemId/not-applicable', asyncHandler(async (req, res) => {
  const b = z.object({ reason: z.string().trim().min(3, 'Say why this does not apply.').max(500) }).parse(req.body || {});
  const c = await loadCase(req); notLeaver(req, c);
  const it = item(c, req.params.itemId);
  if (isDone(it)) throw ApiError.conflict('Already closed.');
  if (it.source === 'auto' && ['asset'].includes(it.kind)) throw ApiError.badRequest('An asset on the register cannot be marked not applicable — reclaim it, reassign it or write it off.');
  it.status = 'not_applicable'; it.decidedById = req.user!.id; it.decidedByName = req.user!.name; it.decidedAt = new Date(); it.decisionNote = b.reason;
  it.history.push(hist(who(req), 'not_applicable', b.reason));
  await c.save();
  res.json({ success: true, data: present(c) });
}));

router.post('/:id/items/:itemId/exception/decide', asyncHandler(async (req, res) => {
  const b = z.object({ decision: z.enum(['approved', 'denied']), note: z.string().max(500).optional(), newDueDate: z.string().optional() }).parse(req.body || {});
  const c = await loadCase(req); notLeaver(req, c);
  const it = item(c, req.params.itemId);
  if (it.status !== 'exception_requested') throw ApiError.conflict('No exception waiting for a decision.');
  Object.assign(it.exception, { decision: b.decision, decidedById: req.user!.id, decidedByName: req.user!.name, decidedAt: new Date(), note: b.note, newDueDate: b.newDueDate ? new Date(b.newDueDate) : undefined });
  it.status = b.decision === 'approved' ? 'exception_approved' : 'pending';
  it.history.push(hist(who(req), `exception_${b.decision}`, b.note));
  await c.save();
  await notifyWork({ organizationId: oid(c.organizationId), userIds: [oid(c.employeeId)], type: 'offboarding', title: `Exception ${b.decision}: ${it.label}`, summary: b.decision === 'approved' ? `Your request was approved${b.newDueDate ? ` — return it by ${fmtDate(b.newDueDate)}` : ''}.` : 'Your request was declined — the item must be returned by your last working day.', note: b.note, rows: [['Reference', c.reference]], link: '/my-offboarding' });
  res.json({ success: true, data: present(c) });
}));

router.post('/:id/items/:itemId/purchase/decide', asyncHandler(async (req, res) => {
  const b = z.object({ approve: z.boolean(), dataTransferred: z.boolean().optional(), dataWipeVerified: z.boolean().optional(), wipeMethod: z.string().max(200).optional(), wipeReference: z.string().max(120).optional(), agreedPrice: z.number().min(0).optional(), note: z.string().max(500).optional() }).parse(req.body || {});
  const c = await loadCase(req); notLeaver(req, c);
  const it = item(c, req.params.itemId);
  if (!it.purchase?.requested || it.status !== 'submitted') throw ApiError.conflict('No purchase request waiting.');
  if (!b.approve) { it.status = 'pending'; it.purchase.requested = false; it.history.push(hist(who(req), 'purchase_declined', b.note)); await c.save(); return res.json({ success: true, data: present(c) }); }
  if (!b.dataTransferred) throw ApiError.badRequest('Confirm that all company information has been transferred to us before the device is sold.');
  if (!b.dataWipeVerified || !b.wipeMethod?.trim() || !b.wipeReference?.trim()) throw ApiError.badRequest('Record the wipe method and a wipe / certificate reference, and confirm it was verified, before ownership transfers.');
  const a: any = it.refId ? await Asset.findOne({ _id: it.refId, organizationId: req.user!.organizationId }) : null;
  if (a) {
    a.assignedToId = undefined; a.lifecycleStatus = 'disposed'; a.disposalMethod = 'Sold to employee on leaving'; a.updatedBy = req.user!.name;
    a.disposal = { reason: `Purchased by ${c.employeeName} on leaving (${c.reference})`, method: 'Sold to employee on leaving', previousStatus: a.lifecycleStatus, requestedBy: oid(c.employeeId), requestedByName: c.employeeName, requestedAt: it.purchase.requestedAt, approvedBy: req.user!.id, approvedByName: req.user!.name, approvedAt: new Date(), completedBy: req.user!.name, completedAt: new Date(), certificateRef: b.wipeReference };
    await a.save();
    await appendEvent({ asset: a, action: 'ownership_transferred', actor: who(req), req, note: `Sold to ${c.employeeName}; data transferred and wipe verified (${b.wipeReference})` });
  }
  Object.assign(it, { status: 'reclaimed', condition: 'not_applicable', verifiedMedium: it.medium, dataWipeVerified: true, wipeMethod: b.wipeMethod, wipeReference: b.wipeReference, decidedById: req.user!.id, decidedByName: req.user!.name, decidedAt: new Date(), decisionNote: `Purchased by the employee${b.agreedPrice ?? it.purchase.agreedPrice ? ` for NGN ${b.agreedPrice ?? it.purchase.agreedPrice}` : ''}. ${b.note || ''}`.trim() });
  it.purchase.dataTransferred = true; it.purchase.approvedById = req.user!.id; it.purchase.approvedByName = req.user!.name; it.purchase.approvedAt = new Date(); if (b.agreedPrice !== undefined) it.purchase.agreedPrice = b.agreedPrice;
  it.history.push(hist(who(req), 'purchase_completed', b.wipeReference));
  c.timeline.push(hist(who(req), 'purchase_completed', it.label));
  await c.save();
  await audit(req, 'offboarding.asset_sold', 'Offboarding', String(c._id), { module: 'offboarding', severity: 'high', summary: `${c.reference}: ${it.label} sold to leaver` });
  res.json({ success: true, data: present(c) });
}));

router.post('/:id/items/:itemId/write-off', asyncHandler(async (req, res) => {
  if (!LEADERS.includes(req.user!.role)) throw ApiError.forbidden('Only leadership can write an item off as not recovered.');
  const b = z.object({ reason: z.string().trim().min(5, 'Say what was done to recover it and why it cannot be recovered.').max(500) }).parse(req.body || {});
  const c = await loadCase(req); notLeaver(req, c);
  const it = item(c, req.params.itemId);
  if (isDone(it)) throw ApiError.conflict('Already closed.');
  await writeOff(c, it, who(req), b.reason);
  c.timeline.push(hist(who(req), 'written_off', `${it.label}: ${b.reason}`));
  await c.save();
  await audit(req, 'offboarding.item_written_off', 'Offboarding', String(c._id), { module: 'offboarding', severity: 'high', summary: `${c.reference}: ${it.label} NOT recovered` });
  res.json({ success: true, data: present(c) });
}));

router.post('/:id/items/:itemId/escalate', asyncHandler(async (req, res) => {
  const b = z.object({ note: z.string().trim().min(3).max(500) }).parse(req.body || {});
  const c = await loadCase(req);
  const it = item(c, req.params.itemId);
  const leaders = (await usersWithModule(oid(c.organizationId), 'offboarding')).filter((u) => LEADERS.includes(u.role)).map((u) => String(u._id));
  it.history.push(hist(who(req), 'escalated', b.note));
  await c.save();
  await notifyWork({ organizationId: oid(c.organizationId), userIds: leaders, type: 'offboarding', severity: 'high', title: `Escalation: ${c.employeeName} — ${it.label}`, summary: `${req.user!.name} needs leadership to chase or write off this item.`, note: b.note, noteTone: 'warn', rows: [['Reference', c.reference]], link: `/offboarding?case=${c._id}` });
  res.json({ success: true, data: present(c) });
}));

router.post('/:id/inventory', asyncHandler(async (req, res) => {
  const b = z.object({ note: z.string().max(1000).optional() }).parse(req.body || {});
  const c = await loadCase(req); notLeaver(req, c);
  if (c.inventory?.declaredAt) throw ApiError.conflict('Inventory already declared.');
  c.inventory = { declaredAt: new Date(), declaredById: req.user!.id, note: b.note, statement: `Recorded by ${req.user!.name} (${label(req.user!.role)}) on behalf of ${c.employeeName}, who could not sign in person. All items were counted and verified against the register.` };
  c.timeline.push(hist(who(req), 'inventory_recorded_by_staff'));
  await c.save();
  res.json({ success: true, data: present(c) });
}));

router.post('/:id/access/revoke', asyncHandler(async (req, res) => {
  const c = await loadCase(req); notLeaver(req, c);
  if (c.status !== 'open') throw ApiError.conflict('This case is closed.');
  if (c.access?.revokedAt) throw ApiError.conflict('Access was already revoked.');
  await revokeAccess(c, who(req), 'manual');
  await c.save();
  await audit(req, 'offboarding.access_revoked', 'Offboarding', String(c._id), { module: 'offboarding', severity: 'high', summary: `${c.reference} ${c.employeeName}: ${c.access.summary}` });
  res.json({ success: true, data: present(c) });
}));

router.post('/:id/remind', asyncHandler(async (req, res) => {
  const c = await loadCase(req);
  if (c.status !== 'open') throw ApiError.conflict('This case is closed.');
  const p = progressOf(c);
  await notifyWork({ organizationId: oid(c.organizationId), userIds: [oid(c.employeeId)], type: 'offboarding', severity: 'warning', title: `Reminder from ${req.user!.name}: return your assets`, summary: `${p.pendingFromLeaver} item(s) still need your declaration. Last working day: ${fmtDate(c.lastWorkingDay)}.`, rows: [['Reference', c.reference]], link: '/my-offboarding', cta: 'Open my return form' });
  res.json({ success: true });
}));

router.post('/:id/clear', asyncHandler(async (req, res) => {
  const b = z.object({ note: z.string().max(1000).optional(), force: z.boolean().optional() }).parse(req.body || {});
  const c = await loadCase(req); notLeaver(req, c);
  if (c.status !== 'open') throw ApiError.conflict('This case is already closed.');
  const blockers = clearanceBlockers(c);
  if (blockers.length) {
    if (!b.force) throw ApiError.badRequest(`Cannot clear yet: ${blockers.join(' · ')}`, blockers);
    if (!TOP.includes(req.user!.role)) throw ApiError.forbidden('Only the CEO or an administrator can clear a case with outstanding items.');
    if (!b.note?.trim()) throw ApiError.badRequest('A reason is required to clear a case with outstanding items.');
  }
  if (!c.access?.revokedAt) await revokeAccess(c, who(req), 'manual');
  c.status = 'cleared'; c.clearedAt = new Date(); c.clearedById = req.user!.id; c.clearedByName = req.user!.name; c.clearanceNote = b.note;
  c.clearedWithExceptions = blockers.length > 0 || c.items.some((i: any) => ['exception_approved', 'written_off'].includes(i.status));
  c.timeline.push(hist(who(req), 'cleared', b.note));
  await c.save();
  await audit(req, 'offboarding.cleared', 'Offboarding', String(c._id), { module: 'offboarding', severity: 'high', summary: `${c.reference} ${c.employeeName} cleared${c.clearedWithExceptions ? ' with exceptions' : ''}` });
  await notifyWork({ organizationId: oid(c.organizationId), userIds: await staffIds(oid(c.organizationId)), type: 'offboarding', title: `Cleared: ${c.employeeName}`, summary: `${c.reference} is closed${c.clearedWithExceptions ? ' with exceptions' : ' — everything accounted for'}. The return record is on file.`, rows: [['Cleared by', req.user!.name]], link: `/offboarding?case=${c._id}`, email: false });
  res.json({ success: true, data: present(c) });
}));

router.post('/:id/cancel', asyncHandler(async (req, res) => {
  const b = z.object({ reason: z.string().trim().min(3, 'Say why the case is cancelled.').max(500) }).parse(req.body || {});
  const c = await loadCase(req); notLeaver(req, c);
  if (c.status !== 'open') throw ApiError.conflict('This case is already closed.');
  if (c.access?.revokedAt) throw ApiError.conflict('Access was already revoked — re-enable the account in Employees instead.');
  c.status = 'cancelled'; c.cancelledAt = new Date(); c.cancelReason = b.reason; c.timeline.push(hist(who(req), 'cancelled', b.reason));
  await c.save();
  await audit(req, 'offboarding.cancelled', 'Offboarding', String(c._id), { module: 'offboarding', summary: `${c.reference}: ${b.reason}` });
  res.json({ success: true, data: present(c) });
}));

router.get('/:id/record.pdf', asyncHandler(async (req, res) => {
  const c = await loadCase(req);
  const pdf = await returnRecordPdf(c.toObject());
  await audit(req, 'offboarding.record_downloaded', 'Offboarding', String(c._id), { module: 'offboarding', summary: c.reference });
  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', `attachment; filename="return-of-asset-${c.reference}.pdf"`);
  res.send(pdf);
}));

export default router;
void excludeDeleted; void CONDITIONS;
