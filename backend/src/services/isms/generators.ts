import ExcelJS from 'exceljs';
import { REGISTERS, REGISTER_MAP, RegisterDef } from '../../config/isms';
import { IsmsRecord } from '../../models/Isms';
import { Asset } from '../../models/Asset';
import { User } from '../../models/User';
import { Vendor } from '../../models/Vendor';
import { OutsourcedReview, SecurityControl } from '../../models/Security';
import { Incident, Policy, PolicyAcknowledgement, AccessReview } from '../../models/Governance';
import { ThreatIntel } from '../../models/ThreatIntel';
import { ControlTask } from '../../models/Controls';
import { Document } from '../../models/Document';
import { MODULE_MAP } from '../../config/modules';
import { effectiveModules } from '../access.service';
import { frontPage, newWorkbook, table, toBuffer } from './xlsx';

export interface GenCtx { orgId: string; orgName: string; by: string }
export interface Generator { key: string; title: string; docId: string; group: string; clause: string; policy: string; source: 'records' | 'app'; build: (ctx: GenCtx) => Promise<Buffer>; fileName: string }

const iso = (d: any) => (d ? new Date(d) : '');
const yn = (b: any) => (b === true ? 'Yes' : b === false ? 'No' : '');
const slug = (s: string) => s.replace(/[^A-Za-z0-9]+/g, '_').replace(/^_|_$/g, '');
const pick = (a: any, ...keys: string[]) => { for (const k of keys) { const v = a[k] ?? a.details?.[k]; if (v !== undefined && v !== null && v !== '') return v instanceof Date ? v : Array.isArray(v) ? v.join(', ') : v; } return ''; };

/* ----------------------------------------------------- generic (IsmsRecord) */
async function recordRows(orgId: string, def: RegisterDef) {
  const recs = await IsmsRecord.find({ organizationId: orgId, register: def.key, isDeleted: { $ne: true } }).sort({ createdAt: 1 }).lean();
  return recs.map((r: any, i: number) => [i + 1, r.refNo, r.status, r.ownerName || '', ...def.cols.map((c) => r.data?.[c.key]), iso(r.updatedAt), r.evidenceUrl || '']);
}
const recordHeaders = (def: RegisterDef) => ['S/N', 'Ref', 'Status', 'Owner', ...def.cols.map((c) => c.label), 'Last updated', 'Evidence link'];
const dateIdx = (def: RegisterDef) => [...def.cols.map((c, i) => (c.type === 'date' ? i + 4 : -1)).filter((i) => i >= 0), 4 + def.cols.length];

function recordGenerator(def: RegisterDef): Generator {
  return {
    key: def.key, title: def.title, docId: def.docId, group: def.group, clause: def.clause, policy: def.policy, source: 'records', fileName: `${slug(def.docId)}_${slug(def.title)}.xlsx`,
    build: async (ctx) => {
      const wb = newWorkbook(ctx.by);
      frontPage(wb, { docId: def.docId, title: def.title, clause: def.clause, policy: def.policy, orgName: ctx.orgName, generatedBy: ctx.by });
      const rows = await recordRows(ctx.orgId, def);
      table(wb, def.title, recordHeaders(def), rows, { title: def.title, dateCols: dateIdx(def) });
      if (def.key === 'risk') await riskExtras(wb, ctx);
      if (def.key === 'metric') await metricSummary(wb, ctx);
      if (def.key === 'legal') await legalSummary(wb, ctx);
      return toBuffer(wb);
    },
  };
}

async function riskExtras(wb: ExcelJS.Workbook, ctx: GenCtx) {
  const recs: any[] = await IsmsRecord.find({ organizationId: ctx.orgId, register: 'risk', isDeleted: { $ne: true } }).lean();
  const count = (f: (r: any) => string) => ['Major', 'Moderate', 'Minor', ''].map((lvl) => recs.filter((r) => f(r) === lvl && (lvl !== '' || true)).length);
  const before = count((r) => r.data?.classification || ''); const after = count((r) => r.data?.rClassification || '');
  table(wb, 'ISMS Risk Report', ['Risk level', 'Before treatment', 'After treatment'], ['Major', 'Moderate', 'Minor', 'Not scored'].map((l, i) => [l, before[i], after[i]]).concat([['Total', recs.length, recs.length]]), { title: 'ISMS RISK REPORT' });
}
async function metricSummary(wb: ExcelJS.Workbook, ctx: GenCtx) {
  const recs: any[] = await IsmsRecord.find({ organizationId: ctx.orgId, register: 'metric', isDeleted: { $ne: true } }).lean();
  const met = recs.filter((r) => r.data?.targetMet === 'Yes').length; const missed = recs.filter((r) => r.data?.targetMet === 'No').length;
  table(wb, 'Summary', ['Measure', 'Value'], [['Metrics', recs.length], ['Target met', met], ['Target missed', missed], ['Not yet measured', recs.length - met - missed], ['Measured automatically', recs.filter((r) => r.data?.autoSource).length]], { title: 'METRICS SUMMARY' });
}
async function legalSummary(wb: ExcelJS.Workbook, ctx: GenCtx) {
  const recs: any[] = await IsmsRecord.find({ organizationId: ctx.orgId, register: 'legal', isDeleted: { $ne: true } }).lean();
  const kinds = ['Legal', 'Applicable Standard', 'Regulatory', 'Contractual', 'Certificate'];
  table(wb, 'Summary', ['Type', 'Total', 'Compliant / valid', 'Work in progress / in renewal', 'Non-compliant / expired', '% compliant'],
    kinds.map((k) => { const x = recs.filter((r) => r.data?.kind === k); const ok = x.filter((r) => ['Compliant', 'Valid'].includes(r.status)).length; return [k, x.length, ok, x.filter((r) => ['Work in progress', 'In renewal'].includes(r.status)).length, x.filter((r) => ['Non-compliant', 'Expired'].includes(r.status)).length, x.length ? Math.round((ok / x.length) * 100) / 100 : 0]; }), { title: 'LEGAL REGISTER SUMMARY' });
}

/* ------------------------------------------------------------ asset register */
const SHEETS: Array<{ name: string; headers: string[]; row: (a: any, n: number) => unknown[] }> = [];
const CIA3 = (a: any) => [pick(a, 'confidentiality'), pick(a, 'integrity'), pick(a, 'availability'), a.value ?? ''];
SHEETS.push(
  { name: 'Digital Asset', headers: ['#', 'Asset Title', 'Asset ID', 'Owner', 'Custodian', 'Location', 'Classification', 'Storage Details', 'Type/Format', 'Life Cycle', 'Disposal Method', 'Backup Schedule', 'Backup Location', 'Confidentiality Requirement', 'Integrity Requirements', 'Availability Requirements', 'Value'],
    row: (a, n) => [n, a.title, a.assetId, a.owner, a.custodian, a.location, a.classification, pick(a, 'storageDetails'), pick(a, 'format', 'subCategory'), a.lifecycleStatus, a.disposalMethod, a.backupSchedule, a.backupLocation, ...CIA3(a)] },
  { name: 'Business Databases', headers: ['#', 'Asset Title', 'Asset ID', 'Owner', 'Custodian', 'Users', 'Location', 'Sys Admin', 'Life Cycle', 'Technical Contact', 'Vendor', 'Expected Life', 'Maintenance Status', 'Purpose / Service / Role', 'Dependency', 'Backup Schedule', 'Backup Location', 'Confidentiality Requirement', 'Integrity Requirements', 'Availability Requirements', 'Value'],
    row: (a, n) => [n, a.title, a.assetId, a.owner, a.custodian, a.users, a.location, pick(a, 'sysAdmin'), a.lifecycleStatus, pick(a, 'technicalContact'), a.vendor, a.expectedLifeMonths ? `${a.expectedLifeMonths} months` : '', a.maintenanceStatus, a.description, pick(a, 'dependency'), a.backupSchedule, a.backupLocation, ...CIA3(a)] },
  { name: 'Source Code', headers: ['#', 'Source Code', 'Asset ID', 'Owner', 'Custodian', 'Users', 'Location', 'Project Manager', 'Life Cycle', 'Technical Contact', 'Version Number', 'Maintenance Status', 'Purpose / Service / Role', 'Dependency', 'Backup Schedule', 'Backup Location', 'Confidentiality Requirement', 'Integrity Requirements', 'Availability Requirements', 'Value'],
    row: (a, n) => [n, a.title, a.assetId, a.owner, a.custodian, a.users, a.location, pick(a, 'projectManager'), a.lifecycleStatus, pick(a, 'technicalContact'), a.version, a.maintenanceStatus, a.description, pick(a, 'dependency'), a.backupSchedule, a.backupLocation, ...CIA3(a)] },
  { name: 'Software', headers: ['#', 'Software', 'Asset ID', 'Owner', 'Custodian', 'Users', 'Classification', 'Serial Number', 'Type', 'Location', 'Version', 'License Details', 'No. Of Licenses', 'Technical Contact', 'Vendor', 'Expected Life', 'Licence expiry', 'Maintenance Status', 'Purpose / Service / Role', 'Dependency', 'Confidentiality Requirement', 'Integrity Requirements', 'Availability Requirements', 'Value'],
    row: (a, n) => [n, a.title, a.assetId, a.owner, a.custodian, a.users, a.classification, a.serialNumber, pick(a, 'subCategory'), a.location, a.version, pick(a, 'licenseDetails'), pick(a, 'licenseCount'), pick(a, 'technicalContact'), a.vendor, a.expectedLifeMonths ? `${a.expectedLifeMonths} months` : '', iso(a.licenseExpiryDate), a.maintenanceStatus, a.description, pick(a, 'dependency'), ...CIA3(a)] },
  { name: 'Non Digital Assets', headers: ['#', 'Asset Title', 'Asset ID', 'Owner', 'Custodian', 'Users', 'Location', 'Storage Details', 'Classification', 'Life Cycle', 'Disposal Method', 'Backup', 'Backup Location', 'Confidentiality Requirement', 'Integrity Requirements', 'Availability Requirements', 'Value', 'Active/Inactive'],
    row: (a, n) => [n, a.title, a.assetId, a.owner, a.custodian, a.users, a.location, pick(a, 'storageDetails', 'subCategory'), a.classification, a.lifecycleStatus, a.disposalMethod, a.backupSchedule, a.backupLocation, ...CIA3(a), ['active', 'under_maintenance'].includes(a.lifecycleStatus) ? 'Active' : 'Inactive'] },
  { name: 'People Assets', headers: ['#', 'Role', 'Name', 'Department', 'Reporting to', 'Access to High Value Info.', 'Alternate Role', 'NDA Requirements', 'KRA', 'Min. Required Capabilities', 'Confidentiality Requirement', 'Integrity Requirements', 'Availability Requirements', 'Value'],
    row: (a, n) => [n, pick(a, 'role', 'subCategory'), a.title, pick(a, 'department'), pick(a, 'reportingTo'), pick(a, 'highValueAccess'), pick(a, 'alternateRole'), pick(a, 'ndaRequired'), a.description, pick(a, 'capabilities'), ...CIA3(a)] },
  { name: 'Servers', headers: ['#', 'Server Name', 'Asset ID', 'Owner', 'Custodian', 'Users', 'Classification', 'Serial Number', 'IP Address', 'Host Name', 'OS', 'Software/Application Details', 'Technical Contact', 'Vendor', 'Expected Life', 'Maintenance Status', 'SLA', 'Make / Model', 'CPU', 'RAM', 'HDD', 'Purpose / Service / Role', 'Dependency', 'Stored Information Assets', 'Backup Schedule', 'Confidentiality Requirement', 'Integrity Requirements', 'Availability Requirements', 'Value'],
    row: (a, n) => [n, a.title, a.assetId, a.owner, a.custodian, a.users, a.classification, a.serialNumber, pick(a, 'ipAddress'), pick(a, 'hostName'), pick(a, 'os'), pick(a, 'software'), pick(a, 'technicalContact'), a.vendor, a.expectedLifeMonths ? `${a.expectedLifeMonths} months` : '', a.maintenanceStatus, pick(a, 'sla'), a.makeModel, pick(a, 'cpu'), pick(a, 'ram'), pick(a, 'hdd'), a.description, pick(a, 'dependency'), pick(a, 'storedInformation'), a.backupSchedule, ...CIA3(a)] },
  { name: 'Network Devices', headers: ['#', 'Device Name', 'Asset ID', 'Owner', 'Custodian', 'Users', 'Classification', 'Serial Number', 'IP Address', 'Hostname', 'Location', 'Technical Contact', 'Vendor', 'Expected Life', 'Maintenance Status', 'SLA', 'Make / Model', 'Purpose / Service / Role', 'Configuration Backup', 'Backup Schedule', 'Backup Location', 'Dependency', 'Confidentiality Requirement', 'Integrity Requirements', 'Availability Requirements', 'Value'],
    row: (a, n) => [n, a.title, a.assetId, a.owner, a.custodian, a.users, a.classification, a.serialNumber, pick(a, 'ipAddress'), pick(a, 'hostName'), a.location, pick(a, 'technicalContact'), a.vendor, a.expectedLifeMonths ? `${a.expectedLifeMonths} months` : '', a.maintenanceStatus, pick(a, 'sla'), a.makeModel, a.description, pick(a, 'configBackup'), a.backupSchedule, a.backupLocation, pick(a, 'dependency'), ...CIA3(a)] },
  { name: 'DesktopsLaptops', headers: ['#', 'Device Name', 'Asset ID', 'Owner', 'Custodian', 'User [Role]', 'Classification', 'Serial Number', 'Asset Location', 'IP Address', 'Machine Name', 'Vendor', 'Expected Life', 'Maintenance Status', 'Make / Model', 'CPU', 'RAM', 'HDD/SDD', 'Used out of premises', 'Anti Virus', 'Backup Details', 'Backup Schedule', 'Stored Information Assets', 'Confidentiality Requirement', 'Integrity Requirements', 'Availability Requirements', 'Value'],
    row: (a, n) => [n, a.title, a.assetId, a.owner, a.custodian, a.users || a.assignedToName, a.classification, a.serialNumber, a.location, pick(a, 'ipAddress'), pick(a, 'machineName'), a.vendor, a.expectedLifeMonths ? `${a.expectedLifeMonths} months` : '', a.maintenanceStatus, a.makeModel, pick(a, 'cpu'), pick(a, 'ram'), pick(a, 'hdd'), pick(a, 'outOfPremises'), pick(a, 'antivirus'), a.backupDetails, a.backupSchedule, pick(a, 'storedInformation'), ...CIA3(a)] },
  { name: 'Storage Media', headers: ['#', 'Media Name', 'Asset ID', 'Owner', 'Custodian', 'User [Role]', 'Classification', 'Serial Number', 'Asset Location', 'Make / Model', 'Capacity', 'Stored off premises', 'Backup Schedule', 'Restoration Check Schedule', 'Stored Information Assets', 'Confidentiality Requirement', 'Integrity Requirements', 'Availability Requirements', 'Value'],
    row: (a, n) => [n, a.title, a.assetId, a.owner, a.custodian, a.users, a.classification, a.serialNumber, a.location, a.makeModel, pick(a, 'capacity'), pick(a, 'offPremises'), a.backupSchedule, pick(a, 'restoreCheck'), pick(a, 'storedInformation'), ...CIA3(a)] },
  { name: 'Support Utilities', headers: ['#', 'Utility', 'Asset ID', 'Owner', 'Custodian', 'User [Role]', 'Classification', 'Serial Number', 'Asset Location', 'Purpose', 'SLA', 'Make / Model', 'Capacity', 'Redundancy Requirements', 'Confidentiality Requirement', 'Integrity Requirements', 'Availability Requirements', 'Value'],
    row: (a, n) => [n, a.title, a.assetId, a.owner, a.custodian, a.users, a.classification, a.serialNumber, a.location, a.description, pick(a, 'sla'), a.makeModel, pick(a, 'capacity'), pick(a, 'redundancy'), ...CIA3(a)] },
);

/** Which company sheet an app asset belongs to (category + sub-category wording). */
export function assetSheet(a: { category: string; subCategory?: string; title?: string }): string {
  const s = `${a.subCategory || ''} ${a.title || ''}`.toLowerCase();
  if (/database|\bdb\b|postgres|mongo|mysql/.test(s)) return 'Business Databases';
  if (/source ?code|repository|\brepo\b|github|gitlab/.test(s)) return 'Source Code';
  switch (a.category) {
    case 'software': case 'cloud': return /server|vps|vm\b|instance/.test(s) ? 'Servers' : 'Software';
    case 'information': return 'Digital Asset';
    case 'network': return 'Network Devices';
    case 'people': return 'People Assets';
    case 'facilities': case 'services': return 'Support Utilities';
    case 'hardware':
      if (/laptop|desktop|\bpc\b|workstation|macbook|notebook/.test(s)) return 'DesktopsLaptops';
      if (/server/.test(s)) return 'Servers';
      if (/usb|disk|drive|media|tape|hdd|ssd|backup/.test(s)) return 'Storage Media';
      if (/printer|ups|generator|air ?con|cctv|inverter|projector|scanner|router|modem/.test(s)) return /router|modem/.test(s) ? 'Network Devices' : 'Support Utilities';
      return 'Non Digital Assets';
    default: return 'Digital Asset';
  }
}

async function assetBook(ctx: GenCtx) {
  const wb = newWorkbook(ctx.by);
  frontPage(wb, { docId: 'GSJX-ISMS/REG-1002', title: 'ISMS Asset Register', clause: 'A.5.9 / A.5.10', policy: 'Acceptable Use of Information and Other Related Assets; Classification of Information & Labelling', orgName: ctx.orgName, generatedBy: ctx.by, note: 'Each asset is placed on the sheet that matches its category and sub-category; fields the app does not hold are blank.' });
  const assets: any[] = await Asset.find({ organizationId: ctx.orgId, isDeleted: { $ne: true }, lifecycleStatus: { $ne: 'disposed' } }).sort({ assetId: 1 }).lean();
  const users = new Map((await User.find({ organizationId: ctx.orgId }).select('name').lean()).map((u: any) => [String(u._id), u.name]));
  for (const a of assets) a.assignedToName = a.assignedToId ? users.get(String(a.assignedToId)) || '' : '';
  const by = new Map<string, any[]>(SHEETS.map((s) => [s.name, []]));
  for (const a of assets) by.get(assetSheet(a))!.push(a);
  for (const s of SHEETS) table(wb, s.name, s.headers, by.get(s.name)!.map((a, i) => s.row(a, i + 1)), { title: `List of ${s.name} and Valuation` });
  table(wb, 'Review status', ['Asset ID', 'Title', 'Category', 'Next review', 'End of life', 'EOL state', 'Data-quality flags'], assets.map((a) => [a.assetId, a.title, a.category, iso(a.nextReviewDate), iso(a.endOfLifeDate), a.eolState, (a.dataQualityFlags || []).join(', ')]), { title: 'Asset review and end-of-life', dateCols: [3, 4] });
  return { wb, count: assets.length };
}

/* ------------------------------------------------------------ access register */
const SENSITIVE_MODULES = Object.values(MODULE_MAP).filter((m) => m.sensitive).map((m) => m.key);
async function accessBook(ctx: GenCtx) {
  const wb = newWorkbook(ctx.by);
  frontPage(wb, { docId: 'GSJX-ISMS/REG-1026', title: 'IT Access Right Register', clause: 'A.5.15 / A.5.18', policy: 'ISMS Access Control', orgName: ctx.orgName, generatedBy: ctx.by, note: 'Covers access to GLOBAL SJX OS modules. Access to outside platforms (Google Workspace, Zoho, cPanel, GitHub …) is not held in the app and must be recorded in an access review.' });
  const users: any[] = await User.find({ organizationId: ctx.orgId, isActive: true, role: { $nin: ['client', 'vendor', 'training_customer'] } }).sort({ name: 1 }).lean();
  const reviews: any[] = await AccessReview.find({ organizationId: ctx.orgId, isDeleted: { $ne: true } }).sort({ createdAt: -1 }).limit(4).lean();
  const decision = new Map<string, any>();
  for (const r of reviews.slice().reverse()) for (const it of r.items || []) decision.set(String(it.userId), { ...it, review: r.reference, completedAt: r.completedAt });
  const rows: unknown[][] = [];
  for (const [i, u] of users.entries()) {
    const mods = await effectiveModules(u).catch(() => [] as string[]);
    const d = decision.get(String(u._id));
    rows.push([i + 1, u.name, u.email, u.department || '', u.jobTitle || '', u.role, yn(u.mfaEnabled), iso(u.lastLoginAt), mods.length, mods.filter((m) => SENSITIVE_MODULES.includes(m)).join(', '), d ? `${d.decision} (${d.review})` : 'Not yet reviewed', d?.decidedAt ? iso(d.decidedAt) : '']);
  }
  table(wb, 'ACCESS RIGHT', ['S/N', 'Name', 'Email / User ID', 'Department', 'Job title', 'Role', 'MFA on', 'Last login', 'Modules granted', 'Sensitive modules', 'Latest review decision', 'Review date'], rows, { title: 'IT ACCESS RIGHT REGISTER', dateCols: [7, 11] });
  const admins = users.filter((u) => ['super_admin', 'ceo', 'coo'].includes(u.role));
  table(wb, 'ADMIN ACCESS RIGHT', ['S/N', 'Name', 'Email / User ID', 'Role', 'MFA on', 'Last login'], admins.map((u, i) => [i + 1, u.name, u.email, u.role, yn(u.mfaEnabled), iso(u.lastLoginAt)]), { title: 'ADMIN ACCESS RIGHT', dateCols: [5] });
  return { wb, count: users.length };
}

/* ------------------------------------------------------------- app-backed sets */
function appGenerator(g: Omit<Generator, 'build' | 'source' | 'fileName'> & { run: (ctx: GenCtx) => Promise<{ wb: ExcelJS.Workbook; count: number }> }): Generator {
  return { key: g.key, title: g.title, docId: g.docId, group: g.group, clause: g.clause, policy: g.policy, source: 'app', fileName: `${slug(g.docId)}_${slug(g.title)}.xlsx`, build: async (ctx) => toBuffer((await g.run(ctx)).wb) };
}
const simple = (docId: string, title: string, clause: string, policy: string, ctx: GenCtx, note?: string) => { const wb = newWorkbook(ctx.by); frontPage(wb, { docId, title, clause, policy, orgName: ctx.orgName, generatedBy: ctx.by, note }); return wb; };

const APP_GENERATORS: Generator[] = [
  appGenerator({ key: 'asset', title: 'ISMS Asset Register', docId: 'GSJX-ISMS/REG-1002', group: 'Operation', clause: 'A.5.9', policy: 'Acceptable Use of Information and Other Related Assets', run: assetBook }),
  appGenerator({ key: 'access', title: 'IT Access Right Register', docId: 'GSJX-ISMS/REG-1026', group: 'Operation', clause: 'A.5.15 / A.5.18', policy: 'ISMS Access Control', run: accessBook }),
  appGenerator({ key: 'incident', title: 'Incident Register', docId: 'GSJX-ISMS/REG-1036', group: 'Operation', clause: 'A.5.24–A.5.27', policy: 'ISMS Information Security Incident Management', run: async (ctx) => {
    const wb = simple('GSJX-ISMS/REG-1036', 'Incident Register', 'A.5.24–A.5.27', 'ISMS Information Security Incident Management', ctx);
    const list: any[] = await Incident.find({ organizationId: ctx.orgId, isDeleted: { $ne: true } }).sort({ detectedAt: -1 }).lean();
    table(wb, 'Incidents', ['Reference', 'Title', 'Category', 'Severity', 'Status', 'Detected', 'Contained', 'Resolved', 'Personal-data breach', 'Regulator notified', 'Root cause', 'Lessons learned', 'Open actions'],
      list.map((i) => [i.reference, i.title, i.category, i.severity, i.status, iso(i.detectedAt), iso(i.containedAt), iso(i.resolvedAt), yn(i.isPersonalDataBreach), i.isPersonalDataBreach ? yn(i.breach?.regulatorNotified) : '', i.rootCause, i.lessonsLearned, (i.actions || []).filter((a: any) => !a.done).length]), { title: 'INCIDENT REGISTER', dateCols: [5, 6, 7] });
    return { wb, count: list.length };
  } }),
  appGenerator({ key: 'threat', title: 'Threat Register', docId: 'GSJX-ISMS/REG-1034', group: 'Operation', clause: 'A.5.7', policy: 'Threat Intelligence Policy', run: async (ctx) => {
    const wb = simple('GSJX-ISMS/REG-1034', 'Threat Register', 'A.5.7', 'Threat Intelligence Policy', ctx);
    const list: any[] = await ThreatIntel.find({ organizationId: ctx.orgId, isDeleted: { $ne: true } }).sort({ createdAt: -1 }).limit(2000).lean();
    table(wb, 'THREAT REGISTER', ['Threat ID', 'Threat', 'Description of Threat', 'Likely Affected Asset', 'Severity', 'Source', 'Category', 'Remediation Efforts', 'Status', 'Recorded'], list.map((t) => [t.reference, t.title, t.summary, (t.affectedProducts || []).join(', '), t.severity, t.sourceName, t.category, t.recommendations, t.status, iso(t.createdAt)]), { title: 'THREAT REGISTER', dateCols: [9] });
    return { wb, count: list.length };
  } }),
  appGenerator({ key: 'soa', title: 'Statement of Applicability & Controls', docId: 'GSJX-ISMS/REG-1035', group: 'Planning', clause: '6.1.3', policy: 'ISMS Control of Risks and Opportunities', run: async (ctx) => {
    const wb = simple('GSJX-ISMS/REG-1035', 'Statement of Applicability & Controls', '6.1.3', 'ISMS Control of Risks and Opportunities', ctx);
    const list: any[] = await SecurityControl.find({ organizationId: ctx.orgId, isDeleted: { $ne: true } }).sort({ ref: 1 }).lean();
    table(wb, 'Controls', ['Control', 'Title', 'Statement', 'Domain', 'Status', 'Enforced in code', 'Evidence items', 'Last reviewed', 'Next review'], list.map((c) => [c.ref, c.title, c.statement, c.domain, String(c.status).replace(/_/g, ' '), yn(c.automated), (c.evidence || []).length, iso(c.lastReviewedAt), iso(c.nextReviewAt)]), { title: 'CONTROLS (ISO/IEC 27001:2022 Annex A)', dateCols: [7, 8] });
    const tasks: any[] = await ControlTask.find({ organizationId: ctx.orgId, isDeleted: { $ne: true } }).sort({ nextDueAt: 1 }).lean();
    table(wb, 'Recurring control tasks', ['Control task', 'ISO ref', 'Policy', 'Every (days)', 'Status', 'Next due', 'Last completed', 'Completed by'], tasks.map((t) => [t.title, t.isoRef, t.policyRef, t.frequencyDays, t.status, iso(t.nextDueAt), iso(t.lastCompletedAt), t.lastCompletedByName]), { title: 'RECURRING CONTROL TASKS (Action Item Sheet)', dateCols: [5, 6] });
    return { wb, count: list.length };
  } }),
  appGenerator({ key: 'doc_log', title: 'Document & Record Log', docId: 'GSJX-ISMS/REG-1025', group: 'Support', clause: '7.5', policy: 'ISMS Control of Management System Documentation', run: async (ctx) => {
    const wb = simple('GSJX-ISMS/REG-1025', 'Document & Record Log', '7.5', 'ISMS Control of Management System Documentation', ctx);
    const pols: any[] = await Policy.find({ organizationId: ctx.orgId, isDeleted: { $ne: true } }).sort({ code: 1 }).lean();
    const staff = await User.countDocuments({ organizationId: ctx.orgId, isActive: true, role: { $nin: ['client', 'vendor', 'training_customer'] } });
    const acks = await PolicyAcknowledgement.aggregate([{ $group: { _id: { p: '$policyId', v: '$version' }, n: { $sum: 1 } } }]).catch(() => [] as any[]);
    const ackN = new Map<string, number>(acks.map((x: any) => [`${x._id.p}:${x._id.v}`, x.n]));
    table(wb, 'ISMS', ['Document ID', 'Document Name', 'Category', 'REVIEW ? (Yes/No)', 'APPROVED ? (Yes/No)', 'DISTRIBUTED ? (Yes/No)', 'CURRENT VERSION', 'Acknowledged by', 'Next review', 'LINKS'],
      pols.map((p) => [p.code, p.title, p.category, ['in_review', 'approved'].includes(p.status) ? 'Yes' : 'No', p.status === 'approved' ? 'Yes' : 'No', p.status === 'approved' && p.requiresAcknowledgement ? 'Yes' : 'No', p.version, `${ackN.get(`${p._id}:${p.version}`) || 0} of ${staff}`, iso(p.nextReviewAt), p.documentUrl || '']), { title: 'ISMS DOCUMENTS (policies and procedures)', dateCols: [8] });
    const docs: any[] = await Document.find({ organizationId: ctx.orgId, isDeleted: { $ne: true } }).sort({ title: 1 }).limit(3000).lean();
    table(wb, 'ISMS Records', ['Document', 'Category', 'Current version', 'Review date', 'Expiry date', 'LINKS'], docs.map((d) => [d.title, d.category, (d.versions || []).length || 1, iso(d.reviewDate), iso(d.expiryDate), d.url || '']), { title: 'RECORDS AND DOCUMENT LIBRARY', dateCols: [3, 4] });
    return { wb, count: pols.length + docs.length };
  } }),
  appGenerator({ key: 'supplier', title: 'Supplier / Vendor Register & Evaluation', docId: 'GSJX-ISMS/REG-1032', group: 'Operation', clause: 'A.5.19–A.5.22', policy: 'Information Security in Supplier Relationships', run: async (ctx) => {
    const wb = simple('GSJX-ISMS/REG-1032', 'Supplier / Vendor Register & Evaluation', 'A.5.19–A.5.22', 'Information Security in Supplier Relationships', ctx);
    const vendors: any[] = await Vendor.find({ organizationId: ctx.orgId, isDeleted: { $ne: true } }).sort({ name: 1 }).lean();
    const reviews: any[] = await OutsourcedReview.find({ organizationId: ctx.orgId, isDeleted: { $ne: true } }).lean();
    const rv = new Map<string, any>(reviews.filter((r) => r.vendorId).map((r) => [String(r.vendorId), r]));
    table(wb, 'SUPPLIERS VENDORS MASTER LIST', ['Full Names/name of Company', 'Primary Contact Person', 'Phone Number', 'Email Addresses', 'Valid Location Addresses', 'Purpose of Engagement', 'Status', 'Performance rating (1-5)', 'Risk rating', 'Security clauses', 'NDA signed', 'Right to audit', 'Last security review', 'Next review', 'Contract end'],
      vendors.map((v) => { const c = (v.contacts || []).find((x: any) => x.isPrimary) || (v.contacts || [])[0] || {}; const r = rv.get(String(v._id)) || {}; const end = (v.contracts || []).map((x: any) => x.endDate).filter(Boolean).sort().pop();
        return [v.name, c.name, c.phone || v.phone, c.email || v.email, v.address, (v.products || []).join(', '), v.status, v.performanceRating, r.riskRating, yn(r.securityClausesInPlace), yn(r.ndaSigned), yn(r.rightToAudit), iso(r.lastReviewAt), iso(r.nextReviewAt || v.renewalDate), iso(end)]; }), { title: 'SUPPLIERS / VENDOR MASTER LIST', dateCols: [12, 13, 14] });
    table(wb, 'Security reviews', ['Supplier', 'Scope', 'Contract ref', 'Status', 'Risk', 'Security clauses', 'Testing evidence', 'Right to audit', 'NDA', 'Last review', 'Next review', 'Findings'], reviews.map((r) => [r.supplier, r.scope, r.contractRef, r.status, r.riskRating, yn(r.securityClausesInPlace), yn(r.securityTestingEvidence), yn(r.rightToAudit), yn(r.ndaSigned), iso(r.lastReviewAt), iso(r.nextReviewAt), r.findings]), { title: 'INFOSEC / BUSINESS-CONTINUITY SUPPLIER REVIEWS', dateCols: [9, 10] });
    return { wb, count: vendors.length };
  } }),
  appGenerator({ key: 'roles_tracker', title: 'ISMS Standardization Roles Tracker', docId: 'GSJX-ISMS/REG-1008', group: 'Context & leadership', clause: '5.3', policy: 'ISMS - Roles, Responsibilities and Authorities', run: async (ctx) => {
    const wb = simple('GSJX-ISMS/REG-1008', 'ISMS Standardization Roles Tracker', '5.3', 'ISMS - Roles, Responsibilities and Authorities', ctx);
    const users: any[] = await User.find({ organizationId: ctx.orgId, isActive: true, role: { $nin: ['client', 'vendor', 'training_customer'] } }).sort({ name: 1 }).lean();
    const depts = new Map<string, any[]>();
    for (const u of users) for (const d of u.headOfDepartments || []) depts.set(d, [...(depts.get(d) || []), u]);
    const allDepts = Array.from(new Set(users.map((u) => u.department).filter(Boolean))).sort();
    table(wb, 'Department Details', ['S/N', 'Department / Unit', 'Head', 'Head email', 'Head phone', 'Staff'], allDepts.map((d, i) => { const h = (depts.get(d) || [])[0]; return [i + 1, d, h?.name || '(not set)', h?.email, h?.phone, users.filter((u) => u.department === d).length]; }), { title: 'DEPARTMENT DETAILS' });
    table(wb, 'Project Team Directory', ['S/N', 'Full Name', 'Department', 'Role(s)', 'Email', 'Phone No'], users.map((u, i) => [i + 1, u.name, u.department, [u.jobTitle, u.role].filter(Boolean).join(' / '), u.email, u.phone]), { title: 'PROJECT TEAM DIRECTORY' });
    const roles: any[] = await IsmsRecord.find({ organizationId: ctx.orgId, register: 'isms_role', isDeleted: { $ne: true } }).sort({ createdAt: 1 }).lean();
    table(wb, 'Role Description', ['S/N', 'ISMS Role', 'Purpose', 'Key Responsibilities', 'Authorities', 'Required Competence', 'Reports to', 'Held by', 'Deputy / Backup'], roles.map((r, i) => [i + 1, r.data?.role, r.data?.purpose, r.data?.responsibilities, r.data?.authorities, r.data?.competence, r.data?.reportsTo, r.data?.heldBy, r.data?.deputy]), { title: 'ROLE DESCRIPTIONS – ISO/IEC 27001' });
    return { wb, count: users.length };
  } }),
];

export const GENERATORS: Generator[] = [...APP_GENERATORS, ...REGISTERS.filter((r) => r.key !== 'isms_role').map(recordGenerator), recordGenerator(REGISTER_MAP.isms_role)];
export const GENERATOR_MAP: Record<string, Generator> = Object.fromEntries(GENERATORS.map((g) => [g.key, g]));
