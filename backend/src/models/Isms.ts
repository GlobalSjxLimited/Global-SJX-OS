import { Schema, model } from 'mongoose';
import { softDeletePlugin } from '../utils/softDeletePlugin';
import { stampPlugin } from '../utils/stampPlugin';

const ref = (to: string, extra: object = {}) => ({ type: Schema.Types.ObjectId, ref: to, ...extra });
const org = { type: Schema.Types.ObjectId, ref: 'Organization', required: true, index: true };

/** One row of any ISMS register that has no module of its own (see config/isms.ts for the columns). */
const recordSchema = new Schema(
  {
    organizationId: org,
    register: { type: String, required: true, index: true },
    refNo: { type: String, required: true },
    title: { type: String, default: '' },
    status: { type: String, required: true, index: true },
    ownerId: ref('User', { index: true }),
    ownerName: String,
    dueDate: { type: Date, index: true },
    closedAt: Date,
    data: { type: Schema.Types.Mixed, default: {} },
    source: { type: String, enum: ['manual', 'auto', 'import'], default: 'manual' },
    /** what created it automatically, e.g. { type: 'incident', id } – used to avoid duplicates */
    sourceRef: { type: { type: String }, id: String },
    evidenceUrl: String,
    history: [{ at: { type: Date, default: Date.now }, byId: ref('User'), byName: String, action: String, note: String, _id: false }],
  },
  { timestamps: true }
);
recordSchema.index({ organizationId: 1, register: 1, refNo: 1 }, { unique: true });
recordSchema.index({ organizationId: 1, register: 1, 'sourceRef.type': 1, 'sourceRef.id': 1 });
recordSchema.plugin(softDeletePlugin);
recordSchema.plugin(stampPlugin);
export const IsmsRecord = model('IsmsRecord', recordSchema);

/** One run of an automation rule – the proof that the policy cadence was actually followed. */
const runSchema = new Schema(
  {
    organizationId: org,
    ruleKey: { type: String, required: true, index: true },
    trigger: { type: String, enum: ['schedule', 'manual'], default: 'schedule' },
    byName: String,
    startedAt: { type: Date, default: Date.now },
    finishedAt: Date,
    ok: { type: Boolean, default: true },
    checked: { type: Number, default: 0 },
    actions: { type: Number, default: 0 },
    summary: String,
    details: [String],
    error: String,
  },
  { timestamps: false }
);
runSchema.index({ organizationId: 1, ruleKey: 1, startedAt: -1 });
export const AutomationRun = model('AutomationRun', runSchema);

/** Per-organisation switch for a rule (all rules are on until someone turns one off, and that is logged). */
const settingSchema = new Schema(
  { organizationId: org, ruleKey: { type: String, required: true }, enabled: { type: Boolean, default: true }, changedByName: String, changedAt: Date, reason: String },
  { timestamps: true }
);
settingSchema.index({ organizationId: 1, ruleKey: 1 }, { unique: true });
export const AutomationSetting = model('AutomationSetting', settingSchema);

/** A generated evidence pack (all registers at one moment) – hash-stamped so it can be shown to an auditor. */
const snapshotSchema = new Schema(
  {
    organizationId: org,
    kind: { type: String, enum: ['pack', 'register'], default: 'pack' },
    label: String,
    registers: [String],
    fileName: String,
    storageKey: String,
    size: Number,
    sha256: String,
    trigger: { type: String, enum: ['schedule', 'manual'], default: 'manual' },
    byName: String,
    counts: { type: Schema.Types.Mixed },
  },
  { timestamps: true }
);
snapshotSchema.index({ organizationId: 1, createdAt: -1 });
export const RegisterSnapshot = model('RegisterSnapshot', snapshotSchema);
