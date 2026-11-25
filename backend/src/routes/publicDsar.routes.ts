import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import { z } from 'zod';
import { asyncHandler } from '../utils/asyncHandler';
import { ApiError } from '../utils/ApiError';
import { Organization } from '../models/Organization';
import { DataSubjectRequest } from '../models/Governance';
import { nextNumber } from '../models/Access';
import { usersWithModule } from '../services/access.service';
import { notify } from '../services/notify.service';
import { sendMail } from '../services/email.service';
import { logger } from '../utils/logger';

/**
 * Public data-subject request form. No sign-in. The 30-day clock starts when the request is received.
 * The person must still be identity-verified by staff before anything is disclosed or deleted.
 * NOTE: the 30-day period follows the usual NDPA/GDPR convention – the data-protection officer should confirm the period that applies to you.
 */
const router = Router();
router.use(rateLimit({ windowMs: 60 * 60 * 1000, max: 6, standardHeaders: true, legacyHeaders: false, message: { success: false, message: 'Too many requests from this address. Please try again later.' } }));

const TYPES = ['access', 'rectification', 'erasure', 'restriction', 'portability', 'objection', 'withdraw_consent'] as const;
const form = z.object({
  type: z.enum(TYPES), name: z.string().trim().min(2).max(120), email: z.string().trim().email().max(200), phone: z.string().trim().max(40).optional(),
  relationship: z.enum(['employee', 'client', 'vendor', 'academy_learner', 'website_visitor', 'other']).default('other'),
  details: z.string().trim().max(3000).optional(), website: z.string().max(200).optional(), // honeypot
});

router.get('/types', (_req, res) => { res.json({ success: true, data: TYPES }); });

router.post('/', asyncHandler(async (req, res) => {
  const b = form.parse(req.body);
  if (b.website) { res.status(201).json({ success: true, data: { reference: 'DSR-RECEIVED' } }); return; } // bots get a fake success and nothing is stored
  const org: any = await Organization.findOne({ isInternal: true }).select('_id name');
  if (!org) throw ApiError.notFound('Not available');
  const orgId = String(org._id);
  const dpo = (await usersWithModule(orgId, 'data_protection')).map((u: any) => String(u._id));
  const now = new Date();
  const r: any = await DataSubjectRequest.create({
    organizationId: orgId, reference: await nextNumber(orgId, 'DSR', { yearly: true, pad: 4 }), type: b.type,
    requester: { name: b.name, email: b.email, phone: b.phone, relationship: b.relationship }, details: b.details, receivedAt: now,
    dueAt: new Date(now.getTime() + 30 * 86400000), source: 'website', status: 'received', assigneeId: dpo[0],
    timeline: [{ at: now, byName: 'Public form', text: 'Request received through the website form — 30-day response clock started. Identity not yet verified.' }],
  });
  await notify({ organizationId: orgId, userIds: dpo, title: `New data-subject request ${r.reference} (${b.type.replace('_', ' ')})`, body: `${b.name} <${b.email}> submitted a request through the website. Verify their identity first. Respond by ${r.dueAt.toISOString().slice(0, 10)}.`, link: '/data-protection', type: 'reminder', severity: b.type === 'erasure' ? 'high' : 'warning', category: 'system', dedupeKey: `dsar-new:${r._id}`, email: { intro: `${b.name} submitted a ${b.type.replace('_', ' ')} request. Reference ${r.reference}. Respond by ${r.dueAt.toISOString().slice(0, 10)}.`, ctaLabel: 'Open the request' } });
  sendMail({ to: b.email, subject: `We received your request ${r.reference}`, html: `<p>Hello ${b.name.replace(/[<>&]/g, '')},</p><p>${org.name} has received your ${b.type.replace('_', ' ')} request. Your reference is <b>${r.reference}</b>.</p><p>We will first confirm your identity, then reply by <b>${r.dueAt.toISOString().slice(0, 10)}</b>. Please keep this reference.</p>` }).catch((err) => logger.warn({ err }, 'DSAR acknowledgement not sent'));
  res.status(201).json({ success: true, data: { reference: r.reference, respondBy: r.dueAt } });
}));

/** Status check: needs both the reference and the e-mail used, and reveals nothing but status and date. */
router.post('/status', asyncHandler(async (req, res) => {
  const b = z.object({ reference: z.string().trim().max(40), email: z.string().trim().email() }).parse(req.body);
  const r: any = await DataSubjectRequest.findOne({ reference: b.reference, 'requester.email': new RegExp(`^${b.email.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, 'i') }).select('status dueAt receivedAt type').lean();
  if (!r) throw ApiError.notFound('No request matches that reference and e-mail');
  res.json({ success: true, data: { status: r.status, type: r.type, receivedAt: r.receivedAt, respondBy: r.dueAt } });
}));

export default router;
