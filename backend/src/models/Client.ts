import { Schema, model } from 'mongoose';
import { stampPlugin } from '../utils/stampPlugin';
import { softDeletePlugin } from '../utils/softDeletePlugin';

const contactSchema = new Schema({
  name: { type: String, required: true },
  title: { type: String },
  email: { type: String },
  phone: { type: String },
  isPrimary: { type: Boolean, default: false },
});

const communicationSchema = new Schema(
  {
    type: { type: String, enum: ['call', 'email', 'meeting', 'note'], default: 'note' },
    summary: { type: String, required: true },
    authorId: { type: Schema.Types.ObjectId, ref: 'User' },
  },
  { timestamps: true }
);

const clientSchema = new Schema(
  {
    organizationId: { type: Schema.Types.ObjectId, ref: 'Organization', required: true, index: true },
    name: { type: String, required: true, trim: true },
    industry: {
      type: String,
      enum: [
        'Banking & Financial Services',
        'Insurance',
        'Government',
        'Healthcare',
        'Manufacturing',
        'Logistics',
        'Technology & IT-Enabled Services',
        'Other',
      ],
    },
    country: { type: String, default: 'Nigeria' },
    /** compulsory contact details for the company itself */
    email: { type: String, trim: true, lowercase: true },
    phone: { type: String, trim: true },
    state: { type: String, trim: true },
    website: { type: String },
    address: { type: String },
    logoUrl: { type: String },
    contacts: [contactSchema],
    servicesPurchased: [{ type: String }],
    contracts: [
      {
        title: String,
        reference: String,
        value: Number,
        currency: { type: String, default: 'NGN' },
        startDate: Date,
        endDate: Date,
        signedOn: Date,
        status: { type: String, enum: ['draft', 'sent', 'signed', 'active', 'expired', 'terminated'], default: 'draft' },
        signedByClient: String,
        signedByUs: String,
        notes: String,
        /** the signed copy — an uploaded file, 10 MB at most */
        signedDocument: { name: String, url: String, size: Number, uploadedById: { type: Schema.Types.ObjectId, ref: 'User' }, uploadedByName: String, uploadedAt: Date },
        documentId: { type: Schema.Types.ObjectId, ref: 'Document' },
        createdAt: { type: Date, default: Date.now },
      },
    ],
    communications: [communicationSchema],
    revenue: { type: Number, default: 0 },
    renewalDate: { type: Date },
    accountOwnerId: { type: Schema.Types.ObjectId, ref: 'User' },
    status: { type: String, enum: ['prospect', 'active', 'inactive', 'churned'], default: 'active' },
    lastActivityAt: { type: Date, default: Date.now },
  },
  { timestamps: true }
);

clientSchema.plugin(softDeletePlugin);
clientSchema.plugin(stampPlugin);
export const Client = model('Client', clientSchema);
