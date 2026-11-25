import { Router } from 'express';
import { z } from 'zod';
import { requireAuth } from '../middleware/auth';
import { asyncHandler } from '../utils/asyncHandler';
import { ApiError } from '../utils/ApiError';
import { audit } from '../services/audit.service';
import { Discussion, ENTITY_TYPES, REACTIONS } from '../models/Discussion';
import { deviceLabel } from '../utils/requestContext';
import { extractMentionedUserIds } from '../utils/mentions';
import { loadEntity, postComment, presentComment, grantAwareness, Actor } from '../services/discussion.service';

const router = Router();
router.use(requireAuth);

const actorOf = (req: any): Actor => ({ id: req.user.id, name: req.user.name, role: req.user.role, organizationId: req.user.organizationId, modules: req.user.modules });
const fromOf = (req: any) => ({ ip: req.ip, device: deviceLabel(String(req.headers['user-agent'] || '')) });
const idz = z.string().regex(/^[a-f\d]{24}$/i);
const urlIn = z.string().min(1).max(500).refine((u) => /^(\/api\/uploads\/|https?:\/\/)/i.test(u), 'Must be an uploaded file or an http(s) link');
const postZ = z.object({
  body: z.string().trim().min(1, 'Write something first').max(8000),
  parentId: idz.optional(),
  notify: z.enum(['none', 'mentioned', 'all']).default('mentioned'),
  awareness: z.array(idz).max(30).default([]),
  attachments: z.array(z.object({ name: z.string().max(200), url: urlIn, kind: z.enum(['file', 'image', 'link', 'evidence']).optional() })).max(10).optional(),
  scopeId: idz.optional(),
});

router.get('/meta', (_req, res) => res.json({ success: true, data: { reactions: REACTIONS, entityTypes: ENTITY_TYPES } }));

/** All comments on one record, oldest first; the client nests them by parentId. */
router.get('/:type/:id', asyncHandler(async (req, res) => {
  const actor = actorOf(req);
  const entity = await loadEntity(actor, req.params.type, req.params.id, req.query.scopeId as string | undefined);
  const rows = await Discussion.find({ organizationId: actor.organizationId, entityType: entity.type, entityId: entity.id }).sort('createdAt').limit(1000);
  const visible = rows.filter((c: any) => !c.isDeleted || rows.some((r: any) => String(r.parentId) === String(c._id) && !r.isDeleted));
  res.json({ success: true, data: visible.map((c) => presentComment(c, actor, entity.canManage)), meta: { title: entity.title, canManage: entity.canManage, total: rows.filter((r: any) => !r.isDeleted).length } });
}));

router.post('/:type/:id', asyncHandler(async (req, res) => {
  const actor = actorOf(req);
  const d = postZ.parse(req.body);
  const entity = await loadEntity(actor, req.params.type, req.params.id, d.scopeId);
  if (d.awareness.length) await grantAwareness(actor, entity, d.awareness);
  const mentioned = extractMentionedUserIds(d.body);
  if (mentioned.length) await grantAwareness(actor, entity, mentioned.filter((m) => m !== actor.id));
  const c = await postComment({ actor, entity, body: d.body, parentId: d.parentId, notify: d.notify, awareness: d.awareness, attachments: d.attachments, from: fromOf(req) });
  res.status(201).json({ success: true, data: presentComment(c, actor, entity.canManage) });
}));

async function loadComment(req: any) {
  const c: any = await Discussion.findOne({ _id: req.params.cid, organizationId: req.user.organizationId });
  if (!c) throw ApiError.notFound('Comment not found');
  const entity = await loadEntity(actorOf(req), c.entityType, String(c.entityId), c.scopeId ? String(c.scopeId) : undefined);
  return { c, entity };
}

router.patch('/comment/:cid', asyncHandler(async (req, res) => {
  const actor = actorOf(req);
  const { c, entity } = await loadComment(req);
  if (c.isDeleted) throw ApiError.badRequest('This comment was deleted');
  if (c.kind === 'system' || String(c.authorId) !== actor.id) throw ApiError.forbidden('You can only edit your own comments');
  const { body } = z.object({ body: z.string().trim().min(1, 'A comment cannot be empty').max(8000) }).parse(req.body);
  if (body === c.body) return res.json({ success: true, data: presentComment(c, actor, entity.canManage) });
  c.history.push({ body: c.body, at: new Date() });
  c.body = body; c.editedAt = new Date(); c.editedByName = actor.name;
  c.mentions = extractMentionedUserIds(body);
  await c.save();
  res.json({ success: true, data: presentComment(c, actor, entity.canManage) });
}));

router.delete('/comment/:cid', asyncHandler(async (req, res) => {
  const actor = actorOf(req);
  const { c, entity } = await loadComment(req);
  const p: any = presentComment(c, actor, entity.canManage);
  if (!p.canDelete) throw ApiError.forbidden(c.kind === 'status' ? 'Only leadership can remove a status comment — it is part of the audit trail' : 'You can only delete your own comments');
  c.isDeleted = true; c.deletedAt = new Date(); c.deletedByName = actor.name;
  await c.save();
  await audit(req, 'comment.deleted', 'Discussion', String(c._id), { module: 'comments', severity: 'low', summary: `Comment deleted on ${entity.label} "${entity.title}"` });
  res.json({ success: true, data: { ok: true } });
}));

router.post('/comment/:cid/react', asyncHandler(async (req, res) => {
  const actor = actorOf(req);
  const { emoji } = z.object({ emoji: z.enum(REACTIONS) }).parse(req.body);
  const { c, entity } = await loadComment(req);
  if (c.isDeleted) throw ApiError.badRequest('This comment was deleted');
  const i = (c.reactions || []).findIndex((r: any) => r.emoji === emoji && String(r.userId) === actor.id);
  if (i >= 0) c.reactions.splice(i, 1); else c.reactions.push({ emoji, userId: actor.id, name: actor.name });
  await c.save();
  res.json({ success: true, data: presentComment(c, actor, entity.canManage) });
}));

export default router;
