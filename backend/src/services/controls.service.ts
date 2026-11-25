import { ControlTask } from '../models/Controls';
import { User } from '../models/User';
import { notify } from './notify.service';
import { usersWithModule } from './access.service';
import { fmtDate, esc } from './mail.templates';
import { EXTERNAL_ROLES } from '../config/roles';
import { logger } from '../utils/logger';

const DAY = 86400000;
const ymd = (d: Date) => d.toISOString().slice(0, 10);
export const daysUntil = (d: Date) => Math.ceil((d.getTime() - Date.now()) / DAY);

interface Def {
  key: string; title: string; description: string; category: any; isoRef?: string; policyRef?: string;
  frequencyDays: number; ownerPref: any; firstDueInDays: number; checklist: string[]; requireEvidence?: boolean; link?: string; leadDays?: number[];
}

/**
 * Built-in recurring controls, seeded for every organisation. Frequencies are DEFAULTS — the risk manager / CEO / anyone with the
 * Compliance module can change any of them (e.g. risk assessment every 6 months instead of yearly) on the Controls page.
 */
export const BUILTIN_CONTROLS: Def[] = [
  { key: 'wifi_password', title: 'Change the office Wi-Fi password', category: 'Passwords & Access', isoRef: 'A.5.17 · A.8.20', policyRef: 'Password Policy', frequencyDays: 90, ownerPref: 'it', firstDueInDays: 14, link: '/controls',
    description: 'Rotate the staff and guest Wi-Fi pre-shared keys every 90 days (and immediately when someone with the key leaves).',
    checklist: ['Generate a new passphrase (16+ characters, random)', 'Update staff SSID and separate guest SSID', 'Communicate the new key through the approved channel only (never e-mail in clear)', 'Re-connect printers, IoT and shared devices', 'Remove old key from the password vault and store the new one'] },
  { key: 'router_password', title: 'Change router / firewall admin passwords', category: 'Passwords & Access', isoRef: 'A.8.2 · A.8.9', policyRef: 'Password Policy', frequencyDays: 90, ownerPref: 'it', firstDueInDays: 14, requireEvidence: false,
    description: 'Rotate admin credentials on routers, switches, access points and firewalls. Default credentials must never remain in use.',
    checklist: ['Change admin password on every network device', 'Confirm remote/WAN management is disabled or restricted', 'Check firmware is current', 'Back up the device configuration', 'Record the change in the password vault'] },
  { key: 'laptop_passwords', title: 'Rotate laptop / workstation passwords', category: 'Passwords & Access', isoRef: 'A.5.17 · A.8.1', policyRef: 'Password Policy', frequencyDays: 90, ownerPref: 'it', firstDueInDays: 14,
    description: 'Staff change their device sign-in passwords every 90 days; IT also rotates local administrator passwords and checks disk encryption.',
    checklist: ['Local administrator passwords rotated (LAPS or vault)', 'Staff reminded to change their device password', 'Full-disk encryption verified on all laptops', 'Screen-lock timeout verified (≤ 10 minutes)', 'Lost/unassigned laptops disabled'] },
  { key: 'shared_accounts', title: 'Rotate shared & service-account passwords', category: 'Passwords & Access', isoRef: 'A.5.16 · A.5.17', policyRef: 'Access Control Policy', frequencyDays: 90, ownerPref: 'it', firstDueInDays: 21,
    description: 'Shared mailboxes, social media, SaaS admin and service accounts are rotated and their owners confirmed.',
    checklist: ['List shared/service accounts', 'Rotate each credential', 'Confirm a named owner for each', 'Enforce MFA wherever supported'] },
  { key: 'risk_assessment', title: 'Carry out the information-security risk assessment', category: 'Risk', isoRef: 'Cl. 6.1.2 · 8.2', policyRef: 'Risk Management Policy', frequencyDays: 365, ownerPref: 'risk_manager', firstDueInDays: 30, requireEvidence: true, link: '/risks', leadDays: [60, 30, 14, 7, 3, 1],
    description: 'Re-assess information-security risks against the risk criteria, update the risk register and treatment plan. Yearly by default — the risk manager can set any period. Falls to IT, then the CEO, if there is no risk manager.',
    checklist: ['Review assets and threats since the last assessment', 'Re-score severity and impact for each risk', 'Add new risks; close treated ones', 'Update the risk treatment plan and Statement of Applicability', 'Present results to management and record approval'] },
  { key: 'risk_treatment_review', title: 'Review the risk treatment plan', category: 'Risk', isoRef: 'Cl. 6.1.3 · 8.3', policyRef: 'Risk Management Policy', frequencyDays: 90, ownerPref: 'risk_manager', firstDueInDays: 30, link: '/risks',
    description: 'Check that treatments are on track and residual risk is still within appetite.',
    checklist: ['Open treatments checked against due dates', 'Residual risk re-rated', 'Escalations raised to management'] },
  { key: 'access_review', title: 'User access review', category: 'Passwords & Access', isoRef: 'A.5.18', policyRef: 'Access Control Policy', frequencyDays: 90, ownerPref: 'it', firstDueInDays: 30, link: '/access',
    description: 'Confirm every account and privilege is still needed; remove leavers and dormant accounts.',
    checklist: ['Export users and modules', 'Managers confirm each person’s access', 'Disable dormant and leaver accounts', 'Check privileged/admin roles'] },
  { key: 'backup_restore_test', title: 'Backup restore test', category: 'Continuity & Backup', isoRef: 'A.8.13', policyRef: 'Backup Policy', frequencyDays: 90, ownerPref: 'it', firstDueInDays: 45, requireEvidence: true,
    description: 'A backup that has never been restored is a hope, not a control. Restore a sample and record how long it took.',
    checklist: ['Pick a random system and date', 'Restore to an isolated location', 'Verify data integrity', 'Record restore time vs. RTO/RPO'] },
  { key: 'bcp_dr_test', title: 'Business continuity / disaster-recovery exercise', category: 'Continuity & Backup', isoRef: 'A.5.29 · A.5.30', policyRef: 'Business Continuity Plan', frequencyDays: 365, ownerPref: 'ceo', firstDueInDays: 90, requireEvidence: true, leadDays: [30, 14, 7, 1],
    description: 'Run a tabletop or technical exercise of the continuity and DR plans; record lessons learned.',
    checklist: ['Choose a scenario', 'Run the exercise with named roles', 'Record gaps and actions', 'Update the plan'] },
  { key: 'vuln_patch_review', title: 'Vulnerability scan & patch review', category: 'Technical', isoRef: 'A.8.8', policyRef: 'Vulnerability Management Policy', frequencyDays: 30, ownerPref: 'it', firstDueInDays: 14, leadDays: [7, 3, 1],
    description: 'Scan internet-facing and internal systems, apply critical patches and record exceptions.',
    checklist: ['Run authenticated vulnerability scan', 'Patch critical/high items within policy SLAs', 'Document accepted exceptions'] },
  { key: 'policy_review', title: 'Review & re-approve information-security policies', category: 'Governance', isoRef: 'A.5.1 · Cl. 5.2', policyRef: 'ISMS Policy', frequencyDays: 365, ownerPref: 'ceo', firstDueInDays: 60, link: '/policies', leadDays: [30, 14, 7, 1],
    description: 'Policies must be reviewed at planned intervals or when significant changes occur.',
    checklist: ['Review each policy with its owner', 'Publish new versions', 'Collect staff acknowledgements'] },
  { key: 'internal_audit', title: 'Internal ISMS audit', category: 'Governance', isoRef: 'Cl. 9.2', policyRef: 'Internal Audit Procedure', frequencyDays: 365, ownerPref: 'risk_manager', firstDueInDays: 120, requireEvidence: true, leadDays: [60, 30, 14, 7],
    description: 'Audit the ISMS against ISO 27001 and your own policies; report findings and corrective actions.',
    checklist: ['Agree audit plan and scope', 'Audit evidence for each clause/control', 'Raise nonconformities', 'Report to management'] },
  { key: 'management_review', title: 'Management review of the ISMS', category: 'Governance', isoRef: 'Cl. 9.3', policyRef: 'ISMS Policy', frequencyDays: 365, ownerPref: 'ceo', firstDueInDays: 150, requireEvidence: true, leadDays: [60, 30, 14, 7],
    description: 'Top management reviews ISMS performance, audit results, risks and improvement opportunities. Use the Security & compliance scorecard report as the input pack.',
    checklist: ['Compile scorecard and audit results', 'Hold the review meeting', 'Minute decisions and actions'] },
  { key: 'security_awareness', title: 'Security awareness training & phishing test', category: 'People', isoRef: 'A.6.3', policyRef: 'Acceptable Use Policy', frequencyDays: 365, ownerPref: 'hr', firstDueInDays: 60, link: '/courses',
    description: 'Every employee completes awareness training; run a phishing simulation and follow up with those who click.',
    checklist: ['Assign the awareness course to all staff', 'Run phishing simulation', 'Follow up with non-completers'] },
  { key: 'supplier_review', title: 'Review critical suppliers & their security', category: 'Suppliers', isoRef: 'A.5.19 – A.5.22', policyRef: 'Supplier Security Policy', frequencyDays: 365, ownerPref: 'finance', firstDueInDays: 90, link: '/vendors',
    description: 'Re-check contracts, security obligations and certificates of suppliers that handle company data.',
    checklist: ['List suppliers with data access', 'Collect updated certificates/questionnaires', 'Record issues and decisions'] },
  { key: 'ropa_dpia_review', title: 'Review the processing register & DPIAs', category: 'Data Protection', isoRef: 'NDPA 2023 · GDPR Art. 30/35', policyRef: 'Data Protection Policy', frequencyDays: 180, ownerPref: 'dpo', firstDueInDays: 45, link: '/privacy',
    description: 'Confirm the record of processing is accurate and high-risk processing has a completed DPIA.',
    checklist: ['Check each processing activity is current', 'Confirm lawful basis and retention', 'Complete outstanding DPIAs'] },
  { key: 'asset_register_review', title: 'Asset register review', category: 'Technical', isoRef: 'A.5.9 · A.5.11', policyRef: 'Asset Management Policy', frequencyDays: 180, ownerPref: 'it', firstDueInDays: 45, link: '/assets',
    description: 'Reconcile the asset register with what physically exists; confirm owners and classification.',
    checklist: ['Physical spot-check', 'Owners confirm their assets', 'Retire or dispose of unused assets'] },
  { key: 'physical_security', title: 'Physical security & clear-desk walkthrough', category: 'Technical', isoRef: 'A.7.1 – A.7.8', policyRef: 'Physical Security Policy', frequencyDays: 90, ownerPref: 'it', firstDueInDays: 30,
    description: 'Check access to the office, server/network cabinet, visitor log, CCTV and clear-desk compliance.',
    checklist: ['Door/access control and visitor log', 'Network cabinet locked', 'CCTV working', 'Clear desk / screen check'] },
  { key: 'cert_expiry_review', title: 'Review domain, SSL and licence expiries', category: 'Technical', isoRef: 'A.8.8 · A.5.9', frequencyDays: 90, ownerPref: 'it', firstDueInDays: 30,
    description: 'Domains, TLS certificates and software licences expiring in the next 120 days are renewed.',
    checklist: ['List domains and certificates', 'Renew those expiring within 120 days', 'Enable auto-renew where possible'] },
];

/* ------------------------------ owner resolution --------------------------- */
const IT_DEPTS = ['IT & Governance', 'Cybersecurity', 'Cloud & Infrastructure'];
const IT_TITLE = /\b(it|i\.t\.|infosec|information security|security|governance|infrastructure|systems?|network|devops|sysadmin|cloud)\b/i;
const RISK_TITLE = /\brisk\b/i;

type U = { _id: any; name: string; email: string; role: string; jobTitle?: string; department?: string };
async function staff(orgId: string): Promise<U[]> {
  return (await User.find({ organizationId: orgId, isActive: true, loginEnabled: { $ne: false }, employmentStatus: { $ne: 'offboarded' }, role: { $nin: EXTERNAL_ROLES as unknown as string[] } }).select('name email role jobTitle department')) as any;
}

/**
 * Who a control lands on, in order of preference:
 *   risk_manager → anyone titled/in Risk → anyone in IT / Governance → CEO → super admin
 *   it           → anyone in IT / Governance / Cybersecurity → CEO → super admin
 *   ceo / hr / finance / dpo → that role (dpo = Data-Protection module holder / title) → CEO → super admin
 * An explicit ownerId always wins (if that person is still active).
 */
export async function resolveOwners(orgId: string, t: { ownerId?: any; ownerPref?: string; deputyIds?: any[] }, people?: U[]): Promise<{ owners: U[]; via: string }> {
  const all = people || (await staff(orgId));
  const byId = new Map(all.map((u) => [String(u._id), u]));
  if (t.ownerId && byId.has(String(t.ownerId))) return { owners: [byId.get(String(t.ownerId))!], via: 'named owner' };
  const ceo = all.filter((u) => u.role === 'ceo');
  const admins = all.filter((u) => u.role === 'super_admin');
  const it = all.filter((u) => (u.department && IT_DEPTS.includes(u.department)) || (u.jobTitle && IT_TITLE.test(u.jobTitle)));
  const risk = all.filter((u) => (u.jobTitle && RISK_TITLE.test(u.jobTitle)) || u.department === 'Risk & Compliance');
  let chain: Array<[string, U[]]>;
  switch (t.ownerPref) {
    case 'risk_manager': chain = [['risk manager', risk], ['IT / governance', it], ['CEO', ceo]]; break;
    case 'ceo': chain = [['CEO', ceo]]; break;
    case 'hr': chain = [['HR', all.filter((u) => u.role === 'hr' || u.department === 'HR')], ['CEO', ceo]]; break;
    case 'finance': chain = [['finance', all.filter((u) => u.role === 'finance' || u.department === 'Finance')], ['CEO', ceo]]; break;
    case 'dpo': { const dpo = new Set((await usersWithModule(orgId, 'data_protection')).map((u) => String(u._id))); chain = [['data-protection officer', all.filter((u) => dpo.has(String(u._id)) && (/dpo|data protection|privacy/i.test(u.jobTitle || '') || u.role !== 'super_admin'))], ['CEO', ceo]]; break; }
    default: chain = [['IT / governance', it], ['CEO', ceo]];
  }
  chain.push(['administrator', admins]);
  for (const [via, list] of chain) if (list.length) return { owners: list, via };
  return { owners: [], via: 'nobody' };
}

/* --------------------------------- seeding --------------------------------- */
export async function ensureBuiltInControls(orgId: string) {
  const existing = new Set((await ControlTask.find({ organizationId: orgId, builtIn: true }).select('key').lean()).map((x: any) => x.key));
  const missing = BUILTIN_CONTROLS.filter((d) => !existing.has(d.key));
  if (!missing.length) return 0;
  await ControlTask.insertMany(missing.map((d) => ({
    organizationId: orgId, key: d.key, title: d.title, description: d.description, category: d.category, isoRef: d.isoRef, policyRef: d.policyRef, builtIn: true,
    frequencyDays: d.frequencyDays, ownerPref: d.ownerPref, leadDays: d.leadDays || [14, 7, 3, 1], checklist: d.checklist, requireEvidence: !!d.requireEvidence, link: d.link || '/controls',
    nextDueAt: new Date(Date.now() + d.firstDueInDays * DAY),
  })), { ordered: false }).catch(() => undefined);
  return missing.length;
}

export function nextDueAfter(completedAt: Date, frequencyDays: number) {
  return new Date(completedAt.getTime() + frequencyDays * DAY);
}

export function controlState(t: { nextDueAt: Date; status: string }) {
  if (t.status === 'paused') return 'paused';
  const left = daysUntil(t.nextDueAt);
  return left < 0 ? 'overdue' : left <= 14 ? 'due_soon' : 'on_track';
}

/* --------------------------------- reminders ------------------------------- */
/** Called from the daily reminder run. Owners get lead-time nudges; overdue controls escalate to the CEO and compliance managers. */
export async function controlsReminders(orgId: string): Promise<number> {
  await ensureBuiltInControls(orgId);
  const people = await staff(orgId);
  const tasks = await ControlTask.find({ organizationId: orgId, isDeleted: { $ne: true }, status: 'active', nextDueAt: { $lt: new Date(Date.now() + 91 * DAY) } });
  const mgr = (await usersWithModule(orgId, 'compliance')).map((u) => String(u._id));
  const ceo = people.filter((u) => u.role === 'ceo').map((u) => String(u._id));
  let sent = 0;
  for (const t of tasks as any[]) {
    try {
      const left = daysUntil(t.nextDueAt);
      const { owners, via } = await resolveOwners(orgId, t, people);
      const to = Array.from(new Set([...owners.map((o) => String(o._id)), ...(t.deputyIds || []).map(String)]));
      const list = `<ul style="margin:8px 0 0 18px;padding:0">${(t.checklist || []).map((c: string) => `<li>${esc(c)}</li>`).join('')}</ul>`;
      const meta = `${t.policyRef ? `Policy: ${t.policyRef}. ` : ''}${t.isoRef ? `Reference: ${t.isoRef}. ` : ''}Assigned to you as ${via}.`;
      if (left < 0) {
        // overdue: owner every 3 days, CEO + compliance after 7 days, weekly thereafter
        const late = -left;
        const slot = Math.floor(late / 3);
        sent += await notify({ organizationId: orgId, userIds: to, title: `OVERDUE: ${t.title}`, body: `Was due ${fmtDate(t.nextDueAt)} (${late} day(s) ago). Complete it and log it on the Controls page.`, link: '/controls', type: 'compliance', severity: late > 14 ? 'critical' : 'high', dedupeKey: `ctl-late:${t._id}:${ymd(t.nextDueAt)}:${slot}`, email: { intro: `${esc(t.title)} was due ${fmtDate(t.nextDueAt)}. ${esc(meta)}`, bodyHtml: list, ctaLabel: 'Open Controls' } });
        if (late >= 7) sent += await notify({ organizationId: orgId, userIds: Array.from(new Set([...ceo, ...mgr])).filter((id) => !to.includes(id)), title: `Control overdue ${late}d: ${t.title}`, body: `${owners.map((o) => o.name).join(', ') || 'No owner'} (${via}) has not completed it.`, link: '/controls', type: 'compliance', severity: 'high', dedupeKey: `ctl-esc:${t._id}:${ymd(t.nextDueAt)}:${Math.floor(late / 7)}`, email: { intro: `${esc(t.title)} is ${late} days overdue.` } });
      } else {
        const step = (t.leadDays?.length ? t.leadDays : [14, 7, 3, 1]).slice().sort((a: number, b: number) => a - b).find((d: number) => left <= d);
        if (step === undefined) continue;
        sent += await notify({ organizationId: orgId, userIds: to, title: left === 0 ? `Due today: ${t.title}` : `Due in ${left} day(s): ${t.title}`, body: `${t.description || ''} Due ${fmtDate(t.nextDueAt)}.`.trim(), link: '/controls', type: 'compliance', severity: left <= 3 ? 'high' : 'warning', dedupeKey: `ctl:${t._id}:${ymd(t.nextDueAt)}:${step}`, email: { intro: `${esc(t.title)} is due ${fmtDate(t.nextDueAt)}. ${esc(meta)}`, bodyHtml: `<p style="margin:0 0 6px"><b>Checklist</b></p>${list}`, ctaLabel: 'Open Controls' } });
      }
    } catch (err) { logger.error({ err, control: t.key }, 'control reminder failed'); }
  }
  // nobody to receive a control → tell the CEO/admin once a week
  const orphans = [];
  for (const t of tasks as any[]) if (!(await resolveOwners(orgId, t, people)).owners.length) orphans.push(t.title);
  if (orphans.length) sent += await notify({ organizationId: orgId, userIds: mgr, title: `${orphans.length} control(s) have no owner`, body: orphans.slice(0, 6).join('; '), link: '/controls', type: 'compliance', severity: 'warning', dedupeKey: `ctl-orphan:${orgId}:${new Date().getUTCFullYear()}-${Math.floor(Date.now() / (7 * DAY))}` });
  return sent;
}

/** Items that appear on one person's Reminders page. */
export async function controlsFor(user: { id: string; organizationId: string; role: string; modules: string[] }) {
  const org = user.organizationId;
  const tasks = await ControlTask.find({ organizationId: org, isDeleted: { $ne: true }, status: 'active', nextDueAt: { $lt: new Date(Date.now() + 31 * DAY) } });
  if (!tasks.length) return [];
  const people = await staff(org);
  const manager = user.role === 'super_admin' || user.modules.includes('compliance');
  const out: Array<{ type: string; severity: 'info' | 'warning' | 'high' | 'critical'; title: string; detail?: string; due?: Date | null; link: string }> = [];
  for (const t of tasks as any[]) {
    const { owners } = await resolveOwners(org, t, people);
    const mine = owners.some((o) => String(o._id) === user.id) || (t.deputyIds || []).some((d: any) => String(d) === user.id);
    const late = t.nextDueAt < new Date();
    if (!mine && !(manager && late)) continue;
    out.push({ type: 'control', severity: late ? 'high' : daysUntil(t.nextDueAt) <= 7 ? 'warning' : 'info', title: `${late ? 'Overdue' : 'Due'}: ${t.title}`, detail: mine ? t.policyRef : `Owner: ${owners.map((o) => o.name).join(', ') || 'none'}`, due: t.nextDueAt, link: '/controls' });
  }
  return out;
}

export async function controlsSummaryRows(orgId: string) {
  await ensureBuiltInControls(orgId);
  const tasks = await ControlTask.find({ organizationId: orgId, isDeleted: { $ne: true } }).sort('nextDueAt');
  const people = await staff(orgId);
  const rows = [];
  for (const t of tasks as any[]) {
    const { owners, via } = await resolveOwners(orgId, t, people);
    rows.push({ control: t.title, category: t.category, reference: t.isoRef || '', frequencyDays: t.frequencyDays, owner: owners.map((o) => o.name).join(', ') || '— none —', assignedVia: via, lastDone: t.lastCompletedAt ? fmtDate(t.lastCompletedAt) : 'never', nextDue: fmtDate(t.nextDueAt), state: controlState(t) });
  }
  return rows;
}
