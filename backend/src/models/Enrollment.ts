import { Schema, model } from 'mongoose';
import { softDeletePlugin } from '../utils/softDeletePlugin';

const enrollmentSchema = new Schema(
  {
    organizationId: { type: Schema.Types.ObjectId, ref: 'Organization', required: true, index: true },
    courseId: { type: Schema.Types.ObjectId, ref: 'Course', required: true, index: true },
    userId: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    status: { type: String, enum: ['enrolled', 'in_progress', 'completed', 'dropped'], default: 'enrolled' },
    progressPercent: { type: Number, min: 0, max: 100, default: 0 },
    completedModuleIds: [{ type: Schema.Types.ObjectId }], // subdocument ids within Course.modules the student has marked done
    startedAt: { type: Date },
    completedAt: { type: Date },
    assessmentScore: { type: Number, min: 0, max: 100 },
    certificateIssued: { type: Boolean, default: false },
    certificateDocumentId: { type: Schema.Types.ObjectId, ref: 'Document' },
  },
  { timestamps: true }
);

enrollmentSchema.index({ courseId: 1, userId: 1 }, { unique: true });

enrollmentSchema.plugin(softDeletePlugin);
export const Enrollment = model('Enrollment', enrollmentSchema);
