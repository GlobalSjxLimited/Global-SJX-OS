import { Schema, model } from 'mongoose';
import { stampPlugin } from '../utils/stampPlugin';
import { softDeletePlugin } from '../utils/softDeletePlugin';

const sponsorSchema = new Schema(
  {
    organizationId: { type: Schema.Types.ObjectId, ref: 'Organization', required: true, index: true },
    name: { type: String, required: true, trim: true },
    type: { type: String, enum: ['event', 'academy', 'community', 'other'], default: 'event' },
    contribution: { type: Number, default: 0 },
    currency: { type: String, default: 'NGN' },
    contactName: { type: String },
    contactEmail: { type: String },
    contactPhone: { type: String },
    relatedEvent: { type: String },
    startDate: { type: Date },
    endDate: { type: Date },
    status: { type: String, enum: ['prospective', 'confirmed', 'completed'], default: 'prospective' },
    notes: { type: String },
  },
  { timestamps: true }
);

sponsorSchema.plugin(softDeletePlugin);
sponsorSchema.plugin(stampPlugin);
export const Sponsor = model('Sponsor', sponsorSchema);
