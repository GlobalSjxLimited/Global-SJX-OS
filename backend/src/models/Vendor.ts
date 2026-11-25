import { Schema, model } from 'mongoose';
import { stampPlugin } from '../utils/stampPlugin';
import { softDeletePlugin } from '../utils/softDeletePlugin';

const vendorSchema = new Schema(
  {
    organizationId: { type: Schema.Types.ObjectId, ref: 'Organization', required: true, index: true },
    name: { type: String, required: true, trim: true },
    products: [{ type: String }],
    partnerLevel: { type: String, enum: ['Registered', 'Silver', 'Gold', 'Platinum', 'Strategic'], default: 'Registered' },
    /** the company itself */
    email: { type: String, trim: true, lowercase: true },
    phone: { type: String, trim: true },
    address: { type: String, trim: true },
    website: { type: String, trim: true },
    startDate: { type: Date }, // when the partnership began
    /** the people we deal with there */
    contacts: [{ name: { type: String, required: true, trim: true }, title: String, email: { type: String, lowercase: true, trim: true }, phone: String, isPrimary: { type: Boolean, default: false } }],
    contracts: [{ title: String, startDate: Date, endDate: Date, value: Number, currency: { type: String, default: 'USD' } }],
    certifications: [{ type: Schema.Types.ObjectId, ref: 'Certification' }],
    renewalDate: { type: Date },
    revenue: { type: Number, default: 0 },
    opportunities: [{ type: Schema.Types.ObjectId, ref: 'Opportunity' }],
    training: [{ type: String }],
    performanceRating: { type: Number, min: 1, max: 5, default: 4 },
    logoUrl: { type: String },
    status: { type: String, enum: ['active', 'inactive'], default: 'active' },
  },
  { timestamps: true }
);

vendorSchema.plugin(softDeletePlugin);
vendorSchema.plugin(stampPlugin);
export const Vendor = model('Vendor', vendorSchema);
