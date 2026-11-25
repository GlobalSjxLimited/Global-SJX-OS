import { Schema, model } from 'mongoose';

/** A person decided that a catalogue threat does not apply to an asset (with a reason), so the engine never re-creates it. */
const decisionSchema = new Schema(
  {
    organizationId: { type: Schema.Types.ObjectId, ref: 'Organization', required: true, index: true },
    assetId: { type: Schema.Types.ObjectId, ref: 'Asset', required: true, index: true },
    assetRef: String,
    threatKey: { type: String, required: true },
    decision: { type: String, enum: ['dismissed'], default: 'dismissed' },
    reason: { type: String, required: true },
    byId: { type: Schema.Types.ObjectId, ref: 'User' },
    byName: String,
  },
  { timestamps: true }
);
decisionSchema.index({ assetId: 1, threatKey: 1 }, { unique: true });
export const AssetThreatDecision = model('AssetThreatDecision', decisionSchema);
