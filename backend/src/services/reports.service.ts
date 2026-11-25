import mongoose from 'mongoose';
import { User } from '../models/User';
import { Certification } from '../models/Certification';
import { Enrollment } from '../models/Enrollment';
import { Asset } from '../models/Asset';
import { Invoice, TaxRecord, BankAccount, round2 } from '../models/Finance';
import { ExpenseClaim } from '../models/Expense';
import { Incident, DataSubjectRequest, ProcessingActivity, Policy, PolicyAcknowledgement, Obligation, AccessReview } from '../models/Governance';
import { ActivityLog } from '../models/ActivityLog';
import { UserSession } from '../models/Access';
import { Risk } from '../models/Risk';
import { ComplianceItem } from '../models/ComplianceItem';
import { effectiveModules } from './access.service';
import { verifySeals } from './audit.service';
import { MODULES } from '../config/modules';
import { EXTERNAL_ROLES } from '../config/roles';
import { env } from '../config/env';
import { controlsSummaryRows } from './controls.service';
import { workSummary } from './workReports.service';
import { Goal } from '../models/Goal';
import { Meeting } from '../models/Meeting';

export interface Column { key: string; label: string }
export interface ReportResult { columns: Column[]; rows: Array<Record<string, any>>; summary?: Array<[string, string | number]>; note?: string }
export interface ReportCtx { orgId: string; params: Record<string, any>; user?: { id: string; name: string; role: string } }
export interface ReportDef {
  key: string; title: string; category: 'Security & Access' | 'ISMS' | 'Data Protection' | 'People' | 'Finance' | 'Executive' | 'Work & Delivery';
  module: string | string[]; description: string; standard?: string;
  params?: Array<'from' | 'to' | 'days' | 'year' | 'month' | 'quarter'>;
  run: (c: ReportCtx) => Promise<ReportResult>;
}

const STAFF_FILTER = { role: { $nin: EXTERNAL_ROLES as unknown as string[] }, isActive: true };
const D = (x?: any) => (x ? new Date(x).toISOString().slice(0, 10) : '');
const oid = (s: string) => new mongoose.Types.ObjectId(s);
const days = (a: any, b: any = new Date()) => Math.floor((new Date(b).getTime() - new Date(a).getTime()) / 86400000);
const cols = (...pairs: string[][]): Column[] => pairs.map(([key, label]) => ({ key, label }));
const num = (v: any, d: number) => (Number.isFinite(Number(v)) && Number(v) > 0 ? Number(v) : d);
const range = (p: Record<string, any>, defaultDays = 30) => {
  const to = p.to ? new Date(`${p.to}T23:59:59.999Z`) : new Date();
  const from = p.from ? new Date(p.from) : new Date(to.getTime() - num(p.days, defaultDays) * 86400000);
  return { from, to };
};
const pct = (a: number, b: number) => (b ? Math.round((a / b) * 100) : 100);
const live = (f: Record<string, any>) => ({ isDeleted: { $ne: true }, ...f });
const naira = (n: number) => `₦${round2(n).toLocaleString('en-GB')}`;

async function staffWithModules(orgId: string) {
  const users = await User.find({ organizationId: orgId, ...STAFF_FILTER }).select('name email role department jobTitle mfaEnabled lastLoginAt loginEnabled moduleGrant moduleDeny passwordChangedAt employeeNo organizationId createdAt').sort('name');
  const out = [];
  for (const u of users) out.push({ u, modules: await effectiveModules({ role: u.role, organizationId: orgId, moduleGrant: u.moduleGrant as string[], moduleDeny: u.moduleDeny as string[] }) });
  return out;
}

/* ============================== Security & access ========================== */
const R: ReportDef[] = [];

R.push({ key: 'mfa_coverage', title: 'Multi-factor authentication coverage', category: 'Security & Access', module: 'security', standard: 'ISO 27001 A.8.5', description: 'Who has MFA switched on — and who with a login still does not.',
  run: async ({ orgId }) => {
    const users = await User.find({ organizationId: orgId, ...STAFF_FILTER }).select('name email role department mfaEnabled loginEnabled lastLoginAt').sort({ mfaEnabled: 1, name: 1 });
    const withLogin = users.filter((u) => u.loginEnabled !== false);
    const on = withLogin.filter((u) => u.mfaEnabled).length;
    return { columns: cols(['name', 'Name'], ['email', 'Email'], ['role', 'Role'], ['department', 'Department'], ['mfa', 'MFA'], ['lastLogin', 'Last sign-in']), rows: withLogin.map((u) => ({ name: u.name, email: u.email, role: u.role, department: u.department, mfa: u.mfaEnabled ? 'Enabled' : 'NOT enabled', lastLogin: D(u.lastLoginAt) })),
      summary: [['Accounts with login', withLogin.length], ['MFA enabled', on], ['Coverage', `${pct(on, withLogin.length)}%`], ['Without MFA', withLogin.length - on]] };
  } });

R.push({ key: 'dormant_accounts', title: 'Dormant accounts', category: 'Security & Access', module: 'security', standard: 'A.5.18', description: 'Active logins that have not been used recently — candidates for disabling.', params: ['days'],
  run: async ({ orgId, params }) => {
    const n = num(params.days, env.dormantAccountDays);
    const cutoff = new Date(Date.now() - n * 86400000);
    const users = await User.find({ organizationId: orgId, ...STAFF_FILTER, loginEnabled: { $ne: false }, $or: [{ lastLoginAt: { $lt: cutoff } }, { lastLoginAt: { $exists: false } }, { lastLoginAt: null }] }).select('name email role department lastLoginAt createdAt').sort('lastLoginAt');
    return { columns: cols(['name', 'Name'], ['email', 'Email'], ['role', 'Role'], ['department', 'Department'], ['lastLogin', 'Last sign-in'], ['idle', 'Days idle']), rows: users.map((u) => ({ name: u.name, email: u.email, role: u.role, department: u.department, lastLogin: u.lastLoginAt ? D(u.lastLoginAt) : 'Never', idle: u.lastLoginAt ? days(u.lastLoginAt) : days((u as any).createdAt) })), summary: [['Threshold (days)', n], ['Dormant accounts', users.length]] };
  } });

R.push({ key: 'password_age', title: 'Password age & expiry', category: 'Security & Access', module: 'security', standard: 'A.5.17', description: 'Passwords older than the policy maximum and accounts forced to change.',
  run: async ({ orgId }) => {
    const users = await User.find({ organizationId: orgId, ...STAFF_FILTER, loginEnabled: { $ne: false } }).select('name email passwordChangedAt mustChangePassword').sort('passwordChangedAt');
    const rows = users.map((u) => { const age = u.passwordChangedAt ? days(u.passwordChangedAt) : null; return { name: u.name, email: u.email, changed: u.passwordChangedAt ? D(u.passwordChangedAt) : 'Never recorded', age: age ?? '', status: u.mustChangePassword ? 'Must change at next sign-in' : age === null ? 'Unknown' : age > env.passwordMaxAgeDays ? 'EXPIRED' : age > env.passwordMaxAgeDays - 14 ? 'Expires soon' : 'OK' }; });
    return { columns: cols(['name', 'Name'], ['email', 'Email'], ['changed', 'Last changed'], ['age', 'Age (days)'], ['status', 'Status']), rows, summary: [['Maximum age (days)', env.passwordMaxAgeDays], ['Expired / flagged', rows.filter((r) => r.status !== 'OK').length]] };
  } });

R.push({ key: 'privileged_access', title: 'Privileged & sensitive access', category: 'Security & Access', module: 'access_control', standard: 'A.8.2', description: 'Everyone who can reach sensitive modules (finance, employee data, audit, access control).',
  run: async ({ orgId }) => {
    const sensitive = MODULES.filter((m) => m.sensitive).map((m) => m.key);
    const rows = (await staffWithModules(orgId)).map(({ u, modules }) => ({ name: u.name, role: u.role, department: u.department, mfa: u.mfaEnabled ? 'Yes' : 'No', sensitive: modules.filter((m) => sensitive.includes(m)).join(', '), count: modules.filter((m) => sensitive.includes(m)).length, overrides: [...(u.moduleGrant || []).map((m) => `+${m}`), ...(u.moduleDeny || []).map((m) => `−${m}`)].join(' ') })).filter((r) => r.count > 0).sort((a, b) => b.count - a.count);
    return { columns: cols(['name', 'Name'], ['role', 'Role'], ['department', 'Department'], ['mfa', 'MFA'], ['count', '# sensitive'], ['sensitive', 'Sensitive modules'], ['overrides', 'Personal overrides']), rows, summary: [['People with sensitive access', rows.length], ['…without MFA', rows.filter((r) => r.mfa === 'No').length]] };
  } });

R.push({ key: 'access_matrix', title: 'User ↔ module access matrix', category: 'Security & Access', module: 'access_control', standard: 'A.5.15', description: 'Which modules each person can see, derived from role defaults and personal overrides.',
  run: async ({ orgId }) => {
    const rows = (await staffWithModules(orgId)).map(({ u, modules }) => ({ name: u.name, role: u.role, department: u.department, loginEnabled: u.loginEnabled === false ? 'No login' : 'Yes', count: modules.length, modules: modules.join(', ') }));
    return { columns: cols(['name', 'Name'], ['role', 'Role'], ['department', 'Department'], ['loginEnabled', 'Login'], ['count', '# modules'], ['modules', 'Modules']), rows };
  } });

R.push({ key: 'failed_logins', title: 'Failed sign-ins & lockouts', category: 'Security & Access', module: 'audit_log', standard: 'A.8.15', description: 'Failed authentication attempts grouped by account and source IP.', params: ['from', 'to', 'days'],
  run: async ({ orgId, params }) => {
    const { from, to } = range(params, 14);
    const rows = await ActivityLog.aggregate([{ $match: { organizationId: oid(orgId), createdAt: { $gte: from, $lte: to }, action: { $regex: /^auth\.(login_failed|account_locked|mfa_failed)/ } } }, { $group: { _id: { ip: '$ip', who: '$summary' }, n: { $sum: 1 }, last: { $max: '$createdAt' }, actions: { $addToSet: '$action' } } }, { $sort: { n: -1 } }, { $limit: 200 }]);
    return { columns: cols(['ip', 'Source IP'], ['detail', 'Detail'], ['attempts', 'Attempts'], ['events', 'Event types'], ['last', 'Last seen']), rows: rows.map((r) => ({ ip: r._id.ip, detail: r._id.who, attempts: r.n, events: r.actions.join(', '), last: r.last.toISOString().replace('T', ' ').slice(0, 16) })), summary: [['Window', `${D(from)} → ${D(to)}`], ['Total failures', rows.reduce((s, r) => s + r.n, 0)], ['Distinct sources', new Set(rows.map((r) => r._id.ip)).size]] };
  } });

R.push({ key: 'active_sessions', title: 'Active sessions', category: 'Security & Access', module: 'security', standard: 'A.8.5', description: 'Every device currently signed in.',
  run: async ({ orgId }) => {
    const rows = await UserSession.find({ organizationId: orgId, isActive: true, expiresAt: { $gt: new Date() } }).populate('userId', 'name email').sort('-lastSeenAt').limit(500);
    return { columns: cols(['user', 'User'], ['device', 'Device'], ['browser', 'Browser'], ['ip', 'IP'], ['started', 'Started'], ['lastSeen', 'Last active']), rows: rows.map((s: any) => ({ user: s.userId?.name, device: s.device, browser: s.browser, ip: s.ip, started: D(s.createdAt), lastSeen: s.lastSeenAt?.toISOString().replace('T', ' ').slice(0, 16) })), summary: [['Active sessions', rows.length]] };
  } });

R.push({ key: 'audit_high_severity', title: 'High-severity audit events', category: 'Security & Access', module: 'audit_log', standard: 'A.8.15', description: 'High and critical events: credential changes, role changes, exports, reveals, approvals.', params: ['from', 'to', 'days'],
  run: async ({ orgId, params }) => {
    const { from, to } = range(params, 30);
    const rows = await ActivityLog.find({ organizationId: orgId, severity: { $in: ['high', 'critical'] }, createdAt: { $gte: from, $lte: to } }).sort('-createdAt').limit(2000);
    return { columns: cols(['when', 'When'], ['severity', 'Severity'], ['actor', 'Who'], ['action', 'Action'], ['summary', 'Summary'], ['ip', 'IP']), rows: rows.map((r) => ({ when: r.createdAt.toISOString().replace('T', ' ').slice(0, 16), severity: r.severity, actor: r.actorName, action: r.action, summary: r.summary, ip: r.ip })), summary: [['Window', `${D(from)} → ${D(to)}`], ['Events', rows.length], ['Critical', rows.filter((r) => r.severity === 'critical').length]] };
  } });

R.push({ key: 'sensitive_data_access', title: 'Sensitive-data access log', category: 'Security & Access', module: 'audit_log', standard: 'A.5.34 / NDPA', description: 'Every time bank details were revealed, data exported or personal records were downloaded.', params: ['from', 'to', 'days'],
  run: async ({ orgId, params }) => {
    const { from, to } = range(params, 30);
    const rows = await ActivityLog.find({ organizationId: orgId, createdAt: { $gte: from, $lte: to }, action: { $regex: /(reveal|revealed|exported|data_exported|pdf_downloaded|account_changed)/ } }).sort('-createdAt').limit(2000);
    return { columns: cols(['when', 'When'], ['actor', 'Who'], ['action', 'Action'], ['summary', 'What'], ['ip', 'IP']), rows: rows.map((r) => ({ when: r.createdAt.toISOString().replace('T', ' ').slice(0, 16), actor: r.actorName, action: r.action, summary: r.summary, ip: r.ip })), summary: [['Events', rows.length], ['People involved', new Set(rows.map((r) => r.actorName)).size]] };
  } });

R.push({ key: 'access_reviews', title: 'Access review status', category: 'Security & Access', module: 'access_control', standard: 'A.5.18', description: 'Periodic user-access reviews: progress, decisions and overdue reviews.',
  run: async ({ orgId }) => {
    const reviews = await AccessReview.find(live({ organizationId: orgId })).populate('reviewerId', 'name').sort('-createdAt');
    return { columns: cols(['ref', 'Reference'], ['title', 'Title'], ['status', 'Status'], ['reviewer', 'Reviewer'], ['due', 'Due'], ['progress', 'Decided'], ['remove', 'Remove'], ['reduce', 'Reduce']), rows: reviews.map((r: any) => { const it = r.items as any[]; return { ref: r.reference, title: r.title, status: r.status === 'open' && r.dueDate && r.dueDate < new Date() ? 'OVERDUE' : r.status, reviewer: r.reviewerId?.name, due: D(r.dueDate), progress: `${it.filter((i) => i.decision !== 'pending').length}/${it.length}`, remove: it.filter((i) => i.decision === 'remove').length, reduce: it.filter((i) => i.decision === 'reduce').length }; }), summary: [['Reviews', reviews.length], ['Last completed', D(reviews.find((r) => r.status === 'completed')?.completedAt) || 'Never']] };
  } });

/* ===================================== ISMS ================================ */
R.push({ key: 'asset_register', title: 'Asset register (inventory)', category: 'ISMS', module: 'assets', standard: 'A.5.9', description: 'Full inventory of information and associated assets with owners, classification and criticality.',
  run: async ({ orgId }) => {
    const a = await Asset.find(live({ organizationId: orgId })).populate('assignedToId', 'name').sort('assetId');
    return { columns: cols(['id', 'Asset ID'], ['title', 'Title'], ['category', 'Category'], ['class', 'Classification'], ['crit', 'Criticality'], ['status', 'Lifecycle'], ['owner', 'Owner'], ['holder', 'Assigned to'], ['location', 'Location'], ['eol', 'End of life']), rows: a.map((x: any) => ({ id: x.assetId, title: x.title, category: x.category, class: x.classification, crit: x.criticality, status: x.lifecycleStatus, owner: x.owner, holder: x.assignedToId?.name, location: x.location, eol: D(x.endOfLifeDate) })), summary: [['Assets', a.length], ['Critical', a.filter((x) => x.criticality === 'Critical').length], ['Restricted/Confidential', a.filter((x) => ['Restricted', 'Confidential'].includes(x.classification as string)).length]] };
  } });

R.push({ key: 'assets_end_of_life', title: 'Assets at or near end of life', category: 'ISMS', module: 'assets', standard: 'A.7.14 / A.8.8', description: 'Expired and soon-to-expire assets, plus expiring licences and warranties.',
  run: async ({ orgId }) => {
    const in90 = new Date(Date.now() + 90 * 86400000);
    const a = await Asset.find(live({ organizationId: orgId, lifecycleStatus: { $in: ['active', 'under_maintenance'] }, $or: [{ eolState: { $in: ['approaching', 'expired'] } }, { licenseExpiryDate: { $lt: in90 } }, { warrantyExpiryDate: { $lt: in90 } }] })).sort('endOfLifeDate');
    return { columns: cols(['id', 'Asset ID'], ['title', 'Title'], ['crit', 'Criticality'], ['eolState', 'EOL state'], ['eol', 'End of life'], ['licence', 'Licence expiry'], ['warranty', 'Warranty expiry'], ['owner', 'Owner']), rows: a.map((x: any) => ({ id: x.assetId, title: x.title, crit: x.criticality, eolState: x.eolState, eol: D(x.endOfLifeDate), licence: D(x.licenseExpiryDate), warranty: D(x.warrantyExpiryDate), owner: x.owner })), summary: [['Expired', a.filter((x) => x.eolState === 'expired').length], ['Approaching (90d)', a.filter((x) => x.eolState === 'approaching').length]] };
  } });

R.push({ key: 'asset_reviews_due', title: 'Asset reviews due', category: 'ISMS', module: 'assets', standard: 'A.5.9', description: 'Assets whose scheduled review is overdue or due within 30 days.',
  run: async ({ orgId }) => {
    const a = await Asset.find(live({ organizationId: orgId, lifecycleStatus: { $in: ['active', 'under_maintenance'] }, nextReviewDate: { $lt: new Date(Date.now() + 30 * 86400000) } })).sort('nextReviewDate');
    return { columns: cols(['id', 'Asset ID'], ['title', 'Title'], ['owner', 'Owner'], ['last', 'Last reviewed'], ['next', 'Next review'], ['state', 'State']), rows: a.map((x: any) => ({ id: x.assetId, title: x.title, owner: x.owner, last: D(x.lastReviewedAt), next: D(x.nextReviewDate), state: x.nextReviewDate < new Date() ? 'OVERDUE' : 'Due soon' })), summary: [['Overdue', a.filter((x: any) => x.nextReviewDate < new Date()).length], ['Due in 30 days', a.filter((x: any) => x.nextReviewDate >= new Date()).length]] };
  } });

R.push({ key: 'asset_data_quality', title: 'Asset data-quality gaps', category: 'ISMS', module: 'assets', description: 'Assets missing an owner, custodian, location, classification or review cycle.',
  run: async ({ orgId }) => {
    const a = await Asset.find(live({ organizationId: orgId, lifecycleStatus: { $nin: ['disposed'] }, 'dataQualityFlags.0': { $exists: true } })).sort('completeness');
    return { columns: cols(['id', 'Asset ID'], ['title', 'Title'], ['completeness', 'Complete %'], ['gaps', 'Gaps']), rows: a.map((x: any) => ({ id: x.assetId, title: x.title, completeness: x.completeness, gaps: x.dataQualityFlags.map((f: string) => f.replace(/_/g, ' ')).join(', ') })), summary: [['Assets with gaps', a.length]] };
  } });

R.push({ key: 'asset_assignments', title: 'Assets held by employees', category: 'ISMS', module: 'assets', standard: 'A.7.9 / A.6.5', description: 'Who holds which asset — essential at offboarding.',
  run: async ({ orgId }) => {
    const a = await Asset.find(live({ organizationId: orgId, assignedToId: { $ne: null } })).populate('assignedToId', 'name employmentStatus isActive').sort('assetId');
    return { columns: cols(['holder', 'Employee'], ['status', 'Employment'], ['id', 'Asset ID'], ['title', 'Asset'], ['serial', 'Serial'], ['class', 'Classification']), rows: a.map((x: any) => ({ holder: x.assignedToId?.name, status: x.assignedToId?.isActive === false ? 'OFFBOARDED — recover asset' : x.assignedToId?.employmentStatus, id: x.assetId, title: x.title, serial: x.serialNumber, class: x.classification })).sort((p, q) => String(p.holder).localeCompare(String(q.holder))), summary: [['Assigned assets', a.length], ['Held by offboarded staff', a.filter((x: any) => x.assignedToId?.isActive === false).length]] };
  } });

R.push({ key: 'asset_disposals', title: 'Asset disposal log', category: 'ISMS', module: 'assets', standard: 'A.7.14', description: 'Requested, approved and completed disposals with destruction certificate references.',
  run: async ({ orgId }) => {
    const a = await Asset.find(live({ organizationId: orgId, lifecycleStatus: { $in: ['in_disposal', 'disposed'] } })).sort('-updatedAt');
    return { columns: cols(['id', 'Asset ID'], ['title', 'Asset'], ['status', 'Status'], ['method', 'Method'], ['requested', 'Requested by'], ['approved', 'Approved by'], ['cert', 'Certificate']), rows: a.map((x: any) => ({ id: x.assetId, title: x.title, status: x.lifecycleStatus, method: x.disposal?.method, requested: x.disposal?.requestedByName, approved: x.disposal?.approvedByName, cert: x.disposal?.certificateRef })), summary: [['In disposal', a.filter((x) => x.lifecycleStatus === 'in_disposal').length], ['Disposed', a.filter((x) => x.lifecycleStatus === 'disposed').length]] };
  } });

R.push({ key: 'incident_register', title: 'Incident register', category: 'ISMS', module: 'incidents', standard: 'A.5.24–A.5.27', description: 'All security incidents with severity, status and time to resolve.', params: ['from', 'to', 'days'],
  run: async ({ orgId, params }) => {
    const { from, to } = range(params, 365);
    const i = await Incident.find(live({ organizationId: orgId, detectedAt: { $gte: from, $lte: to } })).populate('assigneeId', 'name').sort('-detectedAt');
    return { columns: cols(['ref', 'Reference'], ['title', 'Title'], ['category', 'Category'], ['severity', 'Severity'], ['status', 'Status'], ['breach', 'Data breach'], ['detected', 'Detected'], ['resolved', 'Resolved'], ['ttr', 'Hours to resolve'], ['assignee', 'Assignee']), rows: i.map((x: any) => ({ ref: x.reference, title: x.title, category: x.category, severity: x.severity, status: x.status, breach: x.isPersonalDataBreach ? 'Yes' : '', detected: D(x.detectedAt), resolved: D(x.resolvedAt), ttr: x.resolvedAt ? Math.round((x.resolvedAt - x.detectedAt) / 3600000) : '', assignee: x.assigneeId?.name })), summary: [['Incidents', i.length], ['Open', i.filter((x) => x.status !== 'closed').length], ['Critical/High', i.filter((x) => ['critical', 'high'].includes(x.severity as string)).length], ['Data breaches', i.filter((x) => x.isPersonalDataBreach).length]] };
  } });

R.push({ key: 'breach_notifications', title: 'Personal data breach — 72-hour clock', category: 'ISMS', module: ['incidents', 'data_protection'], standard: 'NDPA s.40 / GDPR Art.33', description: 'Every personal data breach and whether the regulator was notified inside 72 hours.',
  run: async ({ orgId }) => {
    const i = await Incident.find(live({ organizationId: orgId, isPersonalDataBreach: true })).sort('-detectedAt');
    const rows = i.map((x: any) => { const b = x.breach; const late = b.regulatorNotified ? b.regulatorNotifiedAt > b.regulatorDeadline : b.regulatorDeadline < new Date(); return { ref: x.reference, title: x.title, risk: b.riskToRights, subjects: b.subjectsAffected, detected: x.detectedAt.toISOString().replace('T', ' ').slice(0, 16), deadline: b.regulatorDeadline?.toISOString().replace('T', ' ').slice(0, 16), notified: b.regulatorNotified ? D(b.regulatorNotifiedAt) : 'No', status: b.riskToRights === 'unlikely' && !b.regulatorNotified ? 'Not required (documented)' : late ? (b.regulatorNotified ? 'NOTIFIED LATE' : 'OVERDUE') : b.regulatorNotified ? 'On time' : `${Math.max(0, Math.round((b.regulatorDeadline - Date.now()) / 3600000))}h left` }; });
    return { columns: cols(['ref', 'Reference'], ['title', 'Title'], ['risk', 'Risk to rights'], ['subjects', 'Subjects'], ['detected', 'Detected'], ['deadline', 'Regulator deadline'], ['notified', 'Notified'], ['status', 'Status']), rows, summary: [['Breaches', rows.length], ['Late / overdue', rows.filter((r) => /LATE|OVERDUE/.test(r.status)).length]] };
  } });

R.push({ key: 'incident_metrics', title: 'Incident response metrics', category: 'ISMS', module: 'incidents', description: 'Mean time to contain and resolve by severity — your response performance.', params: ['days'],
  run: async ({ orgId, params }) => {
    const since = new Date(Date.now() - num(params.days, 365) * 86400000);
    const i = await Incident.find(live({ organizationId: orgId, detectedAt: { $gte: since } }));
    const rows = ['critical', 'high', 'medium', 'low'].map((s) => { const g = i.filter((x) => x.severity === s); const c = g.filter((x: any) => x.containedAt); const r = g.filter((x: any) => x.resolvedAt); const avg = (arr: any[], f: (x: any) => number) => (arr.length ? Math.round(arr.reduce((t, x) => t + f(x), 0) / arr.length) : ''); return { severity: s, count: g.length, open: g.filter((x) => x.status !== 'closed').length, mttc: avg(c, (x) => (x.containedAt - x.detectedAt) / 3600000), mttr: avg(r, (x) => (x.resolvedAt - x.detectedAt) / 3600000) }; });
    return { columns: cols(['severity', 'Severity'], ['count', 'Incidents'], ['open', 'Open'], ['mttc', 'Avg hours to contain'], ['mttr', 'Avg hours to resolve']), rows, summary: [['Period (days)', num(params.days, 365)], ['Total', i.length]] };
  } });

R.push({ key: 'risk_register', title: 'Risk register', category: 'ISMS', module: 'risks', standard: 'ISO 27001 cl.6.1', description: 'Open risks scored by severity × impact.',
  run: async ({ orgId }) => {
    const score = (v: string) => ({ low: 1, medium: 2, high: 3, critical: 4 } as any)[v] || 2;
    const r = await Risk.find(live({ organizationId: orgId, status: { $ne: 'closed' } })).populate('ownerId', 'name');
    const rows = r.map((x: any) => { const sev = x.severity || x.likelihood; const s = score(sev) * score(x.impact); return { title: x.title, category: x.category, severity: sev, impact: x.impact, score: s, rating: s >= 8 ? 'Critical' : s >= 6 ? 'High' : s >= 3 ? 'Medium' : 'Low', owner: x.ownerId?.name, status: x.status, mitigation: x.mitigationPlan ? 'Yes' : 'NO PLAN' }; }).sort((a, b) => b.score - a.score);
    return { columns: cols(['title', 'Risk'], ['category', 'Category'], ['severity', 'Severity'], ['impact', 'Impact'], ['score', 'Score'], ['rating', 'Rating'], ['owner', 'Owner'], ['status', 'Status'], ['mitigation', 'Mitigation plan']), rows, summary: [['Open risks', rows.length], ['High', rows.filter((x) => x.rating === 'High' || x.rating === 'Critical').length], ['No mitigation plan', rows.filter((x) => x.mitigation === 'NO PLAN').length]] };
  } });

R.push({ key: 'compliance_status', title: 'Compliance status by framework', category: 'ISMS', module: 'compliance', standard: 'ISO 27001 / PCI DSS / NDPA', description: 'Controls and obligations per framework, with overdue reviews.',
  run: async ({ orgId }) => {
    const c = await ComplianceItem.find(live({ organizationId: orgId })).populate('ownerId', 'name').sort('framework');
    return { columns: cols(['framework', 'Framework'], ['title', 'Control / requirement'], ['status', 'Status'], ['owner', 'Owner'], ['last', 'Last reviewed'], ['next', 'Next review'], ['due', 'Review']), rows: c.map((x: any) => ({ framework: x.framework, title: x.title, status: x.status, owner: x.ownerId?.name, last: D(x.lastReviewedAt), next: D(x.nextReviewDate), due: x.nextReviewDate && x.nextReviewDate < new Date() ? 'OVERDUE' : '' })), summary: [['Controls', c.length], ['Compliant', c.filter((x) => x.status === 'compliant').length], ['Non-compliant', c.filter((x) => x.status === 'non_compliant').length], ['Reviews overdue', c.filter((x: any) => x.nextReviewDate && x.nextReviewDate < new Date()).length]] };
  } });

R.push({ key: 'obligations_calendar', title: 'Compliance calendar (statutory deadlines)', category: 'ISMS', module: 'compliance', description: 'VAT/WHT remittance, regulator filings and other recurring obligations with due dates.',
  run: async ({ orgId }) => {
    const o = await Obligation.find(live({ organizationId: orgId, status: 'active' })).populate('ownerId', 'name').sort('nextDueAt');
    return { columns: cols(['title', 'Obligation'], ['category', 'Category'], ['authority', 'Authority'], ['frequency', 'Frequency'], ['due', 'Next due'], ['left', 'Days left'], ['owner', 'Owner'], ['last', 'Last completed']), rows: o.map((x: any) => ({ title: x.title, category: x.category, authority: x.authority, frequency: x.frequency, due: D(x.nextDueAt), left: Math.ceil((x.nextDueAt - Date.now()) / 86400000), owner: x.ownerId?.name, last: D(x.lastCompletedAt) })), summary: [['Obligations', o.length], ['Overdue', o.filter((x) => x.nextDueAt < new Date()).length], ['Due in 14 days', o.filter((x) => x.nextDueAt >= new Date() && x.nextDueAt < new Date(Date.now() + 14 * 86400000)).length]] };
  } });

R.push({ key: 'policy_acknowledgement', title: 'Policy acknowledgement tracker', category: 'ISMS', module: 'policies', standard: 'A.5.1 / A.6.3', description: 'Per policy: who has acknowledged the current version and who has not.',
  run: async ({ orgId }) => {
    const [policies, staff, acks] = await Promise.all([Policy.find(live({ organizationId: orgId, status: 'approved', requiresAcknowledgement: true })), User.find({ organizationId: orgId, ...STAFF_FILTER, loginEnabled: { $ne: false } }).select('name role'), PolicyAcknowledgement.find({ organizationId: orgId })]);
    const rows: any[] = [];
    for (const p of policies) {
      const aud = staff.filter((u) => !p.audienceRoles?.length || p.audienceRoles.includes(u.role));
      const done = new Set(acks.filter((a) => String(a.policyId) === String(p._id) && a.version === p.version).map((a) => String(a.userId)));
      const missing = aud.filter((u) => !done.has(String(u._id)));
      rows.push({ code: p.code, title: p.title, version: p.version, audience: aud.length, done: aud.length - missing.length, pct: `${pct(aud.length - missing.length, aud.length)}%`, outstanding: missing.map((u) => u.name).join(', ') });
    }
    return { columns: cols(['code', 'Code'], ['title', 'Policy'], ['version', 'Version'], ['audience', 'Audience'], ['done', 'Acknowledged'], ['pct', '%'], ['outstanding', 'Outstanding']), rows, summary: [['Policies requiring acknowledgement', rows.length]] };
  } });

/* ================================ Data protection ========================== */
R.push({ key: 'dsar_register', title: 'Data subject requests & SLA', category: 'Data Protection', module: 'data_protection', standard: 'NDPA s.34–38 / GDPR Art.12', description: 'Requests with due dates (30 days), overdue items and outcomes.', params: ['from', 'to', 'days'],
  run: async ({ orgId, params }) => {
    const { from, to } = range(params, 365);
    const d = await DataSubjectRequest.find(live({ organizationId: orgId, receivedAt: { $gte: from, $lte: to } })).populate('assigneeId', 'name').sort('dueAt');
    const open = (x: any) => !['completed', 'rejected'].includes(x.status);
    return { columns: cols(['ref', 'Reference'], ['type', 'Type'], ['who', 'Requester'], ['received', 'Received'], ['due', 'Due'], ['status', 'Status'], ['sla', 'SLA'], ['assignee', 'Assignee']), rows: d.map((x: any) => ({ ref: x.reference, type: x.type, who: x.requester.name, received: D(x.receivedAt), due: D(x.dueAt), status: x.status, sla: open(x) ? (x.dueAt < new Date() ? 'OVERDUE' : `${Math.ceil((x.dueAt - Date.now()) / 86400000)}d left`) : x.closedAt && x.closedAt > x.dueAt ? 'Closed late' : 'Met', assignee: x.assigneeId?.name })), summary: [['Requests', d.length], ['Open', d.filter(open).length], ['Overdue', d.filter((x: any) => open(x) && x.dueAt < new Date()).length]] };
  } });

R.push({ key: 'ropa', title: 'Record of processing activities (ROPA)', category: 'Data Protection', module: 'data_protection', standard: 'GDPR Art.30 / NDPA s.28', description: 'Every processing activity with lawful basis, retention, transfers and DPIA status.',
  run: async ({ orgId }) => {
    const p = await ProcessingActivity.find(live({ organizationId: orgId, status: 'active' })).populate('ownerId', 'name').sort('name');
    return { columns: cols(['name', 'Activity'], ['purpose', 'Purpose'], ['basis', 'Lawful basis'], ['subjects', 'Data subjects'], ['categories', 'Data categories'], ['sensitive', 'Sensitive'], ['transfer', 'Cross-border'], ['retention', 'Retention'], ['dpia', 'DPIA'], ['owner', 'Owner'], ['next', 'Next review']), rows: p.map((x: any) => ({ name: x.name, purpose: x.purpose, basis: x.lawfulBasis, subjects: x.dataSubjects.join(', '), categories: x.dataCategories.join(', '), sensitive: x.sensitiveData ? 'Yes' : '', transfer: x.thirdCountryTransfer ? 'Yes' : '', retention: x.retentionPeriod, dpia: x.dpiaRequired ? x.dpiaStatus : '—', owner: x.ownerId?.name, next: D(x.nextReviewAt) })), summary: [['Activities', p.length], ['DPIA outstanding', p.filter((x) => x.dpiaRequired && x.dpiaStatus !== 'completed').length], ['Overdue review', p.filter((x) => x.nextReviewAt && x.nextReviewAt < new Date()).length]] };
  } });

/* =================================== People ================================ */
R.push({ key: 'certification_expiry', title: 'Certification expiry', category: 'People', module: ['employees', 'reports'], description: 'Certifications expired or expiring in the next 120 days.',
  run: async ({ orgId }) => {
    const c = await Certification.find(live({ organizationId: orgId, expiryDate: { $lt: new Date(Date.now() + 120 * 86400000) } })).populate('employeeId', 'name department isActive').sort('expiryDate');
    return { columns: cols(['employee', 'Employee'], ['department', 'Department'], ['cert', 'Certification'], ['provider', 'Provider'], ['expiry', 'Expiry'], ['left', 'Days left'], ['state', 'State']), rows: c.filter((x: any) => x.employeeId?.isActive !== false).map((x: any) => ({ employee: x.employeeId?.name, department: x.employeeId?.department, cert: x.name, provider: x.provider, expiry: D(x.expiryDate), left: Math.ceil((x.expiryDate - Date.now()) / 86400000), state: x.expiryDate < new Date() ? 'EXPIRED' : 'Expiring' })), summary: [['Expired', c.filter((x) => x.expiryDate! < new Date()).length], ['Expiring (120d)', c.filter((x) => x.expiryDate! >= new Date()).length]] };
  } });

R.push({ key: 'training_completion', title: 'Training & awareness completion', category: 'People', module: ['employees', 'reports'], standard: 'A.6.3', description: 'Course enrolment and completion per employee (security awareness evidence).',
  run: async ({ orgId }) => {
    const e = await Enrollment.find(live({ organizationId: orgId })).populate('userId', 'name department role').populate('courseId', 'title');
    const rows = e.filter((x: any) => x.userId && !EXTERNAL_ROLES.includes(x.userId.role)).map((x: any) => ({ employee: x.userId.name, department: x.userId.department, course: x.courseId?.title, status: x.status, progress: `${x.progressPercent || 0}%`, score: x.assessmentScore ?? '', completed: D(x.completedAt) }));
    return { columns: cols(['employee', 'Employee'], ['department', 'Department'], ['course', 'Course'], ['status', 'Status'], ['progress', 'Progress'], ['score', 'Score'], ['completed', 'Completed']), rows, summary: [['Enrolments', rows.length], ['Completed', rows.filter((r) => r.status === 'completed').length], ['Completion rate', `${pct(rows.filter((r) => r.status === 'completed').length, rows.length)}%`]] };
  } });

R.push({ key: 'onboarding_gaps', title: 'Employee record gaps', category: 'People', module: 'employees', description: 'Employees missing a login decision, payment details, certifications or emergency contact.',
  run: async ({ orgId }) => {
    const users = await User.find({ organizationId: orgId, ...STAFF_FILTER }).select('name role department loginEnabled bankAccount.accountLast4 emergencyContact dateJoined employeeNo').sort('name');
    const certCounts = await Certification.aggregate([{ $match: { organizationId: oid(orgId), isDeleted: { $ne: true } } }, { $group: { _id: '$employeeId', n: { $sum: 1 } } }]);
    const has = new Set(certCounts.map((c) => String(c._id)));
    const rows = users.map((u: any) => { const gaps = [u.loginEnabled === false ? 'no login' : '', !u.bankAccount?.accountLast4 ? 'no payment account' : '', !u.emergencyContact?.phone ? 'no emergency contact' : '', !has.has(String(u._id)) ? 'no certifications on file' : '', !u.employeeNo ? 'no employee number' : ''].filter(Boolean); return { name: u.name, role: u.role, department: u.department, joined: D(u.dateJoined), gaps: gaps.join(', ') }; }).filter((r) => r.gaps);
    return { columns: cols(['name', 'Employee'], ['role', 'Role'], ['department', 'Department'], ['joined', 'Joined'], ['gaps', 'Gaps']), rows, summary: [['Employees', users.length], ['With gaps', rows.length]] };
  } });

/* ================================== Finance ================================ */
R.push({ key: 'expense_summary', title: 'Expense summary', category: 'Finance', module: ['expense_approvals', 'expenses'], description: 'Spend by category and employee for a period (approved and pending).', params: ['from', 'to', 'days'],
  run: async ({ orgId, params, user }) => {
    const { from, to } = range(params, 90);
    const claims = await ExpenseClaim.find(live({ organizationId: orgId, status: { $nin: ['draft', 'cancelled'] }, submittedAt: { $gte: from, $lte: to } }));
    const map = new Map<string, any>();
    for (const c of claims) for (const it of c.items as any[]) {
      if (it.decision === 'rejected') continue;
      const k = `${it.category}`; const row = map.get(k) || { category: k, items: 0, net: 0, vat: 0, wht: 0, total: 0, receipts: 0 };
      row.items++; row.net += it.amount; row.vat += it.tax?.vatAmount || 0; row.wht += it.tax?.whtAmount || 0; row.total += it.amount + (it.tax?.vatAmount || 0); row.receipts += (it.attachments || []).length ? 1 : 0; map.set(k, row);
    }
    const rows = [...map.values()].map((r) => ({ ...r, net: round2(r.net), vat: round2(r.vat), wht: round2(r.wht), total: round2(r.total), receipts: `${r.receipts}/${r.items}` })).sort((a, b) => b.total - a.total);
    return { columns: cols(['category', 'Category'], ['items', 'Items'], ['net', 'Net'], ['vat', 'VAT'], ['wht', 'WHT'], ['total', 'Total'], ['receipts', 'With receipts']), rows, summary: [['Period', `${D(from)} → ${D(to)}`], ['Claims', claims.length], ['Total spend', naira(rows.reduce((s, r) => s + r.total, 0))]], note: 'Amounts are in each claim’s own currency; shown unconverted. Rejected items excluded.' };
  } });

R.push({ key: 'expense_by_employee', title: 'Expenses by employee & payment mode', category: 'Finance', module: 'expense_approvals', description: 'How much each person spent — company-paid, paid personally (to reimburse) and awaiting disbursement.', params: ['from', 'to', 'days'],
  run: async ({ orgId, params }) => {
    const { from, to } = range(params, 90);
    const claims = await ExpenseClaim.find(live({ organizationId: orgId, status: { $nin: ['draft', 'cancelled'] }, submittedAt: { $gte: from, $lte: to } }));
    const map = new Map<string, any>();
    for (const c0 of claims) { const c: any = c0; const row = map.get(String(c.submittedById)) || { employee: c.submittedByName, claims: 0, companyPaid: 0, personal: 0, awaiting: 0, total: 0 }; row.claims++; row.companyPaid += c.totals.companyPaid; row.personal += c.totals.reimbursable; row.awaiting += c.totals.toDisburse; row.total += c.totals.total; map.set(String(c.submittedById), row); }
    const rows = [...map.values()].map((r) => ({ ...r, companyPaid: round2(r.companyPaid), personal: round2(r.personal), awaiting: round2(r.awaiting), total: round2(r.total) })).sort((a, b) => b.total - a.total);
    return { columns: cols(['employee', 'Employee'], ['claims', 'Claims'], ['companyPaid', 'Company paid'], ['personal', 'Paid personally'], ['awaiting', 'Awaiting disbursement'], ['total', 'Total']), rows, summary: [['Employees', rows.length], ['Owed (personal)', round2(rows.reduce((s, r) => s + r.personal, 0))], ['Awaiting disbursement', round2(rows.reduce((s, r) => s + r.awaiting, 0))]] };
  } });

R.push({ key: 'expense_pending_payment', title: 'Approved expenses awaiting payment', category: 'Finance', module: 'expense_approvals', description: 'Approved claims that still have to be reimbursed or disbursed, oldest first.',
  run: async ({ orgId }) => {
    const c = await ExpenseClaim.find(live({ organizationId: orgId, status: 'approved' })).sort('decidedAt');
    return { columns: cols(['claim', 'Claim'], ['employee', 'Employee'], ['title', 'Title'], ['approved', 'Approved on'], ['waiting', 'Days waiting'], ['payable', 'Payable'], ['currency', 'Currency'], ['personal', 'Of which paid personally'], ['awaiting', 'Of which disbursement']), rows: c.map((x: any) => ({ claim: x.claimNo, employee: x.submittedByName, title: x.title, approved: D(x.decidedAt), waiting: days(x.decidedAt), payable: x.totals.payable, currency: x.currency, personal: x.totals.reimbursable, awaiting: x.totals.toDisburse })), summary: [['Claims', c.length], ['Payable (NGN claims)', naira(c.filter((x) => x.currency === 'NGN').reduce((s, x: any) => s + x.totals.payable, 0))]] };
  } });

R.push({ key: 'expense_exceptions', title: 'Expense exceptions (missing receipts & duplicates)', category: 'Finance', module: 'expense_approvals', standard: 'Internal control', description: 'Items flagged for a missing receipt or a possible duplicate.', params: ['days'],
  run: async ({ orgId, params }) => {
    const since = new Date(Date.now() - num(params.days, 180) * 86400000);
    const claims = await ExpenseClaim.find(live({ organizationId: orgId, status: { $nin: ['draft', 'cancelled'] }, submittedAt: { $gte: since }, 'items.flags.0': { $exists: true } }));
    const rows: any[] = [];
    for (const c of claims) for (const it of c.items as any[]) if ((it.flags || []).length) rows.push({ claim: c.claimNo, employee: c.submittedByName, category: it.category, description: it.description, boughtBy: it.boughtBy?.name, date: D(it.date), amount: it.amount, flags: it.flags.map((f: string) => f.replace(/_/g, ' ')).join(', '), decision: it.decision });
    return { columns: cols(['claim', 'Claim'], ['employee', 'Submitted by'], ['category', 'Category'], ['description', 'Description'], ['boughtBy', 'Bought by'], ['date', 'Date'], ['amount', 'Amount'], ['flags', 'Flags'], ['decision', 'Decision']), rows, summary: [['Flagged items', rows.length]] };
  } });

R.push({ key: 'invoice_aging', title: 'Receivables ageing', category: 'Finance', module: 'invoices', description: 'Unpaid invoices bucketed by days overdue.',
  run: async ({ orgId }) => {
    const inv = await Invoice.find(live({ organizationId: orgId, status: { $in: ['sent', 'partially_paid'] } })).populate('clientId', 'name').sort('dueDate');
    const bucket = (d: number) => (d <= 0 ? 'Current' : d <= 30 ? '1–30' : d <= 60 ? '31–60' : d <= 90 ? '61–90' : '90+');
    const rows = inv.map((x: any) => { const late = days(x.dueDate); const rate = x.currency === 'NGN' ? 1 : x.exchangeRate || 1; return { invoice: x.invoiceNo, client: x.clientId?.name, issued: D(x.issueDate), due: D(x.dueDate), late: Math.max(late, 0), bucket: bucket(late), currency: x.currency, balance: x.balance, balanceNgn: round2(x.balance * rate), reminders: x.reminders?.count || 0 }; });
    const tot = (b: string) => round2(rows.filter((r) => r.bucket === b).reduce((s, r) => s + r.balanceNgn, 0));
    return { columns: cols(['invoice', 'Invoice'], ['client', 'Client'], ['issued', 'Issued'], ['due', 'Due'], ['late', 'Days overdue'], ['bucket', 'Bucket'], ['currency', 'Cur'], ['balance', 'Balance'], ['balanceNgn', 'Balance (NGN)'], ['reminders', 'Reminders']), rows, summary: [['Outstanding (NGN)', naira(rows.reduce((s, r) => s + r.balanceNgn, 0))], ['Current', naira(tot('Current'))], ['1–30', naira(tot('1–30'))], ['31–60', naira(tot('31–60'))], ['61–90', naira(tot('61–90'))], ['90+', naira(tot('90+'))]] };
  } });

R.push({ key: 'revenue_summary', title: 'Revenue by month', category: 'Finance', module: 'invoices', description: 'Invoiced vs collected, by month, in NGN.', params: ['year'],
  run: async ({ orgId, params }) => {
    const year = num(params.year, new Date().getFullYear());
    const inv = await Invoice.find(live({ organizationId: orgId, status: { $nin: ['draft', 'pending_approval', 'rejected', 'void'] }, issueDate: { $gte: new Date(`${year}-01-01`), $lt: new Date(`${year + 1}-01-01`) } }));
    const rows = Array.from({ length: 12 }, (_, i) => { const m = inv.filter((x) => x.issueDate.getUTCMonth() === i); const rate = (x: any) => (x.currency === 'NGN' ? 1 : x.exchangeRate || 1); return { month: new Date(Date.UTC(year, i, 1)).toLocaleString('en-GB', { month: 'long', timeZone: 'UTC' }), invoices: m.length, invoiced: round2(m.reduce((s, x: any) => s + x.subtotal * rate(x), 0)), vat: round2(m.reduce((s, x: any) => s + x.vatAmount * rate(x), 0)), collected: round2(m.reduce((s, x: any) => s + x.amountPaid * rate(x), 0)) }; });
    return { columns: cols(['month', 'Month'], ['invoices', 'Invoices'], ['invoiced', 'Invoiced (ex VAT)'], ['vat', 'VAT'], ['collected', 'Collected']), rows, summary: [['Year', year], ['Invoiced', naira(rows.reduce((s, r) => s + r.invoiced, 0))], ['Collected', naira(rows.reduce((s, r) => s + r.collected, 0))]] };
  } });

R.push({ key: 'client_balances', title: 'Outstanding balance by client', category: 'Finance', module: 'invoices', description: 'What each client owes today.',
  run: async ({ orgId }) => {
    const inv = await Invoice.find(live({ organizationId: orgId, status: { $in: ['sent', 'partially_paid'] } })).populate('clientId', 'name');
    const map = new Map<string, any>();
    for (const x of inv as any[]) { const k = x.clientId?.name || 'Unknown'; const r = map.get(k) || { client: k, invoices: 0, outstanding: 0, overdue: 0 }; const rate = x.currency === 'NGN' ? 1 : x.exchangeRate || 1; r.invoices++; r.outstanding += x.balance * rate; if (x.dueDate < new Date()) r.overdue += x.balance * rate; map.set(k, r); }
    const rows = [...map.values()].map((r) => ({ ...r, outstanding: round2(r.outstanding), overdue: round2(r.overdue) })).sort((a, b) => b.outstanding - a.outstanding);
    return { columns: cols(['client', 'Client'], ['invoices', 'Open invoices'], ['outstanding', 'Outstanding (NGN)'], ['overdue', 'Of which overdue']), rows, summary: [['Clients owing', rows.length], ['Total', naira(rows.reduce((s, r) => s + r.outstanding, 0))]] };
  } });

R.push({ key: 'vat_return', title: 'VAT return worksheet', category: 'Finance', module: 'taxes', standard: 'FIRS monthly VAT filing', description: 'Output VAT (invoices) less input VAT (expenses) = VAT payable, by month.', params: ['year'],
  run: async ({ orgId, params }) => {
    const year = num(params.year, new Date().getFullYear());
    const g = await TaxRecord.aggregate([{ $match: { organizationId: oid(orgId), year, kind: 'VAT', status: { $ne: 'void' } } }, { $group: { _id: { m: '$month', n: '$nature', s: '$status' }, a: { $sum: '$amount' } } }]);
    const f = (m: number, n: string, s?: string) => round2(g.filter((x) => x._id.m === m && x._id.n === n && (!s || x._id.s === s)).reduce((t, x) => t + x.a, 0));
    const rows = Array.from({ length: 12 }, (_, i) => { const m = i + 1; const out = f(m, 'output_vat'), inn = f(m, 'input_vat'); return { month: new Date(Date.UTC(year, i, 1)).toLocaleString('en-GB', { month: 'long', timeZone: 'UTC' }), output: out, input: inn, payable: round2(out - inn), unremitted: f(m, 'output_vat', 'unpaid'), due: `21 ${new Date(Date.UTC(year, i + 1, 1)).toLocaleString('en-GB', { month: 'short', timeZone: 'UTC' })} ${i === 11 ? year + 1 : year}` }; });
    return { columns: cols(['month', 'Month'], ['output', 'Output VAT'], ['input', 'Input VAT'], ['payable', 'Net payable'], ['unremitted', 'Unremitted output VAT'], ['due', 'Filing due']), rows, summary: [['Year', year], ['Net VAT payable', naira(rows.reduce((s, r) => s + r.payable, 0))]], note: 'Output VAT is recognised when an invoice is fully paid; input VAT when an expense is paid.' };
  } });

R.push({ key: 'wht_schedule', title: 'Withholding tax schedule', category: 'Finance', module: 'taxes', description: 'WHT we withheld (to remit) and WHT credits clients deducted from us (to claim).', params: ['year'],
  run: async ({ orgId, params }) => {
    const year = num(params.year, new Date().getFullYear());
    const t = await TaxRecord.find({ organizationId: orgId, year, kind: 'WHT', status: { $ne: 'void' } }).sort('transDate');
    return { columns: cols(['id', 'Tax ID'], ['nature', 'Type'], ['date', 'Date'], ['party', 'Party'], ['source', 'Source'], ['base', 'Base (NGN)'], ['rate', 'Rate %'], ['amount', 'WHT (NGN)'], ['status', 'Status']), rows: t.map((x: any) => ({ id: x.taxId, nature: x.nature === 'wht_credit' ? 'Credit (claim)' : 'Withheld (remit)', date: D(x.transDate), party: x.partyName, source: x.sourceRef, base: x.baseAmount, rate: x.rate, amount: x.amount, status: x.status })), summary: [['To remit (unpaid)', naira(t.filter((x) => x.nature === 'wht_withheld_by_us' && x.status === 'unpaid').reduce((s, x) => s + x.amount, 0))], ['Credits to claim', naira(t.filter((x) => x.nature === 'wht_credit').reduce((s, x) => s + x.amount, 0))]] };
  } });

R.push({ key: 'bank_accounts_register', title: 'Company bank account register', category: 'Finance', module: 'bank_accounts', description: 'Accounts with status, approver and last change — numbers are masked.',
  run: async ({ orgId }) => {
    const b = await BankAccount.find(live({ organizationId: orgId })).populate('createdById approvedById', 'name').sort('bankName');
    return { columns: cols(['bank', 'Bank'], ['name', 'Account name'], ['number', 'Account'], ['currency', 'Currency'], ['purpose', 'Purpose'], ['status', 'Status'], ['created', 'Created by'], ['approved', 'Approved by'], ['approvedAt', 'Approved on']), rows: b.map((x: any) => ({ bank: x.bankName, name: x.accountName, number: `••••${x.accountLast4}`, currency: x.currency, purpose: x.purpose, status: x.status, created: x.createdById?.name, approved: x.approvedById?.name, approvedAt: D(x.approvedAt) })), summary: [['Accounts', b.length], ['Pending approval', b.filter((x) => x.status === 'pending').length]] };
  } });

/* ================================= Executive =============================== */
R.push({ key: 'controls_status', title: 'Recurring controls status', category: 'ISMS', module: 'compliance', standard: 'ISO 27001 cl.9.1 · A.5.37', description: 'Every recurring control (password rotations, risk assessment, access review, backups…) with its owner, last completion and next due date.',
  run: async ({ orgId }) => {
    const rows = await controlsSummaryRows(orgId);
    const overdue = rows.filter((r) => r.state === 'overdue').length;
    return { columns: [{ key: 'control', label: 'Control' }, { key: 'category', label: 'Category' }, { key: 'reference', label: 'ISO ref' }, { key: 'frequencyDays', label: 'Every (days)' }, { key: 'owner', label: 'Owner' }, { key: 'assignedVia', label: 'Assigned via' }, { key: 'lastDone', label: 'Last done' }, { key: 'nextDue', label: 'Next due' }, { key: 'state', label: 'State' }],
      rows, summary: [['Controls', String(rows.length)], ['Overdue', String(overdue)], ['No owner', String(rows.filter((r) => r.owner.includes('none')).length)]] };
  } });

R.push({ key: 'security_scorecard', title: 'Security & compliance scorecard', category: 'Executive', module: 'reports', standard: 'ISO 27001 cl.9.3 management review', description: 'One-page health check across access, assets, incidents, data protection, people and finance controls — ready for management review.',
  run: async ({ orgId }) => {
    const now = new Date(), in30 = new Date(Date.now() + 30 * 86400000);
    const [staff, openInc, breachLate, dsarOver, assetsAll, assetsNoOwner, eolExpired, reviewsOver, policies, staffN, acks, certsExpired, certsAll, oblOver, risksHigh, invOver, claimsWaiting, seals, rop, accRev, activeStaff, ropaDue] = await Promise.all([
      User.find({ organizationId: orgId, ...STAFF_FILTER, loginEnabled: { $ne: false } }).select('mfaEnabled lastLoginAt'),
      Incident.countDocuments(live({ organizationId: orgId, status: { $ne: 'closed' }, severity: { $in: ['high', 'critical'] } })),
      Incident.countDocuments(live({ organizationId: orgId, isPersonalDataBreach: true, 'breach.regulatorNotified': false, 'breach.riskToRights': { $ne: 'unlikely' }, 'breach.regulatorDeadline': { $lt: now } })),
      DataSubjectRequest.countDocuments(live({ organizationId: orgId, status: { $nin: ['completed', 'rejected'] }, dueAt: { $lt: now } })),
      Asset.countDocuments(live({ organizationId: orgId, lifecycleStatus: { $nin: ['disposed'] } })),
      Asset.countDocuments(live({ organizationId: orgId, lifecycleStatus: { $nin: ['disposed'] }, dataQualityFlags: 'missing_owner' })),
      Asset.countDocuments(live({ organizationId: orgId, lifecycleStatus: { $in: ['active', 'under_maintenance'] }, eolState: 'expired' })),
      Asset.countDocuments(live({ organizationId: orgId, lifecycleStatus: { $in: ['active', 'under_maintenance'] }, nextReviewDate: { $lt: now } })),
      Policy.find(live({ organizationId: orgId, status: 'approved', requiresAcknowledgement: true })),
      User.countDocuments({ organizationId: orgId, ...STAFF_FILTER, loginEnabled: { $ne: false } }),
      PolicyAcknowledgement.find({ organizationId: orgId }),
      Certification.countDocuments(live({ organizationId: orgId, expiryDate: { $lt: now } })),
      Certification.countDocuments(live({ organizationId: orgId })),
      Obligation.countDocuments(live({ organizationId: orgId, status: 'active', nextDueAt: { $lt: now } })),
      Risk.countDocuments(live({ organizationId: orgId, status: { $ne: 'closed' }, severity: { $in: ['high', 'critical'] }, impact: { $in: ['high', 'critical'] } })),
      Invoice.countDocuments(live({ organizationId: orgId, status: { $in: ['sent', 'partially_paid'] }, dueDate: { $lt: new Date(Date.now() - 30 * 86400000) } })),
      ExpenseClaim.countDocuments(live({ organizationId: orgId, status: { $in: ['submitted', 'partially_approved'] }, submittedAt: { $lt: new Date(Date.now() - 7 * 86400000) } })),
      verifySeals(orgId),
      ProcessingActivity.countDocuments(live({ organizationId: orgId, status: 'active', nextReviewAt: { $lt: now } })),
      AccessReview.findOne(live({ organizationId: orgId, status: 'completed' })).sort('-completedAt'),
      User.countDocuments({ organizationId: orgId, ...STAFF_FILTER }),
      ProcessingActivity.countDocuments(live({ organizationId: orgId, status: 'active', dpiaRequired: true, dpiaStatus: { $ne: 'completed' } })),
    ]);
    const mfa = staff.filter((u) => u.mfaEnabled).length;
    const dormant = staff.filter((u) => !u.lastLoginAt || u.lastLoginAt < new Date(Date.now() - env.dormantAccountDays * 86400000)).length;
    let ackDone = 0, ackNeed = 0;
    for (const p of policies) { ackNeed += staffN; ackDone += acks.filter((a) => String(a.policyId) === String(p._id) && a.version === p.version).length; }
    const lastReviewDays = accRev?.completedAt ? days(accRev.completedAt) : null;
    type M = [string, string, number | string, string, 'good' | 'warn' | 'bad'];
    const rag = (ok: boolean, warn: boolean): 'good' | 'warn' | 'bad' => (ok ? 'good' : warn ? 'warn' : 'bad');
    const metrics: M[] = [
      ['Access', 'MFA coverage', `${pct(mfa, staff.length)}%`, '100%', rag(pct(mfa, staff.length) === 100, pct(mfa, staff.length) >= 80)],
      ['Access', 'Dormant accounts', dormant, '0', rag(dormant === 0, dormant <= 2)],
      ['Access', 'Days since last access review', lastReviewDays ?? 'Never', '≤ 180', rag(lastReviewDays !== null && lastReviewDays <= 180, lastReviewDays !== null && lastReviewDays <= 365)],
      ['Audit', 'Audit-log seals verified', seals.valid ? 'Valid' : `${seals.problems.length} problem(s)`, 'Valid', seals.valid ? 'good' : 'bad'],
      ['Incidents', 'Open high/critical incidents', openInc, '0', rag(openInc === 0, openInc <= 2)],
      ['Incidents', 'Breaches past 72h with no notification', breachLate, '0', rag(breachLate === 0, false)],
      ['Data protection', 'Overdue data-subject requests', dsarOver, '0', rag(dsarOver === 0, false)],
      ['Data protection', 'ROPA entries overdue for review', rop, '0', rag(rop === 0, rop <= 2)],
      ['Data protection', 'DPIAs outstanding', ropaDue, '0', rag(ropaDue === 0, ropaDue <= 2)],
      ['Assets', 'Assets without an owner', assetsNoOwner, '0', rag(assetsNoOwner === 0, assetsNoOwner <= Math.max(2, assetsAll * 0.05))],
      ['Assets', 'Assets past end of life', eolExpired, '0', rag(eolExpired === 0, eolExpired <= 3)],
      ['Assets', 'Asset reviews overdue', reviewsOver, '0', rag(reviewsOver === 0, reviewsOver <= 3)],
      ['Policies', 'Policy acknowledgement rate', `${pct(ackDone, ackNeed)}%`, '100%', rag(pct(ackDone, ackNeed) === 100, pct(ackDone, ackNeed) >= 85)],
      ['People', 'Expired certifications', `${certsExpired} of ${certsAll}`, '0', rag(certsExpired === 0, certsExpired <= 2)],
      ['Compliance', 'Overdue obligations', oblOver, '0', rag(oblOver === 0, false)],
      ['Risk', 'High-severity & high-impact open risks', risksHigh, '0', rag(risksHigh === 0, risksHigh <= 1)],
      ['Finance', 'Invoices > 30 days overdue', invOver, '0', rag(invOver === 0, invOver <= 3)],
      ['Finance', 'Expense claims waiting > 7 days', claimsWaiting, '0', rag(claimsWaiting === 0, claimsWaiting <= 3)],
    ];
    const score = Math.round((metrics.reduce((s, m) => s + (m[4] === 'good' ? 1 : m[4] === 'warn' ? 0.5 : 0), 0) / metrics.length) * 100);
    return { columns: cols(['area', 'Area'], ['metric', 'Metric'], ['value', 'Current'], ['target', 'Target'], ['status', 'Status']), rows: metrics.map(([area, metric, value, target, st]) => ({ area, metric, value, target, status: st === 'good' ? 'On target' : st === 'warn' ? 'Needs attention' : 'ACTION REQUIRED' })), summary: [['Overall score', `${score}%`], ['On target', metrics.filter((m) => m[4] === 'good').length], ['Needs attention', metrics.filter((m) => m[4] === 'warn').length], ['Action required', metrics.filter((m) => m[4] === 'bad').length]], note: `Scored out of ${metrics.length} controls (on target = 1, needs attention = ½). Generated from live data for management review.` };
  } });


/* ============================== Work & delivery ============================ */
const wp = (p: Record<string, any>) => ({ quarter: p.quarter, from: p.from, to: p.to, projectId: p.projectId });

R.push({ key: 'tasks_by_user', title: 'Tasks assigned per person', category: 'Work & Delivery', module: 'work_reports', description: 'How many tasks and subtasks each person was given, and where they stand. Confidential tasks are excluded.', params: ['quarter', 'from', 'to'],
  run: async ({ orgId, params }) => {
    const s = await workSummary(orgId, wp(params));
    return { columns: cols(['name', 'Person'], ['assigned', 'Assigned'], ['todo', 'To do'], ['inProgress', 'In progress'], ['blocked', 'Blocked'], ['awaitingApproval', 'Awaiting approval'], ['done', 'Done'], ['overdue', 'Overdue'], ['criticalOpen', 'Critical open'], ['completionRate', 'Completion %']),
      rows: s.byUser, summary: [['Tasks & subtasks assigned', s.totals.assigned], ['Awaiting approval', s.totals.awaitingApproval], ['Overdue', s.totals.overdue], ['Completion rate', `${s.totals.completionRate}%`]] };
  } });

R.push({ key: 'awaiting_approval', title: 'Work awaiting approval', category: 'Work & Delivery', module: 'work_reports', description: 'Tasks submitted with evidence that nobody has approved yet — oldest first.',
  run: async ({ orgId, params }) => {
    const s = await workSummary(orgId, wp(params));
    return { columns: cols(['title', 'Task'], ['owner', 'Submitted by'], ['approver', 'Waiting on'], ['project', 'Project'], ['severity', 'Severity'], ['waitingDays', 'Days waiting']), rows: s.awaitingApproval,
      summary: [['Awaiting approval', s.awaitingApproval.length], ['Waiting more than 3 days', s.awaitingApproval.filter((x) => x.waitingDays > 3).length]] };
  } });

R.push({ key: 'milestone_progress', title: 'Milestone progress', category: 'Work & Delivery', module: 'work_reports', description: 'Every milestone with the share of its tasks that are done. Milestones with no tasks are flagged.', params: ['quarter'],
  run: async ({ orgId, params }) => {
    const s = await workSummary(orgId, wp(params));
    return { columns: cols(['project', 'Project'], ['title', 'Milestone'], ['severity', 'Severity'], ['status', 'Status'], ['owner', 'Owner'], ['endDate', 'Ends'], ['tasks', 'Tasks'], ['done', 'Done'], ['percent', 'Progress %'], ['flag', 'Flag']),
      rows: s.milestones.map((m) => ({ ...m, endDate: D(m.endDate), flag: m.noTasks ? 'NO TASKS' : m.status === 'blocked' ? 'BLOCKED' : '' })),
      summary: [['Milestones', s.milestones.length], ['With no tasks', s.milestones.filter((m) => m.noTasks).length], ['Blocked', s.milestones.filter((m) => m.status === 'blocked').length]] };
  } });

R.push({ key: 'blocking_risks', title: 'Risks & blockers halting work', category: 'Work & Delivery', module: ['work_reports', 'risks'], description: 'Open risks, issues and blockers — those currently stopping a task or milestone are listed first.',
  run: async ({ orgId, params }) => {
    const f: any = { organizationId: orgId, status: { $ne: 'closed' } };
    if (params.projectId) f.relatedProjectId = params.projectId;
    const r = await Risk.find(live(f)).populate('ownerId', 'name').populate('relatedProjectId', 'name').populate('relatedTaskId', 'title').sort({ blocking: -1, createdAt: -1 });
    const rows = r.map((x: any) => ({ title: x.title, kind: x.kind, severity: x.severity, impact: x.impact, halting: x.blocking ? 'YES' : 'no', project: x.relatedProjectId?.name || '', task: x.relatedTaskId?.title || '', owner: x.ownerId?.name || '', open: `${days(x.createdAt)} days` }));
    return { columns: cols(['title', 'Risk title'], ['kind', 'Type'], ['severity', 'Severity'], ['impact', 'Impact'], ['halting', 'Halting work'], ['project', 'Project'], ['task', 'Task'], ['owner', 'Owner'], ['open', 'Open for']), rows, summary: [['Open', rows.length], ['Halting work', rows.filter((x) => x.halting === 'YES').length]] };
  } });

R.push({ key: 'meetings_missing_recordings', title: 'Meetings missing recordings', category: 'Work & Delivery', module: ['work_reports', 'meetings'], description: 'Meetings marked for recording whose recording has not been uploaded.',
  run: async ({ orgId }) => {
    const m = await Meeting.find(live({ organizationId: orgId, 'recording.reminderEnabled': true, 'recording.uploaded': { $ne: true }, status: { $ne: 'cancelled' }, date: { $lt: new Date() } })).populate('organizerId', 'name').sort('date');
    const rows = m.map((x: any) => ({ title: x.title, date: D(x.date), organiser: x.organizerId?.name || '', reminders: x.recording?.reminderCancelledAt ? 'Cancelled' : `${x.recording?.reminderCount || 0} sent`, daysSince: days(x.date) }));
    return { columns: cols(['title', 'Meeting'], ['date', 'Held on'], ['organiser', 'Organiser'], ['reminders', 'Reminders'], ['daysSince', 'Days since']), rows, summary: [['Missing recordings', rows.length]] };
  } });

R.push({ key: 'goals_progress', title: 'Quarterly goals & evidence', category: 'Work & Delivery', module: ['work_reports', 'goals'], description: 'Progress of goals by quarter, with whether evidence was provided and verified.', params: ['quarter'],
  run: async ({ orgId, params }) => {
    const f: any = { organizationId: orgId };
    if (params.quarter) f.quarter = String(params.quarter).toUpperCase().replace(/^(\d{4})[\s-]*Q/, '$1-Q');
    const g = await Goal.find(live(f)).populate('ownerId', 'name').sort({ quarter: -1, title: 1 });
    const rows = g.map((x: any) => ({ title: x.title, quarter: x.quarter || '', owner: x.ownerId?.name || '', progress: x.progressPercent || 0, status: x.status, evidence: (x.evidence || []).length, verified: x.verifiedAt ? 'Yes' : x.status === 'completed' ? 'AWAITING' : '' }));
    return { columns: cols(['title', 'Goal'], ['quarter', 'Quarter'], ['owner', 'Owner'], ['progress', 'Progress %'], ['status', 'Status'], ['evidence', 'Evidence'], ['verified', 'Verified']), rows, summary: [['Goals', rows.length], ['Completed', rows.filter((x) => x.status === 'completed').length], ['Completed without evidence', rows.filter((x) => x.status === 'completed' && !x.evidence).length]] };
  } });

export const REPORTS = R;
export const REPORT_MAP = new Map(R.map((r) => [r.key, r]));
export const reportModules = (r: ReportDef) => (Array.isArray(r.module) ? r.module : [r.module]);
