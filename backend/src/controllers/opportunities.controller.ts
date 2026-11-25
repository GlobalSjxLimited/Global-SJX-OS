import { stripProtected } from '../middleware/security';
import { Request, Response } from 'express';
import { z } from 'zod';
import { asyncHandler } from '../utils/asyncHandler';
import { ApiError } from '../utils/ApiError';
import { Opportunity } from '../models/Opportunity';
import { Client } from '../models/Client';
import { Project } from '../models/Project';
import { User } from '../models/User';
import { Task } from '../models/Task';
import { EntityDocument } from '../models/EntityDocument';
import { DEFAULT_PROBABILITY, LOST_REASONS, OPEN_STAGES, PIPELINE_STAGES, isClosedStage, stageProblems } from '../config/pipeline';
import { excludeDeleted } from '../utils/softDeletePlugin';
import { escapeRegex } from '../utils/escapeRegex';
import { audit } from '../services/audit.service';
import { buildInsights } from '../services/opportunityInsights.service';
import { loadEntity, postComment } from '../services/discussion.service';
import { notifyWork } from '../services/work.notify';
import { deviceLabel } from '../utils/requestContext';
import { oid } from '../services/work.access';

const idz = z.string().regex(/^[a-f\d]{24}$/i);
const actorOf = (req: Request) => ({ id: req.user!.id, name: req.user!.name, role: req.user!.role, organizationId: req.user!.organizationId, modules: req.user!.modules });
const fromOf = (req: Request) => ({ ip: req.ip, device: deviceLabel(String(req.headers['user-agent'] || '')) });
const LEADERS = ['super_admin', 'ceo', 'coo'];

function listFilter(req: Request) {
  const q = req.query as Record<string, string>;
  const f: Record<string, unknown> = { organizationId: req.user!.organizationId };
  for (const k of ['salespersonId', 'clientId', 'stage', 'source', 'sourceProjectId']) if (q[k]) f[k] = q[k];
  if (q.open === 'true') f.stage = { $in: OPEN_STAGES };
  if (q.q) f.$or = [{ title: { $regex: escapeRegex(q.q), $options: 'i' } }, { prospectName: { $regex: escapeRegex(q.q), $options: 'i' } }, { 'contacts.name': { $regex: escapeRegex(q.q), $options: 'i' } }];
  if (q.createdFrom || q.createdTo) f.createdAt = { ...(q.createdFrom ? { $gte: new Date(q.createdFrom) } : {}), ...(q.createdTo ? { $lte: new Date(`${q.createdTo}T23:59:59.999Z`) } : {}) };
  if (q.minValue || q.maxValue) f.value = { ...(q.minValue ? { $gte: Number(q.minValue) } : {}), ...(q.maxValue ? { $lte: Number(q.maxValue) } : {}) };
  return excludeDeleted(f);
}

export const listOpportunities = asyncHandler(async (req: Request, res: Response) => {
  const opportunities = await Opportunity.find(listFilter(req)).populate('clientId', 'name').populate('salespersonId', 'name avatarUrl').sort('-createdAt').limit(2000);
  res.json({ success: true, data: opportunities });
});

export const pipelineBoard = asyncHandler(async (req: Request, res: Response) => {
  const opportunities = await Opportunity.find(listFilter(req)).populate('clientId', 'name').populate('salespersonId', 'name avatarUrl').limit(2000);
  const board = Object.fromEntries(PIPELINE_STAGES.map((stage) => [stage, opportunities.filter((o) => o.stage === stage)]));
  res.json({ success: true, data: board });
});

export const pipelineMeta = asyncHandler(async (_req: Request, res: Response) => {
  res.json({ success: true, data: { stages: PIPELINE_STAGES, openStages: OPEN_STAGES, lostReasons: LOST_REASONS, defaultProbability: DEFAULT_PROBABILITY } });
});

export const getOpportunity = asyncHandler(async (req: Request, res: Response) => {
  const opp = await Opportunity.findOne(excludeDeleted({ _id: req.params.id, organizationId: req.user!.organizationId }))
    .populate('clientId')
    .populate('sourceProjectId', 'name status')
    .populate('salespersonId', 'name avatarUrl email');
  if (!opp) throw ApiError.notFound('Opportunity not found');
  const documentCount = await EntityDocument.countDocuments(excludeDeleted({ organizationId: req.user!.organizationId, entityType: 'opportunity', entityId: opp._id, kind: { $in: ['contract', 'signed', 'proposal'] } }));
  res.json({ success: true, data: { ...opp.toObject(), documentCount } });
});

const contactZ = z.object({ name: z.string().trim().min(1, 'Contact name is required').max(120), title: z.string().trim().max(120).optional(), email: z.string().trim().email('Enter a valid e-mail').max(200).optional().or(z.literal('')), phone: z.string().trim().max(40).optional(), role: z.enum(['decision_maker', 'influencer', 'champion', 'technical', 'finance', 'other']).default('other'), isPrimary: z.boolean().optional() });
const createZ = z.object({
  title: z.string().trim().min(2, 'Opportunity title is required').max(250), clientId: idz.optional().or(z.literal('')), prospectName: z.string().trim().max(200).optional(), value: z.coerce.number().min(0).default(0), currency: z.string().max(5).optional(),
  probability: z.coerce.number().min(0).max(100).optional(), stage: z.enum(PIPELINE_STAGES).default('Lead'), salespersonId: idz.optional(), source: z.enum(['manual', 'project', 'campaign', 'referral', 'event', 'inbound', 'other']).default('manual'),
  startDate: z.string().optional().or(z.literal('')), expectedCloseDate: z.string().optional().or(z.literal('')), nextAction: z.string().max(300).optional(), nextActionDate: z.string().optional().or(z.literal('')),
  productsServices: z.array(z.string().max(100)).max(30).optional(), competitors: z.array(z.string().max(100)).max(20).optional(), contacts: z.array(contactZ).max(30).optional(), sourceProjectId: idz.optional().or(z.literal('')),
  stageComment: z.string().trim().max(2000).optional(),
});
const dateOrUndef = (v?: string) => (v ? new Date(v) : undefined);

async function assertClientOrProspect(orgId: string, clientId?: string) {
  if (clientId && !(await Client.exists(excludeDeleted({ _id: clientId, organizationId: orgId })))) throw ApiError.badRequest('That client was not found');
}

export const createOpportunity = asyncHandler(async (req: Request, res: Response) => {
  const d = createZ.parse(req.body);
  const orgId = req.user!.organizationId;
  await assertClientOrProspect(orgId, d.clientId || undefined);
  if (!d.clientId && !d.prospectName) throw ApiError.badRequest('Pick a client, or type the prospect’s name.');
  if (isClosedStage(d.stage)) throw ApiError.badRequest('Create it open, then move it to closed with the evidence and a comment.');
  const sp = d.salespersonId || req.user!.id;
  if (!(await User.exists({ _id: sp, organizationId: orgId, isActive: true }))) throw ApiError.badRequest('That salesperson was not found');
  const contacts = (d.contacts || []).map((c, i) => ({ ...c, email: c.email || undefined, isPrimary: c.isPrimary ?? i === 0 }));
  const opp = await Opportunity.create({
    organizationId: orgId, title: d.title, clientId: d.clientId || undefined, prospectName: d.prospectName, sourceProjectId: d.sourceProjectId || undefined, source: d.source, stage: d.stage, value: d.value, currency: d.currency || 'NGN',
    probability: d.probability ?? DEFAULT_PROBABILITY[d.stage], startDate: dateOrUndef(d.startDate), expectedCloseDate: dateOrUndef(d.expectedCloseDate), salespersonId: sp, contacts, productsServices: d.productsServices, competitors: d.competitors,
    nextAction: d.nextAction, nextActionDate: dateOrUndef(d.nextActionDate),
    stageHistory: [{ stage: d.stage, from: '', changedAt: new Date(), comment: d.stageComment || 'Opportunity created', byId: req.user!.id, byName: req.user!.name, ...fromOf(req) }],
  } as any);
  await audit(req, 'opportunity.created', 'Opportunity', String(opp._id), { module: 'sales', summary: `Created opportunity "${opp.title}"` });
  res.status(201).json({ success: true, data: opp });
});

/** Raise an opportunity from a project (follow-on work, upsell, renewal). Open to the project's own team as well as sales. */
export const createFromProject = asyncHandler(async (req: Request, res: Response) => {
  const orgId = req.user!.organizationId;
  const b = z.object({ title: z.string().trim().min(2).max(250).optional(), value: z.coerce.number().min(0).default(0), comment: z.string().trim().max(2000).optional(), source: z.enum(['project', 'referral', 'other']).default('project') }).parse(req.body || {});
  const project: any = await Project.findOne(excludeDeleted({ _id: req.params.id, organizationId: orgId }));
  if (!project) throw ApiError.notFound('Project not found');
  const me = req.user!.id;
  const member = [oid(project.projectManagerId), ...(project.team || []).map(oid)].includes(me) || ['sales', 'coo', 'ceo', 'super_admin'].includes(req.user!.role);
  if (!member) throw ApiError.forbidden('Only the project team or sales can raise an opportunity from this project');
  const client: any = project.clientId ? await Client.findOne(excludeDeleted({ _id: project.clientId, organizationId: orgId })) : null;
  let sp: string | undefined = client?.accountOwnerId ? oid(client.accountOwnerId) : ['sales', 'coo', 'ceo', 'super_admin'].includes(req.user!.role) ? me : undefined;
  if (!sp) sp = oid((await User.findOne({ organizationId: orgId, isActive: true, role: 'sales' }).select('_id').sort('createdAt')) || (await User.findOne({ organizationId: orgId, isActive: true, role: { $in: ['coo', 'ceo'] } }).select('_id')));
  if (!sp) throw ApiError.badRequest('No salesperson could be found to own this opportunity.');
  const contacts = (client?.contacts || []).map((c: any, i: number) => ({ name: c.name, title: c.title, email: c.email, phone: c.phone, role: 'other', isPrimary: !!c.isPrimary || i === 0, clientContactId: c._id }));
  const opp = await Opportunity.create({
    organizationId: orgId, title: b.title || `Follow-on work: ${project.name}`, clientId: client?._id, prospectName: client ? undefined : project.name, sourceProjectId: project._id, source: b.source, stage: 'Lead', value: b.value, currency: project.currency || 'NGN', probability: DEFAULT_PROBABILITY.Lead,
    salespersonId: sp, contacts, nextAction: 'Qualify the follow-on need with the client', nextActionDate: new Date(Date.now() + 7 * 86400000),
    stageHistory: [{ stage: 'Lead', from: '', changedAt: new Date(), comment: b.comment || `Raised from project "${project.name}" by ${req.user!.name}`, byId: me, byName: req.user!.name, ...fromOf(req) }],
  } as any);
  await audit(req, 'opportunity.created_from_project', 'Opportunity', String(opp._id), { module: 'sales', summary: `Opportunity "${opp.title}" raised from project "${project.name}"` });
  if (sp !== me) await notifyWork({ organizationId: orgId, userIds: [sp], title: `New opportunity from a project: ${opp.title}`, summary: `${req.user!.name} raised an opportunity from the project "${project.name}".`, note: b.comment, link: `/sales?opportunity=${opp._id}`, cta: 'Open opportunity', type: 'sales', entity: { type: 'opportunity', id: String(opp._id) } });
  res.status(201).json({ success: true, data: opp });
});

const updateZ = createZ.partial().extend({ stageComment: z.string().trim().max(2000).optional(), lostReason: z.string().trim().max(300).optional(), winReason: z.string().trim().max(300).optional(), skipDocuments: z.boolean().optional() });

export const updateOpportunity = asyncHandler(async (req: Request, res: Response) => {
  const orgId = req.user!.organizationId;
  const opp: any = await Opportunity.findOne(excludeDeleted({ _id: req.params.id, organizationId: orgId }));
  if (!opp) throw ApiError.notFound('Opportunity not found');
  const d = updateZ.parse(req.body);
  const prev = opp.stage;
  const { stage, stageComment, lostReason, winReason, skipDocuments, contacts, startDate, expectedCloseDate, nextActionDate, clientId, sourceProjectId, ...rest } = d as any;
  if (clientId !== undefined) { await assertClientOrProspect(orgId, clientId || undefined); opp.clientId = clientId || undefined; }
  if (sourceProjectId !== undefined) opp.sourceProjectId = sourceProjectId || undefined;
  for (const [k, v] of Object.entries(rest)) if (v !== undefined) opp[k] = v;
  if (startDate !== undefined) opp.startDate = dateOrUndef(startDate);
  if (expectedCloseDate !== undefined) opp.expectedCloseDate = dateOrUndef(expectedCloseDate);
  if (nextActionDate !== undefined) opp.nextActionDate = dateOrUndef(nextActionDate);
  if (contacts) opp.set('contacts', contacts.map((c: any, i: number) => ({ ...c, email: c.email || undefined, isPrimary: c.isPrimary ?? i === 0 })));

  let moved: { from: string; to: string; comment: string } | null = null;
  if (stage && stage !== prev) {
    const documentCount = await EntityDocument.countDocuments(excludeDeleted({ organizationId: orgId, entityType: 'opportunity', entityId: opp._id, kind: { $in: ['contract', 'signed', 'proposal'] } }));
    const problems = stageProblems({ from: prev, to: stage, comment: stageComment, lostReason: lostReason ?? opp.lostReason, documentCount, hasClientOrProspect: !!(opp.clientId || opp.prospectName), value: opp.value || 0, skipDocuments, canSkip: LEADERS.includes(req.user!.role) });
    if (problems.length) throw new ApiError(422, problems[0], { problems });
    opp.stage = stage;
    if (d.probability === undefined) opp.probability = DEFAULT_PROBABILITY[stage] ?? opp.probability;
    if (isClosedStage(stage)) { opp.closedAt = new Date(); if (stage === 'Closed Lost') { opp.lostReason = lostReason; opp.winReason = undefined; } else { opp.winReason = winReason; opp.lostReason = undefined; } }
    else { opp.closedAt = undefined; }
    opp.stageHistory.push({ stage, from: prev, changedAt: new Date(), comment: stageComment, byId: req.user!.id, byName: req.user!.name, ...fromOf(req) });
    moved = { from: prev, to: stage, comment: stageComment! };
  } else if (lostReason !== undefined && opp.stage === 'Closed Lost') opp.lostReason = lostReason;
  else if (winReason !== undefined && opp.stage === 'Closed Won') opp.winReason = winReason;
  await opp.save();

  if (moved) {
    const actor = actorOf(req);
    const entity = await loadEntity(actor, 'opportunity', String(opp._id));
    await postComment({ actor, entity, kind: 'status', status: { from: moved.from, to: moved.to }, body: moved.comment, notify: 'all', from: fromOf(req) });
    if (moved.to === 'Proposal') {
      await Task.create({ organizationId: orgId, title: `Follow up on proposal — ${opp.title}`, ownerId: opp.salespersonId, creatorId: req.user!.id, priority: 'high', status: 'open', dueDate: new Date(Date.now() + 3 * 86400000), endDate: new Date(Date.now() + 3 * 86400000), tags: ['auto-generated', 'sales-follow-up'], statusHistory: [{ from: '', to: 'open', comment: 'Proposal stage reached.', byName: 'System', at: new Date() }] });
    }
    if (moved.to === 'Closed Won') {
      if (opp.clientId) await Client.updateOne({ _id: opp.clientId, status: 'prospect' }, { $set: { status: 'active', lastActivityAt: new Date() } });
      const leaders = await User.find({ organizationId: orgId, isActive: true, role: { $in: ['ceo', 'coo', 'finance'] } }).select('_id');
      await notifyWork({ organizationId: orgId, userIds: leaders.map((u: any) => String(u._id)), title: `Deal won: ${opp.title}`, summary: `${req.user!.name} closed "${opp.title}" as won (${opp.currency} ${(opp.value || 0).toLocaleString()}).`, note: winReason, link: `/sales?opportunity=${opp._id}`, cta: 'Open opportunity', type: 'sales', severity: 'info', entity: { type: 'opportunity', id: String(opp._id) } });
    }
  }
  await audit(req, 'opportunity.updated', 'Opportunity', String(opp._id), { module: 'sales', summary: `Updated "${opp.title}"${moved ? `: ${moved.from} → ${moved.to}` : ''}` });
  res.json({ success: true, data: opp });
});

/* ---------------------------------- contacts --------------------------------- */
export const addContact = asyncHandler(async (req: Request, res: Response) => {
  const opp: any = await Opportunity.findOne(excludeDeleted({ _id: req.params.id, organizationId: req.user!.organizationId }));
  if (!opp) throw ApiError.notFound('Opportunity not found');
  const c = contactZ.parse(req.body);
  if (c.isPrimary || !opp.contacts.length) opp.contacts.forEach((x: any) => { x.isPrimary = false; });
  opp.contacts.push({ ...c, email: c.email || undefined, isPrimary: c.isPrimary || !opp.contacts.length });
  await opp.save();
  res.status(201).json({ success: true, data: opp.contacts });
});
export const updateContact = asyncHandler(async (req: Request, res: Response) => {
  const opp: any = await Opportunity.findOne(excludeDeleted({ _id: req.params.id, organizationId: req.user!.organizationId }));
  const c = opp?.contacts.id(req.params.cid);
  if (!opp || !c) throw ApiError.notFound('Contact not found');
  const d = contactZ.partial().parse(req.body);
  if (d.isPrimary) opp.contacts.forEach((x: any) => { x.isPrimary = false; });
  Object.assign(c, { ...d, email: d.email === '' ? undefined : d.email ?? c.email });
  await opp.save();
  res.json({ success: true, data: opp.contacts });
});
export const removeContact = asyncHandler(async (req: Request, res: Response) => {
  const opp: any = await Opportunity.findOne(excludeDeleted({ _id: req.params.id, organizationId: req.user!.organizationId }));
  const c = opp?.contacts.id(req.params.cid);
  if (!opp || !c) throw ApiError.notFound('Contact not found');
  c.deleteOne(); await opp.save();
  res.json({ success: true, data: opp.contacts });
});

/* ----------------------------------- report ---------------------------------- */
export const opportunityReport = asyncHandler(async (req: Request, res: Response) => {
  const orgId = req.user!.organizationId;
  const q = req.query as Record<string, string>;
  const opps: any[] = await Opportunity.find(listFilter(req)).populate('clientId', 'name').lean();
  const docs: any[] = await EntityDocument.find(excludeDeleted({ organizationId: orgId, entityType: 'opportunity', kind: { $in: ['contract', 'signed', 'proposal'] } })).select('entityId').lean();
  const docCount = new Map<string, number>(); docs.forEach((d) => docCount.set(String(d.entityId), (docCount.get(String(d.entityId)) || 0) + 1));
  const users = await User.find({ organizationId: orgId }).select('name').lean();
  const names = Object.fromEntries(users.map((u: any) => [String(u._id), u.name]));
  const data = buildInsights(opps.map((o) => ({ ...o, clientName: o.clientId?.name || o.prospectName, documentCount: docCount.get(String(o._id)) || 0 })), names);
  res.json({ success: true, data: { ...data, filters: { from: q.createdFrom || null, to: q.createdTo || null } } });
});

export const deleteOpportunity = asyncHandler(async (req: Request, res: Response) => {
  const opp = await Opportunity.findOne(excludeDeleted({ _id: req.params.id, organizationId: req.user!.organizationId }));
  if (!opp) throw ApiError.notFound('Opportunity not found');
  await (opp as any).softDelete(req.user!.id);
  res.json({ success: true, data: { id: req.params.id, softDeleted: true } });
});

export const restoreOpportunity = asyncHandler(async (req: Request, res: Response) => {
  const opp = await Opportunity.findOne({ _id: req.params.id, organizationId: req.user!.organizationId, isDeleted: true });
  if (!opp) throw ApiError.notFound('Deleted opportunity not found');
  await (opp as any).restore();
  res.json({ success: true, data: opp });
});
export { stripProtected };
