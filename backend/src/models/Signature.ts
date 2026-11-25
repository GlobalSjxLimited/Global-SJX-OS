import { Schema, model } from 'mongoose';

/** A document (plain text) sent to one or more people to sign electronically. The text is frozen at sending: its SHA-256 is recorded and shown on the certificate. */
const signerSchema = new Schema({
  name: { type: String, required: true, trim: true }, email: { type: String, required: true, lowercase: true, trim: true },
  tokenHash: { type: String, required: true }, status: { type: String, enum: ['pending', 'signed', 'declined'], default: 'pending' },
  openedAt: Date, signedAt: Date, typedName: String, ipHash: String, userAgent: String, declineReason: String, lastRemindedAt: Date, reminders: { type: Number, default: 0 },
});
const sigSchema = new Schema(
  {
    organizationId: { type: Schema.Types.ObjectId, ref: 'Organization', required: true, index: true },
    reference: { type: String, required: true }, title: { type: String, required: true, trim: true }, body: { type: String, required: true },
    bodyHash: { type: String, required: true }, category: { type: String, enum: ['nda', 'contract', 'policy', 'supplier', 'other'], default: 'other' },
    vendorId: { type: Schema.Types.ObjectId, ref: 'Vendor' },
    signers: [signerSchema], status: { type: String, enum: ['out_for_signature', 'completed', 'declined', 'expired', 'cancelled'], default: 'out_for_signature', index: true },
    expiresAt: { type: Date, required: true }, completedAt: Date, createdById: { type: Schema.Types.ObjectId, ref: 'User' }, createdByName: String,
    timeline: [{ at: Date, byName: String, text: String, _id: false }],
  },
  { timestamps: true }
);
sigSchema.index({ organizationId: 1, reference: 1 }, { unique: true });
sigSchema.index({ 'signers.tokenHash': 1 });
export const SignatureRequest = model('SignatureRequest', sigSchema);
