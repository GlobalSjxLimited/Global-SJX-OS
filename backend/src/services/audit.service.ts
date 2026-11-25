import crypto from 'crypto';
import { Request } from 'express';
import { ActivityLog, logActivity } from '../models/ActivityLog';
import { AuditSeal } from '../models/Governance';
import { logger } from '../utils/logger';

/** Record an audit entry with full request context (who, what, from where). Never throws — auditing must not break the business action. */
export async function audit(
  req: Request,
  action: string,
  entityType: string,
  entityId?: string,
  opts: { meta?: unknown; summary?: string; module?: string; severity?: 'info' | 'low' | 'medium' | 'high' | 'critical'; status?: 'success' | 'failed' } = {}
): Promise<void> {
  try {
    await logActivity({
      organizationId: req.user!.organizationId,
      actorId: req.user!.id,
      actorName: req.user!.name,
      action,
      entityType,
      entityId,
      ip: req.ip,
      userAgent: String(req.headers['user-agent'] || '').slice(0, 300),
      requestId: (req as any).id,
      ...opts,
    });
  } catch (err) {
    logger.error({ err, action }, 'audit write failed');
  }
}

function dayRange(day: string) {
  const start = new Date(`${day}T00:00:00.000Z`);
  const end = new Date(start.getTime() + 86400000);
  return { start, end };
}

async function digestFor(organizationId: string, day: string) {
  const { start, end } = dayRange(day);
  const rows = await ActivityLog.find({ organizationId, createdAt: { $gte: start, $lt: end } })
    .sort({ createdAt: 1, _id: 1 })
    .select('action entityType entityId actorId createdAt status')
    .lean();
  const h = crypto.createHash('sha256');
  for (const r of rows) h.update(`${r._id}|${r.action}|${r.entityType}|${r.entityId || ''}|${r.actorId || ''}|${new Date(r.createdAt as any).toISOString()}|${r.status}\n`);
  return { count: rows.length, digest: h.digest('hex') };
}

/** Seals a closed day: digest is chained to the previous day's seal, so altering or deleting any past entry breaks verification. */
export async function sealDay(organizationId: string, day: string) {
  const exists = await AuditSeal.findOne({ organizationId, day });
  if (exists) return exists;
  const prev = await AuditSeal.findOne({ organizationId, day: { $lt: day } }).sort({ day: -1 });
  const { count, digest } = await digestFor(organizationId, day);
  const chained = crypto.createHash('sha256').update(`${prev?.chainHash || 'GENESIS'}|${day}|${digest}|${count}`).digest('hex');
  return AuditSeal.create({ organizationId, day, count, digest, prevChainHash: prev?.chainHash || 'GENESIS', chainHash: chained });
}

/** Seals every un-sealed past day (up to 60 per run). */
export async function sealPendingDays(organizationId: string) {
  const today = new Date().toISOString().slice(0, 10);
  const last = await AuditSeal.findOne({ organizationId }).sort({ day: -1 });
  const first = await ActivityLog.findOne({ organizationId }).sort({ createdAt: 1 }).select('createdAt');
  if (!first) return 0;
  let cursor = last ? new Date(new Date(`${last.day}T00:00:00Z`).getTime() + 86400000) : new Date(`${new Date(first.createdAt as any).toISOString().slice(0, 10)}T00:00:00Z`);
  let n = 0;
  while (cursor.toISOString().slice(0, 10) < today && n < 60) {
    await sealDay(organizationId, cursor.toISOString().slice(0, 10));
    cursor = new Date(cursor.getTime() + 86400000);
    n++;
  }
  return n;
}

export async function verifySeals(organizationId: string) {
  const seals = await AuditSeal.find({ organizationId }).sort({ day: 1 });
  let prev = 'GENESIS';
  const problems: Array<{ day: string; problem: string }> = [];
  for (const s of seals) {
    const { count, digest } = await digestFor(organizationId, s.day);
    if (count !== s.count || digest !== s.digest) problems.push({ day: s.day, problem: `Log entries for this day no longer match the sealed digest (sealed ${s.count}, now ${count}).` });
    const expected = crypto.createHash('sha256').update(`${prev}|${s.day}|${s.digest}|${s.count}`).digest('hex');
    if (s.prevChainHash !== prev || s.chainHash !== expected) problems.push({ day: s.day, problem: 'Seal chain is broken.' });
    prev = s.chainHash;
  }
  return { sealedDays: seals.length, valid: problems.length === 0, problems };
}
