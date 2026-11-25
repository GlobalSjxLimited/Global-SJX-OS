import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import { z } from 'zod';
import { requireModule } from '../middleware/modules';
import { asyncHandler } from '../utils/asyncHandler';
import { ApiError } from '../utils/ApiError';
import { audit } from '../services/audit.service';
import { SignatureRequest } from '../models/Signature';
import * as svc from '../services/signature.service';

const oid = z.string().regex(/^[a-f0-9]{24}$/i);
export const staff = Router();
staff.use(requireModule('signatures'));
const org = (req: any) => String(req.user.organizationId);
const actor = (req: any) => ({ id: req.user.id as string, name: req.user.name as string });
staff.get('/', asyncHandler(async (req, res) => { res.json({ success: true, data: (await SignatureRequest.find({ organizationId: org(req) }).sort({ createdAt: -1 }).limit(300)).map((r) => svc.view(r, false)) }); }));
staff.get('/:id', asyncHandler(async (req, res) => { oid.parse(req.params.id); const r = await SignatureRequest.findOne({ _id: req.params.id, organizationId: org(req) }); if (!r) throw ApiError.notFound('Not found'); res.json({ success: true, data: svc.view(r) }); }));
staff.post('/', asyncHandler(async (req, res) => {
  const b = z.object({ title: z.string().trim().min(3).max(200), body: z.string().trim().min(20).max(60000), category: z.enum(['nda', 'contract', 'policy', 'supplier', 'other']).optional(), vendorId: oid.optional(), days: z.number().int().min(2).max(60).optional(), signers: z.array(z.object({ name: z.string().trim().min(2).max(120), email: z.string().trim().email().max(200) })).min(1).max(10) }).parse(req.body);
  const r = await svc.create(org(req), b, actor(req));
  await audit(req, 'signature.sent', 'SignatureRequest', String(r.request._id), { module: 'signatures', severity: 'low', summary: `${r.request.reference} ${r.request.title}` });
  res.status(201).json({ success: true, data: { ...svc.view(r.request), links: r.links } });
}));
staff.post('/:id/remind', asyncHandler(async (req, res) => { oid.parse(req.params.id); const n = await svc.remind(org(req), req.params.id, actor(req)); res.json({ success: true, data: { reminded: n } }); }));
staff.post('/:id/cancel', asyncHandler(async (req, res) => { oid.parse(req.params.id); const r = await svc.cancel(org(req), req.params.id, actor(req)); await audit(req, 'signature.cancelled', 'SignatureRequest', req.params.id, { module: 'signatures', severity: 'low', summary: r.reference }); res.json({ success: true, data: svc.view(r) }); }));
staff.get('/:id/certificate', asyncHandler(async (req, res) => {
  oid.parse(req.params.id); const r: any = await SignatureRequest.findOne({ _id: req.params.id, organizationId: org(req) }); if (!r) throw ApiError.notFound('Not found');
  if (r.status !== 'completed') throw ApiError.conflict('The certificate is available once everyone has signed.');
  res.setHeader('Content-Type', 'application/pdf'); res.setHeader('Content-Disposition', `inline; filename="${r.reference}-certificate.pdf"`); res.send(await svc.certificate(r));
}));

/** Public: the signer's private link. */
export const pub = Router();
pub.use(rateLimit({ windowMs: 15 * 60 * 1000, max: 120, standardHeaders: true, legacyHeaders: false }));
pub.get('/:token', asyncHandler(async (req, res) => { res.json({ success: true, data: await svc.publicView(req.params.token) }); }));
pub.post('/:token/sign', asyncHandler(async (req, res) => { const b = z.object({ typedName: z.string().max(200), agree: z.boolean() }).parse(req.body); res.json({ success: true, data: await svc.sign(req.params.token, b.typedName, b.agree, { ip: req.ip, ua: req.get('user-agent') || '' }) }); }));
pub.post('/:token/decline', asyncHandler(async (req, res) => { const b = z.object({ reason: z.string().max(500) }).parse(req.body); await svc.decline(req.params.token, b.reason); res.json({ success: true, data: { declined: true } }); }));
