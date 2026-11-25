import { Schema, model } from 'mongoose';
import { softDeletePlugin } from '../utils/softDeletePlugin';

const announcementSchema = new Schema(
  {
    organizationId: { type: Schema.Types.ObjectId, ref: 'Organization', required: true, index: true },
    title: { type: String, required: true, trim: true },
    body: { type: String, required: true },
    category: { type: String, enum: ['announcement', 'news', 'policy', 'recognition', 'event'], default: 'announcement' },
    authorId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    pinned: { type: Boolean, default: false },
    imageUrl: { type: String },
    reactions: [{ userId: { type: Schema.Types.ObjectId, ref: 'User' }, emoji: { type: String } }],
    comments: [
      {
        authorId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
        body: { type: String, required: true },
        createdAt: { type: Date, default: Date.now },
      },
    ],
  },
  { timestamps: true }
);

announcementSchema.plugin(softDeletePlugin);
export const Announcement = model('Announcement', announcementSchema);
