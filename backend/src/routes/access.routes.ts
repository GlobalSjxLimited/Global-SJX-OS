import { Router } from 'express';
import { requireAuth } from '../middleware/auth';
import { requireModule } from '../middleware/modules';
import { asyncHandler } from '../utils/asyncHandler';
import { ApiError } from '../utils/ApiError';
import { MODULES, MODULE_KEYS, DEFAULT_ROLE_MODULES, ALWAYS_ON, ADMIN_ONLY_MODULES, ADMIN_ONLY_ROLES, EXTERNAL_FIXED } from '../config/modules';
import { ALL_ROLES } from '../config/roles';
import { RoleModuleConfig } from '../models/Access';
import { User } from '../models/User';
import { AccessReview } from '../models/Governance';
import { UserSession } from '../models/Access';
import { effectiveModules, invalidateAccessCache } from '../services/access.service';
import { audit } from '../services/audit.service';
import { nextNumber } from '../models/Access';
import { notify } from '../services/notify.service';

const router = Router();
router.use(requireAuth);

/** Anyone signed in: the catalogue and their own module list (the app uses this to build the menu). */
router.get('/catalog', asyncHandler(async (_req, res) => {
  res.json({ success: true, data: { modules: MODULES, alwaysOn: ALWAYS_ON, adminOnly: ADMIN_ONLY_MODULES, roles: ALL_ROLES, defaults: DEFAULT_ROLE_MODULES } });
}));
router.get('/me', asyncHandler(async (req, res) => {
  res.json({ success: true, data: { role: req.user!.role, modules: req.user!.modules } });
}));

const manage = requireModule('access_control');
const isAdmin = (role: string) => ADMIN_ONLY_ROLES.includes(role as any);

/* ------------------------------- Roles ↔ modules ---------------------------- */
router.get('/roles', manage, asyncHandler(async (req, res) => {
  const cfgs = await RoleModuleConfig.find({ organizationId: req.user!.organizationId }).lean();
  const counts = await User.aggregate([{ $match: { organizationId: new (require('mongoose').Types.ObjectId)(req.user!.organizationId), isActive: true } }, { $group: { _id: '$role', n: { $sum: 1 } } }]);
  const data = ALL_ROLES.map((role) => {
    const cfg = cfgs.find((c) => c.role === role);
    return {
      role,
      external: EXTERNAL_FIXED.includes(role),
      locked: role === 'super_admin' || EXTERNAL_FIXED.includes(role),
      customised: !!cfg,
      defaults: DEFAULT_ROLE_MODULES[role] || [],
      modules: role === 'super_admin' ? MODULE_KEYS : cfg ? (cfg.modules as string[]) : DEFAULT_ROLE_MODULES[role] || [],
      users: counts.find((c: any) => c._id === role)?.n || 0,
    };
  });
  res.json({ success: true, data });
}));

router.put('/roles/:role', manage, asyncHandler(async (req, res) => {
  const role = req.params.role;
  if (!(ALL_ROLES as readonly string[]).includes(role)) throw ApiError.badRequest('Unknown role');
  if (role === 'super_admin' || EXTERNAL_FIXED.includes(role)) throw ApiError.badRequest('This role has a fixed module set.');
  const requested: string[] = Array.isArray(req.body.modules) ? req.body.modules : [];
  let modules = Array.from(new Set(requested.filter((m) => MODULE_KEYS.includes(m))));
  ALWAYS_ON.forEach((m) => !modules.includes(m) && modules.push(m));
  if (!isAdmin(role)) modules = modules.filter((m) => !ADMIN_ONLY_MODULES.includes(m));
  else ADMIN_ONLY_MODULES.forEach((m) => !modules.includes(m) && modules.push(m)); // the CEO can never lock themselves out of access control
  const before = (await RoleModuleConfig.findOne({ organizationId: req.user!.organizationId, role }))?.modules || DEFAULT_ROLE_MODULES[role] || [];
  await RoleModuleConfig.findOneAndUpdate({ organizationId: req.user!.organizationId, role }, { modules, updatedById: req.user!.id }, { upsert: true, new: true });
  invalidateAccessCache();
  await audit(req, 'access.role_modules_changed', 'Role', undefined, { module: 'access_control', severity: 'high', summary: `Modules for role "${role}" changed`, meta: { role, added: modules.filter((m) => !before.includes(m)), removed: (before as string[]).filter((m) => !modules.includes(m)) } });
  res.json({ success: true, data: { role, modules } });
}));

router.delete('/roles/:role', manage, asyncHandler(async (req, res) => {
  await RoleModuleConfig.deleteOne({ organizationId: req.user!.organizationId, role: req.params.role });
  invalidateAccessCache();
  await audit(req, 'access.role_modules_reset', 'Role', undefined, { module: 'access_control', severity: 'high', summary: `Modules for role "${req.params.role}" reset to defaults` });
  res.json({ success: true, data: { role: req.params.role, modules: DEFAULT_ROLE_MODULES[req.params.role] || [] } });
}));

/* ----------------------------- Per-person overrides ------------------------ */
router.get('/users', manage, asyncHandler(async (req, res) => {
  const users = await User.find({ organizationId: req.user!.organizationId, isActive: true }).select('name email role jobTitle department moduleGrant moduleDeny mfaEnabled lastLoginAt loginEnabled organizationId').sort('name');
  const data = [];
  for (const u of users) {
    data.push({ ...u.toObject(), modules: await effectiveModules({ role: u.role, organizationId: String(u.organizationId), moduleGrant: u.moduleGrant as string[], moduleDeny: u.moduleDeny as string[] }) });
  }
  res.json({ success: true, data });
}));

router.put('/users/:id', manage, asyncHandler(async (req, res) => {
  if (req.params.id === req.user!.id && req.user!.role !== 'super_admin') throw ApiError.forbidden('You cannot change your own module access.');
  const target = await User.findOne({ _id: req.params.id, organizationId: req.user!.organizationId });
  if (!target) throw ApiError.notFound('User not found');
  if (isAdmin(target.role) && req.user!.role !== 'super_admin') throw ApiError.forbidden('Only an administrator can change this user.');
  const clean = (v: unknown) => (Array.isArray(v) ? Array.from(new Set((v as string[]).filter((m) => MODULE_KEYS.includes(m) && !ALWAYS_ON.includes(m)))) : []);
  let grant = clean(req.body.moduleGrant);
  const deny = clean(req.body.moduleDeny);
  if (!isAdmin(target.role)) grant = grant.filter((m) => !ADMIN_ONLY_MODULES.includes(m));
  target.moduleGrant = grant;
  target.moduleDeny = deny.filter((m) => !grant.includes(m));
  await target.save();
  await audit(req, 'access.user_modules_changed', 'User', String(target._id), { module: 'access_control', severity: 'high', summary: `Module overrides changed for ${target.name}`, meta: { grant: target.moduleGrant, deny: target.moduleDeny } });
  await notify({ organizationId: req.user!.organizationId, userIds: [String(target._id)], title: 'Your module access was updated', body: 'An administrator changed which modules you can use. Refresh the page to see the update.', type: 'access', link: '/settings' });
  res.json({ success: true, data: { id: target._id, moduleGrant: target.moduleGrant, moduleDeny: target.moduleDeny } });
}));

/* -------------------------------- Access reviews --------------------------- */
router.get('/reviews', manage, asyncHandler(async (req, res) => {
  const data = await AccessReview.find({ organizationId: req.user!.organizationId }).select('-items').sort('-createdAt').populate('reviewerId', 'name');
  const withCounts = await Promise.all(data.map(async (r) => {
    const full = await AccessReview.findById(r._id).select('items.decision');
    const items = (full?.items as any[]) || [];
    return { ...r.toObject(), total: items.length, decided: items.filter((i) => i.decision !== 'pending').length };
  }));
  res.json({ success: true, data: withCounts });
}));

router.post('/reviews', manage, asyncHandler(async (req, res) => {
  const { title, dueDate, reviewerId } = req.body;
  const users = await User.find({ organizationId: req.user!.organizationId, isActive: true, loginEnabled: { $ne: false } }).select('name email role department moduleGrant moduleDeny mfaEnabled lastLoginAt organizationId');
  const sensitive = MODULES.filter((m) => m.sensitive).map((m) => m.key);
  const items = [];
  for (const u of users) {
    const mods = await effectiveModules({ role: u.role, organizationId: String(u.organizationId), moduleGrant: u.moduleGrant as string[], moduleDeny: u.moduleDeny as string[] });
    items.push({ userId: u._id, name: u.name, email: u.email, role: u.role, department: u.department, modules: mods, sensitiveModules: mods.filter((m) => sensitive.includes(m)), mfaEnabled: u.mfaEnabled, lastLoginAt: u.lastLoginAt, decision: 'pending' });
  }
  const review = await AccessReview.create({
    organizationId: req.user!.organizationId,
    reference: await nextNumber(req.user!.organizationId, 'ACR'),
    title: title || `User access review — ${new Date().toLocaleDateString('en-GB', { month: 'long', year: 'numeric' })}`,
    dueDate: dueDate ? new Date(dueDate) : new Date(Date.now() + 14 * 86400000),
    reviewerId: reviewerId || req.user!.id,
    items,
    createdById: req.user!.id,
  });
  await audit(req, 'access.review_started', 'AccessReview', String(review._id), { module: 'access_control', summary: `Access review ${review.reference} started with ${items.length} users` });
  await notify({ organizationId: req.user!.organizationId, userIds: [String(review.reviewerId)], title: `Access review assigned: ${review.reference}`, body: `${items.length} users to review by ${review.dueDate?.toDateString()}.`, type: 'access', link: '/access', severity: 'warning' });
  res.status(201).json({ success: true, data: review });
}));

router.get('/reviews/:id', manage, asyncHandler(async (req, res) => {
  const review = await AccessReview.findOne({ _id: req.params.id, organizationId: req.user!.organizationId }).populate('reviewerId', 'name');
  if (!review) throw ApiError.notFound('Review not found');
  res.json({ success: true, data: review });
}));

router.patch('/reviews/:id/items/:itemId', manage, asyncHandler(async (req, res) => {
  const review = await AccessReview.findOne({ _id: req.params.id, organizationId: req.user!.organizationId });
  if (!review) throw ApiError.notFound('Review not found');
  if (review.status !== 'open') throw ApiError.conflict('This review is closed');
  const item: any = (review.items as any).id(req.params.itemId);
  if (!item) throw ApiError.notFound('Item not found');
  if (String(item.userId) === req.user!.id && req.user!.role !== 'super_admin') throw ApiError.forbidden('You cannot review your own access — another reviewer must decide it.');
  if (!['keep', 'reduce', 'remove', 'pending'].includes(req.body.decision)) throw ApiError.badRequest('decision must be keep, reduce, remove or pending');
  item.decision = req.body.decision;
  item.note = String(req.body.note || '').slice(0, 500);
  item.decidedAt = new Date();
  await review.save();
  res.json({ success: true, data: item });
}));

router.post('/reviews/:id/complete', manage, asyncHandler(async (req, res) => {
  const review = await AccessReview.findOne({ _id: req.params.id, organizationId: req.user!.organizationId });
  if (!review) throw ApiError.notFound('Review not found');
  if (review.status !== 'open') throw ApiError.conflict('This review is already closed');
  const pending = (review.items as any[]).filter((i) => i.decision === 'pending').length;
  if (pending > 0) throw ApiError.badRequest(`${pending} user(s) still need a decision.`);
  let removed = 0;
  if (req.body.apply) {
    for (const item of review.items as any[]) {
      if (item.decision === 'remove' && !item.applied) {
        const u = await User.findById(item.userId);
        if (u && !['super_admin'].includes(u.role)) {
          u.loginEnabled = false;
          u.tokenVersion = (u.tokenVersion || 0) + 1;
          await u.save();
          await UserSession.updateMany({ userId: u._id, isActive: true }, { isActive: false, terminatedAt: new Date(), terminationReason: 'Access removed in access review' });
          item.applied = true;
          removed++;
        }
      }
    }
  }
  review.status = 'completed';
  review.completedAt = new Date();
  review.completedById = req.user!.id as any;
  await review.save();
  await audit(req, 'access.review_completed', 'AccessReview', String(review._id), { module: 'access_control', severity: 'high', summary: `Access review ${review.reference} completed (${removed} logins removed)` });
  res.json({ success: true, data: { review, removed } });
}));

export default router;
