import { Obligation, Policy, ProcessingActivity } from '../models/Governance';
import { User } from '../models/User';
import { logger } from '../utils/logger';

const nextDay = (day: number) => { const now = new Date(); const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), day, 9)); if (d < now) d.setUTCMonth(d.getUTCMonth() + 1); return d; };
const inMonths = (m: number, day = 1) => { const d = new Date(); d.setUTCMonth(d.getUTCMonth() + m, day); d.setUTCHours(9, 0, 0, 0); return d; };

const OBLIGATIONS = [
  { title: 'Remit monthly VAT', category: 'tax', authority: 'FIRS', frequency: 'monthly', day: 21, notifyModules: ['taxes'], description: 'File and pay VAT collected for the previous month by the 21st.' },
  { title: 'Remit monthly Withholding Tax (WHT)', category: 'tax', authority: 'FIRS', frequency: 'monthly', day: 21, notifyModules: ['taxes'], description: 'Remit WHT deducted from supplier payments by the 21st of the following month.' },
  { title: 'Remit PAYE (staff income tax)', category: 'tax', authority: 'State IRS', frequency: 'monthly', day: 10, notifyModules: ['taxes'], description: 'Remit PAYE deducted from staff salaries by the 10th.' },
  { title: 'Monthly management review of security metrics', category: 'security', authority: 'Internal', frequency: 'monthly', day: 5, notifyModules: ['reports'], description: 'Review the Security & Compliance Scorecard and agree actions (ISO 27001 clause 9.3).' },
  { title: 'Quarterly user access review', category: 'security', authority: 'Internal', frequency: 'quarterly', day: 15, notifyModules: ['access_control'], description: 'Review every user’s role and module access; remove what is no longer needed (A.5.18).' },
  { title: 'Test backups & restore procedure', category: 'security', authority: 'Internal', frequency: 'quarterly', day: 20, notifyModules: ['assets'], description: 'Perform a restore test of critical data and record the evidence (A.8.13).' },
  { title: 'Business-continuity / incident response exercise', category: 'security', authority: 'Internal', frequency: 'biannual', day: 25, notifyModules: ['incidents'], description: 'Run a tabletop exercise and record lessons learned (A.5.29, A.5.30).' },
  { title: 'Internal ISMS audit', category: 'security', authority: 'Internal', frequency: 'annual', day: 15, notifyModules: ['compliance'], description: 'Annual internal audit of the ISMS (ISO 27001 clause 9.2).' },
  { title: 'Annual NDPA data-protection compliance audit return', category: 'data_protection', authority: 'NDPC', frequency: 'annual', day: 15, notifyModules: ['data_protection'], description: 'File the annual data-protection audit return with the NDPC (March 31st for most organisations).' },
  { title: 'Security awareness training for all staff', category: 'hr', authority: 'Internal', frequency: 'annual', day: 10, notifyModules: ['employees'], description: 'Annual awareness refresher for everyone, plus induction for joiners (A.6.3).' },
  { title: 'Annual company returns (CAC)', category: 'regulatory', authority: 'CAC', frequency: 'annual', day: 28, notifyModules: ['compliance'], description: 'File annual returns with the Corporate Affairs Commission.' },
] as const;

const POLICIES = [
  ['POL-001', 'Information Security Policy', 'Information Security'],
  ['POL-002', 'Acceptable Use Policy', 'Acceptable Use'],
  ['POL-003', 'Data Protection & Privacy Policy', 'Data Protection'],
  ['POL-004', 'Access Control Policy', 'Information Security'],
  ['POL-005', 'Incident Response Policy', 'Information Security'],
  ['POL-006', 'Expense & Reimbursement Policy', 'Finance'],
  ['POL-007', 'Clear Desk & Clear Screen Policy', 'Information Security'],
  ['POL-008', 'Supplier Security Policy', 'Supplier'],
] as const;

/** Idempotent: adds missing built-ins only; never overwrites what the organisation edited. Policies are created as DRAFTS — nothing is "approved" on the company's behalf. */
export async function ensureGovernanceDefaults(organizationId: string) {
  const owner = await User.findOne({ organizationId, role: { $in: ['ceo', 'super_admin'] }, isActive: true }).select('_id');
  let added = 0;
  for (const o of OBLIGATIONS) {
    const exists = await Obligation.findOne({ organizationId, title: o.title, builtIn: true });
    if (exists) continue;
    const dueMonthOffset = o.frequency === 'quarterly' ? 0 : o.frequency === 'biannual' || o.frequency === 'annual' ? 1 : 0;
    const base = nextDay(o.day);
    if (dueMonthOffset) base.setUTCMonth(base.getUTCMonth() + dueMonthOffset);
    await Obligation.create({ organizationId, title: o.title, category: o.category, authority: o.authority, frequency: o.frequency, nextDueAt: base, notifyModules: [...o.notifyModules], description: o.description, ownerId: owner?._id, builtIn: true });
    added++;
  }
  for (const [code, title, category] of POLICIES) {
    if (await Policy.findOne({ organizationId, code })) continue;
    await Policy.create({ organizationId, code, title, category, version: '0.1', status: 'draft', summary: 'Starter entry — write or upload the policy text, then submit for approval.', ownerId: owner?._id, createdById: owner?._id, nextReviewAt: inMonths(12) });
    added++;
  }
  if (added) logger.info({ added }, 'governance defaults added (obligations & starter policies)');
}

export async function seedDemoProcessing(organizationId: string, ownerId: string) {
  if (await ProcessingActivity.countDocuments({ organizationId })) return;
  await ProcessingActivity.create([
    { organizationId, name: 'Employee records & payroll', purpose: 'Employment administration, payroll and statutory deductions', lawfulBasis: 'contract', dataSubjects: ['Employees'], dataCategories: ['Contact', 'Identity', 'Bank account', 'Emergency contact'], sensitiveData: false, recipients: ['Pension administrators', 'Tax authorities'], retentionPeriod: '6 years after employment ends', retentionAction: 'delete', securityMeasures: 'Role-based access, AES-256 field encryption for bank details, MFA, audit logging', systems: ['Global SJX OS'], ownerId, dpiaRequired: false, dpiaStatus: 'not_required', lastReviewedAt: new Date(), nextReviewAt: inMonths(12) },
    { organizationId, name: 'Client relationship & invoicing', purpose: 'Delivering contracted services and billing', lawfulBasis: 'contract', dataSubjects: ['Client contacts'], dataCategories: ['Contact', 'Financial'], recipients: ['Tax authorities', 'Auditors'], retentionPeriod: '6 years after last invoice', retentionAction: 'archive', securityMeasures: 'Access control, audit logging, encrypted backups', systems: ['Global SJX OS'], ownerId, dpiaRequired: false, dpiaStatus: 'not_required', lastReviewedAt: new Date(), nextReviewAt: inMonths(12) },
    { organizationId, name: 'Academy learner records', purpose: 'Enrolment, assessment and certification of learners', lawfulBasis: 'contract', dataSubjects: ['Learners'], dataCategories: ['Contact', 'Assessment results'], recipients: ['Certification bodies'], retentionPeriod: '5 years after course completion', retentionAction: 'anonymise', securityMeasures: 'Role-based access, consent records', systems: ['Global SJX OS'], ownerId, dpiaRequired: false, dpiaStatus: 'not_required', lastReviewedAt: new Date(), nextReviewAt: inMonths(12) },
    { organizationId, name: 'Website visitor analytics & cookies', purpose: 'Understanding website use with the visitor’s consent', lawfulBasis: 'consent', dataSubjects: ['Website visitors'], dataCategories: ['Online identifiers'], thirdCountryTransfer: true, transferSafeguards: 'Standard contractual clauses with the analytics provider', retentionPeriod: '13 months', retentionAction: 'delete', securityMeasures: 'Consent banner, IP hashing', systems: ['Marketing website'], ownerId, dpiaRequired: true, dpiaStatus: 'pending', nextReviewAt: inMonths(12) },
  ]);
}
