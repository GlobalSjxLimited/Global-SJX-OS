import { stripProtected } from '../middleware/security';
import { Request, Response } from 'express';
import { Model } from 'mongoose';
import { ApiError } from '../utils/ApiError';
import { asyncHandler } from '../utils/asyncHandler';
import { logActivity } from '../models/ActivityLog';
import { excludeDeleted } from '../utils/softDeletePlugin';
import { escapeRegex } from '../utils/escapeRegex';

interface CrudOptions {
  entityName: string;
  searchableFields?: string[];
  populate?: string | string[];
  defaultSort?: string;
}

/**
 * Builds tenant-scoped list/get/create/update/remove handlers for a Mongoose model.
 * Every query is automatically filtered by req.user.organizationId, which is the
 * guard rail that makes the platform safe to eventually run multi-tenant.
 */
export function buildCrudController(model: Model<any>, options: CrudOptions) {
  const { entityName, searchableFields = [], populate, defaultSort = '-createdAt' } = options;

  const list = asyncHandler(async (req: Request, res: Response) => {
    const { page = '1', limit = '20', q, sort, includeDeleted, createdFrom, createdTo, updatedFrom, updatedTo, ...filters } = req.query as Record<string, string>;
    let query: Record<string, unknown> = { organizationId: req.user!.organizationId };

    if (q && searchableFields.length) {
      query.$or = searchableFields.map((f) => ({ [f]: { $regex: escapeRegex(q), $options: 'i' } }));
    }
    Object.entries(filters).forEach(([key, value]) => {
      if (value !== undefined && value !== '') query[key] = value;
    });
    // Date filters every list shares: when it was created, when it was last changed.
    const range = (from?: string, to?: string) => {
      const r: Record<string, Date> = {};
      if (from && !Number.isNaN(+new Date(from))) r.$gte = new Date(from);
      if (to && !Number.isNaN(+new Date(to))) r.$lte = new Date(`${to.slice(0, 10)}T23:59:59.999Z`);
      return Object.keys(r).length ? r : null;
    };
    const cr = range(createdFrom, createdTo); if (cr) query.createdAt = cr;
    const ur = range(updatedFrom, updatedTo); if (ur) query.updatedAt = ur;
    query = excludeDeleted(query, includeDeleted === 'true');

    const pageNum = Math.max(parseInt(page, 10) || 1, 1);
    const limitNum = Math.min(Math.max(parseInt(limit, 10) || 20, 1), 100);

    let cursor = model
      .find(query)
      .sort(sort || defaultSort)
      .skip((pageNum - 1) * limitNum)
      .limit(limitNum);
    if (populate) cursor = cursor.populate(populate as any);

    const [items, total] = await Promise.all([cursor.exec(), model.countDocuments(query)]);

    res.json({ success: true, data: items, pagination: { page: pageNum, limit: limitNum, total, pages: Math.ceil(total / limitNum) } });
  });

  const getOne = asyncHandler(async (req: Request, res: Response) => {
    let cursor = model.findOne(excludeDeleted({ _id: req.params.id, organizationId: req.user!.organizationId }, req.query.includeDeleted === 'true'));
    if (populate) cursor = cursor.populate(populate as any);
    const item = await cursor.exec();
    if (!item) throw ApiError.notFound(`${entityName} not found`);
    res.json({ success: true, data: item });
  });

  const create = asyncHandler(async (req: Request, res: Response) => {
    const item = await model.create({ ...stripProtected(req.body), organizationId: req.user!.organizationId });
    await logActivity({
      organizationId: req.user!.organizationId,
      actorId: req.user!.id,
      action: `${entityName.toLowerCase()}.created`,
      entityType: entityName,
      entityId: String(item._id),
    });
    res.status(201).json({ success: true, data: item });
  });

  const update = asyncHandler(async (req: Request, res: Response) => {
    const item = await model.findOneAndUpdate(
      { _id: req.params.id, organizationId: req.user!.organizationId, isDeleted: { $ne: true } },
      { $set: stripProtected(req.body) },
      { new: true, runValidators: true }
    );
    if (!item) throw ApiError.notFound(`${entityName} not found`);
    await logActivity({
      organizationId: req.user!.organizationId,
      actorId: req.user!.id,
      action: `${entityName.toLowerCase()}.updated`,
      entityType: entityName,
      entityId: String(item._id),
    });
    res.json({ success: true, data: item });
  });

  const remove = asyncHandler(async (req: Request, res: Response) => {
    const item = await model.findOne({ _id: req.params.id, organizationId: req.user!.organizationId, isDeleted: { $ne: true } });
    if (!item) throw ApiError.notFound(`${entityName} not found`);
    await (item as any).softDelete(req.user!.id);
    await logActivity({
      organizationId: req.user!.organizationId,
      actorId: req.user!.id,
      action: `${entityName.toLowerCase()}.deleted`,
      entityType: entityName,
      entityId: String(item._id),
    });
    res.json({ success: true, data: { id: req.params.id, softDeleted: true } });
  });

  const restore = asyncHandler(async (req: Request, res: Response) => {
    const item = await model.findOne({ _id: req.params.id, organizationId: req.user!.organizationId, isDeleted: true });
    if (!item) throw ApiError.notFound(`Deleted ${entityName} not found`);
    await (item as any).restore();
    await logActivity({
      organizationId: req.user!.organizationId,
      actorId: req.user!.id,
      action: `${entityName.toLowerCase()}.restored`,
      entityType: entityName,
      entityId: String(item._id),
    });
    res.json({ success: true, data: item });
  });

  return { list, getOne, create, update, remove, restore };
}
