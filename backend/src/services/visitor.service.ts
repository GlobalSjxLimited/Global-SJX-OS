import crypto from 'crypto';
import PDFDocument from 'pdfkit';
import QRCode from 'qrcode';
import { Visit, HostAvailability, SlotLock, WatchEntry, EvacuationEvent, ACTIVE_VISIT } from '../models/Visitor';
import { User } from '../models/User';
import { Organization } from '../models/Organization';
import { nextNumber } from '../models/Access';
import { usersWithModule } from './access.service';
import { notify } from './notify.service';
import { sendMail } from './email.service';
import { env } from '../config/env';
import { ApiError } from '../utils/ApiError';
import { logger } from '../utils/logger';

/** Offices are in Lagos: UTC+1 all year. */
const TZ = '+01:00';
const MIN = 60000, DAY = 86400000;
export const lagosDate = (d: Date) => new Date(d.getTime() + 3600000).toISOString().slice(0, 10);
export const lagosHour = (d: Date) => new Date(d.getTime() + 3600000).getUTCHours();
export const atLagos = (date: string, hhmm: string) => new Date(`${date}T${hhmm}:00${TZ}`);
const esc = (s: string) => String(s || '').replace(/[<>&"]/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;' } as any)[c]);
const digits = (s?: string) => String(s || '').replace(/\D/g, '');
const normName = (s?: string) => String(s || '').toLowerCase().replace(/[^a-z]/g, '');
const hhmm = (s: string) => /^([01]\d|2[0-3]):[0-5]\d$/.test(s);
const fmtTime = (d: Date) => `${String(lagosHour(d)).padStart(2, '0')}:${String(new Date(d.getTime() + 3600000).getUTCMinutes()).padStart(2, '0')}`;
const fmtDT = (d: Date) => `${lagosDate(d)} ${fmtTime(d)}`;
const SYS = { name: 'System (visitors)' };
const tl = (by: string, text: string) => ({ at: new Date(), byName: by, text });
export const visitUrl = (code: string) => `${env.appUrl}/visit/${code}`;

async function orgOf(): Promise<{ id: string; name: string }> {
  const o: any = await Organization.findOne({ isInternal: true }).select('_id name'); if (!o) throw ApiError.notFound('Not available');
  return { id: String(o._id), name: o.name };
}
const code = () => crypto.randomBytes(8).toString('base64url').replace(/[-_]/g, 'x').slice(0, 10).toUpperCase();

/* ------------------------------------------------------------------ watchlist */
export async function watchMatch(orgId: string, v: { name?: string; email?: string; phone?: string }) {
  const list: any[] = await WatchEntry.find({ organizationId: orgId, active: true });
  const now = new Date();
  for (const e of list) {
    if (e.expiresAt && e.expiresAt < now) continue;
    if (e.email && v.email && e.email.toLowerCase() === v.email.toLowerCase()) return { entry: e, level: e.level as 'flag' | 'block', matchedOn: 'email' };
    if (digits(e.phone).length >= 9 && digits(v.phone).slice(-9) === digits(e.phone).slice(-9)) return { entry: e, level: e.level as 'flag' | 'block', matchedOn: 'phone' };
  }
  for (const e of list) { // a name alone is never enough to block someone: it only raises a flag for a person to judge
    if (e.expiresAt && e.expiresAt < now) continue;
    if (normName(e.name).length >= 5 && normName(e.name) === normName(v.name)) return { entry: e, level: 'flag' as const, matchedOn: 'name (possible match)' };
  }
  return null;
}
async function recordHit(orgId: string, m: any, visit: any) {
  m.entry.hits += 1; m.entry.lastHitAt = new Date(); await m.entry.save();
  const sec = (await usersWithModule(orgId, 'visitors_admin')).map((u: any) => String(u._id));
  await notify({ organizationId: orgId, userIds: sec, title: `Watchlist ${m.level === 'block' ? 'BLOCK' : 'flag'}: ${visit.visitor.name}`, body: `${visit.reference} matched a watchlist entry on ${m.matchedOn}. Host: ${visit.hostName || '—'}. Reason is on the watchlist page.`, link: '/visitors?tab=watchlist', type: 'reminder', severity: m.level === 'block' ? 'critical' : 'high', category: 'system', dedupeKey: `watch-hit:${visit._id}` });
}

/* ------------------------------------------------------------------ availability */
export const DEFAULT_DAYS = [1, 2, 3, 4, 5].map((day) => ({ day, ranges: [{ start: '09:00', end: '17:00' }] }));
export async function getAvailability(orgId: string, userId: string) {
  const a: any = await HostAvailability.findOne({ organizationId: orgId, userId }).lean();
  return a || { userId, enabled: false, days: DEFAULT_DAYS, slotMinutes: 30, bufferMinutes: 0, maxPerDay: 8, minNoticeHours: 2, maxAdvanceDays: 30, blockedDates: [] };
}
export async function saveAvailability(orgId: string, userId: string, b: any) {
  const days: any[] = [];
  for (const d of Array.isArray(b.days) ? b.days : []) {
    if (!(d.day >= 0 && d.day <= 6)) continue;
    const ranges = (d.ranges || []).filter((r: any) => hhmm(r.start) && hhmm(r.end));
    for (const r of ranges) if (r.start >= r.end) throw ApiError.badRequest(`A working period must end after it starts (${r.start}–${r.end}).`);
    const sorted = [...ranges].sort((x: any, y: any) => x.start.localeCompare(y.start));
    for (let i = 1; i < sorted.length; i++) if (sorted[i].start < sorted[i - 1].end) throw ApiError.badRequest('Working periods on the same day overlap.');
    if (ranges.length) days.push({ day: d.day, ranges: sorted });
  }
  const num = (v: any, lo: number, hi: number, def: number) => { const n = Number(v); return Number.isFinite(n) ? Math.min(Math.max(Math.round(n), lo), hi) : def; };
  const blocked = (Array.isArray(b.blockedDates) ? b.blockedDates : []).filter((x: string) => /^\d{4}-\d{2}-\d{2}$/.test(x)).slice(0, 200);
  const set = { enabled: !!b.enabled, days, slotMinutes: num(b.slotMinutes, 15, 120, 30), bufferMinutes: num(b.bufferMinutes, 0, 60, 0), maxPerDay: num(b.maxPerDay, 1, 30, 8), minNoticeHours: num(b.minNoticeHours, 0, 168, 2), maxAdvanceDays: num(b.maxAdvanceDays, 1, 90, 30), blockedDates: blocked };
  if (set.enabled && !days.length) throw ApiError.badRequest('Add at least one working period before turning on online booking.');
  return HostAvailability.findOneAndUpdate({ organizationId: orgId, userId }, { $set: set }, { new: true, upsert: true }).lean();
}

/** Free slots for one host on one Lagos date. Pure of side effects. */
export async function slotsFor(orgId: string, hostId: string, date: string, now = new Date()): Promise<{ start: Date; end: Date }[]> {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw ApiError.badRequest('Invalid date');
  const a: any = await HostAvailability.findOne({ organizationId: orgId, userId: hostId }).lean();
  if (!a?.enabled) return [];
  const host: any = await User.findOne({ _id: hostId, organizationId: orgId, isActive: true }).select('_id').lean(); if (!host) return [];
  if ((a.blockedDates || []).includes(date)) return [];
  if (date > lagosDate(new Date(now.getTime() + a.maxAdvanceDays * DAY))) return [];
  const dow = new Date(`${date}T12:00:00${TZ}`).getUTCDay();
  const ranges = (a.days || []).find((d: any) => d.day === dow)?.ranges || [];
  const dayStart = atLagos(date, '00:00'), dayEnd = new Date(dayStart.getTime() + DAY);
  const taken = new Set((await SlotLock.find({ hostId, start: { $gte: dayStart, $lt: dayEnd } }).select('start').lean()).map((s: any) => new Date(s.start).getTime()));
  const busy: any[] = await Visit.find({ hostId, status: { $in: ACTIVE_VISIT }, scheduledStart: { $gte: dayStart, $lt: dayEnd } }).select('scheduledStart scheduledEnd').lean();
  if (busy.length >= a.maxPerDay) return [];
  const earliest = now.getTime() + a.minNoticeHours * 3600000; const out: { start: Date; end: Date }[] = [];
  for (const r of ranges) {
    const [sh, sm] = r.start.split(':').map(Number); const [eh, em] = r.end.split(':').map(Number);
    for (let m = sh * 60 + sm; m + a.slotMinutes <= eh * 60 + em; m += a.slotMinutes + a.bufferMinutes) {
      const start = atLagos(date, `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`); const end = new Date(start.getTime() + a.slotMinutes * MIN);
      if (start.getTime() < earliest || taken.has(start.getTime())) continue;
      if (busy.some((b) => b.scheduledStart && b.scheduledEnd && start < new Date(b.scheduledEnd) && end > new Date(b.scheduledStart))) continue;
      out.push({ start, end });
    }
  }
  return out;
}

export async function bookableHosts(orgId: string) {
  const av: any[] = await HostAvailability.find({ organizationId: orgId, enabled: true }).select('userId').lean();
  const us: any[] = await User.find({ _id: { $in: av.map((a) => a.userId) }, organizationId: orgId, isActive: true }).select('name department jobTitle').lean();
  return us.map((u) => ({ id: String(u._id), name: u.name, department: u.department, title: u.jobTitle })).sort((a, b) => a.name.localeCompare(b.name));
}
export async function calendar(orgId: string, hostId: string, days: number) {
  const out: { date: string; free: number }[] = []; const now = new Date();
  for (let i = 0; i < days; i++) { const date = lagosDate(new Date(now.getTime() + i * DAY)); out.push({ date, free: (await slotsFor(orgId, hostId, date, now)).length }); }
  return out;
}

/* ------------------------------------------------------------------ creating visits */
interface Person { name: string; email?: string; phone?: string; company?: string }
async function host(orgId: string, hostId: string) {
  const h: any = await User.findOne({ _id: hostId, organizationId: orgId, isActive: true }).select('name email department phone');
  if (!h) throw ApiError.badRequest('Host not found'); return h;
}

export async function bookAppointment(input: { hostId: string; start: string; person: Person; purpose?: string }) {
  const o = await orgOf(); const h = await host(o.id, input.hostId);
  const start = new Date(input.start); if (Number.isNaN(start.getTime())) throw ApiError.badRequest('Invalid time');
  const free = await slotsFor(o.id, input.hostId, lagosDate(start));
  const slot = free.find((s) => s.start.getTime() === start.getTime());
  if (!slot) throw ApiError.conflict('That time is no longer available. Please choose another.');
  const m = await watchMatch(o.id, input.person);
  if (m?.level === 'block') { // never reveal why
    const sec = (await usersWithModule(o.id, 'visitors_admin')).map((u: any) => String(u._id));
    await notify({ organizationId: o.id, userIds: sec, title: 'Blocked person tried to book online', body: `${input.person.name} <${input.person.email || ''}> matched a blocking watchlist entry and was refused.`, link: '/visitors?tab=watchlist', type: 'reminder', severity: 'critical', category: 'system', dedupeKey: `watch-book:${Date.now()}` });
    m.entry.hits += 1; m.entry.lastHitAt = new Date(); await m.entry.save();
    throw ApiError.badRequest('We could not accept this booking online. Please contact reception.');
  }
  const visit: any = new Visit({
    organizationId: o.id, reference: await nextNumber(o.id, 'VIS', { yearly: true, pad: 4 }), type: 'appointment', status: m ? 'pending_approval' : 'booked', source: 'public_booking',
    visitor: { name: input.person.name, email: input.person.email, phone: input.person.phone, company: input.person.company }, purpose: input.purpose,
    hostId: h._id, hostName: h.name, hostDepartment: h.department, scheduledStart: slot.start, scheduledEnd: slot.end, passCode: code(),
    watch: m ? { level: m.level, entryId: m.entry._id, matchedOn: m.matchedOn } : undefined,
    timeline: [tl('Visitor', `Booked ${fmtDT(slot.start)} with ${h.name} through the public link${m ? ' (watchlist flag raised)' : ''}`)],
  });
  try { await SlotLock.create({ organizationId: o.id, hostId: h._id, start: slot.start, visitId: visit._id }); }
  catch { throw ApiError.conflict('Someone has just booked that time. Please choose another.'); }
  try { await visit.save(); } catch (e) { await SlotLock.deleteOne({ visitId: visit._id }); throw e; }
  if (m) await recordHit(o.id, m, visit);
  await notify({ organizationId: o.id, userIds: [String(h._id)], title: `Visitor booked: ${visit.visitor.name} on ${fmtDT(slot.start)}`, body: `${visit.visitor.name}${visit.visitor.company ? ` (${visit.visitor.company})` : ''} booked ${fmtDT(slot.start)}–${fmtTime(slot.end)}. Purpose: ${visit.purpose || '—'}`, link: '/my-visitors', type: 'reminder', severity: 'info', category: 'system', dedupeKey: `visit-booked:${visit._id}`, email: { intro: `${visit.visitor.name} has booked ${fmtDT(slot.start)}–${fmtTime(slot.end)} to see you. Purpose: ${visit.purpose || '—'}`, ctaLabel: 'Open my visitors' } });
  if (visit.visitor.email) sendMail({ to: visit.visitor.email, subject: `Your visit to ${o.name} is confirmed – ${visit.reference}`, html: `<p>Hello ${esc(visit.visitor.name)},</p><p>Your appointment with <b>${esc(h.name)}</b> is booked for <b>${fmtDT(slot.start)}</b> (Lagos time, ${Math.round((slot.end.getTime() - slot.start.getTime()) / MIN)} minutes).</p><p>Please bring a photo ID. At reception show your pass: <a href="${visitUrl(visit.passCode)}">${visitUrl(visit.passCode)}</a><br>You can cancel from the same page.</p>` }).catch((err) => logger.warn({ err }, 'visit confirmation not sent'));
  return visit;
}

export async function registerWalkIn(orgId: string, input: { hostId: string; person: Person; purpose?: string; vehicle?: string; idType?: string; idLast4?: string }, actor: { id?: string; name: string }) {
  const h = await host(orgId, input.hostId);
  const m = await watchMatch(orgId, input.person);
  const visit: any = await Visit.create({
    organizationId: orgId, reference: await nextNumber(orgId, 'VIS', { yearly: true, pad: 4 }), type: 'walk_in', status: 'pending_approval', source: 'front_desk',
    visitor: { name: input.person.name, email: input.person.email, phone: input.person.phone, company: input.person.company, idType: input.idType, idLast4: input.idLast4 }, purpose: input.purpose, vehicle: input.vehicle,
    hostId: h._id, hostName: h.name, hostDepartment: h.department, passCode: code(),
    watch: m ? { level: m.level, entryId: m.entry._id, matchedOn: m.matchedOn } : undefined,
    timeline: [tl(actor.name, `Walk-in registered for ${h.name}; approval requested${m ? ' (watchlist flag raised)' : ''}`)],
  });
  if (m) await recordHit(orgId, m, visit);
  await notify({ organizationId: orgId, userIds: [String(h._id)], title: `${visit.visitor.name} is at reception for you`, body: `${visit.visitor.name}${visit.visitor.company ? ` (${visit.visitor.company})` : ''} — ${visit.purpose || 'no purpose given'}. Please accept or decline.`, link: '/my-visitors', type: 'reminder', severity: 'high', category: 'system', entity: { type: 'Visit', id: String(visit._id) }, dedupeKey: `visit-ask:${visit._id}`, email: { intro: `${visit.visitor.name} is at reception asking for you. Purpose: ${visit.purpose || '—'}. Please accept or decline.`, ctaLabel: 'Respond' } });
  return visit;
}

export async function decide(orgId: string, id: string, hostUserId: string, accept: boolean, reason: string | undefined, actor: { name: string }) {
  const v: any = await Visit.findOne({ _id: id, organizationId: orgId });
  if (!v) throw ApiError.notFound('Visit not found');
  if (String(v.hostId) !== String(hostUserId)) throw ApiError.forbidden('Only the person being visited can answer this request.');
  if (v.status !== 'pending_approval') throw ApiError.conflict(`This request is already ${v.status.replace('_', ' ')}.`);
  if (!accept && String(reason || '').trim().length < 3) throw ApiError.badRequest('Give the visitor a short reason.');
  v.status = accept ? (v.type === 'appointment' ? 'booked' : 'approved') : 'rejected';
  v.decision = { at: new Date(), byName: actor.name, reason: reason?.trim() };
  v.timeline.push(tl(actor.name, accept ? 'Host accepted the visit' : `Host declined: ${reason}`));
  if (!accept) await SlotLock.deleteOne({ visitId: v._id });
  await v.save();
  const o = await orgOf();
  const fd = (await usersWithModule(orgId, 'visitors')).map((u: any) => String(u._id));
  await notify({ organizationId: orgId, userIds: fd, title: `${v.hostName} ${accept ? 'accepted' : 'declined'} ${v.visitor.name}`, body: accept ? 'You can check the visitor in.' : `Reason: ${reason}`, link: '/visitors', type: 'reminder', severity: accept ? 'info' : 'warning', category: 'system', dedupeKey: `visit-decision:${v._id}` });
  if (v.visitor.email) sendMail({ to: v.visitor.email, subject: accept ? `${v.hostName} will see you – ${o.name}` : `Your visit request – ${o.name}`, html: accept ? `<p>Hello ${esc(v.visitor.name)},</p><p><b>${esc(v.hostName)}</b> has accepted your visit. Please wait at reception to be checked in and given your pass.</p>` : `<p>Hello ${esc(v.visitor.name)},</p><p>Unfortunately ${esc(v.hostName)} is unable to meet you${reason ? `: ${esc(reason)}` : ''}. Please contact reception to arrange another time.</p>` }).catch((err) => logger.warn({ err }, 'decision mail not sent'));
  return v;
}

export async function checkIn(orgId: string, id: string, actor: { id?: string; name: string }, opts: { override?: string; canOverrideBlock?: boolean } = {}) {
  const v: any = await Visit.findOne({ _id: id, organizationId: orgId });
  if (!v) throw ApiError.notFound('Visit not found');
  if (v.status === 'checked_in') throw ApiError.conflict('Already checked in.');
  if (v.status === 'pending_approval') throw ApiError.conflict('The host has not accepted this visit yet.');
  if (!['approved', 'booked'].includes(v.status)) throw ApiError.conflict(`This visit is ${v.status.replace('_', ' ')} and cannot be checked in.`);
  if (v.type === 'appointment' && v.scheduledStart && lagosDate(v.scheduledStart) !== lagosDate(new Date())) throw ApiError.conflict(`This appointment is on ${lagosDate(v.scheduledStart)}, not today.`);
  if (v.watch?.level === 'block' && !(opts.canOverrideBlock && String(opts.override || '').trim().length >= 10)) throw ApiError.forbidden('Security must clear this visitor first. Please call security.');
  if (v.watch?.level === 'flag' && String(opts.override || '').trim().length < 5 && !v.watch.overrideReason) throw ApiError.badRequest('This visitor is flagged. Confirm security has been told and enter a note to continue.');
  if (opts.override) { v.watch = { ...(v.watch?.toObject?.() || v.watch || {}), overrideReason: opts.override, overrideByName: actor.name }; }
  const today = lagosDate(new Date());
  const n = await Visit.countDocuments({ organizationId: orgId, checkedInAt: { $gte: atLagos(today, '00:00') } });
  v.badgeNo = `V-${String(n + 1).padStart(3, '0')}`; v.status = 'checked_in'; v.checkedInAt = new Date(); v.checkedInByName = actor.name;
  v.timeline.push(tl(actor.name, `Checked in, badge ${v.badgeNo}${opts.override ? ` (override: ${opts.override})` : ''}`));
  await v.save();
  await notify({ organizationId: orgId, userIds: [String(v.hostId)], title: `${v.visitor.name} has arrived`, body: `${v.visitor.name}${v.visitor.company ? ` (${v.visitor.company})` : ''} is at reception, badge ${v.badgeNo}.`, link: '/my-visitors', type: 'reminder', severity: 'high', category: 'system', dedupeKey: `visit-arrived:${v._id}`, email: { intro: `${v.visitor.name} has arrived at reception to see you (badge ${v.badgeNo}).`, ctaLabel: 'Open my visitors' } });
  return v;
}

export async function checkOut(orgId: string, id: string, actor: { name: string }) {
  const v: any = await Visit.findOne({ _id: id, organizationId: orgId });
  if (!v) throw ApiError.notFound('Visit not found');
  if (v.status !== 'checked_in') throw ApiError.conflict('This visitor is not checked in.');
  v.status = 'checked_out'; v.checkedOutAt = new Date(); v.checkedOutByName = actor.name; v.timeline.push(tl(actor.name, 'Checked out')); await v.save();
  return v;
}

export async function cancel(orgId: string, v: any, byName: string, why?: string) {
  if (!['pending_approval', 'approved', 'booked'].includes(v.status)) throw ApiError.conflict('This visit can no longer be cancelled.');
  v.status = 'cancelled'; v.timeline.push(tl(byName, `Cancelled${why ? `: ${why}` : ''}`)); await v.save();
  await SlotLock.deleteOne({ visitId: v._id });
  if (byName === 'Visitor') await notify({ organizationId: orgId, userIds: [String(v.hostId)], title: `${v.visitor.name} cancelled ${v.scheduledStart ? fmtDT(v.scheduledStart) : 'their visit'}`, link: '/my-visitors', type: 'reminder', severity: 'info', category: 'system', dedupeKey: `visit-cancel:${v._id}` });
  else if (v.visitor.email) sendMail({ to: v.visitor.email, subject: 'Your visit has been cancelled', html: `<p>Hello ${esc(v.visitor.name)},</p><p>Your visit${v.scheduledStart ? ` on ${fmtDT(v.scheduledStart)}` : ''} with ${esc(v.hostName)} was cancelled${why ? `: ${esc(why)}` : ''}. Please contact reception to rebook.</p>` }).catch(() => undefined);
  return v;
}

/* ------------------------------------------------------------------ pass */
export async function passPdf(orgId: string, v: any): Promise<Buffer> {
  const org: any = await Organization.findById(orgId).select('name').lean();
  const qr = await QRCode.toBuffer(`GSJX-VIS:${v.passCode}`, { margin: 1, width: 220, errorCorrectionLevel: 'M' });
  const doc = new PDFDocument({ size: [297, 420], margin: 20, info: { Title: `Visitor pass ${v.badgeNo || v.reference}` } });
  const chunks: Buffer[] = []; doc.on('data', (c) => chunks.push(c)); const done = new Promise<Buffer>((r) => doc.on('end', () => r(Buffer.concat(chunks))));
  doc.rect(0, 0, 297, 46).fill('#C22FD4'); doc.fillColor('#fff').fontSize(18).text('VISITOR', 20, 14);
  doc.fontSize(9).text(org?.name || 'Global SJX Limited', 20, 32);
  doc.fillColor('#111').fontSize(20).text(v.visitor.name, 20, 62, { width: 257 });
  doc.fontSize(11).fillColor('#444').text(v.visitor.company || '', { width: 257 });
  doc.moveDown(0.6).fontSize(10).fillColor('#111').text(`Visiting: ${v.hostName}`).text(v.hostDepartment ? `Department: ${v.hostDepartment}` : '').text(`Date: ${lagosDate(v.checkedInAt || new Date())}   In: ${v.checkedInAt ? fmtTime(v.checkedInAt) : '—'}`);
  doc.image(qr, 38, 190, { width: 150 });
  doc.fontSize(26).fillColor('#C22FD4').text(v.badgeNo || '', 195, 215, { width: 90 });
  doc.fontSize(8).fillColor('#666').text(`Ref ${v.reference}`, 195, 250, { width: 90 });
  doc.fontSize(9).fillColor('#111').text('Wear this pass visibly. Valid today only. Return it at reception when you leave.', 20, 355, { width: 257, align: 'center' });
  doc.end(); return done;
}
export async function qrDataUrl(codeStr: string) { return QRCode.toDataURL(`GSJX-VIS:${codeStr}`, { margin: 1, width: 240 }); }

/* ------------------------------------------------------------------ on-site and evacuation */
export async function onSite(orgId: string) {
  const rows: any[] = await Visit.find({ organizationId: orgId, status: 'checked_in' }).sort({ checkedInAt: 1 }).lean();
  const hosts: any[] = await User.find({ _id: { $in: rows.map((r) => r.hostId).filter(Boolean) } }).select('name phone email department').lean();
  const hm = new Map(hosts.map((h) => [String(h._id), h]));
  return rows.map((r) => { const h = hm.get(String(r.hostId)); return { id: String(r._id), reference: r.reference, name: r.visitor.name, company: r.visitor.company, phone: r.visitor.phone, email: r.visitor.email, badgeNo: r.badgeNo, checkedInAt: r.checkedInAt, hostName: r.hostName, hostDepartment: r.hostDepartment, hostPhone: h?.phone, hostEmail: h?.email, flagged: !!r.watch }; });
}
export async function startEvacuation(orgId: string, input: { reason: string; drill?: boolean }, actor: { name: string }) {
  const open = await EvacuationEvent.findOne({ organizationId: orgId, endedAt: { $exists: false } });
  if (open) throw ApiError.conflict('An evacuation is already in progress.');
  const reason = String(input.reason || '').trim(); if (reason.length < 3) throw ApiError.badRequest('Say why (fire, drill, threat…)');
  const people = (await onSite(orgId)).map((p) => ({ visitId: p.id, name: p.name, company: p.company, phone: p.phone, email: p.email, hostName: p.hostName, badgeNo: p.badgeNo }));
  const ev: any = await EvacuationEvent.create({ organizationId: orgId, reason, drill: !!input.drill, startedByName: actor.name, people });
  const ids = Array.from(new Set([...(await usersWithModule(orgId, 'visitors_admin', 'visitors')).map((u: any) => String(u._id)), ...(await User.find({ organizationId: orgId, isActive: true, role: { $in: ['ceo', 'coo'] } }).select('_id').lean()).map((u: any) => String(u._id))]));
  await notify({ organizationId: orgId, userIds: ids, title: `${input.drill ? 'DRILL – ' : ''}EVACUATION: ${reason}`, body: `${people.length} visitor(s) on site. Open the evacuation dashboard for names, phones and hosts.`, link: '/visitors?tab=onsite', type: 'reminder', severity: 'critical', category: 'system', dedupeKey: `evac:${ev._id}`, email: { intro: `${input.drill ? 'This is a drill. ' : ''}Evacuation started by ${actor.name}: ${reason}. ${people.length} visitor(s) were on site.`, ctaLabel: 'Open the evacuation list' } });
  return ev;
}
export async function accountFor(orgId: string, eventId: string, visitId: string, actor: { name: string }, note?: string) {
  const ev: any = await EvacuationEvent.findOne({ _id: eventId, organizationId: orgId }); if (!ev) throw ApiError.notFound('Event not found');
  if (ev.endedAt) throw ApiError.conflict('This evacuation has ended.');
  const p = ev.people.find((x: any) => String(x.visitId) === String(visitId)); if (!p) throw ApiError.notFound('Not on this list');
  p.accountedAt = p.accountedAt ? undefined : new Date(); p.accountedByName = p.accountedAt ? actor.name : undefined; p.note = note; ev.markModified('people'); await ev.save(); return ev;
}
export async function endEvacuation(orgId: string, eventId: string, actor: { name: string }) {
  const ev: any = await EvacuationEvent.findOne({ _id: eventId, organizationId: orgId }); if (!ev) throw ApiError.notFound('Event not found');
  if (ev.endedAt) throw ApiError.conflict('Already ended.');
  ev.endedAt = new Date(); ev.endedByName = actor.name; await ev.save();
  const missing = ev.people.filter((p: any) => !p.accountedAt);
  if (missing.length) {
    const ids = (await usersWithModule(orgId, 'visitors_admin')).map((u: any) => String(u._id));
    await notify({ organizationId: orgId, userIds: ids, title: `Evacuation ended with ${missing.length} visitor(s) not accounted for`, body: missing.map((m: any) => `${m.name} (host ${m.hostName})`).join('\n'), link: '/visitors?tab=onsite', type: 'reminder', severity: 'critical', category: 'system', dedupeKey: `evac-end:${ev._id}` });
  }
  return { event: ev, missing: missing.length };
}

/* ------------------------------------------------------------------ analytics */
export async function analytics(orgId: string, days: number) {
  const since = new Date(Date.now() - days * DAY);
  const rows: any[] = await Visit.find({ organizationId: orgId, createdAt: { $gte: since } }).select('type status visitor.email visitor.name hostId hostName checkedInAt checkedOutAt scheduledStart watch createdAt source').limit(10000).lean();
  const inn = rows.filter((r) => r.checkedInAt);
  const byDay: Record<string, number> = {}, byHour: Record<number, number> = {}, byDow: Record<number, number> = {}, byHost: Record<string, { name: string; n: number }> = {};
  for (const r of inn) {
    const d = new Date(r.checkedInAt); const k = lagosDate(d); byDay[k] = (byDay[k] || 0) + 1; const h = lagosHour(d); byHour[h] = (byHour[h] || 0) + 1;
    const dw = new Date(`${k}T12:00:00${TZ}`).getUTCDay(); byDow[dw] = (byDow[dw] || 0) + 1;
    const hk = String(r.hostId); (byHost[hk] ||= { name: r.hostName, n: 0 }).n++;
  }
  const dur = inn.filter((r) => r.checkedOutAt).map((r) => (new Date(r.checkedOutAt).getTime() - new Date(r.checkedInAt).getTime()) / MIN).filter((x) => x >= 0 && x < 1440);
  const appts = rows.filter((r) => r.type === 'appointment' && ['checked_in', 'checked_out', 'no_show'].includes(r.status));
  const emails = new Map<string, number>(); for (const r of inn) { const e = (r.visitor?.email || r.visitor?.name || '').toLowerCase(); if (e) emails.set(e, (emails.get(e) || 0) + 1); }
  const series: { date: string; visitors: number }[] = []; for (let i = days - 1; i >= 0; i--) { const k = lagosDate(new Date(Date.now() - i * DAY)); series.push({ date: k, visitors: byDay[k] || 0 }); }
  const DOW = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
  const top = <T,>(o: Record<string, T>, f: (v: T) => number) => Object.entries(o).sort((a, b) => f(b[1]) - f(a[1]))[0];
  const bh = top(byHour as any, (v: number) => v); const bd = top(byDow as any, (v: number) => v);
  return {
    days, total: rows.length, checkedIn: inn.length, walkIns: rows.filter((r) => r.type === 'walk_in').length, appointments: rows.filter((r) => r.type === 'appointment').length,
    byStatus: rows.reduce((m: any, r) => ((m[r.status] = (m[r.status] || 0) + 1), m), {}),
    avgMinutes: dur.length ? Math.round(dur.reduce((a, b) => a + b, 0) / dur.length) : null,
    noShowRate: appts.length ? Math.round((appts.filter((r) => r.status === 'no_show').length / appts.length) * 100) : null,
    rejectedRate: rows.filter((r) => r.type === 'walk_in').length ? Math.round((rows.filter((r) => r.status === 'rejected').length / rows.filter((r) => r.type === 'walk_in').length) * 100) : null,
    busiestHour: bh ? `${String(bh[0]).padStart(2, '0')}:00` : null, busiestDay: bd ? DOW[Number(bd[0])] : null,
    byHour: Array.from({ length: 24 }, (_, h) => ({ hour: h, n: byHour[h] || 0 })).filter((x) => x.hour >= 6 && x.hour <= 20),
    byWeekday: DOW.map((d, i) => ({ day: d, n: byDow[i] || 0 })),
    topHosts: Object.values(byHost).sort((a, b) => b.n - a.n).slice(0, 8), series, repeatVisitors: Array.from(emails.values()).filter((n) => n > 1).length,
    watchlistHits: rows.filter((r) => r.watch).length, online: rows.filter((r) => r.source === 'public_booking').length,
  };
}
