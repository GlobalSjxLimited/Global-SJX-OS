import { Router } from 'express';
import { z } from 'zod';
import { requireAuth } from '../middleware/auth';
import { asyncHandler } from '../utils/asyncHandler';
import { ApiError } from '../utils/ApiError';
import { EntityDocument } from '../models/EntityDocument';
import { loadEntity, Actor } from '../services/discussion.service';
import { verifyOrgUpload } from '../services/fileCheck';
import { audit } from '../services/audit.service';
import { excludeDeleted } from '../utils/softDeletePlugin';

const router = Router();
router.use(requireAuth);
const actorOf = (req: any): Actor => ({ id: req.user.id, name: req.user.name, role: req.user.role, organizationId: req.user.organizationId, modules: req.user.modules });
const idz = z.string().regex(/^[a-f\d]{24}$/i);

router.get('/:type/:id', asyncHandler(async (req, res) => {
  const e = await loadEntity(actorOf(req), req.params.type, req.params.id, req.query.scopeId as string | undefined);
  const rows = await EntityDocument.find(excludeDeleted({ organizationId: req.user!.organizationId, entityType: e.type, entityId: e.id })).sort('-createdAt').limit(200);
  res.json({ success: true, data: rows.map((r: any) => ({ ...r.toObject(), canDelete: String(r.uploadedById) === req.user!.id || e.canManage })) });
}));

router.post('/:type/:id', asyncHandler(async (req, res) => {
  const b = z.object({ name: z.string().trim().min(1).max(200), url: z.string().min(1).max(500), kind: z.enum(['contract', 'proposal', 'signed', 'invoice', 'receipt', 'image', 'banner', 'other']).default('other'), note: z.string().max(1000).optional(), scopeId: idz.optional() }).parse(req.body);
  const e = await loadEntity(actorOf(req), req.params.type, req.params.id, b.scopeId);
  const f = verifyOrgUpload(req.user!.organizationId, b.url);
  const d = await EntityDocument.create({ organizationId: req.user!.organizationId, entityType: e.type, entityId: e.id, scopeId: e.scopeId, name: b.name, url: b.url, size: f.size, kind: b.kind, note: b.note, uploadedById: req.user!.id, uploadedByName: req.user!.name });
  await audit(req, 'document.attached', 'EntityDocument', String(d._id), { module: 'documents', summary: `"${b.name}" attached to ${e.label} "${e.title}"` });
  res.status(201).json({ success: true, data: d });
}));

router.delete('/file/:docId', asyncHandler(async (req, res) => {
  const d: any = await EntityDocument.findOne(excludeDeleted({ _id: req.params.docId, organizationId: req.user!.organizationId }));
  if (!d) throw ApiError.notFound('Document not found');
  const e = await loadEntity(actorOf(req), d.entityType, String(d.entityId), d.scopeId ? String(d.scopeId) : undefined);
  if (String(d.uploadedById) !== req.user!.id && !e.canManage) throw ApiError.forbidden('Only the uploader or a manager can remove this file');
  await d.softDelete(req.user!.id);
  await audit(req, 'document.removed', 'EntityDocument', String(d._id), { module: 'documents', severity: 'low', summary: `"${d.name}" removed from ${e.label} "${e.title}"` });
  res.json({ success: true, data: { ok: true } });
}));

export default router;
