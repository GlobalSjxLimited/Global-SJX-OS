import { Schema, model } from 'mongoose';
import { softDeletePlugin } from '../utils/softDeletePlugin';

/**
 * Information-security controls register (ISO/IEC 27001:2022 Annex A style).
 * `implementation` describes how the control is actually enforced in this
 * platform; `evidence` links to proof (code paths, CI runs, documents).
 */
const reviewEntry = new Schema(
  {
    reviewerId: { type: Schema.Types.ObjectId, ref: 'User' },
    outcome: { type: String, enum: ['effective', 'partially_effective', 'ineffective'], default: 'effective' },
    notes: { type: String },
    at: { type: Date, default: Date.now },
  },
  { _id: true }
);

const evidenceEntry = new Schema(
  { label: { type: String, required: true }, url: { type: String }, addedById: { type: Schema.Types.ObjectId, ref: 'User' }, at: { type: Date, default: Date.now } },
  { _id: true }
);

const securityControlSchema = new Schema(
  {
    organizationId: { type: Schema.Types.ObjectId, ref: 'Organization', required: true, index: true },
    ref: { type: String, required: true }, // e.g. "A.8.25" or "GSJX-SEC-01"
    title: { type: String, required: true, trim: true },
    statement: { type: String, required: true }, // the control wording
    framework: { type: String, default: 'ISO/IEC 27001:2022' },
    domain: { type: String, enum: ['Secure Development', 'Access Control', 'Operations', 'Data Protection', 'Supplier', 'Privacy', 'Resilience'], default: 'Secure Development' },
    ownerId: { type: Schema.Types.ObjectId, ref: 'User' },
    status: { type: String, enum: ['not_started', 'in_progress', 'implemented', 'not_applicable'], default: 'in_progress', index: true },
    implementation: { type: String, default: '' }, // rich text / HTML
    automated: { type: Boolean, default: false }, // true = enforced in code, not just by procedure
    evidence: [evidenceEntry],
    reviews: [reviewEntry],
    lastReviewedAt: { type: Date },
    nextReviewAt: { type: Date, index: true },
  },
  { timestamps: true }
);
securityControlSchema.index({ organizationId: 1, ref: 1 });
securityControlSchema.plugin(softDeletePlugin);
export const SecurityControl = model('SecurityControl', securityControlSchema);

/** A.5.8 / A.8.26 — security requirements identified, specified and APPROVED when developing or acquiring applications. */
const securityRequirementSchema = new Schema(
  {
    organizationId: { type: Schema.Types.ObjectId, ref: 'Organization', required: true, index: true },
    application: { type: String, required: true, trim: true }, // system / application name
    kind: { type: String, enum: ['develop', 'acquire'], default: 'develop' },
    title: { type: String, required: true, trim: true },
    description: { type: String, default: '' }, // rich text
    category: { type: String, enum: ['authentication', 'authorisation', 'data_protection', 'logging', 'availability', 'privacy', 'integration', 'other'], default: 'other' },
    priority: { type: String, enum: ['must', 'should', 'could'], default: 'must' },
    status: { type: String, enum: ['draft', 'submitted', 'approved', 'rejected', 'verified'], default: 'draft', index: true },
    requestedById: { type: Schema.Types.ObjectId, ref: 'User' },
    approvedById: { type: Schema.Types.ObjectId, ref: 'User' },
    approvedAt: { type: Date },
    decisionNote: { type: String },
    verificationEvidence: { type: String },
  },
  { timestamps: true }
);
securityRequirementSchema.plugin(softDeletePlugin);
export const SecurityRequirement = model('SecurityRequirement', securityRequirementSchema);

/** A.8.30 — direct, monitor and review outsourced system development. */
const outsourcedReviewSchema = new Schema(
  {
    organizationId: { type: Schema.Types.ObjectId, ref: 'Organization', required: true, index: true },
    supplier: { type: String, required: true, trim: true },
    vendorId: { type: Schema.Types.ObjectId, ref: 'Vendor' },
    scope: { type: String, required: true },
    contractRef: { type: String },
    securityClausesInPlace: { type: Boolean, default: false },
    codeEscrowOrOwnership: { type: Boolean, default: false },
    securityTestingEvidence: { type: Boolean, default: false },
    rightToAudit: { type: Boolean, default: false },
    ndaSigned: { type: Boolean, default: false },
    status: { type: String, enum: ['onboarding', 'active', 'under_review', 'terminated'], default: 'onboarding', index: true },
    riskRating: { type: String, enum: ['low', 'medium', 'high'], default: 'medium' },
    ownerId: { type: Schema.Types.ObjectId, ref: 'User' },
    lastReviewAt: { type: Date },
    nextReviewAt: { type: Date, index: true },
    findings: { type: String, default: '' },
  },
  { timestamps: true }
);
outsourcedReviewSchema.plugin(softDeletePlugin);
export const OutsourcedReview = model('OutsourcedReview', outsourcedReviewSchema);

/** Cookie / privacy consent proof (who agreed to what, which policy version, when). IPs are stored hashed. */
const consentSchema = new Schema(
  {
    subjectId: { type: String, required: true, index: true }, // random browser id (anonymous) or user id
    userId: { type: Schema.Types.ObjectId, ref: 'User' },
    policyVersion: { type: String, required: true },
    essential: { type: Boolean, default: true },
    preferences: { type: Boolean, default: false },
    analytics: { type: Boolean, default: false },
    marketing: { type: Boolean, default: false },
    ipHash: { type: String },
    userAgent: { type: String },
    source: { type: String, enum: ['app', 'website'], default: 'app' },
  },
  { timestamps: true }
);
export const ConsentRecord = model('ConsentRecord', consentSchema);

/** Peer recognition shown on the Hub. */
const recognitionSchema = new Schema(
  {
    organizationId: { type: Schema.Types.ObjectId, ref: 'Organization', required: true, index: true },
    fromId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    toId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    value: { type: String, enum: ['Excellence', 'Teamwork', 'Innovation', 'Integrity', 'Customer First'], default: 'Teamwork' },
    message: { type: String, required: true },
    reactions: [{ userId: { type: Schema.Types.ObjectId, ref: 'User' }, emoji: String }],
  },
  { timestamps: true }
);
recognitionSchema.plugin(softDeletePlugin);
export const Recognition = model('Recognition', recognitionSchema);
