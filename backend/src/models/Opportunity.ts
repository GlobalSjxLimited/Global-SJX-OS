import { Schema, model } from 'mongoose';
import { softDeletePlugin } from '../utils/softDeletePlugin';
import { stampPlugin } from '../utils/stampPlugin';
import { PIPELINE_STAGES } from '../config/pipeline';

export { PIPELINE_STAGES };

const contactSchema = new Schema({
  name: { type: String, required: true, trim: true },
  title: { type: String, trim: true },
  email: { type: String, trim: true, lowercase: true },
  phone: { type: String, trim: true },
  role: { type: String, enum: ['decision_maker', 'influencer', 'champion', 'technical', 'finance', 'other'], default: 'other' },
  isPrimary: { type: Boolean, default: false },
  clientContactId: { type: Schema.Types.ObjectId }, // set when copied from the client's contact list
});

const opportunitySchema = new Schema(
  {
    organizationId: { type: Schema.Types.ObjectId, ref: 'Organization', required: true, index: true },
    title: { type: String, required: true, trim: true },
    clientId: { type: Schema.Types.ObjectId, ref: 'Client' },
    prospectName: { type: String }, // for opportunities not yet linked to a Client record
    /** the project this opportunity grew out of (follow-on work, upsell, renewal) */
    sourceProjectId: { type: Schema.Types.ObjectId, ref: 'Project', index: true },
    source: { type: String, enum: ['manual', 'project', 'campaign', 'referral', 'event', 'inbound', 'other'], default: 'manual' },
    stage: { type: String, enum: PIPELINE_STAGES, default: 'Lead', index: true },
    value: { type: Number, default: 0 },
    currency: { type: String, default: 'NGN' },
    probability: { type: Number, min: 0, max: 100, default: 10 },
    startDate: { type: Date }, // when the work would begin
    expectedCloseDate: { type: Date },
    salespersonId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    contacts: [contactSchema],
    productsServices: [{ type: String }],
    proposalDocumentId: { type: Schema.Types.ObjectId, ref: 'Document' },
    competitors: [{ type: String }],
    nextAction: { type: String },
    nextActionDate: { type: Date },
    lostReason: { type: String },
    winReason: { type: String },
    closedAt: { type: Date },
    stageHistory: [
      {
        stage: { type: String }, // plain text so old entries ("Won") stay readable
        from: String,
        changedAt: { type: Date, default: Date.now },
        comment: String,
        byId: { type: Schema.Types.ObjectId, ref: 'User' },
        byName: String,
        ip: String,
        device: String,
        _id: false,
      },
    ],
  },
  { timestamps: true }
);

opportunitySchema.plugin(softDeletePlugin);
opportunitySchema.plugin(stampPlugin);
export const Opportunity = model('Opportunity', opportunitySchema);
