import dns from 'dns/promises';
import tls from 'tls';
import { REGISTERS, REGISTER_MAP, FREQ_MONTHS } from '../../config/isms';
import { AutomationRun, AutomationSetting, IsmsRecord } from '../../models/Isms';
import { Organization } from '../../models/Organization';
import { User } from '../../models/User';
import { Task } from '../../models/Task';
import { Asset } from '../../models/Asset';
import { Vendor } from '../../models/Vendor';
import { OutsourcedReview } from '../../models/Security';
import { AccessReview, Incident, Policy, PolicyAcknowledgement } from '../../models/Governance';
import { ReminderLog } from '../../models/Access';
import { notify } from '../notify.service';
import { usersWithModule } from '../access.service';
import { logger } from '../../utils/logger';
import { compute, createRecord, toDate } from './records.service';
import { buildPack } from './pack.service';
import * as riskSuggest from './riskSuggest';
import * as soa from './soa.service';
import { Visit, SlotLock } from '../../models/Visitor';
import * as visitors from '../visitor.service';
import { sendMail } from '../email.service';
import { SupplierAssessment } from '../../models/Supplier';
import { SignatureRequest } from '../../models/Signature';
import { Evidence, EvidenceRequest } from '../../models/Evidence';
import * as evidence from '../evidence.service';
import { ActivityLog } from '../../models/ActivityLog';
import * as assetRisk from '../assetRisk.service';
import * as awareness from '../awareness.service';
import { PhishCampaign } from '../../models/Awareness';

const DAY = 86400000;
const norm = (s: unknown) => String(s ?? '').toLowerCase().replace(/[^a-z0-9]+/g, '');
const ymd = (d = new Date()) => d.toISOString().slice(0, 10);
const isoWeek = (d = new Date()) => { const t = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate())); t.setUTCDate(t.getUTCDate() + 4 - (t.getUTCDay() || 7)); const y0 = new Date(Date.UTC(t.getUTCFullYear(), 0, 1)); return `${t.getUTCFullYear()}-W${Math.ceil(((+t - +y0) / DAY + 1) / 7)}`; };
const daysUntil = (d: Date) => Math.ceil((d.getTime() - Date.now()) / DAY);
const SYSTEM = { name: 'ISMS automation' };

export interface RuleResult { checked: number; actions: number; details: string[] }
export interface RuleDef {
  key: string; title: string; policy: string; clause: string; schedule: string; cron: string; description: string;
  /** manual runs are allowed even when the rule is switched off */
  run: (orgId: string) => Promise<RuleResult>;
}

/* ------------------------------------------------------------- recipients */
async function managers(orgId: string): Promise<string[]> {
  const list = await usersWithModule(orgId, 'isms');
  return list.map((u: any) => String(u._id));
}
async function leadership(orgId: string): Promise<string[]> {
  return (await User.find({ organizationId: orgId, isActive: true, role: { $in: ['ceo', 'coo'] } }).select('_id').lean()).map((u: any) => String(u._id));
}
/** Owner of a record: the linked user, else a user whose name matches the "responsible" text, else the ISMS managers. */
async function recipients(orgId: string, rec: any, mgrs: string[], people: Array<{ _id: any; name: string }>): Promise<string[]> {
  if (rec.ownerId) return [String(rec.ownerId)];
  const names = [rec.ownerName, rec.data?.responsible, rec.data?.assignedTo, rec.data?.owner, rec.data?.auditor].filter(Boolean).map(norm);
  const hit = people.find((p) => names.includes(norm(p.name)));
  return hit ? [String(hit._id)] : mgrs;
}
const people = async (orgId: string) => (await User.find({ organizationId: orgId, isActive: true }).select('name').lean()) as Array<{ _id: any; name: string }>;
const send = (orgId: string, userIds: string[], key: string, title: string, body: string, link: string, severity: 'info' | 'warning' | 'high' | 'critical' = 'warning') =>
  userIds.length ? notify({ organizationId: orgId, userIds: Array.from(new Set(userIds)), title, body, link, type: 'reminder', severity, dedupeKey: key, email: { intro: body } }) : Promise.resolve(0);

/* ----------------------------------------------------------------- rule 1 */
const WINDOWS: Record<string, number[]> = { legal: [90, 60, 30, 14, 7, 1], byod: [30, 14, 7, 1], risk: [30, 14, 7, 1], context: [30, 14, 7], metric: [14, 7, 1] };
/** true the first time a key is seen – lets a daily job say "new since yesterday" without a state table */
async function once(orgId: string, key: string): Promise<boolean> {
  try { await ReminderLog.create({ organizationId: orgId, key }); return true; } catch { return false; }
}
interface Group { to: string[]; due: string[]; late: string[]; escalate: string[] }
const lines = (a: string[]) => a.slice(0, 8).join('\n') + (a.length > 8 ? `\n… and ${a.length - 8} more` : '');

async function registerDue(orgId: string): Promise<RuleResult> {
  const r: RuleResult = { checked: 0, actions: 0, details: [] };
  const [mgrs, lead, ppl] = [await managers(orgId), await leadership(orgId), await people(orgId)];
  for (const def of REGISTERS.filter((d) => d.dueKey)) {
    const recs: any[] = await IsmsRecord.find({ organizationId: orgId, register: def.key, isDeleted: { $ne: true }, status: { $nin: def.closedStatuses }, dueDate: { $exists: true, $ne: null } });
    const groups = new Map<string, Group>(); const esc: string[] = [];
    for (const rec of recs) {
      r.checked++;
      const left = daysUntil(new Date(rec.dueDate)); const to = await recipients(orgId, rec, mgrs, ppl);
      const g = groups.get(to.slice().sort().join(',')) || { to, due: [], late: [], escalate: [] }; groups.set(to.slice().sort().join(','), g);
      const label = `• ${rec.refNo} ${rec.title}`.slice(0, 120);
      if (left < 0) {
        if (def.statuses.includes('Overdue') && ['Open', 'In progress', 'Planned'].includes(rec.status)) {
          rec.history.push({ at: new Date(), byName: SYSTEM.name, action: `status: ${rec.status} → Overdue`, note: `Due ${ymd(rec.dueDate)}` });
          rec.status = 'Overdue'; await rec.save(); r.actions++;
        }
        if (await once(orgId, `isms-late:${rec._id}:${isoWeek()}`)) g.late.push(`${label} (${-left}d late)`);
        if (-left > 14 && await once(orgId, `isms-esc:${rec._id}:${isoWeek()}`)) esc.push(`${label} (${-left}d late, owner ${rec.ownerName || rec.data?.responsible || 'not set'})`);
      } else {
        const step = (WINDOWS[def.key] || [14, 7, 1]).slice().sort((a, b) => a - b).find((w) => left <= w);
        if (step !== undefined && await once(orgId, `isms-due:${rec._id}:${step}`)) g.due.push(`${label} (due ${ymd(rec.dueDate)})`);
      }
    }
    const link = `/isms?register=${def.key}`;
    for (const [k, g] of groups) {
      if (g.late.length && await send(orgId, g.to, `isms-dg-late:${def.key}:${k}:${ymd()}`, `${g.late.length} overdue in ${def.title}`, lines(g.late), link, 'high')) r.actions++;
      if (g.due.length && await send(orgId, g.to, `isms-dg-due:${def.key}:${k}:${ymd()}`, `${g.due.length} due soon in ${def.title}`, lines(g.due), link, 'warning')) r.actions++;
    }
    if (esc.length && lead.length && await send(orgId, lead, `isms-dg-esc:${def.key}:${ymd()}`, `Escalation: ${esc.length} item(s) in ${def.title} are over two weeks late`, lines(esc), link, 'critical')) { r.actions++; r.details.push(`escalated ${esc.length} in ${def.key}`); }
  }
  r.details.push(`${r.checked} open items with a due date checked`);
  return r;
}

/* ----------------------------------------------------------------- rule 2 */
async function recurringReschedule(orgId: string): Promise<RuleResult> {
  const r: RuleResult = { checked: 0, actions: 0, details: [] };
  for (const [key, dateKey] of [['comms', 'date'], ['training', 'plannedDate']] as const) {
    const def = REGISTER_MAP[key];
    const done: any[] = await IsmsRecord.find({ organizationId: orgId, register: key, isDeleted: { $ne: true }, status: 'Done' });
    for (const rec of done) {
      r.checked++;
      const months = FREQ_MONTHS[norm(rec.data?.frequency)];
      if (!months || rec.data?.nextCreated || !rec.data?.[dateKey]) continue;
      const next = new Date(rec.data[dateKey]); next.setMonth(next.getMonth() + months);
      const copy = { ...rec.data, [dateKey]: next }; delete copy.nextCreated; delete copy.attendance;
      await createRecord(orgId, key, { data: copy, ownerId: rec.ownerId, ownerName: rec.ownerName }, SYSTEM, { source: 'auto', sourceRef: { type: `${key}-recur`, id: String(rec._id) }, strict: false });
      rec.data = { ...rec.data, nextCreated: true }; rec.markModified('data'); await rec.save();
      r.actions++; r.details.push(`${rec.refNo} → next on ${ymd(next)}`);
    }
    void def;
  }
  return r;
}

/* ----------------------------------------------------------------- rule 3 */
export async function measure(orgId: string, source: string): Promise<number | null> {
  const yearAgo = new Date(Date.now() - 365 * DAY); const ratio = (a: number, b: number) => (b ? Math.round((a / b) * 100) / 100 : null);
  switch (source) {
    case 'policy_acknowledgement': {
      const pols: any[] = await Policy.find({ organizationId: orgId, isDeleted: { $ne: true }, status: 'approved', requiresAcknowledgement: true }).select('version').lean();
      const staff = await User.countDocuments({ organizationId: orgId, isActive: true, role: { $nin: ['client', 'vendor', 'training_customer'] } });
      if (!pols.length || !staff) return null;
      let got = 0; for (const p of pols) got += await PolicyAcknowledgement.countDocuments({ policyId: p._id, version: p.version });
      return ratio(Math.min(got, pols.length * staff), pols.length * staff);
    }
    case 'access_reviews_on_time': {
      const rs: any[] = await AccessReview.find({ organizationId: orgId, isDeleted: { $ne: true }, status: 'completed', completedAt: { $gte: yearAgo } }).lean();
      return rs.length ? ratio(rs.filter((x) => !x.dueDate || new Date(x.completedAt) <= new Date(x.dueDate)).length, rs.length) : 0;
    }
    case 'incidents_closed_in_target': {
      const list: any[] = await Incident.find({ organizationId: orgId, isDeleted: { $ne: true }, status: 'closed', detectedAt: { $gte: yearAgo } }).lean();
      return list.length ? ratio(list.filter((i) => i.resolvedAt && +new Date(i.resolvedAt) - +new Date(i.detectedAt) <= 30 * DAY).length, list.length) : 1;
    }
    case 'cars_closed_on_time': {
      const list: any[] = await IsmsRecord.find({ organizationId: orgId, register: 'car', isDeleted: { $ne: true }, status: 'Closed' }).lean();
      return list.length ? ratio(list.filter((c) => !c.dueDate || (c.closedAt && c.closedAt <= c.dueDate)).length, list.length) : 1;
    }
    case 'training_completed': {
      const y = new Date(new Date().getFullYear(), 0, 1); const list: any[] = await IsmsRecord.find({ organizationId: orgId, register: 'training', isDeleted: { $ne: true }, status: { $ne: 'Cancelled' }, dueDate: { $gte: y, $lte: new Date() } }).lean();
      return list.length ? ratio(list.filter((t) => t.status === 'Done').length, list.length) : null;
    }
    case 'assets_with_owner': {
      const list: any[] = await Asset.find({ organizationId: orgId, isDeleted: { $ne: true }, lifecycleStatus: { $in: ['active', 'under_maintenance', 'planned'] } }).select('owner ownerUser').lean();
      return list.length ? ratio(list.filter((a) => a.owner || a.ownerUser).length, list.length) : null;
    }
    case 'risks_reviewed_on_time': {
      const list: any[] = await IsmsRecord.find({ organizationId: orgId, register: 'risk', isDeleted: { $ne: true }, status: { $ne: 'Closed' } }).lean();
      return list.length ? ratio(list.filter((x) => x.dueDate && x.dueDate >= new Date()).length, list.length) : null;
    }
    case 'byod_compliant': {
      const list: any[] = await IsmsRecord.find({ organizationId: orgId, register: 'byod', isDeleted: { $ne: true }, status: 'Approved' }).lean();
      return list.length ? ratio(list.filter((x) => x.data?.checks === 'PASS' && (!x.dueDate || x.dueDate >= new Date())).length, list.length) : null;
    }
    case 'mfa_enabled': {
      const list: any[] = await User.find({ organizationId: orgId, isActive: true, role: { $nin: ['client', 'vendor', 'training_customer'] } }).select('mfaEnabled').lean();
      return list.length ? ratio(list.filter((u) => u.mfaEnabled).length, list.length) : null;
    }
    case 'supplier_reviews_current': {
      const list: any[] = await OutsourcedReview.find({ organizationId: orgId, isDeleted: { $ne: true }, status: { $in: ['active', 'under_review'] } }).lean();
      return list.length ? ratio(list.filter((x) => x.nextReviewAt && new Date(x.nextReviewAt) >= new Date()).length, list.length) : 1;
    }
    case 'phish_resilience': return awareness.phishResilience(orgId);
    case 'phish_report_rate': return awareness.phishReportRate(orgId);
    case 'awareness_quiz_accuracy': return awareness.quizAccuracy(orgId);
    case 'awareness_participation': return awareness.participation(orgId);
    default: return null;
  }
}

async function metricsAuto(orgId: string): Promise<RuleResult> {
  const r: RuleResult = { checked: 0, actions: 0, details: [] };
  const metrics: any[] = await IsmsRecord.find({ organizationId: orgId, register: 'metric', isDeleted: { $ne: true }, status: 'Active', 'data.autoSource': { $exists: true, $ne: '' } });
  for (const m of metrics) {
    r.checked++;
    const value = await measure(orgId, m.data.autoSource);
    if (value === null) { r.details.push(`${m.refNo}: no data yet for ${m.data.autoSource}`); continue; }
    m.data = compute(REGISTER_MAP.metric, { ...m.data, actual: value, lastMeasured: new Date() }); m.markModified('data');
    m.dueDate = toDate(m.data.nextMeasurement);
    m.history.push({ at: new Date(), byName: SYSTEM.name, action: 'measured', note: `${m.data.autoSource} = ${value} (target ${m.data.target ?? '–'})` });
    await m.save(); r.actions++;
    if (m.data.targetMet === 'No') {
      const exists = await IsmsRecord.findOne({ organizationId: orgId, register: 'ofi', 'sourceRef.type': 'metric-miss', 'sourceRef.id': `${m._id}:${new Date().getFullYear()}`, isDeleted: { $ne: true } });
      if (!exists) {
        const ofi = await createRecord(orgId, 'ofi', { data: { source: `Metric ${m.refNo}`, standard: 'ISO/IEC 27001:2022', clause: '9.1', finding: `Metric "${m.title}" missed its target: actual ${value}, target ${m.data.target}.`, improvementAction: 'Find out why the target was missed and agree an improvement action.', responsible: m.data.responsible || '' }, ownerId: m.ownerId }, SYSTEM, { source: 'auto', sourceRef: { type: 'metric-miss', id: `${m._id}:${new Date().getFullYear()}` }, strict: false });
        r.actions++; r.details.push(`${m.refNo} missed target → ${ofi.refNo}`);
        await send(orgId, await managers(orgId), `isms-metric-miss:${m._id}:${new Date().getFullYear()}`, 'ISMS metric below target', `"${m.title}": ${value} against a target of ${m.data.target}. ${ofi.refNo} was opened.`, '/isms?register=ofi');
      }
    }
  }
  return r;
}

/* ----------------------------------------------------------------- rule 4 */
const PROGRAMME = [
  { q: 'Q1', month: 2, scope: 'Clauses 4–6: context, leadership, planning (risk assessment, objectives, change)' },
  { q: 'Q2', month: 5, scope: 'Clause 7–8: support and operation + Annex A.5 organisational and A.6 people controls' },
  { q: 'Q3', month: 8, scope: 'Annex A.7 physical and A.8 technological controls + clause 9 performance evaluation' },
  { q: 'Q4', month: 10, scope: 'Clause 10: follow-up of all open CARs, management review preparation' },
];
async function auditProgramme(orgId: string): Promise<RuleResult> {
  const r: RuleResult = { checked: 0, actions: 0, details: [] }; const year = new Date().getFullYear();
  let slot = new Date(Date.now() + 21 * DAY); // quarters already past are scheduled as catch-up audits, 3 weeks apart
  for (const p of PROGRAMME) {
    r.checked++;
    const id = `${year}-${p.q}`;
    if (await IsmsRecord.findOne({ organizationId: orgId, register: 'audit_plan', 'sourceRef.type': 'audit-programme', 'sourceRef.id': id, isDeleted: { $ne: true } })) continue;
    let date = new Date(Date.UTC(year, p.month, 15)); let catchUp = false;
    if (+date < Date.now() + 14 * DAY) { date = new Date(slot); slot = new Date(+slot + 21 * DAY); catchUp = true; }
    await createRecord(orgId, 'audit_plan', { data: { scope: `${year} ${p.q} – ${p.scope}${catchUp ? ' (catch-up: programme created after the planned quarter)' : ''}`, criteria: 'ISO/IEC 27001:2022, Global SJX ISMS policies and procedures', plannedDate: date, auditee: 'All departments in scope' } }, SYSTEM, { source: 'auto', sourceRef: { type: 'audit-programme', id }, strict: false });
    r.actions++; r.details.push(`planned ${id} for ${ymd(date)}`);
  }
  if (r.actions) await send(orgId, await managers(orgId), `isms-audit-programme:${year}`, `${year} internal audit programme created`, `${r.actions} audit(s) were added to the programme. Name an auditor who is independent of the area audited for each one.`, '/isms?register=audit_plan', 'info');
  return r;
}

/* ----------------------------------------------------------------- rule 5 */
async function mgmtReviewPrompt(orgId: string): Promise<RuleResult> {
  const last: any = await IsmsRecord.findOne({ organizationId: orgId, register: 'mgmt_action', isDeleted: { $ne: true } }).sort({ createdAt: -1 }).lean();
  const half = `${new Date().getFullYear()}-H${new Date().getMonth() < 6 ? 1 : 2}`;
  const age = last ? Math.floor((Date.now() - +new Date(last.createdAt)) / DAY) : 9999;
  const r: RuleResult = { checked: 1, actions: 0, details: [last ? `last management-review action recorded ${age} day(s) ago` : 'no management review recorded yet'] };
  if (age <= 180) return r;
  const exists = await IsmsRecord.findOne({ organizationId: orgId, register: 'mgmt_action', 'sourceRef.type': 'mgmt-review-due', 'sourceRef.id': half, isDeleted: { $ne: true } });
  if (exists) return r;
  const due = new Date(Date.now() + 21 * DAY);
  await createRecord(orgId, 'mgmt_action', { data: { review: `Management review ${half}`, input: 'Other', action: 'Hold the management review: use the Management review inputs on the ISMS hub (audit results, CARs, metrics, risks, incidents, changes) and record decisions here.', dueDate: due } }, SYSTEM, { source: 'auto', sourceRef: { type: 'mgmt-review-due', id: half }, strict: false });
  await send(orgId, [...(await managers(orgId)), ...(await leadership(orgId))], `isms-mgmt-review:${half}`, 'Management review is due', 'No management review has been recorded in the last six months (clause 9.3). A review action was created.', '/isms?tab=review', 'high');
  r.actions = 1; return r;
}

/* ----------------------------------------------------------------- rule 6 */
async function incidentToCar(orgId: string): Promise<RuleResult> {
  const r: RuleResult = { checked: 0, actions: 0, details: [] };
  const list: any[] = await Incident.find({ organizationId: orgId, isDeleted: { $ne: true }, severity: { $in: ['high', 'critical'] }, status: { $in: ['recovered', 'closed'] } }).lean();
  const ppl = await people(orgId);
  for (const i of list) {
    r.checked++;
    if (await IsmsRecord.findOne({ organizationId: orgId, register: 'car', 'sourceRef.type': 'incident', 'sourceRef.id': String(i._id), isDeleted: { $ne: true } })) continue;
    const owner = i.assigneeId ? ppl.find((p) => String(p._id) === String(i.assigneeId)) : undefined;
    const car = await createRecord(orgId, 'car', { ownerId: i.assigneeId, ownerName: owner?.name, data: { source: `Incident ${i.reference}`, standard: 'ISO/IEC 27001:2022', classification: i.severity === 'critical' ? 'Major' : 'Minor', clause: '10.2', requirementStd: 'Nonconformity and corrective action – react, correct, determine cause, prevent recurrence.', nonConformity: `${i.title}: ${String(i.description || '').replace(/<[^>]+>/g, ' ').slice(0, 500)}`, rootCause: i.rootCause || '', correction: '', correctiveAction: (i.actions || []).map((a: any) => a.text).join('; '), responsible: owner?.name || '', implementationDate: new Date(Date.now() + 30 * DAY) } }, SYSTEM, { source: 'auto', sourceRef: { type: 'incident', id: String(i._id) }, strict: false });
    r.actions++; r.details.push(`${i.reference} → ${car.refNo}`);
    await send(orgId, owner ? [String(owner._id)] : await managers(orgId), `isms-car-incident:${i._id}`, `Corrective action opened for ${i.reference}`, `${car.refNo} was opened for the ${i.severity} incident "${i.title}". Record the root cause and corrective action.`, '/isms?register=car');
  }
  return r;
}

/* ----------------------------------------------------------------- rule 7 */
async function byodLeavers(orgId: string): Promise<RuleResult> {
  const r: RuleResult = { checked: 0, actions: 0, details: [] };
  const inactive = (await User.find({ organizationId: orgId, isActive: false }).select('name').lean()).map((u: any) => norm(u.name));
  const devices: any[] = await IsmsRecord.find({ organizationId: orgId, register: 'byod', isDeleted: { $ne: true }, status: { $in: ['Approved', 'Pending'] } });
  for (const d of devices) {
    r.checked++;
    if (!inactive.includes(norm(d.data?.owner))) continue;
    d.history.push({ at: new Date(), byName: SYSTEM.name, action: `status: ${d.status} → Suspended`, note: 'Owner is no longer an active user' }); d.status = 'Suspended'; await d.save(); r.actions++; r.details.push(`${d.refNo} suspended`);
    await send(orgId, await managers(orgId), `isms-byod-leaver:${d._id}`, 'BYOD device of a leaver suspended', `${d.refNo} (${d.data?.owner}) was suspended. Confirm company data is removed, then mark the device Removed.`, '/isms?register=byod', 'high');
  }
  return r;
}

/* ----------------------------------------------------------------- rule 8 */
async function supplierCycle(orgId: string): Promise<RuleResult> {
  const vendors: any[] = await Vendor.find({ organizationId: orgId, isDeleted: { $ne: true }, status: 'active' }).select('name').lean();
  const reviews: any[] = await OutsourcedReview.find({ organizationId: orgId, isDeleted: { $ne: true } }).lean();
  const year = new Date(Date.now() - 365 * DAY);
  const stale = vendors.filter((v) => { const x = reviews.find((q) => String(q.vendorId) === String(v._id)); return !x || !x.lastReviewAt || new Date(x.lastReviewAt) < year; });
  const r: RuleResult = { checked: vendors.length, actions: 0, details: stale.slice(0, 15).map((v) => `${v.name}: no security review in the last 12 months`) };
  if (stale.length && await send(orgId, await managers(orgId), `isms-supplier-cycle:${isoWeek()}`, `${stale.length} supplier(s) need an annual security review`, `Suppliers without a review in 12 months: ${stale.slice(0, 8).map((v) => v.name).join(', ')}${stale.length > 8 ? '…' : ''}.`, '/security')) r.actions = 1;
  return r;
}

/* ----------------------------------------------------------------- rule 9 */
const ONBOARD_SELF = [
  'Read and acknowledge the ISMS policies assigned to you (Policies page)',
  'Switch on multi-factor authentication in Settings → Security',
  'Complete the ISMS awareness induction and confirm in the training record',
  'Confirm you have signed the NDA and the Acceptable Use acknowledgement',
];
async function onboardingTasks(orgId: string): Promise<RuleResult> {
  const r: RuleResult = { checked: 0, actions: 0, details: [] };
  const since = new Date(Date.now() - 14 * DAY);
  const fresh: any[] = await User.find({ organizationId: orgId, isActive: true, createdAt: { $gte: since }, role: { $nin: ['client', 'vendor', 'training_customer'] } }).select('name department').lean();
  const hr = (await usersWithModule(orgId, 'employees'))[0];
  for (const u of fresh) {
    r.checked++;
    const tag = `onboarding:${u._id}`;
    if (await Task.findOne({ organizationId: orgId, tags: tag })) continue;
    const due = new Date(Date.now() + 7 * DAY);
    for (const t of ONBOARD_SELF) await Task.create({ organizationId: orgId, title: `Onboarding: ${t}`, ownerId: u._id, priority: 'high', status: 'open', dueDate: due, tags: ['auto-generated', 'onboarding', tag] });
    if (hr) for (const t of [`Verify identity, references and signed NDA for ${u.name}`, `Issue and record assets for ${u.name} (Asset Inventory), and record any BYOD device`, `Confirm access rights for ${u.name} match the role (least privilege)`]) await Task.create({ organizationId: orgId, title: `Onboarding: ${t}`, ownerId: hr._id, priority: 'high', status: 'open', dueDate: due, tags: ['auto-generated', 'onboarding', tag] });
    r.actions += ONBOARD_SELF.length + (hr ? 3 : 0); r.details.push(`checklist created for ${u.name}`);
    await send(orgId, [String(u._id)], `isms-onboard:${u._id}`, 'Welcome – your onboarding checklist', 'Four short tasks help you meet our information-security requirements. They are in My Work.', '/my-work', 'info');
  }
  return r;
}

/* ---------------------------------------------------------------- rule 10 */
export interface DomainFacts { domain: string; certDaysLeft?: number; spf?: boolean; dmarc?: boolean; error?: string }
export async function checkDomain(domain: string): Promise<DomainFacts> {
  const out: DomainFacts = { domain };
  try {
    out.certDaysLeft = await new Promise<number>((resolve, reject) => {
      const s = tls.connect({ host: domain, port: 443, servername: domain, timeout: 6000 }, () => { const c = s.getPeerCertificate(); s.end(); c?.valid_to ? resolve(Math.floor((+new Date(c.valid_to) - Date.now()) / DAY)) : reject(new Error('no certificate')); });
      s.on('error', reject); s.on('timeout', () => { s.destroy(); reject(new Error('timeout')); });
    });
  } catch (e: any) { out.error = `TLS: ${e.message}`; }
  try { out.spf = (await dns.resolveTxt(domain)).some((t) => t.join('').toLowerCase().startsWith('v=spf1')); } catch { out.spf = false; }
  try { out.dmarc = (await dns.resolveTxt(`_dmarc.${domain}`)).some((t) => t.join('').toLowerCase().startsWith('v=dmarc1')); } catch { out.dmarc = false; }
  return out;
}
async function domainHealth(orgId: string): Promise<RuleResult> {
  const domains = (process.env.ISMS_DOMAINS || '').split(',').map((s) => s.trim()).filter(Boolean);
  const r: RuleResult = { checked: domains.length, actions: 0, details: [] };
  if (!domains.length) { r.details.push('ISMS_DOMAINS is not set – add your domains (comma-separated) to .env to turn this check on'); return r; }
  const mgrs = await managers(orgId);
  for (const d of domains) {
    const f = await checkDomain(d); const issues: string[] = [];
    if (f.error) issues.push(f.error); else if ((f.certDaysLeft ?? 99) < 21) issues.push(`TLS certificate expires in ${f.certDaysLeft} day(s)`);
    if (!f.spf) issues.push('no SPF record'); if (!f.dmarc) issues.push('no DMARC record');
    r.details.push(`${d}: ${issues.length ? issues.join('; ') : `ok (certificate ${f.certDaysLeft} days left, SPF and DMARC present)`}`);
    if (issues.length && await send(orgId, mgrs, `isms-domain:${d}:${isoWeek()}`, `Domain check: ${d}`, `${d}: ${issues.join('; ')}.`, '/isms?tab=automation', 'high')) r.actions++;
  }
  return r;
}

/* ---------------------------------------------------------------- rule 11 */
async function evidencePack(orgId: string): Promise<RuleResult> {
  const snap = await buildPack(orgId, { trigger: 'schedule', byName: SYSTEM.name });
  await send(orgId, await managers(orgId), `isms-pack:${orgId}:${ymd().slice(0, 7)}`, 'Monthly ISMS evidence pack ready', `All ${snap.registers.length} registers were exported and fingerprinted (SHA-256 ${String(snap.sha256).slice(0, 12)}…). Download it from the ISMS hub.`, '/isms?tab=packs', 'info');
  return { checked: snap.registers.length, actions: 1, details: [`${snap.fileName} (${Math.round((snap.size || 0) / 1024)} KB)`] };
}


/* ---------------------------------------------------------------- rule 12 */
async function riskSuggestRule(orgId: string): Promise<RuleResult> {
  const list = await riskSuggest.pending(orgId);
  const r: RuleResult = { checked: list.length, actions: 0, details: list.slice(0, 15).map((s) => `${s.classification}: ${s.summary}`) };
  const fresh: typeof list = [];
  for (const s of list) if (await once(orgId, `risk-suggest-seen:${s.key}`)) fresh.push(s);
  if (fresh.length && await send(orgId, await managers(orgId), `risk-suggest:${orgId}:${ymd()}`, `${fresh.length} new risk(s) suggested from live data`, lines(fresh.map((s) => `• [${s.classification}] ${s.summary}`)), '/isms?register=risk', fresh.some((s) => s.classification === 'Major') ? 'high' : 'warning')) r.actions++;
  return r;
}

/* ---------------------------------------------------------------- rule 13 */
async function awarenessDigest(orgId: string): Promise<RuleResult> {
  const [topics, part, acc] = await Promise.all([awareness.topicAccuracy(orgId, 30), awareness.participation(orgId), awareness.quizAccuracy(orgId)]);
  const board = await awareness.leaderboard(orgId, '000000000000000000000000', 'month');
  const r: RuleResult = { checked: board.staff, actions: 0, details: [`participation ${part === null ? 'n/a' : Math.round(part * 100) + '%'}, accuracy ${acc === null ? 'n/a' : Math.round(acc * 100) + '%'}`] };
  const weak = topics.filter((t) => t.answered >= 5 && t.accuracy < 65).slice(0, 3);
  const body = [`Participation (30 days): ${part === null ? 'no data' : Math.round(part * 100) + '%'}`, `Quiz accuracy (90 days): ${acc === null ? 'no data' : Math.round(acc * 100) + '%'}`, weak.length ? `Weakest topics: ${weak.map((t) => `${t.topic.replace(/_/g, ' ')} ${t.accuracy}%`).join(', ')}` : 'No weak topics this month', board.departments[0] ? `Top department (average points): ${board.departments[0].name}` : ''].filter(Boolean).join('\n');
  if (await send(orgId, await managers(orgId), `awareness-digest:${isoWeek()}`, 'Security awareness: weekly summary', body, '/awareness?tab=admin', 'info')) r.actions++;
  // keep people on track: those who answered nothing this month are nudged once a month, politely
  if (part !== null && part < 0.5 && await once(orgId, `awareness-nudge:${ymd().slice(0, 7)}`)) {
    const staff: any[] = await User.find({ organizationId: orgId, isActive: true, role: { $nin: ['client', 'vendor', 'training_customer'] } }).select('_id').lean();
    if (await send(orgId, staff.map((u) => String(u._id)), `awareness-nudge-all:${ymd().slice(0, 7)}`, 'A two-minute security quiz is waiting', 'Answer a few short questions in Security Awareness and climb the leaderboard.', '/awareness', 'info')) r.actions++;
  }
  return r;
}

/* ---------------------------------------------------------------- rule 14 */
async function phishClose(orgId: string): Promise<RuleResult> {
  const running: any[] = await PhishCampaign.find({ organizationId: orgId, status: 'running', isDeleted: { $ne: true }, launchedAt: { $lte: new Date(Date.now() - 7 * DAY) } });
  const r: RuleResult = { checked: running.length, actions: 0, details: [] };
  for (const c of running) {
    await awareness.endCampaign(c); r.actions++; r.details.push(`"${c.name}" ended after 7 days`);
    const res = await awareness.campaignResults(orgId, String(c._id));
    await send(orgId, await managers(orgId), `phish-ended:${c._id}`, `Phishing simulation finished: ${c.name}`, `${res.totals.clicked} of ${res.totals.targets} clicked (${res.totals.clickRate}%); ${res.totals.reported} reported (${res.totals.reportRate}%).`, '/awareness?tab=admin', res.totals.clickRate >= 25 ? 'high' : 'info');
  }
  return r;
}

/* ---------------------------------------------------------------- rule 15 */
async function assetRiskSweep(orgId: string): Promise<RuleResult> {
  const r = await assetRisk.evaluateAll(orgId, { reason: 'weekly asset risk sweep' });
  const sent = await assetRisk.notifyBulk(orgId, r, 'Weekly asset risk sweep', `sweep:${isoWeek()}`);
  return { checked: r.assets, actions: r.created + r.rescored + r.closed + sent, details: [`${r.evaluated} changed asset(s) evaluated, ${r.unchanged} unchanged`, `${r.created} risk(s) created, ${r.rescored} re-scored, ${r.flagged} for human review, ${r.closed} closed`] };
}

/* -------------------------------------------------------- Statement of Applicability sync */
async function soaSync(orgId: string): Promise<RuleResult> {
  const seeded = await soa.ensureAnnexA(orgId);
  const s = await soa.soaSummary(orgId);
  let actions = seeded.created;
  const problems = s.fail + s.testsOverdue + s.unjustified;
  if (problems) {
    const mine = await managers(orgId);
    actions += await send(orgId, mine, `soa-weekly:${isoWeek()}`, `Annex A: ${s.fail} failed, ${s.testsOverdue} tests overdue`, `Statement of Applicability status: ${s.implemented}/${s.applicable} applicable controls implemented, ${s.pass} passed their last test, ${s.fail} failed, ${s.untested} never tested, ${s.testsOverdue} tests overdue${s.unjustified ? `, ${s.unjustified} exclusions without a justification` : ''}.`, '/isms?register=annex_a', s.fail ? 'high' : 'warning');
  }
  return { checked: s.total, actions, details: [`${seeded.created} control(s) added to reach ${seeded.total}`, `${s.implemented} implemented, ${s.pass} pass, ${s.partial} partial, ${s.fail} fail, ${s.untested} untested, ${s.testsOverdue} overdue`] };
}

/* --------------------------------------------------- continuity, capacity, logs, maintenance */
async function opsCycle(orgId: string): Promise<RuleResult> {
  const r: RuleResult = { checked: 0, actions: 0, details: [] };
  const mgrs = await managers(orgId);
  const week = isoWeek(); const now = new Date();

  // 1. weekly log review, pre-filled from the app's own audit trail
  const period = `Week ${week}`;
  const hasLog = await IsmsRecord.findOne({ organizationId: orgId, register: 'log_review', title: period, isDeleted: { $ne: true } });
  if (!hasLog) {
    const since = new Date(Date.now() - 7 * 86400000);
    const rows: any[] = await ActivityLog.find({ organizationId: orgId, createdAt: { $gte: since } }).select('action severity status').lean();
    const count = (f: (x: any) => boolean) => rows.filter(f).length;
    const summary = [`${rows.length} audit events in the last 7 days.`, `${count((x) => x.status === 'failed')} failed actions, ${count((x) => /login.*fail|auth.*fail|locked/i.test(x.action || ''))} failed or locked sign-ins.`,
      `${count((x) => ['high', 'critical'].includes(x.severity))} high or critical events, ${count((x) => /role|permission|access|mfa/i.test(x.action || ''))} access or permission changes.`, `${count((x) => /deleted|disposal/i.test(x.action || ''))} deletions or disposals.`].join('\n');
    const due = new Date(); due.setDate(due.getDate() + 4);
    await createRecord(orgId, 'log_review', { data: { period, dueOn: due, summary }, ownerId: mgrs[0] }, SYSTEM, { source: 'auto', sourceRef: { type: 'log-review', id: week } });
    r.actions++; r.details.push(`log review ${period} created and pre-filled`);
  }

  // 2. planned maintenance repeats itself
  const done: any[] = await IsmsRecord.find({ organizationId: orgId, register: 'maintenance', status: 'Done', isDeleted: { $ne: true } });
  for (const m of done) {
    r.checked++;
    const months = Number(m.data?.every); if (!months || m.data?.nextCreated) continue;
    const base = m.data?.lastDone ? new Date(m.data.lastDone) : m.closedAt || now; const next = new Date(base); next.setUTCMonth(next.getUTCMonth() + months);
    await createRecord(orgId, 'maintenance', { data: { ...m.data, nextCreated: undefined, lastDone: base, nextDue: next, findings: '' }, ownerId: m.ownerId ? String(m.ownerId) : undefined, ownerName: m.ownerName }, SYSTEM, { source: 'auto', sourceRef: { type: 'maintenance', id: String(m._id) } });
    m.data = { ...m.data, nextCreated: true }; m.markModified('data'); await m.save(); r.actions++;
  }

  // 3. capacity above threshold needs an action
  const caps: any[] = await IsmsRecord.find({ organizationId: orgId, register: 'capacity', status: { $in: ['OK', 'Watch'] }, isDeleted: { $ne: true } });
  const breach: string[] = [];
  for (const c of caps) {
    r.checked++;
    if (c.data?.state === 'Breach') { c.history.push({ at: now, byName: SYSTEM.name, action: `status: ${c.status} → Action needed`, note: `${c.data.usage}% against ${c.data.threshold}%` }); c.status = 'Action needed'; await c.save(); breach.push(`• ${c.refNo} ${c.title}: ${c.data.usage}% of ${c.data.threshold}%`); }
  }
  if (breach.length) r.actions += await send(orgId, mgrs, `capacity:${week}`, `${breach.length} resource(s) over their capacity threshold`, lines(breach), '/isms?register=capacity', 'high');

  // 4. backups that have not run, or whose restore test is far overdue
  const baks: any[] = await IsmsRecord.find({ organizationId: orgId, register: 'backup', status: { $in: ['Active', 'Overdue'] }, isDeleted: { $ne: true } });
  const stale: string[] = [];
  for (const b of baks) {
    r.checked++;
    const f = String(b.data?.frequency || ''); const limit = /daily|hour|week/i.test(f) ? 8 : 35;
    const last = b.data?.lastBackup ? new Date(b.data.lastBackup) : undefined;
    if (!last || (now.getTime() - last.getTime()) / 86400000 > limit) stale.push(`• ${b.refNo} ${b.title}: ${last ? `last backup ${ymd(last)}` : 'no successful backup recorded'}`);
    const late = b.dueDate && new Date(b.dueDate) < now;
    if (late && b.status === 'Active') { b.status = 'Overdue'; b.history.push({ at: now, byName: SYSTEM.name, action: 'status: Active → Overdue', note: 'Restore test overdue' }); await b.save(); r.actions++; }
    if (!late && b.status === 'Overdue') { b.status = 'Active'; await b.save(); }
  }
  if (stale.length) r.actions += await send(orgId, mgrs, `backup-stale:${week}`, `${stale.length} backup(s) without a recent successful run`, lines(stale), '/isms?register=backup', 'high');
  r.details.push(`${breach.length} capacity breach(es), ${stale.length} stale backup(s)`);
  return r;
}

/* ------------------------------------------------------------ evidence vault watch */
async function evidenceWatch(orgId: string): Promise<RuleResult> {
  const r: RuleResult = { checked: 0, actions: 0, details: [] };
  const mgrs = await managers(orgId);
  const items: any[] = await Evidence.find({ organizationId: orgId, supersededById: { $exists: false } });
  let expired = 0, soon = 0, bad = 0;
  for (const e of items) {
    r.checked++;
    const owner = e.ownerId ? [String(e.ownerId)] : mgrs;
    if (e.validUntil) {
      const left = daysUntil(new Date(e.validUntil));
      if (left < 0) {
        expired++;
        const open = await EvidenceRequest.findOne({ organizationId: orgId, sourceEvidenceId: e._id, status: 'open' });
        if (!open) {
          const due = new Date(Date.now() + 14 * 86400000);
          await evidence.createRequest(orgId, { title: `Refresh expired evidence: ${e.title}`, controlRef: (e.controlRefs || [])[0], note: `${e.refNo} expired on ${ymd(e.validUntil)}. Add a new version.`, assigneeId: e.ownerId ? String(e.ownerId) : undefined, assigneeName: e.ownerName, dueDate: due.toISOString(), source: 'auto', sourceEvidenceId: String(e._id) }, SYSTEM);
          r.actions++;
        }
        if (await once(orgId, `ev-exp:${e._id}`)) r.actions += await send(orgId, [...owner, ...mgrs], `n-ev-exp:${e._id}`, `Evidence expired: ${e.refNo} ${e.title}`, `Valid until ${ymd(e.validUntil)}. A request to refresh it was opened. Controls affected: ${(e.controlRefs || []).join(', ') || 'none linked'}.`, '/isms?tab=evidence', 'high');
      } else {
        const step = [30, 14, 7, 1].sort((a, b) => a - b).find((w) => left <= w);
        if (step !== undefined) { soon++; if (await once(orgId, `ev-soon:${e._id}:${step}`)) r.actions += await send(orgId, owner, `n-ev-soon:${e._id}:${step}`, `Evidence expires in ${left} day(s): ${e.refNo}`, `${e.title} is valid until ${ymd(e.validUntil)}. Add a fresh version before then.`, '/isms?tab=evidence', 'warning'); }
      }
    }
    // weekly fingerprint check of stored files
    if (e.kind === 'file' && isoWeek() && await once(orgId, `ev-int:${e._id}:${isoWeek()}`)) {
      const before = e.integrity; await evidence.verifyEvidence(orgId, e, SYSTEM);
      if (['changed', 'missing'].includes(e.integrity)) { bad++; if (before !== e.integrity) r.actions += await send(orgId, mgrs, `ev-bad:${e._id}:${e.integrity}`, `Evidence file ${e.integrity === 'missing' ? 'is missing' : 'has changed'}: ${e.refNo}`, `${e.title} no longer matches its recorded SHA-256 fingerprint. Treat it as untrustworthy until investigated.`, '/isms?tab=evidence', 'critical'); }
    }
  }
  r.details.push(`${items.length} current evidence items: ${expired} expired, ${soon} expiring within 30 days, ${bad} failing the integrity check`);
  return r;
}

/* ------------------------------------------------------------ visitors */
async function visitorMorning(orgId: string): Promise<RuleResult> {
  const r: RuleResult = { checked: 0, actions: 0, details: [] };
  const today = visitors.lagosDate(new Date()); const s = visitors.atLagos(today, '00:00'); const e = new Date(s.getTime() + 86400000);
  const rows: any[] = await Visit.find({ organizationId: orgId, status: { $in: ['booked', 'approved'] }, scheduledStart: { $gte: s, $lt: e } });
  const byHost = new Map<string, string[]>();
  for (const v of rows) {
    r.checked++;
    const t = new Date(v.scheduledStart.getTime() + 3600000).toISOString().slice(11, 16);
    (byHost.get(String(v.hostId)) || byHost.set(String(v.hostId), []).get(String(v.hostId))!).push(`• ${t} ${v.visitor.name}${v.visitor.company ? ` (${v.visitor.company})` : ''} – ${v.purpose || 'no purpose given'}`);
    if (!v.reminderSent && v.visitor.email) { v.reminderSent = true; await v.save(); sendMail({ to: v.visitor.email, subject: `Reminder: your visit today at ${t}`, html: `<p>Hello ${v.visitor.name.replace(/[<>&]/g, '')},</p><p>This is a reminder of your appointment with <b>${v.hostName}</b> today at <b>${t}</b>. Please bring a photo ID and show your pass: ${visitors.visitUrl(v.passCode)}</p>` }).catch(() => undefined); r.actions++; }
  }
  for (const [hid, lines] of byHost) r.actions += await send(orgId, [hid], `visit-today:${hid}:${today}`, `${lines.length} visitor(s) expected today`, lines.join('\n'), '/my-visitors', 'info');
  const fd = (await usersWithModule(orgId, 'visitors')).map((u: any) => String(u._id));
  if (rows.length && fd.length) r.actions += await send(orgId, fd, `visit-today-desk:${today}`, `${rows.length} appointment(s) today`, rows.map((v) => `• ${new Date(v.scheduledStart.getTime() + 3600000).toISOString().slice(11, 16)} ${v.visitor.name} → ${v.hostName}`).join('\n'), '/visitors', 'info');
  r.details.push(`${rows.length} appointment(s) today`); return r;
}
async function visitorEvening(orgId: string): Promise<RuleResult> {
  const r: RuleResult = { checked: 0, actions: 0, details: [] };
  const today = visitors.lagosDate(new Date()); const s = visitors.atLagos(today, '00:00');
  // appointments and approved walk-ins that never arrived
  const missed: any[] = await Visit.find({ organizationId: orgId, status: { $in: ['booked', 'approved'] }, $or: [{ scheduledEnd: { $lt: new Date() } }, { type: 'walk_in', createdAt: { $lt: s } }] });
  for (const v of missed) { r.checked++; v.status = 'no_show'; v.timeline.push({ at: new Date(), byName: SYSTEM.name, text: 'Marked no-show: did not arrive' }); await v.save(); await SlotLock.deleteOne({ visitId: v._id }); r.actions++; }
  // pending requests older than a day are closed
  const stale: any[] = await Visit.find({ organizationId: orgId, status: 'pending_approval', createdAt: { $lt: new Date(Date.now() - 86400000) } });
  for (const v of stale) { v.status = 'cancelled'; v.timeline.push({ at: new Date(), byName: SYSTEM.name, text: 'Closed: host never answered within a day' }); await v.save(); await SlotLock.deleteOne({ visitId: v._id }); r.actions++; }
  // people who forgot to check out
  const still: any[] = await Visit.find({ organizationId: orgId, status: 'checked_in' });
  if (still.length) {
    const ids = [...(await usersWithModule(orgId, 'visitors')), ...(await usersWithModule(orgId, 'visitors_admin'))].map((u: any) => String(u._id));
    r.actions += await send(orgId, ids, `visit-still-in:${today}`, `${still.length} visitor(s) still checked in`, lines(still.map((v) => `• ${v.badgeNo} ${v.visitor.name} (host ${v.hostName}) since ${new Date(v.checkedInAt.getTime() + 3600000).toISOString().slice(11, 16)}`)) + '\nIf they have left, check them out so the evacuation list stays true.', '/visitors?tab=onsite', 'high');
  }
  // data minimisation: personal details of old visits are anonymised, counts stay for analytics
  const days = Number(process.env.VISITOR_RETENTION_DAYS) || 365;
  const old: any[] = await Visit.find({ organizationId: orgId, 'visitor.anonymised': { $ne: true }, status: { $nin: ['pending_approval', 'booked', 'approved', 'checked_in'] }, createdAt: { $lt: new Date(Date.now() - days * 86400000) } }).limit(500);
  for (const v of old) { v.visitor = { name: 'Anonymised', anonymised: true } as any; v.vehicle = undefined; v.purpose = undefined; v.timeline.push({ at: new Date(), byName: SYSTEM.name, text: `Personal details removed after ${days} days` }); await v.save(); r.actions++; }
  r.details.push(`${missed.length} no-show(s), ${stale.length} unanswered request(s) closed, ${still.length} still on site, ${old.length} record(s) anonymised`); return r;
}

/* ------------------------------------------------------------ supplier questionnaires */
async function supplierPortal(orgId: string): Promise<RuleResult> {
  const r: RuleResult = { checked: 0, actions: 0, details: [] }; const now = Date.now();
  const open: any[] = await SupplierAssessment.find({ organizationId: orgId, status: { $in: ['sent', 'in_progress', 'submitted'] } });
  let expired = 0, waiting = 0, stalled = 0;
  for (const a of open) {
    r.checked++;
    if (a.status !== 'submitted' && a.expiresAt.getTime() < now) { a.status = 'expired'; a.timeline.push({ at: new Date(), byName: SYSTEM.name, text: 'Link expired with no submission' }); await a.save(); expired++; continue; }
    if (a.status === 'submitted' && a.submittedAt && now - a.submittedAt.getTime() > 3 * DAY) waiting++;
    if (a.status !== 'submitted' && now - (a.lastRemindedAt || a.createdAt).getTime() > 7 * DAY) stalled++;
  }
  if (expired) r.actions += await send(orgId, await managers(orgId), `sq-expired:${ymd()}`, `${expired} supplier questionnaire(s) expired unanswered`, 'Re-send them from Supplier assessments, or follow up by phone.', '/supplier-assessments', 'warning');
  if (waiting) r.actions += await send(orgId, await managers(orgId), `sq-review:${isoWeek()}`, `${waiting} supplier answer(s) waiting for your review`, 'Submitted more than 3 days ago.', '/supplier-assessments', 'high');
  if (stalled) r.actions += await send(orgId, await managers(orgId), `sq-stalled:${isoWeek()}`, `${stalled} supplier(s) have not answered after a week`, 'Use "Send reminder" on the questionnaire; it issues a fresh link.', '/supplier-assessments', 'info');
  r.details.push(`${open.length} open, ${expired} expired, ${waiting} awaiting review, ${stalled} unanswered for a week`); return r;
}

/* ------------------------------------------------------------ e-signatures */
async function signatureFollowup(orgId: string): Promise<RuleResult> {
  const r: RuleResult = { checked: 0, actions: 0, details: [] }; const now = Date.now(); let expired = 0, slow = 0;
  const open: any[] = await SignatureRequest.find({ organizationId: orgId, status: 'out_for_signature' });
  for (const q of open) {
    r.checked++;
    if (q.expiresAt.getTime() < now) { q.status = 'expired'; q.timeline.push({ at: new Date(), byName: SYSTEM.name, text: 'Expired before everyone signed' }); await q.save(); expired++; continue; }
    if (now - q.createdAt.getTime() > 5 * DAY && q.signers.some((s: any) => s.status === 'pending')) slow++;
  }
  if (expired) r.actions += await send(orgId, await managers(orgId), `sig-expired:${ymd()}`, `${expired} signature request(s) expired`, 'Not everyone signed in time. Send them again from E-signatures.', '/signatures', 'warning');
  if (slow) r.actions += await send(orgId, await managers(orgId), `sig-slow:${isoWeek()}`, `${slow} document(s) still waiting for signatures after 5 days`, 'Use "Send reminder" on each; it issues fresh links.', '/signatures', 'info');
  r.details.push(`${open.length} out for signature, ${expired} expired, ${slow} slow`); return r;
}

/* ------------------------------------------------------------ rule catalogue */
export const RULES: RuleDef[] = [
  { key: 'register_due', title: 'Due-date reminders, overdue flagging and escalation', policy: 'All ISMS procedures (clauses 6–10)', clause: '7.5 / 9 / 10', schedule: 'Daily 06:00 (Lagos)', cron: '0 6 * * *', description: 'Reminds owners at 90/60/30/14/7/1 days (legal items) or 14/7/1 days, flips late items to Overdue, repeats weekly and escalates to CEO/COO after 14 days late.', run: registerDue },
  { key: 'recurring_reschedule', title: 'Recurring communications and training re-schedule themselves', policy: 'Competency, Communication and Awareness', clause: '7.3 / 7.4', schedule: 'Daily 06:05', cron: '5 6 * * *', description: 'When a monthly/quarterly/annual communication or training is marked Done, the next occurrence is created.', run: recurringReschedule },
  { key: 'metrics_auto', title: 'ISMS metrics measured from app data', policy: 'Monitoring, Measuring, Analysis and Evaluation', clause: '9.1', schedule: 'Daily 06:10', cron: '10 6 * * *', description: 'Metrics linked to app data (MFA %, policy acknowledgement %, assets with owner …) get a fresh actual; a missed target opens an improvement item.', run: metricsAuto },
  { key: 'audit_programme', title: 'Annual internal audit programme', policy: 'Control of Internal Auditing', clause: '9.2', schedule: 'Daily 06:15', cron: '15 6 * * *', description: 'Creates the four quarterly audits for the year (clause and Annex A coverage) if they are missing, then reminders run through the due-date rule.', run: auditProgramme },
  { key: 'mgmt_review_prompt', title: 'Management review every six months', policy: 'Control of Management Reviews', clause: '9.3', schedule: 'Daily 06:20', cron: '20 6 * * *', description: 'If no management review was recorded for 180 days, an action is created and leadership is notified.', run: mgmtReviewPrompt },
  { key: 'incident_to_car', title: 'High/critical incidents open a corrective action', policy: 'Incident Management; CAR procedure', clause: '10.2', schedule: 'Daily 06:25', cron: '25 6 * * *', description: 'A recovered or closed high/critical incident gets a draft CAR with its root cause and actions.', run: incidentToCar },
  { key: 'byod_leavers', title: 'BYOD devices of leavers are suspended', policy: 'Use of Personal Devices (BYOD) Policy', clause: 'A.6.7', schedule: 'Daily 06:30', cron: '30 6 * * *', description: 'A device whose owner is no longer active is suspended and managers are asked to confirm the company data is removed.', run: byodLeavers },
  { key: 'supplier_cycle', title: 'Annual supplier security reviews', policy: 'Information Security in Supplier Relationships', clause: 'A.5.19–A.5.22', schedule: 'Mondays 06:35', cron: '35 6 * * 1', description: 'Weekly list of active suppliers without a security review in the last 12 months.', run: supplierCycle },
  { key: 'onboarding_tasks', title: 'Onboarding checklist for new staff', policy: 'Employee Onboarding Checklist; Human Resource Security Policy', clause: 'A.6.1 / A.6.3', schedule: 'Daily 06:40', cron: '40 6 * * *', description: 'New staff get four security tasks (policies, MFA, induction, NDA) and HR gets three (identity checks, assets, access).', run: onboardingTasks },
  { key: 'domain_health', title: 'Domain checks: TLS certificate, SPF, DMARC', policy: 'Network Security; Information Transfer Policy', clause: 'A.8.20 / A.5.14', schedule: 'Mondays 06:45', cron: '45 6 * * 1', description: 'Free checks of the domains in ISMS_DOMAINS: certificate expiry under 21 days, missing SPF or DMARC.', run: domainHealth },
  { key: 'evidence_pack', title: 'Monthly evidence pack of every register', policy: 'Control of Management System Records', clause: '7.5.3', schedule: '1st of the month 04:00', cron: '0 4 1 * *', description: 'Exports all registers to one zip with a SHA-256 fingerprint so the state at month end can be shown to an auditor.', run: evidencePack },
  { key: 'risk_suggest', title: 'Risks suggested from live data', policy: 'ISMS Control of Risks and Opportunities (Risk Management)', clause: '6.1.2', schedule: 'Mondays 06:50', cron: '50 6 * * 1', description: 'Looks at incidents, critical assets with no risk, phishing results, quiz weak spots, overdue suppliers, failing personal devices and end-of-life assets, and proposes risks (scored) for the ISMS manager to accept or dismiss.', run: riskSuggestRule },
  { key: 'awareness_digest', title: 'Security awareness weekly summary', policy: 'Competency, Communication and Awareness', clause: '7.3 / A.6.3', schedule: 'Fridays 07:00', cron: '0 7 * * 5', description: 'Sends the ISMS team participation, accuracy and weakest topics; nudges everyone once a month if less than half took part.', run: awarenessDigest },
  { key: 'phish_close', title: 'Phishing simulations close after 7 days', policy: 'Competency, Communication and Awareness', clause: 'A.6.3', schedule: 'Daily 07:10', cron: '10 7 * * *', description: 'A simulation running for 7 days is ended, people who did not click earn points, and the results are sent to the ISMS team.', run: phishClose },
  { key: 'asset_risk_sweep', title: 'Asset threat and risk sweep', policy: 'ISMS Control of Risks and Opportunities (Risk Management)', clause: '6.1.2 / A.5.9', schedule: 'Mondays 06:40', cron: '40 6 * * 1', description: 'Re-checks every asset against the threat catalogue and live threat intelligence, creates missing risks in the register, re-scores risks whose asset changed, closes risks of retired assets and tells the owner, department head and ISMS team.', run: assetRiskSweep },
  { key: 'soa_sync', title: 'Statement of Applicability: 93 controls kept complete and tested', policy: 'ISMS Control of Risks and Opportunities (Risk Management)', clause: '6.1.3 / A.5.35', schedule: 'Daily 06:12', cron: '12 6 * * *', description: 'Makes sure all 93 Annex A controls exist, reminds owners when a control test is due (through the due-date rule) and tells the ISMS team weekly about failed, overdue and unjustified controls. A failed test opens a corrective action by itself.', run: soaSync },
  { key: 'ops_cycle', title: 'Log reviews, maintenance, capacity and backup checks', policy: 'Capacity Management Policy; ICT Readiness for Business Continuity; Physical and Environmental Security', clause: 'A.8.6 / A.8.13 / A.8.15 / A.7.13', schedule: 'Mondays 06:55', cron: '55 6 * * 1', description: 'Creates the weekly log review pre-filled from the audit trail, schedules the next planned maintenance when one is done, flags capacity above threshold, and lists backups with no recent success. Restore-test failures open a corrective action immediately.', run: opsCycle },
  { key: 'evidence_watch', title: 'Evidence vault: expiry, refresh requests and integrity', policy: 'Control of Management System Records', clause: '7.5.3 / 9.2', schedule: 'Daily 06:58', cron: '58 6 * * *', description: 'Warns owners at 30/14/7/1 days before evidence expires, opens a refresh request when it does, and re-checks the SHA-256 fingerprint of every stored file weekly. A changed or missing file raises a critical alert.', run: evidenceWatch },
  { key: 'visitor_morning', title: 'Visitors: reminders for today\'s appointments', policy: 'Physical and Environmental Security', clause: 'A.7.2 / A.7.6', schedule: 'Daily 07:35', cron: '35 7 * * *', description: 'E-mails each visitor with an appointment today and sends hosts and reception the day\'s list.', run: visitorMorning },
  { key: 'visitor_evening', title: 'Visitors: no-shows, forgotten check-outs and data minimisation', policy: 'Physical and Environmental Security; Information Deletion Policy', clause: 'A.7.2 / A.8.10', schedule: 'Daily 19:30', cron: '30 19 * * *', description: 'Marks missed appointments as no-show and frees their slot, closes unanswered requests, warns reception about visitors still checked in, and anonymises visitor details after VISITOR_RETENTION_DAYS (default 365).', run: visitorEvening },
  { key: 'supplier_portal', title: 'Suppliers: questionnaire follow-up', policy: 'Supplier Relationships and Outsourcing', clause: 'A.5.19 / A.5.22', schedule: 'Daily 08:10', cron: '10 8 * * *', description: 'Expires unanswered supplier questionnaire links, and alerts the ISMS team to answers waiting for review and to suppliers who have not responded after a week. It never e-mails suppliers by itself; a person sends or re-sends each questionnaire.', run: supplierPortal },
  { key: 'signature_followup', title: 'E-signatures: expiry and chasing', policy: 'Document and Records Control', clause: 'A.5.33', schedule: 'Daily 08:20', cron: '20 8 * * *', description: 'Expires signature requests that ran out of time and alerts the ISMS team to documents still unsigned after 5 days. It never e-mails signers by itself.', run: signatureFollowup },
];
export const RULE_MAP = Object.fromEntries(RULES.map((r) => [r.key, r]));

export async function isEnabled(orgId: string, key: string): Promise<boolean> {
  const s: any = await AutomationSetting.findOne({ organizationId: orgId, ruleKey: key }).lean();
  return s ? s.enabled !== false : true;
}

export async function runRule(orgId: string, key: string, trigger: 'schedule' | 'manual', byName?: string) {
  const rule = RULE_MAP[key]; if (!rule) throw new Error(`Unknown rule ${key}`);
  const run: any = await AutomationRun.create({ organizationId: orgId, ruleKey: key, trigger, byName });
  try {
    const res = await rule.run(orgId);
    Object.assign(run, { ok: true, checked: res.checked, actions: res.actions, details: res.details.slice(0, 40), summary: `${res.checked} checked, ${res.actions} action(s)`, finishedAt: new Date() });
  } catch (e: any) {
    logger.error({ err: e, rule: key }, 'isms rule failed');
    Object.assign(run, { ok: false, error: String(e?.message || e).slice(0, 500), summary: 'failed', finishedAt: new Date() });
  }
  await run.save();
  return run;
}

/** Called by cron: every enabled rule matching the cron expression, for every active organisation. */
export async function runScheduled(keys: string[]) {
  const orgs = await Organization.find({ isActive: true }).select('_id').lean();
  for (const o of orgs) for (const k of keys) { if (await isEnabled(String(o._id), k)) await runRule(String(o._id), k, 'schedule'); }
}
