import { Router } from 'express';
import { z } from 'zod';
import { requireAuth } from '../middleware/auth';
import { asyncHandler } from '../utils/asyncHandler';
import { NotificationPref, NOTIFY_CATEGORIES } from '../models/NotificationPref';
import { ENTITY_TYPES } from '../models/Discussion';

const router = Router();
router.use(requireAuth);

const shape = (p: any) => ({
  categories: NOTIFY_CATEGORIES.map((c) => ({ key: c.key, label: c.label, inApp: p?.categories?.[c.key]?.inApp !== false, email: p?.categories?.[c.key]?.email === undefined ? c.email : !!p.categories[c.key].email })),
  mutes: (p?.mutes || []).map((m: any) => ({ entityType: m.entityType, entityId: String(m.entityId), at: m.at })),
});

router.get('/', asyncHandler(async (req, res) => {
  const p = await NotificationPref.findOne({ userId: req.user!.id }).lean();
  res.json({ success: true, data: shape(p) });
}));

router.put('/', asyncHandler(async (req, res) => {
  const body = z.object({ categories: z.array(z.object({ key: z.string(), inApp: z.boolean(), email: z.boolean() })).max(40) }).parse(req.body);
  const known = new Set<string>(NOTIFY_CATEGORIES.map((c) => c.key));
  const categories: Record<string, { inApp: boolean; email: boolean }> = {};
  for (const c of body.categories) if (known.has(c.key)) categories[c.key] = { inApp: c.inApp, email: c.email };
  const p = await NotificationPref.findOneAndUpdate({ userId: req.user!.id }, { $set: { categories, organizationId: req.user!.organizationId } }, { upsert: true, new: true, setDefaultsOnInsert: true });
  res.json({ success: true, data: shape(p) });
}));

/** Mute or un-mute one task / project / opportunity … */
router.post('/mute', asyncHandler(async (req, res) => {
  const b = z.object({ entityType: z.enum(ENTITY_TYPES), entityId: z.string().regex(/^[a-f\d]{24}$/i), muted: z.boolean() }).parse(req.body);
  const p: any = (await NotificationPref.findOne({ userId: req.user!.id })) || new NotificationPref({ userId: req.user!.id, organizationId: req.user!.organizationId });
  p.mutes = (p.mutes || []).filter((m: any) => !(m.entityType === b.entityType && String(m.entityId) === b.entityId));
  if (b.muted) p.mutes.push({ entityType: b.entityType, entityId: b.entityId });
  await p.save();
  res.json({ success: true, data: shape(p) });
}));

router.get('/mute/:type/:id', asyncHandler(async (req, res) => {
  const p: any = await NotificationPref.findOne({ userId: req.user!.id }).lean();
  res.json({ success: true, data: { muted: !!(p?.mutes || []).some((m: any) => m.entityType === req.params.type && String(m.entityId) === req.params.id) } });
}));

export default router;
