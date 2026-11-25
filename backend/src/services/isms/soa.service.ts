import { ANNEX_A } from '../../config/annexA';
import { REGISTER_MAP } from '../../config/isms';
import { IsmsRecord } from '../../models/Isms';
import { SecurityControl } from '../../models/Security';
import { createRecord, updateRecord, toDate } from './records.service';
import { usersWithModule } from '../access.service';
import { notify } from '../notify.service';
import { ApiError } from '../../utils/ApiError';
import { logger } from '../../utils/logger';

const DAY = 86400000;
const EVERY: Record<number, string> = { 3: 'Quarterly', 6: 'Bi-annual', 12: 'Annual' };
const MONTHS: Record<string, number> = { Quarterly: 3, 'Bi-annual': 6, Annual: 12 };
const SYS = { name: 'System (Statement of Applicability)' };
const addDays = (d: Date, n: number) => new Date(d.getTime() + n * DAY);
const addMonths = (d: Date, n: number) => { const x = new Date(d); x.setUTCMonth(x.getUTCMonth() + n); return x; };

/** Creates any of the 93 controls that are missing. Never overwrites an edit. Existing app controls set the starting status. */
export async function ensureAnnexA(orgId: string): Promise<{ created: number; total: number }> {
  const have = new Set((await IsmsRecord.find({ organizationId: orgId, register: 'annex_a', isDeleted: { $in: [true, false] } } as any).select('data.ref').lean()).map((r: any) => r.data?.ref));
  const mine: any[] = await SecurityControl.find({ organizationId: orgId }).select('ref status implementation ownerId').lean();
  const known = new Map(mine.map((m) => [m.ref, m]));
  let created = 0; const now = new Date();
  for (const [i, c] of ANNEX_A.entries()) {
    if (have.has(c.ref)) continue;
    const k: any = known.get(c.ref);
    const status = k?.status === 'implemented' ? 'Implemented' : k?.status === 'not_applicable' ? 'Not applicable' : k ? 'In progress' : 'Not started';
    await createRecord(orgId, 'annex_a', {
      status, ownerId: k?.ownerId ? String(k.ownerId) : undefined,
      data: {
        ref: c.ref, title: c.title, theme: c.theme, applicable: status === 'Not applicable' ? 'No' : 'Yes',
        justification: status === 'Not applicable' ? 'Marked not applicable in the security control library.' : 'Included by default – confirm against the risk assessment, or exclude with a reason.',
        implementation: k ? 'See the security control library entry for this control.' : '', test: c.test, testEvery: EVERY[c.months], where: c.where,
        lastResult: 'Not tested',
        // spread the first tests over ~90 days so reminders do not all land on one day
        nextTest: addDays(now, 14 + ((i * 7) % 90)),
      },
    }, SYS, { source: 'auto', sourceRef: { type: 'annex-a', id: c.ref } });
    created++;
  }
  if (created) logger.info({ created }, 'Annex A statement of applicability created');
  return { created, total: ANNEX_A.length };
}

export type TestResult = 'Pass' | 'Partial' | 'Fail';
export interface TestOutcome { record: any; car?: { id: string; refNo: string; created: boolean }; nextTest: Date }

/** Records a control test. A failure opens (or adds to) a corrective action; a pass marks the control implemented. */
export async function runControlTest(orgId: string, id: string, input: { result: TestResult; notes?: string; evidenceUrl?: string }, actor: { id?: string; name: string }): Promise<TestOutcome> {
  if (!['Pass', 'Partial', 'Fail'].includes(input.result)) throw ApiError.badRequest('Result must be Pass, Partial or Fail');
  const notes = String(input.notes || '').trim();
  if (input.result !== 'Pass' && notes.length < 10) throw ApiError.badRequest('Describe what failed (at least 10 characters) so the corrective action can be worked.');
  const rec: any = await IsmsRecord.findOne({ _id: id, organizationId: orgId, register: 'annex_a', isDeleted: { $ne: true } });
  if (!rec) throw ApiError.notFound('Control not found');
  const d = rec.data || {};
  if (d.applicable === 'No') throw ApiError.badRequest('This control is marked not applicable, so there is nothing to test.');
  if (input.evidenceUrl && !/^https?:\/\//i.test(input.evidenceUrl)) throw ApiError.badRequest('Evidence link must start with http(s)://');
  const now = new Date();
  const months = MONTHS[d.testEvery] || 12;
  const nextTest = input.result === 'Pass' ? addMonths(now, months) : input.result === 'Partial' ? addDays(now, 30) : addDays(now, 14);
  const repeatFail = input.result === 'Fail' && d.lastResult === 'Fail';

  let car: TestOutcome['car'];
  if (input.result === 'Fail') {
    const open: any = await IsmsRecord.findOne({ organizationId: orgId, register: 'car', 'sourceRef.type': 'control-test', 'sourceRef.id': d.ref, status: { $nin: REGISTER_MAP.car.closedStatuses }, isDeleted: { $ne: true } });
    if (open) {
      open.history.push({ at: now, byId: actor.id, byName: actor.name, action: 'repeat failure', note: `${d.ref} failed again: ${notes}` });
      await open.save();
      car = { id: String(open._id), refNo: open.refNo, created: false };
    } else {
      const c: any = await createRecord(orgId, 'car', {
        ownerId: rec.ownerId ? String(rec.ownerId) : undefined, ownerName: rec.ownerName,
        data: {
          source: 'Control test', standard: 'ISO/IEC 27001:2022', classification: repeatFail ? 'Major' : 'Minor', clause: `Annex A ${d.ref}`,
          requirementStd: `${d.ref} ${d.title}. Test: ${d.test || ''}`, nonConformity: `Control ${d.ref} (${d.title}) failed its test on ${now.toISOString().slice(0, 10)}: ${notes}`,
          implementationDate: addDays(now, 30), responsible: rec.ownerName || '', link: input.evidenceUrl || undefined,
        },
      }, actor, { source: 'auto', sourceRef: { type: 'control-test', id: d.ref } });
      car = { id: String(c._id), refNo: c.refNo, created: true };
    }
  }

  const status = input.result === 'Pass' ? 'Implemented' : rec.status === 'Implemented' || rec.status === 'Not started' ? 'In progress' : rec.status;
  const updated: any = await updateRecord(orgId, 'annex_a', id, {
    data: { nextTest, ...(input.result === 'Pass' && String(d.implementation || '').trim().length < 10 ? { implementation: `Verified by control test on ${now.toISOString().slice(0, 10)}: ${notes || 'passed'}.` } : {}) },
    status: status !== rec.status ? status : undefined,
    evidenceUrl: input.evidenceUrl || undefined,
    note: `Test ${input.result}${notes ? `: ${notes}` : ''}${car ? ` → ${car.refNo}` : ''}`,
  }, actor);
  // lastTest / lastResult / lastCar are computed columns for people, so write them directly
  updated.data = { ...updated.data, lastTest: now, lastResult: input.result, nextTest, ...(car ? { lastCar: car.refNo } : {}) };
  updated.markModified('data'); updated.dueDate = nextTest; await updated.save();

  if (input.result !== 'Pass') {
    const ids = new Set<string>((await usersWithModule(orgId, 'isms')).map((u: any) => String(u._id)));
    if (rec.ownerId) ids.add(String(rec.ownerId));
    await notify({
      organizationId: orgId, userIds: Array.from(ids), title: `Control ${d.ref} ${input.result === 'Fail' ? 'failed' : 'partly passed'} its test`,
      body: `${d.title}: ${notes}${car ? `\nCorrective action ${car.refNo} ${car.created ? 'opened' : 'updated'}.` : ''}\nRetest due ${nextTest.toISOString().slice(0, 10)}.`,
      link: car ? '/isms?register=car' : '/isms?register=annex_a', type: 'reminder', severity: repeatFail ? 'high' : 'warning', category: 'system',
      dedupeKey: `control-test:${d.ref}:${now.toISOString().slice(0, 10)}:${input.result}`, email: { intro: `${d.ref} ${d.title}: ${notes}`, ctaLabel: 'Open the corrective action' },
    });
  }
  return { record: updated, car, nextTest };
}

/** Counts for the dashboard and the weekly rule. */
export async function soaSummary(orgId: string) {
  const rows: any[] = await IsmsRecord.find({ organizationId: orgId, register: 'annex_a', isDeleted: { $ne: true } }).select('status data dueDate').lean();
  const by = (f: (r: any) => boolean) => rows.filter(f).length;
  const now = new Date();
  return {
    total: rows.length, applicable: by((r) => r.data?.applicable !== 'No'), notApplicable: by((r) => r.data?.applicable === 'No'),
    implemented: by((r) => r.status === 'Implemented'), notStarted: by((r) => r.status === 'Not started'), inProgress: by((r) => r.status === 'In progress'),
    pass: by((r) => r.data?.lastResult === 'Pass'), partial: by((r) => r.data?.lastResult === 'Partial'), fail: by((r) => r.data?.lastResult === 'Fail'),
    untested: by((r) => r.data?.applicable !== 'No' && (!r.data?.lastResult || r.data.lastResult === 'Not tested')),
    testsOverdue: by((r) => r.data?.applicable !== 'No' && r.dueDate && new Date(r.dueDate) < now),
    unjustified: by((r) => r.data?.applicable === 'No' && String(r.data?.justification || '').trim().length < 10),
  };
}
void toDate;
