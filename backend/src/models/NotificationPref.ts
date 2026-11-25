import { Schema, model } from 'mongoose';

/** What a person wants to hear about. Missing entries mean "yes" (in-app on, e-mail on for important things). */
export const NOTIFY_CATEGORIES = [
  { key: 'tasks', label: 'Tasks assigned to me or that I follow', email: true },
  { key: 'task_updates', label: 'Updates and status changes on tasks', email: false },
  { key: 'comments', label: 'Replies and comments on things I follow', email: false },
  { key: 'mentions', label: 'When someone tags me', email: true },
  { key: 'projects', label: 'Project and milestone activity', email: false },
  { key: 'sales', label: 'Clients, opportunities and contracts', email: false },
  { key: 'marketing', label: 'Campaigns and approvals', email: true },
  { key: 'finance', label: 'Expenses and invoices', email: true },
  { key: 'reminders', label: 'Reminders and deadlines', email: true },
] as const;
/** Never switched off — security and compliance notices. */
export const MANDATORY = ['security', 'system', 'incident', 'access', 'offboarding'];

const prefSchema = new Schema(
  {
    organizationId: { type: Schema.Types.ObjectId, ref: 'Organization', required: true },
    userId: { type: Schema.Types.ObjectId, ref: 'User', required: true, unique: true },
    categories: { type: Schema.Types.Mixed, default: {} }, // { tasks: { inApp: true, email: true }, … }
    mutes: [{ entityType: String, entityId: Schema.Types.ObjectId, at: { type: Date, default: Date.now }, _id: false }],
  },
  { timestamps: true }
);
export const NotificationPref = model('NotificationPref', prefSchema);
