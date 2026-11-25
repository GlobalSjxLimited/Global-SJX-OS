import { Schema, model } from 'mongoose';
import { softDeletePlugin } from '../utils/softDeletePlugin';
import { stampPlugin } from '../utils/stampPlugin';

const ticketReplySchema = new Schema(
  {
    authorId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    internal: { type: Boolean, default: false },
    body: { type: String, required: true },
  },
  { timestamps: true }
);

const ticketSchema = new Schema(
  {
    organizationId: { type: Schema.Types.ObjectId, ref: 'Organization', required: true, index: true },
    subject: { type: String, required: true, trim: true },
    description: { type: String, required: true },
    clientId: { type: Schema.Types.ObjectId, ref: 'Client' },
    requesterId: { type: Schema.Types.ObjectId, ref: 'User' },
    requesterName: { type: String, trim: true },
    requesterEmail: { type: String, trim: true, lowercase: true },
    source: { type: String, enum: ['internal', 'website'], default: 'internal', index: true },
    ipHash: { type: String },
    assigneeId: { type: Schema.Types.ObjectId, ref: 'User' },
    priority: { type: String, enum: ['low', 'medium', 'high', 'critical'], default: 'medium' },
    status: { type: String, enum: ['open', 'in_progress', 'waiting_on_client', 'resolved', 'closed'], default: 'open', index: true },
    category: { type: String, enum: ['technical', 'billing', 'access', 'general', 'website', 'academy_beta'], default: 'general' },
    replies: [ticketReplySchema],
    resolvedAt: { type: Date },
  },
  { timestamps: true }
);

ticketSchema.plugin(softDeletePlugin);
ticketSchema.plugin(stampPlugin);
export const Ticket = model('Ticket', ticketSchema);
