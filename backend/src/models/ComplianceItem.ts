import { Schema, model } from 'mongoose';
import { softDeletePlugin } from '../utils/softDeletePlugin';

const complianceItemSchema = new Schema(
  {
    organizationId: { type: Schema.Types.ObjectId, ref: 'Organization', required: true, index: true },
    title: { type: String, required: true, trim: true },
    framework: { type: String, enum: ['PCI-DSS', 'PCI-3DS', 'ISO27001', 'NDPR', 'SOC2', 'Internal SOP', 'Other'], default: 'Internal SOP' },
    description: { type: String },
    ownerId: { type: Schema.Types.ObjectId, ref: 'User' },
    relatedDocumentId: { type: Schema.Types.ObjectId, ref: 'Document' },
    relatedVendorId: { type: Schema.Types.ObjectId, ref: 'Vendor' },
    reviewFrequency: { type: String, enum: ['monthly', 'quarterly', 'annually'], default: 'annually' },
    lastReviewedAt: { type: Date },
    nextReviewDate: { type: Date, index: true },
    status: { type: String, enum: ['compliant', 'in_progress', 'non_compliant'], default: 'compliant' },
  },
  { timestamps: true }
);

complianceItemSchema.plugin(softDeletePlugin);
export const ComplianceItem = model('ComplianceItem', complianceItemSchema);
