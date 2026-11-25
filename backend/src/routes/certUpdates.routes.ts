import { Router } from 'express';
import { requireAuth } from '../middleware/auth';
import { requireRole } from '../middleware/rbac';
import { asyncHandler } from '../utils/asyncHandler';
import { ApiError } from '../utils/ApiError';
import { cleanHtml, plainText } from '../utils/html';
import { excludeDeleted } from '../utils/softDeletePlugin';
import { Certification } from '../models/Certification';
import { Notification } from '../models/Notification';
import { User } from '../models/User';
import { Task } from '../models/Task';
import { Project } from '../models/Project';
import { Goal } from '../models/Goal';
import { sendMail } from '../services/email.service';
import { logActivity } from '../models/ActivityLog';

const router = Router();
router.use(requireAuth);

const TYPES = ['exam_postponed', 'exam_scheduled', 'meeting', 'training_attached', 'renewal', 'general'];
const TITLES: Record<string, string> = {
  exam_postponed: 'Exam postponed',
  exam_scheduled: 'Exam scheduled',
  meeting: 'Meeting scheduled',
  training_attached: 'New training attached',
  renewal: 'Renewal update',
  general: 'Update',
};

/** Latest updates across every certification the requester can see (employees: their own; managers: all). */
router.get(
  '/updates/feed',
  asyncHandler(async (req, res) => {
    const manager = ['super_admin', 'ceo', 'coo', 'hr'].includes(req.user!.role);
    const filter: any = { organizationId: req.user!.organizationId, 'updates.0': { $exists: true } };
    if (!manager) filter.employeeId = req.user!.id;
    const certs = await Certification.find(excludeDeleted(filter)).select('name provider employeeId updates').populate('employeeId', 'name').populate('updates.authorId', 'name').limit(100);
    const feed = certs
      .flatMap((c: any) => c.updates.map((u: any) => ({ ...u.toObject(), certificationId: c._id, certificationName: c.name, employee: c.employeeId })))
      .sort((a: any, b: any) => +new Date(b.createdAt) - +new Date(a.createdAt))
      .slice(0, 50);
    res.json({ success: true, data: feed });
  })
);

/** Certificates earned through approved work (tasks, milestones, verified goals) — each can be downloaded as a PDF. */
router.get(
  '/earned/list',
  asyncHandler(async (req, res) => {
    const me = req.user!.id;
    const org = req.user!.organizationId;
    const manager = ['super_admin', 'ceo', 'coo', 'hr'].includes(req.user!.role);
    const topLeader = ['super_admin', 'ceo'].includes(req.user!.role);
    const idOf = (v: any) => String(v?._id || v || '');
    const out: any[] = [];

    const tf: any = { organizationId: org, 'approval.status': 'approved' };
    if (!manager) tf.ownerId = me;
    const tasks = await Task.find(excludeDeleted(tf)).select('title ownerId projectId confidential approval completedAt parentTaskId').populate('ownerId', 'name').populate('projectId', 'name').sort({ completedAt: -1 }).limit(300);
    for (const t of tasks as any[]) {
      if (!t.approval?.certificateNo) continue;
      if (t.confidential && !topLeader && idOf(t.ownerId) !== me) continue;
      out.push({ id: `task-${t._id}`, kind: t.parentTaskId ? 'Subtask' : 'Task', title: t.title, recipient: t.ownerId?.name, project: t.projectId?.name, certificateNo: t.approval.certificateNo, ribbon: t.approval.ribbon, date: t.approval.decidedAt || t.completedAt, path: `/tasks/${t._id}/certificate` });
    }

    const projects = await Project.find(excludeDeleted({ organizationId: org, 'milestones.approval.status': 'approved' })).select('name milestones projectManagerId').populate('milestones.ownerId', 'name').populate('projectManagerId', 'name');
    for (const p of projects as any[]) {
      for (const m of p.milestones || []) {
        if (m.approval?.status !== 'approved' || !m.approval.certificateNo) continue;
        const owner = m.ownerId || p.projectManagerId;
        if (!manager && idOf(owner) !== me) continue;
        out.push({ id: `mile-${m._id}`, kind: 'Milestone', title: m.title, recipient: owner?.name, project: p.name, certificateNo: m.approval.certificateNo, ribbon: m.approval.ribbon, date: m.approval.decidedAt || m.completedAt, path: `/projects/${p._id}/milestones/${m._id}/certificate` });
      }
    }

    const gf: any = { organizationId: org, certificateNo: { $exists: true, $ne: null } };
    if (!manager) gf.ownerId = me;
    const goals = await Goal.find(excludeDeleted(gf)).select('title ownerId quarter certificateNo verifiedAt completedAt').populate('ownerId', 'name');
    for (const g of goals as any[]) {
      if (!g.verifiedAt) continue;
      out.push({ id: `goal-${g._id}`, kind: 'Goal', title: g.title, recipient: g.ownerId?.name, project: g.quarter, certificateNo: g.certificateNo, ribbon: g.quarter ? `Goal achieved · ${g.quarter}` : 'Goal achieved', date: g.verifiedAt, path: `/goals/${g._id}/certificate` });
    }

    out.sort((a, b) => +new Date(b.date || 0) - +new Date(a.date || 0));
    res.json({ success: true, data: out });
  })
);

/** Attach (or replace) the certificate file for a certification. HR/leadership, or the employee it belongs to. */
router.put(
  '/:id/certificate-file',
  asyncHandler(async (req, res) => {
    const c = await Certification.findOne(excludeDeleted({ _id: req.params.id, organizationId: req.user!.organizationId }));
    if (!c) throw ApiError.notFound('Certification not found');
    const manager = ['super_admin', 'ceo', 'coo', 'hr'].includes(req.user!.role);
    if (!manager && String(c.employeeId) !== req.user!.id) throw ApiError.forbidden('You can only upload a certificate for your own certification.');
    const url = String(req.body.url || '');
    if (!/^\/api\/uploads\/|^\/uploads\//.test(url)) throw ApiError.badRequest('Upload the file first, then attach it.');
    (c as any).certificateFile = { name: String(req.body.name || 'certificate').slice(0, 200), url, mimeType: String(req.body.mimeType || ''), size: Number(req.body.size) || 0, uploadedById: req.user!.id, uploadedAt: new Date() };
    await c.save();
    await logActivity({ organizationId: req.user!.organizationId, actorId: req.user!.id, action: 'certification.file_uploaded', entityType: 'Certification', entityId: String(c._id) });
    res.json({ success: true, data: (c as any).certificateFile });
  })
);

router.delete(
  '/:id/certificate-file',
  asyncHandler(async (req, res) => {
    const c = await Certification.findOne(excludeDeleted({ _id: req.params.id, organizationId: req.user!.organizationId }));
    if (!c) throw ApiError.notFound('Certification not found');
    const manager = ['super_admin', 'ceo', 'coo', 'hr'].includes(req.user!.role);
    if (!manager && String(c.employeeId) !== req.user!.id) throw ApiError.forbidden('You can only change your own certification.');
    (c as any).certificateFile = undefined;
    await c.save();
    res.json({ success: true, data: null });
  })
);

router.get(
  '/:id/updates',
  asyncHandler(async (req, res) => {
    const c = await Certification.findOne(excludeDeleted({ _id: req.params.id, organizationId: req.user!.organizationId }))
      .populate('updates.authorId', 'name')
      .populate('updates.courseId', 'title')
      .populate('updates.meetingId', 'title date');
    if (!c) throw ApiError.notFound('Certification not found');
    const manager = ['super_admin', 'ceo', 'coo', 'hr'].includes(req.user!.role);
    if (!manager && String(c.employeeId) !== req.user!.id) throw ApiError.forbidden('You can only view updates for your own certifications.');
    res.json({ success: true, data: [...c.updates].reverse() });
  })
);

router.post(
  '/:id/updates',
  requireRole('hr', 'coo', 'ceo'),
  asyncHandler(async (req, res) => {
    const c = await Certification.findOne(excludeDeleted({ _id: req.params.id, organizationId: req.user!.organizationId }));
    if (!c) throw ApiError.notFound('Certification not found');
    const type = TYPES.includes(req.body.type) ? req.body.type : 'general';
    const title = String(req.body.title || TITLES[type]).slice(0, 160);
    const body = cleanHtml(req.body.body || '');
    const newDate = req.body.newDate ? new Date(req.body.newDate) : undefined;
    if (newDate && isNaN(+newDate)) throw ApiError.badRequest('Invalid date');
    const links = Array.isArray(req.body.links)
      ? req.body.links.filter((l: any) => l && /^https?:\/\//i.test(String(l.url))).slice(0, 10).map((l: any) => ({ label: String(l.label || l.url).slice(0, 120), url: String(l.url) }))
      : [];
    const update: any = { type, title, body, newDate, links, authorId: req.user!.id, createdAt: new Date() };
    if (req.body.courseId && /^[a-f0-9]{24}$/.test(req.body.courseId)) update.courseId = req.body.courseId;
    if (req.body.meetingId && /^[a-f0-9]{24}$/.test(req.body.meetingId)) update.meetingId = req.body.meetingId;
    c.updates.push(update);
    // Keep the certificate's own dates in step with a postponement / renewal.
    if (newDate && ['exam_postponed', 'renewal'].includes(type) && c.expiryDate && type === 'renewal') c.expiryDate = newDate;
    await c.save();

    await logActivity({ organizationId: req.user!.organizationId, actorId: req.user!.id, action: 'certification.update_added', entityType: 'Certification', entityId: String(c._id), meta: { type } });

    const employee = await User.findById(c.employeeId).select('name email');
    if (employee) {
      await Notification.create({ organizationId: req.user!.organizationId, userId: employee._id, type: 'certification', title: `${c.name}: ${title}`, body: plainText(body, 140), link: '/certifications' });
      await sendMail({ to: employee.email, subject: `Certification update — ${c.name}: ${title}`, html: `<p>Hello ${employee.name},</p><p><strong>${title}</strong></p>${body}${newDate ? `<p>New date: ${newDate.toDateString()}</p>` : ''}` });
    }
    res.status(201).json({ success: true, data: [...c.updates].reverse() });
  })
);

router.delete(
  '/:id/updates/:updateId',
  requireRole('hr', 'coo', 'ceo'),
  asyncHandler(async (req, res) => {
    const c = await Certification.findOne(excludeDeleted({ _id: req.params.id, organizationId: req.user!.organizationId }));
    if (!c) throw ApiError.notFound('Certification not found');
    const u: any = (c.updates as any).id(req.params.updateId);
    if (!u) throw ApiError.notFound('Update not found');
    u.deleteOne();
    await c.save();
    res.json({ success: true, data: [...c.updates].reverse() });
  })
);

export default router;
