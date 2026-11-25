import { Schema, model } from 'mongoose';
import { softDeletePlugin } from '../utils/softDeletePlugin';

const org = { type: Schema.Types.ObjectId, ref: 'Organization', required: true, index: true };

export const CONTROL_CATEGORIES = ['Passwords & Access', 'Risk', 'Continuity & Backup', 'Governance', 'Technical', 'People', 'Suppliers', 'Data Protection'] as const;
/** Who a control falls on when nobody was picked by name. Each preference ends in a fallback chain (see controls.service → resolveOwners). */
export const OWNER_PREFS = ['risk_manager', 'it', 'ceo', 'hr', 'dpo', 'finance', 'user'] as const;

/**
 * A recurring ISMS / policy control: "change the Wi-Fi password every 90 days", "run the risk assessment every year" …
 * Frequency and owner are editable by whoever holds the Compliance module; built-ins are seeded per organisation.
 */
const controlTaskSchema = new Schema(
  {
    organizationId: org,
    key: { type: String, required: true }, // stable id for built-ins (e.g. wifi_password) · "custom_<n>" for user-created
    title: { type: String, required: true, trim: true },
    description: { type: String },
    category: { type: String, enum: CONTROL_CATEGORIES, default: 'Governance', index: true },
    isoRef: { type: String }, // e.g. "A.5.17"
    policyRef: { type: String }, // e.g. "Password Policy"
    builtIn: { type: Boolean, default: false },

    frequencyDays: { type: Number, required: true, min: 1, max: 1830 },
    ownerPref: { type: String, enum: OWNER_PREFS, default: 'it' },
    ownerId: { type: Schema.Types.ObjectId, ref: 'User' }, // explicit owner overrides ownerPref
    deputyIds: [{ type: Schema.Types.ObjectId, ref: 'User' }],

    leadDays: { type: [Number], default: [14, 7, 3, 1] },
    checklist: [{ type: String }],
    requireEvidence: { type: Boolean, default: false },
    link: { type: String }, // where in the app the work happens (e.g. /risks)

    status: { type: String, enum: ['active', 'paused'], default: 'active', index: true },
    pausedReason: { type: String },
    nextDueAt: { type: Date, required: true, index: true },
    lastCompletedAt: { type: Date },
    lastCompletedById: { type: Schema.Types.ObjectId, ref: 'User' },
    lastCompletedByName: { type: String },

    completions: [
      {
        at: { type: Date, default: Date.now },
        byId: { type: Schema.Types.ObjectId, ref: 'User' },
        byName: String,
        note: String,
        evidenceUrl: String,
        wasOverdueDays: { type: Number, default: 0 },
        nextDueAt: Date,
      },
    ],
  },
  { timestamps: true }
);
controlTaskSchema.index({ organizationId: 1, key: 1 }, { unique: true });
controlTaskSchema.plugin(softDeletePlugin);
export const ControlTask = model('ControlTask', controlTaskSchema);

/* ------------------------- Legacy migration bookkeeping -------------------- */
/** legacy _id → new _id, per collection. Makes the migration idempotent and lets `rollback` remove exactly what a run created. */
const legacyMapSchema = new Schema(
  {
    organizationId: org,
    source: { type: String, required: true }, // old collection name
    legacyId: { type: String, required: true },
    target: { type: String, required: true }, // new model name
    targetId: { type: Schema.Types.ObjectId, required: true },
    batchId: { type: String, required: true, index: true },
    checksum: { type: String },
  },
  { timestamps: true }
);
legacyMapSchema.index({ organizationId: 1, source: 1, legacyId: 1 }, { unique: true });
export const LegacyMap = model('LegacyMap', legacyMapSchema);

/** Lossless copy of every old document (payload encrypted, credentials stripped) — nothing in the old DB is lost even if it has no home yet. */
const legacyArchiveSchema = new Schema(
  {
    organizationId: org,
    source: { type: String, required: true },
    legacyId: { type: String, required: true },
    payloadEnc: { type: String, required: true, select: false },
    batchId: { type: String, required: true, index: true },
  },
  { timestamps: true }
);
legacyArchiveSchema.index({ organizationId: 1, source: 1, legacyId: 1 }, { unique: true });
export const LegacyArchive = model('LegacyArchive', legacyArchiveSchema);
