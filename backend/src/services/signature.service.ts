import crypto from 'crypto';
import PDFDocument from 'pdfkit';
import { SignatureRequest } from '../models/Signature';
import { Organization } from '../models/Organization';
import { nextNumber } from '../models/Access';
import { usersWithModule } from './access.service';
import { notify } from './notify.service';
import { sendMail } from './email.service';
import { env } from '../config/env';
import { ApiError } from '../utils/ApiError';
import { logger } from '../utils/logger';

const DAY = 86400000;
const esc = (s: string) => String(s || '').replace(/[<>&"]/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;' } as any)[c]);
const sha = (t: string) => crypto.createHash('sha256').update(t).digest('hex');
const tl = (byName: string, text: string) => ({ at: new Date(), byName, text });
const lagos = (d?: Date) => d ? new Date(d.getTime() + 3600000).toISOString().replace('T', ' ').slice(0, 16) + ' (Lagos)' : '';
export const linkFor = (t: string) => `${env.appUrl.replace(/\/$/, '')}/sign/${t}`;
const salt = () => process.env.IP_HASH_SALT || process.env.JWT_SECRET || 'gsjx';
const ipHash = (ip?: string) => ip ? crypto.createHmac('sha256', salt()).update(ip).digest('hex').slice(0, 24) : undefined;

function mail(r: any, s: any, token: string, orgName: string, reminder = false) {
  return sendMail({ to: s.email, subject: `${reminder ? 'Reminder: ' : ''}Please review and sign: ${r.title}`, html: `<p>Hello ${esc(s.name)},</p><p>${esc(orgName)} has asked you to review and sign <b>${esc(r.title)}</b> (${r.reference}).</p><p><a href="${linkFor(token)}">Review and sign</a></p><p>The link is private to you and valid until ${r.expiresAt.toISOString().slice(0, 10)}. Please do not forward it.</p>` }).catch((err) => logger.warn({ err }, 'signature mail not sent'));
}
const managers = async (orgId: string) => (await usersWithModule(orgId, 'signatures')).map((u: any) => String(u._id));

export async function create(orgId: string, b: { title: string; body: string; category?: string; vendorId?: string; signers: { name: string; email: string }[]; days?: number }, actor: { id: string; name: string }) {
  const emails = new Set<string>(); for (const s of b.signers) { if (emails.has(s.email.toLowerCase())) throw ApiError.badRequest(`${s.email} is listed twice`); emails.add(s.email.toLowerCase()); }
  const tokens = b.signers.map(() => crypto.randomBytes(24).toString('base64url'));
  const r: any = await SignatureRequest.create({
    organizationId: orgId, reference: await nextNumber(orgId, 'SIG', { yearly: true, pad: 4 }), title: b.title, body: b.body, bodyHash: sha(b.body), category: b.category || 'other', vendorId: b.vendorId,
    signers: b.signers.map((s, i) => ({ name: s.name, email: s.email, tokenHash: sha(tokens[i]) })), expiresAt: new Date(Date.now() + Math.min(Math.max(b.days || 14, 2), 60) * DAY), createdById: actor.id, createdByName: actor.name,
    timeline: [tl(actor.name, `Sent to ${b.signers.map((s) => s.email).join(', ')} (document fingerprint ${sha(b.body).slice(0, 12)}…)`)],
  });
  const o: any = await Organization.findById(orgId).select('name');
  await Promise.all(r.signers.map((s: any, i: number) => mail(r, s, tokens[i], o?.name || 'Global SJX Limited')));
  return { request: r, links: r.signers.map((s: any, i: number) => ({ email: s.email, link: linkFor(tokens[i]) })) };
}

async function find(token: string) {
  const r: any = await SignatureRequest.findOne({ 'signers.tokenHash': sha(String(token)) });
  if (!r) throw ApiError.notFound('This link is not valid.');
  if (r.status === 'out_for_signature' && r.expiresAt < new Date()) { r.status = 'expired'; r.timeline.push(tl('System', 'Expired before everyone signed')); await r.save(); }
  return { r, s: r.signers.find((x: any) => x.tokenHash === sha(String(token))) };
}
export async function publicView(token: string) {
  const { r, s } = await find(token);
  if (['expired', 'cancelled'].includes(r.status)) throw ApiError.conflict('This request is no longer active.');
  const o: any = await Organization.findById(r.organizationId).select('name');
  if (!s.openedAt) { s.openedAt = new Date(); r.timeline.push(tl(s.name, 'Opened the document')); await r.save(); }
  return { company: o?.name, title: r.title, reference: r.reference, body: r.body, fingerprint: r.bodyHash, signerName: s.name, status: s.status, requestStatus: r.status, signedAt: s.signedAt, expiresAt: r.expiresAt, others: r.signers.map((x: any) => ({ name: x.name, status: x.status })) };
}
export async function sign(token: string, typedName: string, agree: boolean, meta: { ip?: string; ua?: string }) {
  const { r, s } = await find(token);
  if (r.status !== 'out_for_signature') throw ApiError.conflict(r.status === 'completed' ? 'This document is already fully signed.' : 'This request is no longer active.');
  if (s.status !== 'pending') throw ApiError.conflict(s.status === 'signed' ? 'You have already signed.' : 'You declined this document.');
  if (!agree) throw ApiError.badRequest('Please tick the box to confirm you agree to sign electronically.');
  const norm = (x: string) => x.toLowerCase().replace(/[^a-z]/g, '');
  if (norm(typedName) !== norm(s.name)) throw ApiError.badRequest(`Type your full name exactly as shown (${s.name}) to sign.`);
  s.status = 'signed'; s.signedAt = new Date(); s.typedName = typedName.trim(); s.ipHash = ipHash(meta.ip); s.userAgent = String(meta.ua || '').slice(0, 200);
  r.timeline.push(tl(s.name, 'Signed'));
  const done = r.signers.every((x: any) => x.status === 'signed');
  if (done) { r.status = 'completed'; r.completedAt = new Date(); r.timeline.push(tl('System', 'All signers have signed; certificate available')); }
  await r.save();
  await notify({ organizationId: String(r.organizationId), userIds: [...await managers(String(r.organizationId)), String(r.createdById)], title: done ? `${r.title} is fully signed` : `${s.name} signed ${r.title}`, body: done ? 'The completion certificate is ready to download.' : `${r.signers.filter((x: any) => x.status === 'signed').length} of ${r.signers.length} signed.`, link: '/signatures', type: 'reminder', severity: 'info', category: 'system', entity: { type: 'SignatureRequest', id: String(r._id) }, dedupeKey: `sig-${done ? 'done' : 'one'}:${r._id}:${s._id}` });
  return { completed: done, reference: r.reference };
}
export async function decline(token: string, reason: string) {
  const { r, s } = await find(token);
  if (r.status !== 'out_for_signature' || s.status !== 'pending') throw ApiError.conflict('This request can no longer be changed.');
  if (reason.trim().length < 3) throw ApiError.badRequest('Please give a short reason.');
  s.status = 'declined'; s.declineReason = reason.trim().slice(0, 500); r.status = 'declined'; r.timeline.push(tl(s.name, `Declined: ${s.declineReason}`)); await r.save();
  await notify({ organizationId: String(r.organizationId), userIds: [...await managers(String(r.organizationId)), String(r.createdById)], title: `${s.name} declined to sign ${r.title}`, body: s.declineReason, link: '/signatures', type: 'reminder', severity: 'high', category: 'system', entity: { type: 'SignatureRequest', id: String(r._id) }, dedupeKey: `sig-dec:${r._id}` });
}
export async function remind(orgId: string, id: string, actor: { name: string }) {
  const r: any = await SignatureRequest.findOne({ _id: id, organizationId: orgId }); if (!r) throw ApiError.notFound('Not found');
  if (r.status !== 'out_for_signature') throw ApiError.conflict('Only requests still out for signature can be reminded.');
  const o: any = await Organization.findById(orgId).select('name'); let n = 0;
  for (const s of r.signers) if (s.status === 'pending') { const t = crypto.randomBytes(24).toString('base64url'); s.tokenHash = sha(t); s.reminders += 1; s.lastRemindedAt = new Date(); await mail(r, s, t, o?.name || 'Global SJX Limited', true); n++; }
  r.timeline.push(tl(actor.name, `Reminder with fresh links sent to ${n} signer(s)`)); await r.save(); return n;
}
export async function cancel(orgId: string, id: string, actor: { name: string }) {
  const r: any = await SignatureRequest.findOne({ _id: id, organizationId: orgId }); if (!r) throw ApiError.notFound('Not found');
  if (r.status !== 'out_for_signature') throw ApiError.conflict(`Already ${r.status.replace(/_/g, ' ')}.`);
  r.status = 'cancelled'; r.timeline.push(tl(actor.name, 'Cancelled; links no longer work')); await r.save(); return r;
}
export function view(r: any, full = true) {
  const o = r.toObject ? r.toObject() : { ...r };
  o.signers = (o.signers || []).map((s: any) => ({ _id: s._id, name: s.name, email: s.email, status: s.status, openedAt: s.openedAt, signedAt: s.signedAt, declineReason: s.declineReason, reminders: s.reminders }));
  if (!full) delete o.body; return o;
}
export async function certificate(r: any): Promise<Buffer> {
  const o: any = await Organization.findById(r.organizationId).select('name');
  const doc = new PDFDocument({ size: 'A4', margin: 50 }); const chunks: Buffer[] = []; doc.on('data', (c) => chunks.push(c));
  const done = new Promise<Buffer>((res) => doc.on('end', () => res(Buffer.concat(chunks))));
  doc.fontSize(20).fillColor('#C22FD4').text('Certificate of electronic signature', { align: 'left' }).moveDown(0.3);
  doc.fontSize(11).fillColor('#000').text(`${o?.name || ''}  ·  ${r.reference}`).moveDown();
  doc.fontSize(14).text(r.title).moveDown(0.5);
  doc.fontSize(9).fillColor('#444').text(`Status: ${r.status.replace(/_/g, ' ')}${r.completedAt ? `  ·  completed ${lagos(r.completedAt)}` : ''}`).text(`Created by ${r.createdByName} on ${lagos(r.createdAt)}`).moveDown(0.5);
  doc.fillColor('#000').fontSize(9).text('Document fingerprint (SHA-256 of the exact text that was signed):').font('Courier').text(r.bodyHash).font('Helvetica').moveDown();
  doc.fontSize(12).text('Signatures').moveDown(0.3);
  for (const s of r.signers) {
    doc.fontSize(10).text(`${s.name}  <${s.email}>`).fontSize(9).fillColor('#444')
      .text(s.status === 'signed' ? `Signed ${lagos(s.signedAt)} by typing "${s.typedName}" and confirming consent to sign electronically. Network address fingerprint: ${s.ipHash || 'n/a'}` : `Status: ${s.status}${s.declineReason ? ` (${s.declineReason})` : ''}`).fillColor('#000').moveDown(0.5);
  }
  doc.moveDown().fontSize(12).text('Activity log').moveDown(0.3).fontSize(9);
  for (const t of r.timeline) doc.text(`${lagos(t.at)}  ${t.byName}: ${t.text}`);
  doc.moveDown().fontSize(8).fillColor('#666').text('This is a simple electronic signature: typed name plus recorded consent, time and network fingerprint. Anyone can check the document by hashing the text and comparing it with the fingerprint above. It is not a qualified or certified digital signature; ask your legal adviser whether it is enough for a particular contract.');
  doc.addPage().fontSize(14).fillColor('#000').text(r.title).moveDown().fontSize(10).text(r.body);
  doc.end(); return done;
}
