import crypto from 'crypto';
import { Request } from 'express';
import { AssetEvent } from '../models/Asset';

/** Tamper-evident per-asset history: every event stores the hash of the previous one, so editing or deleting an entry breaks the chain (A.8.15, A.5.33). */
function hashEvent(prev: string, e: { seq: number; action: string; actor: any; changes: any[]; note?: string; at: string }) {
  return crypto.createHash('sha256').update(`${prev}|${JSON.stringify(e)}`).digest('hex');
}

export async function appendEvent(opts: { asset: any; action: string; actor: { id: string; name: string; role: string }; req?: Request; changes?: any[]; note?: string }) {
  for (let attempt = 0; attempt < 5; attempt++) {
    const last = await AssetEvent.findOne({ asset: opts.asset._id }).sort({ seq: -1 });
    const seq = (last?.seq || 0) + 1;
    const prevHash = last?.hash || 'GENESIS';
    const at = new Date().toISOString();
    const core = { seq, action: opts.action, actor: opts.actor, changes: opts.changes || [], note: opts.note, at };
    try {
      return await AssetEvent.create({
        organizationId: opts.asset.organizationId,
        asset: opts.asset._id,
        assetRef: opts.asset.assetId,
        seq,
        action: opts.action,
        actor: opts.actor,
        changes: opts.changes || [],
        note: opts.note,
        ip: opts.req?.ip,
        userAgent: String(opts.req?.headers['user-agent'] || '').slice(0, 200),
        prevHash,
        hash: hashEvent(prevHash, { ...core }),
        createdAt: new Date(at),
      });
    } catch (e: any) {
      if (e.code === 11000) continue; // concurrent writer took this seq — retry
      throw e;
    }
  }
  throw new Error('Could not append asset event');
}

export async function verifyChain(asset: any) {
  const events = await AssetEvent.find({ asset: asset._id }).sort({ seq: 1 }).lean();
  let prev = 'GENESIS';
  for (const e of events) {
    const expected = hashEvent(prev, { seq: e.seq, action: e.action, actor: e.actor, changes: (e.changes as any[]).map((c) => ({ field: c.field, from: c.from, to: c.to })), note: e.note || undefined, at: new Date(e.createdAt as any).toISOString() });
    // changes may be serialised differently (undefined → missing), so compare via JSON round-trip.
    const expected2 = hashEvent(prev, JSON.parse(JSON.stringify({ seq: e.seq, action: e.action, actor: e.actor, changes: (e.changes as any[]).map((c) => ({ field: c.field, from: c.from, to: c.to })), note: e.note || undefined, at: new Date(e.createdAt as any).toISOString() })));
    if (e.prevHash !== prev || (e.hash !== expected && e.hash !== expected2)) return { valid: false, events: events.length, reason: `Event #${e.seq} (${e.action}) does not match its recorded hash`, brokenAt: e.seq };
    prev = e.hash;
  }
  return { valid: true, events: events.length };
}

export function diff(before: any, after: any, fields: string[]) {
  const out: Array<{ field: string; from: any; to: any }> = [];
  for (const f of fields) {
    const a = norm(before[f]);
    const b = norm(after[f]);
    if (JSON.stringify(a) !== JSON.stringify(b)) out.push({ field: f, from: a, to: b });
  }
  return out;
}
const norm = (v: any) => (v instanceof Date ? v.toISOString().slice(0, 10) : v && v._bsontype ? String(v) : v === undefined ? '' : v);
