import { Schema, model } from 'mongoose';
import { softDeletePlugin } from '../utils/softDeletePlugin';

const submissionSchema = new Schema(
  {
    organizationId: { type: Schema.Types.ObjectId, ref: 'Organization', required: true, index: true },
    courseId: { type: Schema.Types.ObjectId, ref: 'Course', required: true, index: true },
    assignmentId: { type: Schema.Types.ObjectId, required: true }, // subdocument _id within Course.assignments
    userId: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    courseGroupId: { type: Schema.Types.ObjectId }, // set when submitting on behalf of a course group project
    text: { type: String },
    fileUrls: [{ url: String, name: String }],
    submittedAt: { type: Date, default: Date.now },
    score: { type: Number },
    feedback: { type: String },
    gradedById: { type: Schema.Types.ObjectId, ref: 'User' },
    gradedAt: { type: Date },
    status: { type: String, enum: ['submitted', 'graded', 'returned'], default: 'submitted' },
  },
  { timestamps: true }
);

submissionSchema.index({ assignmentId: 1, userId: 1 }, { unique: true });
submissionSchema.plugin(softDeletePlugin);
export const AssignmentSubmission = model('AssignmentSubmission', submissionSchema);
