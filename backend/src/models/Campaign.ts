import { Schema, model } from 'mongoose';
import { stampPlugin } from '../utils/stampPlugin';
import { softDeletePlugin } from '../utils/softDeletePlugin';
import { GOAL_KINDS, CHANNEL_KEYS, APPROVAL_STATUSES, POSTING_STATUSES } from '../config/marketing';

const campaignSchema = new Schema(
  {
    organizationId: { type: Schema.Types.ObjectId, ref: 'Organization', required: true, index: true },
    name: { type: String, required: true, trim: true },
    type: { type: String, enum: ['content', 'event', 'social', 'newsletter', 'article', 'paid'], default: 'content' },
    channel: { type: String },
    ownerId: { type: Schema.Types.ObjectId, ref: 'User' },
    startDate: { type: Date },
    endDate: { type: Date },
    status: { type: String, enum: ['planned', 'live', 'completed', 'cancelled'], default: 'planned' },
    budget: { type: Number, default: 0 },
    currency: { type: String, enum: ['NGN', 'USD', 'GBP', 'EUR'], default: 'NGN' },
    leadsGenerated: { type: Number, default: 0 },
    performanceNotes: { type: String },

    /** what the campaign is for and how success is measured */
    objective: { type: String, maxlength: 2000 },
    audience: { type: String, maxlength: 500 },
    goal: {
      kind: { type: String, enum: GOAL_KINDS, default: 'awareness' },
      target: { type: Number, default: 0, min: 0 },
      description: { type: String, maxlength: 500 },
    },
    /** where it will be posted (keys from config/marketing CHANNELS) */
    channels: [{ type: String, enum: CHANNEL_KEYS }],
    content: {
      headline: { type: String, maxlength: 300 },
      body: { type: String, maxlength: 20000 },
      callToAction: { type: String, maxlength: 200 },
      linkUrl: { type: String, maxlength: 500 },
      hashtags: [{ type: String, maxlength: 60 }],
    },
    /** pictures and banners (uploaded files, 10 MB each) */
    media: [{ url: { type: String, required: true }, name: String, size: Number, kind: { type: String, enum: ['image', 'banner'], default: 'image' }, alt: { type: String, maxlength: 300 } }],
    socialManagerId: { type: Schema.Types.ObjectId, ref: 'User' },
    approverId: { type: Schema.Types.ObjectId, ref: 'User' },
    /** nothing is posted until this says approved, for exactly this content (contentHash) */
    approval: {
      status: { type: String, enum: APPROVAL_STATUSES, default: 'draft' },
      submittedAt: Date, submittedById: { type: Schema.Types.ObjectId, ref: 'User' }, submittedByName: String,
      decidedAt: Date, decidedById: { type: Schema.Types.ObjectId, ref: 'User' }, decidedByName: String,
      note: { type: String, maxlength: 2000 },
      evidence: [{ url: String, name: String, size: Number, kind: { type: String, enum: ['file', 'link'], default: 'file' }, _id: false }],
      contentHash: String,
      selfApproved: { type: Boolean, default: false },
    },
    approvalHistory: [{ status: String, at: { type: Date, default: Date.now }, byId: { type: Schema.Types.ObjectId, ref: 'User' }, byName: String, note: String, _id: false }],
    /** one line per channel once it has been handed to the social media manager */
    postings: [{
      channel: { type: String, required: true },
      accountId: { type: Schema.Types.ObjectId, ref: 'SocialAccount' },
      accountLabel: String,
      managerId: { type: Schema.Types.ObjectId, ref: 'User' },
      status: { type: String, enum: POSTING_STATUSES, default: 'sent_to_manager' },
      via: { type: String, enum: ['manual', 'api'] },
      scheduledFor: Date,
      sentAt: Date, sentById: { type: Schema.Types.ObjectId, ref: 'User' }, sentByName: String,
      instructions: { type: String, maxlength: 1000 },
      postedAt: Date, postedByName: String, postUrl: String, externalId: String,
      proof: { url: String, name: String, size: Number },
      error: String,
      note: { type: String, maxlength: 1000 },
    }],
    /** what actually happened (rolled up; each update is also in the audit log) */
    metrics: {
      reach: { type: Number, default: 0 }, clicks: { type: Number, default: 0 }, leads: { type: Number, default: 0 }, conversions: { type: Number, default: 0 },
      spend: { type: Number, default: 0 }, revenue: { type: Number, default: 0 }, hires: { type: Number, default: 0 },
      updatedAt: Date, updatedByName: String,
    },
  },
  { timestamps: true }
);

campaignSchema.plugin(softDeletePlugin);
campaignSchema.plugin(stampPlugin);
export const Campaign = model('Campaign', campaignSchema);

const leadSchema = new Schema(
  {
    organizationId: { type: Schema.Types.ObjectId, ref: 'Organization', required: true, index: true },
    campaignId: { type: Schema.Types.ObjectId, ref: 'Campaign' },
    name: { type: String, required: true },
    email: { type: String },
    company: { type: String },
    source: { type: String },
    status: { type: String, enum: ['new', 'contacted', 'qualified', 'converted', 'lost'], default: 'new' },
    convertedOpportunityId: { type: Schema.Types.ObjectId, ref: 'Opportunity' },
  },
  { timestamps: true }
);

leadSchema.plugin(softDeletePlugin);
leadSchema.plugin(stampPlugin);
export const Lead = model('Lead', leadSchema);
