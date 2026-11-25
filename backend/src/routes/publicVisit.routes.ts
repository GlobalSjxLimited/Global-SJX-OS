import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import { z } from 'zod';
import { asyncHandler } from '../utils/asyncHandler';
import { ApiError } from '../utils/ApiError';
import { Organization } from '../models/Organization';
import { Visit } from '../models/Visitor';
import * as svc from '../services/visitor.service';

/** Public booking link. No sign-in. Only people who switched on online booking can be booked. */
const router = Router();
router.use(rateLimit({ windowMs: 15 * 60 * 1000, max: 240, standardHeaders: true, legacyHeaders: false }));
const bookLimit = rateLimit({ windowMs: 60 * 60 * 1000, max: 12, standardHeaders: true, legacyHeaders: false, message: { success: false, message: 'Too many bookings from this address. Please try again later.' } });
const orgId = async () => { const o: any = await Organization.findOne({ isInternal: true }).select('_id name'); if (!o) throw ApiError.notFound('Not available'); return { id: String(o._id), name: o.name }; };
const oid = z.string().regex(/^[a-f0-9]{24}$/i);

router.get('/hosts', asyncHandler(async (_req, res) => { const o = await orgId(); res.json({ success: true, data: { company: o.name, hosts: await svc.bookableHosts(o.id) } }); }));
router.get('/calendar', asyncHandler(async (req, res) => {
  const o = await orgId(); const hostId = oid.parse(req.query.hostId); const days = Math.min(Math.max(+(req.query.days as string) || 30, 1), 60);
  res.json({ success: true, data: await svc.calendar(o.id, hostId, days) });
}));
router.get('/slots', asyncHandler(async (req, res) => {
  const o = await orgId(); const hostId = oid.parse(req.query.hostId); const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).parse(req.query.date);
  const slots = await svc.slotsFor(o.id, hostId, date);
  res.json({ success: true, data: slots.map((s) => ({ start: s.start.toISOString(), end: s.end.toISOString(), label: `${String(new Date(s.start.getTime() + 3600000).getUTCHours()).padStart(2, '0')}:${String(new Date(s.start.getTime() + 3600000).getUTCMinutes()).padStart(2, '0')}` })) });
}));
router.post('/book', bookLimit, asyncHandler(async (req, res) => {
  const b = z.object({ hostId: oid, start: z.string(), name: z.string().trim().min(2).max(120), email: z.string().trim().email().max(200), phone: z.string().trim().max(40).optional(), company: z.string().trim().max(160).optional(), purpose: z.string().trim().max(500).optional(), website: z.string().max(200).optional() }).parse(req.body);
  if (b.website) { res.status(201).json({ success: true, data: { reference: 'VIS-RECEIVED' } }); return; }
  const v: any = await svc.bookAppointment({ hostId: b.hostId, start: b.start, person: { name: b.name, email: b.email, phone: b.phone, company: b.company }, purpose: b.purpose });
  res.status(201).json({ success: true, data: { reference: v.reference, code: v.passCode, hostName: v.hostName, start: v.scheduledStart, status: v.status } });
}));
router.get('/pass/:code', asyncHandler(async (req, res) => {
  const o = await orgId(); const v: any = await Visit.findOne({ organizationId: o.id, passCode: String(req.params.code).toUpperCase() }).lean();
  if (!v) throw ApiError.notFound('This pass was not found');
  res.json({ success: true, data: { reference: v.reference, status: v.status, visitor: v.visitor.name, host: v.hostName, start: v.scheduledStart, end: v.scheduledEnd, badgeNo: v.badgeNo, company: o.name, qr: await svc.qrDataUrl(v.passCode), canCancel: ['pending_approval', 'booked', 'approved'].includes(v.status) } });
}));
router.post('/pass/:code/cancel', bookLimit, asyncHandler(async (req, res) => {
  const o = await orgId(); const v: any = await Visit.findOne({ organizationId: o.id, passCode: String(req.params.code).toUpperCase() });
  if (!v) throw ApiError.notFound('This pass was not found');
  await svc.cancel(o.id, v, 'Visitor', 'cancelled by the visitor'); res.json({ success: true, data: { status: v.status } });
}));
export default router;
