import { Schema, model } from 'mongoose';

/** One security questionnaire sent to one supplier through a private link. Only a hash of the link token is stored. */
const answerSchema = new Schema({ qid: { type: String, required: true }, answer: { type: String, enum: ['yes', 'partial', 'no', 'na'], required: true }, note: { type: String, maxlength: 1000 } }, { _id: false });
const assessmentSchema = new Schema(
  {
    organizationId: { type: Schema.Types.ObjectId, ref: 'Organization', required: true, index: true },
    reference: { type: String, required: true },
    vendorId: { type: Schema.Types.ObjectId, ref: 'Vendor' },
    reviewId: { type: Schema.Types.ObjectId, ref: 'OutsourcedReview' },
    supplier: { type: String, required: true, trim: true },
    contactName: { type: String, trim: true },
    contactEmail: { type: String, required: true, lowercase: true, trim: true },
    tokenHash: { type: String, required: true, unique: true },
    status: { type: String, enum: ['sent', 'in_progress', 'submitted', 'reviewed', 'expired', 'revoked'], default: 'sent', index: true },
    expiresAt: { type: Date, required: true },
    message: { type: String, maxlength: 1000 },
    answers: [answerSchema],
    completedBy: { name: String, role: String },
    score: Number, tier: { type: String, enum: ['low', 'medium', 'high'] }, critFails: [String],
    submittedAt: Date, openedAt: Date, lastSavedAt: Date, lastRemindedAt: Date, reminders: { type: Number, default: 0 },
    sentById: { type: Schema.Types.ObjectId, ref: 'User' }, sentByName: String,
    reviewedAt: Date, reviewedByName: String, reviewNote: String, decision: { type: String, enum: ['accepted', 'accepted_with_conditions', 'rejected'] },
    timeline: [{ at: Date, byName: String, text: String, _id: false }],
  },
  { timestamps: true }
);
assessmentSchema.index({ organizationId: 1, reference: 1 }, { unique: true });
export const SupplierAssessment = model('SupplierAssessment', assessmentSchema);
