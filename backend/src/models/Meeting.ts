import { Schema, model } from 'mongoose';
import { softDeletePlugin } from '../utils/softDeletePlugin';

export const MEETING_PROVIDERS = ['teams', 'zoom', 'zoho', 'google_meet', 'other', 'in_person'] as const;

const meetingSchema = new Schema(
  {
    organizationId: { type: Schema.Types.ObjectId, ref: 'Organization', required: true, index: true },
    title: { type: String, required: true, trim: true },
    participants: [{ type: Schema.Types.ObjectId, ref: 'User' }],
    externalParticipants: [{ name: String, email: String }],
    clientId: { type: Schema.Types.ObjectId, ref: 'Client' },
    projectId: { type: Schema.Types.ObjectId, ref: 'Project' },
    // What the meeting is about — a meeting can hang off a task, subtask or milestone.
    taskId: { type: Schema.Types.ObjectId, ref: 'Task', index: true },
    milestoneId: { type: Schema.Types.ObjectId, index: true },
    date: { type: Date, required: true, index: true },
    durationMins: { type: Number, default: 60, min: 5, max: 1440 },
    agenda: { type: String },
    notes: { type: String },
    description: { type: String },
    provider: { type: String, enum: MEETING_PROVIDERS, default: 'other' },
    providerDetails: {
      meetingId: String,
      passcode: String,
      url: String,
      dialIn: String,
      host: String,
    },
    meetingLink: { type: String }, // kept for older records; mirrors providerDetails.url
    location: { type: String }, // physical location, for in-person meetings
    attachments: [{ name: String, url: String }],
    organizerId: { type: Schema.Types.ObjectId, ref: 'User' },
    // Record of how attendees were selected, for display ("Everyone in Payments
    // was invited") — the actual resolved attendee list still lives in
    // `participants` above, this is just a transparency trail.
    invitedViaRoles: [{ type: String }],
    invitedViaDepartments: [{ type: String }],
    invitedViaGroupIds: [{ type: Schema.Types.ObjectId, ref: 'Group' }],
    decisions: [{ type: String }],
    actionItems: [
      {
        description: { type: String, required: true },
        assigneeId: { type: Schema.Types.ObjectId, ref: 'User' },
        dueDate: { type: Date },
        convertedTaskId: { type: Schema.Types.ObjectId, ref: 'Task' },
      },
    ],
    /** "Don't forget to record" + "upload the recording" reminder chain. */
    recording: {
      reminderEnabled: { type: Boolean, default: false },
      recorderId: { type: Schema.Types.ObjectId, ref: 'User' }, // who gets the reminders (defaults to the organiser)
      reminderCancelledAt: { type: Date },
      reminderCancelledById: { type: Schema.Types.ObjectId, ref: 'User' },
      preReminderSentAt: { type: Date },
      lastReminderAt: { type: Date },
      reminderCount: { type: Number, default: 0 }, // total sent, ever (keeps de-duplication keys unique)
      resumeBase: { type: Number, default: 0 }, // count when reminders were last (re)started — the 30-reminder cap counts from here
      uploaded: { type: Boolean, default: false },
      uploads: [{ name: String, url: String, uploadedById: { type: Schema.Types.ObjectId, ref: 'User' }, uploadedAt: { type: Date, default: Date.now } }],
    },
    status: { type: String, enum: ['scheduled', 'completed', 'cancelled'], default: 'scheduled' },
  },
  { timestamps: true }
);

meetingSchema.index({ organizationId: 1, 'recording.reminderEnabled': 1, 'recording.uploaded': 1, date: 1 });

meetingSchema.plugin(softDeletePlugin);
export const Meeting = model('Meeting', meetingSchema);
