import { Schema, model } from 'mongoose';
import { softDeletePlugin } from '../utils/softDeletePlugin';
import { stampPlugin } from '../utils/stampPlugin';

const ref = (to: string, extra: object = {}) => ({ type: Schema.Types.ObjectId, ref: to, ...extra });
const org = { type: Schema.Types.ObjectId, ref: 'Organization', required: true, index: true };

export const QUIZ_TOPICS = ['phishing', 'passwords', 'data_handling', 'physical', 'incident_reporting', 'remote_work', 'ai_use', 'privacy', 'access', 'suppliers', 'finance_fraud', 'secure_development', 'social_engineering'] as const;
export const DIFFICULTIES = ['easy', 'medium', 'hard'] as const;

/** A multiple-choice awareness question. `roles` empty = every internal role. */
const questionSchema = new Schema(
  {
    organizationId: org,
    key: { type: String, index: true }, // stable id for library questions so seeding is idempotent
    text: { type: String, required: true, trim: true },
    options: { type: [String], validate: (v: string[]) => v.length >= 2 && v.length <= 5 },
    correctIndex: { type: Number, required: true, min: 0 },
    explanation: { type: String, required: true },
    topic: { type: String, enum: QUIZ_TOPICS, default: 'data_handling', index: true },
    difficulty: { type: String, enum: DIFFICULTIES, default: 'medium' },
    roles: [{ type: String }],
    active: { type: Boolean, default: true, index: true },
    source: { type: String, enum: ['library', 'custom'], default: 'custom' },
    policyRef: String,
  },
  { timestamps: true }
);
questionSchema.plugin(softDeletePlugin);
questionSchema.plugin(stampPlugin);
export const QuizQuestion = model('QuizQuestion', questionSchema);

/** Every question shown to a person. The server keeps the shuffled order so the answer can never be read from the page. */
const serveSchema = new Schema(
  {
    organizationId: org,
    userId: ref('User', { required: true, index: true }),
    questionId: ref('QuizQuestion', { required: true }),
    order: [Number], // order[i] = index in the stored options shown at position i
    context: { type: String, enum: ['popup', 'quiz'], default: 'popup' },
    servedAt: { type: Date, default: Date.now, index: true },
    answeredAt: Date,
    dismissedAt: Date,
  },
  { timestamps: false }
);
serveSchema.index({ userId: 1, answeredAt: 1, servedAt: -1 });
export const QuizServe = model('QuizServe', serveSchema);

const answerSchema = new Schema(
  {
    organizationId: org,
    userId: ref('User', { required: true, index: true }),
    questionId: ref('QuizQuestion', { required: true, index: true }),
    topic: String,
    correct: { type: Boolean, required: true },
    context: String,
    ms: Number,
    answeredAt: { type: Date, default: Date.now, index: true },
  },
  { timestamps: false }
);
export const QuizAnswer = model('QuizAnswer', answerSchema);

/** The points ledger – the leaderboard is just a sum over this. */
export const POINT_KINDS = ['quiz', 'phish_report', 'phish_pass', 'suspicious_report', 'streak'] as const;
const pointSchema = new Schema(
  {
    organizationId: org,
    userId: ref('User', { required: true, index: true }),
    kind: { type: String, enum: POINT_KINDS, required: true },
    points: { type: Number, required: true },
    note: String,
    refId: String,
    at: { type: Date, default: Date.now, index: true },
  },
  { timestamps: false }
);
pointSchema.index({ organizationId: 1, at: -1 });
export const PointEvent = model('PointEvent', pointSchema);

/** Per-person settings. Pop-ups cannot be switched off (awareness is part of the ISMS), only snoozed; the leaderboard can be left. */
const profileSchema = new Schema(
  { organizationId: org, userId: ref('User', { required: true }), hideFromLeaderboard: { type: Boolean, default: false }, snoozeUntil: Date, lastPopupAt: Date },
  { timestamps: true }
);
profileSchema.index({ organizationId: 1, userId: 1 }, { unique: true });
export const AwarenessProfile = model('AwarenessProfile', profileSchema);

/* ------------------------------------------------------------------ phishing simulation */
export const PHISH_STATUSES = ['draft', 'running', 'ended'] as const;
const campaignSchema = new Schema(
  {
    organizationId: org,
    name: { type: String, required: true, trim: true },
    templateKey: { type: String, required: true },
    status: { type: String, enum: PHISH_STATUSES, default: 'draft', index: true },
    audience: { roles: [String], departments: [String], userIds: [ref('User')] },
    authorisedBy: { type: String, required: true }, // who in management approved the exercise (ISO A.6.3 / A.5.4)
    authorisedNote: String,
    launchedAt: Date,
    endedAt: Date,
    launchedByName: String,
    targetCount: { type: Number, default: 0 },
    undelivered: { type: Number, default: 0 },
  },
  { timestamps: true }
);
campaignSchema.plugin(softDeletePlugin);
campaignSchema.plugin(stampPlugin);
export const PhishCampaign = model('PhishCampaign', campaignSchema);

const targetSchema = new Schema(
  {
    organizationId: org,
    campaignId: ref('PhishCampaign', { required: true, index: true }),
    userId: ref('User', { required: true, index: true }),
    department: String,
    role: String,
    token: { type: String, required: true, unique: true },
    subject: String,
    sentAt: Date,
    delivered: { type: Boolean, default: false },
    clickedAt: Date,
    reportedAt: Date,
    outcome: { type: String, enum: ['pending', 'clicked', 'reported', 'ignored'], default: 'pending', index: true },
  },
  { timestamps: true }
);
export const PhishTarget = model('PhishTarget', targetSchema);
