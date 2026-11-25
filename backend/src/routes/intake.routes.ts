import crypto from 'crypto';
import { Router } from 'express';
import multer from 'multer';
import rateLimit from 'express-rate-limit';
import { z } from 'zod';
import { requireAuth } from '../middleware/auth';
import { requireModule } from '../middleware/modules';
import { asyncHandler } from '../utils/asyncHandler';
import { ApiError } from '../utils/ApiError';
import { Organization } from '../models/Organization';
import { EmailIntakeLog, EmailIntakeRule } from '../models/EmailIntake';
import { User } from '../models/User';
import { audit } from '../services/audit.service';
import { processInboundEmail } from '../services/emailIntake.service';
import { logger } from '../utils/logger';
import { env } from '../config/env';

const router = Router();

/* ---------------------------------------------------------------------------
 * Public webhook — secured by a per-organisation secret, not by a login.
 *   POST /api/intake/email/:orgId      header  x-intake-secret: <secret>
 * Accepts JSON {from, fromName, subject, text, html, messageId}, or the form
 * fields posted by SendGrid Inbound Parse / Mailgun routes.
 * ------------------------------------------------------------------------- */
const hookLimiter = rateLimit({ windowMs: 60 * 1000, max: 60, standardHeaders: true, legacyHeaders: false, message: { success: false, message: 'Too many messages' } });
const form = multer({ limits: { fileSize: 1024 * 1024, files: 0, fields: 60 } }).none();

const sha = (s: string) => crypto.createHash('sha256').update(s).digest('hex');
const safeEq = (a: string, b: string) => { const x = Buffer.from(a); const y = Buffer.from(b); return x.length === y.length && crypto.timingSafeEqual(x, y); };

router.post('/email/:orgId', hookLimiter, form, asyncHandler(async (req, res) => {
  const supplied = String(req.headers['x-intake-secret'] || req.query.secret || '');
  const org = await Organization.findOne({ _id: req.params.orgId.match(/^[a-f\d]{24}$/i) ? req.params.orgId : null, isActive: true }).select('+intake.secretHash intake');
  // Same answer for "no such organisation" and "wrong secret" so ids cannot be probed.
  if (!org || !org.intake?.enabled || !(org.intake as any).secretHash || !supplied || !safeEq(sha(supplied), String((org.intake as any).secretHash))) {
    logger.warn({ ip: req.ip, orgId: req.params.orgId }, 'intake webhook rejected');
    throw ApiError.unauthorized('Invalid intake credentials');
  }
  const b: any = req.body || {};
  const fromRaw = String(b.from || b.sender || b.From || '');
  const nameMatch = fromRaw.match(/^\s*"?([^"<]+?)"?\s*</);
  const mail = {
    messageId: String(b.messageId || b['Message-Id'] || b['message-id'] || b['Message-ID'] || '').replace(/^<|>$/g, '') || undefined,
    from: fromRaw,
    fromName: b.fromName || (nameMatch ? nameMatch[1].trim() : undefined),
    subject: String(b.subject || b.Subject || ''),
    text: String(b.text || b['body-plain'] || b['stripped-text'] || ''),
    html: b.html || b['body-html'] ? String(b.html || b['body-html']) : undefined,
  };
  const result = await processInboundEmail(String(org._id), mail, { channel: 'webhook' });
  // Never reveal matching details to the caller — the outcome is in the admin log.
  res.status(result.outcome === 'error' ? 500 : 202).json({ success: result.outcome !== 'error', received: true });
}));

/* ---------------------------------------------------------------------------
 * Admin API (module "intake")
 * ------------------------------------------------------------------------- */
router.use(requireAuth, requireModule('intake'));

const blank = (v: unknown) => (v === '' || v === null ? undefined : v);
const oidStr = z.preprocess(blank, z.string().regex(/^[a-f\d]{24}$/i, 'Invalid id').optional());
const list = (max: number) => z.array(z.string().trim().min(1).max(100)).max(max);
const ruleBody = z.object({
  name: z.string().trim().min(1, 'Rule name is required').max(120),
  active: z.boolean().default(true),
  keywords: list(40).default([]).transform((a) => Array.from(new Set(a.map((k) => k.toLowerCase())))),
  matchMode: z.enum(['any', 'all']).default('any'),
  organisations: list(40).default([]),
  requireOrganisation: z.boolean().default(true),
  senderDomains: list(40).default([]).transform((a) => a.map((d) => d.toLowerCase().replace(/^@/, ''))),
  allowUnknownSenders: z.boolean().default(false),
  acknowledgeSender: z.boolean().default(false),
  defaultAssigneeId: oidStr,
  defaultProjectId: oidStr,
  defaultPriority: z.enum(['low', 'medium', 'high', 'urgent']).default('medium'),
  defaultSeverity: z.enum(['trivial', 'minor', 'major', 'critical', 'show_stopper']).default('minor'),
  dueInDays: z.coerce.number().int().min(0).max(365).default(7),
  notifyUserIds: z.array(z.string().regex(/^[a-f\d]{24}$/i)).max(20).default([]),
});

router.get('/rules', asyncHandler(async (req, res) => {
  const rules = await EmailIntakeRule.find({ organizationId: req.user!.organizationId }).populate('defaultAssigneeId', 'name').populate('defaultProjectId', 'name').sort('createdAt');
  res.json({ success: true, data: rules });
}));

router.post('/rules', asyncHandler(async (req, res) => {
  const d = ruleBody.parse(req.body);
  if (!d.keywords.length) throw ApiError.badRequest('Add at least one keyword (for example: task, training, audit)');
  if (d.defaultAssigneeId && !(await User.exists({ _id: d.defaultAssigneeId, organizationId: req.user!.organizationId, isActive: true }))) throw ApiError.badRequest('Default assignee not found');
  const rule = await EmailIntakeRule.create({ ...d, organizationId: req.user!.organizationId, createdById: req.user!.id });
  await audit(req, 'intake.rule_created', 'EmailIntakeRule', String(rule._id), { module: 'intake', summary: `Created e-mail intake rule "${rule.name}"`, meta: { keywords: d.keywords, organisations: d.organisations } });
  res.status(201).json({ success: true, data: rule });
}));

router.patch('/rules/:id', asyncHandler(async (req, res) => {
  const rule = await EmailIntakeRule.findOne({ _id: req.params.id, organizationId: req.user!.organizationId });
  if (!rule) throw ApiError.notFound('Rule not found');
  const d = ruleBody.partial().parse(req.body);
  if (d.keywords && !d.keywords.length) throw ApiError.badRequest('A rule needs at least one keyword');
  Object.assign(rule, Object.fromEntries(Object.entries(d).filter(([, v]) => v !== undefined)));
  await rule.save();
  await audit(req, 'intake.rule_updated', 'EmailIntakeRule', String(rule._id), { module: 'intake', summary: `Updated e-mail intake rule "${rule.name}"`, meta: { fields: Object.keys(d) } });
  res.json({ success: true, data: rule });
}));

router.delete('/rules/:id', asyncHandler(async (req, res) => {
  const rule = await EmailIntakeRule.findOneAndDelete({ _id: req.params.id, organizationId: req.user!.organizationId });
  if (!rule) throw ApiError.notFound('Rule not found');
  await audit(req, 'intake.rule_deleted', 'EmailIntakeRule', String(rule._id), { module: 'intake', severity: 'medium', summary: `Deleted e-mail intake rule "${rule.name}"` });
  res.json({ success: true, data: { ok: true } });
}));

router.get('/log', asyncHandler(async (req, res) => {
  const q = req.query as Record<string, string>;
  const filter: Record<string, unknown> = { organizationId: req.user!.organizationId };
  if (q.outcome) filter.outcome = q.outcome;
  const page = Math.max(parseInt(q.page, 10) || 1, 1); const limit = Math.min(parseInt(q.limit, 10) || 25, 100);
  const [items, total] = await Promise.all([
    EmailIntakeLog.find(filter).populate('ruleId', 'name').populate('taskId', 'title').sort('-createdAt').skip((page - 1) * limit).limit(limit),
    EmailIntakeLog.countDocuments(filter),
  ]);
  res.json({ success: true, data: items, pagination: { page, limit, total, pages: Math.ceil(total / limit) } });
}));

/** "Create task anyway" for a message that did not match. */
router.post('/log/:id/create-task', asyncHandler(async (req, res) => {
  const entry = await EmailIntakeLog.findOne({ _id: req.params.id, organizationId: req.user!.organizationId }).select('+body');
  if (!entry) throw ApiError.notFound('Message not found');
  if (entry.taskId) throw ApiError.conflict('A task was already created from this message');
  const { ruleId } = z.object({ ruleId: oidStr }).parse(req.body);
  const result = await processInboundEmail(req.user!.organizationId, { messageId: entry.messageId || undefined, from: entry.from || '', fromName: entry.fromName || undefined, subject: entry.subject || '', text: (entry as any).body || entry.snippet || '' }, { channel: 'manual', force: true, forceRuleId: ruleId });
  if (result.outcome === 'task_created') await EmailIntakeLog.updateOne({ _id: entry._id }, { $set: { outcome: 'task_created', taskId: result.taskId, ruleId: result.ruleId, reason: 'Created manually by an administrator' } });
  await audit(req, 'intake.task_forced', 'EmailIntakeLog', String(entry._id), { module: 'intake', summary: 'Created a task from an unmatched e-mail', meta: { result: result.outcome } });
  res.json({ success: true, data: result });
}));

/** Dry-run: shows exactly why a message would or would not become a task. Nothing is saved. */
router.post('/test', asyncHandler(async (req, res) => {
  const d = z.object({ from: z.string().email(), subject: z.string().max(300).default(''), text: z.string().max(20000).default('') }).parse(req.body);
  const result = await processInboundEmail(req.user!.organizationId, { from: d.from, subject: d.subject, text: d.text }, { channel: 'test', dryRun: true });
  res.json({ success: true, data: result });
}));

router.get('/settings', asyncHandler(async (req, res) => {
  const org = await Organization.findById(req.user!.organizationId).select('intake');
  res.json({
    success: true,
    data: {
      enabled: org?.intake?.enabled !== false, secretHint: org?.intake?.secretHint || null, rotatedAt: org?.intake?.rotatedAt || null,
      webhookUrl: `${env.appUrl.replace(/\/$/, '')}/api/intake/email/${req.user!.organizationId}`,
      imapConfigured: !!process.env.INTAKE_IMAP_HOST,
    },
  });
}));

router.patch('/settings', asyncHandler(async (req, res) => {
  const { enabled } = z.object({ enabled: z.boolean() }).parse(req.body);
  await Organization.updateOne({ _id: req.user!.organizationId }, { $set: { 'intake.enabled': enabled } });
  await audit(req, 'intake.toggled', 'Organization', req.user!.organizationId, { module: 'intake', severity: 'medium', summary: `E-mail intake ${enabled ? 'enabled' : 'disabled'}` });
  res.json({ success: true, data: { enabled } });
}));

/** Generates a new webhook secret. It is shown exactly once; only a hash is stored. */
router.post('/settings/rotate-secret', asyncHandler(async (req, res) => {
  if (!['super_admin', 'ceo', 'coo'].includes(req.user!.role)) throw ApiError.forbidden('Only leadership can rotate the intake secret');
  const secret = crypto.randomBytes(32).toString('hex');
  await Organization.updateOne({ _id: req.user!.organizationId }, { $set: { 'intake.secretHash': sha(secret), 'intake.secretHint': `…${secret.slice(-4)}`, 'intake.rotatedAt': new Date(), 'intake.enabled': true } });
  await audit(req, 'intake.secret_rotated', 'Organization', req.user!.organizationId, { module: 'intake', severity: 'high', summary: 'Rotated the e-mail intake webhook secret' });
  res.json({ success: true, data: { secret, note: 'Copy this now — it will not be shown again.' } });
}));

export default router;
