import { Schema, model } from 'mongoose';
import { softDeletePlugin } from '../utils/softDeletePlugin';

const certificationSchema = new Schema(
  {
    organizationId: { type: Schema.Types.ObjectId, ref: 'Organization', required: true, index: true },
    name: { type: String, required: true, trim: true },
    provider: { type: String, required: true },
    employeeId: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    dateObtained: { type: Date, required: true },
    expiryDate: { type: Date, index: true },
    /** The certificate itself (PDF / image) uploaded by HR or the employee. */
    certificateFile: {
      name: { type: String },
      url: { type: String },
      mimeType: { type: String },
      size: { type: Number },
      uploadedById: { type: Schema.Types.ObjectId, ref: 'User' },
      uploadedAt: { type: Date },
    },
    certificateDocumentId: { type: Schema.Types.ObjectId, ref: 'Document' },
    cost: { type: Number, default: 0 },
    currency: { type: String, default: 'USD' },
    renewalRequired: { type: Boolean, default: true },
    requiredForSkillId: { type: Schema.Types.ObjectId, ref: 'Skill' },
    requiredForRole: { type: String },
    requiredForVendorId: { type: Schema.Types.ObjectId, ref: 'Vendor' },
    status: { type: String, enum: ['active', 'expiring_soon', 'expired'], default: 'active' },
    // Update feed: exam postponed, meetings, new trainings attached, general notes
    updates: [
      {
        type: { type: String, enum: ['exam_postponed', 'exam_scheduled', 'meeting', 'training_attached', 'renewal', 'general'], default: 'general' },
        title: { type: String, required: true },
        body: { type: String, default: '' }, // rich text
        newDate: { type: Date },
        meetingId: { type: Schema.Types.ObjectId, ref: 'Meeting' },
        courseId: { type: Schema.Types.ObjectId, ref: 'Course' },
        links: [{ label: String, url: String }],
        authorId: { type: Schema.Types.ObjectId, ref: 'User' },
        createdAt: { type: Date, default: Date.now },
      },
    ],
  },
  { timestamps: true }
);

certificationSchema.index({ organizationId: 1, expiryDate: 1 });

certificationSchema.plugin(softDeletePlugin);
export const Certification = model('Certification', certificationSchema);
