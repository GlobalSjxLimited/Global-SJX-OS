import { Router } from 'express';
import { z } from 'zod';
import { requireModule } from '../middleware/modules';
import { asyncHandler } from '../utils/asyncHandler';
import { ApiError } from '../utils/ApiError';
import { audit } from '../services/audit.service';
import { SupplierAssessment } from '../models/Supplier';
import { Vendor } from '../models/Vendor';
import * as svc from '../services/supplier.service';
import { QUESTIONS } from '../config/supplierQuestionnaire';

const router = Router();
router.use(requireModule('supplier_assessments', 'isms', 'vendors'));
const org = (req: any) => String(req.user.organizationId);
const actor = (req: any) => ({ id: req.user.id as string, name: req.user.name as string });
const oid = z.string().regex(/^[a-f0-9]{24}$/i);

router.get('/questions', (_req, res) => { res.json({ success: true, data: QUESTIONS }); });
router.get('/vendors/list', asyncHandler(async (req, res) => {
  const v: any[] = await Vendor.find({ organizationId: org(req), isDeleted: { $ne: true }, status: 'active' }).select('name email contacts').sort('name').limit(300).lean();
  res.json({ success: true, data: v.map((x) => ({ _id: String(x._id), name: x.name, email: x.email, contacts: (x.contacts || []).map((c: any) => ({ name: c.name, email: c.email, isPrimary: c.isPrimary })) })) });
}));
router.get('/', asyncHandler(async (req, res) => {
  const f: any = { organizationId: org(req) }; if (req.query.status) f.status = { $in: String(req.query.status).split(',') };
  res.json({ success: true, data: (await SupplierAssessment.find(f).sort({ createdAt: -1 }).limit(300)).map((a) => svc.view(a, false)) });
}));
router.get('/:id', asyncHandler(async (req, res) => {
  oid.parse(req.params.id); const a = await SupplierAssessment.findOne({ _id: req.params.id, organizationId: org(req) }); if (!a) throw ApiError.notFound('Not found');
  res.json({ success: true, data: svc.view(a, true) });
}));
router.post('/', asyncHandler(async (req, res) => {
  const b = z.object({ vendorId: oid.optional(), supplier: z.string().trim().max(160).optional(), contactName: z.string().trim().max(120).optional(), contactEmail: z.string().trim().email().max(200), message: z.string().max(1000).optional(), days: z.number().int().min(3).max(60).optional() }).parse(req.body);
  const r = await svc.create(org(req), b, actor(req));
  await audit(req, 'supplier.questionnaire_sent', 'SupplierAssessment', String(r.assessment._id), { module: 'supplier_assessments', severity: 'low', summary: `${r.assessment.reference} ${r.assessment.supplier}` });
  res.status(201).json({ success: true, data: { ...svc.view(r.assessment, false), link: r.link } });
}));
router.post('/:id/resend', asyncHandler(async (req, res) => {
  oid.parse(req.params.id); const r = await svc.resend(org(req), req.params.id, actor(req));
  await audit(req, 'supplier.questionnaire_resent', 'SupplierAssessment', req.params.id, { module: 'supplier_assessments', severity: 'info', summary: r.assessment.reference });
  res.json({ success: true, data: { ...svc.view(r.assessment, false), link: r.link } });
}));
router.post('/:id/revoke', asyncHandler(async (req, res) => {
  oid.parse(req.params.id); const a = await svc.revoke(org(req), req.params.id, actor(req));
  await audit(req, 'supplier.questionnaire_revoked', 'SupplierAssessment', req.params.id, { module: 'supplier_assessments', severity: 'low', summary: a.reference });
  res.json({ success: true, data: svc.view(a, false) });
}));
router.post('/:id/review', asyncHandler(async (req, res) => {
  oid.parse(req.params.id);
  const b = z.object({ decision: z.enum(['accepted', 'accepted_with_conditions', 'rejected']), note: z.string().max(1000).optional(), riskRating: z.enum(['low', 'medium', 'high']).optional(), nextReviewMonths: z.number().int().min(1).max(24).optional() }).parse(req.body);
  const a = await svc.review(org(req), req.params.id, b, actor(req));
  await audit(req, 'supplier.reviewed', 'SupplierAssessment', req.params.id, { module: 'supplier_assessments', severity: b.decision === 'rejected' ? 'high' : 'medium', summary: `${a.reference} ${b.decision}` });
  res.json({ success: true, data: svc.view(a, true) });
}));
export default router;
