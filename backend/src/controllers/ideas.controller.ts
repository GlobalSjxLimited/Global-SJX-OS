import { stripProtected } from '../middleware/security';
import { Request, Response } from 'express';
import { asyncHandler } from '../utils/asyncHandler';
import { ApiError } from '../utils/ApiError';
import { Idea, IDEA_STAGES } from '../models/Idea';
import { excludeDeleted } from '../utils/softDeletePlugin';
import { notifyMentions } from '../utils/mentions';

/**
 * Heuristic "AI" scoring — deterministic, explainable scoring based on the idea's
 * own fields (length/specificity of business value, ratio of expected revenue to
 * cost, vote count). This is intentionally rule-based rather than pretending to
 * call an LLM; swapping in a real model call later only touches this function.
 */
function scoreIdea(idea: any) {
  const strategicFit = idea.strategicAlignment ? Math.min(10, 4 + idea.strategicAlignment.length / 40) : 5;
  const complexity = Math.min(10, 3 + (idea.resourcesNeeded?.length || 0) / 60);
  const ratio = idea.estimatedCost > 0 ? idea.expectedRevenue / idea.estimatedCost : idea.expectedRevenue > 0 ? 8 : 4;
  const revenuePotential = Math.max(0, Math.min(10, Math.log2(1 + ratio) * 2.5));
  const marketPotential = Math.max(0, Math.min(10, 4 + (idea.votes?.length || 0) * 0.4));
  const overall = Number(((strategicFit + revenuePotential + marketPotential + (10 - complexity)) / 4).toFixed(1));
  const investmentBand = idea.estimatedCost > 5_000_000 ? 'high' : idea.estimatedCost > 1_000_000 ? 'medium' : 'low';

  return {
    strategicFit: Number(strategicFit.toFixed(1)),
    marketPotential: Number(marketPotential.toFixed(1)),
    complexity: Number(complexity.toFixed(1)),
    estimatedInvestmentBand: investmentBand,
    revenuePotential: Number(revenuePotential.toFixed(1)),
    overall,
    scoredAt: new Date(),
  };
}

export const listIdeas = asyncHandler(async (req: Request, res: Response) => {
  const { stage } = req.query as Record<string, string>;
  let filter: Record<string, unknown> = { organizationId: req.user!.organizationId };
  if (stage) filter.stage = stage;
  filter = excludeDeleted(filter);
  const ideas = await Idea.find(filter).populate('submittedById', 'name avatarUrl').sort('-createdAt');
  res.json({ success: true, data: ideas });
});

export const getIdea = asyncHandler(async (req: Request, res: Response) => {
  const idea = await Idea.findOne(excludeDeleted({ _id: req.params.id, organizationId: req.user!.organizationId }))
    .populate('submittedById', 'name avatarUrl')
    .populate('comments.authorId', 'name avatarUrl')
    .populate('links.addedById', 'name')
    .populate('attachments.addedById', 'name');
  if (!idea) throw ApiError.notFound('Idea not found');
  res.json({ success: true, data: idea });
});

export const createIdea = asyncHandler(async (req: Request, res: Response) => {
  const idea = await Idea.create({ ...stripProtected(req.body, ['votes', 'comments']), organizationId: req.user!.organizationId, submittedById: req.user!.id });
  idea.aiScore = scoreIdea(idea) as any;
  await idea.save();
  res.status(201).json({ success: true, data: idea });
});

export const updateIdea = asyncHandler(async (req: Request, res: Response) => {
  const idea = await Idea.findOne(excludeDeleted({ _id: req.params.id, organizationId: req.user!.organizationId }));
  if (!idea) throw ApiError.notFound('Idea not found');

  if (req.body.stage && !IDEA_STAGES.includes(req.body.stage)) throw ApiError.badRequest('Invalid idea stage');
  Object.assign(idea, stripProtected(req.body, ['votes', 'comments', 'submittedById']));
  idea.aiScore = scoreIdea(idea) as any;
  await idea.save();
  res.json({ success: true, data: idea });
});

export const deleteIdea = asyncHandler(async (req: Request, res: Response) => {
  const idea = await Idea.findOne(excludeDeleted({ _id: req.params.id, organizationId: req.user!.organizationId }));
  if (!idea) throw ApiError.notFound('Idea not found');
  await (idea as any).softDelete(req.user!.id);
  res.json({ success: true, data: { id: req.params.id, softDeleted: true } });
});

export const restoreIdea = asyncHandler(async (req: Request, res: Response) => {
  const idea = await Idea.findOne({ _id: req.params.id, organizationId: req.user!.organizationId, isDeleted: true });
  if (!idea) throw ApiError.notFound('Deleted idea not found');
  await (idea as any).restore();
  res.json({ success: true, data: idea });
});

export const toggleVote = asyncHandler(async (req: Request, res: Response) => {
  const idea = await Idea.findOne(excludeDeleted({ _id: req.params.id, organizationId: req.user!.organizationId }));
  if (!idea) throw ApiError.notFound('Idea not found');
  const userId = req.user!.id;
  const hasVoted = idea.votes.some((v) => String(v) === userId);
  if (hasVoted) {
    idea.votes = idea.votes.filter((v) => String(v) !== userId) as any;
  } else {
    idea.votes.push(userId as any);
  }
  idea.aiScore = scoreIdea(idea) as any;
  await idea.save();
  res.json({ success: true, data: { votes: idea.votes.length, hasVoted: !hasVoted } });
});

export const addComment = asyncHandler(async (req: Request, res: Response) => {
  const idea = await Idea.findOne(excludeDeleted({ _id: req.params.id, organizationId: req.user!.organizationId }));
  if (!idea) throw ApiError.notFound('Idea not found');
  idea.comments.push({ authorId: req.user!.id, body: req.body.body } as any);
  await idea.save();

  await notifyMentions({
    text: req.body.body,
    organizationId: req.user!.organizationId,
    actorId: req.user!.id,
    actorName: req.user!.name,
    title: `${req.user!.name} mentioned you on an idea`,
    link: `/ideas/${idea._id}`,
  });

  res.status(201).json({ success: true, data: idea.comments[idea.comments.length - 1] });
});

export const addLink = asyncHandler(async (req: Request, res: Response) => {
  const idea = await Idea.findOne(excludeDeleted({ _id: req.params.id, organizationId: req.user!.organizationId }));
  if (!idea) throw ApiError.notFound('Idea not found');
  idea.links.push({ label: req.body.label, url: req.body.url, addedById: req.user!.id } as any);
  await idea.save();
  res.status(201).json({ success: true, data: idea.links[idea.links.length - 1] });
});

export const removeLink = asyncHandler(async (req: Request, res: Response) => {
  const idea = await Idea.findOne(excludeDeleted({ _id: req.params.id, organizationId: req.user!.organizationId }));
  if (!idea) throw ApiError.notFound('Idea not found');
  (idea.links as any).pull({ _id: req.params.linkId });
  await idea.save();
  res.json({ success: true, data: { id: req.params.linkId } });
});

export const addAttachment = asyncHandler(async (req: Request, res: Response) => {
  const idea = await Idea.findOne(excludeDeleted({ _id: req.params.id, organizationId: req.user!.organizationId }));
  if (!idea) throw ApiError.notFound('Idea not found');
  idea.attachments.push({ name: req.body.name, url: req.body.url, mimeType: req.body.mimeType, addedById: req.user!.id } as any);
  await idea.save();
  res.status(201).json({ success: true, data: idea.attachments[idea.attachments.length - 1] });
});

export const removeAttachment = asyncHandler(async (req: Request, res: Response) => {
  const idea = await Idea.findOne(excludeDeleted({ _id: req.params.id, organizationId: req.user!.organizationId }));
  if (!idea) throw ApiError.notFound('Idea not found');
  (idea.attachments as any).pull({ _id: req.params.attachmentId });
  await idea.save();
  res.json({ success: true, data: { id: req.params.attachmentId } });
});
