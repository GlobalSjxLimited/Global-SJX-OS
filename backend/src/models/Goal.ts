import { Schema, model } from 'mongoose';
import { softDeletePlugin } from '../utils/softDeletePlugin';
import { stampPlugin } from '../utils/stampPlugin';
import { documentSchema } from './Task';

const keyResultSchema = new Schema({
  description: { type: String, required: true },
  targetValue: { type: Number, default: 100 },
  currentValue: { type: Number, default: 0 },
  unit: { type: String, default: '%' },
});

const goalSchema = new Schema(
  {
    organizationId: { type: Schema.Types.ObjectId, ref: 'Organization', required: true, index: true },
    title: { type: String, required: true, trim: true },
    description: { type: String },
    level: { type: String, enum: ['company', 'department', 'team', 'employee'], required: true, index: true },
    department: { type: String },
    ownerId: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    createdById: { type: Schema.Types.ObjectId, ref: 'User' },
    parentGoalId: { type: Schema.Types.ObjectId, ref: 'Goal' }, // cascade: employee -> team -> department -> company
    keyResults: [keyResultSchema],
    quarter: { type: String, index: true }, // e.g. "2026-Q3"
    startDate: { type: Date },
    endDate: { type: Date },
    /** Only the owner may change this (enforced in goals.routes). */
    progressPercent: { type: Number, min: 0, max: 100, default: 0 },
    status: { type: String, enum: ['not_started', 'on_track', 'at_risk', 'completed'], default: 'not_started' },
    /** Proof the goal was achieved. A goal cannot be marked completed without it. */
    evidence: [documentSchema],
    completionNote: { type: String },
    completedAt: { type: Date },
    verifiedById: { type: Schema.Types.ObjectId, ref: 'User' },
    verifiedAt: { type: Date },
    certificateNo: { type: String },
    progressLog: [{ value: Number, note: String, at: { type: Date, default: Date.now }, byId: { type: Schema.Types.ObjectId, ref: 'User' }, _id: false }],
  },
  { timestamps: true }
);

goalSchema.plugin(softDeletePlugin);
goalSchema.plugin(stampPlugin);
export const Goal = model('Goal', goalSchema);
