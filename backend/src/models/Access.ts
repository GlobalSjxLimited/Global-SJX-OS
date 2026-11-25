import { Schema, model } from 'mongoose';

/** Org-level override of which modules a role gets (falls back to DEFAULT_ROLE_MODULES when absent). */
const roleModuleSchema = new Schema(
  {
    organizationId: { type: Schema.Types.ObjectId, ref: 'Organization', required: true },
    role: { type: String, required: true },
    modules: [{ type: String }],
    updatedById: { type: Schema.Types.ObjectId, ref: 'User' },
  },
  { timestamps: true }
);
roleModuleSchema.index({ organizationId: 1, role: 1 }, { unique: true });
export const RoleModuleConfig = model('RoleModuleConfig', roleModuleSchema);

/** One row per signed-in device. The JWT carries the session id (sid); revoking a row kills that device only. */
const sessionSchema = new Schema(
  {
    organizationId: { type: Schema.Types.ObjectId, ref: 'Organization', required: true },
    userId: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    ip: { type: String },
    userAgent: { type: String },
    device: { type: String },
    browser: { type: String },
    lastSeenAt: { type: Date, default: Date.now },
    expiresAt: { type: Date, required: true },
    isActive: { type: Boolean, default: true },
    terminatedAt: { type: Date },
    terminationReason: { type: String },
  },
  { timestamps: true }
);
sessionSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 60 * 60 * 24 * 30 }); // purge a month after expiry
export const UserSession = model('UserSession', sessionSchema);

/** Human-readable running numbers (INV-2026-00012, EXP-2026-00003 …) — atomic, so no duplicates under concurrency. */
const counterSchema = new Schema({
  organizationId: { type: Schema.Types.ObjectId, required: true },
  key: { type: String, required: true },
  seq: { type: Number, default: 0 },
});
counterSchema.index({ organizationId: 1, key: 1 }, { unique: true });
export const Counter = model('Counter', counterSchema);

export async function nextNumber(organizationId: string, prefix: string, opts: { yearly?: boolean; pad?: number } = {}): Promise<string> {
  const { yearly = true, pad = 5 } = opts;
  const year = new Date().getFullYear();
  const key = yearly ? `${prefix}-${year}` : prefix;
  const c = await Counter.findOneAndUpdate({ organizationId, key }, { $inc: { seq: 1 } }, { new: true, upsert: true });
  const n = String(c!.seq).padStart(pad, '0');
  return yearly ? `${prefix}-${year}-${n}` : `${prefix}-${n}`;
}

/** Prevents the same reminder being sent twice (key = reminder type + record + day). Auto-purges after 120 days. */
const reminderLogSchema = new Schema({
  organizationId: { type: Schema.Types.ObjectId, required: true },
  key: { type: String, required: true },
  createdAt: { type: Date, default: Date.now, expires: 60 * 60 * 24 * 120 },
});
reminderLogSchema.index({ organizationId: 1, key: 1 }, { unique: true });
export const ReminderLog = model('ReminderLog', reminderLogSchema);
