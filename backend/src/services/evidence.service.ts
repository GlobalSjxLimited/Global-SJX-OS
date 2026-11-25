import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import { Evidence, EvidenceRequest } from '../models/Evidence';
import { nextNumber } from '../models/Access';
import { storage } from './storage.service';
import { ApiError } from '../utils/ApiError';

export const DAY = 86400000;
const CONTROL = /^A\.[5-8]\.\d{1,2}$/;
const list = (v: unknown, rx?: RegExp): string[] => Array.from(new Set((Array.isArray(v) ? v : String(v || '').split(/[,;\s]+/)).map((x) => String(x).trim()).filter(Boolean).filter((x) => !rx || rx.test(x)))).slice(0, 40);

/** Absolute path of a file stored through /api/uploads, only if it belongs to this organisation. */
export function localPath(orgId: string, url: string): string | null {
  const m = /^\/api\/uploads\/([a-f0-9]{24})\/([A-Za-z0-9._-]+)$/.exec(url || '');
  if (!m || m[1] !== String(orgId)) return null;
  const p = path.join(storage.uploadsRoot, m[1], path.basename(m[2]));
  return p.startsWith(storage.uploadsRoot) ? p : null;
}
export function sha256File(p: string): Promise<string> {
  return new Promise((res, rej) => { const h = crypto.createHash('sha256'); fs.createReadStream(p).on('data', (c) => h.update(c)).on('end', () => res(h.digest('hex'))).on('error', rej); });
}
export const statusOf = (e: any): 'superseded' | 'expired' | 'expiring' | 'current' => e.supersededById ? 'superseded' : e.validUntil && new Date(e.validUntil) < new Date() ? 'expired' : e.validUntil && new Date(e.validUntil).getTime() - Date.now() < 30 * DAY ? 'expiring' : 'current';

export interface EvidenceInput { title: string; description?: string; kind?: 'file' | 'link' | 'note'; url?: string; originalName?: string; mimeType?: string; size?: number; controlRefs?: unknown; clauses?: unknown; registerRefs?: unknown; collectedOn?: string; validUntil?: string; ownerId?: string; ownerName?: string }

export async function createEvidence(orgId: string, input: EvidenceInput, actor: { id?: string; name: string }, extra: { previous?: any } = {}) {
  const kind = input.kind || (input.url ? 'file' : 'note');
  const title = String(input.title || '').trim(); if (title.length < 3) throw ApiError.badRequest('Give the evidence a title');
  const controls = list(input.controlRefs, CONTROL); const clauses = list(input.clauses, /^\d{1,2}(\.\d{1,2})*$/);
  if (!controls.length && !clauses.length && !list(input.registerRefs).length) throw ApiError.badRequest('Link the evidence to at least one Annex A control (e.g. A.8.13), clause (e.g. 9.2) or register record.');
  let sha: string | undefined; let size = input.size; let integrity: 'ok' | 'n/a' = 'n/a';
  if (kind === 'file') {
    if (!input.url) throw ApiError.badRequest('Upload the file first, then attach it');
    const p = localPath(orgId, input.url); if (!p || !fs.existsSync(p)) throw ApiError.badRequest('That file was not found. Upload it again.');
    sha = await sha256File(p); size = fs.statSync(p).size; integrity = 'ok';
  } else if (kind === 'link') {
    if (!/^https?:\/\//i.test(input.url || '')) throw ApiError.badRequest('A link must start with http:// or https://');
  } else if (String(input.description || '').trim().length < 20) throw ApiError.badRequest('A written note needs at least a couple of sentences in the description.');
  const validUntil = input.validUntil ? new Date(input.validUntil) : undefined;
  if (validUntil && Number.isNaN(validUntil.getTime())) throw ApiError.badRequest('"Valid until" is not a date');
  const refNo = await nextNumber(orgId, 'EV', { yearly: false, pad: 4 });
  return Evidence.create({
    organizationId: orgId, refNo, title, description: input.description, kind, url: input.url, originalName: input.originalName, mimeType: input.mimeType, size, sha256: sha, integrity, lastVerifiedAt: sha ? new Date() : undefined,
    controlRefs: controls, clauses, registerRefs: list(input.registerRefs), collectedOn: input.collectedOn ? new Date(input.collectedOn) : new Date(), validUntil,
    ownerId: input.ownerId || actor.id, ownerName: input.ownerName || actor.name, createdByName: actor.name,
    version: (extra.previous?.version || 0) + 1, previousId: extra.previous?._id,
    history: [{ at: new Date(), byName: actor.name, action: extra.previous ? `new version ${(extra.previous.version || 1) + 1}` : 'added', note: sha ? `SHA-256 ${sha.slice(0, 16)}…` : undefined }],
  });
}

/** Replaces a piece of evidence with a new version. The old one stays, marked superseded, and keeps its lock. */
export async function refreshEvidence(orgId: string, id: string, input: EvidenceInput, actor: { id?: string; name: string }) {
  const old: any = await Evidence.findOne({ _id: id, organizationId: orgId });
  if (!old) throw ApiError.notFound('Evidence not found');
  if (old.supersededById) throw ApiError.conflict('This evidence has already been replaced by a newer version.');
  const fresh: any = await createEvidence(orgId, {
    ...input, title: input.title || old.title, description: input.description ?? old.description, controlRefs: input.controlRefs ?? old.controlRefs, clauses: input.clauses ?? old.clauses, registerRefs: input.registerRefs ?? old.registerRefs,
    ownerId: String(old.ownerId || actor.id), ownerName: old.ownerName,
  }, actor, { previous: old });
  old.supersededById = fresh._id; old.history.push({ at: new Date(), byName: actor.name, action: 'superseded', note: `by ${fresh.refNo}` }); await old.save();
  // close any open request that asked for a refresh of this item
  await EvidenceRequest.updateMany({ organizationId: orgId, sourceEvidenceId: old._id, status: 'open' }, { $set: { status: 'fulfilled', evidenceId: fresh._id, fulfilledAt: new Date() } });
  return fresh;
}

/** Re-hashes the stored file. A changed or missing file is flagged – the original is never altered by the app. */
export async function verifyEvidence(orgId: string, e: any, actor: { name: string }) {
  if (e.kind !== 'file') return e;
  const p = localPath(orgId, e.url || '');
  const now = sha256Safe(p);
  const cur = await now;
  e.integrity = cur === null ? 'missing' : cur === e.sha256 ? 'ok' : 'changed'; e.lastVerifiedAt = new Date();
  e.history.push({ at: new Date(), byName: actor.name, action: 'integrity check', note: e.integrity });
  await e.save(); return e;
}
async function sha256Safe(p: string | null): Promise<string | null> { try { return p && fs.existsSync(p) ? await sha256File(p) : null; } catch { return null; } }

export async function createRequest(orgId: string, input: { title: string; controlRef?: string; note?: string; assigneeId?: string; assigneeName?: string; dueDate?: string; source?: 'manual' | 'auto'; sourceEvidenceId?: string }, actor: { name: string }) {
  const title = String(input.title || '').trim(); if (title.length < 3) throw ApiError.badRequest('Describe what is needed');
  const refNo = await nextNumber(orgId, 'EVR', { yearly: false, pad: 4 });
  return EvidenceRequest.create({ organizationId: orgId, refNo, title, controlRef: input.controlRef, note: input.note, assigneeId: input.assigneeId, assigneeName: input.assigneeName, dueDate: input.dueDate ? new Date(input.dueDate) : undefined, source: input.source || 'manual', sourceEvidenceId: input.sourceEvidenceId, createdByName: actor.name });
}

export async function summary(orgId: string) {
  const all: any[] = await Evidence.find({ organizationId: orgId }).select('supersededById validUntil integrity controlRefs lockedAt').lean();
  const live = all.filter((e) => !e.supersededById);
  const st = live.map(statusOf);
  const covered = new Set(live.filter((e) => statusOf(e) !== 'expired').flatMap((e) => e.controlRefs || []));
  return { total: live.length, current: st.filter((s) => s === 'current').length, expiring: st.filter((s) => s === 'expiring').length, expired: st.filter((s) => s === 'expired').length, locked: live.filter((e) => e.lockedAt).length, tampered: live.filter((e) => ['changed', 'missing'].includes(e.integrity)).length, controlsCovered: covered.size, openRequests: await EvidenceRequest.countDocuments({ organizationId: orgId, status: 'open' }) };
}
