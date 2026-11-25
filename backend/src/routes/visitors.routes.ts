import { Router } from 'express';
import { z } from 'zod';
import { requireAuth } from '../middleware/auth';
import { requireModule, hasModule } from '../middleware/modules';
import { asyncHandler } from '../utils/asyncHandler';
import { ApiError } from '../utils/ApiError';
import { audit } from '../services/audit.service';
import { Visit, WatchEntry, EvacuationEvent } from '../models/Visitor';
import { User } from '../models/User';
import * as svc from '../services/visitor.service';

const router = Router();
router.use(requireAuth);
const org = (req: any) => String(req.user.organizationId);
const actor = (req: any) => ({ id: req.user.id as string, name: req.user.name as string });
const oid = z.string().regex(/^[a-f0-9]{24}$/i);
const desk = requireModule('visitors');
const admin = requireModule('visitors_admin');
const deskOrAdmin = (req: any, _res: any, next: any) => (hasModule(req, 'visitors') || hasModule(req, 'visitors_admin') ? next() : next(ApiError.forbidden('Reception access is needed.')));
const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const person = z.object({ name: z.string().trim().min(2).max(120), email: z.string().trim().email().max(200).optional().or(z.literal('')), phone: z.string().trim().max(40).optional(), company: z.string().trim().max(160).optional() });
const clean = (p: any) => ({ ...p, email: p.email || undefined });
const view = (v: any, full: boolean) => { const o = v.toObject ? v.toObject() : v; if (!full && o.watch) o.watch = { level: o.watch.level, overrideReason: o.watch.overrideReason }; return o; };

/* ---------------------------------------------------------------- the host's own screens (every employee) */
router.get('/mine', asyncHandler(async (req, res) => {
  const rows: any[] = await Visit.find({ organizationId: org(req), hostId: req.user!.id, status: { $in: ['pending_approval', 'approved', 'booked', 'checked_in'] } }).sort({ scheduledStart: 1, createdAt: -1 }).lean();
  const recent: any[] = await Visit.find({ organizationId: org(req), hostId: req.user!.id, status: { $in: ['checked_out', 'rejected', 'cancelled', 'no_show'] } }).sort({ updatedAt: -1 }).limit(15).lean();
  res.json({ success: true, data: { active: rows.map((r) => view(r, false)), recent: recent.map((r) => view(r, false)) } });
}));
router.post('/:id/decision', asyncHandler(async (req, res) => {
  oid.parse(req.params.id);
  const b = z.object({ accept: z.boolean(), reason: z.string().max(300).optional() }).parse(req.body);
  const v = await svc.decide(org(req), req.params.id, req.user!.id, b.accept, b.reason, actor(req));
  await audit(req, b.accept ? 'visit.accepted' : 'visit.declined', 'Visit', String(v._id), { module: 'visitors', severity: 'low', summary: `${v.reference} ${v.visitor.name}` });
  res.json({ success: true, data: view(v, false) });
}));
router.get('/availability/me', asyncHandler(async (req, res) => { res.json({ success: true, data: await svc.getAvailability(org(req), req.user!.id) }); }));
router.put('/availability/me', asyncHandler(async (req, res) => {
  const a = await svc.saveAvailability(org(req), req.user!.id, req.body || {});
  await audit(req, 'visit.availability', 'User', req.user!.id, { module: 'visitors', severity: 'info', summary: a && (a as any).enabled ? 'online booking on' : 'online booking off' });
  res.json({ success: true, data: a });
}));
router.post('/:id/cancel', asyncHandler(async (req, res) => {
  oid.parse(req.params.id);
  const v: any = await Visit.findOne({ _id: req.params.id, organizationId: org(req) }); if (!v) throw ApiError.notFound('Visit not found');
  if (String(v.hostId) !== req.user!.id && !hasModule(req, 'visitors') && !hasModule(req, 'visitors_admin')) throw ApiError.forbidden('Only the host or reception can cancel a visit.');
  await svc.cancel(org(req), v, req.user!.name, z.string().max(300).optional().parse(req.body?.reason));
  res.json({ success: true, data: view(v, false) });
}));

/* ---------------------------------------------------------------- reception */
router.get('/people', deskOrAdmin, asyncHandler(async (req, res) => {
  const q = String(req.query.q || '').trim(); const f: any = { organizationId: org(req), isActive: true, role: { $nin: ['client', 'vendor', 'training_customer'] } };
  if (q) f.name = new RegExp(esc(q), 'i');
  res.json({ success: true, data: (await User.find(f).select('name department jobTitle').sort('name').limit(30).lean()).map((u: any) => ({ id: String(u._id), name: u.name, department: u.department, title: u.jobTitle })) });
}));
router.get('/', deskOrAdmin, asyncHandler(async (req, res) => {
  const q = req.query as any; const f: any = { organizationId: org(req) };
  if (q.status) f.status = { $in: String(q.status).split(',') };
  if (q.date) f.$or = [{ scheduledStart: { $gte: svc.atLagos(q.date, '00:00'), $lt: new Date(svc.atLagos(q.date, '00:00').getTime() + 86400000) } }, { checkedInAt: { $gte: svc.atLagos(q.date, '00:00'), $lt: new Date(svc.atLagos(q.date, '00:00').getTime() + 86400000) } }, { type: 'walk_in', createdAt: { $gte: svc.atLagos(q.date, '00:00'), $lt: new Date(svc.atLagos(q.date, '00:00').getTime() + 86400000) } }];
  if (q.q) { const rx = new RegExp(esc(String(q.q)), 'i'); f.$and = [{ $or: [{ 'visitor.name': rx }, { 'visitor.company': rx }, { reference: rx }, { hostName: rx }, { badgeNo: rx }] }]; }
  const limit = Math.min(Math.max(+q.limit || 50, 1), 200); const page = Math.max(+q.page || 1, 1);
  const [rows, total] = await Promise.all([Visit.find(f).sort({ createdAt: -1 }).skip((page - 1) * limit).limit(limit).lean(), Visit.countDocuments(f)]);
  const full = hasModule(req, 'visitors_admin');
  res.json({ success: true, data: rows.map((r) => view(r, full)), pagination: { page, pages: Math.ceil(total / limit) || 1, total } });
}));
router.get('/today', deskOrAdmin, asyncHandler(async (req, res) => {
  const today = svc.lagosDate(new Date()); const s = svc.atLagos(today, '00:00'); const e = new Date(s.getTime() + 86400000);
  const rows: any[] = await Visit.find({ organizationId: org(req), $or: [{ status: { $in: ['pending_approval', 'approved', 'checked_in'] } }, { status: 'booked', scheduledStart: { $gte: s, $lt: e } }, { status: { $in: ['checked_out', 'rejected'] }, updatedAt: { $gte: s } }] }).sort({ scheduledStart: 1, createdAt: 1 }).limit(300).lean();
  const full = hasModule(req, 'visitors_admin');
  const pick = (st: string[]) => rows.filter((r) => st.includes(r.status)).map((r) => view(r, full));
  res.json({ success: true, data: { pending: pick(['pending_approval']), expected: rows.filter((r) => (r.status === 'booked' || r.status === 'approved') ).map((r) => view(r, full)), onSite: pick(['checked_in']), done: pick(['checked_out', 'rejected']) } });
}));
router.post('/walk-in', desk, asyncHandler(async (req, res) => {
  const b = z.object({ hostId: oid, person, purpose: z.string().max(500).optional(), vehicle: z.string().max(40).optional(), idType: z.string().max(40).optional(), idLast4: z.string().max(4).optional() }).parse(req.body);
  const v = await svc.registerWalkIn(org(req), { ...b, person: clean(b.person) }, actor(req));
  await audit(req, 'visit.walk_in', 'Visit', String(v._id), { module: 'visitors', severity: 'low', summary: `${v.reference} ${v.visitor.name} → ${v.hostName}` });
  res.status(201).json({ success: true, data: view(v, false) });
}));
router.post('/lookup', deskOrAdmin, asyncHandler(async (req, res) => {
  const c = String(req.body?.code || '').replace(/^GSJX-VIS:/i, '').trim().toUpperCase();
  const v: any = c.length >= 6 ? await Visit.findOne({ organizationId: org(req), passCode: c }) : null;
  if (!v) throw ApiError.notFound('No visit matches that code'); res.json({ success: true, data: view(v, hasModule(req, 'visitors_admin')) });
}));
router.post('/:id/check-in', desk, asyncHandler(async (req, res) => {
  oid.parse(req.params.id);
  const b = z.object({ override: z.string().max(300).optional() }).parse(req.body || {});
  const v = await svc.checkIn(org(req), req.params.id, actor(req), { override: b.override, canOverrideBlock: hasModule(req, 'visitors_admin') });
  await audit(req, 'visit.check_in', 'Visit', String(v._id), { module: 'visitors', severity: v.watch ? 'high' : 'low', summary: `${v.reference} ${v.visitor.name} badge ${v.badgeNo}` });
  res.json({ success: true, data: view(v, hasModule(req, 'visitors_admin')) });
}));
router.post('/:id/check-out', desk, asyncHandler(async (req, res) => {
  oid.parse(req.params.id); const v = await svc.checkOut(org(req), req.params.id, actor(req));
  await audit(req, 'visit.check_out', 'Visit', String(v._id), { module: 'visitors', severity: 'low', summary: `${v.reference} ${v.visitor.name}` });
  res.json({ success: true, data: view(v, false) });
}));
router.get('/:id/pass', deskOrAdmin, asyncHandler(async (req, res) => {
  oid.parse(req.params.id); const v: any = await Visit.findOne({ _id: req.params.id, organizationId: org(req) }); if (!v) throw ApiError.notFound('Visit not found');
  if (v.status !== 'checked_in') throw ApiError.conflict('A pass is issued when the visitor is checked in.');
  res.setHeader('Content-Type', 'application/pdf'); res.setHeader('Content-Disposition', `inline; filename="pass-${v.badgeNo}.pdf"`); res.send(await svc.passPdf(org(req), v));
}));

/* ---------------------------------------------------------------- who is in the building / evacuation */
router.get('/onsite/list', deskOrAdmin, asyncHandler(async (req, res) => {
  const open = await EvacuationEvent.findOne({ organizationId: org(req), endedAt: { $exists: false } }).lean();
  res.json({ success: true, data: { people: await svc.onSite(org(req)), generatedAt: new Date(), evacuation: open } });
}));
router.post('/evacuation/start', deskOrAdmin, asyncHandler(async (req, res) => {
  const b = z.object({ reason: z.string().min(3).max(200), drill: z.boolean().optional() }).parse(req.body);
  const ev = await svc.startEvacuation(org(req), b, actor(req));
  await audit(req, 'visit.evacuation_started', 'EvacuationEvent', String(ev._id), { module: 'visitors', severity: b.drill ? 'medium' : 'critical', summary: `${b.drill ? 'drill: ' : ''}${b.reason} (${ev.people.length} on site)` });
  res.status(201).json({ success: true, data: ev });
}));
router.post('/evacuation/:id/account', deskOrAdmin, asyncHandler(async (req, res) => {
  oid.parse(req.params.id); const b = z.object({ visitId: oid, note: z.string().max(200).optional() }).parse(req.body);
  res.json({ success: true, data: await svc.accountFor(org(req), req.params.id, b.visitId, actor(req), b.note) });
}));
router.post('/evacuation/:id/end', deskOrAdmin, asyncHandler(async (req, res) => {
  oid.parse(req.params.id); const r = await svc.endEvacuation(org(req), req.params.id, actor(req));
  await audit(req, 'visit.evacuation_ended', 'EvacuationEvent', req.params.id, { module: 'visitors', severity: r.missing ? 'high' : 'medium', summary: `${r.missing} not accounted for` });
  res.json({ success: true, data: r });
}));
router.get('/evacuation/history', admin, asyncHandler(async (req, res) => {
  res.json({ success: true, data: await EvacuationEvent.find({ organizationId: org(req) }).sort({ startedAt: -1 }).limit(20).lean() });
}));

/* ---------------------------------------------------------------- security / admin */
router.get('/watchlist/list', admin, asyncHandler(async (req, res) => { res.json({ success: true, data: await WatchEntry.find({ organizationId: org(req) }).sort({ createdAt: -1 }).limit(500).lean() }); }));
router.post('/watchlist', admin, asyncHandler(async (req, res) => {
  const b = z.object({ name: z.string().min(2).max(120), email: z.string().email().optional().or(z.literal('')), phone: z.string().max(40).optional(), company: z.string().max(160).optional(), level: z.enum(['flag', 'block']), reason: z.string().min(5).max(500), expiresAt: z.string().optional().or(z.literal('')) }).parse(req.body);
  if (b.level === 'block' && !b.email && !b.phone) throw ApiError.badRequest('A blocking entry needs an e-mail or phone number so the right person is matched (a name alone only raises a flag).');
  const e: any = await WatchEntry.create({ ...b, email: b.email || undefined, expiresAt: b.expiresAt ? new Date(b.expiresAt) : undefined, organizationId: org(req), addedByName: req.user!.name });
  await audit(req, 'visit.watchlist_added', 'WatchEntry', String(e._id), { module: 'visitors', severity: 'medium', summary: `${e.level}: ${e.name}` });
  res.status(201).json({ success: true, data: e });
}));
router.post('/watchlist/:id/toggle', admin, asyncHandler(async (req, res) => {
  oid.parse(req.params.id); const e: any = await WatchEntry.findOne({ _id: req.params.id, organizationId: org(req) }); if (!e) throw ApiError.notFound('Not found');
  e.active = !e.active; await e.save(); await audit(req, 'visit.watchlist_toggled', 'WatchEntry', String(e._id), { module: 'visitors', severity: 'medium', summary: `${e.name} ${e.active ? 'on' : 'off'}` });
  res.json({ success: true, data: e });
}));
router.get('/stats/analytics', deskOrAdmin, asyncHandler(async (req, res) => { res.json({ success: true, data: await svc.analytics(org(req), Math.min(Math.max(+(req.query.days as string) || 30, 7), 365)) }); }));
router.get('/availability/all', admin, asyncHandler(async (req, res) => { res.json({ success: true, data: await svc.bookableHosts(org(req)) }); }));
router.get('/availability/:userId', admin, asyncHandler(async (req, res) => { oid.parse(req.params.userId); res.json({ success: true, data: await svc.getAvailability(org(req), req.params.userId) }); }));
router.put('/availability/:userId', admin, asyncHandler(async (req, res) => { oid.parse(req.params.userId); res.json({ success: true, data: await svc.saveAvailability(org(req), req.params.userId, req.body || {}) }); }));

export default router;
