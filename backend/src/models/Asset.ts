import { Schema, model } from 'mongoose';
import { softDeletePlugin } from '../utils/softDeletePlugin';
import { currentContext } from '../utils/requestContext';

const ref = (to: string, extra: object = {}) => ({ type: Schema.Types.ObjectId, ref: to, ...extra });

/** Asset categories (ISO/IEC 27001:2022 A.5.9 inventory of information and other associated assets). `prefix` forms the asset ID: GSJX/HW/0001. */
export const CATEGORIES: Record<string, { label: string; prefix: string }> = {
  hardware: { label: 'Hardware & Devices', prefix: 'HW' },
  software: { label: 'Software & Licences', prefix: 'SW' },
  information: { label: 'Information & Data', prefix: 'INF' },
  cloud: { label: 'Cloud & Hosted Services', prefix: 'CLD' },
  network: { label: 'Network & Security Infrastructure', prefix: 'NET' },
  services: { label: 'Services & Suppliers', prefix: 'SVC' },
  facilities: { label: 'Facilities & Physical', prefix: 'FAC' },
  people: { label: 'People & Knowledge', prefix: 'PPL' },
};
export const CATEGORY_KEYS = Object.keys(CATEGORIES);
export const CLASSIFICATIONS = ['Public', 'Internal', 'Confidential', 'Restricted'] as const;
export const LIFECYCLE_STATUSES = ['planned', 'active', 'under_maintenance', 'retired', 'in_disposal', 'disposed'] as const;
export const EOL_STATES = ['untracked', 'ok', 'approaching', 'expired'] as const;
export const CIA = ['Low', 'Medium', 'High'] as const;
const ciaScore = (v?: string) => (v === 'High' ? 3 : v === 'Medium' ? 2 : v === 'Low' ? 1 : 0);

const disposalSchema = new Schema(
  {
    reason: String, method: String, previousStatus: String,
    requestedBy: String, requestedByName: String, requestedAt: Date,
    approvedBy: String, approvedByName: String, approvedAt: Date,
    completedBy: String, completedAt: Date, certificateRef: String,
  },
  { _id: false }
);

const assetSchema = new Schema(
  {
    organizationId: { type: Schema.Types.ObjectId, ref: 'Organization', required: true, index: true },
    assetId: { type: String, required: true },
    title: { type: String, required: true, trim: true },
    category: { type: String, enum: CATEGORY_KEYS, required: true, index: true },
    subCategory: { type: String },
    description: { type: String },
    owner: { type: String },
    custodian: { type: String },
    users: { type: String },
    location: { type: String },
    ownerUser: ref('User'),
    custodianUser: ref('User'),
    assignedToId: ref('User', { index: true }), // employee currently holding the asset (laptop, phone, token …)
    classification: { type: String, enum: CLASSIFICATIONS, default: 'Internal', index: true },
    /** How the label was set: by the policy rules (auto), chosen by a person (manual) or a justified lower-than-rule label (override). */
    classificationSource: { type: String, enum: ['auto', 'manual', 'override'], default: 'manual' },
    classificationReason: { type: String },
    classifiedAt: { type: Date },
    /** Recorded when the asset is handed back (Return of Asset Policy). */
    conditionOnReturn: { condition: String, medium: String, dataWipeVerified: Boolean, at: Date, byName: String, notes: String },
    confidentiality: { type: String, enum: CIA, default: 'Medium' },
    integrity: { type: String, enum: CIA, default: 'Medium' },
    availability: { type: String, enum: CIA, default: 'Medium' },
    value: { type: Number, default: 0 }, // C+I+A score (3-9)
    criticality: { type: String, enum: ['Low', 'Medium', 'High', 'Critical'], default: 'Medium', index: true },
    vendor: String,
    serialNumber: String,
    makeModel: String,
    version: String,
    maintenanceStatus: { type: String, default: '' },
    acquisitionDate: Date,
    expectedLifeMonths: Number,
    endOfLifeOverride: Date,
    endOfLifeDate: { type: Date, index: true },
    eolState: { type: String, enum: EOL_STATES, default: 'untracked', index: true },
    licenseExpiryDate: Date,
    warrantyExpiryDate: Date,
    reviewCycleMonths: Number,
    lastReviewedAt: Date,
    lastReviewedBy: String,
    nextReviewDate: { type: Date, index: true },
    lifecycleStatus: { type: String, enum: LIFECYCLE_STATUSES, default: 'active', index: true },
    disposalMethod: String,
    disposal: { type: disposalSchema, default: () => ({}) },
    backupSchedule: String,
    backupLocation: String,
    backupDetails: String,
    tags: [String],
    details: { type: Schema.Types.Mixed },
    dataQualityFlags: [{ type: String, index: true }],
    /** when the threat/risk engine last looked at this asset, and a fingerprint of what it saw (skips unchanged assets) */
    riskEvaluatedAt: Date,
    riskProfileHash: String,
    completeness: { type: Number, default: 0 },
    createdBy: String,
    updatedBy: String,
    deleteReason: String,
  },
  { timestamps: true, optimisticConcurrency: true }
);
assetSchema.index({ organizationId: 1, assetId: 1 }, { unique: true });
assetSchema.plugin(softDeletePlugin);
// Assets already keep createdBy / updatedBy as plain names, so they only gain "from where" here.
assetSchema.add({ updatedFrom: { ip: String, device: String } } as any);
assetSchema.pre('save', function (next) {
  const c = currentContext();
  if (c.userId) { (this as any).updatedBy = c.userName; (this as any).updatedFrom = { ip: c.ip, device: c.device }; if (this.isNew && !(this as any).createdBy) (this as any).createdBy = c.userName; }
  next();
});

const addMonths = (d: Date, m: number) => {
  const r = new Date(d);
  r.setMonth(r.getMonth() + m);
  return r;
};

assetSchema.pre('validate', function (next) {
  const a: any = this;
  // End of life
  const eol = a.endOfLifeOverride || (a.acquisitionDate && a.expectedLifeMonths ? addMonths(a.acquisitionDate, a.expectedLifeMonths) : null);
  a.endOfLifeDate = eol || undefined;
  const now = Date.now();
  a.eolState = !eol ? 'untracked' : eol.getTime() < now ? 'expired' : eol.getTime() - now < 90 * 86400000 ? 'approaching' : 'ok';
  // Next review
  a.nextReviewDate = a.reviewCycleMonths ? addMonths(a.lastReviewedAt || a.acquisitionDate || a.createdAt || new Date(), a.reviewCycleMonths) : undefined;
  // Value & criticality from CIA
  a.value = ciaScore(a.confidentiality) + ciaScore(a.integrity) + ciaScore(a.availability);
  a.criticality = a.value >= 8 ? 'Critical' : a.value >= 6 ? 'High' : a.value >= 4 ? 'Medium' : 'Low';
  // Data quality
  const flags: string[] = [];
  if (!a.owner && !a.ownerUser) flags.push('missing_owner');
  if (!a.custodian && !a.custodianUser) flags.push('missing_custodian');
  if (!a.location) flags.push('missing_location');
  if (!a.classification) flags.push('missing_classification');
  if (['active', 'under_maintenance'].includes(a.lifecycleStatus)) {
    if (!a.acquisitionDate) flags.push('missing_acquisition_date');
    if (!a.expectedLifeMonths && !a.endOfLifeOverride) flags.push('missing_expected_life');
    if (!a.reviewCycleMonths) flags.push('missing_review_cycle');
    else if (!a.lastReviewedAt) flags.push('missing_last_reviewed_at');
  }
  if (a.category === 'information' && !a.backupSchedule) flags.push('missing_backup_schedule');
  a.dataQualityFlags = flags;
  const checks = ['owner', 'custodian', 'location', 'classification', 'acquisitionDate', 'expectedLifeMonths', 'reviewCycleMonths', 'lastReviewedAt', 'vendor', 'description'];
  const filled = checks.filter((c) => !!a[c] || (c === 'owner' && a.ownerUser) || (c === 'custodian' && a.custodianUser)).length;
  a.completeness = Math.round((filled / checks.length) * 100);
  next();
});

export const Asset = model('Asset', assetSchema);

/* ------------------------------ Hash-chained event log --------------------- */
const assetEventSchema = new Schema(
  {
    organizationId: { type: Schema.Types.ObjectId, required: true, index: true },
    asset: ref('Asset', { required: true, index: true }),
    assetRef: String,
    seq: { type: Number, required: true },
    action: { type: String, required: true },
    actor: { id: String, name: String, role: String },
    changes: [{ field: String, from: Schema.Types.Mixed, to: Schema.Types.Mixed, _id: false }],
    note: String,
    ip: String,
    userAgent: String,
    prevHash: { type: String, required: true },
    hash: { type: String, required: true },
  },
  { timestamps: true }
);
assetEventSchema.index({ asset: 1, seq: 1 }, { unique: true });
export const AssetEvent = model('AssetEvent', assetEventSchema);
