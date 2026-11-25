import crypto from 'crypto';
import { SupplierAssessment } from '../models/Supplier';
import { OutsourcedReview } from '../models/Security';
import { Vendor } from '../models/Vendor';
import { Organization } from '../models/Organization';
import { nextNumber } from '../models/Access';
import { usersWithModule } from './access.service';
import { notify } from './notify.service';
import { sendMail } from './email.service';
import { env } from '../config/env';
import { ApiError } from '../utils/ApiError';
import { logger } from '../utils/logger';
import { QUESTIONS, QMAP, SQ_ANSWERS, score, needsNote } from '../config/supplierQuestionnaire';

const DAY = 86400000;
const esc = (s: string) => String(s || '').replace(/[<>&"]/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;' } as any)[c]);
const hash = (t: string) => crypto.createHash('sha256').update(t).digest('hex');
const tl = (byName: string, text: string) => ({ at: new Date(), byName, text });
export const linkFor = (token: string) => `${env.appUrl.replace(/\/$/, '')}/supplier/${token}`;
const managers = async (orgId: string) => (await usersWithModule(orgId, 'isms', 'vendors', 'supplier_assessments')).map((u: any) => String(u._id));

function mail(a: any, token: string, orgName: string, reminder = false) {
  const days = Math.max(1, Math.ceil((new Date(a.expiresAt).getTime() - Date.now()) / DAY));
  return sendMail({
    to: a.contactEmail, subject: `${reminder ? 'Reminder: ' : ''}Security questionnaire from ${orgName}`,
    html: `<p>Hello ${esc(a.contactName || 'there')},</p><p>${esc(orgName)} asks all its suppliers to complete a short security questionnaire (about 15 minutes). ${a.message ? `<br><i>${esc(a.message)}</i><br>` : ''}</p><p><a href="${linkFor(token)}">Open the questionnaire</a></p><p>You can save and come back. The link works for ${days} more day(s) and is private to you; please do not forward it. No account is needed.</p>`,
  }).catch((err) => logger.warn({ err }, 'supplier mail not sent'));
}

export async function create(orgId: string, b: { vendorId?: string; supplier?: string; contactName?: string; contactEmail: string; message?: string; days?: number }, actor: { id: string; name: string }) {
  let supplier = String(b.supplier || '').trim(); let vendor: any = null;
  if (b.vendorId) { vendor = await Vendor.findOne({ _id: b.vendorId, organizationId: orgId, isDeleted: { $ne: true } }); if (!vendor) throw ApiError.badRequest('Supplier not found'); supplier = supplier || vendor.name; }
  if (supplier.length < 2) throw ApiError.badRequest('Supplier name is required');
  const open = await SupplierAssessment.findOne({ organizationId: orgId, supplier, status: { $in: ['sent', 'in_progress', 'submitted'] } });
  if (open) throw ApiError.conflict(`${supplier} already has an open questionnaire (${open.reference}). Revoke it first or wait for the answer.`);
  const token = crypto.randomBytes(24).toString('base64url');
  const a: any = await SupplierAssessment.create({
    organizationId: orgId, reference: await nextNumber(orgId, 'SQ', { yearly: true, pad: 4 }), vendorId: vendor?._id, supplier, contactName: b.contactName, contactEmail: b.contactEmail, tokenHash: hash(token),
    expiresAt: new Date(Date.now() + Math.min(Math.max(b.days || 21, 3), 60) * DAY), message: b.message, sentById: actor.id, sentByName: actor.name, timeline: [tl(actor.name, `Questionnaire sent to ${b.contactEmail}`)],
  });
  const o: any = await Organization.findById(orgId).select('name'); await mail(a, token, o?.name || 'Global SJX Limited');
  return { assessment: a, link: linkFor(token) };
}

async function byToken(token: string) {
  const a: any = await SupplierAssessment.findOne({ tokenHash: hash(String(token)) });
  if (!a) throw ApiError.notFound('This link is not valid.');
  if (['sent', 'in_progress'].includes(a.status) && a.expiresAt < new Date()) { a.status = 'expired'; a.timeline.push(tl('System', 'Link expired')); await a.save(); }
  return a;
}
export async function publicView(token: string) {
  const a = await byToken(token);
  if (['revoked', 'expired'].includes(a.status)) throw ApiError.conflict('This link is no longer active. Please ask for a new one.');
  const o: any = await Organization.findById(a.organizationId).select('name');
  if (!a.openedAt) { a.openedAt = new Date(); a.timeline.push(tl(a.supplier, 'Opened the questionnaire')); await a.save(); }
  const locked = ['submitted', 'reviewed'].includes(a.status);
  return { company: o?.name, supplier: a.supplier, contactName: a.contactName, message: a.message, reference: a.reference, status: a.status, expiresAt: a.expiresAt, locked, answers: a.answers, completedBy: a.completedBy, questions: QUESTIONS };
}
function clean(raw: any[]) {
  const seen = new Set<string>(); const out: any[] = [];
  for (const r of Array.isArray(raw) ? raw : []) {
    if (!QMAP.has(r?.qid) || seen.has(r.qid)) continue; if (!(SQ_ANSWERS as readonly string[]).includes(r.answer)) continue;
    seen.add(r.qid); out.push({ qid: r.qid, answer: r.answer, note: String(r.note || '').slice(0, 1000) || undefined });
  }
  return out;
}
export async function save(token: string, answers: any[], completedBy?: any) {
  const a = await byToken(token);
  if (a.status !== 'sent' && a.status !== 'in_progress') throw ApiError.conflict(a.status === 'submitted' || a.status === 'reviewed' ? 'This questionnaire has already been submitted.' : 'This link is no longer active.');
  a.answers = clean(answers); a.status = 'in_progress'; a.lastSavedAt = new Date();
  if (completedBy) a.completedBy = { name: String(completedBy.name || '').slice(0, 120), role: String(completedBy.role || '').slice(0, 120) };
  await a.save(); return { saved: a.answers.length, total: QUESTIONS.length };
}
export async function submit(token: string, answers: any[], completedBy: any) {
  const a = await byToken(token);
  if (a.status !== 'sent' && a.status !== 'in_progress') throw ApiError.conflict(a.status === 'submitted' || a.status === 'reviewed' ? 'This questionnaire has already been submitted.' : 'This link is no longer active.');
  const cleaned = clean(answers);
  const missing = QUESTIONS.filter((q) => !cleaned.find((x) => x.qid === q.id)); if (missing.length) throw ApiError.badRequest(`Please answer every question (${missing.length} left).`);
  const needNote = cleaned.filter((x) => needsNote(x.qid, x.answer) && !x.note); if (needNote.length) throw ApiError.badRequest(`Add a short note to each answer that is not a clear yes (and to a "yes" about a past breach) (${needNote.length} need one).`);
  if (String(completedBy?.name || '').trim().length < 2) throw ApiError.badRequest('Tell us who completed this.');
  const s = score(cleaned);
  Object.assign(a, { answers: cleaned, completedBy: { name: String(completedBy.name).trim().slice(0, 120), role: String(completedBy.role || '').slice(0, 120) }, score: s.pct, tier: s.tier, critFails: s.critFails, status: 'submitted', submittedAt: new Date() });
  a.timeline.push(tl(a.supplier, `Submitted: score ${s.pct}%, suggested risk ${s.tier}${s.critFails.length ? `, ${s.critFails.length} critical gap(s)` : ''}`)); await a.save();
  await notify({ organizationId: String(a.organizationId), userIds: await managers(String(a.organizationId)), title: `${a.supplier} answered the security questionnaire (${s.pct}%, ${s.tier} risk)`, body: s.critFails.length ? `${s.critFails.length} critical gap(s): ${s.critFails.map((c) => QMAP.get(c)!.domain).join(', ')}. Please review.` : 'Please review the answers.', link: '/supplier-assessments', type: 'reminder', severity: s.tier === 'high' ? 'high' : 'info', category: 'system', entity: { type: 'SupplierAssessment', id: String(a._id) }, dedupeKey: `sq-sub:${a._id}`, email: { intro: `${a.supplier} has submitted their security questionnaire (${a.reference}).`, ctaLabel: 'Review' } });
  return { reference: a.reference };
}

export async function review(orgId: string, id: string, b: { decision: 'accepted' | 'accepted_with_conditions' | 'rejected'; note?: string; riskRating?: 'low' | 'medium' | 'high'; nextReviewMonths?: number }, actor: { name: string }) {
  const a: any = await SupplierAssessment.findOne({ _id: id, organizationId: orgId }); if (!a) throw ApiError.notFound('Not found');
  if (a.status !== 'submitted') throw ApiError.conflict(a.status === 'reviewed' ? 'Already reviewed.' : 'There is nothing to review yet.');
  if (b.decision !== 'accepted' && String(b.note || '').trim().length < 5) throw ApiError.badRequest('Record the conditions or the reason.');
  const rating = b.riskRating || a.tier;
  a.status = 'reviewed'; a.decision = b.decision; a.reviewNote = b.note; a.reviewedAt = new Date(); a.reviewedByName = actor.name;
  a.timeline.push(tl(actor.name, `Reviewed: ${b.decision.replace(/_/g, ' ')}, risk ${rating}`));
  // keep the supplier register (A.5.19-5.22) current
  const months = Math.min(Math.max(b.nextReviewMonths || (rating === 'high' ? 6 : rating === 'medium' ? 12 : 12), 1), 24);
  let rv: any = a.reviewId ? await OutsourcedReview.findById(a.reviewId) : await OutsourcedReview.findOne({ organizationId: orgId, ...(a.vendorId ? { vendorId: a.vendorId } : { supplier: a.supplier }) });
  const findings = `Questionnaire ${a.reference}: ${a.score}%${a.critFails?.length ? `, critical gaps: ${a.critFails.join(', ')}` : ''}. Decision: ${b.decision.replace(/_/g, ' ')}${b.note ? `. ${b.note}` : ''}`;
  if (!rv) rv = new OutsourcedReview({ organizationId: orgId, supplier: a.supplier, vendorId: a.vendorId, scope: 'Added from supplier security questionnaire', status: 'onboarding' });
  rv.lastReviewAt = new Date(); rv.nextReviewAt = new Date(Date.now() + months * 30 * DAY); rv.riskRating = rating; rv.findings = findings;
  if (b.decision === 'rejected') rv.status = 'under_review'; else if (rv.status === 'onboarding') rv.status = 'active';
  await rv.save(); a.reviewId = rv._id; await a.save(); return a;
}
export async function revoke(orgId: string, id: string, actor: { name: string }) {
  const a: any = await SupplierAssessment.findOne({ _id: id, organizationId: orgId }); if (!a) throw ApiError.notFound('Not found');
  if (!['sent', 'in_progress', 'submitted'].includes(a.status)) throw ApiError.conflict(`Already ${a.status}.`);
  a.status = 'revoked'; a.timeline.push(tl(actor.name, 'Link revoked')); await a.save(); return a;
}
/** New link, same record: the old link stops working. */
export async function resend(orgId: string, id: string, actor: { name: string }, extendDays = 21) {
  const a: any = await SupplierAssessment.findOne({ _id: id, organizationId: orgId }); if (!a) throw ApiError.notFound('Not found');
  if (!['sent', 'in_progress', 'expired'].includes(a.status)) throw ApiError.conflict('Only an unanswered questionnaire can be re-sent.');
  const token = crypto.randomBytes(24).toString('base64url'); a.tokenHash = hash(token); a.expiresAt = new Date(Date.now() + extendDays * DAY); if (a.status === 'expired') a.status = a.answers.length ? 'in_progress' : 'sent';
  a.reminders += 1; a.lastRemindedAt = new Date(); a.timeline.push(tl(actor.name, 'New link sent')); await a.save();
  const o: any = await Organization.findById(orgId).select('name'); await mail(a, token, o?.name || 'Global SJX Limited', true); return { assessment: a, link: linkFor(token) };
}
export function view(a: any, withAnswers: boolean) {
  const o = a.toObject ? a.toObject() : { ...a }; delete o.tokenHash;
  if (!withAnswers) delete o.answers;
  else o.answers = (o.answers || []).map((x: any) => ({ ...x, question: QMAP.get(x.qid)?.text, domain: QMAP.get(x.qid)?.domain, critical: !!QMAP.get(x.qid)?.critical }));
  return o;
}
