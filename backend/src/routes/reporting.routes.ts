import { parseQuarter, normaliseQuarter } from '../utils/quarter';
import { Router } from 'express';
import { requireAuth } from '../middleware/auth';
import { requireModule, hasModule } from '../middleware/modules';
import { asyncHandler } from '../utils/asyncHandler';
import { ApiError } from '../utils/ApiError';
import { REPORTS, REPORT_MAP, reportModules, ReportDef } from '../services/reports.service';
import { buildExport, canRun, runSchedule, nextRun } from '../services/reportDelivery.service';
import { ReportSchedule } from '../models/Governance';
import { User } from '../models/User';
import { effectiveModules } from '../services/access.service';
import { audit } from '../services/audit.service';
import { excludeDeleted } from '../utils/softDeletePlugin';

const router = Router();
router.use(requireAuth);

const allowed = (req: any, def: ReportDef) => canRun(def, req.user.role, req.user.modules || []);
function getDef(req: any): ReportDef {
  const def = REPORT_MAP.get(req.params.key);
  if (!def) throw ApiError.notFound('Unknown report');
  if (!allowed(req, def)) throw ApiError.forbidden('Your role does not include the module needed for this report.');
  return def;
}
const paramsFrom = (q: any) => {
  const out: Record<string, any> = {};
  for (const k of ['from', 'to', 'days', 'year', 'month']) if (q[k] !== undefined && q[k] !== '') out[k] = String(q[k]).slice(0, 12);
  if (q.quarter) {
    if (!parseQuarter(String(q.quarter))) throw ApiError.badRequest('quarter must look like 2026-Q4');
    out.quarter = normaliseQuarter(String(q.quarter));
  }
  if (out.from && Number.isNaN(new Date(out.from).getTime())) throw ApiError.badRequest('from is not a valid date');
  if (out.to && Number.isNaN(new Date(out.to).getTime())) throw ApiError.badRequest('to is not a valid date');
  return out;
};

/** The reports this person is allowed to run — the menu is built from their modules. */
router.get('/catalog', asyncHandler(async (req, res) => {
  const list = REPORTS.filter((r) => allowed(req, r)).map((r) => ({ key: r.key, title: r.title, category: r.category, description: r.description, standard: r.standard, params: r.params || [], module: reportModules(r) }));
  res.json({ success: true, data: list });
}));

router.get('/run/:key', asyncHandler(async (req, res) => {
  const def = getDef(req);
  const params = paramsFrom(req.query);
  const t0 = Date.now();
  const result = await def.run({ orgId: req.user!.organizationId, params, user: { id: req.user!.id, name: req.user!.name, role: req.user!.role } });
  await audit(req, 'report.run', 'Report', undefined, { module: 'reports', summary: `${def.title} (${result.rows.length} rows, ${Date.now() - t0}ms)`, meta: params });
  res.json({ success: true, data: { key: def.key, title: def.title, category: def.category, standard: def.standard, generatedAt: new Date().toISOString(), params, ...result } });
}));

router.get('/run/:key/export', asyncHandler(async (req, res) => {
  const def = getDef(req);
  const format = req.query.format === 'pdf' ? 'pdf' : 'csv';
  const params = paramsFrom(req.query);
  const result = await def.run({ orgId: req.user!.organizationId, params, user: { id: req.user!.id, name: req.user!.name, role: req.user!.role } });
  const file = await buildExport(def, result, format, { generatedBy: req.user!.name });
  await audit(req, 'report.exported', 'Report', undefined, { module: 'reports', severity: 'medium', summary: `${def.title} exported as ${format.toUpperCase()} (${result.rows.length} rows)`, meta: params });
  res.setHeader('Content-Type', file.contentType);
  res.setHeader('Content-Disposition', `attachment; filename="${file.filename}"`);
  res.send(file.buffer);
}));

/* ------------------------------- Scheduled reports ------------------------- */
router.use('/schedules', requireModule('reports'));

router.get('/schedules', asyncHandler(async (req, res) => {
  const rows = await ReportSchedule.find(excludeDeleted({ organizationId: req.user!.organizationId })).populate('recipientIds createdById', 'name').sort('nextRunAt');
  res.json({ success: true, data: rows.filter((s) => { const d = REPORT_MAP.get(s.reportKey); return d && allowed(req, d); }) });
}));

router.post('/schedules', asyncHandler(async (req, res) => {
  const b = req.body || {};
  const def = REPORT_MAP.get(b.reportKey);
  if (!def) throw ApiError.badRequest('Choose a report.');
  if (!allowed(req, def)) throw ApiError.forbidden('You cannot schedule a report you cannot run.');
  if (!['weekly', 'monthly', 'quarterly'].includes(b.frequency)) throw ApiError.badRequest('Frequency must be weekly, monthly or quarterly.');
  const ids: string[] = Array.isArray(b.recipientIds) ? b.recipientIds : [];
  const extra: string[] = (Array.isArray(b.extraEmails) ? b.extraEmails : []).filter((e: string) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e)).slice(0, 5);
  if (!ids.length && !extra.length) throw ApiError.badRequest('Choose at least one recipient.');
  if (extra.length && !['super_admin', 'ceo'].includes(req.user!.role)) throw ApiError.forbidden('Only the CEO or an administrator can send reports to external email addresses.');
  // Every internal recipient must be entitled to the report themselves.
  const users = await User.find({ _id: { $in: ids }, organizationId: req.user!.organizationId, isActive: true }).select('name role moduleGrant moduleDeny organizationId');
  for (const u of users) {
    const mods = await effectiveModules({ role: u.role, organizationId: String(u.organizationId), moduleGrant: u.moduleGrant as string[], moduleDeny: u.moduleDeny as string[] });
    if (!canRun(def, u.role, mods)) throw ApiError.badRequest(`${u.name} does not have access to this report's module.`);
  }
  const params: Record<string, any> = {};
  for (const k of ['days', 'year', 'month']) if (b.params?.[k]) params[k] = Number(b.params[k]);
  const s = await ReportSchedule.create({ organizationId: req.user!.organizationId, reportKey: def.key, name: String(b.name || def.title).slice(0, 120), params, frequency: b.frequency, format: b.format === 'csv' ? 'csv' : 'pdf', recipientIds: users.map((u) => u._id), extraEmails: extra, nextRunAt: b.startAt ? new Date(b.startAt) : nextRun(b.frequency), createdById: req.user!.id });
  await audit(req, 'report.schedule_created', 'ReportSchedule', String(s._id), { module: 'reports', severity: extra.length ? 'high' : 'info', summary: `${s.name} (${s.frequency}) → ${users.length} user(s)${extra.length ? ` + ${extra.length} external` : ''}` });
  res.status(201).json({ success: true, data: s });
}));

router.patch('/schedules/:id', asyncHandler(async (req, res) => {
  const s: any = await ReportSchedule.findOne(excludeDeleted({ _id: req.params.id, organizationId: req.user!.organizationId }));
  if (!s) throw ApiError.notFound('Schedule not found');
  if (typeof req.body.active === 'boolean') s.active = req.body.active;
  if (['weekly', 'monthly', 'quarterly'].includes(req.body.frequency)) { s.frequency = req.body.frequency; s.nextRunAt = nextRun(s.frequency); }
  if (['pdf', 'csv'].includes(req.body.format)) s.format = req.body.format;
  if (req.body.name) s.name = String(req.body.name).slice(0, 120);
  await s.save();
  await audit(req, 'report.schedule_updated', 'ReportSchedule', String(s._id), { module: 'reports', summary: s.name });
  res.json({ success: true, data: s });
}));

router.delete('/schedules/:id', asyncHandler(async (req, res) => {
  const s: any = await ReportSchedule.findOne(excludeDeleted({ _id: req.params.id, organizationId: req.user!.organizationId }));
  if (!s) throw ApiError.notFound('Schedule not found');
  s.isDeleted = true; s.deletedAt = new Date(); s.active = false;
  await s.save();
  await audit(req, 'report.schedule_deleted', 'ReportSchedule', String(s._id), { module: 'reports', summary: s.name });
  res.json({ success: true, data: { id: s._id } });
}));

router.post('/schedules/:id/run-now', asyncHandler(async (req, res) => {
  const s: any = await ReportSchedule.findOne(excludeDeleted({ _id: req.params.id, organizationId: req.user!.organizationId }));
  if (!s) throw ApiError.notFound('Schedule not found');
  const r = await runSchedule(s);
  res.json({ success: true, data: { ...r, status: s.lastStatus } });
}));

export { hasModule };
export default router;
