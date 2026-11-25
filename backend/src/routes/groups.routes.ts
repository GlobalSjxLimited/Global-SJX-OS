import { Router } from 'express';
import { requireAuth } from '../middleware/auth';
import { asyncHandler } from '../utils/asyncHandler';
import { ApiError } from '../utils/ApiError';
import { Group } from '../models/Group';
import { excludeDeleted } from '../utils/softDeletePlugin';
import { escapeRegex } from '../utils/escapeRegex';

const router = Router();
router.use(requireAuth);

const MANAGER_ROLES = ['hr', 'coo', 'ceo', 'super_admin'];

function canManage(group: any, req: any): boolean {
  return String(group.createdById) === req.user.id || MANAGER_ROLES.includes(req.user.role);
}

router.get(
  '/',
  asyncHandler(async (req, res) => {
    const { q } = req.query as Record<string, string>;
    let filter: Record<string, unknown> = { organizationId: req.user!.organizationId };
    if (q) filter.$or = [{ name: { $regex: escapeRegex(q), $options: 'i' } }, { description: { $regex: escapeRegex(q), $options: 'i' } }];
    filter = excludeDeleted(filter);
    const groups = await Group.find(filter).populate('memberIds', 'name avatarUrl').populate('createdById', 'name').sort('name');
    res.json({ success: true, data: groups });
  })
);

router.get(
  '/:id',
  asyncHandler(async (req, res) => {
    const group = await Group.findOne(excludeDeleted({ _id: req.params.id, organizationId: req.user!.organizationId })).populate('memberIds', 'name avatarUrl');
    if (!group) throw ApiError.notFound('Group not found');
    res.json({ success: true, data: group });
  })
);

// Any authenticated employee can form a working group — this is a
// collaborative, low-stakes action, unlike editing or disbanding one that
// someone else set up.
router.post(
  '/',
  asyncHandler(async (req, res) => {
    const group = await Group.create({ ...req.body, organizationId: req.user!.organizationId, createdById: req.user!.id });
    res.status(201).json({ success: true, data: group });
  })
);

router.patch(
  '/:id',
  asyncHandler(async (req, res) => {
    const group = await Group.findOne(excludeDeleted({ _id: req.params.id, organizationId: req.user!.organizationId }));
    if (!group) throw ApiError.notFound('Group not found');
    if (!canManage(group, req)) throw ApiError.forbidden('Only the group creator or HR/COO/CEO can edit this group.');
    Object.assign(group, req.body);
    await group.save();
    res.json({ success: true, data: group });
  })
);

router.delete(
  '/:id',
  asyncHandler(async (req, res) => {
    const group = await Group.findOne(excludeDeleted({ _id: req.params.id, organizationId: req.user!.organizationId }));
    if (!group) throw ApiError.notFound('Group not found');
    if (!canManage(group, req)) throw ApiError.forbidden('Only the group creator or HR/COO/CEO can delete this group.');
    await (group as any).softDelete(req.user!.id);
    res.json({ success: true, data: { id: req.params.id, softDeleted: true } });
  })
);

router.post(
  '/:id/restore',
  asyncHandler(async (req, res) => {
    const group = await Group.findOne({ _id: req.params.id, organizationId: req.user!.organizationId, isDeleted: true });
    if (!group) throw ApiError.notFound('Deleted group not found');
    if (!canManage(group, req)) throw ApiError.forbidden('Only the group creator or HR/COO/CEO can restore this group.');
    await (group as any).restore();
    res.json({ success: true, data: group });
  })
);

export default router;
