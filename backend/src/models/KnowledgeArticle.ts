import { Schema, model } from 'mongoose';
import { softDeletePlugin } from '../utils/softDeletePlugin';

const knowledgeArticleSchema = new Schema(
  {
    organizationId: { type: Schema.Types.ObjectId, ref: 'Organization', required: true, index: true },
    title: { type: String, required: true, trim: true },
    type: { type: String, enum: ['SOP', 'Policy', 'Technical Documentation', 'Project Lesson', 'Case Study', 'Proposal Template', 'Training Material', 'General'], default: 'General' },
    content: { type: String, required: true }, // markdown/plain text body — powers simple keyword "semantic" search
    summary: { type: String, default: '' },
    categories: [{ type: String, trim: true }], // multi-category
    tags: [{ type: String }],
    // Website publishing (admin / CEO only)
    publishedToWebsite: { type: Boolean, default: false, index: true },
    publishedAt: { type: Date },
    publishedById: { type: Schema.Types.ObjectId, ref: 'User' },
    comments: [
      {
        authorId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
        body: { type: String, required: true },
        parentId: { type: Schema.Types.ObjectId }, // reply-to comment id
        createdAt: { type: Date, default: Date.now },
      },
    ],
    authorId: { type: Schema.Types.ObjectId, ref: 'User' },
    relatedProjectId: { type: Schema.Types.ObjectId, ref: 'Project' },
    status: { type: String, enum: ['draft', 'approved', 'archived'], default: 'approved' },
    viewCount: { type: Number, default: 0 },
  },
  { timestamps: true }
);

knowledgeArticleSchema.index({ title: 'text', content: 'text', tags: 'text' });

knowledgeArticleSchema.plugin(softDeletePlugin);
export const KnowledgeArticle = model('KnowledgeArticle', knowledgeArticleSchema);
