import { Schema, model } from 'mongoose';

const notificationSchema = new Schema(
  {
    organizationId: { type: Schema.Types.ObjectId, ref: 'Organization', required: true, index: true },
    userId: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    type: {
      type: String,
      enum: ['task', 'project', 'certification', 'contract', 'meeting', 'idea', 'ticket', 'system', 'automation', 'mention', 'security', 'course', 'knowledge', 'recognition', 'finance', 'expense', 'asset', 'data_protection', 'incident', 'policy', 'access', 'reminder', 'dsar', 'compliance', 'report', 'risk', 'goal', 'offboarding', 'threat_intel', 'comment', 'marketing', 'sales', 'approval'],
      default: 'system',
    },
    title: { type: String, required: true },
    body: { type: String },
    link: { type: String }, // frontend route, e.g. /tasks/:id
    isRead: { type: Boolean, default: false, index: true },
    severity: { type: String, enum: ['info', 'warning', 'high', 'critical'], default: 'info' },
    acknowledgedAt: { type: Date },
  },
  { timestamps: true }
);

export const Notification = model('Notification', notificationSchema);
