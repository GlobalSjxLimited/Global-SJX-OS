import { Schema, model } from 'mongoose';
import { softDeletePlugin } from '../utils/softDeletePlugin';
import { stampPlugin } from '../utils/stampPlugin';
import { TASK_STATUSES, HOLD_REASONS } from '../config/taskStatus';
export { TASK_STATUSES };

export const SEVERITIES = ['trivial', 'minor', 'major', 'critical', 'show_stopper'] as const;

/** A file / recording / image / link attached to a task, subtask or milestone. */
export const documentSchema = new Schema(
  {
    name: { type: String, required: true },
    url: { type: String, required: true },
    kind: { type: String, enum: ['file', 'recording', 'image', 'link', 'evidence'], default: 'file' },
    note: { type: String },
    uploadedById: { type: Schema.Types.ObjectId, ref: 'User' },
    uploadedAt: { type: Date, default: Date.now },
  },
  { _id: true }
);

/** Comments double as the task's "latest updates" feed. */
export const commentSchema = new Schema(
  {
    authorId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    body: { type: String, required: true },
    kind: { type: String, enum: ['comment', 'update', 'update_request', 'blocker', 'completion'], default: 'comment' },
    attachments: [{ name: String, url: String }],
    requestedFromId: { type: Schema.Types.ObjectId, ref: 'User' }, // for update_request
  },
  { timestamps: true }
);

const activitySchema = new Schema(
  {
    actorId: { type: Schema.Types.ObjectId, ref: 'User' },
    action: { type: String, required: true }, // e.g. "status_changed", "assigned", "commented"
    meta: { type: Schema.Types.Mixed },
  },
  { timestamps: true }
);

/** Acceptance criteria: the "predetermined agreement" that must be met before completion. */
export const criterionSchema = new Schema({ text: { type: String, required: true }, met: { type: Boolean, default: false } });

/** Shared approval / completion record used by tasks, subtasks, milestones. */
export const approvalSchema = new Schema(
  {
    status: { type: String, enum: ['none', 'pending', 'approved', 'rejected'], default: 'none' },
    submittedById: { type: Schema.Types.ObjectId, ref: 'User' },
    submittedAt: { type: Date },
    completionNote: { type: String },
    decidedById: { type: Schema.Types.ObjectId, ref: 'User' },
    decidedAt: { type: Date },
    decisionNote: { type: String },
    certificateNo: { type: String }, // issued on approval
    ribbon: { type: String }, // e.g. "Gold standard", "Delivered with evidence"
  },
  { _id: false }
);

const taskSchema = new Schema(
  {
    organizationId: { type: Schema.Types.ObjectId, ref: 'Organization', required: true, index: true },
    title: { type: String, required: true, trim: true },
    description: { type: String },
    ownerId: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true }, // primary owner
    /** more people doing the work with the primary owner */
    coOwnerIds: [{ type: Schema.Types.ObjectId, ref: 'User', index: true }],
    reviewerId: { type: Schema.Types.ObjectId, ref: 'User' }, // who the task was sent to for review
    testerId: { type: Schema.Types.ObjectId, ref: 'User' },
    creatorId: { type: Schema.Types.ObjectId, ref: 'User', index: true },
    approverId: { type: Schema.Types.ObjectId, ref: 'User' },
    department: { type: String },
    priority: { type: String, enum: ['low', 'medium', 'high', 'urgent'], default: 'medium' },
    severity: { type: String, enum: SEVERITIES, default: 'minor', index: true },
    status: { type: String, enum: TASK_STATUSES, default: 'open', index: true },
    /** 0-99 while in progress; 100 means finished and sent for review */
    percentComplete: { type: Number, min: 0, max: 100, default: 0 },
    /** why the task is on hold and who it is waiting for */
    hold: {
      reason: { type: String, enum: HOLD_REASONS },
      note: String,
      awaitingUserId: { type: Schema.Types.ObjectId, ref: 'User' },
      linkedTaskId: { type: Schema.Types.ObjectId, ref: 'Task' }, // the task created for the person we are waiting for
      since: Date,
    },
    /** set when this task was created because another task is waiting on it */
    unblocksTaskId: { type: Schema.Types.ObjectId, ref: 'Task', index: true },
    /** delayed = an escalation: who has been told, how high it has gone */
    delay: {
      since: Date, originalDate: Date, newDate: Date, previousStatus: String, auto: Boolean,
      level: { type: Number, default: 0 }, escalatedAt: Date, notified: [{ type: Schema.Types.ObjectId, ref: 'User' }],
    },
    closedAt: Date,
    closedById: { type: Schema.Types.ObjectId, ref: 'User' },
    statusHistory: [{
      from: String, to: String, percent: Number, comment: String,
      byId: { type: Schema.Types.ObjectId, ref: 'User' }, byName: String, at: { type: Date, default: Date.now }, ip: String, device: String, _id: false,
    }],
    blocked: { type: Boolean, default: false },
    startDate: { type: Date, index: true },
    endDate: { type: Date },
    dueDate: { type: Date, index: true }, // kept equal to endDate for older screens and reminders
    projectId: { type: Schema.Types.ObjectId, ref: 'Project', index: true },
    milestoneId: { type: Schema.Types.ObjectId, index: true }, // sub-document id inside Project.milestones
    clientId: { type: Schema.Types.ObjectId, ref: 'Client' },
    dependencies: [{ type: Schema.Types.ObjectId, ref: 'Task' }],
    parentTaskId: { type: Schema.Types.ObjectId, ref: 'Task', index: true }, // subtasks
    confidential: { type: Boolean, default: false },
    sharedWith: [{ type: Schema.Types.ObjectId, ref: 'User' }], // explicit access (never used for confidential tasks except by owner/creator)
    attachments: [{ name: String, url: String }],
    documents: [documentSchema],
    comments: [commentSchema],
    activityHistory: [activitySchema],
    requireEvidence: { type: Boolean, default: false },
    acceptanceCriteria: [criterionSchema],
    evidence: [documentSchema],
    approval: { type: approvalSchema, default: () => ({ status: 'none' }) },
    source: { type: String, enum: ['manual', 'email', 'meeting', 'system'], default: 'manual' },
    sourceEmail: {
      messageId: String,
      from: String,
      subject: String,
      receivedAt: Date,
      matchedKeywords: [String],
      ruleId: { type: Schema.Types.ObjectId, ref: 'EmailIntakeRule' },
    },
    recurrence: {
      isRecurring: { type: Boolean, default: false },
      frequency: { type: String, enum: ['daily', 'weekly', 'monthly'] },
      nextRunDate: { type: Date },
    },
    reminderAt: { type: Date },
    tags: [{ type: String }],
    completedAt: { type: Date },
  },
  { timestamps: true }
);

taskSchema.index({ organizationId: 1, status: 1, dueDate: 1 });
taskSchema.index({ organizationId: 1, ownerId: 1, status: 1 });
taskSchema.index({ organizationId: 1, 'sourceEmail.messageId': 1 }, { sparse: true });

taskSchema.plugin(softDeletePlugin);
taskSchema.plugin(stampPlugin);
taskSchema.index({ organizationId: 1, coOwnerIds: 1, status: 1 });
export const Task = model('Task', taskSchema);
