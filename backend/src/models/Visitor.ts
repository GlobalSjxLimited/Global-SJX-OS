import { Schema, model } from 'mongoose';
import { softDeletePlugin } from '../utils/softDeletePlugin';

const org = { type: Schema.Types.ObjectId, ref: 'Organization', required: true, index: true };
const user = { type: Schema.Types.ObjectId, ref: 'User' };

export const VISIT_STATUSES = ['pending_approval', 'approved', 'rejected', 'booked', 'checked_in', 'checked_out', 'cancelled', 'no_show'] as const;
export const ACTIVE_VISIT = ['pending_approval', 'approved', 'booked', 'checked_in'];

/** One visit: a walk-in (needs host approval) or an advance appointment (reserves a slot). */
const visitSchema = new Schema(
  {
    organizationId: org,
    reference: { type: String, required: true },
    type: { type: String, enum: ['walk_in', 'appointment'], required: true },
    status: { type: String, enum: VISIT_STATUSES, required: true, index: true },
    visitor: { name: { type: String, required: true }, email: String, phone: String, company: String, idType: String, idLast4: String, anonymised: Boolean },
    purpose: { type: String, maxlength: 500 },
    vehicle: String,
    hostId: { ...user, index: true }, hostName: String, hostDepartment: String,
    scheduledStart: { type: Date, index: true }, scheduledEnd: Date,
    passCode: { type: String, required: true, unique: true },
    badgeNo: String,
    decision: { at: Date, byName: String, reason: String },
    checkedInAt: Date, checkedInByName: String, checkedOutAt: Date, checkedOutByName: String,
    watch: { level: { type: String, enum: ['flag', 'block'] }, entryId: Schema.Types.ObjectId, matchedOn: String, overrideReason: String, overrideByName: String },
    source: { type: String, enum: ['front_desk', 'public_booking'], default: 'front_desk' },
    reminderSent: Boolean,
    timeline: [{ at: Date, byName: String, text: String, _id: false }],
  },
  { timestamps: true }
);
visitSchema.index({ organizationId: 1, status: 1, checkedInAt: -1 });
visitSchema.index({ organizationId: 1, createdAt: -1 });
visitSchema.plugin(softDeletePlugin);
export const Visit = model('Visit', visitSchema);

/** When a person can be visited. Public booking only works when `enabled`. Times are Africa/Lagos (UTC+1, no daylight saving). */
const availabilitySchema = new Schema(
  {
    organizationId: org,
    userId: { ...user, required: true },
    enabled: { type: Boolean, default: false },
    days: [{ day: { type: Number, min: 0, max: 6 }, ranges: [{ start: String, end: String, _id: false }], _id: false }], // 0 = Sunday
    slotMinutes: { type: Number, default: 30, min: 15, max: 120 },
    bufferMinutes: { type: Number, default: 0, min: 0, max: 60 },
    maxPerDay: { type: Number, default: 8, min: 1, max: 30 },
    minNoticeHours: { type: Number, default: 2, min: 0, max: 168 },
    maxAdvanceDays: { type: Number, default: 30, min: 1, max: 90 },
    blockedDates: [String],
  },
  { timestamps: true }
);
availabilitySchema.index({ organizationId: 1, userId: 1 }, { unique: true });
export const HostAvailability = model('HostAvailability', availabilitySchema);

/** The reservation itself. The unique index is what makes double-booking impossible, even for two simultaneous requests. */
const slotSchema = new Schema({ organizationId: org, hostId: { ...user, required: true }, start: { type: Date, required: true }, visitId: { type: Schema.Types.ObjectId, ref: 'Visit' } }, { timestamps: true });
slotSchema.index({ hostId: 1, start: 1 }, { unique: true });
export const SlotLock = model('SlotLock', slotSchema);

const watchSchema = new Schema(
  {
    organizationId: org,
    name: { type: String, required: true, trim: true }, email: String, phone: String, company: String,
    level: { type: String, enum: ['flag', 'block'], default: 'flag' },
    reason: { type: String, required: true }, active: { type: Boolean, default: true }, expiresAt: Date,
    addedByName: String, hits: { type: Number, default: 0 }, lastHitAt: Date,
  },
  { timestamps: true }
);
watchSchema.plugin(softDeletePlugin);
export const WatchEntry = model('WatchEntry', watchSchema);

const evacSchema = new Schema(
  {
    organizationId: org,
    reason: { type: String, required: true }, drill: { type: Boolean, default: false },
    startedAt: { type: Date, default: Date.now }, startedByName: String, endedAt: Date, endedByName: String,
    people: [{ visitId: Schema.Types.ObjectId, name: String, company: String, phone: String, email: String, hostName: String, badgeNo: String, accountedAt: Date, accountedByName: String, note: String, _id: false }],
  },
  { timestamps: true }
);
export const EvacuationEvent = model('EvacuationEvent', evacSchema);
