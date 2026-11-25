import { Router } from 'express';
import { requireAuth } from '../middleware/auth';
import { asyncHandler } from '../utils/asyncHandler';
import { ApiError } from '../utils/ApiError';
import { ControlTask, CONTROL_CATEGORIES, OWNER_PREFS } from '../models/Controls';
import { User } from '../models/User';
import { EXTERNAL_ROLES } from '../config/roles';
import { audit } from '../services/audit.service';
import { ensureBuiltInControls, resolveOwners, nextDueAfter, controlState, daysUntil } from '../services/controls.service';
import { excludeDeleted } from '../utils/softDeletePlugin';

const router = Router();
router.use(requireAuth, (req, _res, next) => (EXTERNAL_ROLES as readonly string[]).includes(req.user!.role) ? next(ApiError.forbidden('Controls are for internal staff.')) : next());

const isManager = (req: any) => req.user.role === 'super_admin' || (req.user.modules || []).includes('compliance');
const num = (v: any, d = 0) => (Number.isFinite(Number(v)) ? Number(v) : d);
const cleanList = (a: any, max = 20) => (Array.isArray(a) ? a.map((x) => String(x).trim().slice(0, 200)).filter(Boolean).slice(0, max) : undefined);

async function shape(orgId: string, t: any, people: any[], me: string) {
  const { owners, via } = await resolveOwners(orgId, t, people);
  const o = t.toObject();
  delete o.completions;
  return {
    ...o, state: controlState(t), daysLeft: daysUntil(t.nextDueAt),
    owners: owners.map((u: any) => ({ id: String(u._id), name: u.name, jobTitle: u.jobTitle })), assignedVia: via,
    mine: owners.some((u: any) => String(u._id) === me) || (t.deputyIds || []).some((d: any) => String(d) === me),
  };
}

router.get('/', asyncHandler(async (req, res) => {
  const org = req.user!.organizationId;
  await ensureBuiltInControls(org);
  const [tasks, people] = await Promise.all([
    ControlTask.find(excludeDeleted({ organizationId: org })).sort('nextDueAt'),
    User.find({ organizationId: org, isActive: true, loginEnabled: { $ne: false }, role: { $nin: EXTERNAL_ROLES as unknown as string[] } }).select('name email role jobTitle department'),
  ]);
  const data = await Promise.all(tasks.map((t) => shape(org, t, people as any[], req.user!.id)));
  const active = data.filter((d) => d.status === 'active');
  const summary = {
    total: data.length, overdue: active.filter((d) => d.state === 'overdue').length, dueSoon: active.filter((d) => d.state === 'due_soon').length,
    onTrack: active.filter((d) => d.state === 'on_track').length, paused: data.length - active.length, unowned: active.filter((d) => !d.owners.length).length,
    score: active.length ? Math.round((active.filter((d) => d.state !== 'overdue').length / active.length) * 100) : 100,
  };
  res.json({ success: true, data, summary, canManage: isManager(req), categories: CONTROL_CATEGORIES, ownerPrefs: OWNER_PREFS, people: isManager(req) ? people.map((p: any) => ({ id: String(p._id), name: p.name, jobTitle: p.jobTitle, department: p.department })) : [] });
}));

router.get('/:id/history', asyncHandler(async (req, res) => {
  const t = await ControlTask.findOne(excludeDeleted({ _id: req.params.id, organizationId: req.user!.organizationId })).select('title completions');
  if (!t) throw ApiError.notFound('Control not found');
  res.json({ success: true, data: [...(t as any).completions].reverse() });
}));

router.post('/', asyncHandler(async (req, res) => {
  if (!isManager(req)) throw ApiError.forbidden('You need the Compliance module to create controls.');
  const b = req.body || {};
  if (!b.title || !String(b.title).trim()) throw ApiError.badRequest('Give the control a title.');
  const freq = Math.round(num(b.frequencyDays));
  if (freq < 1 || freq > 1830) throw ApiError.badRequest('Frequency must be between 1 and 1830 days.');
  const count = await ControlTask.countDocuments({ organizationId: req.user!.organizationId });
  const t: any = await ControlTask.create({
    organizationId: req.user!.organizationId, key: `custom_${Date.now().toString(36)}_${count}`, title: String(b.title).trim().slice(0, 160), description: b.description ? String(b.description).slice(0, 1000) : undefined,
    category: CONTROL_CATEGORIES.includes(b.category) ? b.category : 'Governance', isoRef: b.isoRef ? String(b.isoRef).slice(0, 60) : undefined, policyRef: b.policyRef ? String(b.policyRef).slice(0, 100) : undefined,
    frequencyDays: freq, ownerPref: OWNER_PREFS.includes(b.ownerPref) ? b.ownerPref : 'it', ownerId: b.ownerId || undefined, checklist: cleanList(b.checklist) || [], requireEvidence: !!b.requireEvidence,
    nextDueAt: b.nextDueAt ? new Date(b.nextDueAt) : new Date(Date.now() + freq * 86400000), link: '/controls', builtIn: false,
  });
  await audit(req, 'control.created', 'ControlTask', String(t._id), { module: 'compliance', summary: `${t.title} every ${freq} days` });
  res.status(201).json({ success: true, data: t });
}));

router.put('/:id', asyncHandler(async (req, res) => {
  if (!isManager(req)) throw ApiError.forbidden('You need the Compliance module to change controls.');
  const t: any = await ControlTask.findOne(excludeDeleted({ _id: req.params.id, organizationId: req.user!.organizationId }));
  if (!t) throw ApiError.notFound('Control not found');
  const b = req.body || {}, changes: string[] = [];
  if (b.frequencyDays !== undefined) {
    const f = Math.round(num(b.frequencyDays));
    if (f < 1 || f > 1830) throw ApiError.badRequest('Frequency must be between 1 and 1830 days.');
    if (f !== t.frequencyDays) {
      changes.push(`frequency ${t.frequencyDays}→${f} days`);
      t.frequencyDays = f;
      // re-base the next due date on the last completion when there is one
      if (t.lastCompletedAt && b.nextDueAt === undefined) t.nextDueAt = nextDueAfter(t.lastCompletedAt, f);
    }
  }
  if (b.nextDueAt) { t.nextDueAt = new Date(b.nextDueAt); changes.push('due date'); }
  if (b.ownerPref && OWNER_PREFS.includes(b.ownerPref)) { t.ownerPref = b.ownerPref; changes.push(`owner rule ${b.ownerPref}`); }
  if (b.ownerId !== undefined) { t.ownerId = b.ownerId || undefined; changes.push('named owner'); }
  if (Array.isArray(b.deputyIds)) t.deputyIds = b.deputyIds.slice(0, 5);
  if (Array.isArray(b.leadDays)) t.leadDays = b.leadDays.map((n: any) => Math.round(num(n))).filter((n: number) => n >= 0 && n <= 365).slice(0, 8);
  if (b.checklist) t.checklist = cleanList(b.checklist) || [];
  if (b.requireEvidence !== undefined) t.requireEvidence = !!b.requireEvidence;
  if (!t.builtIn || b.title) { if (b.title) t.title = String(b.title).trim().slice(0, 160); }
  if (b.description !== undefined) t.description = String(b.description).slice(0, 1000);
  if (CONTROL_CATEGORIES.includes(b.category)) t.category = b.category;
  await t.save();
  await audit(req, 'control.updated', 'ControlTask', String(t._id), { module: 'compliance', summary: `${t.title}: ${changes.join(', ') || 'edited'}` });
  res.json({ success: true, data: t });
}));

router.post('/:id/complete', asyncHandler(async (req, res) => {
  const org = req.user!.organizationId;
  const t: any = await ControlTask.findOne(excludeDeleted({ _id: req.params.id, organizationId: org }));
  if (!t) throw ApiError.notFound('Control not found');
  if (t.status === 'paused') throw ApiError.conflict('This control is paused.');
  const people = await User.find({ organizationId: org, isActive: true, role: { $nin: EXTERNAL_ROLES as unknown as string[] } }).select('name email role jobTitle department');
  const { owners } = await resolveOwners(org, t, people as any[]);
  const mine = owners.some((o: any) => String(o._id) === req.user!.id) || (t.deputyIds || []).some((d: any) => String(d) === req.user!.id);
  if (!mine && !isManager(req)) throw ApiError.forbidden('Only the control owner (or a compliance manager) can mark it done.');
  const note = req.body?.note ? String(req.body.note).trim().slice(0, 1000) : '';
  const evidenceUrl = req.body?.evidenceUrl ? String(req.body.evidenceUrl).trim().slice(0, 500) : '';
  if (t.requireEvidence && !note && !evidenceUrl) throw ApiError.badRequest('This control needs evidence — add a note or attach a document link (e.g. the signed risk assessment).');
  if (evidenceUrl && !/^(https?:\/\/|\/api\/uploads\/)/i.test(evidenceUrl)) throw ApiError.badRequest('Evidence must be an https link or an uploaded file.');
  const done = req.body?.completedOn ? new Date(req.body.completedOn) : new Date();
  if (isNaN(+done) || done.getTime() > Date.now() + 3600000) throw ApiError.badRequest('Completion date cannot be in the future.');
  const overdueDays = Math.max(0, Math.floor((done.getTime() - t.nextDueAt.getTime()) / 86400000));
  const next = nextDueAfter(done, t.frequencyDays);
  t.completions.push({ at: done, byId: req.user!.id, byName: req.user!.name, note, evidenceUrl, wasOverdueDays: overdueDays, nextDueAt: next });
  if (t.completions.length > 60) t.completions = t.completions.slice(-60);
  t.lastCompletedAt = done; t.lastCompletedById = req.user!.id; t.lastCompletedByName = req.user!.name; t.nextDueAt = next;
  await t.save();
  await audit(req, 'control.completed', 'ControlTask', String(t._id), { module: 'compliance', summary: `${t.title} done${overdueDays ? ` (${overdueDays}d late)` : ''}; next ${next.toISOString().slice(0, 10)}`, meta: { overdueDays } });
  res.json({ success: true, data: t });
}));

router.post('/:id/pause', asyncHandler(async (req, res) => {
  if (!isManager(req)) throw ApiError.forbidden('You need the Compliance module.');
  if (!req.body?.reason) throw ApiError.badRequest('A reason is required to pause a control (auditors will ask).');
  const t: any = await ControlTask.findOne(excludeDeleted({ _id: req.params.id, organizationId: req.user!.organizationId }));
  if (!t) throw ApiError.notFound('Control not found');
  t.status = 'paused'; t.pausedReason = String(req.body.reason).slice(0, 300); await t.save();
  await audit(req, 'control.paused', 'ControlTask', String(t._id), { module: 'compliance', severity: 'medium', summary: `${t.title}: ${t.pausedReason}` });
  res.json({ success: true, data: t });
}));

router.post('/:id/resume', asyncHandler(async (req, res) => {
  if (!isManager(req)) throw ApiError.forbidden('You need the Compliance module.');
  const t: any = await ControlTask.findOne(excludeDeleted({ _id: req.params.id, organizationId: req.user!.organizationId }));
  if (!t) throw ApiError.notFound('Control not found');
  t.status = 'active'; t.pausedReason = undefined;
  if (t.nextDueAt < new Date()) t.nextDueAt = new Date(Date.now() + 7 * 86400000);
  await t.save();
  await audit(req, 'control.resumed', 'ControlTask', String(t._id), { module: 'compliance', summary: t.title });
  res.json({ success: true, data: t });
}));

router.delete('/:id', asyncHandler(async (req, res) => {
  if (!isManager(req)) throw ApiError.forbidden('You need the Compliance module.');
  const t: any = await ControlTask.findOne(excludeDeleted({ _id: req.params.id, organizationId: req.user!.organizationId }));
  if (!t) throw ApiError.notFound('Control not found');
  if (t.builtIn) throw ApiError.conflict('Built-in controls cannot be deleted — pause them with a reason instead.');
  (t as any).isDeleted = true; (t as any).deletedAt = new Date(); await t.save();
  await audit(req, 'control.deleted', 'ControlTask', String(t._id), { module: 'compliance', severity: 'medium', summary: t.title });
  res.json({ success: true });
}));

export default router;
