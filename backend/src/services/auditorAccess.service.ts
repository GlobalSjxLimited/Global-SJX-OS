import crypto from 'crypto';
import fs from 'fs';
import { AuditorAccess, Evidence } from '../models/Evidence';
import { IsmsRecord } from '../models/Isms';
import { REGISTERS, REGISTER_MAP } from '../config/isms';
import { ApiError } from '../utils/ApiError';
import { localPath } from './evidence.service';
import { notify } from './notify.service';
import { usersWithModule } from './access.service';

const hashOf = (t: string) => crypto.createHash('sha256').update(t).digest('hex');
const MAX_DAYS = 60;

export async function createAccess(orgId: string, input: { name: string; email?: string; company?: string; registers?: string[]; includeEvidence?: boolean; days?: number }, actor: { name: string }) {
  const name = String(input.name || '').trim(); if (name.length < 2) throw ApiError.badRequest("Enter the auditor's name");
  const days = Math.min(Math.max(Math.floor(Number(input.days) || 14), 1), MAX_DAYS);
  const regs = (input.registers?.length ? input.registers : REGISTERS.map((r) => r.key)).filter((k) => REGISTER_MAP[k]);
  if (!regs.length) throw ApiError.badRequest('Choose at least one register');
  const token = crypto.randomBytes(32).toString('base64url');
  const rec: any = await AuditorAccess.create({ organizationId: orgId, name, email: input.email, company: input.company, tokenHash: hashOf(token), registers: regs, includeEvidence: input.includeEvidence !== false, expiresAt: new Date(Date.now() + days * 86400000), createdByName: actor.name });
  return { rec, token }; // the token is shown once and cannot be recovered
}

export async function resolve(token: string, ip: string, what: string) {
  const a: any = token && token.length >= 20 ? await AuditorAccess.findOne({ tokenHash: hashOf(token) }) : null;
  if (!a || a.revokedAt || a.expiresAt < new Date()) throw ApiError.notFound('This link is not valid or has expired');
  a.lastUsedAt = new Date(); a.uses += 1; a.log.push({ at: new Date(), what, ip }); if (a.log.length > 500) a.log = a.log.slice(-500);
  await a.save();
  return a;
}

export async function overview(a: any) {
  const n = new Map<string, number>();
  for (const k of a.registers) n.set(k, await IsmsRecord.countDocuments({ organizationId: a.organizationId, register: k, isDeleted: { $ne: true } }));
  return { auditor: a.name, company: a.company, expiresAt: a.expiresAt, includeEvidence: a.includeEvidence, registers: a.registers.map((k: string) => ({ key: k, title: REGISTER_MAP[k].title, clause: REGISTER_MAP[k].clause, count: n.get(k) || 0 })) };
}

export async function records(a: any, key: string, page: number) {
  if (!a.registers.includes(key)) throw ApiError.forbidden('That register is not part of this audit');
  const def = REGISTER_MAP[key]; const limit = 100;
  const rows: any[] = await IsmsRecord.find({ organizationId: a.organizationId, register: key, isDeleted: { $ne: true } }).sort(key === 'annex_a' ? { refNo: 1 } : { createdAt: -1 }).skip((page - 1) * limit).limit(limit).lean();
  return { def: { key, title: def.title, clause: def.clause, cols: def.cols.map((c) => ({ key: c.key, label: c.label, type: c.type })) }, rows: rows.map((r) => ({ refNo: r.refNo, status: r.status, owner: r.ownerName, updatedAt: r.updatedAt, data: r.data })) };
}

export async function evidenceList(a: any) {
  if (!a.includeEvidence) throw ApiError.forbidden('Evidence is not part of this audit');
  const rows: any[] = await Evidence.find({ organizationId: a.organizationId, supersededById: { $exists: false } }).sort({ createdAt: -1 }).limit(500).select('refNo title description kind controlRefs clauses collectedOn validUntil sha256 lockedAt originalName size').lean();
  return rows;
}

export async function evidenceFile(a: any, refNo: string) {
  if (!a.includeEvidence) throw ApiError.forbidden('Evidence is not part of this audit');
  const e: any = await Evidence.findOne({ organizationId: a.organizationId, refNo, kind: 'file' }).lean();
  const p = e && localPath(String(a.organizationId), e.url);
  if (!e || !p || !fs.existsSync(p)) throw ApiError.notFound('File not found');
  return { path: p, name: e.originalName || `${e.refNo}` };
}

export async function warnExpiringAndNotify(orgId: string, a: any, ip: string) {
  // first use of a link tells the ISMS team
  if (a.uses === 1) {
    const ids = (await usersWithModule(orgId, 'isms')).map((u: any) => String(u._id));
    await notify({ organizationId: orgId, userIds: ids, title: `Auditor link opened: ${a.name}`, body: `${a.name}${a.company ? ` (${a.company})` : ''} opened their read-only audit link for the first time (from ${ip}). It expires ${a.expiresAt.toISOString().slice(0, 10)}.`, link: '/isms?tab=auditors', type: 'reminder', severity: 'info', category: 'system', dedupeKey: `auditor-first:${a._id}` });
  }
}
