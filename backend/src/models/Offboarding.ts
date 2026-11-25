import { Schema, model } from 'mongoose';

const ref = (to: string, extra: object = {}) => ({ type: Schema.Types.ObjectId, ref: to, ...extra });

export const ITEM_KINDS = ['asset', 'task', 'approval', 'project', 'goal', 'risk', 'access', 'knowledge', 'personal_equipment', 'physical_info', 'credential', 'other'] as const;
/** Kinds that are physically / digitally handed back (employee declares, HR or admin verifies). The rest are handed over to another person. */
export const RETURN_KINDS = ['asset', 'personal_equipment', 'physical_info', 'credential', 'knowledge', 'other'] as const;
export const TRANSFER_KINDS = ['task', 'approval', 'project', 'goal', 'risk'] as const;
export const ITEM_STATUSES = ['pending', 'submitted', 'reclaimed', 'transferred', 'not_applicable', 'exception_requested', 'exception_approved', 'written_off'] as const;
/** Statuses that need nothing further from anyone. */
export const DONE_STATUSES = ['reclaimed', 'transferred', 'not_applicable', 'written_off'] as const;
export const CONDITIONS = ['good', 'fair', 'damaged', 'lost', 'not_applicable'] as const;
export const MEDIA = ['physical', 'digital', 'both', 'na'] as const;
export const CASE_TYPES = ['resignation', 'termination', 'contract_end', 'retirement', 'transfer_out', 'other'] as const;

const historySchema = new Schema({ at: { type: Date, default: Date.now }, byId: ref('User'), byName: String, action: String, note: String }, { _id: false });
const evidenceSchema = new Schema({ name: String, url: String }, { _id: false });

const itemSchema = new Schema({
  kind: { type: String, enum: ITEM_KINDS, required: true },
  label: { type: String, required: true },
  detail: String,
  source: { type: String, enum: ['auto', 'policy', 'manual'], default: 'auto' },
  required: { type: Boolean, default: true },
  refId: Schema.Types.ObjectId, // the asset / task / project … this item is about
  refCode: String, // e.g. GSJX/HW/0004
  medium: { type: String, enum: MEDIA, default: 'na' },
  requiresWipe: { type: Boolean, default: false }, // device or data store — data must be erased and verified before it is accepted
  status: { type: String, enum: ITEM_STATUSES, default: 'pending' },

  // 1) the leaver's declaration ("I have returned this")
  submittedAt: Date,
  submittedNote: String,
  declaredCondition: { type: String, enum: CONDITIONS },
  declaredMedium: { type: String, enum: MEDIA },
  dataRemoved: Boolean,
  evidence: [evidenceSchema],

  // 2) HR / admin verification ("this item has been reclaimed — condition …")
  condition: { type: String, enum: CONDITIONS },
  verifiedMedium: { type: String, enum: MEDIA },
  dataWipeVerified: Boolean,
  wipeMethod: String,
  wipeReference: String,
  accessoriesComplete: Boolean,
  decidedById: ref('User'),
  decidedByName: String,
  decidedAt: Date,
  decisionNote: String,
  rejectedNote: String, // last time a submission was sent back

  // hand-over of work to someone else
  transferToId: ref('User'),
  transferToName: String,
  transferredAt: Date,

  // policy 2.6 — cannot return in time
  exception: {
    reason: String, requestedAt: Date, requestedDueDate: Date,
    decision: { type: String, enum: ['pending', 'approved', 'denied'] },
    decidedById: ref('User'), decidedByName: String, decidedAt: Date, note: String, newDueDate: Date,
  },
  // policy 2.3.1 — employee buys the equipment
  purchase: {
    requested: Boolean, requestedAt: Date, agreedPrice: Number, currency: String,
    dataTransferred: Boolean, approvedById: ref('User'), approvedByName: String, approvedAt: Date,
  },
  history: [historySchema],
}, { timestamps: true });

const offboardingSchema = new Schema(
  {
    organizationId: { type: Schema.Types.ObjectId, ref: 'Organization', required: true, index: true },
    reference: { type: String, required: true },
    employeeId: ref('User', { required: true, index: true }),
    employeeName: String,
    employeeEmail: String,
    department: String,
    jobTitle: String,
    managerId: ref('User'),
    type: { type: String, enum: CASE_TYPES, default: 'resignation' },
    reason: String,
    noticeGivenAt: { type: Date, default: Date.now },
    lastWorkingDay: { type: Date, required: true, index: true },
    status: { type: String, enum: ['open', 'cleared', 'cancelled'], default: 'open', index: true },
    initiatedById: ref('User'),
    initiatedByName: String,
    items: [itemSchema],
    /** policy 2.5 — the leaver confirms the inventory of what they hold */
    inventory: { declaredAt: Date, statement: String, note: String, declaredById: ref('User') },
    access: { revokedAt: Date, revokedById: ref('User'), revokedByName: String, method: { type: String, enum: ['scheduled', 'manual', 'immediate'] }, summary: String },
    clearedAt: Date,
    clearedById: ref('User'),
    clearedByName: String,
    clearanceNote: String,
    clearedWithExceptions: { type: Boolean, default: false },
    cancelledAt: Date,
    cancelReason: String,
    timeline: [historySchema],
  },
  { timestamps: true }
);
offboardingSchema.index({ organizationId: 1, status: 1, lastWorkingDay: 1 });
offboardingSchema.index({ organizationId: 1, reference: 1 }, { unique: true });
export const Offboarding = model('Offboarding', offboardingSchema);
