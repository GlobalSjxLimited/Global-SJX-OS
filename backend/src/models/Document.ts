import { Schema, model } from 'mongoose';
import { stampPlugin } from '../utils/stampPlugin';
import { softDeletePlugin } from '../utils/softDeletePlugin';

export const DOCUMENT_CATEGORIES = [
  'Corporate',
  'Legal',
  'Finance',
  'HR',
  'Clients',
  'Projects',
  'Vendors',
  'Certifications',
  'Compliance',
  'Marketing',
  'Training',
  'Contracts',
  'Proposals',
  'Reports',
] as const;

const versionSchema = new Schema(
  {
    versionNumber: { type: Number, required: true },
    url: { type: String, required: true },
    uploadedById: { type: Schema.Types.ObjectId, ref: 'User' },
    notes: { type: String },
  },
  { timestamps: true }
);

const documentSchema = new Schema(
  {
    organizationId: { type: Schema.Types.ObjectId, ref: 'Organization', required: true, index: true },
    title: { type: String, required: true, trim: true },
    category: { type: String, enum: DOCUMENT_CATEGORIES, required: true, index: true },
    description: { type: String },
    url: { type: String }, // link to storage (S3/Drive/etc) — external storage integration is a follow-up
    fileType: { type: String },
    ownerId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    relatedProjectId: { type: Schema.Types.ObjectId, ref: 'Project' },
    relatedClientId: { type: Schema.Types.ObjectId, ref: 'Client' },
    relatedVendorId: { type: Schema.Types.ObjectId, ref: 'Vendor' },
    expiryDate: { type: Date },
    reviewDate: { type: Date },
    permissions: {
      visibility: { type: String, enum: ['organization', 'department', 'restricted'], default: 'organization' },
      allowedRoles: [{ type: String }],
      allowedUserIds: [{ type: Schema.Types.ObjectId, ref: 'User' }],
    },
    versions: [versionSchema],
    tags: [{ type: String }],
  },
  { timestamps: true }
);

documentSchema.plugin(softDeletePlugin);
documentSchema.plugin(stampPlugin);
export const Document = model('Document', documentSchema);
