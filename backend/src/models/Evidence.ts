import { Schema, model } from 'mongoose';
import { softDeletePlugin } from '../utils/softDeletePlugin';

const org = { type: Schema.Types.ObjectId, ref: 'Organization', required: true, index: true };

/** A piece of audit evidence: a file (fingerprinted with SHA-256), a link or a written note, tied to the controls and clauses it proves. */
const evidenceSchema = new Schema(
  {
    organizationId: org,
    refNo: { type: String, required: true },
    title: { type: String, required: true, trim: true, maxlength: 300 },
    description: { type: String, maxlength: 4000 },
    kind: { type: String, enum: ['file', 'link', 'note'], default: 'file' },
    url: String,
    originalName: String,
    mimeType: String,
    size: Number,
    sha256: String,
    controlRefs: [String], // Annex A, e.g. A.8.13
    clauses: [String], // ISMS clauses, e.g. 9.2
    registerRefs: [String], // register record numbers, e.g. CAR-0004
    collectedOn: { type: Date, default: Date.now },
    validUntil: { type: Date, index: true },
    ownerId: { type: Schema.Types.ObjectId, ref: 'User' },
    ownerName: String,
    version: { type: Number, default: 1 },
    previousId: { type: Schema.Types.ObjectId, ref: 'Evidence' },
    supersededById: { type: Schema.Types.ObjectId, ref: 'Evidence' },
    lockedAt: Date,
    lockedByName: String,
    lastVerifiedAt: Date,
    integrity: { type: String, enum: ['ok', 'changed', 'missing', 'n/a'], default: 'n/a' },
    createdByName: String,
    history: [{ at: Date, byName: String, action: String, note: String, _id: false }],
  },
  { timestamps: true }
);
evidenceSchema.index({ organizationId: 1, refNo: 1 }, { unique: true });
evidenceSchema.index({ organizationId: 1, controlRefs: 1 });
evidenceSchema.plugin(softDeletePlugin);
export const Evidence = model('Evidence', evidenceSchema);

/** A request to someone to supply evidence for a control by a date (auditor-style PBC list). */
const requestSchema = new Schema(
  {
    organizationId: org,
    refNo: { type: String, required: true },
    title: { type: String, required: true, trim: true, maxlength: 300 },
    controlRef: String,
    note: { type: String, maxlength: 2000 },
    assigneeId: { type: Schema.Types.ObjectId, ref: 'User' },
    assigneeName: String,
    dueDate: Date,
    status: { type: String, enum: ['open', 'fulfilled', 'cancelled'], default: 'open', index: true },
    evidenceId: { type: Schema.Types.ObjectId, ref: 'Evidence' },
    source: { type: String, enum: ['manual', 'auto'], default: 'manual' },
    sourceEvidenceId: { type: Schema.Types.ObjectId, ref: 'Evidence' },
    createdByName: String,
    fulfilledAt: Date,
  },
  { timestamps: true }
);
requestSchema.index({ organizationId: 1, refNo: 1 }, { unique: true });
requestSchema.plugin(softDeletePlugin);
export const EvidenceRequest = model('EvidenceRequest', requestSchema);

/** A time-limited, read-only window for an external auditor. Only the SHA-256 of the link token is stored. */
const auditorSchema = new Schema(
  {
    organizationId: org,
    name: { type: String, required: true, trim: true, maxlength: 120 },
    email: { type: String, trim: true, maxlength: 200 },
    company: { type: String, trim: true, maxlength: 160 },
    tokenHash: { type: String, required: true, unique: true },
    registers: [String], // register keys the auditor may read
    includeEvidence: { type: Boolean, default: true },
    expiresAt: { type: Date, required: true, index: true },
    revokedAt: Date,
    revokedByName: String,
    createdByName: String,
    lastUsedAt: Date,
    uses: { type: Number, default: 0 },
    log: [{ at: Date, what: String, ip: String, _id: false }],
  },
  { timestamps: true }
);
export const AuditorAccess = model('AuditorAccess', auditorSchema);
