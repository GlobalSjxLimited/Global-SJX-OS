import { workFor, workRemindersRun } from './work.reminders';
import { Organization } from '../models/Organization';
import { User } from '../models/User';
import { Certification } from '../models/Certification';
import { Asset } from '../models/Asset';
import { Invoice, BankAccount, TaxRecord } from '../models/Finance';
import { ExpenseClaim } from '../models/Expense';
import { Incident, DataSubjectRequest, ProcessingActivity, Policy, PolicyAcknowledgement, Obligation, AccessReview } from '../models/Governance';
import { Notification } from '../models/Notification';
import { notify } from './notify.service';
import { usersWithModule } from './access.service';
import { sealPendingDays, verifySeals } from './audit.service';
import { logActivity } from '../models/ActivityLog';
import { REPORT_MAP } from './reports.service';
import { runDueSchedules } from './reportDelivery.service';
import { EXTERNAL_ROLES } from '../config/roles';
import { env } from '../config/env';
import { logger } from '../utils/logger';
import { controlsReminders, controlsFor } from './controls.service';
import { money, fmtDate, dataTable, esc } from './mail.templates';

const DAY = 86400000;
const ymd = (d = new Date()) => d.toISOString().slice(0, 10);
const isoWeek = (d = new Date()) => { const t = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate())); t.setUTCDate(t.getUTCDate() + 4 - (t.getUTCDay() || 7)); const y0 = new Date(Date.UTC(t.getUTCFullYear(), 0, 1)); return `${t.getUTCFullYear()}-W${Math.ceil(((+t - +y0) / DAY + 1) / 7)}`; };
const daysUntil = (d: Date) => Math.ceil((d.getTime() - Date.now()) / DAY);
const ids = (arr: Array<{ _id: any }>) => arr.map((u) => String(u._id));
const uniq = (a: Array<string | undefined | null>) => Array.from(new Set(a.filter(Boolean).map(String)));
const bucket = (n: number, steps: number[]) => steps.find((s) => n <= s); // smallest threshold reached

type Sev = 'info' | 'warning' | 'high' | 'critical';
interface Ctx { org: string; sent: number }

async function r(ctx: Ctx, userIds: string[], key: string, title: string, body: string, link: string, type: string, severity: Sev = 'warning', email = true) {
  if (!userIds.length) return;
  const n = await notify({ organizationId: ctx.org, userIds, title, body, link, type, severity, dedupeKey: key, email: email ? { intro: body } : undefined });
  ctx.sent += n;
}

/* ------------------------------ individual checks -------------------------- */
async function certifications(c: Ctx) {
  const certs = await Certification.find({ organizationId: c.org, isDeleted: { $ne: true }, expiryDate: { $lt: new Date(Date.now() + 61 * DAY) } }).populate('employeeId', 'name isActive managerId');
  const hr = ids(await usersWithModule(c.org, 'employees'));
  for (const x of certs as any[]) {
    if (!x.employeeId || x.employeeId.isActive === false || !x.expiryDate) continue;
    const left = daysUntil(x.expiryDate);
    const step = left < 0 ? -1 : bucket(left, [1, 7, 14, 30, 60]);
    if (step === undefined) continue;
    const label = left < 0 ? `expired ${-left} day(s) ago` : `expires in ${left} day(s)`;
    const to = uniq([String(x.employeeId._id), x.employeeId.managerId && String(x.employeeId.managerId)]);
    await r(c, to, `cert:${x._id}:${step}`, `Certification ${left < 0 ? 'expired' : 'expiring'}: ${x.name}`, `${x.employeeId.name}'s ${x.name} (${x.provider}) ${label} (${fmtDate(x.expiryDate)}).`, '/certifications', 'certification', left <= 7 ? 'high' : 'warning');
    if (left < 0 || left <= 14) await r(c, hr, `cert-hr:${x._id}:${step}`, `Certification ${left < 0 ? 'expired' : 'expiring'}: ${x.employeeId.name} — ${x.name}`, `${x.name} ${label}.`, '/certifications', 'certification', 'warning', false);
  }
}

async function obligations(c: Ctx) {
  const list = await Obligation.find({ organizationId: c.org, isDeleted: { $ne: true }, status: 'active', nextDueAt: { $lt: new Date(Date.now() + 31 * DAY) } });
  for (const o of list as any[]) {
    const left = daysUntil(o.nextDueAt);
    const extra = ids(await (o.notifyModules?.length ? usersWithModule(c.org, ...o.notifyModules) : Promise.resolve([])));
    const to = uniq([o.ownerId && String(o.ownerId), ...extra]);
    if (left < 0) {
      await r(c, to, `obl-overdue:${o._id}:${ymd()}`, `OVERDUE: ${o.title}`, `${o.title}${o.authority ? ` (${o.authority})` : ''} was due ${fmtDate(o.nextDueAt)} — ${-left} day(s) ago. Complete it and mark it done.`, '/compliance', 'compliance', 'critical');
    } else {
      const step = (o.remindDaysBefore || [14, 7, 3, 1]).slice().sort((a: number, b: number) => a - b).find((d: number) => left <= d);
      if (step !== undefined) await r(c, to, `obl:${o._id}:${ymd(o.nextDueAt)}:${step}`, `Due in ${left} day(s): ${o.title}`, `${o.title}${o.authority ? ` (${o.authority})` : ''} is due ${fmtDate(o.nextDueAt)}.`, '/compliance', 'compliance', left <= 3 ? 'high' : 'warning');
    }
  }
}

async function invoices(c: Ctx) {
  const fin = ids(await usersWithModule(c.org, 'invoices'));
  const list = await Invoice.find({ organizationId: c.org, isDeleted: { $ne: true }, status: { $in: ['sent', 'partially_paid'] }, dueDate: { $lt: new Date(Date.now() + 4 * DAY) } }).populate('clientId', 'name');
  for (const inv of list as any[]) {
    const late = -daysUntil(inv.dueDate);
    const owner = inv.createdById ? [String(inv.createdById)] : [];
    if (late < 0) { await r(c, uniq(owner), `inv-due:${inv._id}`, `Invoice ${inv.invoiceNo} due soon`, `${inv.clientId?.name}: ${money(inv.balance, inv.currency)} due ${fmtDate(inv.dueDate)}.`, `/invoices?invoice=${inv._id}`, 'finance', 'info', false); continue; }
    const step = bucket(late, [0, 7, 14, 30]) !== undefined ? [30, 14, 7, 0].find((s) => late >= s) : undefined;
    if (step !== undefined) await r(c, uniq([...owner, ...fin]), `inv-late:${inv._id}:${step}`, `Overdue invoice ${inv.invoiceNo} (${late}d)`, `${inv.clientId?.name} owes ${money(inv.balance, inv.currency)}; due ${fmtDate(inv.dueDate)}. Send a reminder from the invoice.`, `/invoices?invoice=${inv._id}`, 'finance', late >= 30 ? 'high' : 'warning');
  }
  const pend = await Invoice.find({ organizationId: c.org, isDeleted: { $ne: true }, status: 'pending_approval', submittedAt: { $lt: new Date(Date.now() - 2 * DAY) } });
  if (pend.length) await r(c, fin, `inv-approvals:${isoWeek()}:${pend.length}`, `${pend.length} invoice(s) waiting for approval`, `Invoices submitted more than 2 days ago still need approval: ${pend.map((p: any) => p.invoiceNo).join(', ')}.`, '/invoices', 'finance', 'warning');
}

async function expenses(c: Ctx) {
  const appr = ids(await usersWithModule(c.org, 'expense_approvals'));
  const waiting = await ExpenseClaim.find({ organizationId: c.org, isDeleted: { $ne: true }, status: { $in: ['submitted', 'partially_approved'] }, submittedAt: { $lt: new Date(Date.now() - 2 * DAY) } });
  if (waiting.length) await r(c, appr, `exp-wait:${ymd()}:${waiting.length}`, `${waiting.length} expense claim(s) awaiting a decision`, `Oldest: ${waiting.sort((a: any, b: any) => a.submittedAt - b.submittedAt)[0].claimNo}, submitted ${fmtDate((waiting[0] as any).submittedAt)}.`, '/expenses', 'expense', 'warning');
  const pay = await ExpenseClaim.find({ organizationId: c.org, isDeleted: { $ne: true }, status: 'approved', decidedAt: { $lt: new Date(Date.now() - 5 * DAY) } });
  for (const cl of pay as any[]) {
    await r(c, appr, `exp-pay:${cl._id}:${isoWeek()}`, `Approved claim not yet paid: ${cl.claimNo}`, `${cl.submittedByName}: ${money(cl.totals.payable, cl.currency)} approved ${fmtDate(cl.decidedAt)} and still unpaid.`, `/expenses?claim=${cl._id}`, 'expense', 'warning');
    await r(c, [String(cl.submittedById)], `exp-pay-emp:${cl._id}:${isoWeek()}`, `Your claim ${cl.claimNo} is approved and awaiting payment`, 'Finance has been reminded to settle it.', `/expenses?claim=${cl._id}`, 'expense', 'info', false);
  }
  const drafts = await ExpenseClaim.find({ organizationId: c.org, isDeleted: { $ne: true }, status: 'draft', updatedAt: { $lt: new Date(Date.now() - 7 * DAY) } });
  for (const d of drafts as any[]) await r(c, [String(d.submittedById)], `exp-draft:${d._id}:${isoWeek()}`, `Unsubmitted expense draft: ${d.title}`, `You started ${d.claimNo} over a week ago. Submit it or cancel it so receipts are not lost.`, `/expenses?claim=${d._id}`, 'expense', 'info', false);
}

async function assets(c: Ctx) {
  const am = ids(await usersWithModule(c.org, 'assets'));
  const base = { organizationId: c.org, isDeleted: { $ne: true } };
  const rev = await Asset.find({ ...base, lifecycleStatus: { $in: ['active', 'under_maintenance'] }, nextReviewDate: { $lt: new Date(Date.now() + 31 * DAY) } });
  const byOwner = new Map<string, any[]>();
  for (const a of rev as any[]) { const left = daysUntil(a.nextReviewDate); const step = left < 0 ? 'late' : bucket(left, [0, 7, 30]); if (step === undefined) continue; const k = `${a.ownerUser || a.custodianUser || 'none'}|${step}`; (byOwner.get(k) || byOwner.set(k, []).get(k)!).push(a); }
  for (const [k, list] of byOwner) { const [uid, step] = k.split('|'); await r(c, uid === 'none' ? am : [uid], `asset-rev:${k}:${isoWeek()}`, `${list.length} asset review(s) ${step === 'late' ? 'overdue' : 'due soon'}`, list.slice(0, 8).map((a: any) => `${a.assetId} ${a.title}`).join('; '), '/assets', 'asset', step === 'late' ? 'high' : 'warning'); }
  for (const field of ['licenseExpiryDate', 'warrantyExpiryDate'] as const) {
    const list = await Asset.find({ ...base, lifecycleStatus: { $in: ['active', 'under_maintenance'] }, [field]: { $lt: new Date(Date.now() + 61 * DAY), $gt: new Date(Date.now() - 1 * DAY) } });
    for (const a of list as any[]) { const left = daysUntil(a[field]); const step = bucket(left, [7, 30, 60]); if (step === undefined) continue; await r(c, uniq([a.ownerUser && String(a.ownerUser), ...am]), `asset-${field}:${a._id}:${step}`, `${field === 'licenseExpiryDate' ? 'Licence' : 'Warranty'} expiring: ${a.title}`, `${a.assetId} ${field === 'licenseExpiryDate' ? 'licence' : 'warranty'} ends ${fmtDate(a[field])} (${left}d).`, '/assets', 'asset', left <= 7 ? 'high' : 'warning'); }
  }
  const eol = await Asset.countDocuments({ ...base, lifecycleStatus: { $in: ['active', 'under_maintenance'] }, eolState: 'expired' });
  if (eol) await r(c, am, `asset-eol:${isoWeek()}:${eol}`, `${eol} asset(s) are past end of life`, 'Replace, extend support, or retire them — unsupported assets are a vulnerability (A.8.8).', '/assets?eol=expired', 'asset', 'high', false);
  const disp = await Asset.find({ ...base, lifecycleStatus: 'in_disposal', 'disposal.approvedAt': { $exists: false }, 'disposal.requestedAt': { $lt: new Date(Date.now() - 3 * DAY) } });
  if (disp.length) await r(c, ids(await User.find({ organizationId: c.org, isActive: true, role: { $in: ['super_admin', 'ceo', 'coo'] } })), `asset-disp:${isoWeek()}:${disp.length}`, `${disp.length} asset disposal(s) waiting for approval`, 'Disposal requests have been waiting more than 3 days.', '/assets', 'asset', 'warning');
  const held = await Asset.find({ ...base, assignedToId: { $ne: null } }).populate('assignedToId', 'name isActive');
  const gone = (held as any[]).filter((a) => a.assignedToId?.isActive === false);
  if (gone.length) await r(c, am, `asset-offboard:${isoWeek()}:${gone.length}`, `${gone.length} asset(s) still assigned to offboarded staff`, gone.slice(0, 8).map((a: any) => `${a.assetId} (${a.assignedToId.name})`).join('; '), '/assets', 'asset', 'high');
}

async function incidents(c: Ctx) {
  const handlers = ids(await usersWithModule(c.org, 'incidents'));
  const dpo = ids(await usersWithModule(c.org, 'data_protection'));
  const open = await Incident.find({ organizationId: c.org, isDeleted: { $ne: true }, status: { $ne: 'closed' } });
  for (const i of open as any[]) {
    if (i.isPersonalDataBreach && !i.breach?.regulatorNotified && i.breach?.riskToRights !== 'unlikely' && i.breach?.regulatorDeadline) {
      const h = (i.breach.regulatorDeadline.getTime() - Date.now()) / 3600000;
      const step = h < 0 ? 'overdue' : bucket(h, [6, 24, 48]);
      if (step !== undefined) await r(c, uniq([...handlers, ...dpo, i.assigneeId && String(i.assigneeId)]), `breach:${i._id}:${step}${step === 'overdue' ? ymd() : ''}`, h < 0 ? `BREACH NOTIFICATION OVERDUE: ${i.reference}` : `Breach ${i.reference}: ${Math.round(h)}h left to notify the regulator`, `${i.title}. Deadline ${i.breach.regulatorDeadline.toUTCString()}.`, `/incidents?incident=${i._id}`, 'incident', 'critical');
    }
    const lastTouch = i.timeline?.length ? i.timeline[i.timeline.length - 1].at : i.createdAt;
    if (['critical', 'high'].includes(i.severity) && Date.now() - new Date(lastTouch).getTime() > DAY) await r(c, uniq([i.assigneeId && String(i.assigneeId), ...handlers]), `inc-stale:${i._id}:${ymd()}`, `${i.severity.toUpperCase()} incident ${i.reference} has had no update for 24h`, i.title, `/incidents?incident=${i._id}`, 'incident', 'high');
    if (!i.assigneeId && Date.now() - new Date(i.createdAt).getTime() > 4 * 3600000) await r(c, handlers, `inc-unassigned:${i._id}:${ymd()}`, `Incident ${i.reference} has no owner`, i.title, `/incidents?incident=${i._id}`, 'incident', 'high');
  }
}

async function dsars(c: Ctx) {
  const dpo = ids(await usersWithModule(c.org, 'data_protection'));
  const list = await DataSubjectRequest.find({ organizationId: c.org, isDeleted: { $ne: true }, status: { $nin: ['completed', 'rejected'] } });
  for (const d of list as any[]) {
    const left = daysUntil(d.dueAt);
    const step = left < 0 ? `late${ymd()}` : bucket(left, [1, 3, 7]);
    if (step === undefined) continue;
    await r(c, uniq([...dpo, d.assigneeId && String(d.assigneeId)]), `dsar:${d._id}:${step}`, left < 0 ? `OVERDUE data request ${d.reference}` : `Data request ${d.reference} due in ${left}d`, `${d.type} request from ${d.requester?.name}. Due ${fmtDate(d.dueAt)}.`, '/privacy', 'dsar', left < 0 ? 'critical' : left <= 3 ? 'high' : 'warning');
  }
  const ropa = await ProcessingActivity.find({ organizationId: c.org, isDeleted: { $ne: true }, status: 'active', nextReviewAt: { $lt: new Date(Date.now() + 15 * DAY) } });
  if (ropa.length) await r(c, dpo, `ropa:${isoWeek()}:${ropa.length}`, `${ropa.length} processing record(s) due for review`, ropa.slice(0, 8).map((p: any) => p.name).join('; '), '/privacy', 'data_protection', 'warning', false);
  const dpia = await ProcessingActivity.find({ organizationId: c.org, isDeleted: { $ne: true }, status: 'active', dpiaRequired: true, dpiaStatus: { $in: ['pending', 'in_progress'] } });
  if (dpia.length) await r(c, dpo, `dpia:${isoWeek()}:${dpia.length}`, `${dpia.length} DPIA(s) still to be completed`, dpia.slice(0, 8).map((p: any) => p.name).join('; '), '/privacy', 'data_protection', 'warning', false);
}

async function policies(c: Ctx) {
  const pols = await Policy.find({ organizationId: c.org, isDeleted: { $ne: true }, status: 'approved' });
  const staff = await User.find({ organizationId: c.org, isActive: true, loginEnabled: { $ne: false }, role: { $nin: EXTERNAL_ROLES as unknown as string[] } }).select('name role');
  const pm = ids(await usersWithModule(c.org, 'policies'));
  for (const p of pols as any[]) {
    if (p.nextReviewAt && p.nextReviewAt < new Date(Date.now() + 31 * DAY)) await r(c, uniq([p.ownerId && String(p.ownerId), ...pm]), `pol-review:${p._id}:${p.version}:${p.nextReviewAt < new Date() ? 'late' + isoWeek() : 'soon'}`, `Policy review ${p.nextReviewAt < new Date() ? 'overdue' : 'due'}: ${p.title}`, `${p.code} v${p.version} review date ${fmtDate(p.nextReviewAt)}.`, '/policies', 'policy', p.nextReviewAt < new Date() ? 'high' : 'warning');
    if (!p.requiresAcknowledgement || !p.approvedAt || Date.now() - p.approvedAt.getTime() < 7 * DAY) continue;
    const acks = new Set((await PolicyAcknowledgement.find({ policyId: p._id, version: p.version }).select('userId')).map((a) => String(a.userId)));
    const missing = staff.filter((u) => (!p.audienceRoles?.length || p.audienceRoles.includes(u.role)) && !acks.has(String(u._id)));
    const fortnight = `${new Date().getUTCFullYear()}-${Math.floor(Number(isoWeek().split('W')[1]) / 2)}`;
    if (missing.length) await r(c, ids(missing), `pol-ack:${p._id}:${p.version}:${fortnight}`, `Please acknowledge: ${p.title}`, `You haven't acknowledged ${p.code} v${p.version}. It takes two minutes.`, '/policies', 'policy', 'warning');
    if (missing.length && missing.length >= Math.ceil(staff.length * 0.2)) await r(c, pm, `pol-ack-mgr:${p._id}:${p.version}:${fortnight}`, `${missing.length} people have not acknowledged ${p.code}`, missing.slice(0, 10).map((u) => u.name).join(', '), '/policies', 'policy', 'warning', false);
  }
}

async function accessHygiene(c: Ctx) {
  const ac = ids(await usersWithModule(c.org, 'access_control'));
  const sec = ids(await usersWithModule(c.org, 'security'));
  const rev = await AccessReview.find({ organizationId: c.org, isDeleted: { $ne: true }, status: 'open' });
  for (const a of rev as any[]) if (a.dueDate) { const left = daysUntil(a.dueDate); const step = left < 0 ? `late${isoWeek()}` : bucket(left, [1, 3, 7]); if (step !== undefined) await r(c, uniq([a.reviewerId && String(a.reviewerId), ...ac]), `acr:${a._id}:${step}`, left < 0 ? `Access review overdue: ${a.reference}` : `Access review ${a.reference} due in ${left}d`, `${(a.items as any[]).filter((i) => i.decision === 'pending').length} user(s) still need a decision.`, '/access', 'access', left < 0 ? 'high' : 'warning'); }
  const last = await AccessReview.findOne({ organizationId: c.org, isDeleted: { $ne: true }, status: 'completed' }).sort('-completedAt');
  if (!rev.length && (!last || Date.now() - last.completedAt!.getTime() > 180 * DAY)) await r(c, ac, `acr-none:${new Date().toISOString().slice(0, 7)}`, 'A user access review is due', last ? `Last completed ${fmtDate(last.completedAt)}. ISO 27001 expects periodic review (every 6 months is a good rhythm).` : 'No access review has ever been completed. Start one in Access Control.', '/access', 'access', 'warning');
  const users = await User.find({ organizationId: c.org, isActive: true, loginEnabled: { $ne: false }, role: { $nin: EXTERNAL_ROLES as unknown as string[] } }).select('name email lastLoginAt mfaEnabled passwordChangedAt createdAt');
  const dormant = users.filter((u) => (u.lastLoginAt ? u.lastLoginAt.getTime() : (u as any).createdAt.getTime()) < Date.now() - env.dormantAccountDays * DAY);
  if (dormant.length) await r(c, uniq([...sec, ...ac]), `dormant:${isoWeek()}:${dormant.length}`, `${dormant.length} dormant account(s)`, `No sign-in for ${env.dormantAccountDays}+ days: ${dormant.slice(0, 8).map((u) => u.name).join(', ')}${dormant.length > 8 ? '…' : ''}`, '/reports?report=dormant_accounts', 'security', 'warning', false);
  const noMfa = users.filter((u) => !u.mfaEnabled);
  if (noMfa.length) {
    await r(c, ids(noMfa), `mfa-nudge:${new Date().toISOString().slice(0, 7)}`, 'Turn on multi-factor authentication', 'Protect your account and company data: set up an authenticator app in Settings → Security.', '/settings', 'security', 'warning');
    await r(c, sec, `mfa-gap:${isoWeek()}:${noMfa.length}`, `${noMfa.length} user(s) without MFA`, noMfa.slice(0, 10).map((u) => u.name).join(', '), '/reports?report=mfa_coverage', 'security', 'warning', false);
  }
  for (const u of users) {
    if (!u.passwordChangedAt) continue;
    const left = Math.ceil(env.passwordMaxAgeDays - (Date.now() - u.passwordChangedAt.getTime()) / DAY);
    const step = left < 0 ? undefined : bucket(left, [1, 7, 14]);
    if (step !== undefined) await r(c, [String(u._id)], `pwd:${u._id}:${ymd(u.passwordChangedAt)}:${step}`, `Your password expires in ${left} day(s)`, 'Change it in Settings → Security before it expires.', '/settings', 'security', left <= 1 ? 'high' : 'warning');
  }
  const pend = await BankAccount.find({ organizationId: c.org, isDeleted: { $ne: true }, status: 'pending', createdAt: { $lt: new Date(Date.now() - 2 * DAY) } });
  if (pend.length) await r(c, ids(await usersWithModule(c.org, 'bank_accounts')), `bank-pend:${isoWeek()}:${pend.length}`, `${pend.length} bank account(s) awaiting approval`, 'A second person must approve before the account can be used on invoices.', '/accounts', 'finance', 'warning', false);
}

async function taxes(c: Ctx) {
  const now = new Date();
  if (now.getUTCDate() < 15) return;
  const prev = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, 1));
  const unpaid = await TaxRecord.find({ organizationId: c.org, status: 'unpaid', nature: { $in: ['output_vat', 'wht_withheld_by_us'] }, year: prev.getUTCFullYear(), month: prev.getUTCMonth() + 1 });
  if (!unpaid.length) return;
  const vat = unpaid.filter((t) => t.kind === 'VAT').reduce((s, t) => s + t.amount, 0), wht = unpaid.filter((t) => t.kind === 'WHT').reduce((s, t) => s + t.amount, 0);
  const left = 21 - now.getUTCDate();
  await r(c, ids(await usersWithModule(c.org, 'taxes')), `taxrem:${ymd()}`, left >= 0 ? `VAT/WHT for last month is due in ${left} day(s)` : 'VAT/WHT remittance is OVERDUE', `Unremitted: VAT ${money(vat)} · WHT ${money(wht)}. Deadline: 21st.`, '/taxes', 'finance', left < 0 ? 'critical' : left <= 3 ? 'high' : 'warning');
}

async function integrity(c: Ctx) {
  const sealed = await sealPendingDays(c.org);
  const v = await verifySeals(c.org);
  if (!v.valid) {
    await logActivity({ organizationId: c.org, action: 'audit.tamper_detected', entityType: 'AuditSeal', module: 'audit_log', severity: 'critical', summary: `${v.problems.length} integrity problem(s): ${v.problems.slice(0, 3).map((p) => p.day).join(', ')}` });
    await r(c, uniq([...ids(await usersWithModule(c.org, 'audit_log')), ...ids(await User.find({ organizationId: c.org, isActive: true, role: { $in: ['super_admin', 'ceo'] } }))]), `tamper:${ymd()}`, 'AUDIT LOG INTEGRITY FAILURE', `${v.problems.length} sealed day(s) no longer match their recorded digest. Entries may have been altered or deleted. Investigate immediately.`, '/audit', 'security', 'critical');
  }
  return sealed;
}

/** Monday digest to people who hold the Reports module: the scorecard in one e-mail. */
async function weeklyDigest(c: Ctx) {
  if (new Date().getUTCDay() !== 1) return;
  const def = REPORT_MAP.get('security_scorecard')!;
  const res = await def.run({ orgId: c.org, params: {} });
  const bad = res.rows.filter((x) => x.status !== 'On target');
  const body = `Overall score ${res.summary?.[0]?.[1]} — ${bad.length} item(s) need attention${bad.length ? `: ${bad.slice(0, 6).map((x) => `${x.metric} (${x.value})`).join('; ')}` : '.'}`;
  const users = await usersWithModule(c.org, 'reports');
  const html = `<p>${esc(body)}</p>` + dataTable(['Area', 'Metric', 'Current', 'Target', 'Status'], res.rows.map((x) => [esc(x.area), esc(x.metric), esc(x.value), esc(x.target), esc(x.status)]));
  await notify({ organizationId: c.org, userIds: ids(users), title: `Weekly security & compliance digest — ${res.summary?.[0]?.[1]}`, body, link: '/reports?report=security_scorecard', type: 'report', severity: bad.some((x) => x.status === 'ACTION REQUIRED') ? 'high' : 'info', dedupeKey: `digest:${isoWeek()}`, email: { intro: 'Your weekly summary of security, ISMS and data-protection controls.', bodyHtml: html, ctaLabel: 'Open scorecard' } });
}

export async function runRemindersForOrg(orgId: string) {
  const ctx: Ctx = { org: orgId, sent: 0 };
  const steps: Array<[string, (c: Ctx) => Promise<any>]> = [['certifications', certifications], ['obligations', obligations], ['invoices', invoices], ['expenses', expenses], ['assets', assets], ['controls', async (c: Ctx) => { c.sent += await controlsReminders(c.org); }], ['incidents', incidents], ['dsars', dsars], ['policies', policies], ['access', accessHygiene], ['taxes', taxes], ['integrity', integrity], ['work', async (c: Ctx) => { c.sent += await workRemindersRun(c.org); }], ['digest', weeklyDigest]];
  for (const [name, fn] of steps) { try { await fn(ctx); } catch (err) { logger.error({ err, step: name, orgId }, 'reminder step failed'); } }
  return ctx.sent;
}

export async function runAllReminders() {
  const orgs = await Organization.find().select('_id');
  let sent = 0;
  for (const o of orgs) sent += await runRemindersForOrg(String(o._id));
  const reports = await runDueSchedules().catch((err) => { logger.error({ err }, 'schedules failed'); return 0; });
  logger.info({ orgs: orgs.length, sent, scheduledReports: reports }, 'reminder run complete');
  return { sent, scheduledReports: reports };
}

/** Items that are urgent right now for one person — drives the Reminders page and the dashboard badge. */
export async function remindersFor(user: { id: string; organizationId: string; role: string; modules: string[] }) {
  const out: Array<{ type: string; severity: Sev; title: string; detail?: string; due?: Date | null; link: string }> = [];
  const has = (...m: string[]) => user.role === 'super_admin' || m.some((x) => user.modules.includes(x));
  const org = user.organizationId, now = new Date();
  const [certs, me, pols, acks, myClaims, myAssets, myNotes] = await Promise.all([
    Certification.find({ organizationId: org, employeeId: user.id, isDeleted: { $ne: true }, expiryDate: { $lt: new Date(Date.now() + 90 * DAY) } }),
    User.findById(user.id).select('mfaEnabled passwordChangedAt mustChangePassword'),
    Policy.find({ organizationId: org, isDeleted: { $ne: true }, status: 'approved', requiresAcknowledgement: true, $or: [{ audienceRoles: { $size: 0 } }, { audienceRoles: user.role }] }),
    PolicyAcknowledgement.find({ userId: user.id }),
    ExpenseClaim.find({ organizationId: org, submittedById: user.id, isDeleted: { $ne: true }, status: { $in: ['draft', 'rejected', 'approved'] } }),
    Asset.find({ organizationId: org, assignedToId: user.id, isDeleted: { $ne: true } }).select('assetId title nextReviewDate'),
    Notification.countDocuments({ userId: user.id, isRead: false, severity: { $in: ['high', 'critical'] } }),
  ]);
  for (const x of certs) out.push({ type: 'certification', severity: x.expiryDate! < now ? 'high' : 'warning', title: `${x.name} ${x.expiryDate! < now ? 'has expired' : 'expires soon'}`, due: x.expiryDate, link: '/certifications' });
  if (me && !me.mfaEnabled) out.push({ type: 'security', severity: 'warning', title: 'Turn on multi-factor authentication', link: '/settings' });
  if (me?.passwordChangedAt) { const left = Math.ceil(env.passwordMaxAgeDays - (Date.now() - me.passwordChangedAt.getTime()) / DAY); if (left <= 14) out.push({ type: 'security', severity: left <= 3 ? 'high' : 'warning', title: left < 0 ? 'Your password has expired' : `Your password expires in ${left} day(s)`, link: '/settings' }); }
  for (const p of pols) if (!acks.some((a) => String(a.policyId) === String(p._id) && a.version === p.version)) out.push({ type: 'policy', severity: 'warning', title: `Acknowledge policy: ${p.title}`, detail: `v${p.version}`, link: '/policies' });
  for (const c of myClaims) out.push({ type: 'expense', severity: c.status === 'rejected' ? 'high' : 'info', title: c.status === 'draft' ? `Submit your expense draft: ${c.title}` : c.status === 'rejected' ? `Expense claim rejected: ${c.title}` : `Approved, awaiting payment: ${c.title}`, link: `/expenses?claim=${c._id}` });
  for (const a of myAssets as any[]) if (a.nextReviewDate && a.nextReviewDate < new Date(Date.now() + 30 * DAY)) out.push({ type: 'asset', severity: 'info', title: `Confirm you still hold: ${a.title}`, detail: a.assetId, due: a.nextReviewDate, link: '/assets' });
  if (has('compliance')) for (const o of await Obligation.find({ organizationId: org, isDeleted: { $ne: true }, status: 'active', nextDueAt: { $lt: new Date(Date.now() + 14 * DAY) } })) out.push({ type: 'compliance', severity: o.nextDueAt < now ? 'critical' : 'warning', title: `${o.nextDueAt < now ? 'OVERDUE' : 'Due'}: ${o.title}`, due: o.nextDueAt, link: '/compliance' });
  if (has('invoices')) { const n = await Invoice.countDocuments({ organizationId: org, isDeleted: { $ne: true }, status: { $in: ['sent', 'partially_paid'] }, dueDate: { $lt: now } }); if (n) out.push({ type: 'finance', severity: 'warning', title: `${n} overdue invoice(s)`, link: '/invoices?overdue=true' }); const p = await Invoice.countDocuments({ organizationId: org, isDeleted: { $ne: true }, status: 'pending_approval' }); if (p) out.push({ type: 'finance', severity: 'info', title: `${p} invoice(s) awaiting approval`, link: '/invoices?status=pending_approval' }); }
  if (has('expense_approvals')) { const n = await ExpenseClaim.countDocuments({ organizationId: org, isDeleted: { $ne: true }, status: { $in: ['submitted', 'partially_approved'] }, submittedById: { $ne: user.id } }); if (n) out.push({ type: 'expense', severity: 'warning', title: `${n} expense claim(s) awaiting your decision`, link: '/expenses?status=submitted' }); const m = await ExpenseClaim.countDocuments({ organizationId: org, isDeleted: { $ne: true }, status: 'approved' }); if (m) out.push({ type: 'expense', severity: 'info', title: `${m} approved claim(s) awaiting payment`, link: '/expenses?status=approved' }); }
  if (has('incidents')) for (const i of await Incident.find({ organizationId: org, isDeleted: { $ne: true }, status: { $ne: 'closed' }, $or: [{ severity: { $in: ['high', 'critical'] } }, { isPersonalDataBreach: true }] })) out.push({ type: 'incident', severity: i.isPersonalDataBreach && i.breach?.regulatorDeadline && !i.breach.regulatorNotified ? 'critical' : 'high', title: `${i.reference}: ${i.title}`, detail: i.isPersonalDataBreach && !i.breach?.regulatorNotified && i.breach?.regulatorDeadline ? `Regulator deadline ${i.breach.regulatorDeadline.toUTCString()}` : i.status, due: i.breach?.regulatorDeadline, link: `/incidents?incident=${i._id}` });
  if (has('data_protection')) for (const d of await DataSubjectRequest.find({ organizationId: org, isDeleted: { $ne: true }, status: { $nin: ['completed', 'rejected'] }, dueAt: { $lt: new Date(Date.now() + 10 * DAY) } })) out.push({ type: 'dsar', severity: d.dueAt < now ? 'critical' : 'warning', title: `${d.dueAt < now ? 'OVERDUE ' : ''}${d.type} request ${d.reference}`, due: d.dueAt, link: '/privacy' });
  if (has('assets')) { const n = await Asset.countDocuments({ organizationId: org, isDeleted: { $ne: true }, lifecycleStatus: { $in: ['active', 'under_maintenance'] }, nextReviewDate: { $lt: now } }); if (n) out.push({ type: 'asset', severity: 'warning', title: `${n} asset review(s) overdue`, link: '/assets?review=due' }); }
  if (has('access_control')) for (const a of await AccessReview.find({ organizationId: org, isDeleted: { $ne: true }, status: 'open' })) out.push({ type: 'access', severity: a.dueDate && a.dueDate < now ? 'high' : 'warning', title: `Access review ${a.reference} in progress`, due: a.dueDate, link: '/access' });
  out.push(...(await controlsFor(user).catch(() => [])));
  out.push(...(await workFor(user).catch(() => [])));
  const rank: Record<Sev, number> = { critical: 0, high: 1, warning: 2, info: 3 };
  out.sort((a, b) => rank[a.severity] - rank[b.severity] || (a.due?.getTime() || Infinity) - (b.due?.getTime() || Infinity));
  return { items: out, counts: { total: out.length, critical: out.filter((x) => x.severity === 'critical').length, high: out.filter((x) => x.severity === 'high').length }, unreadUrgent: myNotes };
}
