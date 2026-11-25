import { Router } from 'express';
import { z } from 'zod';
import { requireAuth } from '../middleware/auth';
import { requireModule } from '../middleware/modules';
import { asyncHandler } from '../utils/asyncHandler';
import { ApiError } from '../utils/ApiError';
import { audit } from '../services/audit.service';
import { Evidence, EvidenceRequest } from '../models/Evidence';
import { User } from '../models/User';
import { notify } from '../services/notify.service';
import * as ev from '../services/evidence.service';

const router = Router();
router.use(requireAuth, requireModule('isms'));
const org = (req: any) => String(req.user.organizationId);
const actor = (req: any) => ({ id: req.user.id as string, name: req.user.name as string });
const oid = z.string().regex(/^[a-f0-9]{24}$/i);
const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const view = (e: any) => { const o = e.toObject ? e.toObject() : e; return { ...o, state: ev.statusOf(o) }; };

const input = z.object({
  title: z.string().min(3).max(300), description: z.string().max(4000).optional(), kind: z.enum(['file', 'link', 'note']).optional(), url: z.string().max(600).optional(),
  originalName: z.string().max(300).optional(), mimeType: z.string().max(120).optional(), size: z.number().optional(), controlRefs: z.any().optional(), clauses: z.any().optional(), registerRefs: z.any().optional(),
  collectedOn: z.string().optional(), validUntil: z.string().optional().or(z.literal('')),
});

router.get('/summary', asyncHandler(async (req, res) => { res.json({ success: true, data: await ev.summary(org(req)) }); }));

router.get('/', asyncHandler(async (req, res) => {
  const q = req.query as any; const f: any = { organizationId: org(req) };
  if (q.control) f.controlRefs = String(q.control);
  if (q.clause) f.clauses = String(q.clause);
  if (q.q) { const rx = new RegExp(esc(String(q.q)), 'i'); f.$or = [{ title: rx }, { refNo: rx }, { description: rx }]; }
  if (q.history !== 'true') f.supersededById = { $exists: false };
  if (q.locked === 'true') f.lockedAt = { $exists: true };
  const limit = Math.min(Math.max(+q.limit || 50, 1), 200); const page = Math.max(+q.page || 1, 1);
  let rows: any[] = await Evidence.find(f).sort({ createdAt: -1 }).lean();
  let out = rows.map((e) => ({ ...e, state: ev.statusOf(e) }));
  if (q.state) out = out.filter((e) => e.state === q.state);
  const total = out.length;
  res.json({ success: true, data: out.slice((page - 1) * limit, page * limit), pagination: { page, pages: Math.ceil(total / limit) || 1, total } });
}));

router.post('/', asyncHandler(async (req, res) => {
  const e: any = await ev.createEvidence(org(req), input.parse(req.body) as any, actor(req));
  await audit(req, 'evidence.added', 'Evidence', String(e._id), { module: 'isms', severity: 'low', summary: `${e.refNo} ${e.title}` });
  // fulfil a request when asked
  if (req.body?.requestId) { oid.parse(req.body.requestId); await EvidenceRequest.updateOne({ _id: req.body.requestId, organizationId: org(req), status: 'open' }, { $set: { status: 'fulfilled', evidenceId: e._id, fulfilledAt: new Date() } }); }
  res.status(201).json({ success: true, data: view(e) });
}));

async function load(req: any) { oid.parse(req.params.id); const e: any = await Evidence.findOne({ _id: req.params.id, organizationId: org(req) }); if (!e) throw ApiError.notFound('Evidence not found'); return e; }

router.patch('/:id', asyncHandler(async (req, res) => {
  const e = await load(req);
  if (e.lockedAt) throw ApiError.conflict('This evidence is locked and cannot be edited. Add a new version instead.');
  const b = z.object({ title: z.string().min(3).max(300).optional(), description: z.string().max(4000).optional(), controlRefs: z.any().optional(), clauses: z.any().optional(), registerRefs: z.any().optional(), validUntil: z.string().optional().or(z.literal('')) }).parse(req.body);
  if (b.title) e.title = b.title; if (b.description !== undefined) e.description = b.description;
  const L = (v: any) => (Array.isArray(v) ? v : String(v || '').split(/[,;\s]+/)).map((x: string) => x.trim()).filter(Boolean);
  if (b.controlRefs !== undefined) e.controlRefs = L(b.controlRefs).filter((x: string) => /^A\.[5-8]\.\d{1,2}$/.test(x));
  if (b.clauses !== undefined) e.clauses = L(b.clauses); if (b.registerRefs !== undefined) e.registerRefs = L(b.registerRefs);
  if (b.validUntil !== undefined) e.validUntil = b.validUntil ? new Date(b.validUntil) : undefined;
  e.history.push({ at: new Date(), byName: req.user!.name, action: 'edited' }); await e.save();
  res.json({ success: true, data: view(e) });
}));

router.post('/:id/lock', asyncHandler(async (req, res) => {
  const e = await load(req);
  if (e.lockedAt) throw ApiError.conflict('Already locked');
  if (e.supersededById) throw ApiError.conflict('This version has been replaced.');
  await ev.verifyEvidence(org(req), e, actor(req));
  if (['changed', 'missing'].includes(e.integrity)) throw ApiError.conflict(`The stored file ${e.integrity === 'missing' ? 'is missing' : 'no longer matches its fingerprint'}, so it cannot be locked.`);
  e.lockedAt = new Date(); e.lockedByName = req.user!.name; e.history.push({ at: new Date(), byName: req.user!.name, action: 'locked' }); await e.save();
  await audit(req, 'evidence.locked', 'Evidence', String(e._id), { module: 'isms', severity: 'low', summary: e.refNo });
  res.json({ success: true, data: view(e) });
}));

router.post('/:id/verify', asyncHandler(async (req, res) => {
  const e = await load(req); await ev.verifyEvidence(org(req), e, actor(req));
  if (['changed', 'missing'].includes(e.integrity)) await audit(req, 'evidence.integrity_failed', 'Evidence', String(e._id), { module: 'isms', severity: 'high', summary: `${e.refNo}: ${e.integrity}` });
  res.json({ success: true, data: view(e) });
}));

router.post('/:id/new-version', asyncHandler(async (req, res) => {
  const fresh: any = await ev.refreshEvidence(org(req), req.params.id, input.partial().parse(req.body) as any, actor(req));
  await audit(req, 'evidence.refreshed', 'Evidence', String(fresh._id), { module: 'isms', severity: 'low', summary: `${fresh.refNo} replaces ${req.params.id}` });
  res.status(201).json({ success: true, data: view(fresh) });
}));

router.delete('/:id', asyncHandler(async (req, res) => {
  const e = await load(req);
  if (e.lockedAt) throw ApiError.conflict('Locked evidence cannot be deleted.');
  const reason = z.string().min(5).max(500).parse(req.body?.reason);
  e.history.push({ at: new Date(), byName: req.user!.name, action: 'deleted', note: reason }); await e.save(); await (e as any).softDelete(req.user!.id);
  await audit(req, 'evidence.deleted', 'Evidence', String(e._id), { module: 'isms', severity: 'medium', summary: `${e.refNo}: ${reason}` });
  res.json({ success: true, data: { ok: true } });
}));

/* ---------------------------------------------------------------- requests */
router.get('/requests/list', asyncHandler(async (req, res) => {
  const f: any = { organizationId: org(req) }; if (req.query.status) f.status = String(req.query.status);
  res.json({ success: true, data: await EvidenceRequest.find(f).sort({ status: 1, dueDate: 1 }).limit(300).lean() });
}));
router.post('/requests', asyncHandler(async (req, res) => {
  const b = z.object({ title: z.string().min(3).max(300), controlRef: z.string().max(20).optional(), note: z.string().max(2000).optional(), assigneeId: oid.optional(), dueDate: z.string().optional() }).parse(req.body);
  const who: any = b.assigneeId ? await User.findOne({ _id: b.assigneeId, organizationId: org(req), isActive: true }).select('name').lean() : null;
  if (b.assigneeId && !who) throw ApiError.badRequest('Assignee not found');
  const r: any = await ev.createRequest(org(req), { ...b, assigneeName: who?.name }, actor(req));
  if (b.assigneeId) await notify({ organizationId: org(req), userIds: [b.assigneeId], title: `Evidence requested: ${r.title}`, body: `${req.user!.name} asks you to provide evidence${b.controlRef ? ` for ${b.controlRef}` : ''}${b.dueDate ? ` by ${b.dueDate}` : ''}.\n${b.note || ''}`.trim(), link: '/isms?tab=evidence', type: 'reminder', severity: 'warning', category: 'system', dedupeKey: `evreq:${r._id}`, email: { intro: `${req.user!.name} asks you to provide evidence: ${r.title}`, ctaLabel: 'Provide evidence' } });
  await audit(req, 'evidence.requested', 'EvidenceRequest', String(r._id), { module: 'isms', severity: 'low', summary: r.refNo });
  res.status(201).json({ success: true, data: r });
}));
router.post('/requests/:id/cancel', asyncHandler(async (req, res) => {
  oid.parse(req.params.id); const r = await EvidenceRequest.findOneAndUpdate({ _id: req.params.id, organizationId: org(req), status: 'open' }, { $set: { status: 'cancelled' } }, { new: true });
  if (!r) throw ApiError.notFound('Open request not found'); res.json({ success: true, data: r });
}));

export default router;
