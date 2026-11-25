import { Router } from 'express';
import { Types } from 'mongoose';
import { requireAuth } from '../middleware/auth';
import { requireRole } from '../middleware/rbac';
import { stripProtected } from '../middleware/security';
import { asyncHandler } from '../utils/asyncHandler';
import { ApiError } from '../utils/ApiError';
import { escapeRegex } from '../utils/escapeRegex';
import { cleanHtml, plainText } from '../utils/html';
import { notifyMentions } from '../utils/mentions';
import { KnowledgeArticle } from '../models/KnowledgeArticle';
import { Organization } from '../models/Organization';
import { Notification } from '../models/Notification';
import { logActivity } from '../models/ActivityLog';
import { excludeDeleted } from '../utils/softDeletePlugin';

const router = Router();
const PUBLISHERS = ['ceo'] as const; // super_admin always passes requireRole

/* ----------------------- PUBLIC (no auth) — website ---------------------- */
router.get(
  '/public',
  asyncHandler(async (req, res) => {
    const org = await Organization.findOne({ isInternal: true });
    if (!org) return res.json({ success: true, data: [] });
    const { q, category } = req.query as Record<string, string>;
    const filter: any = { organizationId: org._id, publishedToWebsite: true, status: 'approved' };
    if (category) filter.categories = category;
    if (q) filter.title = new RegExp(escapeRegex(q), 'i');
    const data = await KnowledgeArticle.find(excludeDeleted(filter))
      .select('title summary categories tags publishedAt createdAt authorId')
      .populate('authorId', 'name')
      .sort('-publishedAt')
      .limit(60);
    res.json({ success: true, data });
  })
);

router.get(
  '/public/:id',
  asyncHandler(async (req, res) => {
    const org = await Organization.findOne({ isInternal: true });
    if (!org || !/^[a-f0-9]{24}$/.test(req.params.id)) throw ApiError.notFound('Article not found');
    const a = await KnowledgeArticle.findOne(excludeDeleted({ _id: req.params.id, organizationId: org._id, publishedToWebsite: true, status: 'approved' }))
      .select('title summary content categories tags publishedAt createdAt authorId')
      .populate('authorId', 'name');
    if (!a) throw ApiError.notFound('Article not found');
    res.json({ success: true, data: a });
  })
);

/* ---------------------------- Authenticated ----------------------------- */
router.use(requireAuth);

function canEditArticle(article: any, req: any): boolean {
  return String(article.authorId) === req.user.id || ['hr', 'coo', 'ceo', 'super_admin'].includes(req.user.role);
}

router.get(
  '/categories',
  asyncHandler(async (req, res) => {
    const rows = await KnowledgeArticle.aggregate([
      { $match: { organizationId: new Types.ObjectId(req.user!.organizationId), isDeleted: { $ne: true } } },
      { $unwind: '$categories' },
      { $group: { _id: '$categories', count: { $sum: 1 } } },
      { $sort: { _id: 1 } },
    ]);
    res.json({ success: true, data: rows.map((r: any) => ({ name: r._id, count: r.count })) });
  })
);

router.get(
  '/',
  asyncHandler(async (req, res) => {
    const { q, type, category, website, mine } = req.query as Record<string, string>;
    const filter: any = { organizationId: req.user!.organizationId };
    // Drafts are visible only to their author and managers.
    filter.$or = [{ status: 'approved' }, { authorId: req.user!.id }];
    if (type) filter.type = type;
    if (category) filter.categories = category;
    if (website === 'true') filter.publishedToWebsite = true;
    if (mine === 'true') filter.authorId = req.user!.id;
    if (q) {
      const rx = new RegExp(escapeRegex(q), 'i');
      filter.$and = [{ $or: [{ title: rx }, { summary: rx }, { tags: rx }, { categories: rx }] }];
    }
    const articles = await KnowledgeArticle.find(excludeDeleted(filter))
      .select('title summary type categories tags viewCount createdAt authorId status publishedToWebsite')
      .populate('authorId', 'name')
      .sort('-createdAt')
      .limit(100);
    res.json({ success: true, data: articles });
  })
);

router.get(
  '/:id',
  asyncHandler(async (req, res) => {
    const article = await KnowledgeArticle.findOneAndUpdate(
      excludeDeleted({ _id: req.params.id, organizationId: req.user!.organizationId }),
      { $inc: { viewCount: 1 } },
      { new: true }
    )
      .populate('authorId', 'name avatarUrl')
      .populate('comments.authorId', 'name avatarUrl');
    if (!article) throw ApiError.notFound('Article not found');
    if (article.status !== 'approved' && !canEditArticle(article, req)) throw ApiError.notFound('Article not found');
    res.json({ success: true, data: article });
  })
);

function normaliseBody(body: any) {
  const out: any = stripProtected(body, ['authorId', 'viewCount', 'comments', 'publishedToWebsite', 'publishedAt', 'publishedById']);
  if (out.content !== undefined) {
    out.content = cleanHtml(out.content);
    if (!out.summary) out.summary = plainText(out.content, 220);
  }
  if (out.summary !== undefined) out.summary = plainText(String(out.summary), 300);
  if (Array.isArray(out.categories)) out.categories = Array.from(new Set(out.categories.map((c: any) => String(c).trim()).filter(Boolean))).slice(0, 12);
  if (Array.isArray(out.tags)) out.tags = Array.from(new Set(out.tags.map((c: any) => String(c).trim()).filter(Boolean))).slice(0, 20);
  return out;
}

router.post(
  '/',
  asyncHandler(async (req, res) => {
    const data = normaliseBody(req.body);
    if (!data.title || !data.content) throw ApiError.badRequest('Title and content are required');
    const article = await KnowledgeArticle.create({ ...data, organizationId: req.user!.organizationId, authorId: req.user!.id });
    await notifyMentions({ text: String(req.body.content || ''), organizationId: req.user!.organizationId, actorId: req.user!.id, actorName: req.user!.name, title: `${req.user!.name} mentioned you in an article`, link: `/knowledge/${article._id}` });
    res.status(201).json({ success: true, data: article });
  })
);

router.patch(
  '/:id',
  asyncHandler(async (req, res) => {
    const article = await KnowledgeArticle.findOne(excludeDeleted({ _id: req.params.id, organizationId: req.user!.organizationId }));
    if (!article) throw ApiError.notFound('Article not found');
    if (!canEditArticle(article, req)) throw ApiError.forbidden('Only the author or a manager can edit this article.');
    Object.assign(article, normaliseBody(req.body));
    await article.save();
    res.json({ success: true, data: article });
  })
);

/** Push an article to (or pull it from) the public website. CEO / administrators only. */
router.post(
  '/:id/publish',
  requireRole(...(PUBLISHERS as any)),
  asyncHandler(async (req, res) => {
    const article = await KnowledgeArticle.findOne(excludeDeleted({ _id: req.params.id, organizationId: req.user!.organizationId }));
    if (!article) throw ApiError.notFound('Article not found');
    const publish = req.body.publish !== false;
    if (publish && article.status !== 'approved') throw ApiError.badRequest('Only approved articles can be published to the website.');
    article.publishedToWebsite = publish;
    article.publishedAt = publish ? new Date() : undefined;
    article.publishedById = publish ? (req.user!.id as any) : undefined;
    await article.save();
    await logActivity({ organizationId: req.user!.organizationId, actorId: req.user!.id, action: publish ? 'knowledge.published_to_website' : 'knowledge.unpublished_from_website', entityType: 'KnowledgeArticle', entityId: String(article._id) });
    res.json({ success: true, data: article });
  })
);

router.post(
  '/:id/comments',
  asyncHandler(async (req, res) => {
    const body = cleanHtml(String(req.body.body || ''));
    if (!plainText(body, 5)) throw ApiError.badRequest('Comment cannot be empty');
    const article = await KnowledgeArticle.findOne(excludeDeleted({ _id: req.params.id, organizationId: req.user!.organizationId }));
    if (!article) throw ApiError.notFound('Article not found');
    const parentId = req.body.parentId && /^[a-f0-9]{24}$/.test(req.body.parentId) ? req.body.parentId : undefined;
    article.comments.push({ authorId: req.user!.id as any, body, parentId, createdAt: new Date() } as any);
    await article.save();
    if (article.authorId && String(article.authorId) !== req.user!.id) {
      await Notification.create({ organizationId: req.user!.organizationId, userId: article.authorId, type: 'knowledge', title: `${req.user!.name} commented on "${article.title}"`, link: `/knowledge/${article._id}` });
    }
    await notifyMentions({ text: String(req.body.body || ''), organizationId: req.user!.organizationId, actorId: req.user!.id, actorName: req.user!.name, title: `${req.user!.name} mentioned you in a comment`, link: `/knowledge/${article._id}` });
    const fresh = await KnowledgeArticle.findById(article._id).populate('comments.authorId', 'name avatarUrl');
    res.status(201).json({ success: true, data: fresh });
  })
);

router.delete(
  '/:id/comments/:commentId',
  asyncHandler(async (req, res) => {
    const article = await KnowledgeArticle.findOne(excludeDeleted({ _id: req.params.id, organizationId: req.user!.organizationId }));
    if (!article) throw ApiError.notFound('Article not found');
    const c: any = (article.comments as any).id(req.params.commentId);
    if (!c) throw ApiError.notFound('Comment not found');
    if (String(c.authorId) !== req.user!.id && !['ceo', 'super_admin', 'hr', 'coo'].includes(req.user!.role)) throw ApiError.forbidden();
    c.deleteOne();
    await article.save();
    res.json({ success: true, data: { deleted: true } });
  })
);

router.delete(
  '/:id',
  asyncHandler(async (req, res) => {
    const article = await KnowledgeArticle.findOne(excludeDeleted({ _id: req.params.id, organizationId: req.user!.organizationId }));
    if (!article) throw ApiError.notFound('Article not found');
    if (!canEditArticle(article, req)) throw ApiError.forbidden('Only the author or a manager can delete this article.');
    await (article as any).softDelete(req.user!.id);
    res.json({ success: true, data: { id: req.params.id, softDeleted: true } });
  })
);

router.post(
  '/:id/restore',
  asyncHandler(async (req, res) => {
    const article = await KnowledgeArticle.findOne({ _id: req.params.id, organizationId: req.user!.organizationId, isDeleted: true });
    if (!article) throw ApiError.notFound('Deleted article not found');
    if (!canEditArticle(article, req)) throw ApiError.forbidden();
    await (article as any).restore();
    res.json({ success: true, data: article });
  })
);

export default router;
