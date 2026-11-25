import { Schema, model } from 'mongoose';
import { softDeletePlugin } from '../utils/softDeletePlugin';

/** A file attached to any record (client, vendor, opportunity, campaign …). Same entity types as comments. */
const entityDocumentSchema = new Schema(
  {
    organizationId: { type: Schema.Types.ObjectId, ref: 'Organization', required: true, index: true },
    entityType: { type: String, required: true },
    entityId: { type: Schema.Types.ObjectId, required: true },
    scopeId: { type: Schema.Types.ObjectId },
    name: { type: String, required: true, maxlength: 200 },
    url: { type: String, required: true },
    size: { type: Number, default: 0 },
    kind: { type: String, enum: ['contract', 'proposal', 'signed', 'invoice', 'receipt', 'image', 'banner', 'other'], default: 'other' },
    note: { type: String, maxlength: 1000 },
    uploadedById: { type: Schema.Types.ObjectId, ref: 'User' },
    uploadedByName: String,
  },
  { timestamps: true }
);
entityDocumentSchema.index({ organizationId: 1, entityType: 1, entityId: 1, createdAt: -1 });
entityDocumentSchema.plugin(softDeletePlugin);
export const EntityDocument = model('EntityDocument', entityDocumentSchema);
