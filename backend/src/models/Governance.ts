import { Schema, model } from 'mongoose';
import { softDeletePlugin } from '../utils/softDeletePlugin';
import { stampPlugin } from '../utils/stampPlugin';

const ref = (to: string, extra: object = {}) => ({ type: Schema.Types.ObjectId, ref: to, ...extra });
const org = { type: Schema.Types.ObjectId, ref: 'Organization', required: true, index: true };

/* ------------------------------- Audit seals ------------------------------ */
const auditSealSchema = new Schema(
  {
    organizationId: org,
    day: { type: String, required: true }, // YYYY-MM-DD (UTC)
    count: { type: Number, required: true },
    digest: { type: String, required: true },
    prevChainHash: { type: String, required: true },
    chainHash: { type: String, required: true },
  },
  { timestamps: true }
);
auditSealSchema.index({ organizationId: 1, day: 1 }, { unique: true });
export const AuditSeal = model('AuditSeal', auditSealSchema);

/* ----------------------------------- Policies ----------------------------- */
const policySchema = new Schema(
  {
    organizationId: org,
    code: { type: String, required: true },
    title: { type: String, required: true, trim: true },
    category: { type: String, enum: ['Information Security', 'Data Protection', 'HR', 'Finance', 'Acceptable Use', 'Business Continuity', 'Supplier', 'Quality', 'Other'], default: 'Information Security' },
    version: { type: String, default: '1.0' },
    status: { type: String, enum: ['draft', 'in_review', 'approved', 'retired'], default: 'draft' },
    summary: { type: String },
    content: { type: String, default: '' }, // rich text
    documentUrl: { type: String },
    ownerId: ref('User'),
    approvedById: ref('User'),
    approvedAt: { type: Date },
    effectiveDate: { type: Date },
    reviewCycleMonths: { type: Number, default: 12 },
    nextReviewAt: { type: Date },
    requiresAcknowledgement: { type: Boolean, default: true },
    audienceRoles: [{ type: String }], // empty = every internal user
    createdById: ref('User'),
  },
  { timestamps: true }
);
policySchema.index({ organizationId: 1, code: 1 }, { unique: true });
policySchema.plugin(softDeletePlugin);
export const Policy = model('Policy', policySchema);

const policyAckSchema = new Schema(
  {
    organizationId: org,
    policyId: ref('Policy', { required: true, index: true }),
    version: { type: String, required: true },
    userId: ref('User', { required: true, index: true }),
    acknowledgedAt: { type: Date, default: Date.now },
    ipHash: { type: String },
  },
  { timestamps: true }
);
policyAckSchema.index({ policyId: 1, version: 1, userId: 1 }, { unique: true });
export const PolicyAcknowledgement = model('PolicyAcknowledgement', policyAckSchema);

/* ---------------------------------- Access review ------------------------- */
const accessReviewSchema = new Schema(
  {
    organizationId: org,
    reference: { type: String, required: true },
    title: { type: String, required: true },
    scope: { type: String, default: 'All internal users' },
    status: { type: String, enum: ['open', 'completed', 'cancelled'], default: 'open' },
    dueDate: { type: Date },
    reviewerId: ref('User'),
    items: [
      {
        userId: ref('User'),
        name: String,
        email: String,
        role: String,
        department: String,
        modules: [String],
        sensitiveModules: [String],
        mfaEnabled: Boolean,
        lastLoginAt: Date,
        decision: { type: String, enum: ['pending', 'keep', 'reduce', 'remove'], default: 'pending' },
        note: String,
        decidedAt: Date,
        applied: { type: Boolean, default: false },
      },
    ],
    createdById: ref('User'),
    completedAt: { type: Date },
    completedById: ref('User'),
  },
  { timestamps: true }
);
accessReviewSchema.plugin(softDeletePlugin);
export const AccessReview = model('AccessReview', accessReviewSchema);

/* ----------------------------- Compliance calendar ------------------------- */
const obligationSchema = new Schema(
  {
    organizationId: org,
    title: { type: String, required: true, trim: true },
    category: { type: String, enum: ['tax', 'regulatory', 'security', 'data_protection', 'hr', 'finance', 'contract', 'other'], default: 'other' },
    description: { type: String },
    frequency: { type: String, enum: ['once', 'monthly', 'quarterly', 'biannual', 'annual'], default: 'monthly' },
    nextDueAt: { type: Date, required: true, index: true },
    remindDaysBefore: { type: [Number], default: [14, 7, 3, 1] },
    ownerId: ref('User'),
    notifyModules: [{ type: String }], // e.g. ['taxes'] — everyone holding the module is reminded too
    status: { type: String, enum: ['active', 'paused'], default: 'active' },
    authority: { type: String }, // e.g. FIRS, NDPC, CAC
    referenceUrl: { type: String },
    lastCompletedAt: { type: Date },
    history: [{ completedAt: Date, completedById: ref('User'), dueWas: Date, note: String, evidenceUrl: String }],
    builtIn: { type: Boolean, default: false },
  },
  { timestamps: true }
);
obligationSchema.plugin(softDeletePlugin);
export const Obligation = model('Obligation', obligationSchema);

/* ------------------------------ Report schedules --------------------------- */
const reportScheduleSchema = new Schema(
  {
    organizationId: org,
    reportKey: { type: String, required: true },
    name: { type: String, required: true },
    params: { type: Schema.Types.Mixed, default: {} },
    frequency: { type: String, enum: ['weekly', 'monthly', 'quarterly'], default: 'monthly' },
    format: { type: String, enum: ['pdf', 'csv'], default: 'pdf' },
    recipientIds: [ref('User')],
    extraEmails: [{ type: String }],
    nextRunAt: { type: Date, required: true, index: true },
    lastRunAt: { type: Date },
    lastStatus: { type: String },
    active: { type: Boolean, default: true },
    createdById: ref('User'),
  },
  { timestamps: true }
);
reportScheduleSchema.plugin(softDeletePlugin);
export const ReportSchedule = model('ReportSchedule', reportScheduleSchema);

/* ----------------------------- Data subject requests ----------------------- */
const dsrSchema = new Schema(
  {
    organizationId: org,
    reference: { type: String, required: true },
    type: { type: String, enum: ['access', 'rectification', 'erasure', 'restriction', 'portability', 'objection', 'withdraw_consent'], required: true },
    requester: { name: { type: String, required: true }, email: { type: String }, phone: { type: String }, relationship: { type: String, enum: ['employee', 'client', 'vendor', 'academy_learner', 'website_visitor', 'other'], default: 'other' } },
    userId: ref('User'), // when the requester is a system user
    details: { type: String },
    receivedAt: { type: Date, default: Date.now },
    dueAt: { type: Date, required: true, index: true },
    extended: { type: Boolean, default: false },
    identityVerified: { type: Boolean, default: false },
    status: { type: String, enum: ['received', 'verifying', 'in_progress', 'awaiting_info', 'completed', 'rejected'], default: 'received', index: true },
    assigneeId: ref('User'),
    source: { type: String, enum: ['portal', 'email', 'website', 'in_person', 'self_service'], default: 'email' },
    outcome: { type: String },
    rejectionReason: { type: String },
    closedAt: { type: Date },
    timeline: [{ at: { type: Date, default: Date.now }, byId: ref('User'), byName: String, text: String }],
  },
  { timestamps: true }
);
dsrSchema.plugin(softDeletePlugin);
export const DataSubjectRequest = model('DataSubjectRequest', dsrSchema);

/* ---------------------------------- Incidents ------------------------------ */
const incidentSchema = new Schema(
  {
    organizationId: org,
    reference: { type: String, required: true },
    title: { type: String, required: true, trim: true },
    description: { type: String, default: '' }, // rich text
    category: { type: String, enum: ['malware', 'phishing', 'unauthorised_access', 'data_loss', 'lost_device', 'service_outage', 'policy_violation', 'physical', 'supplier', 'other'], default: 'other' },
    severity: { type: String, enum: ['low', 'medium', 'high', 'critical'], default: 'medium', index: true },
    status: { type: String, enum: ['reported', 'triage', 'contained', 'eradicated', 'recovered', 'closed'], default: 'reported', index: true },
    detectedAt: { type: Date, default: Date.now },
    reportedById: ref('User'),
    assigneeId: ref('User'),
    affectedAssetIds: [ref('Asset')],
    isPersonalDataBreach: { type: Boolean, default: false },
    breach: {
      dataCategories: [String],
      subjectsAffected: { type: Number, default: 0 },
      riskToRights: { type: String, enum: ['unlikely', 'risk', 'high_risk'], default: 'risk' },
      regulatorDeadline: { type: Date }, // detectedAt + 72h
      regulatorNotified: { type: Boolean, default: false },
      regulatorNotifiedAt: { type: Date },
      regulatorRef: { type: String },
      subjectsNotified: { type: Boolean, default: false },
      subjectsNotifiedAt: { type: Date },
    },
    containedAt: { type: Date },
    resolvedAt: { type: Date },
    rootCause: { type: String },
    lessonsLearned: { type: String },
    actions: [{ text: String, ownerId: ref('User'), dueDate: Date, done: { type: Boolean, default: false }, doneAt: Date }],
    timeline: [{ at: { type: Date, default: Date.now }, byId: ref('User'), byName: String, text: String }],
  },
  { timestamps: true }
);
incidentSchema.plugin(softDeletePlugin);
incidentSchema.plugin(stampPlugin);
export const Incident = model('Incident', incidentSchema);

/* ------------------------- Record of processing (ROPA) ---------------------- */
const ropaSchema = new Schema(
  {
    organizationId: org,
    name: { type: String, required: true, trim: true },
    purpose: { type: String, required: true },
    lawfulBasis: { type: String, enum: ['consent', 'contract', 'legal_obligation', 'vital_interests', 'public_task', 'legitimate_interests'], default: 'contract' },
    dataSubjects: [String], // employees, clients, learners …
    dataCategories: [String], // contact, financial, identity, health …
    sensitiveData: { type: Boolean, default: false },
    recipients: [String],
    thirdCountryTransfer: { type: Boolean, default: false },
    transferSafeguards: { type: String },
    retentionPeriod: { type: String },
    retentionAction: { type: String, enum: ['delete', 'anonymise', 'archive'], default: 'delete' },
    securityMeasures: { type: String },
    systems: [String],
    ownerId: ref('User'),
    dpiaRequired: { type: Boolean, default: false },
    dpiaStatus: { type: String, enum: ['not_required', 'pending', 'in_progress', 'completed'], default: 'not_required' },
    dpiaCompletedAt: { type: Date },
    status: { type: String, enum: ['active', 'retired'], default: 'active' },
    reviewCycleMonths: { type: Number, default: 12 },
    lastReviewedAt: { type: Date },
    nextReviewAt: { type: Date },
  },
  { timestamps: true }
);
ropaSchema.plugin(softDeletePlugin);
export const ProcessingActivity = model('ProcessingActivity', ropaSchema);
