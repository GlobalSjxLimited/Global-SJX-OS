import { Schema, model } from 'mongoose';
import { softDeletePlugin } from '../utils/softDeletePlugin';

const reportSchema = new Schema(
  {
    organizationId: { type: Schema.Types.ObjectId, ref: 'Organization', required: true, index: true },
    title: { type: String, required: true, trim: true },
    type: {
      type: String,
      enum: ['project_status', 'financial', 'sales', 'hr', 'compliance', 'custom'],
      default: 'custom',
    },
    relatedProjectId: { type: Schema.Types.ObjectId, ref: 'Project' },
    relatedClientId: { type: Schema.Types.ObjectId, ref: 'Client' },
    generatedById: { type: Schema.Types.ObjectId, ref: 'User' },
    periodStart: { type: Date },
    periodEnd: { type: Date },
    summary: { type: String },
    data: { type: Schema.Types.Mixed }, // flexible payload for chart data etc.
    documentId: { type: Schema.Types.ObjectId, ref: 'Document' },
  },
  { timestamps: true }
);

reportSchema.plugin(softDeletePlugin);
export const Report = model('Report', reportSchema);
