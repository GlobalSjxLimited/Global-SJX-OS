import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import { z } from 'zod';
import { requireAuth } from '../middleware/auth';
import { requireModule } from '../middleware/modules';
import { asyncHandler } from '../utils/asyncHandler';
import { ApiError } from '../utils/ApiError';
import { audit } from '../services/audit.service';
import { AuditorAccess } from '../models/Evidence';
import * as svc from '../services/auditorAccess.service';

/** Admin side: create, list and revoke auditor links (needs the isms module). */
export const auditorAdminRouter = Router();
auditorAdminRouter.use(requireAuth, requireModule('isms'));
const org = (req: any) => String(req.user.organizationId);
const view = (a: any) => ({ _id: a._id, name: a.name, email: a.email, company: a.company, registers: a.registers, includeEvidence: a.includeEvidence, expiresAt: a.expiresAt, revokedAt: a.revokedAt, createdByName: a.createdByName, createdAt: a.createdAt, lastUsedAt: a.lastUsedAt, uses: a.uses, state: a.revokedAt ? 'revoked' : a.expiresAt < new Date() ? 'expired' : 'active', log: (a.log || []).slice(-20).reverse() });

auditorAdminRouter.get('/', asyncHandler(async (req, res) => {
  const rows: any[] = await AuditorAccess.find({ organizationId: org(req) }).sort({ createdAt: -1 }).limit(100).lean();
  res.json({ success: true, data: rows.map(view) });
}));
auditorAdminRouter.post('/', asyncHandler(async (req, res) => {
  const b = z.object({ name: z.string().min(2).max(120), email: z.string().email().optional().or(z.literal('')), company: z.string().max(160).optional(), registers: z.array(z.string()).optional(), includeEvidence: z.boolean().optional(), days: z.number().int().min(1).max(60).optional() }).parse(req.body);
  const { rec, token } = await svc.createAccess(org(req), b, { name: req.user!.name });
  await audit(req, 'auditor.access_created', 'AuditorAccess', String(rec._id), { module: 'isms', severity: 'medium', summary: `${rec.name} until ${rec.expiresAt.toISOString().slice(0, 10)}` });
  res.status(201).json({ success: true, data: { ...view(rec), token, path: `/auditor/${token}` } });
}));
auditorAdminRouter.post('/:id/revoke', asyncHandler(async (req, res) => {
  const a: any = await AuditorAccess.findOne({ _id: req.params.id, organizationId: org(req) });
  if (!a) throw ApiError.notFound('Not found');
  if (!a.revokedAt) { a.revokedAt = new Date(); a.revokedByName = req.user!.name; await a.save(); await audit(req, 'auditor.access_revoked', 'AuditorAccess', String(a._id), { module: 'isms', severity: 'medium', summary: a.name }); }
  res.json({ success: true, data: view(a) });
}));

/** Public side: the token is the key. Read-only; every call is logged against the link. */
export const auditorPublicRouter = Router();
auditorPublicRouter.use(rateLimit({ windowMs: 15 * 60 * 1000, max: 300, standardHeaders: true, legacyHeaders: false }));
const tok = (req: any) => String(req.params.token);
auditorPublicRouter.get('/:token', asyncHandler(async (req, res) => {
  const a = await svc.resolve(tok(req), req.ip || '', 'overview'); await svc.warnExpiringAndNotify(String(a.organizationId), a, req.ip || '');
  res.json({ success: true, data: await svc.overview(a) });
}));
auditorPublicRouter.get('/:token/register/:key', asyncHandler(async (req, res) => {
  const a = await svc.resolve(tok(req), req.ip || '', `register ${req.params.key}`);
  res.json({ success: true, data: await svc.records(a, String(req.params.key), Math.max(+(req.query.page as string) || 1, 1)) });
}));
auditorPublicRouter.get('/:token/evidence', asyncHandler(async (req, res) => {
  const a = await svc.resolve(tok(req), req.ip || '', 'evidence list');
  res.json({ success: true, data: await svc.evidenceList(a) });
}));
auditorPublicRouter.get('/:token/evidence/:ref/file', asyncHandler(async (req, res) => {
  const a = await svc.resolve(tok(req), req.ip || '', `evidence file ${req.params.ref}`);
  const f = await svc.evidenceFile(a, String(req.params.ref));
  res.download(f.path, f.name);
}));
