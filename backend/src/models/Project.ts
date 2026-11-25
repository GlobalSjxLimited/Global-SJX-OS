import { Schema, model } from 'mongoose';
import { stampPlugin } from '../utils/stampPlugin';
import { softDeletePlugin } from '../utils/softDeletePlugin';
import { SEVERITIES, documentSchema, commentSchema, criterionSchema, approvalSchema } from './Task';

export const MILESTONE_STATUSES = ['pending', 'in_progress', 'blocked', 'awaiting_approval', 'completed', 'overdue'] as const;

const milestoneSchema = new Schema(
  {
    title: { type: String, required: true },
    description: { type: String },
    severity: { type: String, enum: SEVERITIES, default: 'major' },
    ownerId: { type: Schema.Types.ObjectId, ref: 'User' },
    approverId: { type: Schema.Types.ObjectId, ref: 'User' },
    startDate: { type: Date },
    endDate: { type: Date },
    dueDate: { type: Date }, // mirrors endDate (older screens + overdue job)
    status: { type: String, enum: MILESTONE_STATUSES, default: 'pending' },
    blocked: { type: Boolean, default: false },
    requireEvidence: { type: Boolean, default: true },
    acceptanceCriteria: [criterionSchema],
    evidence: [documentSchema],
    documents: [documentSchema],
    updates: [commentSchema],
    approval: { type: approvalSchema, default: () => ({ status: 'none' }) },
    completedAt: { type: Date },
  },
  { timestamps: true }
);

const expenseSchema = new Schema(
  {
    label: { type: String, required: true },
    amount: { type: Number, required: true },
    currency: { type: String, default: 'NGN' },
    date: { type: Date, default: Date.now },
    category: { type: String },
  },
  { timestamps: true }
);

/** Why a project changed state (mainly on hold / paused) — powers the "why is it on hold" report. */
const statusHistorySchema = new Schema(
  {
    from: String,
    to: String,
    reason: String,
    comment: String,
    byName: String,
    ip: String,
    device: String,
    byId: { type: Schema.Types.ObjectId, ref: 'User' },
    at: { type: Date, default: Date.now },
  },
  { _id: false }
);

const projectSchema = new Schema(
  {
    organizationId: { type: Schema.Types.ObjectId, ref: 'Organization', required: true, index: true },
    name: { type: String, required: true, trim: true },
    overview: { type: String },
    clientId: { type: Schema.Types.ObjectId, ref: 'Client', index: true },
    practice: {
      type: String,
      enum: [
        'Cybersecurity & Digital Trust',
        'Payments & Financial Technology',
        'Cloud, Infrastructure & Performance',
        'Digital Transformation & Software',
        'Technology Advisory & Project Delivery',
      ],
    },
    projectManagerId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    team: [{ type: Schema.Types.ObjectId, ref: 'User' }],
    budget: { type: Number, default: 0 },
    revenue: { type: Number, default: 0 },
    currency: { type: String, default: 'NGN' },
    startDate: { type: Date },
    endDate: { type: Date }, // optional — ongoing / retainer projects have no end
    status: {
      type: String,
      // Life-cycle phases, then the two standing states. on_hold stays for projects that are paused on purpose.
      enum: ['initiation', 'planning', 'execution', 'monitoring', 'closure', 'active', 'inactive', 'on_hold', 'paused', 'completed', 'cancelled'],
      default: 'initiation',
      index: true,
    },
    holdReason: { type: String },
    heldAt: { type: Date },
    statusHistory: [statusHistorySchema],
    comments: [commentSchema], // project-level comments / issues
    health: { type: String, enum: ['on_track', 'at_risk', 'off_track'], default: 'on_track' },
    milestones: [milestoneSchema],
    expenses: [expenseSchema],
    deliverables: [{ title: String, status: { type: String, enum: ['pending', 'delivered'], default: 'pending' } }],
  },
  { timestamps: true }
);

projectSchema.plugin(softDeletePlugin);
projectSchema.plugin(stampPlugin);
export const Project = model('Project', projectSchema);
