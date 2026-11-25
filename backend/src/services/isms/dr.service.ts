import PDFDocument from 'pdfkit';
import { IsmsRecord } from '../../models/Isms';
import { REGISTER_MAP } from '../../config/isms';
import { Organization } from '../../models/Organization';
import { createRecord, compute } from './records.service';
import { usersWithModule } from '../access.service';
import { notify } from '../notify.service';
import { ApiError } from '../../utils/ApiError';

/** Retention, legal hold, deletion certificates, backups and restore tests. */
const SYS = { name: 'System (continuity & retention)' };
const DAY = 86400000;
const eq = (a: unknown, b: unknown) => String(a ?? '').trim().toLowerCase() === String(b ?? '').trim().toLowerCase() && String(a ?? '').trim() !== '';
const addMonths = (d: Date, n: number) => { const x = new Date(d); x.setUTCMonth(x.getUTCMonth() + n); return x; };
const EVERY: Record<string, number> = { Monthly: 1, Quarterly: 3, 'Bi-annual': 6, Annual: 12 };

/* ------------------------------------------------------------------ legal hold */
/** Does an active legal hold cover what is about to be deleted? Matching is on the hold's keywords (case-insensitive) against the item, system and reason. */
export async function activeHoldFor(orgId: string, d: Record<string, any>) {
  const text = [d.item, d.system, d.reason, d.retentionRef].filter(Boolean).join(' ').toLowerCase();
  if (!text) return null;
  const holds: any[] = await IsmsRecord.find({ organizationId: orgId, register: 'legal_hold', status: 'Active', isDeleted: { $ne: true } });
  for (const h of holds) {
    const words = String(h.data?.keywords || '').split(/[,;\n]/).map((w) => w.trim().toLowerCase()).filter((w) => w.length >= 3);
    if (words.some((w) => text.includes(w))) return h;
  }
  return null;
}

export async function blockedByHold(orgId: string, rec: any, data: Record<string, any>, actor: { id?: string; name: string }) {
  const hold = await activeHoldFor(orgId, data);
  if (!hold) return;
  const note = `Deletion ${rec.refNo} (${rec.title}) was blocked by this hold`;
  hold.history.push({ at: new Date(), byId: actor.id, byName: actor.name, action: 'deletion blocked', note }); await hold.save();
  rec.history.push({ at: new Date(), byId: actor.id, byName: actor.name, action: 'blocked by legal hold', note: `${hold.refNo} ${hold.title}` });
  rec.status = 'Blocked'; await rec.save();
  const ids = Array.from(new Set((await usersWithModule(orgId, 'isms')).map((u: any) => String(u._id))));
  await notify({ organizationId: orgId, userIds: ids, title: `Deletion blocked by legal hold ${hold.refNo}`, body: `${actor.name} tried to move ${rec.refNo} "${rec.title}" forward, but legal hold ${hold.refNo} (${hold.title}) covers it.`, link: '/isms?register=legal_hold', type: 'reminder', severity: 'high', category: 'system', dedupeKey: `hold-block:${rec._id}:${new Date().toISOString().slice(0, 13)}` });
  throw ApiError.conflict(`Blocked: legal hold ${hold.refNo} (${hold.title}) covers this item. Release the hold first. The attempt has been logged.`);
}

/* ------------------------------------------------------------------ saves */
export async function afterSave(orgId: string, key: string, rec: any, actor: { id?: string; name: string }) {
  if (key === 'deletion' && rec.status === 'Verified' && !rec.data?.certificate) {
    rec.data = { ...rec.data, certificate: `DC-${rec.refNo}-${new Date().getFullYear()}`, verifiedOn: rec.data?.verifiedOn || new Date() };
    rec.markModified('data'); await rec.save();
  }
  if (key === 'backup') {
    const d = rec.data || {};
    if (!d.nextRestoreTest || !d.restoreEvery) {
      const bia: any = d.biaRef ? await IsmsRecord.findOne({ organizationId: orgId, register: 'bia', $or: [{ refNo: d.biaRef }, { title: d.biaRef }], isDeleted: { $ne: true } }).lean() : null;
      const every = d.restoreEvery || (/tier 1/i.test(bia?.data?.tier || '') ? 'Quarterly' : 'Bi-annual');
      rec.data = { ...d, restoreEvery: every, nextRestoreTest: d.nextRestoreTest || addMonths(new Date(), EVERY[every] || 6) };
      rec.dueDate = rec.data.nextRestoreTest; rec.markModified('data'); await rec.save();
    }
  }
  if (key === 'restore_test' && rec.status === 'Done' && !rec.data?._handled) await restoreDone(orgId, rec, actor);
}

async function restoreDone(orgId: string, rec: any, actor: { id?: string; name: string }) {
  const def = REGISTER_MAP.restore_test;
  let d = { ...(rec.data || {}) };
  const name = String(d.system || '').trim();
  const bia: any = name ? await IsmsRecord.findOne({ organizationId: orgId, register: 'bia', title: new RegExp(`^${name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, 'i'), isDeleted: { $ne: true } }).lean() : null;
  if (!d.rtoHours && bia?.data?.rtoHours) d.rtoHours = bia.data.rtoHours;
  d = compute(def, d);
  const failed = d.result === 'Fail' || d.withinRto === 'No';
  let car: any;
  if (failed) {
    const why = d.result === 'Fail' ? 'the restore failed' : `the restore took ${d.hoursTaken}h against a recovery time objective of ${d.rtoHours}h`;
    car = await createRecord(orgId, 'car', {
      data: {
        source: 'Restore test', standard: 'ISO/IEC 27001:2022', classification: d.result === 'Fail' ? 'Major' : 'Minor', clause: 'Annex A A.8.13 / A.5.30',
        requirementStd: 'Backups must be restorable within the recovery time objective in the business impact analysis.', nonConformity: `Restore test ${rec.refNo} for ${name}: ${why}. ${d.notes || ''}`.trim(),
        implementationDate: new Date(Date.now() + 30 * DAY), responsible: d.testedBy || '',
      },
    }, actor, { source: 'auto', sourceRef: { type: 'restore-test', id: rec.refNo } });
    d.car = car.refNo;
  }
  d._handled = true;
  rec.data = d; rec.markModified('data'); await rec.save();
  const backup: any = name ? await IsmsRecord.findOne({ organizationId: orgId, register: 'backup', title: new RegExp(`^${name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, 'i'), isDeleted: { $ne: true } }) : null;
  if (backup) {
    const when = d.testDate ? new Date(d.testDate) : new Date();
    const next = failed ? new Date(Date.now() + 14 * DAY) : addMonths(when, EVERY[backup.data?.restoreEvery] || 6);
    backup.data = { ...backup.data, lastRestoreTest: when, lastRestoreResult: failed ? (d.result === 'Fail' ? 'Fail' : 'Too slow') : 'Pass', nextRestoreTest: next };
    backup.dueDate = next; backup.markModified('data');
    backup.history.push({ at: new Date(), byName: SYS.name, action: 'restore tested', note: `${rec.refNo}: ${failed ? 'failed' : 'passed'}${car ? ` → ${car.refNo}` : ''}` });
    await backup.save();
  }
  if (failed) {
    const ids = Array.from(new Set((await usersWithModule(orgId, 'isms')).map((u: any) => String(u._id))));
    await notify({ organizationId: orgId, userIds: ids, title: `Restore test failed for ${name}`, body: `${rec.refNo}: ${d.result === 'Fail' ? 'restore failed' : `${d.hoursTaken}h against RTO ${d.rtoHours}h`}. Corrective action ${car.refNo} opened; retest in 14 days.`, link: '/isms?register=car', type: 'reminder', severity: 'critical', category: 'system', dedupeKey: `restore-fail:${rec._id}`, email: { intro: `Restore test ${rec.refNo} for ${name} did not meet the recovery objective. Corrective action ${car.refNo} was opened.`, ctaLabel: 'Open corrective action' } });
  }
}

/* ------------------------------------------------------------------ destruction certificate */
export async function destructionCertificate(orgId: string, id: string): Promise<{ buffer: Buffer; fileName: string }> {
  const rec: any = await IsmsRecord.findOne({ _id: id, organizationId: orgId, register: 'deletion', isDeleted: { $ne: true } }).lean();
  if (!rec) throw ApiError.notFound('Record not found');
  if (rec.status !== 'Verified' || !rec.data?.certificate) throw ApiError.badRequest('A certificate is only issued once the deletion has been verified by a second person.');
  const org: any = await Organization.findById(orgId).lean();
  const d = rec.data; const fmt = (v: any) => (v ? new Date(v).toISOString().slice(0, 10) : '—');
  const doc = new PDFDocument({ size: 'A4', margin: 56, info: { Title: `Certificate of destruction ${d.certificate}`, Author: org?.name || 'Global SJX' } });
  const chunks: Buffer[] = []; doc.on('data', (c) => chunks.push(c));
  const done = new Promise<Buffer>((res) => doc.on('end', () => res(Buffer.concat(chunks))));
  doc.rect(0, 0, doc.page.width, 8).fill('#C22FD4');
  doc.fillColor('#111').fontSize(22).text('Certificate of Destruction', 56, 60);
  doc.fontSize(10).fillColor('#666').text(`${org?.name || 'Global SJX Limited'} · ISMS record ${rec.refNo} · Certificate ${d.certificate}`);
  doc.moveDown(1.5).fillColor('#111').fontSize(11);
  const row = (k: string, v: string) => { doc.font('Helvetica-Bold').text(k, { continued: true }).font('Helvetica').text(`  ${v || '—'}`); doc.moveDown(0.4); };
  row('Item destroyed:', d.item); row('System / location:', d.system); row('Reason:', d.reason); row('Retention entry:', d.retentionRef);
  row('Method:', d.method); row('Destroyed by:', d.deletedBy); row('Date destroyed:', fmt(d.deletedOn));
  row('Independently verified by:', d.verifiedBy); row('Date verified:', fmt(d.verifiedOn));
  doc.moveDown(1).font('Helvetica').fontSize(10).fillColor('#444').text('The undersigned confirm that the information described above was destroyed using the stated method and that the destruction was checked by a second person who did not carry it out. A legal-hold check was made before destruction and no active hold covered this item (ISO/IEC 27001:2022 A.8.10, A.7.14).');
  doc.moveDown(3);
  const y = doc.y; doc.moveTo(56, y).lineTo(246, y).stroke('#999'); doc.moveTo(316, y).lineTo(506, y).stroke('#999');
  doc.fontSize(9).fillColor('#666').text(d.deletedBy || 'Destroyed by', 56, y + 4, { width: 190 }).text(d.verifiedBy || 'Verified by', 316, y + 4, { width: 190 });
  doc.fontSize(8).fillColor('#999').text(`Generated by Global SJX OS on ${new Date().toISOString().slice(0, 10)} from register entry ${rec.refNo}.`, 56, 780);
  doc.end();
  return { buffer: await done, fileName: `${d.certificate}.pdf` };
}
