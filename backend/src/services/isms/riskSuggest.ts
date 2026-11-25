import { IsmsRecord } from '../../models/Isms';
import { Asset } from '../../models/Asset';
import { Incident } from '../../models/Governance';
import { OutsourcedReview } from '../../models/Security';
import { PhishCampaign, PhishTarget } from '../../models/Awareness';
import { ReminderLog } from '../../models/Access';
import { createRecord, riskClass } from './records.service';
import { topicAccuracy } from '../awareness.service';
import { ApiError } from '../../utils/ApiError';

const DAY = 86400000;
const norm = (s: unknown) => String(s ?? '').toLowerCase().replace(/[^a-z0-9]+/g, '');
const num = (v: unknown) => { const n = Number(v); return Number.isFinite(n) ? n : 0; };
const clamp = (n: number) => Math.max(1, Math.min(5, Math.round(n)));

export interface RiskSuggestion {
  key: string; source: 'incident' | 'asset' | 'phishing' | 'awareness' | 'supplier' | 'byod' | 'end_of_life';
  summary: string; asset: string; threat: string; vulnerability: string;
  cImpact: number; iImpact: number; aImpact: number; likelihood: number; exposure: number; classification: string;
  existingControl?: string; soa?: string; evidence: string;
}

const CATEGORY_THREAT: Record<string, { threat: string; vuln: string; c: number; i: number; a: number; soa: string }> = {
  malware: { threat: 'Malware infection', vuln: 'Endpoints without sufficient malware protection or user awareness', c: 4, i: 4, a: 4, soa: 'A.8.7' },
  phishing: { threat: 'Phishing / social engineering', vuln: 'Staff can be tricked into disclosing credentials', c: 4, i: 3, a: 3, soa: 'A.6.3, A.8.7' },
  unauthorised_access: { threat: 'Unauthorised access', vuln: 'Weak access control or shared credentials', c: 5, i: 4, a: 3, soa: 'A.5.15, A.8.5' },
  data_loss: { threat: 'Loss or leakage of data', vuln: 'Data handled outside controlled systems', c: 5, i: 3, a: 3, soa: 'A.5.12, A.8.12' },
  lost_device: { threat: 'Lost or stolen device', vuln: 'Devices without full-disk encryption or remote wipe', c: 4, i: 2, a: 3, soa: 'A.7.9, A.8.1' },
  service_outage: { threat: 'Service outage', vuln: 'Single points of failure and weak recovery', c: 2, i: 3, a: 5, soa: 'A.5.30, A.8.14' },
  policy_violation: { threat: 'Policy violation', vuln: 'Policies not understood or not enforced', c: 3, i: 3, a: 2, soa: 'A.5.36' },
  physical: { threat: 'Physical intrusion or damage', vuln: 'Weak physical access control', c: 4, i: 3, a: 4, soa: 'A.7.1–A.7.4' },
  supplier: { threat: 'Supplier failure or compromise', vuln: 'Supplier security not verified', c: 4, i: 3, a: 4, soa: 'A.5.19–A.5.22' },
  other: { threat: 'Security incident of mixed cause', vuln: 'Recurring incidents without a recorded risk', c: 3, i: 3, a: 3, soa: 'A.5.24–A.5.27' },
};
const TOPIC_THREAT: Record<string, string> = { phishing: 'Phishing / social engineering', passwords: 'Credential theft or reuse', data_handling: 'Mishandling of confidential data', physical: 'Physical security lapse', incident_reporting: 'Incidents not reported in time', remote_work: 'Insecure remote working', ai_use: 'Confidential data entered into AI tools', privacy: 'Personal-data (NDPA) breach', access: 'Excessive or stale access', suppliers: 'Unsafe supplier access', finance_fraud: 'Payment fraud', secure_development: 'Insecure code or credentials in repositories', social_engineering: 'Impersonation and social engineering' };

function build(partial: Omit<RiskSuggestion, 'exposure' | 'classification' | 'cImpact' | 'iImpact' | 'aImpact' | 'likelihood'> & { c: number; i: number; a: number; likelihood: number }): RiskSuggestion {
  const { c, i, a, likelihood, ...rest } = partial;
  const impact = Math.max(clamp(c), clamp(i), clamp(a)); const l = clamp(likelihood);
  return { ...rest, cImpact: clamp(c), iImpact: clamp(i), aImpact: clamp(a), likelihood: l, exposure: impact * l, classification: riskClass(impact * l) };
}

/** Every suggestion the app can currently justify from its own data, before filtering out the ones already handled. */
export async function candidates(orgId: string): Promise<RiskSuggestion[]> {
  const out: RiskSuggestion[] = [];
  const f = { organizationId: orgId, isDeleted: { $ne: true } };

  // 1. incidents by category (last 180 days)
  const inc: any[] = await Incident.find({ ...f, detectedAt: { $gte: new Date(Date.now() - 180 * DAY) } }).select('category severity').lean();
  const byCat = new Map<string, { n: number; hi: number }>();
  for (const x of inc) { const c = byCat.get(x.category) || { n: 0, hi: 0 }; c.n++; if (x.severity === 'high' || x.severity === 'critical') c.hi++; byCat.set(x.category, c); }
  for (const [cat, v] of byCat) {
    if (!(v.hi >= 1 || v.n >= 3)) continue;
    const t = CATEGORY_THREAT[cat] || CATEGORY_THREAT.other;
    out.push(build({ key: `incident:${cat}`, source: 'incident', summary: `${t.threat} – ${v.n} incident(s) in the last 6 months${v.hi ? `, ${v.hi} high/critical` : ''}`, asset: 'Information systems and staff', threat: t.threat, vulnerability: t.vuln, c: t.c, i: t.i, a: t.a, likelihood: 2 + Math.min(v.n, 3) , soa: t.soa, evidence: `${v.n} incident(s) of type "${cat}" in the last 180 days, ${v.hi} high/critical.` }));
  }

  // 2. critical assets that no risk mentions
  const risks: any[] = await IsmsRecord.find({ ...f, register: 'risk' }).select('data title').lean();
  const riskText = risks.map((r) => norm(`${r.data?.asset || ''} ${r.title || ''} ${r.data?.riskSummary || ''}`)).join('|');
  const assets: any[] = await Asset.find({ ...f, lifecycleStatus: { $in: ['active', 'under_maintenance'] }, criticality: { $in: ['Critical', 'High'] } }).select('title assetId criticality classification owner confidentiality integrity availability').lean();
  const lvl = (v: string) => (v === 'High' ? 4 : v === 'Medium' ? 3 : 2);
  let nAsset = 0;
  for (const a of assets.sort((x, y) => (y.criticality === 'Critical' ? 1 : 0) - (x.criticality === 'Critical' ? 1 : 0))) {
    if (nAsset >= 8) break;
    const t = norm(a.title); if (t.length < 3 || riskText.includes(t)) continue;
    nAsset++;
    out.push(build({ key: `asset:${a.assetId}`, source: 'asset', summary: `${a.criticality} asset "${a.title}" has no risk assessed`, asset: a.title, threat: 'Compromise, loss or failure of a business-critical asset', vulnerability: a.owner ? 'No documented risk assessment for this asset' : 'No documented risk assessment and no named owner', c: lvl(a.confidentiality), i: lvl(a.integrity), a: lvl(a.availability), likelihood: 2, soa: 'A.5.9, A.5.10', evidence: `${a.assetId} is ${a.criticality}/${a.classification} and appears in no open risk.` }));
  }

  // 3. phishing simulation results
  const camp: any = await PhishCampaign.findOne({ ...f, status: 'ended' }).sort({ endedAt: -1 }).lean();
  if (camp) {
    const t: any[] = await PhishTarget.find({ campaignId: camp._id }).select('clickedAt').lean();
    const rate = t.length >= 5 ? t.filter((x) => x.clickedAt).length / t.length : 0;
    if (rate >= 0.15) out.push(build({ key: `phish:${camp._id}`, source: 'phishing', summary: `Staff susceptible to phishing – ${Math.round(rate * 100)}% clicked in "${camp.name}"`, asset: 'Staff accounts and email', threat: 'Phishing / social engineering', vulnerability: 'Awareness gap shown by a simulation', c: 4, i: 3, a: 3, likelihood: rate >= 0.4 ? 5 : rate >= 0.25 ? 4 : 3, soa: 'A.6.3, A.5.7', evidence: `${t.filter((x) => x.clickedAt).length} of ${t.length} people clicked the simulated email.` }));
  }

  // 4. weak quiz topics
  for (const tp of (await topicAccuracy(orgId, 90)).filter((x) => x.answered >= 8 && x.accuracy < 60).slice(0, 3)) {
    out.push(build({ key: `topic:${tp.topic}`, source: 'awareness', summary: `Knowledge gap in "${tp.topic.replace(/_/g, ' ')}" – only ${tp.accuracy}% correct`, asset: 'Staff', threat: TOPIC_THREAT[tp.topic] || 'Human error', vulnerability: 'Low quiz accuracy on this topic', c: 3, i: 3, a: 2, likelihood: tp.accuracy < 40 ? 4 : 3, soa: 'A.6.3', evidence: `${tp.answered} answers in 90 days, ${tp.accuracy}% correct.` }));
  }

  // 5. supplier reviews overdue
  const sup: any[] = await OutsourcedReview.find({ ...f, status: { $in: ['active', 'under_review'] }, nextReviewAt: { $lt: new Date() } }).select('name').lean();
  if (sup.length) out.push(build({ key: 'supplier:overdue', source: 'supplier', summary: `${sup.length} supplier security review(s) overdue`, asset: 'Outsourced services', threat: 'Supplier compromise or failure', vulnerability: 'Supplier security not re-verified on schedule', c: 4, i: 3, a: 4, likelihood: sup.length >= 3 ? 4 : 3, soa: 'A.5.19–A.5.22', evidence: sup.slice(0, 5).map((s) => s.name).filter(Boolean).join(', ') || 'see Suppliers' }));

  // 6. personal devices that fail the checks
  const bad: any[] = await IsmsRecord.find({ ...f, register: 'byod', status: 'Approved', 'data.checks': 'FAIL' }).select('refNo').lean();
  if (bad.length) out.push(build({ key: 'byod:fail', source: 'byod', summary: `${bad.length} approved personal device(s) fail the security checks`, asset: 'Personal devices (BYOD)', threat: 'Data leakage from an unmanaged device', vulnerability: 'Device missing encryption, lock, antivirus or MFA', c: 4, i: 3, a: 2, likelihood: 3, soa: 'A.6.7, A.8.1', evidence: bad.map((b) => b.refNo).join(', ') }));

  // 7. end-of-life assets still in use
  const eol: any[] = await Asset.find({ ...f, lifecycleStatus: 'active', endOfLifeDate: { $lt: new Date() } }).select('title').lean();
  if (eol.length) out.push(build({ key: 'eol:active', source: 'end_of_life', summary: `${eol.length} asset(s) past end-of-life are still in use`, asset: eol.slice(0, 3).map((e) => e.title).join(', '), threat: 'Exploitation of unpatched, unsupported systems', vulnerability: 'No security updates available', c: 4, i: 4, a: 3, likelihood: 4, soa: 'A.8.8, A.8.19', evidence: eol.slice(0, 8).map((e) => e.title).join(', ') }));
  return out;
}

const dismissKey = (k: string) => `risk-suggest-dismissed:${k}`;

/** Suggestions still waiting for a decision. */
export async function pending(orgId: string): Promise<RiskSuggestion[]> {
  const all = await candidates(orgId);
  if (!all.length) return [];
  const done: any[] = await IsmsRecord.find({ organizationId: orgId, register: 'risk', isDeleted: { $ne: true }, 'sourceRef.type': 'risk-suggest' }).select('sourceRef').lean();
  const accepted = new Set(done.map((d) => d.sourceRef?.id));
  const dismissed = new Set((await ReminderLog.find({ organizationId: orgId, key: { $in: all.map((a) => dismissKey(a.key)) } }).select('key').lean()).map((d: any) => d.key));
  return all.filter((a) => !accepted.has(a.key) && !dismissed.has(dismissKey(a.key))).sort((a, b) => b.exposure - a.exposure);
}

export async function accept(orgId: string, key: string, actor: { id: string; name: string }, owner?: { id?: string; name?: string }) {
  const s = (await pending(orgId)).find((x) => x.key === key);
  if (!s) throw ApiError.notFound('This suggestion is no longer available');
  return createRecord(orgId, 'risk', {
    ownerId: owner?.id, ownerName: owner?.name,
    data: { asset: s.asset, threat: s.threat, vulnerability: s.vulnerability, riskSummary: s.summary, riskNature: 'Internal', cImpact: String(s.cImpact), iImpact: String(s.iImpact), aImpact: String(s.aImpact), likelihood: String(s.likelihood), treatment: 'Reduce Risk', soa: s.soa, frequency: 'Quarterly', lastAssessment: new Date(), notes: `Suggested by the app from live data: ${s.evidence}` },
  }, actor, { source: 'auto', sourceRef: { type: 'risk-suggest', id: key } });
}

export async function dismiss(orgId: string, key: string) {
  try { await ReminderLog.create({ organizationId: orgId, key: dismissKey(key) }); } catch { /* already dismissed */ }
}

/* ------------------------------------------------------------------ heat map */
export async function heatmap(orgId: string, view: 'inherent' | 'residual') {
  const recs: any[] = await IsmsRecord.find({ organizationId: orgId, register: 'risk', isDeleted: { $ne: true }, status: { $ne: 'Closed' } }).select('refNo title status data').lean();
  const cells = new Map<string, { impact: number; likelihood: number; risks: Array<{ id: string; refNo: string; title: string; status: string }> }>();
  let unscored = 0;
  for (const r of recs) {
    const d = r.data || {};
    const impact = view === 'inherent' ? num(d.impact) : num(d.rImpact);
    const likelihood = view === 'inherent' ? num(d.likelihood) : num(d.rLikelihood);
    if (!impact || !likelihood) { unscored++; continue; }
    const k = `${impact}-${likelihood}`; const c = cells.get(k) || { impact, likelihood, risks: [] };
    c.risks.push({ id: String(r._id), refNo: r.refNo, title: r.title, status: r.status }); cells.set(k, c);
  }
  const grid: any[] = [];
  const totals = { Minor: 0, Moderate: 0, Major: 0 };
  for (let impact = 1; impact <= 5; impact++) for (let likelihood = 1; likelihood <= 5; likelihood++) {
    const c = cells.get(`${impact}-${likelihood}`); const score = impact * likelihood; const cls = riskClass(score) as 'Minor' | 'Moderate' | 'Major';
    grid.push({ impact, likelihood, score, class: cls, count: c?.risks.length || 0, risks: c?.risks.slice(0, 12) || [] });
    totals[cls] += c?.risks.length || 0;
  }
  return { view, grid, totals, total: recs.length - unscored, unscored };
}
