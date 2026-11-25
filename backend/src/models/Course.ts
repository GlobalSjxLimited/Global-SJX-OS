import { Schema, model } from 'mongoose';
import { softDeletePlugin } from '../utils/softDeletePlugin';

const moduleSchema = new Schema(
  {
    title: { type: String, required: true },
    description: { type: String },
    contentUrl: { type: String }, // link to a document/video/slide, or left blank for text-only content
    body: { type: String }, // inline text/markdown content
    order: { type: Number, default: 0 },
  },
  { timestamps: true }
);

const assignmentSchema = new Schema(
  {
    title: { type: String, required: true },
    description: { type: String },
    dueDate: { type: Date },
    maxScore: { type: Number, default: 100 },
    allowGroupSubmission: { type: Boolean, default: false },
    resourceUrls: [{ url: String, name: String }], // files the instructor attaches when setting the assignment (instructions, templates, etc.)
  },
  { timestamps: true }
);

const updateSchema = new Schema(
  {
    authorId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    body: { type: String, required: true },
  },
  { timestamps: true }
);

const courseGroupSchema = new Schema(
  {
    name: { type: String, required: true },
    memberIds: [{ type: Schema.Types.ObjectId, ref: 'User' }],
  },
  { timestamps: true }
);

const quizQuestionSchema = new Schema(
  {
    text: { type: String, required: true },
    options: [{ type: String, required: true }],
    correctIndex: { type: Number, required: true }, // index into options
    points: { type: Number, default: 1 },
  },
  { _id: false }
);

const quizSchema = new Schema(
  {
    title: { type: String, required: true },
    description: { type: String },
    dueDate: { type: Date },
    timeLimitMinutes: { type: Number }, // informational only — not enforced server-side yet
    questions: [quizQuestionSchema],
  },
  { timestamps: true }
);

const courseSchema = new Schema(
  {
    organizationId: { type: Schema.Types.ObjectId, ref: 'Organization', required: true, index: true },
    title: { type: String, required: true, trim: true },
    description: { type: String },
    type: { type: String, enum: ['internal', 'external', 'vendor', 'academy'], default: 'internal' },
    category: {
      type: String,
      enum: ['Cybersecurity', 'Cloud', 'IT Infrastructure', 'Payments', 'Software Development', 'Data', 'AI', 'Project Management', 'IT Governance', 'Quality Assurance'],
    },
    provider: { type: String },
    durationHours: { type: Number, default: 1 },
    cost: { type: Number, default: 0 },
    currency: { type: String, default: 'NGN' },
    isRequired: { type: Boolean, default: false },
    requiredForRoles: [{ type: String }],
    requiredForSkillIds: [{ type: Schema.Types.ObjectId, ref: 'Skill' }],
    isPublicOnAcademy: { type: Boolean, default: false }, // sellable via Academy storefront
    instructor: { type: String },
    thumbnailUrl: { type: String },
    status: { type: String, enum: ['draft', 'published', 'archived'], default: 'published' },
    deliveryMode: { type: String, enum: ['virtual', 'physical', 'hybrid'], default: 'virtual' },
    maxStudents: { type: Number }, // capacity; omit for unlimited
    createdById: { type: Schema.Types.ObjectId, ref: 'User' },

    // Course content / LMS layer
    modules: [moduleSchema],
    assignments: [assignmentSchema],
    updates: [updateSchema],
    courseGroups: [courseGroupSchema],
    quizzes: [quizSchema],
  },
  { timestamps: true }
);

courseSchema.plugin(softDeletePlugin);
export const Course = model('Course', courseSchema);

