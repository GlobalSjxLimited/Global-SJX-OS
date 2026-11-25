import { Router } from 'express';
import { z } from 'zod';
import { requireAuth } from '../middleware/auth';
import { hasModule, requireModule } from '../middleware/modules';
import { asyncHandler } from '../utils/asyncHandler';
import { ApiError } from '../utils/ApiError';
import { audit } from '../services/audit.service';
import { excludeDeleted } from '../utils/softDeletePlugin';
import { nextNumber } from '../models/Access';
import { Incident } from '../models/Governance';
import { Risk } from '../models/Risk';
import { Task } from '../models/Task';
import { User } from '../models/User';
import { ACTION_TYPES, ACTOR_TYPES, CATEGORIES, FEED_FORMATS, INDICATOR_TYPES, INTEL_STATUSES, LAYERS, SEVERITIES, SOURCE_TYPES, ThreatIndicator, ThreatIntel, ThreatSource, TLPS } from '../models/ThreatIntel';
import { notifyWork } from '../services/work.notify';
import { usersWithModule } from '../services/access.service';
import {
  assertShareable, checkExposure, classifyIndicator, collectSource, ensureDefaultSources, huntIndicators, newReference, parseCsvIocs, parseIocText, parseStixBundle,
  SHARE_METHODS, toStixBundle, upsertIndicators,
} from '../services/threatIntel.service';

const router = Router();
router.use(requireAuth, requireModule('threat_intel'));
// Every JSON answer uses the same { success, data } envelope as the rest of the API.
router.use((_req, res, next) => {
  const json = res.json.bind(res);
  res.json = ((body: any) => json(body && typeof body === 'object' && 'success' in body ? body : { success: true, data: body })) as any;
  next();
});

const oid = (v: any) => String(v?._id || v || '');
const manage = (req: any) => hasModule(req, 'threat_intel_manage');
const needManage = (req: any) => { if (!manage(req)) throw ApiError.forbidden('You need the "Manage threat intelligence" permission for this.'); };
const idz = z.string().regex(/^[a-f0-9]{24}$/i);
const day = 86400000;

/** TLP:RED is visible only to its creator, the people it names, and managers. */
function visible(req: any) {
  if (manage(req)) return {};
  return { $or: [{ tlp: { $ne: 'RED' } }, { createdById: req.user.id }, { restrictedTo: req.user.id }] };
}
const scope = (req: any, extra: any = {}) => excludeDeleted({ organizationId: req.user.organizationId, ...extra, ...visible(req) });
async function load(req: any) {
  const t: any = await ThreatIntel.findOne(scope(req, { _id: req.params.id }));
  if (!t) throw ApiError.notFound('Intelligence not found');
  return t;
}
const note = (req: any, t: any, text: string) => t.notes.push({ at: new Date(), byId: req.user.id, byName: req.user.name, text });
const RE = (s: string) => new RegExp(s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');

/* ----------------------------------- meta ---------------------------------- */
router.get('/meta', asyncHandler(async (req, res) => {
  const people = await User.find({ organizationId: req.user!.organizationId, isActive: true }).select('name').sort({ name: 1 }).lean();
  res.json({ layers: LAYERS, severities: SEVERITIES, tlps: TLPS, statuses: INTEL_STATUSES, categories: CATEGORIES, actorTypes: ACTOR_TYPES, indicatorTypes: INDICATOR_TYPES, actionTypes: ACTION_TYPES, sourceTypes: SOURCE_TYPES, feedFormats: FEED_FORMATS, shareMethods: SHARE_METHODS, canManage: manage(req), people });
}));

router.get('/summary', asyncHandler(async (req, res) => {
  const org = req.user!.organizationId;
  const [exposed, needAnalysis, recent, indicatorsActive, indicatorsSeen, sources, vetted] = await Promise.all([
    ThreatIntel.countDocuments(scope(req, { status: { $nin: ['closed', 'dismissed'] }, 'matchedAssetIds.0': { $exists: true } })),
    ThreatIntel.countDocuments(scope(req, { status: { $in: ['new', 'triaged'] } })),
    ThreatIntel.find(scope(req)).sort({ createdAt: -1 }).limit(8).select('reference title severity layer tlp status createdAt relevance matchedAssetIds').lean(),
    ThreatIndicator.countDocuments({ organizationId: org, status: 'active' }),
    ThreatIndicator.countDocuments({ organizationId: org, sightings: { $gt: 0 }, status: 'active' }),
    ThreatSource.countDocuments(excludeDeleted({ organizationId: org, active: true })),
    ThreatSource.countDocuments(excludeDeleted({ organizationId: org, active: true, vetted: true })),
  ]);
  // count in JS: FerretDB-safe, small volumes
  const items: any[] = await ThreatIntel.find(scope(req)).select('severity layer status actions').lean();
  const nowD = new Date();
  const tally = (key: string, filter = (_: any) => true) => items.filter(filter).reduce((m: any, i) => { m[i[key]] = (m[i[key]] || 0) + 1; return m; }, {});
  const live = (i: any) => !['closed', 'dismissed'].includes(i.status);
  res.json({
    total: items.length, open: items.filter(live).length,
    bySeverity: tally('severity', live), byLayer: tally('layer', live), byStatus: tally('status'),
    exposed, needAnalysis, recent, indicatorsActive, indicatorsSeen, sources, vetted,
    overdueActions: items.filter(live).reduce((n, i) => n + (i.actions || []).filter((a: any) => !a.done && a.dueDate && new Date(a.dueDate) < nowD).length, 0),
  });
}));

/* ---------------------------------- sources -------------------------------- */
const sourceZ = z.object({
  name: z.string().trim().min(2).max(160), type: z.enum(SOURCE_TYPES).optional(), url: z.string().max(500).optional(), description: z.string().max(1000).optional(),
  reliability: z.enum(['A', 'B', 'C', 'D', 'E', 'F']).optional(), active: z.boolean().optional(), defaultTlp: z.enum(TLPS).optional(), defaultLayer: z.enum(LAYERS).optional(),
  feedFormat: z.enum(FEED_FORMATS).optional(), feedUrl: z.string().max(800).optional(), autoCollect: z.boolean().optional(),
});
router.get('/sources', asyncHandler(async (req, res) => {
  const org = req.user!.organizationId;
  if (manage(req)) await ensureDefaultSources(org);
  const rows = await ThreatSource.find(excludeDeleted({ organizationId: org })).sort({ vetted: -1, name: 1 }).lean();
  res.json(rows);
}));
router.post('/sources', asyncHandler(async (req, res) => {
  needManage(req);
  const b = sourceZ.parse(req.body);
  if (b.feedUrl && !/^https:\/\//i.test(b.feedUrl)) throw ApiError.badRequest('A feed address must start with https://');
  if (b.autoCollect && (!b.feedUrl || !b.feedFormat || b.feedFormat === 'none')) throw ApiError.badRequest('Set a feed address and format before turning on automatic collection.');
  const s: any = await ThreatSource.create({ ...b, organizationId: req.user!.organizationId, createdByName: req.user!.name });
  await audit(req, 'threat_source.created', 'ThreatSource', String(s._id), { module: 'threat_intel', severity: 'low', summary: s.name });
  res.status(201).json(s);
}));
router.patch('/sources/:id', asyncHandler(async (req, res) => {
  needManage(req);
  const b = sourceZ.partial().parse(req.body);
  const s: any = await ThreatSource.findOne(excludeDeleted({ _id: req.params.id, organizationId: req.user!.organizationId }));
  if (!s) throw ApiError.notFound('Source not found');
  Object.assign(s, b);
  if (s.feedUrl && !/^https:\/\//i.test(s.feedUrl)) throw ApiError.badRequest('A feed address must start with https://');
  if (s.autoCollect && (!s.feedUrl || s.feedFormat === 'none')) throw ApiError.badRequest('Set a feed address and format before turning on automatic collection.');
  if (s.autoCollect && !s.vetted) throw ApiError.badRequest('Vet the source first — only vetted sources can be collected automatically (policy 2.2).');
  await s.save();
  await audit(req, 'threat_source.updated', 'ThreatSource', String(s._id), { module: 'threat_intel', severity: 'low', summary: s.name });
  res.json(s);
}));
router.post('/sources/:id/vet', asyncHandler(async (req, res) => {
  needManage(req);
  const b = z.object({ reliability: z.enum(['A', 'B', 'C', 'D', 'E']), notes: z.string().trim().min(5, 'Say how you assessed the source').max(1000), reviewMonths: z.number().int().min(1).max(36).default(12) }).parse(req.body);
  const s: any = await ThreatSource.findOne(excludeDeleted({ _id: req.params.id, organizationId: req.user!.organizationId }));
  if (!s) throw ApiError.notFound('Source not found');
  Object.assign(s, { vetted: true, reliability: b.reliability, vettingNotes: b.notes, vettedById: req.user!.id, vettedByName: req.user!.name, vettedAt: new Date(), nextReviewDate: new Date(Date.now() + b.reviewMonths * 30 * day) });
  await s.save();
  await audit(req, 'threat_source.vetted', 'ThreatSource', String(s._id), { module: 'threat_intel', severity: 'medium', summary: `${s.name} vetted, reliability ${b.reliability}` });
  res.json(s);
}));
router.post('/sources/:id/collect', asyncHandler(async (req, res) => {
  needManage(req);
  const s: any = await ThreatSource.findOne(excludeDeleted({ _id: req.params.id, organizationId: req.user!.organizationId }));
  if (!s) throw ApiError.notFound('Source not found');
  if (!s.vetted) throw ApiError.badRequest('Vet the source before collecting from it.');
  try {
    const r = await collectSource(req.user!.organizationId, s, { id: req.user!.id, name: req.user!.name });
    await audit(req, 'threat_source.collected', 'ThreatSource', String(s._id), { module: 'threat_intel', severity: 'low', summary: `${s.name}: ${r.intelCreated} intelligence, ${r.indicatorsCreated} indicators` });
    res.json(r);
  } catch (e: any) { s.lastCollectStatus = `failed: ${String(e.message).slice(0, 160)}`; await s.save(); throw e; }
}));
router.delete('/sources/:id', asyncHandler(async (req, res) => {
  needManage(req);
  const s: any = await ThreatSource.findOne(excludeDeleted({ _id: req.params.id, organizationId: req.user!.organizationId }));
  if (!s) throw ApiError.notFound('Source not found');
  (s as any).deletedAt = new Date(); (s as any).isDeleted = true; await s.save();
  await audit(req, 'threat_source.deleted', 'ThreatSource', String(s._id), { module: 'threat_intel', severity: 'low', summary: s.name });
  res.json({ ok: true });
}));

/* ---------------------------------- indicators ----------------------------- */
const indZ = z.object({ type: z.enum(INDICATOR_TYPES).optional(), value: z.string().trim().min(1).max(2048), confidence: z.number().int().min(0).max(100).optional(), severity: z.enum(SEVERITIES).optional(), tlp: z.enum(TLPS).optional(), description: z.string().max(300).optional(), validUntil: z.string().optional().nullable(), intelId: idz.optional() });
router.get('/indicators', asyncHandler(async (req, res) => {
  const q: any = { organizationId: req.user!.organizationId };
  const { type, status, search, intelId, seen } = req.query as any;
  if (type) q.type = type; if (status) q.status = status; if (intelId) q.intelId = intelId; if (seen === '1') q.sightings = { $gt: 0 };
  if (search) q.value = RE(String(search));
  if (!manage(req)) q.tlp = { $ne: 'RED' };
  const rows = await ThreatIndicator.find(q).sort({ createdAt: -1 }).limit(Math.min(+(req.query.limit as string) || 300, 1000)).lean();
  res.json(rows);
}));
router.post('/indicators', asyncHandler(async (req, res) => {
  needManage(req);
  const b = indZ.parse(req.body);
  const c = classifyIndicator(b.value);
  if (!c && !b.type) throw ApiError.badRequest('That does not look like an IP address, domain, URL, e-mail, hash or CVE.');
  const r = await upsertIndicators(req.user!.organizationId, [{ type: c?.type || (b.type as any), value: c?.value || b.value, confidence: b.confidence, description: b.description, validUntil: b.validUntil ? new Date(b.validUntil) : undefined }], { intelId: b.intelId, tlp: b.tlp, severity: b.severity, byName: req.user!.name });
  await audit(req, 'threat_indicator.added', 'ThreatIndicator', c?.value || b.value, { module: 'threat_intel', severity: 'low', summary: `${c?.type}: ${c?.value}` });
  res.status(201).json(r);
}));
router.post('/indicators/bulk', asyncHandler(async (req, res) => {
  needManage(req);
  const b = z.object({ text: z.string().max(2_000_000), tlp: z.enum(TLPS).default('GREEN'), severity: z.enum(SEVERITIES).default('medium'), intelId: idz.optional(), validDays: z.number().int().min(1).max(3650).optional() }).parse(req.body);
  const p = parseIocText(b.text);
  if (p.indicators.length > 20000) throw ApiError.badRequest('Add at most 20,000 indicators at a time.');
  const r = await upsertIndicators(req.user!.organizationId, p.indicators, { intelId: b.intelId, tlp: b.tlp, severity: b.severity, byName: req.user!.name, validUntil: b.validDays ? new Date(Date.now() + b.validDays * day) : undefined });
  await audit(req, 'threat_indicator.bulk_added', 'ThreatIndicator', 'bulk', { module: 'threat_intel', severity: 'low', summary: `${r.created} new, ${r.updated} existing, ${p.rejected.length} rejected` });
  res.status(201).json({ ...r, rejected: p.rejected });
}));
router.post('/indicators/check', asyncHandler(async (req, res) => {
  const b = z.object({ values: z.union([z.string(), z.array(z.string())]) }).parse(req.body);
  const text = Array.isArray(b.values) ? b.values.join('\n') : b.values;
  const p = parseIocText(text);
  const found: any[] = p.indicators.length ? await ThreatIndicator.find({ organizationId: req.user!.organizationId, $or: p.indicators.map((i) => ({ type: i.type, value: i.value })), ...(manage(req) ? {} : { tlp: { $ne: 'RED' } }) }).lean() : [];
  const key = (t: string, v: string) => `${t}:${v}`; const map = new Map(found.map((f) => [key(f.type, f.value), f]));
  res.json({ results: p.indicators.map((i) => { const f = map.get(key(i.type, i.value)); return { ...i, known: !!f, status: f?.status, severity: f?.severity, confidence: f?.confidence, intelId: f?.intelId, allowlisted: f?.status === 'allowlisted' }; }), rejected: p.rejected });
}));
router.post('/indicators/hunt', asyncHandler(async (req, res) => {
  needManage(req);
  const b = z.object({ days: z.number().int().min(1).max(365).default(90), intelId: idz.optional() }).parse(req.body || {});
  const inds: any[] = await ThreatIndicator.find({ organizationId: req.user!.organizationId, status: 'active', ...(b.intelId ? { intelId: b.intelId } : {}) }).limit(5000);
  const hits = await huntIndicators(req.user!.organizationId, inds, b.days);
  const hitIds = new Set(hits.map((h) => oid(h.indicator.id)));
  for (const i of inds) if (hitIds.has(oid(i._id))) {
    const n = hits.filter((h) => oid(h.indicator.id) === oid(i._id));
    i.sightings = (i.sightings || 0) + n.length; i.lastSightingAt = new Date(); i.lastSightingNote = n[0].detail; await i.save();
  }
  if (hits.length) {
    const mgrs = await usersWithModule(req.user!.organizationId, 'threat_intel_manage');
    await notifyWork({ organizationId: req.user!.organizationId, userIds: mgrs.map((u: any) => String(u._id)), type: 'threat_intel', severity: 'high', dedupeKey: `ti-hunt:${new Date().toISOString().slice(0, 13)}`, title: `Threat hunt: ${hits.length} indicator match${hits.length === 1 ? '' : 'es'} in our own data`, summary: 'Active indicators were found in our sign-ins, audit log, mail log or user directory. Investigate and open an incident if confirmed.', link: '/threat-intel?tab=indicators&seen=1' });
  }
  await audit(req, 'threat_hunt.run', 'ThreatIndicator', 'hunt', { module: 'threat_intel', severity: hits.length ? 'high' : 'low', summary: `${inds.length} indicators checked, ${hits.length} matches` });
  res.json({ checked: inds.length, days: b.days, hits });
}));
router.patch('/indicators/:id', asyncHandler(async (req, res) => {
  needManage(req);
  const b = z.object({ status: z.enum(['active', 'expired', 'revoked', 'allowlisted']).optional(), confidence: z.number().int().min(0).max(100).optional(), severity: z.enum(SEVERITIES).optional(), description: z.string().max(300).optional(), validUntil: z.string().nullable().optional() }).parse(req.body);
  const i: any = await ThreatIndicator.findOne({ _id: req.params.id, organizationId: req.user!.organizationId });
  if (!i) throw ApiError.notFound('Indicator not found');
  const { validUntil, ...rest } = b; Object.assign(i, rest);
  if (validUntil !== undefined) i.validUntil = validUntil ? new Date(validUntil) : undefined;
  await i.save();
  await audit(req, 'threat_indicator.updated', 'ThreatIndicator', String(i._id), { module: 'threat_intel', severity: 'low', summary: `${i.type}: ${i.value} → ${i.status}` });
  res.json(i);
}));
router.delete('/indicators/:id', asyncHandler(async (req, res) => {
  needManage(req);
  const i = await ThreatIndicator.findOneAndDelete({ _id: req.params.id, organizationId: req.user!.organizationId });
  if (!i) throw ApiError.notFound('Indicator not found');
  await audit(req, 'threat_indicator.deleted', 'ThreatIndicator', String(i._id), { module: 'threat_intel', severity: 'low', summary: `${i.type}: ${i.value}` });
  res.json({ ok: true });
}));

/* ----------------------------------- import -------------------------------- */
router.post('/import', asyncHandler(async (req, res) => {
  needManage(req);
  const b = z.object({ format: z.enum(['stix', 'csv', 'text']), content: z.string().min(2).max(15_000_000), title: z.string().max(200).optional(), sourceId: idz.optional(), tlp: z.enum(TLPS).default('GREEN'), severity: z.enum(SEVERITIES).default('medium'), layer: z.enum(LAYERS).default('operational') }).parse(req.body);
  const org = req.user!.organizationId;
  let parsed: { indicators: any[]; cves?: string[]; ttps?: string[]; title?: string; description?: string; rejected?: string[] };
  if (b.format === 'stix') { let j: any; try { j = JSON.parse(b.content); } catch { throw ApiError.badRequest('That is not valid JSON — a STIX 2.1 bundle is expected.'); } parsed = parseStixBundle(j); }
  else if (b.format === 'csv') parsed = parseCsvIocs(b.content); else parsed = parseIocText(b.content);
  if (!parsed.indicators.length && !parsed.cves?.length && !parsed.ttps?.length) throw ApiError.badRequest('Nothing usable was found in that file.');
  const src: any = b.sourceId ? await ThreatSource.findOne(excludeDeleted({ _id: b.sourceId, organizationId: org })) : null;
  const intel: any = await ThreatIntel.create({ organizationId: org, reference: await newReference(org), title: b.title || parsed.title || `Imported ${b.format.toUpperCase()} ${new Date().toISOString().slice(0, 10)}`, summary: parsed.description || `${parsed.indicators.length} indicators imported by ${req.user!.name}.`, layer: b.layer, severity: b.severity, tlp: b.tlp, origin: 'import', sourceId: src?._id, sourceName: src?.name, sourceUrl: src?.url, cves: parsed.cves || [], ttps: parsed.ttps || [], createdById: req.user!.id, createdByName: req.user!.name });
  const r = await upsertIndicators(org, parsed.indicators.slice(0, 20000), { intelId: intel._id, tlp: b.tlp, severity: b.severity, sourceName: src?.name, byName: req.user!.name });
  await audit(req, 'threat_intel.imported', 'ThreatIntel', String(intel._id), { module: 'threat_intel', severity: 'low', summary: `${intel.reference}: ${r.created} new indicators` });
  res.status(201).json({ intel, ...r, rejected: parsed.rejected || [] });
}));

/* ----------------------------------- export -------------------------------- */
router.get('/export/indicators.csv', asyncHandler(async (req, res) => {
  needManage(req);
  const rows: any[] = await ThreatIndicator.find({ organizationId: req.user!.organizationId, status: 'active', tlp: { $in: ['CLEAR', 'GREEN'] } }).lean();
  const cell = (v: any) => `"${String(v ?? '').replace(/"/g, '""').replace(/^([=+\-@])/, "'$1")}"`;
  res.setHeader('Content-Type', 'text/csv; charset=utf-8'); res.setHeader('Content-Disposition', 'attachment; filename="indicators.csv"');
  res.send(['type,value,confidence,severity,tlp,valid_until', ...rows.map((r) => [r.type, r.value, r.confidence, r.severity, r.tlp, r.validUntil ? new Date(r.validUntil).toISOString() : ''].map(cell).join(','))].join('\n'));
}));

/* ----------------------------------- intelligence -------------------------- */
const intelZ = z.object({
  title: z.string().trim().min(3).max(240), summary: z.string().max(8000).default(''), layer: z.enum(LAYERS).default('tactical'), category: z.enum(CATEGORIES).default('other'),
  actorType: z.enum(ACTOR_TYPES).optional(), actorName: z.string().max(120).optional(), severity: z.enum(SEVERITIES).default('medium'), confidence: z.enum(['low', 'medium', 'high']).default('medium'),
  credibility: z.number().int().min(1).max(6).default(3), tlp: z.enum(TLPS).default('GREEN'), restrictedTo: z.array(idz).max(50).optional(),
  sourceId: idz.optional().nullable(), sourceName: z.string().max(160).optional(), sourceUrl: z.string().max(800).optional(), observedAt: z.string().optional(), validUntil: z.string().optional().nullable(),
  ttps: z.array(z.string().regex(/^T\d{4}(\.\d{3})?$/, 'Use MITRE ATT&CK ids such as T1566 or T1566.001')).max(50).optional(), cves: z.array(z.string().regex(/^CVE-\d{4}-\d{4,7}$/i)).max(100).optional(),
  affectedProducts: z.array(z.string().max(120)).max(50).optional(), tags: z.array(z.string().max(40)).max(20).optional(), recommendations: z.string().max(8000).optional(), analysis: z.string().max(8000).optional(),
  analystId: idz.optional().nullable(), nextReviewDate: z.string().optional().nullable(),
});
router.get('/', asyncHandler(async (req, res) => {
  const { layer, severity, status, tlp, category, search, exposed, mine } = req.query as any;
  const q: any = {};
  if (layer) q.layer = layer; if (severity) q.severity = severity; if (tlp) q.tlp = tlp; if (category) q.category = category;
  if (status === 'open') q.status = { $nin: ['closed', 'dismissed'] }; else if (status) q.status = status;
  if (exposed === '1') q['matchedAssetIds.0'] = { $exists: true };
  if (mine === '1') q.analystId = req.user!.id;
  if (search) { const r = RE(String(search)); q.$and = [{ $or: [{ title: r }, { reference: r }, { summary: r }, { cves: r }, { tags: r }, { actorName: r }] }]; }
  const rows = await ThreatIntel.find(scope(req, q)).sort({ createdAt: -1 }).limit(500).select('-notes').lean();
  res.json(rows);
}));
router.post('/', asyncHandler(async (req, res) => {
  needManage(req);
  const b = intelZ.parse(req.body); const org = req.user!.organizationId;
  const src: any = b.sourceId ? await ThreatSource.findOne(excludeDeleted({ _id: b.sourceId, organizationId: org })) : null;
  if (b.sourceId && !src) throw ApiError.badRequest('That source does not exist.');
  if (src && !src.vetted) throw ApiError.badRequest(`"${src.name}" has not been vetted yet. Vet the source first (policy 2.2), or leave the source empty.`);
  const analyst = b.analystId ? await User.findOne({ _id: b.analystId, organizationId: org }).select('name') : null;
  const t: any = await ThreatIntel.create({
    ...b, sourceId: src?._id, sourceName: src?.name || b.sourceName, sourceUrl: b.sourceUrl || src?.url, organizationId: org, reference: await newReference(org),
    cves: (b.cves || []).map((c) => c.toUpperCase()), restrictedTo: b.tlp === 'RED' ? Array.from(new Set([...(b.restrictedTo || []), req.user!.id])) : [],
    observedAt: b.observedAt ? new Date(b.observedAt) : new Date(), validUntil: b.validUntil ? new Date(b.validUntil) : undefined, nextReviewDate: b.nextReviewDate ? new Date(b.nextReviewDate) : new Date(Date.now() + 90 * day),
    analystId: analyst?._id, analystName: (analyst as any)?.name, createdById: req.user!.id, createdByName: req.user!.name, origin: 'manual',
  });
  if (t.affectedProducts.length || t.cves.length) { const ex = await checkExposure(org, t.affectedProducts); t.matchedAssetIds = ex.map((e: any) => e.id); t.exposureCheckedAt = new Date(); await t.save(); if (ex.length) (await import('../services/assetRisk.service')).afterIntelMatched(org, ex.map((e: any) => e.id), `threat ${t.reference} matched`).catch(() => undefined); }
  await audit(req, 'threat_intel.created', 'ThreatIntel', String(t._id), { module: 'threat_intel', severity: 'low', summary: `${t.reference} ${t.title}` });
  if (['high', 'critical'].includes(t.severity) && t.tlp !== 'RED') {
    const people = await usersWithModule(org, 'threat_intel');
    await notifyWork({ organizationId: org, userIds: people.map((u: any) => String(u._id)).filter((i) => i !== req.user!.id), type: 'threat_intel', severity: t.severity === 'critical' ? 'critical' : 'high', title: `${t.severity.toUpperCase()} threat: ${t.title}`, summary: `${t.reference} was recorded by ${req.user!.name}.`, link: `/threat-intel?item=${t._id}`, cta: 'Open intelligence' });
  }
  res.status(201).json(t);
}));
router.get('/:id', asyncHandler(async (req, res) => {
  const t = await load(req);
  const org = req.user!.organizationId;
  const [indicators, assets] = await Promise.all([
    ThreatIndicator.find({ organizationId: org, intelId: t._id, ...(manage(req) ? {} : { tlp: { $ne: 'RED' } }) }).limit(500).lean(),
    t.matchedAssetIds.length ? (await import('../models/Asset')).Asset.find({ _id: { $in: t.matchedAssetIds } }).select('assetId title classification criticality assignedToName').lean() : [],
  ]);
  res.json({ ...t.toObject(), indicators, matchedAssets: assets });
}));
router.patch('/:id', asyncHandler(async (req, res) => {
  needManage(req);
  const t = await load(req);
  const b = intelZ.partial().parse(req.body);
  const { observedAt, validUntil, nextReviewDate, analystId, restrictedTo, sourceId, ...rest } = b as any;
  if (rest.tlp && rest.tlp !== t.tlp && t.shares.length && ['RED', 'AMBER'].includes(rest.tlp)) throw ApiError.badRequest('This has already been shared — its TLP cannot be tightened afterwards.');
  Object.assign(t, rest);
  if (rest.cves) t.cves = rest.cves.map((c: string) => c.toUpperCase());
  if (observedAt) t.observedAt = new Date(observedAt); if (validUntil !== undefined) t.validUntil = validUntil ? new Date(validUntil) : undefined; if (nextReviewDate !== undefined) t.nextReviewDate = nextReviewDate ? new Date(nextReviewDate) : undefined;
  if (restrictedTo) t.restrictedTo = t.tlp === 'RED' ? restrictedTo : [];
  if (analystId !== undefined) { const a: any = analystId ? await User.findOne({ _id: analystId, organizationId: req.user!.organizationId }).select('name') : null; t.analystId = a?._id; t.analystName = a?.name; }
  if (sourceId !== undefined) { const s: any = sourceId ? await ThreatSource.findOne(excludeDeleted({ _id: sourceId, organizationId: req.user!.organizationId })) : null; if (s && !s.vetted) throw ApiError.badRequest('That source has not been vetted.'); t.sourceId = s?._id; t.sourceName = s?.name || t.sourceName; }
  if (rest.analysis !== undefined && rest.analysis.trim() && t.status === 'triaged') t.status = 'analysed';
  await t.save();
  await audit(req, 'threat_intel.updated', 'ThreatIntel', String(t._id), { module: 'threat_intel', severity: 'low', summary: `${t.reference} ${t.title}` });
  res.json(t);
}));
router.post('/:id/transition', asyncHandler(async (req, res) => {
  needManage(req);
  const t = await load(req);
  const b = z.object({ status: z.enum(INTEL_STATUSES), reason: z.string().trim().max(500).optional() }).parse(req.body);
  if (['analysed', 'actioned', 'shared'].includes(b.status) && !t.analysis?.trim()) throw ApiError.badRequest('Write the analysis first: how does this affect us, and why does it matter?');
  if (b.status === 'actioned' && !t.actions.length) throw ApiError.badRequest('Add at least one action (risk assessment, control update, test input, hunt, awareness …) before marking it actioned.');
  if (['dismissed', 'closed'].includes(b.status) && !b.reason) throw ApiError.badRequest('Give a reason for closing or dismissing it.');
  const from = t.status; t.status = b.status; if (['closed', 'dismissed'].includes(b.status)) t.closedAt = new Date(); else t.closedAt = undefined;
  if (b.status === 'dismissed') t.relevance = 'not_relevant';
  note(req, t, `Status ${from} → ${b.status}${b.reason ? `: ${b.reason}` : ''}`);
  await t.save();
  await audit(req, 'threat_intel.transition', 'ThreatIntel', String(t._id), { module: 'threat_intel', severity: 'low', summary: `${t.reference}: ${from} → ${b.status}` });
  res.json(t);
}));
router.post('/:id/assess', asyncHandler(async (req, res) => {
  needManage(req);
  const t = await load(req);
  const b = z.object({ relevance: z.enum(['not_relevant', 'low', 'medium', 'high']).optional(), analysis: z.string().max(8000).optional(), recommendations: z.string().max(8000).optional(), affectedProducts: z.array(z.string().max(120)).max(50).optional() }).parse(req.body || {});
  if (b.affectedProducts) t.affectedProducts = b.affectedProducts;
  if (b.analysis !== undefined) t.analysis = b.analysis; if (b.recommendations !== undefined) t.recommendations = b.recommendations;
  const ex = await checkExposure(req.user!.organizationId, t.affectedProducts);
  t.matchedAssetIds = ex.map((e: any) => e.id); t.exposureCheckedAt = new Date();
  t.relevance = b.relevance || (ex.length ? (t.relevance === 'unassessed' || t.relevance === 'low' ? 'high' : t.relevance) : t.relevance);
  if (t.status === 'new') t.status = 'triaged';
  if (t.analysis?.trim() && t.status === 'triaged') t.status = 'analysed';
  if (!t.analystId) { t.analystId = req.user!.id; t.analystName = req.user!.name; }
  note(req, t, `Assessed: ${ex.length} of our assets match the affected products; relevance ${t.relevance}.`);
  await t.save();
  await audit(req, 'threat_intel.assessed', 'ThreatIntel', String(t._id), { module: 'threat_intel', severity: ex.length ? 'medium' : 'low', summary: `${t.reference}: ${ex.length} assets exposed` });
  res.json({ intel: t, exposure: ex });
}));
router.post('/:id/notes', asyncHandler(async (req, res) => {
  const t = await load(req);
  const b = z.object({ text: z.string().trim().min(1).max(2000) }).parse(req.body);
  note(req, t, b.text); await t.save(); res.status(201).json(t.notes);
}));
router.post('/:id/actions', asyncHandler(async (req, res) => {
  needManage(req);
  const t = await load(req); const org = req.user!.organizationId;
  const b = z.object({ type: z.enum(ACTION_TYPES).default('other'), text: z.string().trim().min(3).max(1000), ownerId: idz.optional(), dueDate: z.string().optional(), createTask: z.boolean().default(false), createRisk: z.boolean().default(false) }).parse(req.body);
  const owner: any = b.ownerId ? await User.findOne({ _id: b.ownerId, organizationId: org, isActive: true }).select('name') : null;
  if (b.ownerId && !owner) throw ApiError.badRequest('That owner is not an active user.');
  const due = b.dueDate ? new Date(b.dueDate) : new Date(Date.now() + (t.severity === 'critical' ? 3 : t.severity === 'high' ? 7 : 21) * day);
  const act: any = { type: b.type, text: b.text, ownerId: owner?._id, ownerName: owner?.name, dueDate: due };
  if (b.createTask) {
    const assignee = owner?._id || req.user!.id;
    const task: any = await Task.create({ organizationId: org, title: `[${t.reference}] ${b.text}`.slice(0, 200), description: `<p>From threat intelligence <strong>${t.reference}</strong>: ${t.title.replace(/[<>&]/g, '')}</p>`, ownerId: assignee, creatorId: req.user!.id, priority: t.severity === 'critical' ? 'urgent' : t.severity === 'high' ? 'high' : 'medium', severity: t.severity === 'critical' ? 'critical' : t.severity === 'high' ? 'major' : 'minor', status: 'open', startDate: new Date(), endDate: due, dueDate: due, tags: ['threat-intel', t.reference], source: 'manual' });
    act.taskId = task._id;
    await notifyWork({ organizationId: org, userIds: [String(assignee)].filter((i) => i !== req.user!.id), type: 'task', title: `New task from threat intelligence: ${t.title}`, summary: b.text, link: `/tasks/${task._id}`, cta: 'Open task' });
  }
  if (b.createRisk) {
    const risk: any = await Risk.create({ organizationId: org, title: `Threat: ${t.title}`.slice(0, 200), description: `${t.summary}\n\nSource: ${t.reference}`, kind: 'risk', category: 'security', ownerId: owner?._id || req.user!.id, raisedById: req.user!.id, severity: t.severity, impact: t.severity, mitigationPlan: b.text, autoGenerated: false });
    act.riskId = risk._id;
  }
  t.actions.push(act); if (['analysed', 'triaged'].includes(t.status) && t.analysis?.trim()) t.status = 'actioned';
  note(req, t, `Action added (${b.type}): ${b.text}`); await t.save();
  await audit(req, 'threat_intel.action_added', 'ThreatIntel', String(t._id), { module: 'threat_intel', severity: 'low', summary: `${t.reference}: ${b.text.slice(0, 80)}` });
  res.status(201).json(t);
}));
router.post('/:id/actions/:actionId/done', asyncHandler(async (req, res) => {
  const t = await load(req); const a = t.actions.id(req.params.actionId);
  if (!a) throw ApiError.notFound('Action not found');
  if (!manage(req) && oid(a.ownerId) !== req.user!.id) throw ApiError.forbidden('Only the owner or a manager can complete this action.');
  a.done = !a.done; a.doneAt = a.done ? new Date() : undefined; note(req, t, `Action ${a.done ? 'completed' : 'reopened'}: ${a.text}`);
  await t.save(); res.json(t);
}));
router.post('/:id/incident', asyncHandler(async (req, res) => {
  needManage(req);
  const t = await load(req); const org = req.user!.organizationId;
  if (t.incidentId) throw ApiError.conflict('An incident has already been opened for this.');
  const cat = t.category === 'phishing' ? 'phishing' : ['malware', 'ransomware'].includes(t.category) ? 'malware' : t.category === 'insider' ? 'policy_violation' : t.category === 'supply_chain' ? 'supplier' : 'unauthorised_access';
  const inc: any = await Incident.create({
    organizationId: org, reference: await nextNumber(org, 'INC', { yearly: true, pad: 4 }), title: `Threat: ${t.title}`.slice(0, 240),
    description: `<p>Opened from threat intelligence <strong>${t.reference}</strong>.</p><p>${String(t.summary || '').replace(/[<>&]/g, '').replace(/\n/g, '<br>')}</p>`,
    category: cat, severity: t.severity, reportedById: req.user!.id, assigneeId: req.user!.id, affectedAssetIds: t.matchedAssetIds,
    timeline: [{ at: new Date(), byId: req.user!.id, byName: req.user!.name, text: `Opened from threat intelligence ${t.reference}` }],
  });
  t.incidentId = inc._id; t.actions.push({ type: 'incident_response', text: `Incident ${inc.reference} opened`, ownerId: req.user!.id, ownerName: req.user!.name, done: false });
  note(req, t, `Incident ${inc.reference} opened`); await t.save();
  await audit(req, 'threat_intel.incident_opened', 'ThreatIntel', String(t._id), { module: 'threat_intel', severity: 'high', summary: `${t.reference} → ${inc.reference}` });
  res.status(201).json({ incidentId: inc._id, reference: inc.reference });
}));
router.post('/:id/share', asyncHandler(async (req, res) => {
  needManage(req);
  const t = await load(req);
  const b = z.object({ recipient: z.string().trim().max(200).optional(), method: z.enum(SHARE_METHODS), anonymise: z.boolean().default(false), note: z.string().max(500).optional() }).parse(req.body);
  assertShareable(t, b);
  t.shares.push({ at: new Date(), byId: req.user!.id, byName: req.user!.name, recipient: b.recipient || (b.method === 'public' ? 'Public' : ''), method: b.method, tlp: t.tlp, anonymised: b.anonymise, note: b.note });
  t.status = 'shared'; note(req, t, `Shared (${b.method}, TLP:${t.tlp}) with ${b.recipient || 'public'}${b.anonymise ? ' — anonymised' : ''}`);
  await t.save();
  await audit(req, 'threat_intel.shared', 'ThreatIntel', String(t._id), { module: 'threat_intel', severity: 'medium', summary: `${t.reference} shared via ${b.method} with ${b.recipient || 'public'} (TLP:${t.tlp})` });
  res.json(t);
}));
router.get('/:id/stix', asyncHandler(async (req, res) => {
  needManage(req);
  const t = await load(req);
  if (t.tlp === 'RED') throw ApiError.forbidden('TLP:RED cannot be exported.');
  const anon = req.query.anonymise === '1';
  const inds = await ThreatIndicator.find({ organizationId: req.user!.organizationId, intelId: t._id, status: 'active' }).lean();
  const bundle = toStixBundle(t.toObject(), inds, { anonymise: anon });
  await audit(req, 'threat_intel.stix_exported', 'ThreatIntel', String(t._id), { module: 'threat_intel', severity: 'low', summary: `${t.reference}${anon ? ' (anonymised)' : ''}` });
  res.setHeader('Content-Type', 'application/stix+json;version=2.1'); res.setHeader('Content-Disposition', `attachment; filename="${t.reference.replace(/[^\w-]/g, '_')}.stix.json"`);
  res.send(JSON.stringify(bundle, null, 2));
}));
router.delete('/:id', asyncHandler(async (req, res) => {
  needManage(req);
  const t = await load(req);
  if (t.shares.length) throw ApiError.badRequest('This has been shared, so it must be kept as a record. Close it instead.');
  (t as any).isDeleted = true; (t as any).deletedAt = new Date(); await t.save();
  await audit(req, 'threat_intel.deleted', 'ThreatIntel', String(t._id), { module: 'threat_intel', severity: 'medium', summary: `${t.reference} ${t.title}` });
  res.json({ ok: true });
}));

export default router;
