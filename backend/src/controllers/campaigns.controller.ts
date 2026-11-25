import { Request, Response } from 'express';
import { z } from 'zod';
import path from 'path';
import { Campaign, Lead } from '../models/Campaign';
import { SocialAccount } from '../models/SocialAccount';
import { User } from '../models/User';
import { asyncHandler } from '../utils/asyncHandler';
import { ApiError } from '../utils/ApiError';
import { audit } from '../services/audit.service';
import { notifyWork } from '../services/work.notify';
import { usersWithModule } from '../services/access.service';
import { loadEntity, postComment, Actor } from '../services/discussion.service';
import { verifyOrgUpload } from '../services/fileCheck';
import { excludeDeleted } from '../utils/softDeletePlugin';
import { escapeRegex } from '../utils/escapeRegex';
import { deviceLabel } from '../utils/requestContext';
import { encryptField, decryptField, last4 } from '../utils/crypto';
import { toCsv } from '../utils/csv';
import { hasModule } from '../middleware/modules';
import {
  APPROVAL_STATUSES, CHANNEL_KEYS, CHANNELS, GOAL_KINDS, GOAL_META, MAX_MEDIA, campaignInsights, channelSpec, composeText, contentHash, decisionProblems, goalProgress, postingProblems, submitProblems,
} from '../config/marketing';
import { adapterFor, SocialError, scrub } from '../services/social';
import { isPublicImage, signedMediaUrl } from '../services/social/publicMedia';

const idz = z.string().regex(/^[a-f\d]{24}$/i, 'Invalid id');
const oid = (v: unknown) => (v == null ? '' : String((v as any)._id || v));
const actorOf = (req: Request): Actor => ({ id: req.user!.id, name: req.user!.name, role: req.user!.role, organizationId: req.user!.organizationId, modules: req.user!.modules });
const fromOf = (req: Request) => ({ ip: req.ip, device: deviceLabel(String(req.headers['user-agent'] || '')) });
const isTop = (role: string) => role === 'super_admin' || role === 'ceo';

/* ------------------------------------------------------------------ who may approve */

/** CEO, COO, admin, the head of the Marketing department, or the approver named on the campaign. */
async function approverIds(orgId: string, campaign?: any): Promise<string[]> {
  const heads: any[] = await User.find({ organizationId: orgId, isActive: true, headOfDepartments: 'Marketing' }).select('_id');
  const leaders: any[] = await User.find({ organizationId: orgId, isActive: true, role: { $in: ['ceo', 'coo', 'super_admin'] } }).select('_id');
  const ids = new Set<string>([...heads, ...leaders].map((u) => String(u._id)));
  if (campaign?.approverId) ids.add(oid(campaign.approverId));
  return Array.from(ids);
}
async function mayApprove(req: Request, campaign: any): Promise<boolean> {
  if (['super_admin', 'ceo', 'coo'].includes(req.user!.role)) return true;
  if (oid(campaign.approverId) === req.user!.id) return true;
  const me: any = await User.findById(req.user!.id).select('headOfDepartments');
  return (me?.headOfDepartments || []).includes('Marketing');
}

/* ------------------------------------------------------------------ validation */

const mediaZ = z.object({ url: z.string().min(1).max(500), name: z.string().max(200).optional(), size: z.number().optional(), kind: z.enum(['image', 'banner']).default('image'), alt: z.string().max(300).optional() });
const bodyZ = z.object({
  name: z.string().trim().min(2, 'Give the campaign a name').max(200),
  type: z.enum(['content', 'event', 'social', 'newsletter', 'article', 'paid']),
  channel: z.string().max(120),
  ownerId: idz,
  startDate: z.union([z.string(), z.null()]),
  endDate: z.union([z.string(), z.null()]),
  status: z.enum(['planned', 'live', 'completed', 'cancelled']),
  budget: z.coerce.number().min(0),
  currency: z.enum(['NGN', 'USD', 'GBP', 'EUR']),
  leadsGenerated: z.coerce.number().min(0),
  performanceNotes: z.string().max(4000),
  objective: z.string().max(2000),
  audience: z.string().max(500),
  goal: z.object({ kind: z.enum(GOAL_KINDS), target: z.coerce.number().min(0), description: z.string().max(500).optional() }),
  channels: z.array(z.enum(CHANNEL_KEYS as [string, ...string[]])).max(12),
  content: z.object({ headline: z.string().max(300).optional(), body: z.string().max(20000).optional(), callToAction: z.string().max(200).optional(), linkUrl: z.string().max(500).optional(), hashtags: z.array(z.string().max(60)).max(40).optional() }),
  media: z.array(mediaZ).max(MAX_MEDIA, `At most ${MAX_MEDIA} images and banners`),
  socialManagerId: z.union([idz, z.null()]),
  approverId: z.union([idz, z.null()]),
}).partial();

function checkMedia(orgId: string, list: Array<{ url: string; name?: string; size?: number }>) {
  return list.map((m) => {
    const f = verifyOrgUpload(orgId, m.url);
    if (!isPublicImage(f.filename)) throw ApiError.badRequest(`“${m.name || f.filename}” is not a PNG, JPEG or WebP picture.`);
    return { ...m, size: f.size };
  });
}
async function assertUsers(orgId: string, ids: Array<string | null | undefined>) {
  const list = ids.filter(Boolean) as string[];
  if (!list.length) return;
  const n = await User.countDocuments({ _id: { $in: list }, organizationId: orgId, isActive: true });
  if (n !== new Set(list).size) throw ApiError.badRequest('One of the people you chose was not found.');
}
const snap = (c: any) => contentHash({ content: c.content?.toObject ? c.content.toObject() : c.content, media: (c.media || []).map((m: any) => ({ url: m.url, kind: m.kind })), channels: c.channels || [] });

function present(c: any) {
  const o = c.toObject ? c.toObject() : c;
  const current = snap(c);
  return {
    ...o,
    progress: goalProgress(o.goal, o.metrics),
    contentChanged: o.approval?.status === 'approved' && o.approval?.contentHash !== current,
    insights: campaignInsights(o),
  };
}

/* ------------------------------------------------------------------ list / export / get */

function listFilter(req: Request) {
  const q = req.query as Record<string, string>;
  const and: any[] = [{ organizationId: req.user!.organizationId }];
  if (q.q) { const rx = new RegExp(escapeRegex(q.q), 'i'); and.push({ $or: [{ name: rx }, { objective: rx }, { 'content.headline': rx }] }); }
  for (const k of ['status', 'type', 'ownerId'] as const) if (q[k]) and.push({ [k]: q[k] });
  if (q.approval) and.push({ 'approval.status': q.approval });
  if (q.goal) and.push({ 'goal.kind': q.goal });
  if (q.channel) and.push({ channels: q.channel });
  if (q.from || q.to) { const r: any = {}; if (q.from) r.$gte = new Date(q.from); if (q.to) r.$lte = new Date(`${q.to}T23:59:59.999Z`); and.push({ createdAt: r }); }
  return excludeDeleted({ $and: and });
}

export const listCampaigns = asyncHandler(async (req: Request, res: Response) => {
  const q = req.query as Record<string, string>;
  const page = Math.max(parseInt(q.page || '1', 10) || 1, 1), limit = Math.min(Math.max(parseInt(q.limit || '25', 10) || 25, 1), 100);
  const filter = listFilter(req);
  const [rows, total] = await Promise.all([
    Campaign.find(filter).select('-postings.proof -approvalHistory').populate('ownerId', 'name').sort(q.sort || '-createdAt').skip((page - 1) * limit).limit(limit),
    Campaign.countDocuments(filter),
  ]);
  res.json({ success: true, data: rows.map(present), pagination: { page, limit, total, pages: Math.ceil(total / limit) } });
});

export const exportCampaigns = asyncHandler(async (req: Request, res: Response) => {
  const rows: any[] = await Campaign.find(listFilter(req)).populate('ownerId', 'name').sort('-createdAt').limit(5000);
  const d = (x: any) => (x ? new Date(x).toISOString().slice(0, 10) : '');
  const cols = ['name', 'status', 'approval', 'goal', 'target', 'progress', 'channels', 'owner', 'start', 'end', 'budget', 'spend', 'revenue', 'reach', 'clicks', 'leads', 'hires', 'created', 'modified', 'modifiedBy'].map((k) => ({ key: k, label: k }));
  const body = toCsv(cols, rows.map((r) => {
    const g = goalProgress(r.goal, r.metrics);
    return { name: r.name, status: r.status, approval: r.approval?.status, goal: GOAL_META[r.goal?.kind as keyof typeof GOAL_META]?.label || '', target: r.goal?.target, progress: `${g.percent}%`, channels: (r.channels || []).join(' | '), owner: r.ownerId?.name, start: d(r.startDate), end: d(r.endDate), budget: r.budget, spend: r.metrics?.spend, revenue: r.metrics?.revenue, reach: r.metrics?.reach, clicks: r.metrics?.clicks, leads: r.metrics?.leads, hires: r.metrics?.hires, created: d(r.createdAt), modified: d(r.updatedAt), modifiedBy: r.updatedBy?.name };
  }));
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', 'attachment; filename="campaigns.csv"');
  res.send(body);
});

async function findCampaign(req: Request, id = req.params.id) {
  if (!/^[a-f\d]{24}$/i.test(id)) throw ApiError.notFound('Campaign not found');
  const c: any = await Campaign.findOne(excludeDeleted({ _id: id, organizationId: req.user!.organizationId }));
  if (!c) throw ApiError.notFound('Campaign not found');
  return c;
}

export const getCampaign = asyncHandler(async (req: Request, res: Response) => {
  const c = await findCampaign(req);
  await c.populate('ownerId socialManagerId approverId', 'name');
  const leads = await Lead.countDocuments(excludeDeleted({ organizationId: req.user!.organizationId, campaignId: c._id }));
  res.json({ success: true, data: { ...present(c), leadCount: leads, canApprove: await mayApprove(req, c), channelSpecs: CHANNELS.filter((x) => (c.channels || []).includes(x.key)) } });
});

/* ------------------------------------------------------------------ create / update */

export const createCampaign = asyncHandler(async (req: Request, res: Response) => {
  const d = bodyZ.parse(req.body);
  if (!d.name) throw ApiError.badRequest('Give the campaign a name');
  const orgId = req.user!.organizationId;
  await assertUsers(orgId, [d.ownerId, d.socialManagerId, d.approverId]);
  if (d.startDate && d.endDate && new Date(d.endDate) < new Date(d.startDate)) throw ApiError.badRequest('The end date cannot be before the start date');
  if (d.status && d.status !== 'planned') throw ApiError.badRequest('A new campaign starts as planned. It goes live once it is approved and posted.');
  const c: any = new Campaign({ ...d, startDate: d.startDate || undefined, endDate: d.endDate || undefined, socialManagerId: d.socialManagerId || undefined, approverId: d.approverId || undefined, media: checkMedia(orgId, d.media || []), organizationId: orgId, ownerId: d.ownerId || req.user!.id, status: 'planned' });
  if (c.approverId && oid(c.approverId) === req.user!.id && !isTop(req.user!.role)) throw ApiError.badRequest('You cannot name yourself as the approver of your own campaign.');
  await c.save();
  await audit(req, 'campaign.created', 'Campaign', String(c._id), { module: 'marketing', summary: `Campaign "${c.name}" created` });
  res.status(201).json({ success: true, data: present(c) });
});

export const updateCampaign = asyncHandler(async (req: Request, res: Response) => {
  const c = await findCampaign(req);
  const d = bodyZ.parse(req.body);
  const orgId = req.user!.organizationId;
  await assertUsers(orgId, [d.ownerId, d.socialManagerId, d.approverId]);
  const start = d.startDate === undefined ? c.startDate : d.startDate; const end = d.endDate === undefined ? c.endDate : d.endDate;
  if (start && end && new Date(end) < new Date(start)) throw ApiError.badRequest('The end date cannot be before the start date');
  if (d.status && d.status !== c.status) {
    if (d.status === 'live' && c.approval?.status !== 'approved') throw ApiError.badRequest('A campaign can only go live after it is approved.');
    if (d.status === 'live' && !(c.postings || []).some((p: any) => p.status === 'posted')) throw ApiError.badRequest('A campaign goes live when its first post is published. Hand it to the social media manager.');
  }
  if (d.approverId && d.approverId === req.user!.id && !isTop(req.user!.role)) throw ApiError.badRequest('You cannot name yourself as the approver of your own campaign.');
  const { media, ...rest } = d as any;
  for (const [k, v] of Object.entries(rest)) if (v !== undefined) c[k] = v === null ? undefined : v;
  if (media) c.media = checkMedia(orgId, media);

  // The approval is for exactly what the approver saw. Change it and the approval no longer counts.
  const now = snap(c);
  const had = c.approval?.status;
  let reset = false;
  if ((had === 'approved' || had === 'pending') && c.approval.contentHash !== now) {
    reset = true;
    c.approval.status = 'draft'; c.approval.contentHash = undefined; c.approval.decidedAt = undefined; c.approval.decidedById = undefined; c.approval.decidedByName = undefined; c.approval.selfApproved = false;
    c.approvalHistory.push({ status: 'draft', byId: req.user!.id as any, byName: req.user!.name, note: `Content changed after it was ${had === 'approved' ? 'approved' : 'sent for approval'}. It needs approving again.` });
    for (const p of c.postings) if (p.status === 'sent_to_manager') { p.status = 'cancelled'; p.note = 'Cancelled because the content changed after approval.'; }
  }
  await c.save();
  await audit(req, 'campaign.updated', 'Campaign', String(c._id), { module: 'marketing', summary: `Campaign "${c.name}" updated${reset ? ' — approval reset' : ''}`, meta: { fields: Object.keys(d) } });
  res.json({ success: true, data: present(c), approvalReset: reset });
});

export const deleteCampaign = asyncHandler(async (req: Request, res: Response) => {
  const c = await findCampaign(req);
  if ((c.postings || []).some((p: any) => p.status === 'posted')) throw ApiError.conflict('This campaign has already been posted. Mark it cancelled or completed instead of deleting it.');
  await c.softDelete(req.user!.id);
  await audit(req, 'campaign.deleted', 'Campaign', String(c._id), { module: 'marketing', severity: 'medium', summary: `Campaign "${c.name}" deleted` });
  res.json({ success: true, data: { ok: true } });
});

/* ------------------------------------------------------------------ approval */

async function statusComment(req: Request, c: any, from: string, to: string, body: string, awareness: string[] = []) {
  try {
    const entity = await loadEntity(actorOf(req), 'campaign', String(c._id));
    await postComment({ actor: actorOf(req), entity, kind: 'status', status: { from, to }, body, awareness, notify: 'mentioned', from: fromOf(req) });
  } catch { /* the conversation is a bonus; never block the approval on it */ }
}

export const submitForApproval = asyncHandler(async (req: Request, res: Response) => {
  const c = await findCampaign(req);
  if (c.approval?.status === 'pending') throw ApiError.conflict('This campaign is already waiting for approval.');
  const problems = submitProblems({ name: c.name, goal: c.goal, channels: c.channels, content: c.content?.toObject?.() ?? c.content, media: c.media, status: c.status });
  if (problems.length) throw new ApiError(422, problems[0], { problems });
  const from = c.approval?.status || 'draft';
  c.approval.status = 'pending'; c.approval.submittedAt = new Date(); c.approval.submittedById = req.user!.id as any; c.approval.submittedByName = req.user!.name;
  c.approval.contentHash = snap(c); c.approval.note = undefined; c.approval.evidence = [] as any; c.approval.decidedAt = undefined; c.approval.decidedById = undefined; c.approval.decidedByName = undefined; c.approval.selfApproved = false;
  c.approvalHistory.push({ status: 'pending', byId: req.user!.id as any, byName: req.user!.name, note: String(req.body?.note || '').slice(0, 500) || 'Sent for approval' });
  await c.save();
  const who = (await approverIds(req.user!.organizationId, c)).filter((x) => x !== req.user!.id);
  await notifyWork({ organizationId: req.user!.organizationId, userIds: who, title: `Campaign awaiting your approval: ${c.name}`, summary: `${req.user!.name} sent "${c.name}" for approval. Nothing is posted until you approve it.`, rows: [['Goal', GOAL_META[c.goal.kind as keyof typeof GOAL_META]?.label], ['Channels', (c.channels || []).join(', ')]], note: req.body?.note, link: `/marketing?campaign=${c._id}`, cta: 'Review campaign', type: 'marketing', severity: 'warning', entity: { type: 'campaign', id: String(c._id) } });
  await audit(req, 'campaign.submitted', 'Campaign', String(c._id), { module: 'marketing', summary: `"${c.name}" sent for approval` });
  await statusComment(req, c, from, 'pending', req.body?.note ? String(req.body.note) : 'Sent for approval.', who.slice(0, 8));
  res.json({ success: true, data: present(c), approvers: who.length });
});

const evidenceZ = z.array(z.object({ kind: z.enum(['file', 'link']).default('file'), url: z.string().min(1).max(500), name: z.string().max(200).optional() })).max(10).default([]);
export const decideApproval = asyncHandler(async (req: Request, res: Response) => {
  const c = await findCampaign(req);
  const b = z.object({ decision: z.enum(['approve', 'reject', 'changes']), note: z.string().max(2000).default(''), evidence: evidenceZ }).parse(req.body);
  if (!(await mayApprove(req, c))) throw ApiError.forbidden('Only the CEO, the COO, the head of Marketing or the approver named on the campaign can decide this.');
  const evidence = b.evidence.map((e) => {
    if (e.kind === 'link') { if (!/^https?:\/\/\S+$/i.test(e.url)) throw ApiError.badRequest('Evidence links must start with http:// or https://'); return { kind: 'link' as const, url: e.url, name: e.name || e.url.slice(0, 80) }; }
    const f = verifyOrgUpload(req.user!.organizationId, e.url);
    return { kind: 'file' as const, url: e.url, name: e.name || f.filename, size: f.size };
  });
  const isSubmitter = oid(c.approval?.submittedById) === req.user!.id;
  const problems = decisionProblems({ decision: b.decision, note: b.note, evidenceCount: evidence.length, isSubmitter, isTopLeader: isTop(req.user!.role), status: c.approval?.status || 'draft' });
  if (problems.length) throw new ApiError(problems[0].startsWith('You cannot') ? 403 : 422, problems[0], { problems });
  if (b.decision === 'approve' && c.approval.contentHash !== snap(c)) throw ApiError.conflict('The content changed after it was sent. Ask for it to be sent again.');
  const from = c.approval.status;
  const to = b.decision === 'approve' ? 'approved' : b.decision === 'reject' ? 'rejected' : 'changes_requested';
  c.approval.status = to; c.approval.decidedAt = new Date(); c.approval.decidedById = req.user!.id as any; c.approval.decidedByName = req.user!.name; c.approval.note = b.note.trim();
  c.approval.evidence = (b.decision === 'approve' ? evidence : c.approval.evidence) as any;
  c.approval.selfApproved = b.decision === 'approve' && isSubmitter;
  c.approvalHistory.push({ status: to, byId: req.user!.id as any, byName: req.user!.name, note: b.note.trim() });
  await c.save();
  const people = Array.from(new Set([oid(c.approval.submittedById), oid(c.ownerId)])).filter((x) => x && x !== req.user!.id);
  const verb = b.decision === 'approve' ? 'approved' : b.decision === 'reject' ? 'rejected' : 'sent back for changes';
  await notifyWork({ organizationId: req.user!.organizationId, userIds: people, title: `Campaign ${verb}: ${c.name}`, summary: `${req.user!.name} ${verb} "${c.name}".`, note: b.note, noteTone: b.decision === 'approve' ? 'info' : 'warn', link: `/marketing?campaign=${c._id}`, cta: 'Open campaign', type: 'marketing', severity: b.decision === 'approve' ? 'info' : 'warning', entity: { type: 'campaign', id: String(c._id) } });
  await audit(req, `campaign.${b.decision === 'approve' ? 'approved' : b.decision === 'reject' ? 'rejected' : 'changes_requested'}`, 'Campaign', String(c._id), { module: 'marketing', severity: 'medium', summary: `"${c.name}" ${verb}${c.approval.selfApproved ? ' (self-approved by leadership)' : ''}`, meta: { evidence: evidence.length } });
  await statusComment(req, c, from, to, b.note.trim(), people);
  res.json({ success: true, data: present(c) });
});

/* ------------------------------------------------------------------ hand over to the social media manager */

export const sendToManager = asyncHandler(async (req: Request, res: Response) => {
  const c = await findCampaign(req);
  const b = z.object({ managerId: idz.optional(), channels: z.array(z.string()).optional(), accounts: z.record(z.string(), idz).optional(), scheduledFor: z.string().optional(), instructions: z.string().max(1000).optional() }).parse(req.body || {});
  const problems = postingProblems(c, snap(c));
  if (problems.length) throw new ApiError(422, problems[0], { problems });
  const orgId = req.user!.organizationId;
  const wanted = (b.channels?.length ? b.channels : c.channels) as string[];
  const bad = wanted.filter((k) => !(c.channels || []).includes(k));
  if (bad.length) throw ApiError.badRequest(`These channels are not part of the campaign: ${bad.join(', ')}`);
  if (b.managerId) await assertUsers(orgId, [b.managerId]);
  const accounts: any[] = await SocialAccount.find(excludeDeleted({ organizationId: orgId, status: { $ne: 'inactive' } }));
  const added: any[] = [];
  const skipped: string[] = [];
  for (const channel of wanted) {
    const live = (c.postings || []).find((p: any) => p.channel === channel && ['sent_to_manager', 'posted'].includes(p.status));
    if (live) { skipped.push(`${channelSpec(channel)?.label || channel}: ${live.status === 'posted' ? 'already posted' : 'already with the manager'}`); continue; }
    const mine = accounts.filter((a) => a.platform === channel);
    const chosen = b.accounts?.[channel] ? mine.find((a) => String(a._id) === b.accounts![channel]) : mine[0];
    if (b.accounts?.[channel] && !chosen) throw ApiError.badRequest(`That ${channelSpec(channel)?.label} account was not found.`);
    const managerId = oid(chosen?.managerId) || b.managerId || oid(c.socialManagerId);
    if (!managerId) throw new ApiError(422, `Choose the social media manager for ${channelSpec(channel)?.label || channel}.`, { channel });
    c.postings.push({ channel, accountId: chosen?._id, accountLabel: chosen ? `${chosen.label}${chosen.handle ? ` (${chosen.handle})` : ''}` : undefined, managerId, status: 'sent_to_manager', scheduledFor: b.scheduledFor ? new Date(b.scheduledFor) : undefined, sentAt: new Date(), sentById: req.user!.id, sentByName: req.user!.name, instructions: b.instructions } as any);
    added.push(c.postings[c.postings.length - 1]);
  }
  if (!added.length) throw ApiError.conflict(skipped.length ? skipped.join('. ') : 'Nothing to hand over.');
  await c.save();
  const byManager = new Map<string, string[]>();
  for (const p of added) byManager.set(oid(p.managerId), [...(byManager.get(oid(p.managerId)) || []), channelSpec(p.channel)?.label || p.channel]);
  for (const [mid, labels] of byManager) {
    await notifyWork({ organizationId: orgId, userIds: [mid], title: `Approved campaign to post: ${c.name}`, summary: `${req.user!.name} handed you "${c.name}" to post on ${labels.join(', ')}. It has been approved${c.approval.decidedByName ? ` by ${c.approval.decidedByName}` : ''}.`, note: b.instructions, link: '/social-queue', cta: 'Open my posting queue', type: 'marketing', severity: 'warning', entity: { type: 'campaign', id: String(c._id) } });
  }
  await audit(req, 'campaign.sent_to_manager', 'Campaign', String(c._id), { module: 'marketing', summary: `"${c.name}" handed to the social media manager for ${added.map((p) => p.channel).join(', ')}` });
  res.json({ success: true, data: present(c), skipped });
});

/* ------------------------------------------------------------------ posting (manager's queue) */

async function loadPosting(req: Request) {
  const c = await findCampaign(req, req.params.campaignId || req.params.id);
  const p: any = c.postings.id(req.params.postingId);
  if (!p) throw ApiError.notFound('That post was not found');
  const mine = oid(p.managerId) === req.user!.id;
  const staff = hasModule(req as any, 'marketing') || req.user!.role === 'super_admin';
  if (!mine && !staff) throw ApiError.notFound('That post was not found');
  return { c, p };
}
const owners = (c: any, p: any) => Array.from(new Set([oid(c.ownerId), oid(p.sentById)])).filter((x) => x && x !== undefined);

function guardPostable(c: any, p: any) {
  if (!['sent_to_manager', 'failed'].includes(p.status)) throw ApiError.conflict(`This post is already ${p.status.replace(/_/g, ' ')}.`);
  const problems = postingProblems(c, snap(c));
  if (problems.length) throw new ApiError(422, problems[0], { problems });
  const text = composeText(c.content, p.channel);
  const spec = channelSpec(p.channel);
  if (spec && text.length > spec.maxChars) throw ApiError.badRequest(`The post is ${text.length} characters; ${spec.label} allows ${spec.maxChars}.`);
}

function afterPosted(c: any) {
  if (c.status === 'planned') c.status = 'live';
  if (!c.startDate) c.startDate = new Date();
}

export const publishPosting = asyncHandler(async (req: Request, res: Response) => {
  const { c, p } = await loadPosting(req);
  guardPostable(c, p);
  const orgId = req.user!.organizationId;
  const adapter = adapterFor(p.channel);
  if (!adapter) throw ApiError.badRequest(`${channelSpec(p.channel)?.label || p.channel} is posted by hand. Post it, then use “Mark as posted”.`);
  const account: any = p.accountId ? await SocialAccount.findOne(excludeDeleted({ _id: p.accountId, organizationId: orgId })).select('+tokenEnc') : null;
  if (!account || account.mode !== 'api' || !account.tokenEnc) throw ApiError.badRequest('This account is not connected for automatic posting. Post it by hand, then use “Mark as posted”.');
  const imageUrls = (c.media || []).map((m: any) => signedMediaUrl(m.url)).filter(Boolean) as string[];
  const input = { externalId: account.externalId || '', text: composeText(c.content, p.channel), link: c.content?.linkUrl || undefined, imageUrls };
  const why = adapter.cannotPublish(input);
  if (why) throw ApiError.badRequest(`${why} Post it by hand, then use “Mark as posted”.`);
  const token = decryptField(account.tokenEnc) || '';
  try {
    const r = await adapter.publish({ ...input, token });
    p.status = 'posted'; p.via = 'api'; p.postedAt = new Date(); p.postedByName = req.user!.name; p.externalId = r.externalId; p.postUrl = r.url; p.error = undefined;
    account.lastUsedAt = new Date(); account.lastError = undefined; account.status = 'active'; await account.save();
    afterPosted(c);
    await c.save();
    await audit(req, 'campaign.posted', 'Campaign', String(c._id), { module: 'marketing', severity: 'medium', summary: `"${c.name}" posted on ${p.channel} by the app`, meta: { externalId: r.externalId } });
    await notifyWork({ organizationId: orgId, userIds: owners(c, p).filter((x) => x !== req.user!.id), title: `Posted: ${c.name} on ${channelSpec(p.channel)?.label}`, summary: `${req.user!.name} published "${c.name}" on ${channelSpec(p.channel)?.label}.`, link: `/marketing?campaign=${c._id}`, type: 'marketing', entity: { type: 'campaign', id: String(c._id) } });
    res.json({ success: true, data: present(c) });
  } catch (e: any) {
    const msg = e instanceof SocialError ? e.message : scrub(e?.message || 'The post failed', token);
    p.status = 'failed'; p.error = msg;
    if (e instanceof SocialError && (e.status === 401 || e.status === 403)) { account.status = 'needs_attention'; account.lastError = msg; await account.save(); }
    await c.save();
    await audit(req, 'campaign.post_failed', 'Campaign', String(c._id), { module: 'marketing', severity: 'medium', status: 'failed', summary: `"${c.name}" failed on ${p.channel}: ${msg}` });
    throw new ApiError(502, `${msg} You can post it by hand and use “Mark as posted”.`);
  }
});

export const markPosted = asyncHandler(async (req: Request, res: Response) => {
  const { c, p } = await loadPosting(req);
  guardPostable(c, p);
  const b = z.object({ postUrl: z.string().max(500).optional(), proof: z.object({ url: z.string().min(1).max(500), name: z.string().max(200).optional() }).optional(), note: z.string().max(1000).optional() }).parse(req.body || {});
  if (!b.postUrl && !b.proof) throw ApiError.badRequest('Paste the link to the live post, or attach a screenshot as proof.');
  if (b.postUrl && !/^https?:\/\/\S+$/i.test(b.postUrl)) throw ApiError.badRequest('The post link must start with http:// or https://');
  if (b.proof) { const f = verifyOrgUpload(req.user!.organizationId, b.proof.url); p.proof = { url: b.proof.url, name: b.proof.name || f.filename, size: f.size }; }
  p.status = 'posted'; p.via = 'manual'; p.postedAt = new Date(); p.postedByName = req.user!.name; p.postUrl = b.postUrl; p.note = b.note; p.error = undefined;
  afterPosted(c);
  await c.save();
  await audit(req, 'campaign.posted', 'Campaign', String(c._id), { module: 'marketing', severity: 'medium', summary: `"${c.name}" posted on ${p.channel} by ${req.user!.name}` });
  await notifyWork({ organizationId: req.user!.organizationId, userIds: owners(c, p).filter((x) => x !== req.user!.id), title: `Posted: ${c.name} on ${channelSpec(p.channel)?.label}`, summary: `${req.user!.name} posted "${c.name}" on ${channelSpec(p.channel)?.label}.`, link: `/marketing?campaign=${c._id}`, type: 'marketing', entity: { type: 'campaign', id: String(c._id) } });
  res.json({ success: true, data: present(c) });
});

export const returnPosting = asyncHandler(async (req: Request, res: Response) => {
  const { c, p } = await loadPosting(req);
  if (!['sent_to_manager', 'failed'].includes(p.status)) throw ApiError.conflict('Only a post that is waiting can be sent back.');
  const note = String(req.body?.note || '').trim();
  if (note.length < 3) throw ApiError.badRequest('Say why you are sending it back.');
  p.status = 'returned'; p.note = note;
  await c.save();
  await audit(req, 'campaign.post_returned', 'Campaign', String(c._id), { module: 'marketing', summary: `${req.user!.name} sent back the ${p.channel} post of "${c.name}"` });
  await notifyWork({ organizationId: req.user!.organizationId, userIds: owners(c, p).filter((x) => x !== req.user!.id), title: `Post sent back: ${c.name}`, summary: `${req.user!.name} could not post "${c.name}" on ${channelSpec(p.channel)?.label}.`, note, noteTone: 'warn', link: `/marketing?campaign=${c._id}`, type: 'marketing', severity: 'warning', entity: { type: 'campaign', id: String(c._id) } });
  res.json({ success: true, data: present(c) });
});

/** The social media manager's to-do list: approved posts waiting for them (everyone with Marketing can look at the whole queue). */
export const myQueue = asyncHandler(async (req: Request, res: Response) => {
  const all = req.query.all === '1' && (hasModule(req as any, 'marketing') || req.user!.role === 'super_admin');
  const rows: any[] = await Campaign.find(excludeDeleted({ organizationId: req.user!.organizationId, 'postings.status': { $exists: true } })).select('name content media channels approval postings ownerId goal status').sort('-updatedAt').limit(300);
  const out: any[] = [];
  const hash = (c: any) => snap(c);
  for (const c of rows) {
    for (const p of c.postings) {
      if (!all && oid(p.managerId) !== req.user!.id) continue;
      if (!all && !['sent_to_manager', 'failed', 'returned'].includes(p.status)) continue;
      const account = p.accountId ? await SocialAccount.findOne({ _id: p.accountId }).select('mode status externalId label tokenLast4').lean() : null;
      const spec = channelSpec(p.channel);
      out.push({
        campaignId: String(c._id), campaignName: c.name, goal: c.goal, approval: { status: c.approval?.status, decidedByName: c.approval?.decidedByName, decidedAt: c.approval?.decidedAt, stillValid: c.approval?.status === 'approved' && c.approval?.contentHash === hash(c) },
        posting: p.toObject(), channel: p.channel, channelLabel: spec?.label || p.channel, text: composeText(c.content, p.channel), link: c.content?.linkUrl, media: (c.media || []).map((m: any) => ({ url: m.url, name: m.name, kind: m.kind, alt: m.alt })),
        canPublishViaApi: !!(adapterFor(p.channel) && account && (account as any).mode === 'api' && (account as any).tokenLast4), accountStatus: (account as any)?.status,
      });
    }
  }
  res.json({ success: true, data: out });
});

/* ------------------------------------------------------------------ results */

export const recordMetrics = asyncHandler(async (req: Request, res: Response) => {
  const c = await findCampaign(req);
  const n = z.coerce.number().min(0).optional();
  const b = z.object({ reach: n, clicks: n, leads: n, conversions: n, spend: n, revenue: n, hires: n, note: z.string().max(1000).optional() }).parse(req.body || {});
  const { note, ...vals } = b;
  for (const [k, v] of Object.entries(vals)) if (v !== undefined) (c.metrics as any)[k] = v;
  c.metrics.updatedAt = new Date(); c.metrics.updatedByName = req.user!.name;
  if (vals.leads !== undefined) c.leadsGenerated = vals.leads;
  if (note) c.performanceNotes = `${c.performanceNotes ? `${c.performanceNotes}\n` : ''}${new Date().toISOString().slice(0, 10)} · ${req.user!.name}: ${note}`.slice(-4000);
  await c.save();
  await audit(req, 'campaign.results_updated', 'Campaign', String(c._id), { module: 'marketing', summary: `Results updated on "${c.name}"`, meta: vals });
  res.json({ success: true, data: present(c) });
});

/* ------------------------------------------------------------------ overview */

export const marketingOverview = asyncHandler(async (req: Request, res: Response) => {
  const orgId = req.user!.organizationId;
  const rows: any[] = await Campaign.find(excludeDeleted({ organizationId: orgId })).select('name status goal metrics approval channels postings budget currency ownerId createdAt').limit(2000);
  const approvals: Record<string, number> = Object.fromEntries(APPROVAL_STATUSES.map((s) => [s, 0]));
  const byChannel: Record<string, number> = {};
  const goals: Record<string, { kind: string; label: string; campaigns: number; target: number; current: number }> = {};
  let spend = 0, revenue = 0, reach = 0, clicks = 0, leads = 0, hires = 0;
  for (const c of rows) {
    approvals[c.approval?.status || 'draft'] = (approvals[c.approval?.status || 'draft'] || 0) + 1;
    for (const p of c.postings) if (p.status === 'posted') byChannel[p.channel] = (byChannel[p.channel] || 0) + 1;
    const g = goalProgress(c.goal, c.metrics);
    const k = c.goal?.kind || 'other';
    const e = (goals[k] ||= { kind: k, label: GOAL_META[k as keyof typeof GOAL_META]?.label || k, campaigns: 0, target: 0, current: 0 });
    e.campaigns += 1; e.target += g.target; e.current += g.current;
    spend += c.metrics?.spend || 0; revenue += c.metrics?.revenue || 0; reach += c.metrics?.reach || 0; clicks += c.metrics?.clicks || 0; leads += c.metrics?.leads || 0; hires += c.metrics?.hires || 0;
  }
  const mine = await mayApprove(req, { approverId: null });
  const waiting = rows.filter((c) => c.approval?.status === 'pending').map((c) => ({ _id: String(c._id), name: c.name, submittedByName: c.approval.submittedByName, submittedAt: c.approval.submittedAt }));
  const open = rows.reduce((n, c) => n + c.postings.filter((p: any) => ['sent_to_manager', 'failed'].includes(p.status)).length, 0);
  res.json({ success: true, data: { total: rows.length, live: rows.filter((c) => c.status === 'live').length, approvals, awaitingApproval: waiting, canApprove: mine, postsWaiting: open, postedByChannel: byChannel, goals: Object.values(goals), totals: { spend, revenue, reach, clicks, leads, hires, roi: spend > 0 ? Number((revenue / spend).toFixed(2)) : null } } });
});

/* ------------------------------------------------------------------ social accounts */

const accountZ = z.object({
  platform: z.enum(CHANNEL_KEYS as [string, ...string[]]),
  label: z.string().trim().min(2, 'Give the account a name').max(120),
  handle: z.string().trim().max(120).optional(),
  profileUrl: z.string().trim().max(300).optional(),
  externalId: z.string().trim().max(120).optional(),
  managerId: z.union([idz, z.null()]).optional(),
  status: z.enum(['active', 'inactive']).optional(),
  token: z.string().max(4000).optional(),
});
const publicAccount = (a: any) => { const o = a.toObject ? a.toObject() : a; delete o.tokenEnc; return { ...o, hasToken: !!o.tokenLast4, canAutoPost: !!(adapterFor(o.platform) && o.mode === 'api') }; };

export const listAccounts = asyncHandler(async (req: Request, res: Response) => {
  const rows = await SocialAccount.find(excludeDeleted({ organizationId: req.user!.organizationId })).populate('managerId', 'name').sort('platform label');
  res.json({ success: true, data: rows.map(publicAccount), platforms: CHANNELS.map((c) => ({ key: c.key, label: c.label, api: c.api, social: c.social })) });
});

function applyToken(a: any, token: string | undefined) {
  if (token === undefined) return;
  if (token === '') { a.tokenEnc = undefined; a.tokenLast4 = undefined; a.tokenSetAt = undefined; a.mode = 'manual'; return; }
  a.tokenEnc = encryptField(token); a.tokenLast4 = last4(token); a.tokenSetAt = new Date(); a.lastError = undefined; if (a.status === 'needs_attention') a.status = 'active';
  a.mode = adapterFor(a.platform) && a.externalId ? 'api' : 'manual';
}

export const createAccount = asyncHandler(async (req: Request, res: Response) => {
  const d = accountZ.parse(req.body);
  await assertUsers(req.user!.organizationId, [d.managerId]);
  const { token, ...rest } = d;
  const a: any = new SocialAccount({ ...rest, managerId: d.managerId || undefined, organizationId: req.user!.organizationId });
  applyToken(a, token);
  await a.save();
  await audit(req, 'social_account.created', 'SocialAccount', String(a._id), { module: 'marketing', severity: 'medium', summary: `${a.platform} account "${a.label}" added${token ? ' with an access token' : ''}` });
  res.status(201).json({ success: true, data: publicAccount(a) });
});

export const updateAccount = asyncHandler(async (req: Request, res: Response) => {
  const a: any = await SocialAccount.findOne(excludeDeleted({ _id: req.params.id, organizationId: req.user!.organizationId })).select('+tokenEnc');
  if (!a) throw ApiError.notFound('Account not found');
  const d = accountZ.partial().parse(req.body);
  await assertUsers(req.user!.organizationId, [d.managerId]);
  const { token, ...rest } = d;
  for (const [k, v] of Object.entries(rest)) if (v !== undefined) a[k] = v === null ? undefined : v;
  if (token !== undefined) applyToken(a, token);
  else if (a.tokenLast4) a.mode = adapterFor(a.platform) && a.externalId ? 'api' : 'manual';
  await a.save();
  await audit(req, 'social_account.updated', 'SocialAccount', String(a._id), { module: 'marketing', severity: token !== undefined ? 'high' : 'low', summary: `${a.platform} account "${a.label}" updated${token !== undefined ? (token ? ' · new access token' : ' · token removed') : ''}` });
  res.json({ success: true, data: publicAccount(a) });
});

export const deleteAccount = asyncHandler(async (req: Request, res: Response) => {
  const a: any = await SocialAccount.findOne(excludeDeleted({ _id: req.params.id, organizationId: req.user!.organizationId }));
  if (!a) throw ApiError.notFound('Account not found');
  await a.softDelete(req.user!.id);
  await audit(req, 'social_account.deleted', 'SocialAccount', String(a._id), { module: 'marketing', severity: 'medium', summary: `${a.platform} account "${a.label}" removed` });
  res.json({ success: true, data: { ok: true } });
});

/* ------------------------------------------------------------------ the picture links for Facebook / Instagram */

export const servePublicMedia = (storageRoot: string) => (req: Request, res: Response) => {
  const { verifyMediaSignature } = require('../services/social/publicMedia');
  const fs = require('fs');
  const { org, file } = req.params as { org: string; file: string };
  const ok = /^[a-f\d]{24}$/i.test(org) && /^[\w.-]+$/.test(file) && !file.includes('..') && isPublicImage(file) && verifyMediaSignature(org, file, Number(req.query.exp), String(req.query.sig || ''));
  const full = path.join(storageRoot, org, file);
  if (!ok || !fs.existsSync(full)) { res.status(404).end(); return; }
  const type = { '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp' }[path.extname(file).toLowerCase()] || 'application/octet-stream';
  res.setHeader('Content-Type', type);
  res.setHeader('Cache-Control', 'private, max-age=600');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  fs.createReadStream(full).pipe(res);
};
