import { Meeting } from '../models/Meeting';
import { Task } from '../models/Task';
import { Project } from '../models/Project';
import { User } from '../models/User';
import { env } from '../config/env';
import { sendMail } from './email.service';
import { callout, esc, fmtDate, kvTable, renderEmail } from './mail.templates';
import { notify } from './notify.service';
import { notifyWork } from './work.notify';
import { excludeDeleted } from '../utils/softDeletePlugin';
import { logger } from '../utils/logger';

export const PROVIDER_LABEL: Record<string, string> = {
  teams: 'Microsoft Teams', zoom: 'Zoom', zoho: 'Zoho Meeting', google_meet: 'Google Meet', other: 'Online meeting', in_person: 'In person',
};
const VIRTUAL = new Set(['teams', 'zoom', 'zoho', 'google_meet', 'other']);
export const isVirtual = (p?: string) => !!p && VIRTUAL.has(p);

export const MAX_RECORDING_REMINDERS = 30;
const DAY = 86400000;

const fmtWhen = (d: Date | string) => new Date(d).toLocaleString('en-GB', { dateStyle: 'full', timeStyle: 'short', timeZone: 'Africa/Lagos' }) + ' (Lagos time)';

/** The "how to join" block shown in every e-mail and in the app. */
export function joinRows(m: any): Array<[string, unknown]> {
  const pd = m.providerDetails || {};
  const url = pd.url || m.meetingLink;
  return [
    ['Platform', PROVIDER_LABEL[m.provider] || 'Online meeting'],
    ['Meeting ID', pd.meetingId],
    ['Passcode', pd.passcode],
    ['Host', pd.host],
    ['Dial-in', pd.dialIn],
    ['Join link', url ? `<!--html--><a href="${esc(url)}">${esc(url)}</a>` : undefined],
    ['Location', m.location],
  ];
}

/* ------------------------------ iCalendar ------------------------------ */
const icsEsc = (s: unknown) => String(s ?? '').replace(/\\/g, '\\\\').replace(/;/g, '\;').replace(/,/g, '\\,').replace(/\r?\n/g, '\\n');
const icsDate = (d: Date) => d.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
function fold(line: string) {
  const out: string[] = [];
  let rest = line;
  while (rest.length > 74) { out.push(rest.slice(0, 74)); rest = ' ' + rest.slice(74); }
  out.push(rest);
  return out.join('\r\n');
}

export function buildIcs(m: any, organizer: { name?: string; email?: string }, method: 'REQUEST' | 'CANCEL' = 'REQUEST', seq = 0): string {
  const start = new Date(m.date);
  const end = new Date(start.getTime() + (m.durationMins || 60) * 60000);
  const pd = m.providerDetails || {};
  const url = pd.url || m.meetingLink;
  const desc = [m.description || m.agenda ? String(m.description || m.agenda).replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim() : '', pd.meetingId ? `Meeting ID: ${pd.meetingId}` : '', pd.passcode ? `Passcode: ${pd.passcode}` : '', url ? `Join: ${url}` : ''].filter(Boolean).join('\n');
  const lines = [
    'BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Global SJX//GLOBAL SJX OS//EN', 'CALSCALE:GREGORIAN', `METHOD:${method}`,
    'BEGIN:VEVENT', `UID:${m._id}@globalsjx-os`, `SEQUENCE:${seq}`, `DTSTAMP:${icsDate(new Date())}`, `DTSTART:${icsDate(start)}`, `DTEND:${icsDate(end)}`,
    `SUMMARY:${icsEsc(m.title)}`, desc ? `DESCRIPTION:${icsEsc(desc)}` : '', url ? `URL:${icsEsc(url)}` : '', (m.location || url) ? `LOCATION:${icsEsc(m.location || url)}` : '',
    organizer.email ? `ORGANIZER;CN=${icsEsc(organizer.name || 'Organizer')}:mailto:${organizer.email}` : '',
    `STATUS:${method === 'CANCEL' ? 'CANCELLED' : 'CONFIRMED'}`,
    ...(method === 'REQUEST' ? ['BEGIN:VALARM', 'TRIGGER:-PT10M', 'ACTION:DISPLAY', 'DESCRIPTION:Meeting starts soon', 'END:VALARM'] : []),
    'END:VEVENT', 'END:VCALENDAR',
  ].filter(Boolean);
  return lines.map(fold).join('\r\n') + '\r\n';
}

/* ------------------------------ invitations ------------------------------ */
async function contextRows(m: any): Promise<Array<[string, unknown]>> {
  const rows: Array<[string, unknown]> = [];
  if (m.taskId) { const t = await Task.findById(m.taskId).select('title'); if (t) rows.push(['About task', t.title]); }
  if (m.milestoneId && m.projectId) { const p = await Project.findById(m.projectId).select('name milestones'); const ms: any = p?.milestones.id(m.milestoneId); if (ms) rows.push(['About milestone', ms.title]); if (p) rows.push(['Project title', p.name]); }
  else if (m.projectId) { const p = await Project.findById(m.projectId).select('name'); if (p) rows.push(['Project title', p.name]); }
  return rows;
}

/** Every meeting e-mails and notifies everyone invited — internal people in-app + e-mail, outside people by e-mail. Always with a calendar invite attached. */
export async function sendMeetingMessages(meeting: any, opts: { kind: 'invite' | 'update' | 'cancel'; userIds?: string[]; emails?: Array<{ name?: string; email: string }>; organizerName?: string; note?: string }) {
  const organizer = await User.findById(meeting.organizerId).select('name email');
  const orgName = opts.organizerName || organizer?.name || 'A Global SJX team member';
  const ids = Array.from(new Set((opts.userIds ?? (meeting.participants || []).map(String)).map(String)));
  const users = ids.length ? await User.find({ _id: { $in: ids }, isActive: true }).select('name email') : [];
  const ctx = await contextRows(meeting);
  const method = opts.kind === 'cancel' ? 'CANCEL' : 'REQUEST';
  const ics = buildIcs(meeting, { name: organizer?.name, email: organizer?.email }, method, opts.kind === 'invite' ? 0 : Math.max(1, Math.floor(Date.now() / 60000) % 100000));
  const heading = { invite: `Meeting invitation: ${meeting.title}`, update: `Meeting updated: ${meeting.title}`, cancel: `Meeting cancelled: ${meeting.title}` }[opts.kind];
  const intro = { invite: `${orgName} invited you to a meeting.`, update: `${orgName} changed the details of this meeting.`, cancel: `${orgName} cancelled this meeting.` }[opts.kind];
  const agendaText = meeting.agenda || meeting.description ? String(meeting.agenda || meeting.description).replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 1200) : '';
  const rows: Array<[string, unknown]> = [['Meeting', meeting.title], ['When', fmtWhen(meeting.date)], ['Duration', `${meeting.durationMins || 60} minutes`], ...(opts.kind === 'cancel' ? [] : joinRows(meeting)), ...ctx, ['Organiser', orgName], ...(((meeting.attachments || []).length && opts.kind !== 'cancel') ? [['Attached files', `${(meeting.attachments || []).map((a: any) => a.name).join(', ')} — open the meeting in GLOBAL SJX OS to download`] as [string, unknown]] : [])];
  const body = `${kvTable(rows)}${agendaText ? callout(`<strong>Agenda:</strong> ${esc(agendaText)}`) : ''}${opts.note ? callout(esc(opts.note)) : ''}${meeting.recording?.reminderEnabled && opts.kind !== 'cancel' ? callout('This meeting will be recorded. The organiser has recording reminders switched on.', 'info') : ''}`;
  const attachments = [{ filename: 'invite.ics', content: ics, contentType: `text/calendar; charset=utf-8; method=${method}` }] as any[];

  let notified = 0;
  // Internal people: in-app notification (always) …
  if (users.length) {
    await notify({ organizationId: String(meeting.organizationId), userIds: users.map((u) => String(u._id)), title: heading, body: `${meeting.title} — ${fmtWhen(meeting.date)}`, link: '/meetings', type: 'meeting', severity: opts.kind === 'cancel' ? 'warning' : 'info' });
    notified += users.length;
  }
  // … and an e-mail (always) with the calendar file.
  const mail = renderEmail({ title: heading, intro: esc(intro), body, cta: opts.kind === 'cancel' ? undefined : { label: 'Open in GLOBAL SJX OS', path: '/meetings' } });
  const outsiders = (opts.emails ?? []).filter((e) => e.email);
  const send = (to: string) => sendMail({ to, subject: heading, html: mail.html, attachments: [...mail.attachments, ...attachments] }).catch((err) => logger.warn({ err, to }, 'meeting e-mail failed'));
  await Promise.all([...users.filter((u) => u.email).map((u) => send(u.email)), ...outsiders.map((e) => send(e.email))]);
  notified += outsiders.length;
  return notified;
}

/* ------------------------ recording reminder engine ------------------------ */
const recorderOf = (m: any) => String(m.recording?.recorderId || m.organizerId || '');
const lagosDayStartUtc = (d: Date) => { const l = new Date(d.getTime() + 3600000); return Date.UTC(l.getUTCFullYear(), l.getUTCMonth(), l.getUTCDate()) - 3600000; }; // Lagos is UTC+1, no DST
/** First moment the "please upload" reminders begin: 09:00 Lagos on the day after the meeting. */
export const uploadRemindersStart = (meetingDate: Date) => new Date(lagosDayStartUtc(meetingDate) + DAY + 9 * 3600000);

export const stopLink = (id: unknown) => `${env.appUrl}/meetings?meeting=${id}&stop=1`;

/**
 * 1) five minutes before the meeting: "don't forget to record".
 * 2) from the day after: "please upload the recording", once a day, until it is uploaded, the reminders are
 *    cancelled, or 30 reminders have gone out. Every e-mail carries a link to stop them.
 * Safe to run often (every couple of minutes): each step is guarded by timestamps and a dedupe key.
 */
export async function runRecordingReminders(now: Date = new Date()): Promise<{ pre: number; upload: number }> {
  const out = { pre: 0, upload: 0 };
  const meetings = await Meeting.find(excludeDeleted({
    'recording.reminderEnabled': true, 'recording.uploaded': { $ne: true }, 'recording.reminderCancelledAt': { $exists: false },
    status: { $ne: 'cancelled' }, date: { $gte: new Date(now.getTime() - 40 * DAY), $lte: new Date(now.getTime() + 10 * 60000) },
  }));
  for (const m of meetings as any[]) {
    const to = recorderOf(m);
    if (!to) continue;
    const start = new Date(m.date);
    const end = new Date(start.getTime() + (m.durationMins || 60) * 60000);
    const rec = m.recording || {};
    const stop = `<p style="margin:14px 0 4px;font-size:13px"><a href="${esc(stopLink(m._id))}">Stop these reminders</a> — you can cancel them any time.</p>`;

    if (!rec.preReminderSentAt && now >= new Date(start.getTime() - 5 * 60000) && now < end) {
      const sent = await notifyWork({
        organizationId: String(m.organizationId), userIds: [to], title: `Don't forget to record: ${m.title}`, summary: `"${m.title}" starts at ${fmtWhen(start)}. Do not forget to record the meeting.`,
        rows: [['Meeting', m.title], ['Platform', PROVIDER_LABEL[m.provider]]], extraHtml: stop, link: '/meetings', cta: 'Open meeting', type: 'meeting', severity: 'warning', dedupeKey: `mtgrec:${m._id}:pre`,
      });
      await Meeting.updateOne({ _id: m._id }, { $set: { 'recording.preReminderSentAt': now } });
      out.pre += sent ? 1 : 0;
    }

    const first = uploadRemindersStart(start);
    const count = rec.reminderCount || 0;
    if (now >= first && count - (rec.resumeBase || 0) < MAX_RECORDING_REMINDERS && (!rec.lastReminderAt || now.getTime() - new Date(rec.lastReminderAt).getTime() >= 20 * 3600000)) {
      const n = count + 1;
      const sent = await notifyWork({
        organizationId: String(m.organizationId), userIds: [to], title: `Upload the recording: ${m.title}`,
        summary: `The recording of "${m.title}" (${fmtDate(start)}) has not been uploaded yet.${n > 1 ? ` This is reminder ${n}.` : ''}`,
        rows: [['Meeting', m.title], ['Held on', fmtWhen(start)]], extraHtml: stop, link: `/meetings?meeting=${m._id}`, cta: 'Upload recording', type: 'meeting', severity: 'warning', dedupeKey: `mtgrec:${m._id}:u${n}`,
      });
      await Meeting.updateOne({ _id: m._id }, { $set: { 'recording.lastReminderAt': now }, $inc: { 'recording.reminderCount': 1 } });
      out.upload += sent ? 1 : 0;
    }
  }
  return out;
}
