import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import { z } from 'zod';
import { requireAuth } from '../middleware/auth';
import { hasModule } from '../middleware/modules';
import { asyncHandler } from '../utils/asyncHandler';
import { ApiError } from '../utils/ApiError';
import { audit } from '../services/audit.service';
import { PHISH_TEMPLATES, QUESTION_LIBRARY } from '../config/awarenessLibrary';
import { PhishCampaign, PhishTarget, QUIZ_TOPICS, QuizQuestion } from '../models/Awareness';
import * as svc from '../services/awareness.service';

/* ------------------------------------------------------------------ public: where a simulated phishing link lands (no sign-in; the token is the key) */
export const publicPhishRouter = Router();
publicPhishRouter.use(rateLimit({ windowMs: 15 * 60 * 1000, max: 60, standardHeaders: true, legacyHeaders: false }));
publicPhishRouter.get('/:token', asyncHandler(async (req, res) => {
  const r = await svc.recordClick(String(req.params.token));
  if (!r) throw ApiError.notFound('This link is not valid');
  res.json({ success: true, data: r });
}));

/* ------------------------------------------------------------------ signed-in */
const router = Router();
router.use(requireAuth);
router.use((_req, res, next) => { const json = res.json.bind(res); res.json = ((b: any) => json(b && typeof b === 'object' && 'success' in b ? b : { success: true, data: b })) as any; next(); });

const who = (req: any): svc.Who => ({ id: String(req.user.id), organizationId: String(req.user.organizationId), role: req.user.role, name: req.user.name });
const org = (req: any) => String(req.user.organizationId);
const oid = z.string().regex(/^[a-f0-9]{24}$/i);
const manager = (req: any) => { if (!hasModule(req, 'isms')) throw ApiError.forbidden('Only the ISMS team can manage awareness content and simulations'); };
const staffOnly = (req: any) => { if (!svc.isInternal(req.user.role)) throw ApiError.forbidden('Security awareness is for staff'); };

router.get('/popup', asyncHandler(async (req, res) => { staffOnly(req); res.json(await svc.nextPopup(who(req))); }));

router.post('/popup/:id/answer', asyncHandler(async (req, res) => {
  staffOnly(req);
  const b = z.object({ choice: z.number().int().min(0).max(4) }).parse(req.body);
  res.json(await svc.answer(who(req), oid.parse(req.params.id), b.choice));
}));

router.post('/popup/:id/dismiss', asyncHandler(async (req, res) => {
  staffOnly(req);
  const b = z.object({ snoozeHours: z.number().min(1).max(24).optional() }).parse(req.body || {});
  res.json(await svc.dismissPopup(who(req), oid.parse(req.params.id), b.snoozeHours ?? 4));
}));

router.post('/quiz/start', asyncHandler(async (req, res) => {
  const b = z.object({ count: z.number().int().min(1).max(10).optional() }).parse(req.body || {});
  res.json(await svc.startQuiz(who(req), b.count ?? 5));
}));

router.post('/quiz/:id/answer', asyncHandler(async (req, res) => {
  staffOnly(req);
  const b = z.object({ choice: z.number().int().min(0).max(4) }).parse(req.body);
  res.json(await svc.answer(who(req), oid.parse(req.params.id), b.choice));
}));

router.get('/leaderboard', asyncHandler(async (req, res) => {
  staffOnly(req);
  const period = req.query.period === 'all' ? 'all' : 'month';
  res.json(await svc.leaderboard(org(req), String(req.user!.id), period));
}));

router.get('/me', asyncHandler(async (req, res) => { staffOnly(req); res.json(await svc.myStats(who(req))); }));

router.put('/me/leaderboard', asyncHandler(async (req, res) => {
  staffOnly(req);
  const b = z.object({ hide: z.boolean() }).parse(req.body);
  await svc.setLeaderboardVisibility(who(req), b.hide);
  res.json({ hide: b.hide });
}));

/** "I got a suspicious email" – matches a running simulation (rewarded) or opens a real low-severity incident. */
router.post('/report-phish', asyncHandler(async (req, res) => {
  staffOnly(req);
  const b = z.object({ subject: z.string().min(3).max(200), sender: z.string().max(200).optional(), details: z.string().max(2000).optional() }).parse(req.body);
  const r = await svc.reportPhish(who(req), b);
  await audit(req, 'report_phish', 'PhishReport', String(req.user!.id), { module: 'awareness', severity: 'info', summary: r.simulation ? 'Reported a simulated phish' : `Suspicious email → ${r.incident}` });
  res.json(r);
}));

/* ------------------------------------------------------------------ manager: question bank */
const qBody = z.object({
  text: z.string().min(10).max(500),
  options: z.array(z.string().min(1).max(200)).min(2).max(5),
  correctIndex: z.number().int().min(0).max(4),
  explanation: z.string().min(5).max(800),
  topic: z.enum(QUIZ_TOPICS),
  difficulty: z.enum(['easy', 'medium', 'hard']).default('medium'),
  roles: z.array(z.string()).default([]),
  active: z.boolean().optional(),
  policyRef: z.string().max(120).optional(),
}).refine((b) => b.correctIndex < b.options.length, { message: 'The correct answer must be one of the options' });

router.get('/questions', asyncHandler(async (req, res) => {
  manager(req);
  await svc.ensureLibrary(org(req));
  const rows = await QuizQuestion.find({ organizationId: org(req), isDeleted: { $ne: true } }).sort({ topic: 1, createdAt: 1 }).lean();
  const answers = await (await import('../models/Awareness')).QuizAnswer.find({ organizationId: org(req) }).select('questionId correct').lean();
  const stat = new Map<string, { n: number; ok: number }>();
  for (const a of answers as any[]) { const s = stat.get(String(a.questionId)) || { n: 0, ok: 0 }; s.n++; if (a.correct) s.ok++; stat.set(String(a.questionId), s); }
  res.json({ topics: QUIZ_TOPICS, libraryCount: QUESTION_LIBRARY.length, questions: rows.map((q: any) => { const s = stat.get(String(q._id)); return { ...q, answered: s?.n || 0, accuracy: s?.n ? Math.round((s.ok / s.n) * 100) : null }; }) });
}));

router.post('/questions', asyncHandler(async (req, res) => {
  manager(req);
  const b = qBody.parse(req.body);
  const q = await QuizQuestion.create({ ...b, organizationId: org(req), source: 'custom' });
  await audit(req, 'create', 'QuizQuestion', String(q._id), { module: 'awareness', severity: 'info', summary: `Added awareness question (${b.topic})` });
  res.status(201).json(q);
}));

router.patch('/questions/:id', asyncHandler(async (req, res) => {
  manager(req);
  const q: any = await QuizQuestion.findOne({ _id: oid.parse(req.params.id), organizationId: org(req), isDeleted: { $ne: true } });
  if (!q) throw ApiError.notFound('Question not found');
  const b = qBody.parse({ ...q.toObject(), ...req.body });
  Object.assign(q, b); await q.save();
  await audit(req, 'update', 'QuizQuestion', String(q._id), { module: 'awareness', severity: 'info', summary: `Edited awareness question${b.active === false ? ' (switched off)' : ''}` });
  res.json(q);
}));

router.delete('/questions/:id', asyncHandler(async (req, res) => {
  manager(req);
  const q: any = await QuizQuestion.findOne({ _id: oid.parse(req.params.id), organizationId: org(req), isDeleted: { $ne: true } });
  if (!q) throw ApiError.notFound('Question not found');
  // library questions are switched off rather than deleted so the next seeding does not bring them back
  if (q.source === 'library') { q.active = false; await q.save(); } else await (q as any).softDelete?.(req.user!.id);
  await audit(req, 'delete', 'QuizQuestion', String(q._id), { module: 'awareness', severity: 'info', summary: 'Removed awareness question' });
  res.json({ ok: true });
}));

router.get('/stats', asyncHandler(async (req, res) => {
  manager(req);
  const [topics, accuracy, part, resil, rep] = await Promise.all([svc.topicAccuracy(org(req)), svc.quizAccuracy(org(req)), svc.participation(org(req)), svc.phishResilience(org(req)), svc.phishReportRate(org(req))]);
  res.json({ topics, accuracy, participation: part, phishResilience: resil, phishReportRate: rep });
}));

/* ------------------------------------------------------------------ manager: phishing simulation */
router.get('/phish/templates', asyncHandler(async (req, res) => { manager(req); res.json(PHISH_TEMPLATES.map(({ html, ...t }) => t)); }));

router.get('/phish/campaigns', asyncHandler(async (req, res) => {
  manager(req);
  const rows: any[] = await PhishCampaign.find({ organizationId: org(req), isDeleted: { $ne: true } }).sort({ createdAt: -1 }).lean();
  const t: any[] = await PhishTarget.find({ campaignId: { $in: rows.map((r) => r._id) } }).select('campaignId outcome clickedAt reportedAt').lean();
  res.json(rows.map((c) => { const x = t.filter((y) => String(y.campaignId) === String(c._id)); return { ...c, clicked: x.filter((y) => y.clickedAt).length, reported: x.filter((y) => y.reportedAt).length }; }));
}));

router.post('/phish/audience-preview', asyncHandler(async (req, res) => {
  manager(req);
  const b = z.object({ roles: z.array(z.string()).default([]), departments: z.array(z.string()).default([]), userIds: z.array(oid).default([]) }).parse(req.body || {});
  const u = await svc.audienceUsers(org(req), b);
  res.json({ count: u.length, sample: u.slice(0, 8).map((x: any) => x.name) });
}));

router.post('/phish/campaigns', asyncHandler(async (req, res) => {
  manager(req);
  const b = z.object({
    name: z.string().min(3).max(120), templateKey: z.string(),
    audience: z.object({ roles: z.array(z.string()).default([]), departments: z.array(z.string()).default([]), userIds: z.array(oid).default([]) }).default({ roles: [], departments: [], userIds: [] }),
    authorisedBy: z.string().min(3).max(120), authorisedNote: z.string().max(500).optional(), confirmAuthorised: z.literal(true, { errorMap: () => ({ message: 'Confirm that management authorised this exercise' }) }),
  }).parse(req.body);
  if (!svc.templateByKey(b.templateKey)) throw ApiError.badRequest('Unknown template');
  const { confirmAuthorised, ...rest } = b;
  const c = await PhishCampaign.create({ ...rest, organizationId: org(req) });
  await audit(req, 'create', 'PhishCampaign', String(c._id), { module: 'awareness', severity: 'medium', summary: `Phishing simulation drafted: ${b.name} (authorised by ${b.authorisedBy})` });
  res.status(201).json(c);
}));

router.post('/phish/campaigns/:id/launch', asyncHandler(async (req, res) => {
  manager(req);
  const c = await svc.launchCampaign(oid.parse(req.params.id), org(req), String(req.user!.name));
  await audit(req, 'launch', 'PhishCampaign', String(c._id), { module: 'awareness', severity: 'medium', summary: `Phishing simulation launched to ${c.targetCount} people` });
  res.json(c);
}));

router.post('/phish/campaigns/:id/end', asyncHandler(async (req, res) => {
  manager(req);
  const c: any = await PhishCampaign.findOne({ _id: oid.parse(req.params.id), organizationId: org(req), isDeleted: { $ne: true } });
  if (!c) throw ApiError.notFound('Campaign not found');
  await svc.endCampaign(c);
  await audit(req, 'end', 'PhishCampaign', String(c._id), { module: 'awareness', severity: 'info', summary: 'Phishing simulation ended' });
  res.json(c);
}));

router.get('/phish/campaigns/:id/results', asyncHandler(async (req, res) => { manager(req); res.json(await svc.campaignResults(org(req), oid.parse(req.params.id))); }));

router.delete('/phish/campaigns/:id', asyncHandler(async (req, res) => {
  manager(req);
  const c: any = await PhishCampaign.findOne({ _id: oid.parse(req.params.id), organizationId: org(req), isDeleted: { $ne: true } });
  if (!c) throw ApiError.notFound('Campaign not found');
  if (c.status !== 'draft') throw ApiError.conflict('Only drafts can be deleted; launched campaigns are kept as evidence');
  await (c as any).softDelete?.(req.user!.id);
  res.json({ ok: true });
}));

export default router;
