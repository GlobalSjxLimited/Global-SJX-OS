import { Schema, model } from 'mongoose';
import { softDeletePlugin } from '../utils/softDeletePlugin';

const quizAttemptSchema = new Schema(
  {
    organizationId: { type: Schema.Types.ObjectId, ref: 'Organization', required: true, index: true },
    courseId: { type: Schema.Types.ObjectId, ref: 'Course', required: true, index: true },
    quizId: { type: Schema.Types.ObjectId, required: true }, // subdocument _id within Course.quizzes
    userId: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    answers: [{ type: Number }], // one selected option index per question, in question order
    score: { type: Number, required: true },
    maxScore: { type: Number, required: true },
    submittedAt: { type: Date, default: Date.now },
  },
  { timestamps: true }
);

quizAttemptSchema.plugin(softDeletePlugin);
export const QuizAttempt = model('QuizAttempt', quizAttemptSchema);
