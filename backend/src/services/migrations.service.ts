import { Risk } from '../models/Risk';
import { Task } from '../models/Task';
import { Project } from '../models/Project';
import { Goal } from '../models/Goal';
import { Meeting } from '../models/Meeting';
import { normaliseQuarter, parseQuarter } from '../utils/quarter';
import { logger } from '../utils/logger';

/**
 * Idempotent data migrations that run at start-up. Every step only touches records that still
 * have the old shape, so running them repeatedly (or on a fresh database) is safe.
 */
export async function runMigrations(): Promise<Record<string, number>> {
  const done: Record<string, number> = {};
  const step = async (name: string, fn: () => Promise<number>) => {
    try { done[name] = await fn(); if (done[name]) logger.info({ migration: name, changed: done[name] }, 'data migration applied'); }
    catch (err) { logger.error({ err, migration: name }, 'data migration failed'); }
  };

  // Portable read-modify-write (no aggregation-pipeline updates), batched through a cursor.
  const each = async (col: any, filter: Record<string, unknown>, fn: (doc: any) => Record<string, unknown> | null) => {
    let n = 0;
    const cursor = col.find(filter);
    for await (const doc of cursor) {
      const upd = fn(doc);
      if (upd) { await col.updateOne({ _id: doc._id }, upd); n += 1; }
    }
    return n;
  };

  // Risks: "likelihood" became "severity" (and gained a "critical" level). Copy the old value across.
  await step('risk.severity', () => each(Risk.collection, { severity: { $exists: false } }, (d) => ({ $set: { severity: d.likelihood || 'medium' }, $unset: { likelihood: '' } })));

  // Projects: the life-cycle phases. completed → closure, cancelled → inactive, paused → on hold.
  for (const [from, to] of Object.entries({ completed: 'closure', cancelled: 'inactive', paused: 'on_hold' })) {
    await step(`project.status.${from}`, async () => { const r: any = await Project.collection.updateMany({ status: from }, { $set: { status: to } }); return r.modifiedCount || 0; });
  }
  // Opportunities: Won / Lost became Closed Won / Closed Lost.
  await step('opportunity.stage.won', async () => { const { Opportunity } = await import('../models/Opportunity'); const r: any = await Opportunity.collection.updateMany({ stage: 'Won' }, { $set: { stage: 'Closed Won' } }); return r.modifiedCount || 0; });
  await step('opportunity.stage.lost', async () => { const { Opportunity } = await import('../models/Opportunity'); const r: any = await Opportunity.collection.updateMany({ stage: 'Lost' }, { $set: { stage: 'Closed Lost' } }); return r.modifiedCount || 0; });

  // Tasks: the ten-status life-cycle. Old values are mapped, nothing is lost: blocked → on hold, awaiting approval → to be reviewed, done → complete.
  const MAP: Record<string, string> = { backlog: 'open', todo: 'open', blocked: 'on_hold', review: 'to_be_reviewed', awaiting_approval: 'to_be_reviewed', done: 'complete' };
  for (const [from, to] of Object.entries(MAP)) {
    await step(`task.status.${from}`, async () => {
      const r: any = await Task.collection.updateMany({ status: from }, { $set: { status: to, ...(to === 'complete' ? { percentComplete: 100 } : to === 'to_be_reviewed' ? { percentComplete: 100 } : {}) } });
      return r.modifiedCount || 0;
    });
  }
  await step('task.percent', () => each(Task.collection, { percentComplete: { $exists: false } }, (d) => ({ $set: { percentComplete: ['complete', 'closed', 'to_be_reviewed', 'done', 'awaiting_approval'].includes(d.status) ? 100 : d.status === 'in_progress' ? 25 : 0 } })));
  // Older embedded task comments move into the shared thread so replies, reactions and edits work on them too.
  await step('task.comments.to.thread', async () => {
    const { Discussion } = await import('../models/Discussion');
    let n = 0;
    for await (const t of Task.collection.find({ 'comments.0': { $exists: true }, threadMigrated: { $ne: true } })) {
      for (const c of t.comments || []) {
        if (c.kind && c.kind !== 'comment') continue; // updates / requests stay in the updates feed
        const legacyId = `${t._id}:${c._id}`;
        if (await Discussion.exists({ legacyId })) continue;
        await Discussion.collection.insertOne({ organizationId: t.organizationId, entityType: 'task', entityId: t._id, kind: 'comment', body: c.body, authorId: c.authorId, mentions: [], awareness: [], attachments: c.attachments || [], reactions: [], history: [], isDeleted: false, notify: 'none', legacyId, createdAt: c.createdAt || new Date(), updatedAt: c.updatedAt || c.createdAt || new Date() } as any);
        n += 1;
      }
      await Task.collection.updateOne({ _id: t._id }, { $set: { threadMigrated: true } });
    }
    return n;
  });

  // Tasks: endDate mirrors dueDate; creator defaults to the owner so approval routing has a value.
  await step('task.dates', () => each(Task.collection, { dueDate: { $ne: null }, endDate: { $exists: false } }, (d) => (d.dueDate ? { $set: { endDate: d.dueDate } } : null)));
  await step('task.creator', () => each(Task.collection, { creatorId: { $exists: false } }, (d) => ({ $set: { creatorId: d.ownerId } })));

  // Milestones: endDate mirrors dueDate; old milestones keep their old, lighter completion rules (no evidence needed).
  await step('milestone.fields', () => each(Project.collection, { 'milestones.0': { $exists: true } }, (d) => {
    let changed = false;
    const ms = (d.milestones || []).map((m: any) => {
      const next = { ...m, requireEvidence: m.requireEvidence ?? false, severity: m.severity || 'major', ...(m.endDate || !m.dueDate ? {} : { endDate: m.dueDate }) };
      if (next.requireEvidence !== m.requireEvidence || next.severity !== m.severity || next.endDate !== m.endDate) changed = true;
      return next;
    });
    return changed ? { $set: { milestones: ms } } : null;
  }));

  // Goals: normalise quarter text to "2026-Q4" and derive start/end dates.
  await step('goal.quarter', async () => {
    let n = 0;
    for (const g of await Goal.find({ quarter: { $exists: true, $ne: null }, startDate: { $exists: false } })) {
      const q = normaliseQuarter(g.quarter as string);
      const r = parseQuarter(q);
      if (q && r) { g.quarter = q; g.startDate = r.from; g.endDate = r.to; await g.save(); n += 1; }
    }
    return n;
  });

  // Meetings: older records had a bare link; keep it as the provider URL.
  await step('meeting.provider', () => each(Meeting.collection, { provider: { $exists: false }, meetingLink: { $nin: [null, ''] } }, (d) => ({ $set: { provider: 'other', 'providerDetails.url': d.meetingLink } })));
  return done;
}
