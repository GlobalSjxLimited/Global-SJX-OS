import { Router } from 'express';
import mongoose from 'mongoose';
import { requireAuth } from '../middleware/auth';
import { requireRole } from '../middleware/rbac';
import { stripProtected } from '../middleware/security';
import { asyncHandler } from '../utils/asyncHandler';
import { ApiError } from '../utils/ApiError';
import { escapeRegex } from '../utils/escapeRegex';
import { env, startupProblems } from '../config/env';
import { CORE_ROLES } from '../config/roles';
import { SecurityControl, SecurityRequirement, OutsourcedReview, ConsentRecord } from '../models/Security';
import { ActivityLog, logActivity } from '../models/ActivityLog';
import { User } from '../models/User';
import { Notification } from '../models/Notification';
import { ensureSecurityControls } from '../services/securityControls.seed';

const router = Router();
router.use(requireAuth);

const STAFF = [...CORE_ROLES];
const MANAGE = ['coo', 'ceo'] as const; // super_admin always passes requireRole
const APPROVERS = ['coo', 'ceo'] as const;

// Internal staff only: clients/vendors/training customers never see the security programme.
router.use(requireRole(...(STAFF as any)));

const org = (req: any) => req.user!.organizationId;

/* ------------------------------ Summary -------------------------------- */
router.get(
  '/summary',
  asyncHandler(async (req, res) => {
    const o = org(req);
    const [controls, reqs, suppliers, users] = await Promise.all([
      SecurityControl.find({ organizationId: o }).select('status automated nextReviewAt domain'),
      SecurityRequirement.find({ organizationId: o }).select('status'),
      OutsourcedReview.find({ organizationId: o }).select('status nextReviewAt riskRating'),
      User.find({ organizationId: o, isActive: true }).select('mfaEnabled securityAcknowledgedAt role'),
    ]);
    const now = new Date();
    const applicable = controls.filter((c: any) => c.status !== 'not_applicable');
    const implemented = applicable.filter((c: any) => c.status === 'implemented').length;
    const staff = users.filter((u: any) => (STAFF as string[]).includes(u.role));
    res.json({
      success: true,
      data: {
        controls: {
          total: controls.length,
          implemented,
          inProgress: applicable.filter((c: any) => c.status === 'in_progress').length,
          notStarted: applicable.filter((c: any) => c.status === 'not_started').length,
          automated: controls.filter((c: any) => c.automated).length,
          reviewsDue: controls.filter((c: any) => c.nextReviewAt && c.nextReviewAt < now).length,
          coveragePct: applicable.length ? Math.round((implemented / applicable.length) * 100) : 0,
        },
        requirements: {
          total: reqs.length,
          pendingApproval: reqs.filter((r: any) => r.status === 'submitted').length,
          approved: reqs.filter((r: any) => r.status === 'approved' || r.status === 'verified').length,
        },
        suppliers: {
          total: suppliers.length,
          active: suppliers.filter((s: any) => s.status === 'active').length,
          highRisk: suppliers.filter((s: any) => s.riskRating === 'high').length,
          reviewsDue: suppliers.filter((s: any) => s.nextReviewAt && s.nextReviewAt < now).length,
        },
        people: {
          staff: staff.length,
          mfaEnabled: staff.filter((u: any) => u.mfaEnabled).length,
          policyAcknowledged: staff.filter((u: any) => u.securityAcknowledgedAt).length,
        },
      },
    });
  })
);

/* ---------------------------- Environment ------------------------------- */
router.get(
  '/environment',
  asyncHandler(async (_req, res) => {
    const checks = [
      { id: 'appEnv', label: 'Environment is explicitly named', ok: !!process.env.APP_ENV || env.nodeEnv === 'production', detail: `APP_ENV = ${env.appEnv}` },
      { id: 'jwt', label: 'JWT secret is strong and not a default', ok: env.jwtSecret.length >= 32 && !/dev-only|replace-this/i.test(env.jwtSecret), detail: `${env.jwtSecret.length} characters` },
      { id: 'origins', label: 'CORS origins are explicit and non-localhost', ok: !env.clientOrigins.some((o) => /localhost|127\.0\.0\.1|\*/.test(o)), detail: env.clientOrigins.join(', ') },
      { id: 'db', label: 'Database name matches the environment', ok: env.appEnv === 'production' ? !/(dev|test|staging)/i.test(env.dbName) : env.appEnv === 'staging' ? !/prod/i.test(env.dbName) || /non-?prod/i.test(env.dbName) : true, detail: `database = ${env.dbName || '(default)'}` },
      { id: 'seed', label: 'Destructive seed script is disabled', ok: env.appEnv === 'production' ? !env.allowSeed : true, detail: env.allowSeed ? 'ALLOW_SEED=true' : 'ALLOW_SEED not set' },
      { id: 'reg', label: 'Public self-registration is disabled', ok: process.env.ALLOW_SELF_REGISTRATION !== 'true', detail: process.env.ALLOW_SELF_REGISTRATION === 'true' ? 'enabled' : 'disabled' },
      { id: 'smtp', label: 'Outbound email configured', ok: !!env.smtp.host, detail: env.smtp.host || 'emails are logged only' },
      { id: 'lockout', label: 'Account lockout enabled', ok: env.lockout.maxAttempts > 0, detail: `${env.lockout.maxAttempts} attempts / ${env.lockout.minutes} min` },
    ];
    res.json({ success: true, data: { appEnv: env.appEnv, nodeEnv: env.nodeEnv, database: env.dbName, dbState: mongoose.connection.readyState, checks, startupProblems } });
  })
);

/* ------------------------------ Controls -------------------------------- */
router.get(
  '/controls',
  asyncHandler(async (req, res) => {
    const { q, domain, status } = req.query as Record<string, string>;
    const filter: any = { organizationId: org(req) };
    if (domain) filter.domain = domain;
    if (status) filter.status = status;
    if (q) {
      const rx = new RegExp(escapeRegex(q), 'i');
      filter.$or = [{ ref: rx }, { title: rx }, { statement: rx }];
    }
    const data = await SecurityControl.find(filter).populate('ownerId', 'name').populate('reviews.reviewerId', 'name').sort('ref');
    res.json({ success: true, data });
  })
);

router.post(
  '/controls/seed-baseline',
  requireRole(...(MANAGE as any)),
  asyncHandler(async (req, res) => {
    const created = await ensureSecurityControls(org(req), req.user!.id);
    res.json({ success: true, data: { created } });
  })
);

router.post(
  '/controls',
  requireRole(...(MANAGE as any)),
  asyncHandler(async (req, res) => {
    const body = stripProtected(req.body, ['reviews', 'evidence', 'lastReviewedAt']);
    if (!body.ref || !body.title || !body.statement) throw ApiError.badRequest('ref, title and statement are required');
    const c = await SecurityControl.create({ ...body, organizationId: org(req) });
    await logActivity({ organizationId: org(req), actorId: req.user!.id, action: 'security.control_created', entityType: 'SecurityControl', entityId: String(c._id) });
    res.status(201).json({ success: true, data: c });
  })
);

router.patch(
  '/controls/:id',
  requireRole(...(MANAGE as any)),
  asyncHandler(async (req, res) => {
    const c = await SecurityControl.findOne({ _id: req.params.id, organizationId: org(req) });
    if (!c) throw ApiError.notFound('Control not found');
    Object.assign(c, stripProtected(req.body, ['reviews', 'evidence', 'lastReviewedAt']));
    await c.save();
    await logActivity({ organizationId: org(req), actorId: req.user!.id, action: 'security.control_updated', entityType: 'SecurityControl', entityId: String(c._id), meta: { status: c.status } });
    res.json({ success: true, data: c });
  })
);

router.delete(
  '/controls/:id',
  requireRole(...(MANAGE as any)),
  asyncHandler(async (req, res) => {
    const c = await SecurityControl.findOne({ _id: req.params.id, organizationId: org(req) });
    if (!c) throw ApiError.notFound('Control not found');
    await (c as any).softDelete(req.user!.id);
    res.json({ success: true, data: { id: req.params.id, softDeleted: true } });
  })
);

router.post(
  '/controls/:id/review',
  requireRole(...(MANAGE as any)),
  asyncHandler(async (req, res) => {
    const c = await SecurityControl.findOne({ _id: req.params.id, organizationId: org(req) });
    if (!c) throw ApiError.notFound('Control not found');
    const outcome = ['effective', 'partially_effective', 'ineffective'].includes(req.body.outcome) ? req.body.outcome : 'effective';
    c.reviews.push({ reviewerId: req.user!.id as any, outcome, notes: String(req.body.notes || ''), at: new Date() } as any);
    c.lastReviewedAt = new Date();
    const months = Math.min(Math.max(parseInt(req.body.nextReviewMonths || '6', 10) || 6, 1), 24);
    c.nextReviewAt = new Date(Date.now() + months * 30 * 24 * 3600 * 1000);
    await c.save();
    await logActivity({ organizationId: org(req), actorId: req.user!.id, action: 'security.control_reviewed', entityType: 'SecurityControl', entityId: String(c._id), meta: { outcome } });
    res.json({ success: true, data: c });
  })
);

router.post(
  '/controls/:id/evidence',
  requireRole(...(MANAGE as any), 'engineer', 'project_manager'),
  asyncHandler(async (req, res) => {
    const c = await SecurityControl.findOne({ _id: req.params.id, organizationId: org(req) });
    if (!c) throw ApiError.notFound('Control not found');
    if (!req.body.label) throw ApiError.badRequest('Evidence label is required');
    c.evidence.push({ label: String(req.body.label), url: req.body.url ? String(req.body.url) : undefined, addedById: req.user!.id as any, at: new Date() } as any);
    await c.save();
    res.json({ success: true, data: c });
  })
);

/* ---------------------------- Requirements ------------------------------ */
router.get(
  '/requirements',
  asyncHandler(async (req, res) => {
    const { status, q } = req.query as Record<string, string>;
    const filter: any = { organizationId: org(req) };
    if (status) filter.status = status;
    if (q) {
      const rx = new RegExp(escapeRegex(q), 'i');
      filter.$or = [{ title: rx }, { application: rx }];
    }
    const data = await SecurityRequirement.find(filter).populate('requestedById approvedById', 'name').sort('-createdAt');
    res.json({ success: true, data });
  })
);

router.post(
  '/requirements',
  asyncHandler(async (req, res) => {
    const body = stripProtected(req.body, ['status', 'approvedById', 'approvedAt', 'decisionNote']);
    if (!body.application || !body.title) throw ApiError.badRequest('application and title are required');
    const r = await SecurityRequirement.create({ ...body, organizationId: org(req), requestedById: req.user!.id, status: 'draft' });
    res.status(201).json({ success: true, data: r });
  })
);

router.patch(
  '/requirements/:id',
  asyncHandler(async (req, res) => {
    const r = await SecurityRequirement.findOne({ _id: req.params.id, organizationId: org(req) });
    if (!r) throw ApiError.notFound('Requirement not found');
    const isOwner = String(r.requestedById) === req.user!.id;
    const isMgr = ['coo', 'ceo', 'super_admin'].includes(req.user!.role);
    if (!isOwner && !isMgr) throw ApiError.forbidden('Only the requester or a manager can edit this requirement.');
    if (['approved', 'verified'].includes(r.status) && !isMgr) throw ApiError.forbidden('Approved requirements can only be changed by a manager.');
    Object.assign(r, stripProtected(req.body, ['status', 'requestedById', 'approvedById', 'approvedAt', 'decisionNote']));
    await r.save();
    res.json({ success: true, data: r });
  })
);

router.post(
  '/requirements/:id/submit',
  asyncHandler(async (req, res) => {
    const r = await SecurityRequirement.findOne({ _id: req.params.id, organizationId: org(req) });
    if (!r) throw ApiError.notFound('Requirement not found');
    if (String(r.requestedById) !== req.user!.id && !['coo', 'ceo', 'super_admin'].includes(req.user!.role)) throw ApiError.forbidden();
    if (!['draft', 'rejected'].includes(r.status)) throw ApiError.badRequest('Only draft or rejected requirements can be submitted');
    r.status = 'submitted';
    await r.save();
    const approvers = await User.find({ organizationId: org(req), role: { $in: ['ceo', 'coo', 'super_admin'] }, isActive: true }).select('_id');
    await Notification.insertMany(
      approvers
        .filter((a: any) => String(a._id) !== req.user!.id)
        .map((a: any) => ({ organizationId: org(req), userId: a._id, type: 'system', title: 'Security requirement awaiting approval', body: `${r.application}: ${r.title}`, link: '/security' }))
    );
    res.json({ success: true, data: r });
  })
);

router.post(
  '/requirements/:id/decision',
  requireRole(...(APPROVERS as any)),
  asyncHandler(async (req, res) => {
    const r = await SecurityRequirement.findOne({ _id: req.params.id, organizationId: org(req) });
    if (!r) throw ApiError.notFound('Requirement not found');
    if (r.status !== 'submitted') throw ApiError.badRequest('Only submitted requirements can be decided');
    if (String(r.requestedById) === req.user!.id) throw ApiError.forbidden('You cannot approve your own requirement (segregation of duties).');
    const approve = req.body.decision === 'approve';
    r.status = approve ? 'approved' : 'rejected';
    r.approvedById = req.user!.id as any;
    r.approvedAt = new Date();
    r.decisionNote = String(req.body.note || '');
    await r.save();
    await logActivity({ organizationId: org(req), actorId: req.user!.id, action: approve ? 'security.requirement_approved' : 'security.requirement_rejected', entityType: 'SecurityRequirement', entityId: String(r._id) });
    if (r.requestedById) await Notification.create({ organizationId: org(req), userId: r.requestedById, type: 'system', title: `Security requirement ${approve ? 'approved' : 'rejected'}`, body: r.title, link: '/security' });
    res.json({ success: true, data: r });
  })
);

router.post(
  '/requirements/:id/verify',
  requireRole('engineer', 'project_manager', ...(MANAGE as any)),
  asyncHandler(async (req, res) => {
    const r = await SecurityRequirement.findOne({ _id: req.params.id, organizationId: org(req) });
    if (!r) throw ApiError.notFound('Requirement not found');
    if (r.status !== 'approved') throw ApiError.badRequest('Only approved requirements can be verified');
    if (!req.body.evidence) throw ApiError.badRequest('Verification evidence is required');
    r.verificationEvidence = String(req.body.evidence);
    r.status = 'verified';
    await r.save();
    res.json({ success: true, data: r });
  })
);

router.delete(
  '/requirements/:id',
  requireRole(...(MANAGE as any)),
  asyncHandler(async (req, res) => {
    const r = await SecurityRequirement.findOne({ _id: req.params.id, organizationId: org(req) });
    if (!r) throw ApiError.notFound('Requirement not found');
    await (r as any).softDelete(req.user!.id);
    res.json({ success: true, data: { id: req.params.id, softDeleted: true } });
  })
);

/* ------------------------ Outsourced development ------------------------ */
router.get(
  '/suppliers',
  asyncHandler(async (req, res) => {
    const data = await OutsourcedReview.find({ organizationId: org(req) }).populate('ownerId', 'name').sort('nextReviewAt');
    res.json({ success: true, data });
  })
);

router.post(
  '/suppliers',
  requireRole(...(MANAGE as any)),
  asyncHandler(async (req, res) => {
    const body = stripProtected(req.body);
    if (!body.supplier || !body.scope) throw ApiError.badRequest('supplier and scope are required');
    const s = await OutsourcedReview.create({ ...body, organizationId: org(req) });
    res.status(201).json({ success: true, data: s });
  })
);

router.patch(
  '/suppliers/:id',
  requireRole(...(MANAGE as any)),
  asyncHandler(async (req, res) => {
    const s = await OutsourcedReview.findOne({ _id: req.params.id, organizationId: org(req) });
    if (!s) throw ApiError.notFound('Supplier record not found');
    Object.assign(s, stripProtected(req.body));
    await s.save();
    res.json({ success: true, data: s });
  })
);

router.post(
  '/suppliers/:id/review',
  requireRole(...(MANAGE as any)),
  asyncHandler(async (req, res) => {
    const s = await OutsourcedReview.findOne({ _id: req.params.id, organizationId: org(req) });
    if (!s) throw ApiError.notFound('Supplier record not found');
    s.lastReviewAt = new Date();
    const months = Math.min(Math.max(parseInt(req.body.nextReviewMonths || '6', 10) || 6, 1), 24);
    s.nextReviewAt = new Date(Date.now() + months * 30 * 24 * 3600 * 1000);
    if (req.body.findings) s.findings = String(req.body.findings);
    if (['low', 'medium', 'high'].includes(req.body.riskRating)) s.riskRating = req.body.riskRating;
    await s.save();
    await logActivity({ organizationId: org(req), actorId: req.user!.id, action: 'security.supplier_reviewed', entityType: 'OutsourcedReview', entityId: String(s._id) });
    res.json({ success: true, data: s });
  })
);

router.delete(
  '/suppliers/:id',
  requireRole(...(MANAGE as any)),
  asyncHandler(async (req, res) => {
    const s = await OutsourcedReview.findOne({ _id: req.params.id, organizationId: org(req) });
    if (!s) throw ApiError.notFound('Supplier record not found');
    await (s as any).softDelete(req.user!.id);
    res.json({ success: true, data: { id: req.params.id, softDeleted: true } });
  })
);

/* ------------------------------ Audit log -------------------------------- */
router.get(
  '/audit-log',
  requireRole(...(MANAGE as any)),
  asyncHandler(async (req, res) => {
    const { action, actor, page = '1', limit = '50' } = req.query as Record<string, string>;
    const filter: any = { organizationId: org(req) };
    if (action) filter.action = new RegExp('^' + escapeRegex(action));
    if (actor && /^[a-f0-9]{24}$/.test(actor)) filter.actorId = actor;
    const p = Math.max(parseInt(page, 10) || 1, 1);
    const l = Math.min(Math.max(parseInt(limit, 10) || 50, 1), 200);
    const [data, total] = await Promise.all([
      ActivityLog.find(filter).sort('-createdAt').skip((p - 1) * l).limit(l).populate('actorId', 'name email'),
      ActivityLog.countDocuments(filter),
    ]);
    res.json({ success: true, data, meta: { page: p, limit: l, total } });
  })
);

/* ------------------------------ Consents --------------------------------- */
router.get(
  '/consents',
  requireRole(...(MANAGE as any)),
  asyncHandler(async (_req, res) => {
    const total = await ConsentRecord.countDocuments({});
    const [analytics, preferences, marketing] = await Promise.all([
      ConsentRecord.countDocuments({ analytics: true }),
      ConsentRecord.countDocuments({ preferences: true }),
      ConsentRecord.countDocuments({ marketing: true }),
    ]);
    const recent = await ConsentRecord.find({}).sort('-createdAt').limit(20).select('-userAgent');
    res.json({ success: true, data: { total, analytics, preferences, marketing, recent } });
  })
);

export default router;
