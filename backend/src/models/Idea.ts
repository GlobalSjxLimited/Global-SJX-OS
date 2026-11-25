import { Schema, model } from 'mongoose';
import { softDeletePlugin } from '../utils/softDeletePlugin';

export const IDEA_STAGES = [
  'Submitted',
  'Under Review',
  'Approved',
  'Prototype',
  'Pilot',
  'Launched',
  'Rejected',
  'Archived',
] as const;

const commentSchema = new Schema(
  {
    authorId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    body: { type: String, required: true },
  },
  { timestamps: true }
);

const linkSchema = new Schema(
  {
    label: { type: String, required: true },
    url: { type: String, required: true },
    addedById: { type: Schema.Types.ObjectId, ref: 'User' },
  },
  { timestamps: true }
);

const attachmentSchema = new Schema(
  {
    name: { type: String, required: true },
    url: { type: String, required: true },
    mimeType: { type: String },
    addedById: { type: Schema.Types.ObjectId, ref: 'User' },
  },
  { timestamps: true }
);

const ideaSchema = new Schema(
  {
    organizationId: { type: Schema.Types.ObjectId, ref: 'Organization', required: true, index: true },
    title: { type: String, required: true, trim: true },
    problem: { type: String, required: true },
    proposedSolution: { type: String, required: true },
    targetCustomer: { type: String },
    businessValue: { type: String },
    estimatedCost: { type: Number, default: 0 },
    expectedRevenue: { type: Number, default: 0 },
    resourcesNeeded: { type: String },
    strategicAlignment: { type: String },
    submittedById: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    stage: { type: String, enum: IDEA_STAGES, default: 'Submitted', index: true },
    votes: [{ type: Schema.Types.ObjectId, ref: 'User' }],
    comments: [commentSchema],
    links: [linkSchema],
    attachments: [attachmentSchema],
    aiScore: {
      strategicFit: { type: Number, min: 0, max: 10 },
      marketPotential: { type: Number, min: 0, max: 10 },
      complexity: { type: Number, min: 0, max: 10 },
      estimatedInvestmentBand: { type: String, enum: ['low', 'medium', 'high'] },
      revenuePotential: { type: Number, min: 0, max: 10 },
      overall: { type: Number, min: 0, max: 10 },
      scoredAt: { type: Date },
    },
    reviewerId: { type: Schema.Types.ObjectId, ref: 'User' },
    reviewNotes: { type: String },
  },
  { timestamps: true }
);

ideaSchema.plugin(softDeletePlugin);
export const Idea = model('Idea', ideaSchema);
