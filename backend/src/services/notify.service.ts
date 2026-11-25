import { Notification } from '../models/Notification';
import { NotificationPref, MANDATORY } from '../models/NotificationPref';
import { ReminderLog } from '../models/Access';
import { User } from '../models/User';
import { sendMail } from './email.service';
import { renderEmail } from './mail.templates';
import { logger } from '../utils/logger';

export interface NotifyInput {
  organizationId: string;
  userIds: string[];
  title: string;
  body?: string;
  link?: string;
  type?: string;
  /** preference bucket; derived from `type` when not given */
  category?: string;
  /** the record this is about, so a person can mute that one thread */
  entity?: { type: string; id: string };
  severity?: 'info' | 'warning' | 'high' | 'critical';
  /** when set, the same notification is never sent twice for this key (reminders) */
  dedupeKey?: string;
  email?: { intro?: string; bodyHtml?: string; ctaLabel?: string };
}

const CATEGORY_OF_TYPE: Record<string, string> = {
  task: 'tasks', project: 'projects', mention: 'mentions', comment: 'comments', expense: 'finance', finance: 'finance', contract: 'sales', sales: 'sales',
  marketing: 'marketing', approval: 'tasks', reminder: 'reminders', goal: 'projects', risk: 'projects', meeting: 'projects',
};
export const categoryFor = (type?: string, explicit?: string) => explicit || CATEGORY_OF_TYPE[type || ''] || (type && MANDATORY.includes(type) ? type : 'system');

export interface Delivery { inApp: boolean; email: boolean }
/**
 * Pure: does this person want this notification? Mandatory categories and high / critical severity always arrive in-app;
 * a muted thread is silent unless it is urgent.
 */
export function decideDelivery(pref: { categories?: Record<string, { inApp?: boolean; email?: boolean }>; mutes?: Array<{ entityType?: string; entityId?: any }> } | null, o: { category: string; severity?: string; entity?: { type: string; id: string }; wantsEmail: boolean }): Delivery {
  const urgent = o.severity === 'high' || o.severity === 'critical';
  if (MANDATORY.includes(o.category)) return { inApp: true, email: o.wantsEmail };
  const muted = !!o.entity && (pref?.mutes || []).some((m) => m.entityType === o.entity!.type && String(m.entityId) === o.entity!.id);
  if (muted && !urgent) return { inApp: false, email: false };
  const c = pref?.categories?.[o.category];
  const inApp = urgent ? true : c?.inApp !== false;
  const email = o.wantsEmail && (c?.email === undefined ? true : !!c.email);
  return { inApp, email: email && !(muted && !urgent) };
}

/** In-app notification + (optionally) e-mail for each recipient, honouring what each person asked to receive. */
export async function notify(input: NotifyInput): Promise<number> {
  const ids = Array.from(new Set(input.userIds.filter(Boolean).map(String)));
  if (!ids.length) return 0;
  if (input.dedupeKey) {
    try {
      await ReminderLog.create({ organizationId: input.organizationId, key: input.dedupeKey });
    } catch {
      return 0; // already sent
    }
  }
  const category = categoryFor(input.type, input.category);
  const prefs: any[] = await NotificationPref.find({ userId: { $in: ids } }).lean();
  const byUser = new Map(prefs.map((p) => [String(p.userId), p]));
  const plan = ids.map((userId) => ({ userId, d: decideDelivery(byUser.get(userId) || null, { category, severity: input.severity, entity: input.entity, wantsEmail: !!input.email }) }));
  const inApp = plan.filter((p) => p.d.inApp);
  if (inApp.length) {
    await Notification.insertMany(inApp.map(({ userId }) => ({ organizationId: input.organizationId, userId, title: input.title, body: input.body, link: input.link, type: input.type || 'system', severity: input.severity || 'info' })));
  }
  const mailIds = plan.filter((p) => p.d.email).map((p) => p.userId);
  if (input.email && mailIds.length) {
    const users = await User.find({ _id: { $in: mailIds }, isActive: true }).select('email name');
    const mail = renderEmail({
      title: input.title,
      intro: input.email.intro || input.body,
      body: input.email.bodyHtml || '',
      cta: input.link ? { label: input.email.ctaLabel || 'Open in GLOBAL SJX OS', path: input.link } : undefined,
    });
    await Promise.all(
      users.map((u) => sendMail({ to: u.email, subject: input.title, html: mail.html, attachments: mail.attachments }).catch((err) => logger.warn({ err, to: u.email }, 'notification e-mail failed')))
    );
  }
  return inApp.length;
}
