import crypto from 'crypto';
import { Asset } from '../models/Asset';
import { AssetThreatDecision } from '../models/AssetRisk';
import { IsmsRecord } from '../models/Isms';
import { ThreatIntel } from '../models/ThreatIntel';
import { Task } from '../models/Task';
import { User } from '../models/User';
import { ReminderLog } from '../models/Access';
import { nextNumber } from '../models/Access';
import { THREAT_CATALOGUE, PERSONAL_DATA_WORDS, ThreatTpl } from '../config/threatCatalogue';
import { createRecord, riskClass, updateRecord } from './isms/records.service';
import { usersWithModule } from './access.service';
import { notify } from './notify.service';
import { logger } from '../utils/logger';
import { ApiError } from '../utils/ApiError';

/** Risks scoring at least this (impact × likelihood) go straight into the risk register; lower ones stay as suggestions on the asset. */
export const AUTO_MIN_EXPOSURE = Math.max(1, Number(process.env.ASSET_RISK_AUTO_MIN) || 5);
const SYSTEM = { name: 'System (asset risk engine)' };
const DAY = 86400000;
const clamp = (n: number) => Math.max(1, Math.min(5, Math.round(n)));
const delta = (lvl?: string) => (lvl === 'High' ? 1 : lvl === 'Low' ? -1 : 0);
const hash = (v: unknown) => crypto.createHash('sha1').update(JSON.stringify(v)).digest('hex').slice(0, 16);

export interface AssetLite {
  _id: any; assetId: string; title: string; category: string; subCategory?: string; description?: string; vendor?: string; makeModel?: string; version?: string;
  tags?: string[]; classification?: string; confidentiality?: string; integrity?: string; availability?: string; eolState?: string; backupSchedule?: string;
  lifecycleStatus?: string; dataQualityFlags?: string[]; owner?: string; ownerUser?: any; custodianUser?: any; custodian?: string;
}
export interface IntelLite { _id?: any; reference: string; title: string; category: string; severity: string; cves?: string[] }

export interface Exposure {
  key: string; name: string; vulnerability: string; nature: 'Internal' | 'External'; soa: string; controls: string; treatment: string;
  cImpact: number; iImpact: number; aImpact: number; impact: number; likelihood: number; exposure: number; classification: string;
  reasons: string[]; intel: string[];
}

const IN_SERVICE = ['active', 'under_maintenance'];

/** Pure: which catalogue threats apply to this asset and how bad are they? */
export function evaluate(asset: AssetLite, liveIntel: IntelLite[] = [], catalogue: ThreatTpl[] = THREAT_CATALOGUE): Exposure[] {
  if (!IN_SERVICE.includes(asset.lifecycleStatus || 'active')) return [];
  const text = [asset.title, asset.subCategory, asset.vendor, asset.makeModel, asset.description, (asset.tags || []).join(' ')].filter(Boolean).join(' ');
  const holdsPersonalData = PERSONAL_DATA_WORDS.test(text) || (asset.tags || []).some((t) => /personal|pii|ndpa/i.test(t));
  const out: Exposure[] = [];
  for (const t of catalogue) {
    if (!t.categories.includes(asset.category)) continue;
    if (t.match && !t.match.test(text)) continue;
    if (t.exclude && t.exclude.test(text)) continue;
    if (t.personalData && !holdsPersonalData) continue;
    const reasons: string[] = [];
    const dim = (base: number, lvl?: string) => (base > 0 ? clamp(base + delta(lvl)) : 1);
    const c = dim(t.impact.c, asset.confidentiality), i = dim(t.impact.i, asset.integrity), a = dim(t.impact.a, asset.availability);
    const worst = Math.max(c, i, a);
    const lead = c === worst ? ['confidentiality', asset.confidentiality] : i === worst ? ['integrity', asset.integrity] : ['availability', asset.availability];
    if (lead[1]) reasons.push(`${lead[0]} rated ${lead[1]}`);
    let l = t.likelihood;
    if (t.ageSensitive && asset.eolState === 'expired') { l += 1; reasons.push('past its end-of-life date'); }
    if (t.confidentialityThreat && asset.classification === 'Restricted') { l += 1; reasons.push('labelled Restricted'); }
    if (t.backupSensitive && asset.backupSchedule) { l -= 1; reasons.push('backup schedule recorded'); }
    if (t.nature === 'Internal' && (asset.dataQualityFlags || []).includes('missing_owner')) { l += 1; reasons.push('no owner assigned'); }
    const hits = liveIntel.filter((x) => (t.intel || []).some((w) => x.category === w || new RegExp(w.replace(/_/g, '[ _]'), 'i').test(x.title)));
    if (hits.length) { l += 1; reasons.push(`live threat intelligence: ${hits.slice(0, 3).map((h) => h.reference).join(', ')}`); }
    l = clamp(l);
    const exposure = worst * l;
    out.push({ key: t.key, name: t.name, vulnerability: t.vulnerability, nature: t.nature, soa: t.soa, controls: t.controls, treatment: t.treatment, cImpact: c, iImpact: i, aImpact: a, impact: worst, likelihood: l, exposure, classification: riskClass(exposure), reasons, intel: hits.map((h) => h.reference) });
  }
  return out.sort((x, y) => y.exposure - x.exposure);
}

const fingerprint = (a: AssetLite, ex: Exposure[]) => hash({ cia: [a.confidentiality, a.integrity, a.availability], cl: a.classification, lc: a.lifecycleStatus, o: String(a.ownerUser || a.owner || ''), ex: ex.map((e) => [e.key, e.impact, e.likelihood]) });

const sourceId = (a: { assetId: string }, key: string) => `${a.assetId}:${key}`;
const humanTouched = (rec: any) => (rec.history || []).some((h: any) => !!h.byId);
const intelCategoryOf = (t?: ThreatTpl): string => {
  if (!t) return 'other';
  if (/insider/.test(t.key)) return 'insider';
  const first = (t.intel || []).find((w) => ['ransomware', 'malware', 'phishing', 'vulnerability', 'ddos', 'web_application', 'supply_chain', 'zero_day', 'insider', 'apt', 'fraud'].includes(w));
  return first || 'other';
};

/* ------------------------------------------------------------------ who needs to know */
export async function stakeholders(orgId: string, asset: AssetLite) {
  const ids = (v: any) => (v ? [String(v._id || v)] : []);
  let ownerIds = ids(asset.ownerUser);
  if (!ownerIds.length && asset.owner) {
    const u: any = await User.findOne({ organizationId: orgId, isActive: true, name: new RegExp(`^${String(asset.owner).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, 'i') }).select('_id').lean();
    if (u) ownerIds = [String(u._id)];
  }
  const custodianIds = ids(asset.custodianUser).filter((x) => !ownerIds.includes(x));
  const ownerUser: any = ownerIds[0] ? await User.findById(ownerIds[0]).select('department').lean() : null;
  const heads: any[] = ownerUser?.department ? await User.find({ organizationId: orgId, isActive: true, headOfDepartments: ownerUser.department }).select('_id').lean() : [];
  const isms = (await usersWithModule(orgId, 'isms')).map((u: any) => String(u._id));
  const dpo = (await usersWithModule(orgId, 'data_protection')).map((u: any) => String(u._id));
  const leaders: any[] = await User.find({ organizationId: orgId, isActive: true, role: { $in: ['ceo', 'coo'] } }).select('_id').lean();
  const uniq = (a: string[]) => Array.from(new Set(a));
  return {
    owner: uniq(ownerIds), custodian: uniq(custodianIds), departmentHeads: uniq(heads.map((h) => String(h._id))).filter((x) => !ownerIds.includes(x)),
    isms: uniq(isms), dpo: uniq(dpo), leadership: uniq(leaders.map((l) => String(l._id))),
  };
}

/* ------------------------------------------------------------------ threat register (Threat Intelligence module) */
async function syncThreatRegister(orgId: string, asset: AssetLite, exposures: Exposure[], retire: boolean) {
  const catalogue = new Map(THREAT_CATALOGUE.map((t) => [t.key, t]));
  for (const e of exposures) {
    const externalId = `asset-threat:${e.key}`;
    const existing: any = await ThreatIntel.findOne({ organizationId: orgId, externalId });
    const registered = !retire && e.exposure >= AUTO_MIN_EXPOSURE;
    if (!existing) {
      if (!registered) continue;
      await ThreatIntel.create({
        organizationId: orgId, reference: await nextNumber(orgId, 'TI', { yearly: true, pad: 4 }), externalId, title: e.name,
        summary: `${e.name}. Weakness: ${e.vulnerability}. Identified automatically from the asset inventory.`,
        layer: 'strategic', category: intelCategoryOf(catalogue.get(e.key)), severity: e.exposure >= 20 ? 'critical' : e.exposure >= 10 ? 'high' : 'medium', confidence: 'medium', credibility: 3,
        tlp: 'GREEN', origin: 'asset', status: 'triaged', relevance: e.exposure >= 10 ? 'high' : 'medium', analysis: `Applies to ${asset.assetId} ${asset.title} (${e.reasons.join('; ') || 'catalogue default'}).`,
        recommendations: `Expected controls: ${e.controls}. Annex A: ${e.soa}.`, tags: ['asset-derived', asset.category], matchedAssetIds: [asset._id], exposureCheckedAt: new Date(), createdByName: SYSTEM.name,
      });
      continue;
    }
    if (registered) {
      const sev = e.exposure >= 20 ? 'critical' : e.exposure >= 10 ? 'high' : 'medium';
      const rank = ['low', 'medium', 'high', 'critical'];
      await ThreatIntel.updateOne({ _id: existing._id }, { $addToSet: { matchedAssetIds: asset._id }, $set: { exposureCheckedAt: new Date(), ...(rank.indexOf(sev) > rank.indexOf(existing.severity) ? { severity: sev } : {}) } });
    } else if (retire) {
      await ThreatIntel.updateOne({ _id: existing._id }, { $pull: { matchedAssetIds: asset._id } });
    }
  }
  if (retire) {
    await ThreatIntel.updateMany({ organizationId: orgId, origin: 'asset', matchedAssetIds: asset._id }, { $pull: { matchedAssetIds: asset._id } });
  }
}

/* ------------------------------------------------------------------ apply to the registers */
export interface ApplyResult { assetId: string; threats: number; created: Array<{ refNo: string; name: string; classification: string; exposure: number }>; rescored: string[]; flagged: string[]; closed: string[]; suggested: number; notified: number; skipped?: boolean }

async function once(orgId: string, key: string) { try { await ReminderLog.create({ organizationId: orgId, key }); return true; } catch { return false; } }

export async function applyAsset(orgId: string, assetOrId: any, opts: { reason: string; notify?: boolean; force?: boolean } = { reason: 'checked' }): Promise<ApplyResult> {
  const asset: any = typeof assetOrId === 'string' ? await Asset.findOne({ _id: assetOrId, organizationId: orgId }) : assetOrId;
  if (!asset) throw ApiError.notFound('Asset not found');
  const gone = !!asset.isDeleted || !IN_SERVICE.includes(asset.lifecycleStatus) && asset.lifecycleStatus !== 'planned';
  const result: ApplyResult = { assetId: asset.assetId, threats: 0, created: [], rescored: [], flagged: [], closed: [], suggested: 0, notified: 0 };

  const intel: any[] = await ThreatIntel.find({ organizationId: orgId, matchedAssetIds: asset._id, status: { $nin: ['closed', 'dismissed'] }, origin: { $ne: 'asset' } }).select('reference title category severity cves').lean();
  const dismissed = new Set((await AssetThreatDecision.find({ assetId: asset._id }).select('threatKey').lean()).map((d: any) => d.threatKey));
  const all = gone ? [] : evaluate(asset, intel);
  const exposures = all.filter((e) => !dismissed.has(e.key));
  result.threats = exposures.length;
  const fp = fingerprint(asset, exposures);
  if (!opts.force && !gone && asset.riskProfileHash === fp) { result.skipped = true; return result; }

  const existing: any[] = await IsmsRecord.find({ organizationId: orgId, register: 'risk', 'sourceRef.type': 'asset-threat', 'sourceRef.id': new RegExp(`^${asset.assetId.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}:`) });
  const byKey = new Map(existing.map((r) => [String(r.sourceRef?.id).split(':').pop() as string, r]));
  const owner = await stakeholders(orgId, asset);
  const ownerId = owner.owner[0];
  const ownerName = asset.owner || (ownerId ? ((await User.findById(ownerId).select('name').lean()) as any)?.name : undefined);

  if (gone) {
    for (const rec of existing) {
      if (['Closed'].includes(rec.status)) continue;
      try { await updateRecord(orgId, 'risk', String(rec._id), { status: 'Closed', note: `Asset ${asset.assetId} is ${asset.isDeleted ? 'deleted' : asset.lifecycleStatus}; risk no longer applies.` }, SYSTEM); result.closed.push(rec.refNo); } catch (err) { logger.warn({ err }, 'asset risk close failed'); }
    }
    await syncThreatRegister(orgId, asset, evaluate({ ...asset.toObject?.() || asset, lifecycleStatus: 'active' }, []), true);
  } else {
    for (const e of exposures) {
      const rec = byKey.get(e.key);
      const data = { cImpact: String(e.cImpact), iImpact: String(e.iImpact), aImpact: String(e.aImpact), likelihood: String(e.likelihood) };
      if (!rec) {
        if (e.exposure < AUTO_MIN_EXPOSURE) { result.suggested++; continue; }
        const created: any = await createRecord(orgId, 'risk', {
          ownerId, ownerName,
          data: {
            asset: `${asset.assetId} ${asset.title}`, threat: e.name, vulnerability: e.vulnerability, riskSummary: `${e.name}: ${asset.title} (${asset.assetId})`, riskNature: e.nature, ...data,
            treatment: e.treatment, soa: e.soa, frequency: e.exposure >= 10 ? 'Quarterly' : e.exposure >= 5 ? 'Bi-annual' : 'Annual', lastAssessment: new Date(),
            notes: `Identified automatically (${opts.reason}). Why this score: ${e.reasons.join('; ') || 'catalogue default'}. Expected controls: ${e.controls}. Owner: please confirm the controls that exist and adjust the scores if needed.`,
          },
        }, SYSTEM, { source: 'auto', sourceRef: { type: 'asset-threat', id: sourceId(asset, e.key) } });
        result.created.push({ refNo: created.refNo, name: e.name, classification: created.data?.classification || e.classification, exposure: created.data?.exposure || e.exposure });
        continue;
      }
      const old = rec.data || {};
      const same = ['cImpact', 'iImpact', 'aImpact', 'likelihood'].every((k) => String(old[k]) === (data as any)[k]);
      if (!same && !['Closed'].includes(rec.status)) {
        if (humanTouched(rec)) {
          rec.history.push({ at: new Date(), byName: SYSTEM.name, action: 'review suggested', note: `After "${opts.reason}" the engine now scores this ${e.exposure} (${e.classification}): impact ${e.impact} × likelihood ${e.likelihood}. Your own score was kept.` });
          await rec.save(); result.flagged.push(rec.refNo);
        } else {
          await updateRecord(orgId, 'risk', String(rec._id), { data, note: `Re-scored after "${opts.reason}"` }, SYSTEM);
          result.rescored.push(rec.refNo);
        }
      }
      if (ownerId && !rec.ownerId && !['Closed'].includes(rec.status)) { rec.ownerId = ownerId; rec.ownerName = ownerName; await rec.save(); }
    }
    await syncThreatRegister(orgId, asset, exposures, false);
  }

  await Asset.updateOne({ _id: asset._id }, { $set: { riskEvaluatedAt: new Date(), riskProfileHash: fp } });

  if (opts.notify !== false && (result.created.length || result.rescored.length || result.flagged.length || result.closed.length)) {
    result.notified = await notifyStakeholders(orgId, asset, result, owner, opts.reason);
  }
  return result;
}

async function notifyStakeholders(orgId: string, asset: any, r: ApplyResult, who: Awaited<ReturnType<typeof stakeholders>>, reason: string) {
  const major = r.created.filter((c) => c.classification === 'Major');
  const sig = hash([asset.assetId, r.created.map((c) => c.refNo), r.rescored, r.flagged, r.closed]);
  const lines = r.created.map((c) => `• ${c.refNo} ${c.name} – ${c.classification} (${c.exposure})`);
  const link = '/isms?register=risk';
  let n = 0;
  const send = async (group: string, userIds: string[], title: string, body: string, sev: 'info' | 'warning' | 'high', email: boolean, to = link) => {
    if (!userIds.length) return;
    n += await notify({ organizationId: orgId, userIds, title, body, link: to, type: 'risk', severity: sev, category: 'system', dedupeKey: `asset-risk:${sig}:${group}`, email: email ? { intro: body.replace(/\n/g, '<br>'), ctaLabel: 'Review the risks' } : undefined });
  };
  if (r.closed.length) {
    await send('closed-isms', [...who.isms, ...who.owner], `${r.closed.length} risk(s) closed for ${asset.assetId}`, `${asset.title} is ${asset.isDeleted ? 'deleted' : asset.lifecycleStatus}; its automatically created risks (${r.closed.join(', ')}) were closed.`, 'info', false);
    return n;
  }
  if (r.created.length) {
    const body = `${asset.assetId} ${asset.title} (${reason}) is exposed to ${r.created.length} threat(s) that now sit in the risk register:\n${lines.join('\n')}\nPlease confirm the existing controls and adjust the scores if needed.`;
    await send('owner', [...who.owner, ...who.custodian], `Risks identified for your asset ${asset.assetId}`, body, major.length ? 'high' : 'warning', major.length > 0);
    await send('isms', who.isms.filter((x) => !who.owner.includes(x)), `${r.created.length} new risk(s) from asset ${asset.assetId}`, body, major.length ? 'high' : 'info', major.length > 0);
    await send('heads', who.departmentHeads, `New risks for an asset in your department (${asset.assetId})`, body, 'info', false);
    if (major.length) await send('leadership', who.leadership.filter((x) => ![...who.isms, ...who.owner].includes(x)), `Major risk identified: ${asset.assetId}`, body, 'high', true);
    if (r.created.some((c) => /personal-data/i.test(c.name))) await send('dpo', who.dpo.filter((x) => !who.isms.includes(x)), `Personal-data risk for ${asset.assetId}`, `${body}\nCheck the ROPA entry and retention rule for this information.`, 'warning', false, '/data-protection');
    // one follow-up task so it cannot be forgotten
    if (who.owner[0] && (await once(orgId, `asset-risk-task:${sig}`))) {
      await Task.create({ organizationId: orgId, title: `Review the ${r.created.length} risk(s) identified for ${asset.assetId} ${asset.title}`, description: lines.join('\n'), ownerId: who.owner[0], priority: major.length ? 'high' : 'medium', status: 'open', dueDate: new Date(Date.now() + (major.length ? 7 : 14) * DAY), tags: ['auto-generated', 'asset-risk'] }).catch((err: any) => logger.warn({ err }, 'asset risk task failed'));
    }
  }
  if (r.rescored.length || r.flagged.length) {
    const body = `${asset.assetId} ${asset.title} changed (${reason}).${r.rescored.length ? ` Re-scored automatically: ${r.rescored.join(', ')}.` : ''}${r.flagged.length ? ` Your own scores were kept but need a look: ${r.flagged.join(', ')}.` : ''}`;
    await send('rescored', [...who.owner, ...(r.flagged.length ? who.isms : [])], `Risk scores changed for ${asset.assetId}`, body, r.flagged.length ? 'warning' : 'info', false);
  }
  return n;
}

/* ------------------------------------------------------------------ profile (read only) */
export async function profile(orgId: string, assetId: string) {
  const asset: any = await Asset.findOne({ _id: assetId, organizationId: orgId });
  if (!asset) throw ApiError.notFound('Asset not found');
  const intel: any[] = await ThreatIntel.find({ organizationId: orgId, matchedAssetIds: asset._id, status: { $nin: ['closed', 'dismissed'] }, origin: { $ne: 'asset' } }).select('reference title category severity cves').lean();
  const decisions: any[] = await AssetThreatDecision.find({ assetId: asset._id }).lean();
  const dmap = new Map(decisions.map((d) => [d.threatKey, d]));
  const recs: any[] = await IsmsRecord.find({ organizationId: orgId, register: 'risk', 'sourceRef.type': 'asset-threat', 'sourceRef.id': new RegExp(`^${asset.assetId.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}:`) }).select('refNo status data ownerName sourceRef').lean();
  const rmap = new Map(recs.map((r) => [String(r.sourceRef?.id).split(':').pop() as string, r]));
  const rows = evaluate(asset, intel).map((e) => {
    const r = rmap.get(e.key); const d = dmap.get(e.key);
    return { ...e, state: d ? 'dismissed' : r ? 'registered' : e.exposure >= AUTO_MIN_EXPOSURE ? 'pending' : 'suggested', dismissedReason: d?.reason, risk: r ? { id: String(r._id), refNo: r.refNo, status: r.status, owner: r.ownerName, exposure: r.data?.exposure, classification: r.data?.classification } : undefined };
  });
  return { assetId: asset.assetId, title: asset.title, evaluatedAt: asset.riskEvaluatedAt, autoThreshold: AUTO_MIN_EXPOSURE, inService: IN_SERVICE.includes(asset.lifecycleStatus), intel, rows, totals: { registered: rows.filter((x) => x.state === 'registered').length, suggested: rows.filter((x) => x.state === 'suggested' || x.state === 'pending').length, dismissed: rows.filter((x) => x.state === 'dismissed').length } };
}

export async function acceptSuggestion(orgId: string, assetId: string, key: string, actor: { id?: string; name: string }) {
  const asset: any = await Asset.findOne({ _id: assetId, organizationId: orgId });
  if (!asset) throw ApiError.notFound('Asset not found');
  await AssetThreatDecision.deleteOne({ assetId: asset._id, threatKey: key });
  const e = evaluate(asset, []).find((x) => x.key === key);
  if (!e) throw ApiError.notFound('That threat does not apply to this asset');
  if (await IsmsRecord.exists({ organizationId: orgId, register: 'risk', 'sourceRef.type': 'asset-threat', 'sourceRef.id': sourceId(asset, key) })) throw ApiError.conflict('This risk is already in the register');
  const st = await stakeholders(orgId, asset);
  const rec: any = await createRecord(orgId, 'risk', {
    ownerId: st.owner[0], ownerName: asset.owner,
    data: { asset: `${asset.assetId} ${asset.title}`, threat: e.name, vulnerability: e.vulnerability, riskSummary: `${e.name}: ${asset.title} (${asset.assetId})`, riskNature: e.nature, cImpact: String(e.cImpact), iImpact: String(e.iImpact), aImpact: String(e.aImpact), likelihood: String(e.likelihood), treatment: e.treatment, soa: e.soa, frequency: 'Annual', lastAssessment: new Date(), notes: `Accepted into the register by ${actor.name} from the asset's suggested threats. Expected controls: ${e.controls}.` },
  }, actor, { source: 'auto', sourceRef: { type: 'asset-threat', id: sourceId(asset, key) } });
  await syncThreatRegister(orgId, asset, [e], false);
  return rec;
}

export async function dismissThreat(orgId: string, assetId: string, key: string, reason: string, actor: { id?: string; name: string }) {
  if (String(reason || '').trim().length < 5) throw ApiError.badRequest('Say why this threat does not apply (at least a few words) – the reason is kept for the auditor.');
  const asset: any = await Asset.findOne({ _id: assetId, organizationId: orgId });
  if (!asset) throw ApiError.notFound('Asset not found');
  if (!THREAT_CATALOGUE.some((t) => t.key === key)) throw ApiError.notFound('Unknown threat');
  await AssetThreatDecision.findOneAndUpdate({ assetId: asset._id, threatKey: key }, { organizationId: orgId, assetRef: asset.assetId, decision: 'dismissed', reason: String(reason).trim().slice(0, 500), byId: actor.id, byName: actor.name }, { upsert: true });
  const rec: any = await IsmsRecord.findOne({ organizationId: orgId, register: 'risk', 'sourceRef.type': 'asset-threat', 'sourceRef.id': sourceId(asset, key) });
  if (rec && !['Closed'].includes(rec.status)) await updateRecord(orgId, 'risk', String(rec._id), { status: 'Closed', note: `Marked not applicable by ${actor.name}: ${reason}` }, actor);
  await ThreatIntel.updateOne({ organizationId: orgId, externalId: `asset-threat:${key}` }, { $pull: { matchedAssetIds: asset._id } });
  await Asset.updateOne({ _id: asset._id }, { $unset: { riskProfileHash: '' } });
}

/* ------------------------------------------------------------------ bulk: backfill + weekly sweep */
export async function evaluateAll(orgId: string, opts: { reason: string; force?: boolean } = { reason: 'weekly sweep' }) {
  const assets: any[] = await Asset.find({ organizationId: orgId });
  const out = { assets: assets.length, evaluated: 0, unchanged: 0, created: 0, rescored: 0, flagged: 0, closed: 0, suggested: 0, perOwner: new Map<string, string[]>(), details: [] as string[] };
  for (const a of assets) {
    try {
      const gone = !!a.isDeleted || ['retired', 'in_disposal', 'disposed'].includes(a.lifecycleStatus);
      if (gone && !a.riskProfileHash && !(await IsmsRecord.exists({ organizationId: orgId, register: 'risk', 'sourceRef.type': 'asset-threat', 'sourceRef.id': new RegExp(`^${String(a.assetId).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}:`), status: { $ne: 'Closed' } }))) { out.unchanged++; continue; }
      const r = await applyAsset(orgId, a, { reason: opts.reason, notify: false, force: opts.force });
      if (r.skipped) { out.unchanged++; continue; }
      out.evaluated++; out.created += r.created.length; out.rescored += r.rescored.length; out.flagged += r.flagged.length; out.closed += r.closed.length; out.suggested += r.suggested;
      if (r.created.length) {
        const st = await stakeholders(orgId, a);
        for (const id of [...st.owner, ...st.custodian]) { const list = out.perOwner.get(id) || []; list.push(`${a.assetId} ${a.title}: ${r.created.map((c) => c.refNo).join(', ')}`); out.perOwner.set(id, list); }
        out.details.push(`${a.assetId}: +${r.created.length}`);
      }
    } catch (err) { logger.warn({ err, asset: a.assetId }, 'asset risk evaluation failed'); }
  }
  return out;
}

/** One digest per owner and one for the ISMS team after a bulk run, instead of a notification per asset. */
export async function notifyBulk(orgId: string, r: Awaited<ReturnType<typeof evaluateAll>>, label: string, runKey: string) {
  let n = 0;
  for (const [uid, lines] of r.perOwner) {
    n += await notify({ organizationId: orgId, userIds: [uid], title: `Risks identified for ${lines.length} of your assets`, body: `${lines.slice(0, 12).join('\n')}${lines.length > 12 ? `\n… and ${lines.length - 12} more` : ''}\nPlease confirm the existing controls and adjust scores in the risk register.`, link: '/isms?register=risk', type: 'risk', severity: 'warning', category: 'system', dedupeKey: `asset-risk-digest:${runKey}:${uid}` });
  }
  if (r.created || r.flagged || r.closed) {
    const isms = (await usersWithModule(orgId, 'isms')).map((u: any) => String(u._id));
    n += await notify({ organizationId: orgId, userIds: isms, title: `${label}: ${r.created} new risk(s) from ${r.evaluated} asset(s)`, body: `${r.created} risk(s) created, ${r.rescored} re-scored, ${r.flagged} need a human review, ${r.closed} closed; ${r.suggested} lower-scoring threats are waiting as suggestions on the assets.`, link: '/isms?register=risk', type: 'risk', severity: r.created ? 'warning' : 'info', category: 'system', dedupeKey: `asset-risk-digest:${runKey}:isms` });
  }
  return n;
}

/** Fire-and-forget wrapper for routes: never let risk analysis break saving an asset. */
export async function afterAssetChange(orgId: string, asset: any, reason: string): Promise<ApplyResult | null> {
  try { return await applyAsset(orgId, asset, { reason, notify: true }); } catch (err) { logger.warn({ err, asset: asset?.assetId }, 'asset risk engine failed'); return null; }
}

/** Called when threat intelligence is matched to assets, so a new exploited vulnerability raises the likelihood on those assets. */
export async function afterIntelMatched(orgId: string, assetIds: any[], reason: string) {
  for (const id of assetIds || []) { try { await applyAsset(orgId, String(id), { reason, notify: true, force: true }); } catch (err) { logger.warn({ err }, 'intel re-evaluation failed'); } }
}
