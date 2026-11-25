import { Schema, model } from 'mongoose';

/**
 * Audit trail (ISO/IEC 27001:2022 A.8.15 logging). Entries are append-only from the
 * application's point of view and are sealed daily (see services/audit.service.ts) so
 * tampering with historical rows is detectable.
 */
const activityLogSchema = new Schema(
  {
    organizationId: { type: Schema.Types.ObjectId, ref: 'Organization', required: true, index: true },
    actorId: { type: Schema.Types.ObjectId, ref: 'User' },
    actorName: { type: String },
    action: { type: String, required: true }, // e.g. "task.created", "auth.login_failed"
    entityType: { type: String, required: true }, // e.g. "Task"
    entityId: { type: Schema.Types.ObjectId },
    severity: { type: String, enum: ['info', 'low', 'medium', 'high', 'critical'], default: 'info', index: true },
    status: { type: String, enum: ['success', 'failed'], default: 'success' },
    module: { type: String },
    summary: { type: String },
    meta: { type: Schema.Types.Mixed },
    ip: { type: String },
    userAgent: { type: String },
    requestId: { type: String },
  },
  { timestamps: true }
);

activityLogSchema.index({ organizationId: 1, createdAt: -1 });
activityLogSchema.index({ organizationId: 1, action: 1, createdAt: -1 });

export const ActivityLog = model('ActivityLog', activityLogSchema);

const HIGH = /(locked|mfa_disabled|role_changed|sessions_revoked|credentials|reveal|erasure|breach|disposal\.(approved|completed)|access\.|tamper|export)/i;
const MEDIUM = /(failed|denied|deleted|rejected|password|disabled|revoked|approved|paid|remitted|offboard)/i;

export function severityFor(action: string): 'info' | 'low' | 'medium' | 'high' | 'critical' {
  if (/tamper|integrity_failure|breach\.(deadline|overdue)/i.test(action)) return 'critical';
  if (HIGH.test(action)) return 'high';
  if (MEDIUM.test(action)) return 'medium';
  return 'info';
}

export async function logActivity(params: {
  organizationId: string;
  actorId?: string;
  actorName?: string;
  action: string;
  entityType: string;
  entityId?: string;
  meta?: unknown;
  severity?: 'info' | 'low' | 'medium' | 'high' | 'critical';
  status?: 'success' | 'failed';
  module?: string;
  summary?: string;
  ip?: string;
  userAgent?: string;
  requestId?: string;
}): Promise<void> {
  const failed = params.status === 'failed' || /failed|denied/.test(params.action);
  await ActivityLog.create({ ...params, status: failed ? 'failed' : params.status || 'success', severity: params.severity || severityFor(params.action) });
}
