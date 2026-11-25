import { Router } from 'express';
import mongoose from 'mongoose';
import { requireAuth } from '../middleware/auth';
import { requireModule } from '../middleware/modules';
import { asyncHandler } from '../utils/asyncHandler';
import { ApiError } from '../utils/ApiError';
import { ActivityLog } from '../models/ActivityLog';
import { AuditSeal } from '../models/Governance';
import { sealPendingDays, verifySeals, audit } from '../services/audit.service';
import { toCsv } from '../utils/csv';

const router = Router();
router.use(requireAuth, requireModule('audit_log'));
const rx = (s: string) => String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

function filterFrom(req: any) {
  const { action, module, severity, status, actorId, entityType, q, from, to } = req.query as Record<string, string>;
  const f: any = { organizationId: new mongoose.Types.ObjectId(req.user.organizationId) };
  if (action) f.action = { $regex: `^${rx(action)}` };
  if (module) f.module = module; if (severity) f.severity = severity; if (status) f.status = status;
  if (actorId) f.actorId = new mongoose.Types.ObjectId(actorId); if (entityType) f.entityType = entityType;
  if (q) f.$or = [{ summary: { $regex: rx(q), $options: 'i' } }, { action: { $regex: rx(q), $options: 'i' } }, { actorName: { $regex: rx(q), $options: 'i' } }];
  if (from || to) { f.createdAt = {}; if (from) f.createdAt.$gte = new Date(from); if (to) f.createdAt.$lte = new Date(`${to}T23:59:59.999Z`); }
  return f;
}

router.get('/', asyncHandler(async (req, res) => {
  const p = Math.max(parseInt(String(req.query.page), 10) || 1, 1), l = Math.min(Math.max(parseInt(String(req.query.limit), 10) || 50, 1), 200);
  const f = filterFrom(req);
  const [items, total] = await Promise.all([ActivityLog.find(f).sort('-createdAt').skip((p - 1) * l).limit(l), ActivityLog.countDocuments(f)]);
  res.json({ success: true, data: items, pagination: { page: p, limit: l, total, pages: Math.ceil(total / l) } });
}));

router.get('/stats', asyncHandler(async (req, res) => {
  const days = Math.min(Math.max(parseInt(String(req.query.days), 10) || 30, 1), 365);
  const since = new Date(Date.now() - days * 86400000);
  const match = { organizationId: new mongoose.Types.ObjectId(req.user!.organizationId), createdAt: { $gte: since } };
  const [facets] = await ActivityLog.aggregate([{ $match: match }, { $facet: {
    total: [{ $count: 'n' }],
    bySeverity: [{ $group: { _id: '$severity', n: { $sum: 1 } } }],
    byModule: [{ $group: { _id: '$module', n: { $sum: 1 } } }, { $sort: { n: -1 } }, { $limit: 12 }],
    byDay: [{ $group: { _id: { $dateToString: { format: '%Y-%m-%d', date: '$createdAt' } }, n: { $sum: 1 }, high: { $sum: { $cond: [{ $in: ['$severity', ['high', 'critical']] }, 1, 0] } } } }, { $sort: { _id: 1 } }],
    failedLogins: [{ $match: { action: 'auth.login_failed' } }, { $group: { _id: '$ip', n: { $sum: 1 }, last: { $max: '$createdAt' } } }, { $sort: { n: -1 } }, { $limit: 10 }],
    topActors: [{ $match: { actorName: { $ne: null } } }, { $group: { _id: '$actorName', n: { $sum: 1 } } }, { $sort: { n: -1 } }, { $limit: 8 }],
    failed: [{ $match: { status: 'failed' } }, { $count: 'n' }],
  } }]);
  res.json({ success: true, data: { days, total: facets.total[0]?.n || 0, failed: facets.failed[0]?.n || 0, bySeverity: facets.bySeverity, byModule: facets.byModule, byDay: facets.byDay, failedLoginSources: facets.failedLogins, topActors: facets.topActors } });
}));

router.get('/export.csv', asyncHandler(async (req, res) => {
  const rows = await ActivityLog.find(filterFrom(req)).sort('-createdAt').limit(20000).lean();
  await audit(req, 'audit.exported', 'ActivityLog', undefined, { module: 'audit_log', severity: 'high', summary: `${rows.length} audit entries exported` });
  const keys = ['createdAt', 'severity', 'status', 'module', 'action', 'actorName', 'summary', 'ip', 'entityType', 'entityId', 'requestId'];
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename=audit-log-${new Date().toISOString().slice(0, 10)}.csv`);
  res.send(toCsv(keys.map((key) => ({ key, label: key })), rows));
}));

/* Tamper evidence: daily seals chained with SHA-256. */
router.get('/seals', asyncHandler(async (req, res) => {
  res.json({ success: true, data: await AuditSeal.find({ organizationId: req.user!.organizationId }).sort('-day').limit(60).select('day count digest chainHash createdAt') });
}));
router.post('/seals/run', asyncHandler(async (req, res) => {
  const n = await sealPendingDays(req.user!.organizationId);
  await audit(req, 'audit.sealed', 'AuditSeal', undefined, { module: 'audit_log', summary: `${n} day(s) sealed` });
  res.json({ success: true, data: { sealed: n } });
}));
router.get('/seals/verify', asyncHandler(async (req, res) => {
  const result = await verifySeals(req.user!.organizationId);
  await audit(req, result.valid ? 'audit.verified' : 'audit.tamper_detected', 'AuditSeal', undefined, { module: 'audit_log', severity: result.valid ? 'info' : 'critical', summary: result.valid ? `${result.sealedDays} sealed days verified` : `${result.problems.length} integrity problem(s)` });
  res.json({ success: true, data: result });
}));

export default router;
