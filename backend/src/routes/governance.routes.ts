import { Router } from 'express';
import mongoose from 'mongoose';
import { requireAuth } from '../middleware/auth';
import { requireModule, hasModule } from '../middleware/modules';
import { asyncHandler } from '../utils/asyncHandler';
import { ApiError } from '../utils/ApiError';
import { Incident, DataSubjectRequest, ProcessingActivity, Policy, PolicyAcknowledgement, Obligation } from '../models/Governance';
import { User } from '../models/User';
import { nextNumber } from '../models/Access';
import { audit } from '../services/audit.service';
import { notify } from '../services/notify.service';
import { usersWithModule } from '../services/access.service';
import { hashIp } from '../middleware/security';
import { excludeDeleted } from '../utils/softDeletePlugin';

const rx = (s: string) => String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const page = (req: any) => ({ p: Math.max(parseInt(req.query.page, 10) || 1, 1), l: Math.min(Math.max(parseInt(req.query.limit, 10) || 25, 1), 100) });
const addMonths = (d: Date, m: number) => { const r = new Date(d); r.setMonth(r.getMonth() + m); return r; };
const pick = (o: any, keys: string[]) => Object.fromEntries(keys.filter((k) => o?.[k] !== undefined).map((k) => [k, o[k]]));
const tl = (req: any, text: string) => ({ at: new Date(), byId: req.user.id, byName: req.user.name, text });

/* ================================ Incidents ================================= */
export const incidentsRouter = Router();
incidentsRouter.use(requireAuth);

// Anyone signed in can REPORT an incident (A.6.8) — only the incidents module can see/manage them.
incidentsRouter.post('/report', asyncHandler(async (req, res) => {
  const b = req.body || {};
  if (!b.title || !String(b.title).trim()) throw ApiError.badRequest('Describe what happened in the title.');
  const detectedAt = b.detectedAt ? new Date(b.detectedAt) : new Date();
  const personal = !!b.isPersonalDataBreach;
  const inc: any = await Incident.create({
    organizationId: req.user!.organizationId, reference: await nextNumber(req.user!.organizationId, 'INC', { yearly: true, pad: 4 }),
    title: String(b.title).trim().slice(0, 200), description: String(b.description || '').slice(0, 20000),
    category: b.category || 'other', severity: ['low', 'medium', 'high', 'critical'].includes(b.severity) ? b.severity : 'medium',
    detectedAt, reportedById: req.user!.id, isPersonalDataBreach: personal,
    breach: personal ? { dataCategories: Array.isArray(b.dataCategories) ? b.dataCategories : [], subjectsAffected: Number(b.subjectsAffected) || 0, riskToRights: b.riskToRights || 'risk', regulatorDeadline: new Date(detectedAt.getTime() + 72 * 3600000) } : {},
    timeline: [tl(req, 'Incident reported')],
  });
  await audit(req, 'incident.reported', 'Incident', String(inc._id), { module: 'incidents', severity: inc.severity === 'critical' || personal ? 'critical' : 'high', summary: `${inc.reference} ${inc.title}` });
  const handlers = await usersWithModule(req.user!.organizationId, 'incidents');
  await notify({
    organizationId: req.user!.organizationId, userIds: handlers.map((u) => String(u._id)),
    title: `${personal ? 'PERSONAL DATA BREACH · ' : ''}Incident ${inc.reference}: ${inc.title}`,
    body: `${inc.severity.toUpperCase()} · reported by ${req.user!.name}${personal ? ` · regulator deadline ${inc.breach.regulatorDeadline.toUTCString()}` : ''}`,
    link: `/incidents?incident=${inc._id}`, type: 'incident', severity: inc.severity === 'critical' || personal ? 'critical' : 'high',
    email: { intro: `${personal ? '<strong>This may be a personal data breach — the 72-hour regulator notification clock is running.</strong> ' : ''}A new security incident was reported.` },
  });
  res.status(201).json({ success: true, data: { _id: inc._id, reference: inc.reference } });
}));

incidentsRouter.use(requireModule('incidents'));

incidentsRouter.get('/', asyncHandler(async (req, res) => {
  const { status, severity, breach, q, open } = req.query as Record<string, string>;
  const f: any = { organizationId: req.user!.organizationId };
  if (status) f.status = status; if (severity) f.severity = severity; if (breach === 'true') f.isPersonalDataBreach = true;
  if (open === 'true') f.status = { $ne: 'closed' };
  if (q) f.$or = [{ title: { $regex: rx(q), $options: 'i' } }, { reference: { $regex: rx(q), $options: 'i' } }];
  const { p, l } = page(req);
  const [items, total] = await Promise.all([Incident.find(excludeDeleted(f)).select('-timeline -description').populate('assigneeId', 'name').sort('-detectedAt').skip((p - 1) * l).limit(l), Incident.countDocuments(excludeDeleted(f))]);
  res.json({ success: true, data: items, pagination: { page: p, limit: l, total, pages: Math.ceil(total / l) } });
}));

incidentsRouter.get('/:id', asyncHandler(async (req, res) => {
  const inc = await Incident.findOne(excludeDeleted({ _id: req.params.id, organizationId: req.user!.organizationId })).populate('assigneeId reportedById', 'name email').populate('affectedAssetIds', 'assetId title');
  if (!inc) throw ApiError.notFound('Incident not found');
  res.json({ success: true, data: inc });
}));

incidentsRouter.patch('/:id', asyncHandler(async (req, res) => {
  const inc: any = await Incident.findOne(excludeDeleted({ _id: req.params.id, organizationId: req.user!.organizationId }));
  if (!inc) throw ApiError.notFound('Incident not found');
  const b = req.body || {};
  const notes: string[] = [];
  const statuses = ['reported', 'triage', 'contained', 'eradicated', 'recovered', 'closed'];
  if (b.status && b.status !== inc.status) {
    if (!statuses.includes(b.status)) throw ApiError.badRequest('Invalid status');
    if (b.status === 'closed' && (!(b.rootCause || inc.rootCause) || !(b.lessonsLearned || inc.lessonsLearned))) throw ApiError.badRequest('Record the root cause and lessons learned before closing (A.5.27).');
    if (b.status === 'closed' && inc.isPersonalDataBreach && !inc.breach.regulatorNotified && inc.breach.riskToRights !== 'unlikely') throw ApiError.badRequest('Record the regulator notification (or set the risk to "unlikely") before closing a personal data breach.');
    notes.push(`Status: ${inc.status} → ${b.status}`);
    inc.status = b.status;
    if (b.status === 'contained') inc.containedAt = new Date();
    if (['recovered', 'closed'].includes(b.status)) inc.resolvedAt = inc.resolvedAt || new Date();
  }
  Object.assign(inc, pick(b, ['title', 'description', 'category', 'severity', 'rootCause', 'lessonsLearned', 'assigneeId', 'affectedAssetIds']));
  if (b.assigneeId) notes.push('Assignee changed');
  if (b.isPersonalDataBreach === true && !inc.isPersonalDataBreach) {
    inc.isPersonalDataBreach = true;
    inc.breach = { ...(inc.breach?.toObject?.() || {}), regulatorDeadline: new Date(new Date(inc.detectedAt).getTime() + 72 * 3600000), riskToRights: 'risk' };
    notes.push('Flagged as personal data breach — 72h clock started from detection');
  }
  if (b.breach && inc.isPersonalDataBreach) {
    const cur = inc.breach.toObject();
    const nb = { ...cur, ...pick(b.breach, ['dataCategories', 'subjectsAffected', 'riskToRights', 'regulatorRef']) };
    if (b.breach.regulatorNotified && !cur.regulatorNotified) { nb.regulatorNotified = true; nb.regulatorNotifiedAt = b.breach.regulatorNotifiedAt ? new Date(b.breach.regulatorNotifiedAt) : new Date(); notes.push(`Regulator notified${nb.regulatorNotifiedAt > cur.regulatorDeadline ? ' (LATE — after 72h)' : ''}`); }
    if (b.breach.subjectsNotified && !cur.subjectsNotified) { nb.subjectsNotified = true; nb.subjectsNotifiedAt = new Date(); notes.push('Affected individuals notified'); }
    inc.breach = nb;
  }
  if (b.addAction?.text) inc.actions.push({ text: String(b.addAction.text).slice(0, 300), ownerId: b.addAction.ownerId, dueDate: b.addAction.dueDate ? new Date(b.addAction.dueDate) : undefined });
  if (b.toggleAction) { const a = inc.actions.id(b.toggleAction); if (a) { a.done = !a.done; a.doneAt = a.done ? new Date() : undefined; } }
  if (b.note) notes.push(String(b.note).slice(0, 1000));
  notes.forEach((n) => inc.timeline.push(tl(req, n)));
  await inc.save();
  await audit(req, 'incident.updated', 'Incident', String(inc._id), { module: 'incidents', severity: inc.isPersonalDataBreach ? 'high' : 'medium', summary: `${inc.reference}: ${notes.join('; ') || 'updated'}` });
  res.json({ success: true, data: inc });
}));

/* ============================ Data subject requests ========================= */
export const dsarRouter = Router();
dsarRouter.use(requireAuth, requireModule('data_protection'));

dsarRouter.get('/', asyncHandler(async (req, res) => {
  const { status, type, overdue } = req.query as Record<string, string>;
  const f: any = { organizationId: req.user!.organizationId };
  if (status) f.status = status; if (type) f.type = type;
  if (overdue === 'true') { f.dueAt = { $lt: new Date() }; f.status = { $nin: ['completed', 'rejected'] }; }
  const { p, l } = page(req);
  const [items, total] = await Promise.all([DataSubjectRequest.find(excludeDeleted(f)).select('-timeline').populate('assigneeId', 'name').sort('dueAt').skip((p - 1) * l).limit(l), DataSubjectRequest.countDocuments(excludeDeleted(f))]);
  res.json({ success: true, data: items, pagination: { page: p, limit: l, total, pages: Math.ceil(total / l) } });
}));

dsarRouter.post('/', asyncHandler(async (req, res) => {
  const b = req.body || {};
  if (!b.type || !b.requester?.name) throw ApiError.badRequest('Request type and requester name are required.');
  const received = b.receivedAt ? new Date(b.receivedAt) : new Date();
  const r = await DataSubjectRequest.create({
    organizationId: req.user!.organizationId, reference: await nextNumber(req.user!.organizationId, 'DSR', { yearly: true, pad: 4 }),
    type: b.type, requester: pick(b.requester, ['name', 'email', 'phone', 'relationship']), userId: b.userId, details: b.details, receivedAt: received,
    dueAt: new Date(received.getTime() + 30 * 86400000), source: b.source || 'email', assigneeId: b.assigneeId || req.user!.id,
    timeline: [tl(req, 'Request logged — 30-day response clock started')],
  });
  await audit(req, 'dsar.created', 'DataSubjectRequest', String(r._id), { module: 'data_protection', summary: `${r.reference} ${r.type}` });
  res.status(201).json({ success: true, data: r });
}));

dsarRouter.get('/:id', asyncHandler(async (req, res) => {
  const r = await DataSubjectRequest.findOne(excludeDeleted({ _id: req.params.id, organizationId: req.user!.organizationId })).populate('assigneeId', 'name');
  if (!r) throw ApiError.notFound('Request not found');
  res.json({ success: true, data: r });
}));

dsarRouter.patch('/:id', asyncHandler(async (req, res) => {
  const r: any = await DataSubjectRequest.findOne(excludeDeleted({ _id: req.params.id, organizationId: req.user!.organizationId }));
  if (!r) throw ApiError.notFound('Request not found');
  const b = req.body || {};
  const notes: string[] = [];
  if (b.identityVerified === true && !r.identityVerified) { r.identityVerified = true; notes.push('Requester identity verified'); }
  if (b.extend === true && !r.extended) { r.extended = true; r.dueAt = new Date(r.dueAt.getTime() + 60 * 86400000); notes.push('Deadline extended by 60 days (complex request) — requester must be told'); }
  if (b.assigneeId) { r.assigneeId = b.assigneeId; notes.push('Reassigned'); }
  if (b.status && b.status !== r.status) {
    if (!['received', 'verifying', 'in_progress', 'awaiting_info', 'completed', 'rejected'].includes(b.status)) throw ApiError.badRequest('Invalid status');
    if (['completed'].includes(b.status) && !r.identityVerified) throw ApiError.badRequest('Verify the requester’s identity before completing.');
    if (b.status === 'completed' && !b.outcome) throw ApiError.badRequest('Describe the outcome.');
    if (b.status === 'rejected' && !b.rejectionReason) throw ApiError.badRequest('Give the reason for refusing.');
    r.status = b.status; notes.push(`Status → ${b.status}`);
    if (['completed', 'rejected'].includes(b.status)) { r.closedAt = new Date(); r.outcome = b.outcome; r.rejectionReason = b.rejectionReason; }
  }
  if (b.note) notes.push(String(b.note).slice(0, 1000));
  notes.forEach((n) => r.timeline.push(tl(req, n)));
  await r.save();
  await audit(req, 'dsar.updated', 'DataSubjectRequest', String(r._id), { module: 'data_protection', severity: r.type === 'erasure' ? 'high' : 'info', summary: `${r.reference}: ${notes.join('; ')}` });
  res.json({ success: true, data: r });
}));

/* ==================================== ROPA ================================== */
export const ropaRouter = Router();
ropaRouter.use(requireAuth, requireModule('data_protection'));

ropaRouter.get('/', asyncHandler(async (req, res) => {
  const f = excludeDeleted({ organizationId: req.user!.organizationId, ...(req.query.status ? { status: req.query.status } : {}) });
  const rows = await ProcessingActivity.find(f).populate('ownerId', 'name').sort('name');
  res.json({ success: true, data: rows, summary: { total: rows.length, sensitive: rows.filter((r) => r.sensitiveData).length, transfers: rows.filter((r) => r.thirdCountryTransfer).length, dpiaPending: rows.filter((r) => r.dpiaRequired && r.dpiaStatus !== 'completed').length, reviewDue: rows.filter((r) => r.nextReviewAt && r.nextReviewAt < new Date(Date.now() + 30 * 86400000)).length } });
}));
function ropaInput(b: any) {
  const out: any = pick(b, ['name', 'purpose', 'lawfulBasis', 'dataSubjects', 'dataCategories', 'sensitiveData', 'recipients', 'thirdCountryTransfer', 'transferSafeguards', 'retentionPeriod', 'retentionAction', 'securityMeasures', 'systems', 'ownerId', 'reviewCycleMonths', 'status']);
  // A DPIA is required for sensitive data or cross-border transfers (UI can override upwards).
  out.dpiaRequired = !!(b.dpiaRequired || b.sensitiveData || b.thirdCountryTransfer);
  if (!out.dpiaRequired) out.dpiaStatus = 'not_required';
  else if (b.dpiaStatus) out.dpiaStatus = b.dpiaStatus;
  return out;
}
ropaRouter.post('/', asyncHandler(async (req, res) => {
  const b = req.body || {};
  if (!b.name || !b.purpose) throw ApiError.badRequest('Name and purpose are required.');
  if (b.thirdCountryTransfer && !b.transferSafeguards) throw ApiError.badRequest('Describe the safeguards for the cross-border transfer.');
  const data = ropaInput(b);
  if (data.dpiaRequired && !data.dpiaStatus) data.dpiaStatus = 'pending';
  const row = await ProcessingActivity.create({ ...data, organizationId: req.user!.organizationId, lastReviewedAt: new Date(), nextReviewAt: addMonths(new Date(), data.reviewCycleMonths || 12) });
  await audit(req, 'ropa.created', 'ProcessingActivity', String(row._id), { module: 'data_protection', summary: row.name });
  res.status(201).json({ success: true, data: row });
}));
ropaRouter.patch('/:id', asyncHandler(async (req, res) => {
  const row: any = await ProcessingActivity.findOne(excludeDeleted({ _id: req.params.id, organizationId: req.user!.organizationId }));
  if (!row) throw ApiError.notFound('Record not found');
  const data = ropaInput({ ...row.toObject(), ...req.body });
  Object.assign(row, data);
  if (req.body.dpiaStatus === 'completed') row.dpiaCompletedAt = new Date();
  if (req.body.markReviewed) { row.lastReviewedAt = new Date(); row.nextReviewAt = addMonths(new Date(), row.reviewCycleMonths || 12); }
  await row.save();
  await audit(req, 'ropa.updated', 'ProcessingActivity', String(row._id), { module: 'data_protection', summary: row.name });
  res.json({ success: true, data: row });
}));

/* ================================== Policies ================================ */
export const policiesRouter = Router();
policiesRouter.use(requireAuth);

// Everyone sees approved policies addressed to them and what they still need to acknowledge.
policiesRouter.get('/mine', asyncHandler(async (req, res) => {
  const policies = await Policy.find(excludeDeleted({ organizationId: req.user!.organizationId, status: 'approved', requiresAcknowledgement: true, $or: [{ audienceRoles: { $size: 0 } }, { audienceRoles: req.user!.role }] })).select('code title category version summary effectiveDate content documentUrl');
  const acks = await PolicyAcknowledgement.find({ userId: req.user!.id, policyId: { $in: policies.map((p) => p._id) } });
  res.json({ success: true, data: policies.map((p) => ({ ...p.toObject(), acknowledged: acks.some((a) => String(a.policyId) === String(p._id) && a.version === p.version) })) });
}));
policiesRouter.post('/:id/acknowledge', asyncHandler(async (req, res) => {
  const p = await Policy.findOne(excludeDeleted({ _id: req.params.id, organizationId: req.user!.organizationId, status: 'approved' }));
  if (!p) throw ApiError.notFound('Policy not found');
  try { await PolicyAcknowledgement.create({ organizationId: req.user!.organizationId, policyId: p._id, version: p.version, userId: req.user!.id, ipHash: hashIp(req.ip) }); } catch (e: any) { if (e.code !== 11000) throw e; }
  await audit(req, 'policy.acknowledged', 'Policy', String(p._id), { module: 'policies', summary: `${p.code} v${p.version}` });
  res.json({ success: true, data: { policyId: p._id, version: p.version } });
}));

policiesRouter.use(requireModule('policies'));
policiesRouter.get('/', asyncHandler(async (req, res) => {
  const f: any = { organizationId: req.user!.organizationId }; if (req.query.status) f.status = req.query.status;
  const policies = await Policy.find(excludeDeleted(f)).populate('ownerId', 'name').sort('code');
  const staff = await User.countDocuments({ organizationId: req.user!.organizationId, isActive: true, loginEnabled: { $ne: false }, role: { $nin: ['client', 'vendor', 'training_customer'] } });
  const counts = await PolicyAcknowledgement.aggregate([{ $match: { organizationId: new mongoose.Types.ObjectId(req.user!.organizationId) } }, { $group: { _id: { p: '$policyId', v: '$version' }, n: { $sum: 1 } } }]);
  res.json({ success: true, data: policies.map((p) => ({ ...p.toObject(), content: undefined, acknowledgements: counts.find((c) => String(c._id.p) === String(p._id) && c._id.v === p.version)?.n || 0, staff })) });
}));
policiesRouter.get('/:id', asyncHandler(async (req, res) => {
  const p = await Policy.findOne(excludeDeleted({ _id: req.params.id, organizationId: req.user!.organizationId })).populate('ownerId approvedById', 'name');
  if (!p) throw ApiError.notFound('Policy not found');
  const acks = await PolicyAcknowledgement.find({ policyId: p._id, version: p.version }).populate('userId', 'name department');
  const audience = await User.find({ organizationId: req.user!.organizationId, isActive: true, loginEnabled: { $ne: false }, role: { $nin: ['client', 'vendor', 'training_customer'] }, ...(p.audienceRoles?.length ? { role: { $in: p.audienceRoles } } : {}) }).select('name department');
  const done = new Set(acks.map((a: any) => String(a.userId?._id)));
  res.json({ success: true, data: p, acknowledgements: acks, outstanding: audience.filter((u) => !done.has(String(u._id))) });
}));
policiesRouter.post('/', asyncHandler(async (req, res) => {
  const b = req.body || {};
  if (!b.title) throw ApiError.badRequest('Title is required.');
  const code = b.code ? String(b.code).toUpperCase().slice(0, 20) : await nextNumber(req.user!.organizationId, 'POL', { yearly: false, pad: 3 });
  if (await Policy.findOne(excludeDeleted({ organizationId: req.user!.organizationId, code }))) throw ApiError.conflict('A policy with this code already exists.');
  const p = await Policy.create({ ...pick(b, ['title', 'category', 'version', 'summary', 'content', 'documentUrl', 'reviewCycleMonths', 'requiresAcknowledgement', 'audienceRoles']), code, organizationId: req.user!.organizationId, ownerId: b.ownerId || req.user!.id, createdById: req.user!.id, status: 'draft' });
  await audit(req, 'policy.created', 'Policy', String(p._id), { module: 'policies', summary: `${p.code} ${p.title}` });
  res.status(201).json({ success: true, data: p });
}));
policiesRouter.patch('/:id', asyncHandler(async (req, res) => {
  const p: any = await Policy.findOne(excludeDeleted({ _id: req.params.id, organizationId: req.user!.organizationId }));
  if (!p) throw ApiError.notFound('Policy not found');
  const b = req.body || {};
  if (p.status === 'approved' && (b.content !== undefined || b.version !== undefined) && !b.newVersion) throw ApiError.conflict('Approved policies are immutable. Create a new version (newVersion: true) so staff must re-acknowledge.');
  Object.assign(p, pick(b, ['title', 'category', 'summary', 'content', 'documentUrl', 'reviewCycleMonths', 'requiresAcknowledgement', 'audienceRoles', 'ownerId']));
  if (b.newVersion) { if (!b.version || b.version === p.version) throw ApiError.badRequest('Provide a new version number.'); p.version = b.version; p.status = 'draft'; p.approvedById = undefined; p.approvedAt = undefined; }
  if (b.status === 'in_review' && p.status === 'draft') p.status = 'in_review';
  if (b.status === 'retired') p.status = 'retired';
  await p.save();
  await audit(req, 'policy.updated', 'Policy', String(p._id), { module: 'policies', summary: `${p.code} v${p.version}` });
  res.json({ success: true, data: p });
}));
policiesRouter.post('/:id/approve', asyncHandler(async (req, res) => {
  if (!['super_admin', 'ceo', 'coo'].includes(req.user!.role)) throw ApiError.forbidden('Only leadership can approve policies.');
  const p: any = await Policy.findOne(excludeDeleted({ _id: req.params.id, organizationId: req.user!.organizationId }));
  if (!p) throw ApiError.notFound('Policy not found');
  if (!['draft', 'in_review'].includes(p.status)) throw ApiError.conflict('Policy is not awaiting approval.');
  if (String(p.createdById) === req.user!.id && req.user!.role !== 'super_admin') throw ApiError.forbidden('Four-eyes control: the author cannot approve their own policy.');
  p.status = 'approved'; p.approvedById = req.user!.id; p.approvedAt = new Date(); p.effectiveDate = p.effectiveDate || new Date(); p.nextReviewAt = addMonths(new Date(), p.reviewCycleMonths || 12);
  await p.save();
  await audit(req, 'policy.approved', 'Policy', String(p._id), { module: 'policies', severity: 'medium', summary: `${p.code} v${p.version} approved` });
  if (p.requiresAcknowledgement) {
    const staff = await User.find({ organizationId: req.user!.organizationId, isActive: true, loginEnabled: { $ne: false }, role: p.audienceRoles?.length ? { $in: p.audienceRoles } : { $nin: ['client', 'vendor', 'training_customer'] } }).select('_id');
    await notify({ organizationId: req.user!.organizationId, userIds: staff.map((u) => String(u._id)), title: `Please read and acknowledge: ${p.title} (v${p.version})`, body: 'A new or updated policy needs your acknowledgement.', link: '/policies', type: 'policy', severity: 'warning', dedupeKey: `policy:${p._id}:${p.version}`, email: {} });
  }
  res.json({ success: true, data: p });
}));

/* =============================== Compliance calendar ======================== */
export const obligationsRouter = Router();
obligationsRouter.use(requireAuth, requireModule('compliance'));

const NEXT: Record<string, number> = { monthly: 1, quarterly: 3, biannual: 6, annual: 12 };

obligationsRouter.get('/', asyncHandler(async (req, res) => {
  const rows = await Obligation.find(excludeDeleted({ organizationId: req.user!.organizationId })).populate('ownerId', 'name').sort('nextDueAt');
  const now = Date.now();
  res.json({ success: true, data: rows.map((o) => ({ ...o.toObject(), daysLeft: Math.ceil((o.nextDueAt.getTime() - now) / 86400000), state: o.status === 'paused' ? 'paused' : o.nextDueAt.getTime() < now ? 'overdue' : o.nextDueAt.getTime() < now + 14 * 86400000 ? 'due_soon' : 'ok' })) });
}));
obligationsRouter.post('/', asyncHandler(async (req, res) => {
  const b = req.body || {};
  if (!b.title || !b.nextDueAt) throw ApiError.badRequest('Title and next due date are required.');
  const o = await Obligation.create({ ...pick(b, ['title', 'category', 'description', 'frequency', 'remindDaysBefore', 'ownerId', 'notifyModules', 'authority', 'referenceUrl']), nextDueAt: new Date(b.nextDueAt), organizationId: req.user!.organizationId, ownerId: b.ownerId || req.user!.id });
  await audit(req, 'obligation.created', 'Obligation', String(o._id), { module: 'compliance', summary: o.title });
  res.status(201).json({ success: true, data: o });
}));
obligationsRouter.patch('/:id', asyncHandler(async (req, res) => {
  const o: any = await Obligation.findOne(excludeDeleted({ _id: req.params.id, organizationId: req.user!.organizationId }));
  if (!o) throw ApiError.notFound('Obligation not found');
  Object.assign(o, pick(req.body, ['title', 'category', 'description', 'frequency', 'remindDaysBefore', 'ownerId', 'notifyModules', 'authority', 'referenceUrl', 'status']));
  if (req.body.nextDueAt) o.nextDueAt = new Date(req.body.nextDueAt);
  await o.save();
  res.json({ success: true, data: o });
}));
obligationsRouter.post('/:id/complete', asyncHandler(async (req, res) => {
  const o: any = await Obligation.findOne(excludeDeleted({ _id: req.params.id, organizationId: req.user!.organizationId }));
  if (!o) throw ApiError.notFound('Obligation not found');
  o.history.push({ completedAt: new Date(), completedById: req.user!.id, dueWas: o.nextDueAt, note: req.body.note, evidenceUrl: req.body.evidenceUrl });
  o.lastCompletedAt = new Date();
  if (o.frequency === 'once') o.status = 'paused';
  else o.nextDueAt = addMonths(o.nextDueAt, NEXT[o.frequency]);
  await o.save();
  await audit(req, 'obligation.completed', 'Obligation', String(o._id), { module: 'compliance', summary: `${o.title} (due ${o.history[o.history.length - 1].dueWas.toDateString()})` });
  res.json({ success: true, data: o });
}));
