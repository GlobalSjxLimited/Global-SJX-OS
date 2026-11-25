import { Schema, model } from 'mongoose';
import { softDeletePlugin } from '../utils/softDeletePlugin';

const groupSchema = new Schema(
  {
    organizationId: { type: Schema.Types.ObjectId, ref: 'Organization', required: true, index: true },
    name: { type: String, required: true, trim: true },
    description: { type: String },
    memberIds: [{ type: Schema.Types.ObjectId, ref: 'User' }],
    createdById: { type: Schema.Types.ObjectId, ref: 'User' },
  },
  { timestamps: true }
);

groupSchema.plugin(softDeletePlugin);
export const Group = model('Group', groupSchema);
