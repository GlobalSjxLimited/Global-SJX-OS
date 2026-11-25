import { Schema, model } from 'mongoose';

/** Everything people can discuss. Add a module here and it gets threads, replies, reactions, edit and delete. */
export const ENTITY_TYPES = ['task', 'project', 'milestone', 'client', 'opportunity', 'vendor', 'campaign', 'lead', 'expense', 'invoice', 'contract', 'sponsor', 'risk', 'goal', 'ticket', 'asset', 'incident', 'document', 'post'] as const;
export type EntityType = (typeof ENTITY_TYPES)[number];
export const REACTIONS = ['👍', '❤️', '🎉', '👀', '✅', '❓'] as const;

const reactionSchema = new Schema({ emoji: { type: String, enum: REACTIONS, required: true }, userId: { type: Schema.Types.ObjectId, ref: 'User', required: true }, name: String }, { _id: false });
const attachmentSchema = new Schema({ name: String, url: String, kind: { type: String, enum: ['file', 'image', 'link', 'evidence'], default: 'file' } }, { _id: false });

const discussionSchema = new Schema(
  {
    organizationId: { type: Schema.Types.ObjectId, ref: 'Organization', required: true, index: true },
    entityType: { type: String, enum: ENTITY_TYPES, required: true },
    entityId: { type: Schema.Types.ObjectId, required: true },
    /** parent record, e.g. the project a milestone belongs to */
    scopeId: { type: Schema.Types.ObjectId },
    parentId: { type: Schema.Types.ObjectId, ref: 'Discussion', index: true },
    kind: { type: String, enum: ['comment', 'status', 'system'], default: 'comment' },
    body: { type: String, required: true, maxlength: 8000 },
    /** for kind "status": what changed */
    status: { from: String, to: String, percent: Number },
    authorId: { type: Schema.Types.ObjectId, ref: 'User' },
    authorName: String,
    mentions: [{ type: Schema.Types.ObjectId, ref: 'User' }],
    /** tagged for awareness only — they are told, they do not have to act */
    awareness: [{ type: Schema.Types.ObjectId, ref: 'User' }],
    notify: { type: String, enum: ['none', 'mentioned', 'all'], default: 'mentioned' },
    attachments: [attachmentSchema],
    reactions: [reactionSchema],
    editedAt: Date,
    editedByName: String,
    history: [{ body: String, at: { type: Date, default: Date.now }, _id: false }],
    /** deleted comments stay as a placeholder so replies keep their place in the thread */
    isDeleted: { type: Boolean, default: false },
    deletedAt: Date,
    deletedByName: String,
    from: { ip: String, device: String },
    legacyId: { type: String, index: true, sparse: true }, // set when copied from an older embedded comment
  },
  { timestamps: true }
);
discussionSchema.index({ organizationId: 1, entityType: 1, entityId: 1, createdAt: 1 });
export const Discussion = model('Discussion', discussionSchema);
