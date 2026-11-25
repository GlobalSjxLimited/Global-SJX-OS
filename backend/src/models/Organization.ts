import { Schema, model, Types, InferSchemaType } from 'mongoose';

/**
 * Every business record in the platform carries an organizationId.
 * Today there is exactly one organization ("Global SJX Limited"), but scoping
 * every query by organizationId from day one is what lets this become a
 * multi-tenant SaaS product later without migrating the schema.
 */
const organizationSchema = new Schema(
  {
    name: { type: String, required: true, trim: true },
    slug: { type: String, required: true, unique: true, lowercase: true, trim: true },
    isInternal: { type: Boolean, default: false }, // true only for Global SJX itself
    plan: { type: String, enum: ['internal', 'starter', 'growth', 'enterprise'], default: 'internal' },
    industry: { type: String },
    country: { type: String },
    logoUrl: { type: String },
    primaryColor: { type: String, default: '#C22FD4' },
    settings: {
      timezone: { type: String, default: 'Africa/Lagos' },
      fiscalYearStart: { type: Number, default: 1 }, // month 1-12
    },
    /** E-mail-to-task intake. The secret authenticates the inbound-mail webhook (rotate from the Intake page). */
    intake: {
      enabled: { type: Boolean, default: true },
      secretHash: { type: String, select: false },
      secretHint: { type: String },
      rotatedAt: { type: Date },
    },
    isActive: { type: Boolean, default: true },
  },
  { timestamps: true }
);

export type OrganizationDoc = InferSchemaType<typeof organizationSchema> & { _id: Types.ObjectId };
export const Organization = model('Organization', organizationSchema);
