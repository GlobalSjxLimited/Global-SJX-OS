import * as assetRisk from '../services/assetRisk.service';
import { Router } from 'express';
import mongoose from 'mongoose';
import { requireAuth } from '../middleware/auth';
import { requireModule } from '../middleware/modules';
import { asyncHandler } from '../utils/asyncHandler';
import { ApiError } from '../utils/ApiError';
import { Asset, AssetEvent, CATEGORIES, CATEGORY_KEYS, CLASSIFICATIONS, LIFECYCLE_STATUSES, CIA } from '../models/Asset';
import { User } from '../models/User';
import { nextNumber } from '../models/Access';
import { appendEvent, verifyChain, diff } from '../utils/assetAudit';
import { audit } from '../services/audit.service';
import { notify } from '../services/notify.service';
import { usersWithModule } from '../services/access.service';
import { toCsv } from '../utils/csv';
import { excludeDeleted } from '../utils/softDeletePlugin';
import { env } from '../config/env';
import { hasModule } from '../middleware/modules';
import { AssetPolicy } from '../models/AssetPolicy';
import { assertNaming, checkNaming, decideClassification, getPolicy, higher, suggestClassification, validatePolicyInput } from '../services/assetPolicy.service';

const router = Router();
router.use(requireAuth, requireModule('assets'));

const FIELDS = ['title', 'subCategory', 'description', 'owner', 'custodian', 'users', 'location', 'ownerUser', 'custodianUser', 'assignedToId', 'classification', 'confidentiality', 'integrity', 'availability', 'vendor', 'serialNumber', 'makeModel', 'version', 'maintenanceStatus', 'acquisitionDate', 'expectedLifeMonths', 'endOfLifeOverride', 'licenseExpiryDate', 'warrantyExpiryDate', 'reviewCycleMonths', 'backupSchedule', 'backupLocation', 'backupDetails', 'tags', 'details', 'lifecycleStatus'];
const actor = (req: any) => ({ id: req.user.id, name: req.user.name, role: req.user.role });
const oid = (s: string) => new mongoose.Types.ObjectId(s);
const rx = (s: string) => String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

function clean(body: any) {
  const out: any = {};
  for (const f of FIELDS) if (body[f] !== undefined) out[f] = body[f] === '' ? undefined : body[f];
  if (out.classification && !CLASSIFICATIONS.includes(out.classification)) throw ApiError.badRequest('Invalid classification');
  for (const k of ['confidentiality', 'integrity', 'availability']) if (out[k] && !CIA.includes(out[k])) throw ApiError.badRequest(`Invalid ${k}`);
  if (out.lifecycleStatus && !LIFECYCLE_STATUSES.includes(out.lifecycleStatus)) throw ApiError.badRequest('Invalid lifecycle status');
  if (out.lifecycleStatus && ['in_disposal', 'disposed'].includes(out.lifecycleStatus)) throw ApiError.badRequest('Use the disposal workflow to dispose an asset.');
  for (const k of ['expectedLifeMonths', 'reviewCycleMonths']) if (out[k] !== undefined) { out[k] = Number(out[k]); if (!(out[k] >= 0)) throw ApiError.badRequest(`${k} must be a positive number`); }
  for (const k of ['acquisitionDate', 'endOfLifeOverride', 'licenseExpiryDate', 'warrantyExpiryDate']) if (out[k]) { out[k] = new Date(out[k]); if (Number.isNaN(out[k].getTime())) throw ApiError.badRequest(`${k} is not a valid date`); }
  if (out.tags && !Array.isArray(out.tags)) out.tags = String(out.tags).split(',').map((t) => t.trim()).filter(Boolean);
  return out;
}

router.get('/meta', asyncHandler(async (_req, res) => {
  res.json({ success: true, data: { categories: CATEGORIES, classifications: CLASSIFICATIONS, lifecycleStatuses: LIFECYCLE_STATUSES, cia: CIA } });
}));

router.get('/summary', asyncHandler(async (req, res) => {
  const org = oid(req.user!.organizationId);
  const base = { organizationId: org, isDeleted: { $ne: true } };
  const [byCat, byClass, byStatus, eol, flags, total] = await Promise.all([
    Asset.aggregate([{ $match: base }, { $group: { _id: '$category', n: { $sum: 1 } } }]),
    Asset.aggregate([{ $match: base }, { $group: { _id: '$classification', n: { $sum: 1 } } }]),
    Asset.aggregate([{ $match: base }, { $group: { _id: '$lifecycleStatus', n: { $sum: 1 } } }]),
    Asset.aggregate([{ $match: { ...base, lifecycleStatus: { $in: ['active', 'under_maintenance'] } } }, { $group: { _id: '$eolState', n: { $sum: 1 } } }]),
    Asset.aggregate([{ $match: base }, { $unwind: '$dataQualityFlags' }, { $group: { _id: '$dataQualityFlags', n: { $sum: 1 } } }]),
    Asset.countDocuments(base),
  ]);
  const now = new Date(), in30 = new Date(Date.now() + 30 * 86400000);
  const [reviewsDue, licencesExpiring, warrantiesExpiring] = await Promise.all([
    Asset.countDocuments({ ...base, lifecycleStatus: { $in: ['active', 'under_maintenance'] }, nextReviewDate: { $lt: in30 } }),
    Asset.countDocuments({ ...base, licenseExpiryDate: { $gte: now, $lt: in30 } }),
    Asset.countDocuments({ ...base, warrantyExpiryDate: { $gte: now, $lt: in30 } }),
  ]);
  res.json({ success: true, data: { total, byCategory: byCat, byClassification: byClass, byStatus, eol, dataQuality: flags, reviewsDue, licencesExpiring, warrantiesExpiring } });
}));

/* ------------------------- Classification & naming policy ------------------------- */
/** Live help while typing: what label would this get, and is the name acceptable? (any asset-module user) */
router.post('/classify', asyncHandler(async (req, res) => {
  const b = req.body || {};
  const policy = await getPolicy(req.user!.organizationId);
  const decision = decideClassification(policy, { chosen: b.classification, auto: !!b.auto, overrideReason: b.overrideReason, canOverride: hasModule(req, 'asset_policy') }, { title: b.title, description: b.description, category: b.category, tags: b.tags, subCategory: b.subCategory });
  res.json({ success: true, data: { suggestion: decision.suggestion, decision: { classification: decision.classification, source: decision.source, blocked: decision.blocked }, problems: checkNaming(policy, { title: b.title, description: b.description }) } });
}));

router.get('/policy', requireModule('asset_policy'), asyncHandler(async (req, res) => {
  res.json({ success: true, data: await getPolicy(req.user!.organizationId) });
}));

router.put('/policy', requireModule('asset_policy'), asyncHandler(async (req, res) => {
  const data = validatePolicyInput(req.body || {});
  const current = await getPolicy(req.user!.organizationId);
  const next = { ...current, ...data };
  await AssetPolicy.findOneAndUpdate({ organizationId: req.user!.organizationId }, { ...next, organizationId: req.user!.organizationId, updatedById: req.user!.id }, { upsert: true, new: true, setDefaultsOnInsert: true });
  await audit(req, 'asset.policy_updated', 'AssetPolicy', undefined, { module: 'assets', severity: 'high', summary: `Asset classification policy updated (${Object.keys(data).join(', ')})` });
  res.json({ success: true, data: next });
}));

/** Apply the rules to the whole register. Raise-only: a label is never lowered automatically. */
router.post('/policy/rescan', requireModule('asset_policy'), asyncHandler(async (req, res) => {
  const policy = await getPolicy(req.user!.organizationId);
  const dry = req.body?.dryRun !== false;
  const assets: any[] = await Asset.find(excludeDeleted({ organizationId: req.user!.organizationId, lifecycleStatus: { $nin: ['disposed'] } }));
  const changes: any[] = [];
  const problems: any[] = [];
  for (const a of assets) {
    const sug = suggestClassification(policy, { title: a.title, description: a.description, category: a.category, tags: a.tags, subCategory: a.subCategory });
    if (!sug.usedDefault && higher(sug.classification, a.classification)) {
      changes.push({ id: a._id, assetId: a.assetId, title: a.title, from: a.classification, to: sug.classification, reason: sug.reason });
      if (!dry) {
        const before = a.classification;
        a.classification = sug.classification; a.classificationSource = 'auto'; a.classificationReason = sug.reason; a.classifiedAt = new Date(); a.updatedBy = req.user!.name;
        await a.save();
        await appendEvent({ asset: a, action: 'classification_raised_auto', actor: actor(req), req, changes: [{ field: 'classification', from: before, to: sug.classification }], note: sug.reason });
      }
    }
    const np = checkNaming(policy, { title: a.title, description: a.description });
    if (np.length) problems.push({ id: a._id, assetId: a.assetId, title: a.title, problems: np.map((p) => p.message) });
  }
  if (!dry) await audit(req, 'asset.policy_rescan', 'Asset', undefined, { module: 'assets', severity: 'high', summary: `${changes.length} assets re-labelled by policy` });
  res.json({ success: true, data: { dryRun: dry, scanned: assets.length, raised: changes, namingProblems: problems } });
}));

function listFilter(req: any) {
  const { category, classification, status, eol, criticality, assignedTo, q, flag, review } = req.query as Record<string, string>;
  const f: any = { organizationId: req.user.organizationId };
  if (category) f.category = category; if (classification) f.classification = classification; if (status) f.lifecycleStatus = status;
  if (eol) f.eolState = eol; if (criticality) f.criticality = criticality; if (assignedTo) f.assignedToId = assignedTo; if (flag) f.dataQualityFlags = flag;
  if (review === 'due') f.nextReviewDate = { $lt: new Date(Date.now() + 30 * 86400000) };
  if (q) f.$or = ['title', 'assetId', 'owner', 'serialNumber', 'vendor', 'location'].map((k) => ({ [k]: { $regex: rx(q), $options: 'i' } }));
  return excludeDeleted(f);
}

router.get('/', asyncHandler(async (req, res) => {
  const p = Math.max(parseInt(String(req.query.page), 10) || 1, 1), l = Math.min(Math.max(parseInt(String(req.query.limit), 10) || 25, 1), 200);
  const f = listFilter(req);
  const [items, total] = await Promise.all([Asset.find(f).populate('assignedToId', 'name').sort({ [String(req.query.sort || 'assetId')]: req.query.dir === 'desc' ? -1 : 1 }).skip((p - 1) * l).limit(l), Asset.countDocuments(f)]);
  res.json({ success: true, data: items, pagination: { page: p, limit: l, total, pages: Math.ceil(total / l) } });
}));

router.get('/export.csv', asyncHandler(async (req, res) => {
  const rows = await Asset.find(listFilter(req)).populate('assignedToId', 'name').sort('assetId').lean();
  await audit(req, 'asset.exported', 'Asset', undefined, { module: 'assets', severity: 'medium', summary: `${rows.length} assets exported (Statement of Applicability input)` });
  const cols = ['assetId', 'title', 'category', 'classification', 'criticality', 'lifecycleStatus', 'owner', 'custodian', 'assignedTo', 'location', 'vendor', 'serialNumber', 'acquisitionDate', 'endOfLifeDate', 'eolState', 'nextReviewDate', 'completeness'];
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename=asset-register-${new Date().toISOString().slice(0, 10)}.csv`);
  res.send(toCsv(cols.map((key) => ({ key, label: key })), rows.map((r: any) => ({ ...r, assignedTo: r.assignedToId?.name, acquisitionDate: r.acquisitionDate && new Date(r.acquisitionDate).toISOString().slice(0, 10), endOfLifeDate: r.endOfLifeDate && new Date(r.endOfLifeDate).toISOString().slice(0, 10), nextReviewDate: r.nextReviewDate && new Date(r.nextReviewDate).toISOString().slice(0, 10) }))));
}));

router.post('/', asyncHandler(async (req, res) => {
  const b = req.body || {};
  if (!b.title || !String(b.title).trim()) throw ApiError.badRequest('Title is required');
  if (!CATEGORY_KEYS.includes(b.category)) throw ApiError.badRequest('Choose a valid category');
  const data = clean(b);
  const policy = await getPolicy(req.user!.organizationId);
  assertNaming(policy, { title: b.title, description: b.description });
  const decision = decideClassification(policy, { chosen: b.classification, auto: !!b.autoLabel || !b.classification, overrideReason: b.classificationOverrideReason, canOverride: hasModule(req, 'asset_policy') }, { title: b.title, description: b.description, category: b.category, tags: data.tags, subCategory: b.subCategory });
  if (decision.blocked) throw new ApiError(422, decision.blocked, { suggestion: decision.suggestion });
  data.classification = decision.classification; data.classificationSource = decision.source; data.classificationReason = decision.reason; data.classifiedAt = new Date();
  // Skip numbers that already exist (imported / seeded assets do not advance the counter).
  let assetId = '';
  for (let attempt = 0; attempt < 50; attempt++) {
    assetId = `GSJX/${CATEGORIES[b.category].prefix}/${(await nextNumber(req.user!.organizationId, `AST-${CATEGORIES[b.category].prefix}`, { yearly: false, pad: 4 })).split('-').pop()}`;
    if (!(await Asset.exists({ organizationId: req.user!.organizationId, assetId }))) break;
  }
  const asset = await Asset.create({ ...data, organizationId: req.user!.organizationId, assetId, category: b.category, lifecycleStatus: data.lifecycleStatus || 'active', createdBy: req.user!.name, updatedBy: req.user!.name });
  await appendEvent({ asset, action: 'created', actor: actor(req), req, note: `${asset.title} · ${asset.classification} (${decision.source}${decision.reason ? `: ${decision.reason}` : ''})` });
  await audit(req, 'asset.created', 'Asset', String(asset._id), { module: 'assets', summary: `${asset.assetId} ${asset.title}` });
  const riskEngine = await assetRisk.afterAssetChange(req.user!.organizationId, asset, 'asset registered');
  res.status(201).json({ success: true, data: asset, riskEngine });
}));

async function load(req: any) {
  const a: any = await Asset.findOne(excludeDeleted({ _id: req.params.id, organizationId: req.user.organizationId }));
  if (!a) throw ApiError.notFound('Asset not found');
  return a;
}

router.get('/:id', asyncHandler(async (req, res) => {
  const asset = await load(req);
  const [events, chain] = await Promise.all([AssetEvent.find({ asset: asset._id }).sort({ seq: -1 }).limit(100).select('-prevHash'), verifyChain(asset)]);
  res.json({ success: true, data: await asset.populate('assignedToId ownerUser custodianUser', 'name jobTitle'), events, integrity: chain });
}));

router.patch('/:id', asyncHandler(async (req, res) => {
  const asset = await load(req);
  if (['in_disposal', 'disposed'].includes(asset.lifecycleStatus)) throw ApiError.conflict('Assets in disposal cannot be edited.');
  const before = asset.toObject();
  const data = clean(req.body || {});
  const policy = await getPolicy(req.user!.organizationId);
  if (data.title !== undefined || data.description !== undefined) assertNaming(policy, { title: data.title !== undefined ? data.title : undefined, description: data.description !== undefined ? data.description : undefined });
  // Re-label: a change of wording can only raise the label automatically; a manual choice below the rules needs an override.
  const merged = { title: data.title ?? asset.title, description: data.description ?? asset.description, category: asset.category, tags: data.tags ?? asset.tags, subCategory: data.subCategory ?? asset.subCategory };
  if (data.classification !== undefined && data.classification !== asset.classification) {
    const d = decideClassification(policy, { chosen: data.classification, overrideReason: req.body.classificationOverrideReason, canOverride: hasModule(req, 'asset_policy') }, merged);
    if (d.blocked) throw new ApiError(422, d.blocked, { suggestion: d.suggestion });
    data.classification = d.classification; data.classificationSource = d.source; data.classificationReason = d.reason; data.classifiedAt = new Date();
  } else if (policy.autoLabel && (data.title !== undefined || data.description !== undefined || data.tags !== undefined)) {
    const sug = suggestClassification(policy, merged);
    if (!sug.usedDefault && higher(sug.classification, asset.classification)) { data.classification = sug.classification; data.classificationSource = 'auto'; data.classificationReason = sug.reason; data.classifiedAt = new Date(); }
  }
  Object.assign(asset, data, { updatedBy: req.user!.name });
  const changes = diff(before, asset.toObject(), Object.keys(data).filter((k) => !['classificationSource', 'classificationReason', 'classifiedAt'].includes(k)));
  if (!changes.length) return res.json({ success: true, data: asset, unchanged: true });
  try { await asset.save(); } catch (e: any) { if (e.name === 'VersionError') throw ApiError.conflict('Someone else changed this asset. Reload and try again.'); throw e; }
  await appendEvent({ asset, action: 'updated', actor: actor(req), req, changes });
  const sensitive = changes.some((c) => ['classification', 'lifecycleStatus', 'confidentiality', 'integrity', 'availability'].includes(c.field));
  await audit(req, 'asset.updated', 'Asset', String(asset._id), { module: 'assets', severity: sensitive ? 'medium' : 'info', summary: `${asset.assetId}: ${changes.map((c) => c.field).join(', ')}`, meta: changes });
  const riskEngine = await assetRisk.afterAssetChange(req.user!.organizationId, asset, `asset updated (${changes.map((c) => c.field).slice(0, 4).join(', ')})`);
  res.json({ success: true, data: asset, riskEngine });
}));

router.post('/:id/assign', asyncHandler(async (req, res) => {
  const asset = await load(req);
  if (['in_disposal', 'disposed'].includes(asset.lifecycleStatus)) throw ApiError.conflict('This asset is being disposed.');
  const to = req.body.userId ? await User.findOne({ _id: req.body.userId, organizationId: req.user!.organizationId, isActive: true }).select('name') : null;
  if (req.body.userId && !to) throw ApiError.badRequest('Employee not found');
  const prev = asset.assignedToId ? await User.findById(asset.assignedToId).select('name') : null;
  asset.assignedToId = to?._id; asset.updatedBy = req.user!.name;
  await asset.save();
  await appendEvent({ asset, action: to ? 'assigned' : 'returned', actor: actor(req), req, changes: [{ field: 'assignedTo', from: prev?.name || '', to: to?.name || '' }], note: req.body.note });
  await audit(req, to ? 'asset.assigned' : 'asset.returned', 'Asset', String(asset._id), { module: 'assets', summary: `${asset.assetId} ${to ? `assigned to ${to.name}` : `returned by ${prev?.name || 'holder'}`}` });
  if (to) await notify({ organizationId: req.user!.organizationId, userIds: [String(to._id)], title: `Asset assigned to you: ${asset.title}`, body: `${asset.assetId} · you are responsible for keeping it secure and reporting loss immediately.`, link: '/assets', type: 'asset' });
  res.json({ success: true, data: asset });
}));

router.post('/:id/review', asyncHandler(async (req, res) => {
  const asset = await load(req);
  asset.lastReviewedAt = new Date(); asset.lastReviewedBy = req.user!.name; asset.updatedBy = req.user!.name;
  await asset.save();
  await appendEvent({ asset, action: 'reviewed', actor: actor(req), req, note: req.body.note });
  await audit(req, 'asset.reviewed', 'Asset', String(asset._id), { module: 'assets', summary: asset.assetId });
  res.json({ success: true, data: asset });
}));

/* Disposal workflow: request → approval by a different person → completion with certificate reference. */
router.post('/:id/disposal/request', asyncHandler(async (req, res) => {
  const asset = await load(req);
  if (['in_disposal', 'disposed'].includes(asset.lifecycleStatus)) throw ApiError.conflict('Disposal already requested.');
  if (!req.body.reason || !req.body.method) throw ApiError.badRequest('Give the reason and the disposal method (e.g. secure wipe, shredding, recycling).');
  asset.disposal = { previousStatus: asset.lifecycleStatus, reason: String(req.body.reason).slice(0, 300), method: String(req.body.method).slice(0, 120), requestedBy: req.user!.id, requestedByName: req.user!.name, requestedAt: new Date() } as any;
  asset.lifecycleStatus = 'in_disposal'; asset.disposalMethod = req.body.method; asset.assignedToId = undefined;
  await asset.save();
  await appendEvent({ asset, action: 'disposal_requested', actor: actor(req), req, note: req.body.reason });
  await audit(req, 'asset.disposal_requested', 'Asset', String(asset._id), { module: 'assets', severity: 'high', summary: `${asset.assetId}: ${req.body.method}` });
  const approvers = (await usersWithModule(req.user!.organizationId, 'assets')).filter((u) => String(u._id) !== req.user!.id && ['super_admin', 'ceo', 'coo'].includes(u.role));
  await notify({ organizationId: req.user!.organizationId, userIds: approvers.map((u) => String(u._id)), title: `Asset disposal awaiting approval: ${asset.assetId}`, body: `${asset.title} · ${req.body.method}`, link: '/assets', type: 'asset', severity: 'warning' });
  res.json({ success: true, data: asset });
}));

router.post('/:id/disposal/approve', asyncHandler(async (req, res) => {
  if (!['super_admin', 'ceo', 'coo'].includes(req.user!.role)) throw ApiError.forbidden('Only leadership can approve disposal.');
  const asset = await load(req);
  if (asset.lifecycleStatus !== 'in_disposal' || asset.disposal?.approvedAt) throw ApiError.conflict('No disposal awaiting approval.');
  if (env.fourEyes && asset.disposal?.requestedBy === req.user!.id) throw ApiError.forbidden('Four-eyes control: the requester cannot approve their own disposal.');
  asset.disposal.approvedBy = req.user!.id; asset.disposal.approvedByName = req.user!.name; asset.disposal.approvedAt = new Date();
  asset.markModified('disposal');
  await asset.save();
  await appendEvent({ asset, action: 'disposal_approved', actor: actor(req), req });
  await audit(req, 'asset.disposal_approved', 'Asset', String(asset._id), { module: 'assets', severity: 'high', summary: asset.assetId });
  res.json({ success: true, data: asset });
}));

router.post('/:id/disposal/reject', asyncHandler(async (req, res) => {
  if (!['super_admin', 'ceo', 'coo'].includes(req.user!.role)) throw ApiError.forbidden('Only leadership can reject disposal.');
  const asset = await load(req);
  if (asset.lifecycleStatus !== 'in_disposal' || asset.disposal?.approvedAt) throw ApiError.conflict('No disposal awaiting approval.');
  asset.lifecycleStatus = (asset.disposal?.previousStatus as any) || 'active'; asset.disposal = {} as any; asset.disposalMethod = undefined;
  await asset.save();
  await appendEvent({ asset, action: 'disposal_rejected', actor: actor(req), req, note: req.body.reason });
  await audit(req, 'asset.disposal_rejected', 'Asset', String(asset._id), { module: 'assets', summary: asset.assetId });
  res.json({ success: true, data: asset });
}));

router.post('/:id/disposal/complete', asyncHandler(async (req, res) => {
  const asset = await load(req);
  if (asset.lifecycleStatus !== 'in_disposal' || !asset.disposal?.approvedAt) throw ApiError.conflict('Disposal must be approved first.');
  if (!req.body.certificateRef) throw ApiError.badRequest('Enter the destruction / wipe certificate reference — it is your evidence for A.7.14 secure disposal.');
  asset.disposal.completedBy = req.user!.name; asset.disposal.completedAt = new Date(); asset.disposal.certificateRef = String(req.body.certificateRef).slice(0, 120);
  asset.markModified('disposal');
  asset.lifecycleStatus = 'disposed';
  await asset.save();
  await appendEvent({ asset, action: 'disposed', actor: actor(req), req, note: asset.disposal.certificateRef });
  await audit(req, 'asset.disposed', 'Asset', String(asset._id), { module: 'assets', severity: 'high', summary: `${asset.assetId} disposed · cert ${asset.disposal.certificateRef}` });
  const riskEngine = await assetRisk.afterAssetChange(req.user!.organizationId, asset, 'asset disposed');
  res.json({ success: true, data: asset, riskEngine });
}));

router.get('/:id/verify', asyncHandler(async (req, res) => {
  res.json({ success: true, data: await verifyChain(await load(req)) });
}));

router.delete('/:id', requireModule('assets'), asyncHandler(async (req, res) => {
  if (!['super_admin', 'ceo'].includes(req.user!.role)) throw ApiError.forbidden('Only the CEO or an administrator can delete asset records. Use the disposal workflow instead.');
  if (!req.body?.reason) throw ApiError.badRequest('A reason is required.');
  const asset = await load(req);
  asset.deleteReason = String(req.body.reason).slice(0, 300);
  (asset as any).isDeleted = true; (asset as any).deletedAt = new Date(); (asset as any).deletedById = req.user!.id;
  await asset.save();
  await appendEvent({ asset, action: 'deleted', actor: actor(req), req, note: asset.deleteReason });
  await audit(req, 'asset.deleted', 'Asset', String(asset._id), { module: 'assets', severity: 'high', summary: `${asset.assetId}: ${asset.deleteReason}` });
  await assetRisk.afterAssetChange(req.user!.organizationId, asset, 'asset deleted');
  res.json({ success: true, data: { id: asset._id } });
}));

export default router;
