import crypto from 'crypto';
import { QUESTION_LIBRARY, PHISH_TEMPLATES } from '../config/awarenessLibrary';
import { EXTERNAL_ROLES } from '../config/roles';
import { env } from '../config/env';
import { AwarenessProfile, PhishCampaign, PhishTarget, PointEvent, QuizAnswer, QuizQuestion, QuizServe } from '../models/Awareness';
import { Incident } from '../models/Governance';
import { nextNumber } from '../models/Access';
import { Task } from '../models/Task';
import { User } from '../models/User';
import { ApiError } from '../utils/ApiError';
import { sendMail } from './email.service';
import { notify } from './notify.service';
import { usersWithModule } from './access.service';
import { logger } from '../utils/logger';

const HOUR = 3600000, DAY = 86400000;
export const POINTS = { easy: 5, medium: 10, hard: 15 } as const;
export const PHISH_REPORT_POINTS = 25, PHISH_REPORT_AFTER_CLICK = 10, PHISH_PASS_POINTS = 10, SUSPICIOUS_REPORT_POINTS = 5;
export const DAILY_QUIZ_POINT_CAP = 60;
export const POPUPS_PER_DAY = Math.max(1, Number(process.env.AWARENESS_POPUPS_PER_DAY) || 2);
export const POPUP_MIN_GAP_HOURS = Number(process.env.AWARENESS_POPUP_GAP_HOURS) || 3;
const norm = (s: unknown) => String(s ?? '').toLowerCase().replace(/[^a-z0-9]+/g, '');
export const isInternal = (role: string) => !(EXTERNAL_ROLES as readonly string[]).includes(role);
/** Start of today in Lagos time (UTC+1, no daylight saving). */
const startOfDay = (d = new Date()) => new Date(Math.floor((+d + HOUR) / DAY) * DAY - HOUR);
const startOfMonth = (d = new Date()) => new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1));

export interface Who { id: string; organizationId: string; role: string; name?: string }

/* ---------------------------------------------------------------- library */
export async function ensureLibrary(orgId: string) {
  const have = new Set((await QuizQuestion.find({ organizationId: orgId, source: 'library' }).select('key').lean()).map((q: any) => q.key));
  const fresh = QUESTION_LIBRARY.filter((q) => !have.has(q.key));
  if (fresh.length) await QuizQuestion.insertMany(fresh.map((q) => ({ organizationId: orgId, key: q.key, text: q.text, options: q.options, correctIndex: q.correct, explanation: q.explanation, topic: q.topic, difficulty: q.difficulty, roles: q.roles, source: 'library', policyRef: q.policyRef })));
  return fresh.length;
}

async function profile(orgId: string, userId: string) {
  return AwarenessProfile.findOneAndUpdate({ organizationId: orgId, userId }, { $setOnInsert: { organizationId: orgId, userId } }, { upsert: true, new: true });
}

const shuffle = (n: number) => { const a = Array.from({ length: n }, (_, i) => i); for (let i = n - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; };

async function pickQuestions(who: Who, count: number, exclude: string[] = []): Promise<any[]> {
  await ensureLibrary(who.organizationId);
  const all: any[] = await QuizQuestion.find({ organizationId: who.organizationId, active: true, isDeleted: { $ne: true } }).lean();
  const mine = all.filter((q) => (!q.roles?.length || q.roles.includes(who.role)) && !exclude.includes(String(q._id)));
  if (!mine.length) return [];
  const history: any[] = await QuizAnswer.find({ organizationId: who.organizationId, userId: who.id }).select('questionId correct topic answeredAt').lean();
  const okRecently = new Set(history.filter((h) => h.correct && +new Date(h.answeredAt) > Date.now() - 90 * DAY).map((h) => String(h.questionId)));
  const everSeen = new Set(history.map((h) => String(h.questionId)));
  const topicStat: Record<string, { n: number; ok: number }> = {};
  for (const h of history) { const t = (topicStat[h.topic] ||= { n: 0, ok: 0 }); t.n++; if (h.correct) t.ok++; }
  let pool = mine.filter((q) => !okRecently.has(String(q._id)));
  if (!pool.length) pool = mine; // everything answered correctly lately: start a new round
  const weight = (q: any) => { const t = topicStat[q.topic]; const w = !everSeen.has(String(q._id)) ? 3 : 1; return w * (t && t.n >= 2 && t.ok / t.n < 0.7 ? 2 : 1); };
  const out: any[] = [];
  const bag = pool.slice();
  while (out.length < count && bag.length) {
    const total = bag.reduce((s, q) => s + weight(q), 0); let r = Math.random() * total; let idx = 0;
    for (; idx < bag.length; idx++) { r -= weight(bag[idx]); if (r <= 0) break; }
    out.push(bag.splice(Math.min(idx, bag.length - 1), 1)[0]);
  }
  return out;
}

const present = (serve: any, q: any, extra: object = {}) => ({ serveId: String(serve._id), text: q.text, options: serve.order.map((i: number) => q.options[i]), topic: q.topic, difficulty: q.difficulty, points: POINTS[q.difficulty as keyof typeof POINTS] || 10, ...extra });

/* ---------------------------------------------------------------- pop-up */
export async function nextPopup(who: Who) {
  if (!isInternal(who.role)) return { question: null, reason: 'external' };
  const p: any = await profile(who.organizationId, who.id);
  const now = Date.now();
  if (p.snoozeUntil && +p.snoozeUntil > now) return { question: null, reason: 'snoozed', until: p.snoozeUntil };
  const open: any = await QuizServe.findOne({ userId: who.id, context: 'popup', answeredAt: { $exists: false }, dismissedAt: { $exists: false }, servedAt: { $gte: new Date(now - DAY) } }).sort({ servedAt: -1 });
  if (open) { const q: any = await QuizQuestion.findById(open.questionId).lean(); if (q && q.active) return { question: present(open, q), reason: 'open' }; }
  const today: any[] = await QuizServe.find({ userId: who.id, context: 'popup', servedAt: { $gte: startOfDay() } }).select('servedAt').lean();
  if (today.length >= POPUPS_PER_DAY) return { question: null, reason: 'limit' };
  const last = today.map((t) => +new Date(t.servedAt)).sort().pop() || (p.lastPopupAt ? +p.lastPopupAt : 0);
  if (last && now - last < POPUP_MIN_GAP_HOURS * HOUR) return { question: null, reason: 'gap' };
  const [q] = await pickQuestions(who, 1);
  if (!q) return { question: null, reason: 'none' };
  const serve: any = await QuizServe.create({ organizationId: who.organizationId, userId: who.id, questionId: q._id, order: shuffle(q.options.length), context: 'popup' });
  await AwarenessProfile.updateOne({ organizationId: who.organizationId, userId: who.id }, { lastPopupAt: new Date() });
  return { question: present(serve, q, { remainingToday: Math.max(0, POPUPS_PER_DAY - today.length - 1) }), reason: 'served' };
}

export async function dismissPopup(who: Who, serveId: string, snoozeHours: number) {
  const s: any = await QuizServe.findOne({ _id: serveId, userId: who.id });
  if (!s) throw ApiError.notFound('Question not found');
  if (!s.answeredAt) { s.dismissedAt = new Date(); await s.save(); }
  const h = Math.min(Math.max(Number(snoozeHours) || 4, 1), 24);
  await AwarenessProfile.updateOne({ organizationId: who.organizationId, userId: who.id }, { snoozeUntil: new Date(Date.now() + h * HOUR) }, { upsert: true });
  return { snoozeHours: h };
}

export async function startQuiz(who: Who, n = 5) {
  if (!isInternal(who.role)) throw ApiError.forbidden('Awareness quizzes are for staff');
  // finish any quiz that is still open instead of piling up new ones
  const openServes: any[] = await QuizServe.find({ userId: who.id, context: 'quiz', answeredAt: { $exists: false }, dismissedAt: { $exists: false }, servedAt: { $gte: new Date(Date.now() - 2 * HOUR) } }).sort({ servedAt: 1 });
  const out: any[] = [];
  for (const s of openServes) { const q: any = await QuizQuestion.findById(s.questionId).lean(); if (q?.active) out.push(present(s, q)); }
  if (out.length) return { questions: out, resumed: true };
  const picks = await pickQuestions(who, Math.min(Math.max(n, 1), 10));
  for (const q of picks) { const s: any = await QuizServe.create({ organizationId: who.organizationId, userId: who.id, questionId: q._id, order: shuffle(q.options.length), context: 'quiz' }); out.push(present(s, q)); }
  return { questions: out, resumed: false };
}

async function award(orgId: string, userId: string, kind: any, points: number, note?: string, refId?: string) {
  if (!points) return;
  await PointEvent.create({ organizationId: orgId, userId, kind, points, note, refId });
}

export async function answer(who: Who, serveId: string, choice: number) {
  const serve: any = await QuizServe.findOne({ _id: serveId, userId: who.id });
  if (!serve) throw ApiError.notFound('Question not found');
  if (serve.answeredAt) throw ApiError.conflict('You already answered this question');
  const q: any = await QuizQuestion.findById(serve.questionId).lean();
  if (!q) throw ApiError.notFound('Question no longer exists');
  const ch = Number(choice);
  if (!Number.isInteger(ch) || ch < 0 || ch >= serve.order.length) throw ApiError.badRequest('Pick one of the answers');
  const correct = serve.order[ch] === q.correctIndex;
  const correctPos = serve.order.indexOf(q.correctIndex);
  const now = new Date();
  serve.answeredAt = now; await serve.save();
  await QuizAnswer.create({ organizationId: who.organizationId, userId: who.id, questionId: q._id, topic: q.topic, correct, context: serve.context, ms: +now - +new Date(serve.servedAt), answeredAt: now });
  let points = 0, bonus = 0, streak = 0, capped = false;
  if (correct) {
    const recent: any[] = await QuizAnswer.find({ organizationId: who.organizationId, userId: who.id }).sort({ answeredAt: -1 }).limit(12).select('correct').lean();
    for (const r of recent) { if (r.correct) streak++; else break; }
    points = POINTS[q.difficulty as keyof typeof POINTS] || 10;
    bonus = streak >= 3 ? Math.min((streak - 2) * 2, 10) : 0;
    const earnedToday = (await PointEvent.find({ organizationId: who.organizationId, userId: who.id, kind: 'quiz', at: { $gte: startOfDay() } }).select('points').lean()).reduce((s: number, e: any) => s + e.points, 0);
    const room = Math.max(0, DAILY_QUIZ_POINT_CAP - earnedToday);
    if (points + bonus > room) { capped = true; points = Math.min(points, room); bonus = Math.max(0, Math.min(bonus, room - points)); }
    await award(who.organizationId, who.id, 'quiz', points + bonus, `${q.topic}${bonus ? ` (+${bonus} streak)` : ''}`, String(q._id));
  }
  return { correct, correctIndex: correctPos, explanation: q.explanation, policyRef: q.policyRef, points: points + bonus, streak, capped };
}

/* ---------------------------------------------------------------- leaderboard */
export async function leaderboard(orgId: string, meId: string, period: 'month' | 'all' = 'month') {
  const users: any[] = await User.find({ organizationId: orgId, isActive: true, role: { $nin: EXTERNAL_ROLES as any } }).select('name department role').lean();
  const prof: any[] = await AwarenessProfile.find({ organizationId: orgId }).select('userId hideFromLeaderboard').lean();
  const hidden = new Set(prof.filter((p) => p.hideFromLeaderboard).map((p) => String(p.userId)));
  const from = period === 'month' ? startOfMonth() : new Date(0);
  const prevFrom = period === 'month' ? new Date(Date.UTC(startOfMonth().getUTCFullYear(), startOfMonth().getUTCMonth() - 1, 1)) : new Date(0);
  const events: any[] = await PointEvent.find({ organizationId: orgId, at: { $gte: prevFrom } }).select('userId points at kind').lean();
  const answers: any[] = await QuizAnswer.find({ organizationId: orgId, answeredAt: { $gte: from } }).select('userId correct').lean();
  const pts = new Map<string, number>(), prev = new Map<string, number>(), ans = new Map<string, { n: number; ok: number }>();
  for (const e of events) { const k = String(e.userId); if (+new Date(e.at) >= +from) pts.set(k, (pts.get(k) || 0) + e.points); else prev.set(k, (prev.get(k) || 0) + e.points); }
  for (const a of answers) { const k = String(a.userId); const x = ans.get(k) || { n: 0, ok: 0 }; x.n++; if (a.correct) x.ok++; ans.set(k, x); }
  const rows = users.map((u) => { const k = String(u._id); const a = ans.get(k) || { n: 0, ok: 0 }; return { userId: k, name: u.name, department: u.department || '—', role: u.role, points: pts.get(k) || 0, prevPoints: prev.get(k) || 0, answered: a.n, accuracy: a.n ? Math.round((a.ok / a.n) * 100) : null, hidden: hidden.has(k) }; });
  const visible = rows.filter((r) => !r.hidden && r.points > 0).sort((a, b) => b.points - a.points || (b.accuracy ?? 0) - (a.accuracy ?? 0));
  const ranked = visible.map((r, i) => ({ ...r, rank: i + 1 }));
  const all = rows.slice().sort((a, b) => b.points - a.points);
  const myRow = rows.find((r) => r.userId === meId);
  const myRank = myRow && !myRow.hidden && myRow.points > 0 ? ranked.find((r) => r.userId === meId)!.rank : null;
  const group = (key: 'department' | 'role') => {
    const m = new Map<string, { members: number; active: number; points: number }>();
    for (const r of rows) { const g = m.get(r[key]) || { members: 0, active: 0, points: 0 }; g.members++; if (r.points > 0) g.active++; g.points += r.points; m.set(r[key], g); }
    return Array.from(m.entries()).map(([name, g]) => ({ name, members: g.members, participation: Math.round((g.active / g.members) * 100), avgPoints: Math.round((g.points / g.members) * 10) / 10 })).sort((a, b) => b.avgPoints - a.avgPoints);
  };
  const improved = rows.filter((r) => !r.hidden && r.points > r.prevPoints && period === 'month').map((r) => ({ userId: r.userId, name: r.name, department: r.department, gain: r.points - r.prevPoints, points: r.points })).sort((a, b) => b.gain - a.gain).slice(0, 5);
  return {
    period, people: ranked.slice(0, 10).map(({ prevPoints, hidden: _h, ...r }) => r), improved,
    departments: group('department'), roles: group('role'),
    me: myRow ? { points: myRow.points, rank: myRank, of: ranked.length, answered: myRow.answered, accuracy: myRow.accuracy, hidden: myRow.hidden, total: (events.filter((e) => String(e.userId) === meId).reduce((s, e) => s + e.points, 0)) } : null,
    participants: all.filter((r) => r.points > 0).length, staff: rows.length,
  };
}

export async function myStats(who: Who) {
  const answers: any[] = await QuizAnswer.find({ organizationId: who.organizationId, userId: who.id }).select('correct topic answeredAt').lean();
  const by: Record<string, { n: number; ok: number }> = {};
  for (const a of answers) { const t = (by[a.topic] ||= { n: 0, ok: 0 }); t.n++; if (a.correct) t.ok++; }
  const p: any = await profile(who.organizationId, who.id);
  const targets: any[] = await PhishTarget.find({ organizationId: who.organizationId, userId: who.id }).select('outcome clickedAt reportedAt').lean();
  return {
    answered: answers.length, correct: answers.filter((a) => a.correct).length,
    topics: Object.entries(by).map(([topic, v]) => ({ topic, answered: v.n, accuracy: Math.round((v.ok / v.n) * 100) })).sort((a, b) => a.accuracy - b.accuracy),
    hideFromLeaderboard: !!p.hideFromLeaderboard, snoozeUntil: p.snoozeUntil,
    phish: { received: targets.length, reported: targets.filter((t) => t.reportedAt).length, clicked: targets.filter((t) => t.clickedAt).length },
  };
}

export async function setLeaderboardVisibility(who: Who, hide: boolean) {
  await AwarenessProfile.updateOne({ organizationId: who.organizationId, userId: who.id }, { hideFromLeaderboard: !!hide }, { upsert: true });
}

/* ---------------------------------------------------------------- manager statistics + metric helpers */
export async function topicAccuracy(orgId: string, days = 90) {
  const rows: any[] = await QuizAnswer.find({ organizationId: orgId, answeredAt: { $gte: new Date(Date.now() - days * DAY) } }).select('topic correct userId').lean();
  const by: Record<string, { n: number; ok: number }> = {};
  for (const a of rows) { const t = (by[a.topic] ||= { n: 0, ok: 0 }); t.n++; if (a.correct) t.ok++; }
  return Object.entries(by).map(([topic, v]) => ({ topic, answered: v.n, accuracy: Math.round((v.ok / v.n) * 100) })).sort((a, b) => a.accuracy - b.accuracy);
}
export async function quizAccuracy(orgId: string): Promise<number | null> {
  const rows: any[] = await QuizAnswer.find({ organizationId: orgId, answeredAt: { $gte: new Date(Date.now() - 90 * DAY) } }).select('correct').lean();
  return rows.length >= 5 ? Math.round((rows.filter((r) => r.correct).length / rows.length) * 100) / 100 : null;
}
export async function participation(orgId: string): Promise<number | null> {
  const staff = await User.countDocuments({ organizationId: orgId, isActive: true, role: { $nin: EXTERNAL_ROLES as any } });
  if (!staff) return null;
  const rows: any[] = await QuizAnswer.find({ organizationId: orgId, answeredAt: { $gte: new Date(Date.now() - 30 * DAY) } }).select('userId').lean();
  return Math.round((new Set(rows.map((r) => String(r.userId))).size / staff) * 100) / 100;
}
export async function phishResilience(orgId: string): Promise<number | null> {
  const c: any = await PhishCampaign.findOne({ organizationId: orgId, status: 'ended', isDeleted: { $ne: true } }).sort({ endedAt: -1 }).lean();
  if (!c) return null;
  const t: any[] = await PhishTarget.find({ campaignId: c._id }).select('clickedAt').lean();
  return t.length ? Math.round((1 - t.filter((x) => x.clickedAt).length / t.length) * 100) / 100 : null;
}
export async function phishReportRate(orgId: string): Promise<number | null> {
  const c: any = await PhishCampaign.findOne({ organizationId: orgId, status: 'ended', isDeleted: { $ne: true } }).sort({ endedAt: -1 }).lean();
  if (!c) return null;
  const t: any[] = await PhishTarget.find({ campaignId: c._id }).select('outcome reportedAt').lean();
  return t.length ? Math.round((t.filter((x) => x.reportedAt).length / t.length) * 100) / 100 : null;
}

/* ---------------------------------------------------------------- phishing simulation */
export const templateByKey = (k: string) => PHISH_TEMPLATES.find((t) => t.key === k);
const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c] as string));

export async function audienceUsers(orgId: string, a: { roles?: string[]; departments?: string[]; userIds?: string[] }) {
  const f: any = { organizationId: orgId, isActive: true, role: { $nin: EXTERNAL_ROLES as any }, employmentStatus: { $ne: 'offboarded' } };
  const users: any[] = await User.find(f).select('name email role department').lean();
  const any = (a.roles?.length || 0) + (a.departments?.length || 0) + (a.userIds?.length || 0) > 0;
  return users.filter((u) => !any || a.userIds?.includes(String(u._id)) || (a.roles?.length && a.roles.includes(u.role)) || (a.departments?.length && a.departments.includes(u.department)));
}

export async function launchCampaign(campaignId: string, orgId: string, byName: string) {
  const c: any = await PhishCampaign.findOne({ _id: campaignId, organizationId: orgId, isDeleted: { $ne: true } });
  if (!c) throw ApiError.notFound('Campaign not found');
  if (c.status !== 'draft') throw ApiError.conflict('This campaign was already launched');
  const tpl = templateByKey(c.templateKey); if (!tpl) throw ApiError.badRequest('Unknown template');
  const users = await audienceUsers(orgId, c.audience || {});
  if (!users.length) throw ApiError.badRequest('No one matches this audience');
  let undelivered = 0;
  for (const u of users) {
    const token = crypto.randomBytes(16).toString('hex');
    const link = `${env.appUrl}/phish/${token}`;
    const html = tpl.html.replace(/\{\{name\}\}/g, esc((u.name || '').split(' ')[0] || 'colleague')).replace(/\{\{link\}\}/g, link);
    let delivered = false;
    try { delivered = (await sendMail({ to: u.email, subject: tpl.subject, html })).delivered; } catch (err) { logger.warn({ err }, 'phish simulation mail failed'); }
    if (!delivered) undelivered++;
    await PhishTarget.create({ organizationId: orgId, campaignId: c._id, userId: u._id, department: u.department, role: u.role, token, subject: tpl.subject, sentAt: new Date(), delivered });
  }
  Object.assign(c, { status: 'running', launchedAt: new Date(), launchedByName: byName, targetCount: users.length, undelivered });
  await c.save();
  return c;
}

export async function recordClick(token: string) {
  if (!/^[a-f0-9]{32}$/.test(token)) return null;
  const t: any = await PhishTarget.findOne({ token });
  if (!t) return null;
  const c: any = await PhishCampaign.findById(t.campaignId).lean();
  const tpl = c && templateByKey(c.templateKey);
  if (!c || !tpl) return null;
  let first = false;
  if (c.status === 'running' && t.outcome === 'pending') {
    t.outcome = 'clicked'; t.clickedAt = new Date(); await t.save(); first = true;
    await Task.create({ organizationId: t.organizationId, title: 'Phishing refresher: review the warning signs and take the short quiz (Security Awareness)', ownerId: t.userId, priority: 'medium', status: 'open', dueDate: new Date(Date.now() + 7 * DAY), tags: ['auto-generated', 'awareness', 'phish-refresher'] }).catch(() => undefined);
    await notify({ organizationId: String(t.organizationId), userIds: [String(t.userId)], title: 'That was a phishing simulation', body: 'You clicked a simulated phishing email. No harm done – a short refresher is in My Work.', link: '/awareness', type: 'reminder', severity: 'info' }).catch(() => undefined);
  }
  const u: any = await User.findById(t.userId).select('name').lean();
  return { firstName: (u?.name || '').split(' ')[0], template: { name: tpl.name, subject: tpl.subject, redFlags: tpl.redFlags, lesson: tpl.lesson }, counted: first, simulationEnded: c.status !== 'running' };
}

export async function reportPhish(who: Who, input: { subject?: string; sender?: string; details?: string }) {
  const subject = String(input.subject || '').trim();
  if (subject.length < 3) throw ApiError.badRequest('Enter the subject line of the email');
  const open: any[] = await PhishTarget.find({ userId: who.id, reportedAt: { $exists: false } }).sort({ sentAt: -1 }).limit(10);
  for (const t of open) {
    const c: any = await PhishCampaign.findById(t.campaignId).lean();
    if (!c || c.status !== 'running') continue;
    const a = norm(subject), b = norm(t.subject);
    if (a.length >= 6 && (a.includes(b) || b.includes(a))) {
      const clickedFirst = t.outcome === 'clicked';
      t.reportedAt = new Date(); t.outcome = 'reported'; await t.save();
      const pts = clickedFirst ? PHISH_REPORT_AFTER_CLICK : PHISH_REPORT_POINTS;
      await award(who.organizationId, who.id, 'phish_report', pts, clickedFirst ? 'reported after clicking' : 'reported a simulated phish', String(t._id));
      return { simulation: true, points: pts, message: clickedFirst ? 'This was a simulation. Reporting it, even after clicking, is exactly right.' : 'Well spotted – this was a phishing simulation. Thank you for reporting it.' };
    }
  }
  const inc: any = await Incident.create({ organizationId: who.organizationId, reference: await nextNumber(who.organizationId, 'INC', { yearly: true, pad: 4 }), title: `Suspicious email reported: ${subject}`.slice(0, 200), description: `Reported by ${who.name || 'a user'} through Security Awareness.\nSender: ${input.sender || 'not given'}\n${input.details || ''}`.slice(0, 5000), category: 'phishing', severity: 'low', reportedById: who.id, timeline: [{ at: new Date(), byId: who.id, byName: who.name, text: 'Reported through Security Awareness' }] });
  await award(who.organizationId, who.id, 'suspicious_report', SUSPICIOUS_REPORT_POINTS, 'reported a suspicious email', String(inc._id));
  const mgrs = (await usersWithModule(who.organizationId, 'incidents')).map((u: any) => String(u._id));
  await notify({ organizationId: who.organizationId, userIds: mgrs, title: `Suspicious email reported (${inc.reference})`, body: subject, link: '/incidents', type: 'reminder', severity: 'warning', dedupeKey: `susp:${inc._id}` }).catch(() => undefined);
  return { simulation: false, points: SUSPICIOUS_REPORT_POINTS, incident: inc.reference, message: `Thank you. It was logged as ${inc.reference} and security has been told. Do not click anything in it.` };
}

export async function endCampaign(c: any) {
  if (c.status === 'ended') return c;
  const pending: any[] = await PhishTarget.find({ campaignId: c._id, outcome: 'pending' });
  for (const t of pending) { t.outcome = 'ignored'; await t.save(); await award(String(c.organizationId), String(t.userId), 'phish_pass', PHISH_PASS_POINTS, 'did not click a simulated phish', String(t._id)); }
  c.status = 'ended'; c.endedAt = new Date(); await c.save();
  return c;
}

export async function campaignResults(orgId: string, id: string) {
  const c: any = await PhishCampaign.findOne({ _id: id, organizationId: orgId, isDeleted: { $ne: true } }).lean();
  if (!c) throw ApiError.notFound('Campaign not found');
  const targets: any[] = await PhishTarget.find({ campaignId: id }).sort({ sentAt: 1 }).lean();
  const users = new Map((await User.find({ _id: { $in: targets.map((t) => t.userId) } }).select('name').lean()).map((u: any) => [String(u._id), u.name]));
  const tot = targets.length;
  const clicked = targets.filter((t) => t.clickedAt).length, reported = targets.filter((t) => t.reportedAt).length;
  const dep = new Map<string, { n: number; clicked: number; reported: number }>();
  for (const t of targets) { const d = dep.get(t.department || '—') || { n: 0, clicked: 0, reported: 0 }; d.n++; if (t.clickedAt) d.clicked++; if (t.reportedAt) d.reported++; dep.set(t.department || '—', d); }
  const history: any[] = await PhishTarget.find({ organizationId: orgId, userId: { $in: targets.map((t) => t.userId) }, clickedAt: { $exists: true } }).select('userId').lean();
  const times = new Map<string, number>(); for (const h of history) times.set(String(h.userId), (times.get(String(h.userId)) || 0) + 1);
  const tpl = templateByKey(c.templateKey);
  return {
    campaign: c, template: tpl && { name: tpl.name, subject: tpl.subject, difficulty: tpl.difficulty, redFlags: tpl.redFlags },
    totals: { targets: tot, clicked, reported, clickRate: tot ? Math.round((clicked / tot) * 100) : 0, reportRate: tot ? Math.round((reported / tot) * 100) : 0, undelivered: c.undelivered || 0 },
    departments: Array.from(dep.entries()).map(([name, d]) => ({ name, targets: d.n, clicked: d.clicked, reported: d.reported, clickRate: Math.round((d.clicked / d.n) * 100) })).sort((a, b) => b.clickRate - a.clickRate),
    people: targets.map((t) => ({ name: users.get(String(t.userId)) || '—', department: t.department, outcome: t.outcome, sentAt: t.sentAt, clickedAt: t.clickedAt, reportedAt: t.reportedAt, delivered: t.delivered, repeatClicker: (times.get(String(t.userId)) || 0) >= 2 })),
  };
}
