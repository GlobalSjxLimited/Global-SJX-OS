import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import { z } from 'zod';
import { asyncHandler } from '../utils/asyncHandler';
import { ApiError } from '../utils/ApiError';
import { hashIp } from '../middleware/security';
import { ConsentRecord } from '../models/Security';
import { attachUserIfPresent } from '../middleware/auth';

export const CONSENT_POLICY_VERSION = '2026-10-01';

const router = Router();
const limiter = rateLimit({ windowMs: 15 * 60 * 1000, max: 60, standardHeaders: true, legacyHeaders: false });

const schema = z.object({
  subjectId: z.string().regex(/^[\w-]{8,64}$/),
  policyVersion: z.string().max(32),
  preferences: z.boolean().default(false),
  analytics: z.boolean().default(false),
  marketing: z.boolean().default(false),
  source: z.enum(['app', 'website']).default('app'),
});

router.get('/policy', (_req, res) => res.json({ success: true, data: { version: CONSENT_POLICY_VERSION } }));

/** POST /api/consent — records a cookie-consent decision (public; works before sign-in). */
router.post(
  '/',
  limiter,
  attachUserIfPresent,
  asyncHandler(async (req, res) => {
    const parsed = schema.safeParse(req.body);
    if (!parsed.success) throw ApiError.badRequest('Invalid consent payload');
    await ConsentRecord.create({
      ...parsed.data,
      essential: true,
      userId: req.user?.id,
      ipHash: hashIp(req.ip),
      userAgent: String(req.headers['user-agent'] || '').slice(0, 200),
    });
    res.status(201).json({ success: true, data: { recorded: true, version: CONSENT_POLICY_VERSION } });
  })
);

export default router;
