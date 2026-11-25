import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import { z } from 'zod';
import { requireAuth } from '../middleware/auth';
import { requireRole } from '../middleware/rbac';
import { hashIp, stripProtected } from '../middleware/security';
import { asyncHandler } from '../utils/asyncHandler';
import { ApiError } from '../utils/ApiError';
import { escapeRegex } from '../utils/escapeRegex';
import { excludeDeleted } from '../utils/softDeletePlugin';
import { Ticket } from '../models/Ticket';
import { User } from '../models/User';
import { Notification } from '../models/Notification';
import { Organization } from '../models/Organization';
import { sendMail } from '../services/email.service';
import { logActivity } from '../models/ActivityLog';
import { notifyMentions } from '../utils/mentions';
import { cleanHtml } from '../utils/html';

/** Only these two roles can act on tickets; everyone else gets read-only access to the tickets they can see. */
const MANAGE_ROLES = ['super_admin', 'ceo'] as const;
const isManager = (role: string) => (MANAGE_ROLES as readonly string[]).includes(role);

const router = Router();

const stripTags = (s: string) => s.replace(/<[^>]*>/g, '').replace(/\s+\n/g, '\n').trim();

const publicLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: 8,
  standardHeaders: true,
  legacyHeaders: false,
  message: { success: false, message: 'Too many messages from this network. Please try again later or email talk2us@globalsjxltd.com.' },
});

const contactSchema = z.object({
  name: z.string().trim().min(2).max(120),
  email: z.string().trim().email().max(200),
  phone: z.string().trim().max(40).optional(),
  company: z.string().trim().max(160).optional(),
  subject: z.string().trim().max(200).optional(),
  message: z.string().trim().min(10).max(5000),
  website_url: z.string().optional(), // honeypot — real users never fill this
});

/** PUBLIC — website "Contact us" form. No account required. */
router.post(
  '/public/contact',
  publicLimiter,
  asyncHandler(async (req, res) => {
    const parsed = contactSchema.safeParse(req.body);
    if (!parsed.success) throw ApiError.badRequest('Please provide your name, a valid email and a message (10+ characters).');
    // Honeypot tripped: pretend success, store nothing.
    if (parsed.data.website_url) return res.status(201).json({ success: true, data: { received: true } });

    const org = await Organization.findOne({ isInternal: true });
    if (!org) throw ApiError.badRequest('Service desk not initialised');
    const d = parsed.data;
    const subject = stripTags(d.subject || `Website enquiry from ${d.name}`);
    const lines = [stripTags(d.message)];
    if (d.company) lines.push(`Company: ${stripTags(d.company)}`);
    if (d.phone) lines.push(`Phone: ${stripTags(d.phone)}`);

    const ticket = await Ticket.create({
      organizationId: org._id,
      subject,
      description: lines.join('\n\n'),
      requesterName: stripTags(d.name),
      requesterEmail: d.email,
      source: 'website',
      category: 'website',
      priority: 'medium',
      ipHash: hashIp(req.ip),
    });

    const admins = await User.find({ organizationId: org._id, role: { $in: MANAGE_ROLES as any }, isActive: true }).select('_id email name');
    await Notification.insertMany(
      admins.map((a: any) => ({ organizationId: org._id, userId: a._id, type: 'ticket', title: 'New website enquiry', body: `${d.name}: ${subject}`, link: '/tickets' }))
    );
    await Promise.allSettled([
      ...admins.map((a: any) => sendMail({ to: a.email, subject: `New website enquiry: ${subject}`, html: `<p><strong>${stripTags(d.name)}</strong> (${d.email}) wrote:</p><p>${lines.join('<br/><br/>').replace(/</g, '&lt;')}</p>` })),
      sendMail({ to: d.email, subject: 'We received your message — Global SJX', html: `<p>Hello ${stripTags(d.name).replace(/</g, '')},</p><p>Thank you for contacting Global SJX Limited. Our team will reply shortly.</p><p>Reference: ${ticket._id}</p>` }),
    ]);
    res.status(201).json({ success: true, data: { received: true, reference: String(ticket._id).slice(-8).toUpperCase() } });
  })
);

router.use(requireAuth);

/** Staff see everything on the desk (read-only unless CEO/admin). External roles only ever see tickets they raised. */
function visibilityFilter(req: any) {
  const external = ['client', 'vendor', 'training_customer'].includes(req.user.role);
  return external ? { requesterId: req.user.id } : {};
}

router.get(
  '/',
  asyncHandler(async (req, res) => {
    const { q, status, source } = req.query as Record<string, string>;
    const filter: any = { organizationId: req.user!.organizationId, ...visibilityFilter(req) };
    if (status) filter.status = status;
    if (source) filter.source = source;
    if (q) {
      const rx = new RegExp(escapeRegex(q), 'i');
      filter.$or = [{ subject: rx }, { requesterName: rx }, { requesterEmail: rx }];
    }
    const data = await Ticket.find(excludeDeleted(filter)).populate('requesterId assigneeId', 'name email').sort('-createdAt').limit(200);
    res.json({ success: true, data });
  })
);

router.get(
  '/:id',
  asyncHandler(async (req, res) => {
    const t = await Ticket.findOne(excludeDeleted({ _id: req.params.id, organizationId: req.user!.organizationId, ...visibilityFilter(req) }))
      .populate('requesterId assigneeId', 'name email')
      .populate('replies.authorId', 'name');
    if (!t) throw ApiError.notFound('Ticket not found');
    const obj: any = t.toObject();
    // Internal notes are never shown to non-managers.
    if (!isManager(req.user!.role)) obj.replies = (obj.replies || []).filter((r: any) => !r.internal);
    res.json({ success: true, data: obj });
  })
);

const createSchema = z.object({
  subject: z.string().trim().min(3).max(200),
  description: z.string().trim().min(3).max(20000),
  category: z.enum(['technical', 'billing', 'access', 'general', 'academy_beta']).default('general'),
  priority: z.enum(['low', 'medium', 'high', 'critical']).default('medium'),
});

router.post(
  '/',
  asyncHandler(async (req, res) => {
    const parsed = createSchema.safeParse(req.body);
    if (!parsed.success) throw ApiError.badRequest('Please provide a subject and description', parsed.error.flatten());
    const t = await Ticket.create({ ...parsed.data, description: cleanHtml(parsed.data.description), organizationId: req.user!.organizationId, requesterId: req.user!.id, requesterName: req.user!.name, requesterEmail: req.user!.email, source: 'internal' });
    const admins = await User.find({ organizationId: req.user!.organizationId, role: { $in: MANAGE_ROLES as any }, isActive: true, _id: { $ne: req.user!.id } }).select('_id');
    await Notification.insertMany(admins.map((a: any) => ({ organizationId: req.user!.organizationId, userId: a._id, type: 'ticket', title: parsed.data.category === 'academy_beta' ? 'Academy Beta feedback' : 'New support ticket', body: parsed.data.subject, link: '/tickets' })));
    res.status(201).json({ success: true, data: t });
  })
);

router.patch(
  '/:id',
  requireRole(...(MANAGE_ROLES as any)),
  asyncHandler(async (req, res) => {
    const t = await Ticket.findOne(excludeDeleted({ _id: req.params.id, organizationId: req.user!.organizationId }));
    if (!t) throw ApiError.notFound('Ticket not found');
    const body = stripProtected(req.body, ['requesterId', 'requesterEmail', 'requesterName', 'source', 'replies', 'ipHash']);
    Object.assign(t, body);
    if (body.status === 'resolved' || body.status === 'closed') t.resolvedAt = t.resolvedAt || new Date();
    await t.save();
    await logActivity({ organizationId: req.user!.organizationId, actorId: req.user!.id, action: 'ticket.updated', entityType: 'Ticket', entityId: String(t._id), meta: { status: t.status } });
    if (t.requesterId && String(t.requesterId) !== req.user!.id && body.status) {
      await Notification.create({ organizationId: req.user!.organizationId, userId: t.requesterId, type: 'ticket', title: `Your ticket is now ${String(t.status).replace(/_/g, ' ')}`, body: t.subject, link: '/tickets' });
    }
    res.json({ success: true, data: t });
  })
);

router.post(
  '/:id/replies',
  requireRole(...(MANAGE_ROLES as any)),
  asyncHandler(async (req, res) => {
    const body = cleanHtml(String(req.body.body || '')).trim();
    if (!body) throw ApiError.badRequest('Reply cannot be empty');
    const t = await Ticket.findOne(excludeDeleted({ _id: req.params.id, organizationId: req.user!.organizationId }));
    if (!t) throw ApiError.notFound('Ticket not found');
    const internal = !!req.body.internal;
    t.replies.push({ authorId: req.user!.id as any, body, internal } as any);
    if (t.status === 'open') t.status = 'in_progress';
    await t.save();
    if (!internal) {
      if (t.requesterId) await Notification.create({ organizationId: req.user!.organizationId, userId: t.requesterId, type: 'ticket', title: 'New reply on your ticket', body: t.subject, link: '/tickets' });
      if (t.requesterEmail && t.source === 'website') await sendMail({ to: t.requesterEmail, subject: `Re: ${t.subject}`, html: `<div>${body}</div><p style="color:#888">— Global SJX Limited</p>` });
    }
    await notifyMentions({ text: body, organizationId: req.user!.organizationId, actorId: req.user!.id, actorName: req.user!.name, title: 'You were mentioned on a ticket', link: '/tickets' });
    res.status(201).json({ success: true, data: t });
  })
);

router.delete(
  '/:id',
  requireRole(...(MANAGE_ROLES as any)),
  asyncHandler(async (req, res) => {
    const t = await Ticket.findOne(excludeDeleted({ _id: req.params.id, organizationId: req.user!.organizationId }));
    if (!t) throw ApiError.notFound('Ticket not found');
    await (t as any).softDelete(req.user!.id);
    res.json({ success: true, data: { id: req.params.id, softDeleted: true } });
  })
);

router.post(
  '/:id/restore',
  requireRole(...(MANAGE_ROLES as any)),
  asyncHandler(async (req, res) => {
    const t = await Ticket.findOne({ _id: req.params.id, organizationId: req.user!.organizationId, isDeleted: true });
    if (!t) throw ApiError.notFound('Deleted ticket not found');
    await (t as any).restore();
    res.json({ success: true, data: t });
  })
);

export default router;
