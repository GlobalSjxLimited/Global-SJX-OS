import { AccessReview } from '../models/Governance';
import { Organization } from '../models/Organization';
import { logger } from '../utils/logger';
import { usersWithModule } from './access.service';
import { notifyWork } from './work.notify';

const DAY = 86400000;
/** POL-5016 §2.6: privileged access rights are reviewed at least every 3 months, user access at least every 6 months. */
export const PRIVILEGED_REVIEW_DAYS = 90;
export const USER_REVIEW_DAYS = 182;

/** Pure: what is due, given when the last review was started. Reminders start two weeks before the deadline. */
export function reviewsDue(lastReviewAt: Date | null, now = new Date()): { privileged: 'ok' | 'soon' | 'overdue'; user: 'ok' | 'soon' | 'overdue'; ageDays: number | null } {
  if (!lastReviewAt) return { privileged: 'overdue', user: 'overdue', ageDays: null };
  const age = Math.floor((now.getTime() - lastReviewAt.getTime()) / DAY);
  const state = (limit: number) => (age > limit ? 'overdue' : age > limit - 14 ? 'soon' : 'ok') as 'ok' | 'soon' | 'overdue';
  return { privileged: state(PRIVILEGED_REVIEW_DAYS), user: state(USER_REVIEW_DAYS), ageDays: age };
}

export async function runAccessReviewJobs(now = new Date()) {
  const orgs = await Organization.find({ isActive: true }).select('_id');
  let sent = 0;
  for (const o of orgs) {
    const org = String(o._id);
    try {
      const last: any = await AccessReview.findOne({ organizationId: org }).sort({ createdAt: -1 }).select('createdAt');
      const d = reviewsDue(last ? new Date(last.createdAt) : null, now);
      if (d.privileged === 'ok' && d.user === 'ok') continue;
      const people = await usersWithModule(org, 'access_control');
      const month = now.toISOString().slice(0, 7);
      const overdue = d.privileged === 'overdue' || d.user === 'overdue';
      const what = d.user !== 'ok' ? 'User access review (every 6 months) and privileged access review (every 3 months)' : 'Privileged access review (every 3 months)';
      await notifyWork({
        organizationId: org, userIds: people.map((u: any) => String(u._id)), type: 'access', severity: overdue ? 'high' : 'warning', dedupeKey: `access-review:${org}:${month}`,
        title: overdue ? 'Access review overdue' : 'Access review due soon',
        summary: `${what} ${overdue ? 'is overdue' : 'is coming due'}${d.ageDays != null ? ` — the last review was started ${d.ageDays} days ago` : ' — none has been recorded yet'}. Start one in Access Control (policy POL-5016 §2.6).`,
        link: '/access', cta: 'Open Access Control', email: overdue,
      });
      sent++;
    } catch (err) { logger.error({ err, org }, 'access review cadence job failed'); }
  }
  return { sent };
}
