import { Schema, model } from 'mongoose';
import { softDeletePlugin } from '../utils/softDeletePlugin';
import { stampPlugin } from '../utils/stampPlugin';
import { CHANNEL_KEYS } from '../config/marketing';

/**
 * A page or profile the company posts on. `mode: 'manual'` = the social media manager posts by hand from the queue.
 * `mode: 'api'` = the app may publish for them, using the access token stored (encrypted) here.
 */
const socialAccountSchema = new Schema(
  {
    organizationId: { type: Schema.Types.ObjectId, ref: 'Organization', required: true, index: true },
    platform: { type: String, enum: CHANNEL_KEYS, required: true },
    label: { type: String, required: true, trim: true, maxlength: 120 },
    handle: { type: String, trim: true, maxlength: 120 },
    profileUrl: { type: String, trim: true, maxlength: 300 },
    /** Facebook Page id · Instagram business account id · LinkedIn organisation id */
    externalId: { type: String, trim: true, maxlength: 120 },
    managerId: { type: Schema.Types.ObjectId, ref: 'User' },
    mode: { type: String, enum: ['manual', 'api'], default: 'manual' },
    tokenEnc: { type: String, select: false },
    tokenLast4: String,
    tokenSetAt: Date,
    status: { type: String, enum: ['active', 'inactive', 'needs_attention'], default: 'active' },
    lastError: String,
    lastUsedAt: Date,
  },
  { timestamps: true }
);
socialAccountSchema.plugin(softDeletePlugin);
socialAccountSchema.plugin(stampPlugin);
export const SocialAccount = model('SocialAccount', socialAccountSchema);
