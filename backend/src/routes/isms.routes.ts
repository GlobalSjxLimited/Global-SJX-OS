import { Router } from 'express';
import fs from 'fs';
import multer from 'multer';
import { z } from 'zod';
import { requireAuth } from '../middleware/auth';
import { requireModule } from '../middleware/modules';
import { asyncHandler } from '../utils/asyncHandler';
import { ApiError } from '../utils/ApiError';
import { audit } from '../services/audit.service';
import { REGISTERS, REGISTER_MAP } from '../config/isms';
import { COVERAGE } from '../config/ismsCoverage';
import { AutomationRun, AutomationSetting, IsmsRecord, RegisterSnapshot } from '../models/Isms';
import { Incident } from '../models/Governance';
import { OutsourcedReview } from '../models/Security';
import { createRecord, importWorkbook, listRecords, updateRecord } from '../services/isms/records.service';
import { GENERATORS } from '../services/isms/generators';
import { buildPack, buildRegister, snapshotPath } from '../services/isms/pack.service';
import { RULES, RULE_MAP, isEnabled, runRule } from '../services/isms/automation';
import * as riskSuggest from '../services/isms/riskSuggest';
import * as dr from '../services/isms/dr.service';
import * as soa from '../services/isms/soa.service';

const router = Router();
router.use(requireAuth, requireModule('isms'));
router.use((_req, res, next) => { const json = res.json.bind(res); res.json = ((b: any) => json(b && typeof b === 'object' && 'success' in b ? b : { success: true, data: b })) as any; next(); });

const actor = (req: any) => ({ id: req.user.id as string, name: req.user.name as string });
const org = (req: any) => String(req.user.organizationId);
const oid = z.string().regex(/^[a-f0-9]{24}$/i);
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 10 * 1024 * 1024, files: 1 }, fileFilter: (_r, f, cb) => cb(null, /\.xlsx$/i.test(f.originalname)) });
const XLSX_MIME = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
const DAY = 86400000;

/* ------------------------------------------------------------------ catalogue */
router.get('/registers', asyncHandler(async (req, res) => {
  const rows: any[] = await IsmsRecord.find({ organizationId: org(req), isDeleted: { $ne: true } }).select('register status dueDate').lean();
  const stat: Record<string, { total: number; open: number; overdue: number }> = {};
  for (const c of rows) {
    const def = REGISTER_MAP[c.register]; if (!def) continue;
    const s = (stat[c.register] ||= { total: 0, open: 0, overdue: 0 });
    s.total++;
    if (!def.closedStatuses.includes(c.status)) { s.open++; if (c.dueDate && new Date(c.dueDate) < new Date()) s.overdue++; }
  }
  res.json({
    registers: REGISTERS.map(({ sheetMatch, ...d }) => ({ ...d, stats: stat[d.key] || { total: 0, open: 0, overdue: 0 } })),
    generators: GENERATORS.map((g) => ({ key: g.key, title: g.title, docId: g.docId, group: g.group, clause: g.clause, source: g.source })),
  });
}));

/* -------------------------------------------------------------------- records */
router.get('/records/:key', asyncHandler(async (req, res) => {
  if (!REGISTER_MAP[req.params.key]) throw ApiError.notFound('Unknown register');
  const q = req.query as any;
  const r = await listRecords(org(req), req.params.key, { status: q.status, q: q.q, page: +q.page, limit: +q.limit, overdue: q.overdue === 'true' });
  res.json({ success: true, data: r.rows, pagination: { page: r.page, pages: r.pages, total: r.total } });
}));

/* ---------------------------------------------------------- statement of applicability */
router.post('/annex-a/seed', asyncHandler(async (req, res) => {
  const r = await soa.ensureAnnexA(org(req));
  await audit(req, 'soa.seeded', 'Register', 'annex_a', { module: 'isms', severity: 'low', summary: `${r.created} of ${r.total} controls added` });
  res.json(r);
}));
router.get('/annex-a/summary', asyncHandler(async (req, res) => { res.json(await soa.soaSummary(org(req))); }));
router.post('/records/annex_a/:id/test', asyncHandler(async (req, res) => {
  oid.parse(req.params.id);
  const b = z.object({ result: z.enum(['Pass', 'Partial', 'Fail']), notes: z.string().max(2000).optional(), evidenceUrl: z.string().max(500).optional() }).parse(req.body);
  const r = await soa.runControlTest(org(req), req.params.id, b, actor(req));
  await audit(req, 'soa.control_tested', 'IsmsRecord', req.params.id, { module: 'isms', severity: b.result === 'Fail' ? 'medium' : 'low', summary: `${r.record.data?.ref} ${b.result}${r.car ? ` → ${r.car.refNo}` : ''}` });
  res.json({ record: r.record, car: r.car, nextTest: r.nextTest });
}));

router.get('/records/deletion/:id/certificate', asyncHandler(async (req, res) => {
  oid.parse(req.params.id);
  const { buffer, fileName } = await dr.destructionCertificate(org(req), req.params.id);
  await audit(req, 'deletion.certificate', 'IsmsRecord', req.params.id, { module: 'isms', severity: 'low', summary: fileName });
  res.setHeader('Content-Type', 'application/pdf'); res.setHeader('Content-Disposition', `attachment; filename="${fileName}"`); res.send(buffer);
}));

const body = z.object({
  data: z.record(z.any()).default({}), status: z.string().max(40).optional(), ownerId: oid.nullable().optional(), ownerName: z.string().max(120).optional(),
  evidenceUrl: z.string().url().max(500).optional().or(z.literal('')), note: z.string().max(1000).optional(),
});

router.post('/records/:key', asyncHandler(async (req, res) => {
  const b = body.parse(req.body);
  const rec = await createRecord(org(req), req.params.key, { ...b, ownerId: b.ownerId || undefined }, actor(req));
  await audit(req, 'isms_record.created', 'IsmsRecord', String(rec._id), { module: 'isms', severity: 'low', summary: `${rec.refNo} ${rec.title}` });
  res.status(201).json(rec);
}));

router.patch('/records/:key/:id', asyncHandler(async (req, res) => {
  oid.parse(req.params.id);
  const b = body.parse(req.body);
  const rec = await updateRecord(org(req), req.params.key, req.params.id, { ...b, ownerName: b.ownerName ?? undefined }, actor(req));
  await audit(req, b.status ? 'isms_record.status' : 'isms_record.updated', 'IsmsRecord', String(rec._id), { module: 'isms', severity: 'low', summary: `${rec.refNo} → ${rec.status}` });
  res.json(rec);
}));

router.delete('/records/:key/:id', asyncHandler(async (req, res) => {
  oid.parse(req.params.id);
  const reason = z.string().min(5).max(500).parse(req.body?.reason);
  const rec: any = await IsmsRecord.findOne({ _id: req.params.id, organizationId: org(req), register: req.params.key, isDeleted: { $ne: true } });
  if (!rec) throw ApiError.notFound('Record not found');
  rec.history.push({ at: new Date(), byId: req.user!.id, byName: req.user!.name, action: 'deleted', note: reason });
  await rec.save(); await rec.softDelete(req.user!.id);
  await audit(req, 'isms_record.deleted', 'IsmsRecord', String(rec._id), { module: 'isms', severity: 'medium', summary: `${rec.refNo}: ${reason}` });
  res.json({ ok: true });
}));

/* ----------------------------------------------------------- export / import */
router.get('/export/:key', asyncHandler(async (req, res) => {
  const { buffer, fileName } = await buildRegister(org(req), req.params.key, req.user!.name);
  await audit(req, 'isms_register.exported', 'Register', req.params.key, { module: 'isms', severity: 'low', summary: fileName });
  res.setHeader('Content-Type', XLSX_MIME); res.setHeader('Content-Disposition', `attachment; filename="${fileName}"`); res.send(buffer);
}));

router.post('/import', upload.single('file'), asyncHandler(async (req, res) => {
  if (!req.file) throw ApiError.badRequest('Attach an .xlsx workbook');
  const only = req.body?.register ? String(req.body.register) : undefined;
  if (only && !REGISTER_MAP[only]) throw ApiError.badRequest('Unknown register');
  const result = await importWorkbook(org(req), req.file.buffer, actor(req), only);
  await audit(req, 'isms_register.imported', 'Register', only || 'auto', { module: 'isms', severity: 'medium', summary: `${req.file.originalname}: ${result.sheets.reduce((n, s) => n + s.created, 0)} rows` });
  res.json(result);
}));

/* ---------------------------------------------------------------- evidence packs */
router.get('/packs', asyncHandler(async (req, res) => {
  res.json(await RegisterSnapshot.find({ organizationId: org(req) }).sort({ createdAt: -1 }).limit(60).select('-storageKey').lean());
}));
router.post('/packs', asyncHandler(async (req, res) => {
  const keys = z.array(z.string()).max(40).optional().parse(req.body?.registers);
  const snap = await buildPack(org(req), { trigger: 'manual', byName: req.user!.name, keys });
  await audit(req, 'isms_pack.created', 'RegisterSnapshot', String(snap._id), { module: 'isms', severity: 'low', summary: String(snap.fileName) });
  const { storageKey, ...rest } = snap.toObject(); void storageKey;
  res.status(201).json(rest);
}));
router.get('/packs/:id/download', asyncHandler(async (req, res) => {
  oid.parse(req.params.id);
  const s: any = await RegisterSnapshot.findOne({ _id: req.params.id, organizationId: org(req) }).lean();
  if (!s) throw ApiError.notFound('Pack not found');
  const p = snapshotPath(org(req), s.storageKey);
  if (!fs.existsSync(p)) throw ApiError.notFound('The file is no longer on the server');
  await audit(req, 'isms_pack.downloaded', 'RegisterSnapshot', String(s._id), { module: 'isms', severity: 'low', summary: s.fileName });
  res.setHeader('Content-Type', 'application/zip'); res.setHeader('Content-Disposition', `attachment; filename="${s.fileName}"`); res.setHeader('X-Content-SHA256', s.sha256);
  fs.createReadStream(p).pipe(res);
}));

/* -------------------------------------------------------------------- automation */
const BUILT_ELSEWHERE = [
  { title: 'Access reviews every 90 days', where: '/access', note: 'Removals and reductions are applied to accounts when the review is completed.' },
  { title: 'Offboarding: access revoked on the last working day, unreturned assets escalated', where: '/offboarding', note: 'Return of Asset Policy.' },
  { title: 'Threat-intelligence feeds, indicator expiry, stale-source warnings', where: '/threat-intel', note: 'CISA KEV and other feeds.' },
  { title: 'Recurring control tasks (password rotation, backup tests, risk reviews …)', where: '/controls', note: 'Owner resolved by role, reminders 14/7/3/1 days before.' },
  { title: 'Compliance calendar, certification expiry, policy reviews, audit-log sealing', where: '/reminders', note: 'Daily 06:30 Lagos.' },
  { title: 'Task escalation to department heads', where: '/tasks', note: 'Set the heads under People → Employees → Department heads.' },
];
router.get('/automation', asyncHandler(async (req, res) => {
  const o = org(req);
  const out = [];
  for (const r of RULES) {
    const last: any = await AutomationRun.findOne({ organizationId: o, ruleKey: r.key }).sort({ startedAt: -1 }).lean();
    out.push({ key: r.key, title: r.title, policy: r.policy, clause: r.clause, schedule: r.schedule, description: r.description, enabled: await isEnabled(o, r.key), lastRun: last ? { at: last.startedAt, ok: last.ok, summary: last.summary, actions: last.actions, trigger: last.trigger, error: last.error, details: last.details } : null });
  }
  res.json({ rules: out, builtElsewhere: BUILT_ELSEWHERE });
}));
router.post('/automation/:key/run', asyncHandler(async (req, res) => {
  if (!RULE_MAP[req.params.key]) throw ApiError.notFound('Unknown rule');
  const run = await runRule(org(req), req.params.key, 'manual', req.user!.name);
  await audit(req, 'isms_rule.run', 'AutomationRule', req.params.key, { module: 'isms', severity: 'low', summary: run.summary });
  res.json(run);
}));
router.put('/automation/:key', asyncHandler(async (req, res) => {
  if (!RULE_MAP[req.params.key]) throw ApiError.notFound('Unknown rule');
  const b = z.object({ enabled: z.boolean(), reason: z.string().max(500).optional() }).parse(req.body);
  if (!b.enabled && (b.reason || '').trim().length < 5) throw ApiError.badRequest('Say why this rule is being switched off – the reason is kept for the auditor.');
  await AutomationSetting.findOneAndUpdate({ organizationId: org(req), ruleKey: req.params.key }, { enabled: b.enabled, changedByName: req.user!.name, changedAt: new Date(), reason: b.reason }, { upsert: true });
  await audit(req, b.enabled ? 'isms_rule.enabled' : 'isms_rule.disabled', 'AutomationRule', req.params.key, { module: 'isms', severity: b.enabled ? 'low' : 'high', summary: b.reason || 'switched on' });
  res.json({ ok: true });
}));
router.get('/automation/runs', asyncHandler(async (req, res) => {
  const f: any = { organizationId: org(req) }; if (req.query.rule) f.ruleKey = String(req.query.rule);
  res.json(await AutomationRun.find(f).sort({ startedAt: -1 }).limit(100).lean());
}));

/* ------------------------------------------------------------ coverage + review */
router.get('/coverage', asyncHandler(async (_req, res) => {
  const by: Record<string, number> = { enforced: 0, automated: 0, recorded: 0, manual: 0 };
  for (const c of COVERAGE) by[c.level]++;
  res.json({ items: COVERAGE, totals: { documents: COVERAGE.length, ...by } });
}));

router.get('/review-inputs', asyncHandler(async (req, res) => {
  const o = org(req); const yearAgo = new Date(Date.now() - 365 * DAY);
  const recs: any[] = await IsmsRecord.find({ organizationId: o, isDeleted: { $ne: true } }).select('register status dueDate data closedAt createdAt').lean();
  const of = (k: string) => recs.filter((r) => r.register === k);
  const open = (k: string) => of(k).filter((r) => !REGISTER_MAP[k].closedStatuses.includes(r.status));
  const late = (k: string) => open(k).filter((r) => r.dueDate && new Date(r.dueDate) < new Date());
  const incidents: any[] = await Incident.find({ organizationId: o, isDeleted: { $ne: true }, detectedAt: { $gte: yearAgo } }).select('severity status').lean();
  const reviews: any[] = await OutsourcedReview.find({ organizationId: o, isDeleted: { $ne: true } }).select('nextReviewAt status').lean();
  const metrics = of('metric').filter((m) => m.data?.targetMet);
  res.json({
    previousActions: { open: open('mgmt_action').length, overdue: late('mgmt_action').length },
    contextChanges: { open: open('context').length },
    audits: { planned: of('audit_plan').filter((a) => a.status === 'Planned').length, reported: of('audit_plan').filter((a) => ['Reported', 'Closed'].includes(a.status)).length, overdue: late('audit_plan').length },
    nonconformities: { open: open('car').length, overdue: late('car').length, major: open('car').filter((c) => c.data?.classification === 'Major').length, closedLast12m: of('car').filter((c) => c.closedAt && c.closedAt >= yearAgo).length },
    observationsAndOfi: { open: open('observation').length + open('ofi').length },
    metrics: { measured: metrics.length, met: metrics.filter((m) => m.data.targetMet === 'Yes').length, missed: metrics.filter((m) => m.data.targetMet === 'No').length },
    risks: { open: open('risk').length, major: open('risk').filter((r) => r.data?.rClassification === 'Major').length, reviewsOverdue: late('risk').length, opportunities: open('opportunity').length },
    incidents: { last12m: incidents.length, highOrCritical: incidents.filter((i) => ['high', 'critical'].includes(i.severity)).length, stillOpen: incidents.filter((i) => i.status !== 'closed').length },
    changes: { open: open('change').length, awaitingReview: of('change').filter((c) => c.status === 'Implemented').length },
    suppliers: { activeReviews: reviews.length, overdue: reviews.filter((r) => r.nextReviewAt && new Date(r.nextReviewAt) < new Date()).length },
    legal: { nonCompliant: of('legal').filter((l) => ['Non-compliant', 'Expired'].includes(l.status)).length, expiring90: of('legal').filter((l) => l.dueDate && +new Date(l.dueDate) - Date.now() < 90 * DAY && new Date(l.dueDate) > new Date()).length },
    training: { planned: open('training').length, overdue: late('training').length },
  });
}));

router.get('/overview', asyncHandler(async (req, res) => {
  const o = org(req);
  const all: any[] = await IsmsRecord.find({ organizationId: o, isDeleted: { $ne: true } }).select('register status dueDate').lean();
  const openRecs = all.filter((r) => !REGISTER_MAP[r.register]?.closedStatuses.includes(r.status));
  const overdue = openRecs.filter((r) => r.dueDate && new Date(r.dueDate) < new Date()).length;
  const recent: any[] = await AutomationRun.find({ organizationId: o, startedAt: { $gte: new Date(Date.now() - 7 * DAY) } }).sort({ startedAt: -1 }).select('ruleKey ok').lean();
  const latest = new Map<string, boolean>(); for (const r of recent) if (!latest.has(r.ruleKey)) latest.set(r.ruleKey, r.ok);
  const failing = Array.from(latest.values()).filter((ok) => ok === false);
  const lastPack: any = await RegisterSnapshot.findOne({ organizationId: o }).sort({ createdAt: -1 }).select('createdAt fileName sha256').lean();
  res.json({ records: all.length, open: openRecs.length, overdue, rulesFailing: failing.length, lastPack });
}));

/* ------------------------------------------------------------------ risk heat map + auto-suggested risks */
router.get('/heatmap', asyncHandler(async (req, res) => {
  res.json(await riskSuggest.heatmap(org(req), req.query.view === 'residual' ? 'residual' : 'inherent'));
}));

router.get('/risk-suggestions/pending', asyncHandler(async (req, res) => { res.json(await riskSuggest.pending(org(req))); }));

router.post('/risk-suggestions/accept', asyncHandler(async (req, res) => {
  const b = z.object({ key: z.string().min(3).max(120), ownerId: oid.optional(), ownerName: z.string().max(120).optional() }).parse(req.body);
  const rec = await riskSuggest.accept(org(req), b.key, actor(req), { id: b.ownerId, name: b.ownerName });
  await audit(req, 'create', 'IsmsRecord', String(rec._id), { module: 'isms', severity: 'info', summary: `Accepted suggested risk ${rec.refNo}` });
  res.status(201).json(rec);
}));

router.post('/risk-suggestions/dismiss', asyncHandler(async (req, res) => {
  const b = z.object({ key: z.string().min(3).max(120) }).parse(req.body);
  await riskSuggest.dismiss(org(req), b.key);
  await audit(req, 'update', 'RiskSuggestion', b.key, { module: 'isms', severity: 'info', summary: 'Dismissed a suggested risk' });
  res.json({ ok: true });
}));

export default router;
