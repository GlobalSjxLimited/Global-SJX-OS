import { Schema, model } from 'mongoose';

/**
 * Rules that turn inbound e-mail into tasks. Example: during a training with
 * a client, we tell them "any e-mail you want us to act on must contain
 * task / training / audit and mention your organisation" — the rule below
 * checks exactly that.
 */
const ruleSchema = new Schema(
  {
    organizationId: { type: Schema.Types.ObjectId, ref: 'Organization', required: true, index: true },
    name: { type: String, required: true, trim: true },
    active: { type: Boolean, default: true },
    keywords: [{ type: String, trim: true, lowercase: true }],
    matchMode: { type: String, enum: ['any', 'all'], default: 'any' }, // any keyword, or all of them
    /** Organisation names that must be mentioned (subject/body) or match the sender's client record. */
    organisations: [{ type: String, trim: true }],
    requireOrganisation: { type: Boolean, default: true },
    /** Extra allow-list: only mail from these domains is considered (empty = any domain). */
    senderDomains: [{ type: String, trim: true, lowercase: true }],
    /** Accept mail from people we do not know? Off by default — unknown senders are logged, not turned into tasks. */
    allowUnknownSenders: { type: Boolean, default: false },
    defaultAssigneeId: { type: Schema.Types.ObjectId, ref: 'User' },
    defaultProjectId: { type: Schema.Types.ObjectId, ref: 'Project' },
    defaultPriority: { type: String, enum: ['low', 'medium', 'high', 'urgent'], default: 'medium' },
    defaultSeverity: { type: String, enum: ['trivial', 'minor', 'major', 'critical', 'show_stopper'], default: 'minor' },
    dueInDays: { type: Number, default: 7, min: 0, max: 365 },
    /** Send a short "we received your request" reply to a known sender. Off by default. */
    acknowledgeSender: { type: Boolean, default: false },
    notifyUserIds: [{ type: Schema.Types.ObjectId, ref: 'User' }],
    createdById: { type: Schema.Types.ObjectId, ref: 'User' },
    matchedCount: { type: Number, default: 0 },
  },
  { timestamps: true }
);

const logSchema = new Schema(
  {
    organizationId: { type: Schema.Types.ObjectId, ref: 'Organization', required: true, index: true },
    messageId: { type: String, index: true },
    from: String,
    fromName: String,
    subject: String,
    snippet: String,
    receivedAt: { type: Date, default: Date.now },
    outcome: { type: String, enum: ['task_created', 'ignored', 'error'], required: true, index: true },
    reason: String,
    ruleId: { type: Schema.Types.ObjectId, ref: 'EmailIntakeRule' },
    matchedKeywords: [String],
    matchedOrganisation: String,
    taskId: { type: Schema.Types.ObjectId, ref: 'Task' },
    channel: { type: String, enum: ['webhook', 'imap', 'manual', 'test'], default: 'webhook' },
    /** kept so an admin can press "create task anyway" on an ignored mail */
    body: { type: String, select: false },
  },
  { timestamps: true }
);
logSchema.index({ organizationId: 1, messageId: 1 }, { unique: true, partialFilterExpression: { messageId: { $type: 'string' } } });

export const EmailIntakeRule = model('EmailIntakeRule', ruleSchema);
export const EmailIntakeLog = model('EmailIntakeLog', logSchema);
