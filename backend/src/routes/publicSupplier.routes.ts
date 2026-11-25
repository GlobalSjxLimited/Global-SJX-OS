import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import { z } from 'zod';
import { asyncHandler } from '../utils/asyncHandler';
import * as svc from '../services/supplier.service';

/** The supplier's private link. The token is the key; it is long, random and stored only as a hash. */
const router = Router();
router.use(rateLimit({ windowMs: 15 * 60 * 1000, max: 120, standardHeaders: true, legacyHeaders: false }));
const body = z.object({ answers: z.array(z.object({ qid: z.string().max(20), answer: z.string().max(10), note: z.string().max(1000).optional() })).max(60), completedBy: z.object({ name: z.string().max(120).optional(), role: z.string().max(120).optional() }).optional() });
router.get('/:token', asyncHandler(async (req, res) => { res.json({ success: true, data: await svc.publicView(req.params.token) }); }));
router.put('/:token', asyncHandler(async (req, res) => { const b = body.parse(req.body); res.json({ success: true, data: await svc.save(req.params.token, b.answers, b.completedBy) }); }));
router.post('/:token/submit', asyncHandler(async (req, res) => { const b = body.parse(req.body); res.json({ success: true, data: await svc.submit(req.params.token, b.answers, b.completedBy) }); }));
export default router;
